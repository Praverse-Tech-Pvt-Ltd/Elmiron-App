-- W1-N Part B -- BE-W129: a rejected write is COUNTED, by kind, by company, over a period.
-- `BE-C32` ("log every rejection, so nothing fails silently") and `BE-C60` ("log and filter risky
-- inputs where practical") -- the same requirement from two directions.
--
-- **THE QUESTION THIS IS BUILT TO ANSWER (B1).** An admin asks: *"for my company, between these two
-- dates, how many writes were rejected, of which kind, and through which path?"* --
-- `count_write_rejections(p_from, p_to)`. Before this migration that question had no answer: on the
-- sync path a 72-hour or 120-second rejection was stored as `rejection_code = 'internal_error'` with
-- the reason only in prose and the SQLSTATE thrown away, and on the direct path it was stored nowhere.
--
-- **THE KIND IS THE SQLSTATE (B4).** It is already this project's refusal vocabulary -- the client's
-- `refusalForSqlState` maps every one, and `error-contract.spec.ts` guards that map in both
-- directions -- so a second list of reason names here would be a second vocabulary to keep aligned.
-- 45007 = captured in the future, 45008 = older than the sync lag, 45009 / 45010 = the same two bounds
-- on an audio upload. Prose sits BESIDE the code in `detail`, never instead of it.
--
-- **WHY THE CHECKS STAY IN THEIR TRIGGERS, AND WHERE THE LOG IS WRITTEN INSTEAD (B2).** A trigger
-- refuses by raising, and a raise rolls back everything the transaction wrote -- including any log
-- row written beside it. `BE-W102`'s escape (set `response.status` and RETURN, so the transaction
-- commits) needs a FUNCTION that returns a body; a trigger returns a row or nothing, and a BEFORE
-- trigger returning nothing silently skips the write while reporting success, which is worse than
-- the defect. **So the log is written by the CALLER that catches the refusal**, after its
-- subtransaction has rolled back and before its own transaction commits:
--
--   * **sync (`sync_push`)** -- every item already runs in a `begin ... exception` block; one
--     `perform` in that handler logs every rejection on the path ALL of the MR app's writes take
--     (consent, visits, check-in/out, samples, audio). Measured: nothing in `apps/field` calls
--     `capture_consent`, `record_check_in`, `record_check_out` or `complete_upload` directly, and
--     `createVisit`/`updateVisit` have no caller outside tests.
--   * **direct (`complete_upload`)** -- returns jsonb, so `BE-W102`'s mechanism fits: catch, log,
--     and over HTTP answer with PostgREST's own error envelope and the status PostgREST would have
--     used, so the transaction commits and the client sees the same refusal it saw before.
--
-- **WHAT THIS DOES NOT COVER, and why it is not pretended (registered as `BE-W130`).** Three direct
-- entry points return a TABLE ROW, not jsonb -- `capture_consent`, `record_check_in`,
-- `record_check_out` -- and `visits` accepts direct INSERT/UPDATE with no function at all. None can
-- carry an error envelope, so none can refuse AND commit a log row. The two ways out are a decision,
-- not an implementation detail: (a) make `sync_push` the ONLY write path for those entities by
-- withdrawing the direct grants -- 19 test files and two declared contract paths depend on them, and
-- the frontend owns `createVisit`; or (b) `dblink`, an extension available here but not installed,
-- to write the log in its own transaction -- a dependency ask. **No app traffic uses those paths
-- today**, which is why this is a gap in coverage of the API rather than of the product.

-- ----------------------------------------------------------------------------
-- 1. The log
-- ----------------------------------------------------------------------------

