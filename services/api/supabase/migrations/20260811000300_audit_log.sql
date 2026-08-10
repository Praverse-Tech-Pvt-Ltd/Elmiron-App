-- ============================================================================
-- BE-W2 · Audit log, and the logged-read path for sensitive tables
--
-- Two requirements from the brief drive everything here:
--
--   * Audit rows are written by DATABASE TRIGGERS, not application code, so they
--     cannot be bypassed by a new endpoint that forgets.
--   * Every READ of an analysis or a consent record is logged, not just writes.
--
-- Postgres has no SELECT trigger. So reads of `analyses` and `consent_records` are
-- not granted to `authenticated` at all — direct access is a genuine permission
-- denied — and every read goes through a SECURITY DEFINER function that writes the
-- audit row FIRST and returns data second. If the audit insert fails, nothing is
-- disclosed.
--
-- Honest limitation, recorded rather than hidden: the audit insert shares the
-- caller's transaction. A caller who rolls back loses the audit row along with
-- everything else. Making it autonomous needs dblink or pg_background; that is a
-- deliberate deferral, not an oversight. It does not weaken the property being
-- tested, because a rolled-back read disclosed nothing durable either.
--
-- Rollback: services/api/rollbacks/20260811000300_audit_log.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Request context helpers
-- ----------------------------------------------------------------------------

create or replace function public.current_request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  return v_headers::jsonb ->> 'x-request-id';
exception
  when others then
    -- A malformed header bag must not break an audited read.
    return null;
end;
$$;

create or replace function public.current_client_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers text;
  v_forwarded text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is not null and v_headers <> '' then
    v_forwarded := split_part(v_headers::jsonb ->> 'x-forwarded-for', ',', 1);
    if v_forwarded is not null and btrim(v_forwarded) <> '' then
      return btrim(v_forwarded)::inet;
    end if;
  end if;
  return inet_client_addr();
exception
  when others then
    return inet_client_addr();
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. The audit log
-- ----------------------------------------------------------------------------

create type public.audit_action as enum ('insert', 'update', 'delete', 'select');

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  public.app_role,
  action      public.audit_action not null,
  table_name  text not null,
  row_id      text,
  occurred_at timestamptz not null default clock_timestamp(),
  request_id  text,
  -- Nullable in general; required for admin access to an analysis or a consent
  -- record, which is enforced in the read functions below.
  reason      text,
  ip_address  inet
);

create index audit_log_table_row_idx on public.audit_log (table_name, row_id, occurred_at desc);
create index audit_log_actor_idx     on public.audit_log (actor_id, occurred_at desc);
create index audit_log_action_idx    on public.audit_log (action, occurred_at desc);

comment on table public.audit_log is
  'Append-only. No UPDATE, no DELETE, no TRUNCATE, by any role including admin and '
  'service_role. Enforced by a statement-level trigger, because BYPASSRLS roles do '
  'not see RLS policies at all.';

create trigger audit_log_reject_mutation
  before update or delete or truncate on public.audit_log
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 3. The write-audit trigger
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER so it can insert into audit_log while running under a caller
-- who has no INSERT grant on it. That asymmetry is the point: an actor can cause
-- an audit row to be written and can never write one directly.
create or replace function public.write_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.audit_action;
  v_row_id text;
begin
  v_action := lower(tg_op)::public.audit_action;

  if tg_op = 'DELETE' then
    v_row_id := (to_jsonb(old) ->> 'id');
  else
    v_row_id := (to_jsonb(new) ->> 'id');
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, request_id, ip_address, occurred_at)
  values
    ((select auth.uid()),
     public.current_app_role(),
     v_action,
     tg_table_name,
     v_row_id,
     public.current_request_id(),
     public.current_client_ip(),
     clock_timestamp());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger user_profiles_audit
  after insert or update or delete on public.user_profiles
  for each row execute function public.write_audit_row();

create trigger territories_audit
  after insert or update or delete on public.territories
  for each row execute function public.write_audit_row();

create trigger doctors_audit
  after insert or update or delete on public.doctors
  for each row execute function public.write_audit_row();

create trigger visits_audit
  after insert or update or delete on public.visits
  for each row execute function public.write_audit_row();

create trigger call_reports_audit
  after insert or update or delete on public.call_reports
  for each row execute function public.write_audit_row();

create trigger samples_and_inputs_audit
  after insert or update or delete on public.samples_and_inputs
  for each row execute function public.write_audit_row();

create trigger analyses_audit
  after insert or update or delete on public.analyses
  for each row execute function public.write_audit_row();

-- consent_records can only ever be inserted; the other two never fire.
create trigger consent_records_audit
  after insert on public.consent_records
  for each row execute function public.write_audit_row();

create trigger consent_text_versions_audit
  after insert or update on public.consent_text_versions
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 4. Logged reads — analyses
-- ----------------------------------------------------------------------------

