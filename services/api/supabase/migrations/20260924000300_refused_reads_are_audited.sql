-- ============================================================================
-- MR-54 - `BE-W102` - a refused read reaches the trail
-- ============================================================================
--
-- **What was recorded, and why it is being reopened.** MR-40 B found that a read which
-- refuses writes nothing: the refusal raises, the raise aborts the transaction, and the
-- audit row goes with it. Four escape routes were costed and **doing nothing was chosen**,
-- written down so an assessor was told rather than left to discover it. The operator has
-- now asked for it, so this reverses a recorded decision deliberately rather than by
-- forgetting it.
--
-- **The fifth route, which that costing did not have.** PostgreSQL still has no autonomous
-- transaction; that part was right. But the request does not have to fail as an ERROR in
-- order to fail as a 403. PostgREST lets a function set `response.status` and RETURN, and
-- the transaction then COMMITS -- so the audit row survives while the caller is still
-- refused. Measured before any of this was written: an audit row written beside
-- `set_config('response.status', '403', true)` was present in the table after the client
-- received HTTP 403. No dependency, no `dblink`, and the trail stays inside the database
-- that guarantees the rest of it.
--
-- **In-database callers still get an exception.** `current_setting('request.method', true)`
-- is `POST` over PostgREST and null in psql (measured both ways), so this refuses exactly
-- as before to anything that is not an HTTP request. No existing test changes, and no
-- internal caller can start silently proceeding past a refusal it used to be stopped by.
--
-- **THREE functions, not seven, and the register is corrected here.** MR-40 named seven
-- audit-then-return paths, which is true of their shape. Only three of them RAISE a
-- `42501`: `list_analysis_overrides`, `list_audit_log`, `retention_status`. The other four
-- refuse only on `28000` (no identity) or `22023` (no reason given), and neither is an
-- access attempt to record.
--
-- **What is deliberately NOT audited, and this is the security half.**
--   - `28000`, unauthenticated: there is no actor to name, and auditing it would let an
--     anonymous caller grow an append-only table with a rejection trigger and no delete
--     path, one row per request. That is a write amplification vector, not a trail.
--   - `22023`, no reason given: a malformed call from our own console, not somebody
--     finding out what they can reach.
--
-- **What this can never cover, measured rather than assumed.** A GRANT-level refusal --
-- `permission denied for function list_audit_log` -- happens before the body runs, so no
-- in-function mechanism will ever see it. `BE-W102` is closed for in-body refusals and
-- remains open for those. The register says so in those words.
--
-- Rollback: services/api/rollbacks/20260924000300_refused_reads_are_audited.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The marker, so "Successful reads" can stay a true heading
-- ----------------------------------------------------------------------------
--
-- Without this, a refused read would enter `audit_log` as an ordinary `select` and the
-- console panel whose heading is "Successful reads" would silently start lying. The column
-- is what lets the panel keep its meaning, and `list_audit_log` below excludes refused rows
-- unless asked for them.
alter table public.audit_log add column refused boolean not null default false;

comment on column public.audit_log.refused is
  'MR-54 BE-W102. True when the row records a read that was REFUSED rather than served. '
  'Default false, so every row written before this column existed reads as what it was: a '
  'read that succeeded. list_audit_log excludes these unless p_include_refused.';

-- ----------------------------------------------------------------------------
-- 2. The refusal itself
-- ----------------------------------------------------------------------------

create or replace function public.refuse_read(
  p_table   text,
  p_row_id  text,
  p_message text,
  p_hint    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid  uuid;
  v_role public.app_role;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  -- A precondition, asserted rather than assumed: this is only ever called after identity
  -- is established. Called with no actor it would write an anonymous row, which is the
  -- amplification vector the header refuses.
  if v_uid is null then
    raise exception 'refuse_read called with no actor' using errcode = '28000';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address,
     occurred_at, refused)
  values
    (v_uid, v_role, 'select', p_table, p_row_id, p_message,
     public.current_request_id(), public.current_client_ip(), clock_timestamp(), true);

  -- Not over HTTP: raise, exactly as before. The audit row goes with the raise, which is
  -- the original defect -- and it is the RIGHT trade here, because the alternative is
  -- changing what every in-database caller and every existing test sees.
  if current_setting('request.method', true) is null then
    -- `using hint = null` is itself an error in PL/pgSQL -- "RAISE statement option cannot
    -- be null" -- and one of the three callers passes no hint. Found by the existing suite,
    -- not by reading.
    if p_hint is null then
      raise exception '%', p_message using errcode = '42501';
    else
      raise exception '%', p_message using errcode = '42501', hint = p_hint;
    end if;
  end if;

  -- Over HTTP: 403, which is what PostgREST returns for an in-body 42501 from an
  -- AUTHENTICATED caller.
  --
  -- **Measured wrong the first time and corrected here.** The spike that established this
  -- called the RPC with the anon key, where PostgREST answers 401 -- it has no identity to
  -- refuse. Generalising that to an identified caller was the error; `analysis-overrides-http`
  -- already asserted 403 and failed, which is the suite doing its job.
  perform set_config('response.status', '403', true);
  return jsonb_build_object(
    'code', '42501', 'details', null, 'hint', p_hint, 'message', p_message);