create table public.write_rejections (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  user_id         uuid not null references public.user_profiles (id) on delete restrict,
  -- Which path refused it. A closed set: a new path is a migration, not a string.
  entry_point     text not null,
  -- THE COUNTABLE REASON. Five characters, as Postgres defines a SQLSTATE.
  sqlstate        text not null,
  entity          text,
  entity_id       uuid,
  -- The sync item, so retries of ONE item can be counted as one (`count(distinct sync_item_id)`).
  sync_item_id    uuid,
  -- Beside the code, never instead of it. The raiser's message and detail, verbatim.
  detail          text,
  occurred_at     timestamptz not null default clock_timestamp(),
  constraint write_rejections_entry_point_known
    check (entry_point in ('sync_push', 'complete_upload')),
  constraint write_rejections_sqlstate_shape check (sqlstate ~ '^[0-9A-Z]{5}$')
);

create index write_rejections_org_time_idx on public.write_rejections (organisation_id, occurred_at);

revoke all on table public.write_rejections from anon, authenticated, service_role;
grant select on table public.write_rejections to authenticated;

alter table public.write_rejections enable row level security;
alter table public.write_rejections force row level security;

-- The company admin. Not the MR -- they already see each refusal on their own screen, through the
-- sync verdict -- and not a manager: a count of an MR's rejected writes is a fact about how they
-- work, and no decision has put that on a manager surface.
create policy write_rejections_admin_read on public.write_rejections for select to authenticated
  using (organisation_id = public.current_user_organisation_id() and public.is_admin());

create policy write_rejections_tenant_boundary on public.write_rejections
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 2. The recorder -- internal
-- ----------------------------------------------------------------------------

/**
 * Write one rejection for the CALLER. Identity and company come from the session, never from an
 * argument. With no identity it writes nothing: an anonymous refusal has no actor to name, and
 * logging it would let an unauthenticated caller grow this table (`BE-W102`'s same reasoning).
 */