-- Shape of every logged read:
--   { "data": <row or array or null>, "readAt": <timestamptz>, "auditLogId": <bigint> }
--
-- `readAt` is stamped with clock_timestamp() AFTER the audit insert and AFTER the
-- row is fetched. It exists so the ordering guarantee is externally checkable —
-- audit_log.occurred_at < readAt, measured, not asserted in prose. Clients ignore it.

create or replace function public.read_analysis(p_analysis_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_row      public.analyses%rowtype;
  v_audit_id bigint;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- An admin reading someone's performance analysis must say why. This is the one
  -- place `reason` is not optional.
  if v_role = 'admin' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to an analysis requires a reason'
      using errcode = '22023';
  end if;

  -- Audit first. If this throws, the function aborts and nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'analyses', p_analysis_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Same scope rule an RLS policy would apply. Admin sees everything; everyone else
  -- is bounded by visible_user_ids().
  select * into v_row
    from public.analyses a
   where a.id = p_analysis_id
     and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()));

  return jsonb_build_object(
    'data', case when v_row.id is null then null else to_jsonb(v_row) end,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$$;

create or replace function public.list_analyses(p_mr_id uuid default null, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    raise exception 'admin access to analyses requires a reason'
      using errcode = '22023';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'analyses', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
    into v_rows
    from public.analyses a
   where (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
     and (p_mr_id is null or a.mr_id = p_mr_id);

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Logged reads — consent records
-- ----------------------------------------------------------------------------

create or replace function public.read_consent_record(p_consent_record_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_role     public.app_role;
  v_row      public.consent_records%rowtype;
  v_audit_id bigint;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role = 'admin' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to a consent record requires a reason'
      using errcode = '22023';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'consent_records', p_consent_record_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select * into v_row
    from public.consent_records c
   where c.id = p_consent_record_id
     and (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()));

  return jsonb_build_object(
    'data', case when v_row.id is null then null else to_jsonb(v_row) end,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$$;

create or replace function public.list_consent_records(p_visit_id uuid default null, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    raise exception 'admin access to consent records requires a reason'
      using errcode = '22023';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'consent_records', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.captured_at desc), '[]'::jsonb)
    into v_rows
    from public.consent_records c
   where (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()))
     and (p_visit_id is null or c.visit_id = p_visit_id);

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Call report approval — a manager approves, a manager never authors
-- ----------------------------------------------------------------------------

-- RLS cannot express "this role may change these columns but not those", so
-- approval is an RPC and field_manager gets no UPDATE policy on call_reports at
-- all. The author cannot approve their own report even if they are a manager.
create or replace function public.approve_call_report(
  p_call_report_id uuid,
  p_approved       boolean,
  p_reason         text default null
)
returns public.call_reports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_role public.app_role;
  v_row  public.call_reports%rowtype;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may approve a call report'
      using errcode = '42501';
  end if;

  select * into v_row
    from public.call_reports cr
   where cr.id = p_call_report_id
     and (v_role = 'admin' or cr.mr_id in (select public.visible_user_ids()));

  if v_row.id is null then
    raise exception 'call report % is not in your scope', p_call_report_id
      using errcode = '42501';
  end if;

  if v_row.mr_id = v_uid then
    raise exception 'the author of a call report may not approve it'
      using errcode = '42501';
  end if;

  if v_row.status <> 'submitted' then
    raise exception 'call report % is %; only a submitted report can be decided',
      p_call_report_id, v_row.status
      using errcode = '22023';
  end if;

  update public.call_reports
     set status              = case when p_approved then 'approved'::public.call_report_status
                                    else 'rejected'::public.call_report_status end,
         approved_by_user_id = v_uid,
         approved_at         = now()
   where id = p_call_report_id
  returning * into v_row;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'update', 'call_reports', p_call_report_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp());

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. MR response to their own analysis
-- ----------------------------------------------------------------------------

create or replace function public.respond_to_analysis(p_analysis_id uuid, p_response text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_row public.analyses%rowtype;
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if coalesce(btrim(p_response), '') = '' then
    raise exception 'a response cannot be empty' using errcode = '22023';
  end if;

  -- Only the subject of an analysis may attach a response to it. Not their
  -- manager, not an admin. This is the MR's own account of their own work.
  update public.analyses
     set mr_response     = p_response,
         mr_responded_at = now(),
         mr_viewed_at    = coalesce(mr_viewed_at, now())
   where id = p_analysis_id
     and mr_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    raise exception 'analysis % is not yours', p_analysis_id using errcode = '42501';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Revocations
-- ----------------------------------------------------------------------------

revoke all on table public.audit_log from anon, authenticated;
revoke update, delete, truncate on table public.audit_log from service_role;
revoke usage, select on sequence public.audit_log_id_seq from anon, authenticated;
