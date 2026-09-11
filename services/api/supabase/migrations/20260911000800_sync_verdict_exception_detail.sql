-- ============================================================================
-- BE-W97 - a refusal's FIGURES reach the MR, not just its sentence
--
-- MR-27 C2 drove a real 45004 from the samples screen. It fired, it was refused, and
-- what the MR saw was:
--
--     this would put MR27 UCPMP c over the UCPMP cap for
--     83aa5660-470b-4c82-aa90-000b5347cb1c this month
--
-- A raw doctor UUID and NO NUMBERS. The numbers existed the whole time:
-- `enforce_ucpmp_sample_cap` raises with
--
--     detail = format('cap %s, already given %s, this entry %s, period starting %s', ...)
--     hint   = 'Stop and speak to your manager. The quantity is never trimmed to fit.'
--
-- which for that capture read "cap 1, already given 0, this entry 2, period starting
-- 2026-09-01". `sync_push` called `get stacked diagnostics` for RETURNED_SQLSTATE and
-- MESSAGE_TEXT and nothing else, so DETAIL and HINT were discarded inside the handler.
--
-- ----------------------------------------------------------------------------
-- THIS IS A CLASS, NOT A CODE
-- ----------------------------------------------------------------------------
--
-- Fifteen `raise ... using detail = format(...)` sites exist across these migrations --
-- 45001's "displayed %s, active at %s was %s", 45007's "captured_at %s is after the
-- server clock %s", 45008's "captured %s ago, the maximum is %s hours" -- and every one
-- of them was written to tell somebody a number, and every one of them stopped at the
-- boundary of this function. Special-casing 45004 here would have left the other
-- fourteen where they are and put a second copy of the cap rule in the transport.
--
-- ----------------------------------------------------------------------------
-- VERBATIM, AND NOT PARSED
-- ----------------------------------------------------------------------------
--
-- The client renders DETAIL as the server wrote it and never reads it to DECIDE
-- anything. Deciding is what `sqlState` is for, through `refusalForSqlState`, which
-- `error-contract.spec.ts` guards in both directions.
--
-- The tempting alternative -- emit the figures as JSON so the client can compose its own
-- sentence -- is refused. All fifteen sites use prose `format()`, so JSON here would be a
-- convention of one; and a client that parses server prose is the defect FIX-06 minted
-- 45002 and 45003 to remove, where `when v_message ilike '%shift window%'` stood in for a
-- real code and outlived it by three sessions.
--
-- The honest cost of verbatim: some DETAILs carry UUIDs and read like support notes.
-- That is a wording problem in each raise, fixable where the raise lives -- and the worst
-- offender is fixed in the migration beside this one. It is a smaller problem than a
-- number the MR never sees at all.
--
-- ----------------------------------------------------------------------------
-- WHAT STILL DOES NOT REACH THE MR
-- ----------------------------------------------------------------------------
--
-- A DEAD-LETTER REPLAY. `sync_items` stores `rejection_detail` (the message) and no
-- SQLSTATE, so that path already answers `sqlState: null` and now answers
-- `sqlDetail: null` for the same reason. It is the sixth attempt at an item whose first
-- five each carried the figures. Closing it means two new columns on `sync_items`;
-- recorded rather than done.
--
-- Rollback: services/api/rollbacks/20260911000800_sync_verdict_exception_detail.down.sql
-- ============================================================================

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
$function$