create or replace function public.record_write_rejection(
  p_entry_point  text,
  p_sqlstate     text,
  p_entity       text,
  p_entity_id    uuid,
  p_sync_item_id uuid,
  p_detail       text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    return;
  end if;
  v_org := public.current_user_organisation_id();
  if v_org is null then
    return;
  end if;
  insert into public.write_rejections
    (organisation_id, user_id, entry_point, sqlstate, entity, entity_id, sync_item_id, detail)
  values
    (v_org, v_uid, p_entry_point, p_sqlstate, p_entity, p_entity_id, p_sync_item_id, p_detail);
end;
$$;

revoke all on function public.record_write_rejection(text, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The question (B1)
-- ----------------------------------------------------------------------------

/**
 * Rejections for the caller's company in [p_from, p_to), counted by SQLSTATE and path. Admin only.
 * `rejections` counts every refusal; `items` counts distinct sync items, so an item refused on five
 * retries is five rejections and one item -- both are true, and a reader needs to know which.
 */
create or replace function public.count_write_rejections(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'only a company admin may count rejected writes' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'a period needs a start before its end' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'sqlstate', s.sqlstate, 'entryPoint', s.entry_point,
             'rejections', s.n, 'items', s.items)
           order by s.sqlstate, s.entry_point)
      from (select w.sqlstate, w.entry_point, count(*) as n,
                   count(distinct w.sync_item_id) as items
              from public.write_rejections w
             where w.organisation_id = public.current_user_organisation_id()
               and w.occurred_at >= p_from and w.occurred_at < p_to
             group by w.sqlstate, w.entry_point) s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.count_write_rejections(timestamptz, timestamptz) from public, anon;
grant execute on function public.count_write_rejections(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The direct path: `complete_upload`
-- ----------------------------------------------------------------------------
--
-- The existing function is RENAMED, not retyped, so its body is byte-for-byte what it was. The new
-- `complete_upload` -- same name, same arguments, same grants -- calls it in a subtransaction.

alter function public.complete_upload(uuid, uuid, integer, bigint, timestamptz, integer)
  rename to complete_upload_unlogged;
revoke all on function public.complete_upload_unlogged(uuid, uuid, integer, bigint, timestamptz, integer)
  from public, anon, authenticated;

create or replace function public.complete_upload(
  p_grant_id         uuid,
  p_object_id        uuid,
  p_duration_seconds integer,
  p_size_bytes       bigint,
  p_recorded_at      timestamptz,
  p_bitrate_kbps     integer default 28
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sqlstate text;
  v_message  text;
  v_detail   text;
  v_hint     text;
begin
  return public.complete_upload_unlogged(
    p_grant_id, p_object_id, p_duration_seconds, p_size_bytes, p_recorded_at, p_bitrate_kbps);
exception when others then
  get stacked diagnostics
    v_sqlstate = returned_sqlstate,
    v_message  = message_text,
    v_detail   = pg_exception_detail,
    v_hint     = pg_exception_hint;

  -- Inside `sync_push`, which logs every rejection itself: re-raise untouched, so one rejection is
  -- one row. And no identity (28000): nothing to attribute, nothing to log.
  if current_setting('app.write_rejections_logged_by', true) = 'sync_push'
     or v_sqlstate = '28000' then
    raise;
  end if;

  perform public.record_write_rejection(
    'complete_upload', v_sqlstate, 'upload', p_object_id, null,
    concat_ws(' -- ', v_message, nullif(v_detail, '')));

  -- Not over HTTP: raise exactly as before. The log row goes with the raise -- `BE-W102`'s trade,
  -- taken for the same reason: an in-database caller must see what it always saw.
  if current_setting('request.method', true) is null then
    raise;
  end if;

  -- Over HTTP: the status PostgREST would have chosen for this SQLSTATE, and PostgREST's own error
  -- envelope, so the client parses the same refusal -- and the transaction commits with the row.
  perform set_config('response.status',
    case when v_sqlstate = '42501' then '403'
         when v_sqlstate in ('23505', '23503') then '409'
         else '400' end,
    true);
  return jsonb_build_object(
    'code', v_sqlstate, 'message', v_message,
    'details', nullif(v_detail, ''), 'hint', nullif(v_hint, ''));
end;
$$;

revoke all on function public.complete_upload(uuid, uuid, integer, bigint, timestamptz, integer)
  from public, anon;
grant execute on function public.complete_upload(uuid, uuid, integer, bigint, timestamptz, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The sync path: `sync_push`, generated from pg_get_functiondef on the running database. The
--    only changes are the two blocks marked "W1-N BE-W129".
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_push(p_batch_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_max_attempts constant integer := 5;
  v_uid       uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_entity    public.sync_entity_kind;
  v_entity_id uuid;
  v_existing  public.sync_items%rowtype;
  v_attempts  integer;
  v_forgiven  integer;
  v_status    public.sync_item_status;
  v_code      public.sync_rejection_code;
  v_detail    text;
  v_warnings  text[];
  v_results   jsonb := '[]'::jsonb;
  v_sqlstate  text;
  v_message   text;
  -- BE-W97. The two halves of a refusal that `sync_push` was throwing away. A `raise`
  -- carries MESSAGE, DETAIL and HINT; this function captured only the first, so
  -- `enforce_ucpmp_sample_cap`'s DETAIL -- the figures the 45004 remedy is meaningless
  -- without -- never left the database. Fifteen other `raise ... using detail` sites
  -- were in the same position, so this closes a class rather than one code.
  v_pg_detail text;
  v_pg_hint   text;
  -- BE-W75. Reset per item, so a refusal cannot inherit the previous item's code.
  v_item_state text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;

  -- W1-N BE-W129. Every rejection below is logged HERE, where the subtransaction has already
  -- rolled back and the outer one will commit. A callee that also logs its own direct calls
  -- (`complete_upload`) reads this and stays quiet, so one rejection is one row.
  perform set_config('app.write_rejections_logged_by', 'sync_push', true);

  insert into public.sync_batches (id, mr_id, item_count, submitted_at)
  values (p_batch_id, v_uid, jsonb_array_length(p_items), now())
  on conflict (id) do nothing;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    v_status     := null;
    v_code       := null;
    v_detail     := null;
    v_warnings   := '{}';
    v_item_state := null;
    -- Reset with the rest, for the reason BE-W75 reset `v_item_state`: a rejected item
    -- must never inherit the previous item's figures. A batch of two samples where only
    -- the second breaks the cap would otherwise report the first line's numbers.
    v_pg_detail  := null;
    v_pg_hint    := null;

    begin
      v_item_id   := (v_item ->> 'id')::uuid;
      v_entity    := (v_item ->> 'entity')::public.sync_entity_kind;
      v_entity_id := (v_item ->> 'entityId')::uuid;
      if v_item_id is null or v_entity is null or v_entity_id is null then
        raise exception 'missing id, entity or entityId' using errcode = '22023';
      end if;
    exception when others then
      v_results := v_results || jsonb_build_object(
        'id', v_item ->> 'id',
        'status', 'rejected',
        'rejectionCode', 'malformed_item',
        'sqlState', '22023',
        -- Raised by this function, not by a callee, so there is no stacked DETAIL to
        -- read. Emitted as null rather than omitted: a verdict whose KEYS vary by branch
        -- makes a client's schema optional where the contract is not.
        'sqlDetail', null,
        'sqlHint', null,
        'rejectionDetail', 'id, entity and entityId are required',
        'warnings', '[]'::jsonb);
      continue;
    end;

    select * into v_existing from public.sync_items s where s.id = v_item_id;

    if found and v_existing.status in ('accepted', 'duplicate') then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'duplicate',
        'rejectionCode', null, 'sqlState', null,
        'sqlDetail', null, 'sqlHint', null, 'rejectionDetail', null,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    if found and v_existing.status = 'dead_lettered' then
      v_results := v_results || jsonb_build_object(
        'id', v_item_id, 'status', 'dead_lettered',
        'rejectionCode', v_existing.rejection_code,
        -- Read back from sync_items, which never stored the SQLSTATE. Null rather than a
        -- guess: the client falls back to `rejectionCode`, which is what it had before.
        'sqlState', null,
        -- Null for the same reason `sqlState` is: `sync_items` stores the MESSAGE and
        -- nothing else, so a replay has no DETAIL to read back. This is the one path on
        -- which the figures do not reach the MR, and it is the SIXTH attempt at an item
        -- whose first five each carried them. Closing it means two new columns on
        -- `sync_items`; recorded rather than done.
        'sqlDetail', null,
        'sqlHint', null,
        'rejectionDetail', v_existing.rejection_detail,
        'warnings', to_jsonb(v_existing.warnings));
      continue;
    end if;

    v_attempts := coalesce(v_existing.attempt_count, 0) + 1;
    v_forgiven := coalesce(v_existing.attempts_forgiven, 0);

    if (v_attempts - v_forgiven) > c_max_attempts then
      v_status := 'dead_lettered';
      v_code   := coalesce(v_existing.rejection_code, 'internal_error');
      v_detail := format('gave up after %s attempts: %s', c_max_attempts,
                         coalesce(v_existing.rejection_detail, 'unknown'));
    else
      begin
        v_warnings := public.apply_sync_item(v_entity, v_entity_id, v_item -> 'payload');
        v_status := 'accepted';
      exception when others then
        get stacked diagnostics
          v_sqlstate  = returned_sqlstate,
          v_message   = message_text,
          v_pg_detail = pg_exception_detail,
          v_pg_hint   = pg_exception_hint;
        v_status     := 'rejected';
        v_detail     := v_message;
        v_item_state := v_sqlstate;
        -- W1-N BE-W129. The SQLSTATE is the countable reason; the message rides beside it.
        -- Written after the item's subtransaction rolled back, so it survives the rejection.
        perform public.record_write_rejection(
          'sync_push', v_sqlstate, v_entity::text, v_entity_id, v_item_id,
          concat_ws(' -- ', v_message, nullif(v_pg_detail, '')));
        -- The two upload branches are matched on the message rather than on a
        -- SQLSTATE, because both are ordinary 42501 and 22023 conditions that
        -- already mean something else here. Each has its own test, so a reworded
        -- message breaks a build rather than quietly degrading an MR's explanation
        -- back to 'the server refused the contents of this item'.
        v_code := case
          -- These two are still matched on the message, and deliberately so: neither has
          -- a SQLSTATE of its own. Both are ordinary 42501 and 22023 conditions that
          -- already mean something else here, and each has its own test, so a reworded
          -- message breaks a build rather than quietly degrading an explanation.
          when v_message ilike '%consent has been withdrawn%' then 'consent_withdrawn'
          when v_message ilike '%upload grant%expired%'       then 'upload_expired'
          -- BE-W75. The third ILIKE was `'%shift window%'`, string-matching the message
          -- that 45002 and 45003 were minted in FIX-06 to replace -- because 22023 is
          -- raised 64 times for unrelated reasons and message text is not a contract. A
          -- fallback left beside a real code outlives the thing it stood in for.
          when v_sqlstate in ('45002', '45003')      then 'outside_shift_window'
          when v_sqlstate = '42501'                  then 'not_your_record'
          when v_sqlstate = '0A000'                  then 'unsupported_entity'
          when v_sqlstate in ('23503', '23502')      then 'missing_reference'
          when v_sqlstate in ('23514', '23505', '22023', '22P02') then 'validation_failed'
          -- 45001, 45004, 45007 and 45008 land here, and that is not a gap being ignored:
          -- `sync_rejection_code` has no member that means any of them, and the fix is
          -- `sqlState` below rather than four new enum values. See the header.
          else 'internal_error'
        end::public.sync_rejection_code;
      end;
    end if;

    insert into public.sync_items
      (id, batch_id, mr_id, entity, operation, entity_id, payload, status,
       rejection_code, rejection_detail, warnings, attempt_count, attempts_forgiven,
       client_created_at, resolved_at)
    values
      (v_item_id, p_batch_id, v_uid, v_entity,
       coalesce(nullif(v_item ->> 'operation', ''), 'create'),
       v_entity_id, coalesce(v_item -> 'payload', '{}'::jsonb), v_status,
       v_code, v_detail, v_warnings, v_attempts, v_forgiven,
       coalesce((v_item ->> 'clientCreatedAt')::timestamptz, now()),
       case when v_status in ('accepted', 'dead_lettered') then clock_timestamp() end)
    on conflict (id) do update
      set status           = excluded.status,
          batch_id         = excluded.batch_id,
          rejection_code   = excluded.rejection_code,
          rejection_detail = excluded.rejection_detail,
          warnings         = excluded.warnings,
          attempt_count    = excluded.attempt_count,
          resolved_at      = excluded.resolved_at;

    v_results := v_results || jsonb_build_object(
      'id', v_item_id,
      'status', v_status,
      'rejectionCode', v_code,
      -- BE-W75. The raw SQLSTATE, beside the coarse enum rather than instead of it. The
      -- client already has a complete SQLSTATE -> refusal map that `error-contract.spec.ts`
      -- guards in BOTH directions, so this reuses one derivation instead of adding a
      -- second. Null when the item was accepted, and null on a dead-letter replay, where
      -- the code is read back from `sync_items` and the original SQLSTATE was never stored.
      'sqlState', v_item_state,
      -- BE-W97. The raiser's DETAIL and HINT, verbatim and UNPARSED.
      --
      -- Verbatim because the alternative is a second derivation of the same meaning in a
      -- second language -- the mistake BE-W75's header argues against, and the one FIX-06
      -- minted 45002/45003 to stop, where a client read prose as a contract. The client
      -- renders these beside the remedy that `sqlState` selects; it never reads them to
      -- decide anything.
      --
      -- Empty string is normalised to null so absence has ONE spelling. MR-26 C found the
      -- three spellings of absent -- missing, null, empty -- interpolating into the same
      -- empty parentheses on a screen.
      'sqlDetail', nullif(v_pg_detail, ''),
      'sqlHint', nullif(v_pg_hint, ''),
      'rejectionDetail', v_detail,
      'warnings', to_jsonb(v_warnings));
  end loop;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'results', v_results,
    'serverTime', clock_timestamp());
end;
$function$;