end;
$function$;

comment on function public.refuse_read(text, text, text, text) is
  'MR-54 BE-W102. Records a refused read and then refuses: by raising for an in-database '
  'caller, or over HTTP by setting response.status and returning PostgREST''s own error '
  'envelope, so the transaction commits and the audit row survives. Never call it before '
  'the caller is identified.';

-- The helper is internal: every caller is a SECURITY DEFINER function in this schema.
revoke all on function public.refuse_read(text, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. The three functions that actually refuse
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_analysis_overrides(p_analysis_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_rows     jsonb;
  v_audit_id bigint;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role = 'admin' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to an override requires a reason'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.analyses a
     where a.id = p_analysis_id
       and a.mr_id in (select public.visible_user_ids())
  ) then
    -- MR-54 `BE-W102`. Records the attempt, then refuses.
    return public.refuse_read(
      'analysis_overrides', p_analysis_id::text,
      format('analysis %s is not within your scope', p_analysis_id),
      null);
  end if;

  -- Audit first. If this throws, nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address,
     occurred_at)
  values
    (v_uid, v_role, 'select', 'analysis_overrides', p_analysis_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- MR-50 C2 / BE-W100. Keys built explicitly, in the contract's camelCase
  -- (AnalysisOverrideSchema). The row-to-json form emitted the table's snake_case, and the database and
  -- the contract disagreed about the same endpoint.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'analysisId', o.analysis_id,
           'findingId', o.finding_id,
           'overriddenByUserId', o.overridden_by_user_id,
           'reason', o.reason,
           'createdAt', o.created_at) order by o.created_at desc), '[]'::jsonb)
    into v_rows
    from public.analysis_overrides o
   where o.analysis_id = p_analysis_id;

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(),
                            'auditLogId', v_audit_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.retention_status(p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_audit_id bigint;
  v_live     integer;
  v_overdue  integer;
  v_destroyed integer;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role is distinct from 'admin' then
    -- MR-54 `BE-W102`. Records the attempt, then refuses.
    return public.refuse_read(
      'recordings', null,
      'only an admin may read retention status',
      'These figures count another person''s recordings. Ask an admin.');
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to retention status requires a reason'
      using errcode = '22023',
            hint = 'Say why the figures are being read. The reason is recorded with the read.';
  end if;

  -- Reading these figures is a read of other people's recordings in aggregate, so it is
  -- audited on the same terms as the audit log itself and for the same reason.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'recordings', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Tenant-bounded through visible_user_ids(), NOT from audio_purge_health(), which is a
  -- whole-database view and is granted to nobody for exactly that reason.
  select
    count(*) filter (where r.purge_state <> 'destroyed'),
    count(*) filter (where r.purge_state <> 'destroyed' and r.purge_after < now()),
    count(*) filter (where r.purge_state = 'destroyed')
  into v_live, v_overdue, v_destroyed
  from public.recordings r
  where r.mr_id in (select public.visible_user_ids());

  return jsonb_build_object(
    'retentionDays', public.audio_retention_days(),
    'liveCount', coalesce(v_live, 0),
    'overdueCount', coalesce(v_overdue, 0),
    'destroyedCount', coalesce(v_destroyed, 0),
    'purgeStalled', public.audio_purge_is_stalled(),
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$function$;

-- `list_audit_log` gains `p_include_refused`, so it is dropped and recreated: adding a
-- defaulted parameter to an existing signature creates a SECOND overload, and PostgREST
-- then refuses the call as ambiguous. The grant is restored below and the guard asserts it.
drop function if exists public.list_audit_log(integer, bigint, text);

CREATE OR REPLACE FUNCTION public.list_audit_log(p_limit integer DEFAULT 100, p_before_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_include_refused boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_audit_id bigint;
  v_rows     jsonb;
  v_hidden   integer;
  v_limit    integer;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The refusal the recorded check names. Before the audit row, because a refused read
  -- is not a read.
  if v_role is distinct from 'admin' then
    -- MR-54 `BE-W102`. Records the attempt, then refuses.
    return public.refuse_read(
      'audit_log', null,
      'only an admin may read the audit log',
      'The audit trail names every actor in the organisation. Ask an admin.');
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to the audit log requires a reason'
      using errcode = '22023',
            hint = 'Say why the trail is being read. The reason is recorded with the read.';
  end if;

  -- Bounded here rather than trusted. 500 is `list_sync_rejections`'s ceiling and this
  -- follows it rather than inventing a second number.
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'audit_log', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Keys are built EXPLICITLY in camelCase rather than with `to_jsonb(row)`.
  --
  -- `list_analysis_overrides` uses `to_jsonb(o)` and therefore emits `analysis_id`,
  -- `finding_id`, `overridden_by_user_id`, `created_at` -- while `AnalysisOverrideSchema`
  -- in `packages/core` declares `analysisId`, `findingId`, `overriddenByUserId`,
  -- `createdAt`, and the mock's fixtures are typed to the schema. The database and the
  -- contract disagree about the shape of the same endpoint, which is the FIX-03 drift
  -- that migration's own comment says it closed. Registered in COMPLETION-PLAN as
  -- BE-W100; not repeated here.
  select coalesce(jsonb_agg(entry order by (entry ->> 'id')::bigint desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id',         l.id,
               'actorId',    l.actor_id,
               'actorRole',  l.actor_role,
               'action',     l.action,
               'tableName',  l.table_name,
               'rowId',      l.row_id,
               'occurredAt', l.occurred_at,
               'requestId',  l.request_id,
               'reason',     l.reason,
               -- MR-54 `BE-W102`. Emitted always, so a caller that asks for refusals can
               -- tell them apart rather than inferring it from the reason text.
               'refused',    l.refused
             ) as entry
        from public.audit_log l
       where l.actor_id in (select public.visible_user_ids())
         and (p_before_id is null or l.id < p_before_id)
         -- Refused reads are EXCLUDED by default. The console panel's heading is
         -- "Successful reads", and a refusal arriving in that list unasked would turn a
         -- true heading into a false one on the day this migration ran.
         and (p_include_refused or not l.refused)
       order by l.id desc
       limit v_limit
    ) rows;

  -- Named rather than silently dropped: the reader is told the page is not the whole
  -- table. `ip_address` is deliberately not returned -- it is in the trail for an
  -- investigator with database access, not for a console screen.
  select count(*)::integer
    into v_hidden
    from public.audit_log l
   where l.actor_id is null;

  return jsonb_build_object(
    'data', v_rows,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id,
    'systemRowsHidden', v_hidden
  );
end;
$function$;

-- **REVOKE FIRST.** A newly created function carries EXECUTE to PUBLIC by default, so the
-- drop-and-recreate above silently handed `anon` a function that reads the audit trail. The
-- repository's own posture guards caught it, which is what they are for; this is the line
-- that stops it. The ACL before the drop was `postgres=X | authenticated=X`, and the guard
-- below asserts it is that again.
revoke all on function public.list_audit_log(integer, bigint, text, boolean) from public, anon;
grant execute on function public.list_audit_log(integer, bigint, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The guard
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log' and column_name = 'refused'
  ) then
    raise exception 'BE-W102: audit_log.refused is missing';
  end if;

  -- Every function this migration rewrote must now route its 42501 through the helper. A
  -- `create or replace` that silently kept an older body would otherwise pass unnoticed.
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('list_analysis_overrides', 'list_audit_log', 'retention_status')
     and position('refuse_read' in p.prosrc) = 0;
  if v_missing is not null then
    raise exception 'BE-W102: these still refuse without auditing: %', v_missing;
  end if;

  -- CONTENT, not just presence: the helper must still refuse. A version that recorded the
  -- attempt and then returned the data would be strictly worse than the defect.
  if position('42501' in (select p.prosrc from pg_proc p join pg_namespace n
                           on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'refuse_read')) = 0 then
    raise exception 'BE-W102: refuse_read no longer refuses';
  end if;

  if not has_function_privilege('authenticated', 'public.list_audit_log(integer, bigint, text, boolean)', 'execute') then
    raise exception 'BE-W102: list_audit_log lost its grant in the drop/recreate';
  end if;
  -- The other half, and the one that actually went wrong while writing this: a recreated
  -- function is EXECUTE-to-PUBLIC until something revokes it.
  if has_function_privilege('anon', 'public.list_audit_log(integer, bigint, text, boolean)', 'execute') then
    raise exception
      'BE-W102: the drop/recreate left list_audit_log callable by anon. The audit trail '
      'names every actor in the organisation.';
  end if;
  if has_function_privilege('anon', 'public.refuse_read(text, text, text, text)', 'execute') then
    raise exception 'BE-W102: refuse_read is callable by anon';
  end if;
end;
$$;
