-- ============================================================================
-- `BE-W215` -- a flagged adverse event reaches a human in its own company, and no other company
-- can count it
-- ============================================================================
--
-- WHAT WAS OPEN -- TWO DEFECTS, ONE IN EACH DIRECTION
--
-- 1. **Too wide.** `adverse_event_clock_summary()` (`20260816000500`, BE-W7) is SECURITY DEFINER,
--    counts `public.adverse_event_reports` with no predicate at all, and is granted to
--    `authenticated`. So any signed-in user of any tenant -- a rep included -- learned every other
--    tenant's report count, how many were overdue and when the next statutory deadline fell.
--    `tenant-probe-direct-tables.spec.ts` carried the admission in a comment ("counts EVERY row in
--    the database"). SECURITY DEFINER means no policy runs behind the body: the body IS the
--    boundary, and this one had none.
--
-- 2. **Too narrow.** Nobody could read a flagged report except the rep who filed it.
--    `adverse_event_reports_select_own` is the only permissive policy on the table, so a flag
--    started a fifteen-day statutory clock (IPC PV Guidance §2.8) that no person in the company
--    could see. BE-W7's header says "routing goes to a human, always"; there was no human.
--
-- THE DECISION THIS IMPLEMENTS
--
-- **Until Q-13 names a PV contact, a tenant's own ADMIN is the human the flags route to.**
-- Q-13 (`docs/operator-inputs.md`) is the PV / data-protection signatory, and `BE-C55` ruled it
-- is not a current-release blocker -- so the flags must go to SOMEBODY meanwhile, and the only
-- accountable person every company already has is its admin. C1 (`.ai-collab/decisions.md`)
-- fixes what that admin is: **a TENANT administrator, not a platform operator**. So every read
-- below is the caller's own organisation and nothing else; there is no cross-tenant reader, and
-- the platform break-glass path C1 describes is still out of scope.
--
-- WHAT IS STILL DELIBERATELY NOT BUILT -- BE-W7's list, unchanged
--
-- No PV officer, no notification channel, no day-thirteen behaviour, no escalation ladder, no
-- triage state and no acknowledgement. Every function here is a READ: nothing is written to the
-- report, which stays append-only, and nothing models what the human then does. When Q-13 is
-- answered the routing target changes; these three reads are what that answer will be wired to,
-- not a guess at it.
--
-- WHY ADMINS ONLY -- NOT MANAGERS
--
-- The comparable summaries are the company-wide compliance reads over other people's records:
-- `retention_status()` / `retention_overview()` (BE-W15, BE-W189 -- counts of other people's
-- recordings) and `search_audit_log()` (BE-W188). Every one is admin-only, refused through
-- `refuse_read`. No existing org-wide compliance summary includes `field_manager`. The manager
-- summaries that do exist (`team_activity`, `team_exceptions`) are about a team's working day,
-- scoped by `visible_user_ids()` to a subtree -- and a subtree's share of a statutory clock is a
-- number that looks like the company's backlog and is not. Widening the route to line managers
-- would also be inventing the escalation ladder BE-W7 refuses to invent; that is Q-13's to say.
--
-- WHY FUNCTIONS AND NOT AN ADMIN SELECT POLICY
--
-- `reported_text` is the one field here that can carry patient information -- the §2.6-versus-DPDP
-- field the sign-off has to rule on. A permissive policy would let an admin read it over plain
-- PostgREST with no reason and no trail. So the house pattern for personal records is followed,
-- as for `consent_records` and `analyses`: a SECURITY DEFINER read that requires a reason and
-- writes one `audit_log` row BEFORE returning. And `20261013000700` (BE-W202) has just moved
-- admins off direct table access onto audited RPCs; this does not open a new direct path.
--
-- HOW A REPORT'S ORGANISATION IS DERIVED
--
-- Through the VISIT's rep: `visits.mr_id` -> `user_profiles.organisation_id`. That is exactly the
-- path `adverse_event_reports_tenant_boundary` reads (`20260922000300`), because
-- `reported_by_mr_id` is null for a transcript detection and the visit is the one thing every
-- report has. One boundary, read the same way in both places.
--
-- THE THREE FUNCTIONS
--
--   adverse_event_clock_summary()   -- REPLACED. Same name, same arguments, same shape
--                                      (`AdverseEventClockSummarySchema`), now the caller's own
--                                      organisation only and admin only. Counts and deadlines
--                                      name nobody and carry no text, so no reason is asked for
--                                      and a served read is not audited; a REFUSED one is.
--   list_adverse_events(...)        -- NEW. Admin, own organisation, newest first, keyset-paged
--                                      (at most 200 a page). Reason required, one audit row.
--                                      Deliberately WITHOUT `reported_text`.
--   read_adverse_event(id, reason)  -- NEW. Admin, own organisation, the full report including
--                                      `reported_text`. Reason required, one audit row, written
--                                      before the row is looked for. Another organisation's id
--                                      returns `data: null` -- exactly what an id that exists
--                                      nowhere returns -- as `read_consent_record` does.
--
-- The admin check reads the TABLE (`effective_role()`), not the JWT: a deactivated admin's token
-- carries `app_role = admin` for up to an hour. A refusal goes through `refuse_read` (BE-W102),
-- so the attempt is in the trail and an HTTP caller gets a 403. No body carries the
-- `v_role = 'admin' or ...` short-circuit `20260917000100` removed; `admin-escape.spec.ts`
-- asserts that over the whole catalogue.
--
-- Rollback: services/api/rollbacks/20261014000200_adverse_event_admin_read.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The summary, scoped
-- ----------------------------------------------------------------------------
--
-- `language sql stable` becomes `plpgsql volatile`, and that is not cosmetic: a refusal writes an
-- audit row through `refuse_read`, and a STABLE function may not write. `create or replace` keeps
-- the existing grant; it is restated in section 4 anyway, so the file says what the ACL is.
create or replace function public.adverse_event_clock_summary()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- `BE-W215`. Was: no check at all, and every organisation's rows.
  if public.effective_role() is distinct from 'admin' then
    return public.refuse_read(
      'adverse_event_reports', null,
      'only an admin may read the adverse-event clock',
      'Until a pharmacovigilance contact is named, adverse-event flags go to your company''s admin. Ask an admin.');
  end if;
  v_org := public.current_user_organisation_id();

  -- One pass over the company's reports, the same five figures the old body computed over the
  -- whole table. A null organisation matches nothing (`=` with null is null), never everything.
  select jsonb_build_object(
           'total',            count(*),
           'overdueCount',     count(*) filter (where a.statutory_due_at <= now()),
           'dueWithin24Hours', count(*) filter (where a.statutory_due_at > now()
                                                  and a.statutory_due_at <= now() + interval '24 hours'),
           'nextDueAt',        min(a.statutory_due_at) filter (where a.statutory_due_at > now()),
           'oldestOverdueAt',  min(a.statutory_due_at) filter (where a.statutory_due_at <= now()))
    into v_out
    from public.adverse_event_reports a
    join public.visits v on v.id = a.visit_id
    join public.user_profiles rep on rep.id = v.mr_id
   where rep.organisation_id = v_org;

  return v_out;
end;
$$;

comment on function public.adverse_event_clock_summary() is
  'BE-W215. The statutory clock of the CALLER''S OWN organisation''s adverse-event reports: total, '
  'overdue, due within 24 hours, next and oldest-overdue deadline. Admin only (effective_role), '
  'refused through refuse_read otherwise. Until Q-13 names a PV contact, the tenant admin is the '
  'human these flags route to (C1: a tenant administrator, never a platform operator).';

-- ----------------------------------------------------------------------------
-- 2. The list -- what a human needs to work the queue, and not the words
-- ----------------------------------------------------------------------------
--
-- Newest first and keyset-paged on (received_at, id), the shape `search_audit_log` pages by id:
-- one row more than the page is read, so whether there is a next page is measured, not guessed.
-- `received_at` is server-stamped and unique enough in practice; `id` breaks any tie, so the
-- order is total and a page boundary can never drop or repeat a row.
--
-- The clock figures come from `adverse_event_clock`, so "hours remaining" and "overdue" have one
-- definition. The view is `security_invoker`; inside this SECURITY DEFINER body the invoker is the
-- owner, so the organisation predicate below is the only boundary -- which is the point of
-- writing it here.
--
-- NO `reported_text`. A list is read every time the screen opens; the words are read once, on
-- purpose, with a reason of their own (`read_adverse_event`).
create or replace function public.list_adverse_events(
  p_reason             text,
  p_limit              integer default 50,
  p_before_received_at timestamptz default null,
  p_before_id          uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org      uuid;
  v_limit    integer;
  v_audit_id bigint;
  v_rows     jsonb;
  v_count    integer;
  v_next_at  timestamptz;
  v_next_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.effective_role() is distinct from 'admin' then
    return public.refuse_read(
      'adverse_event_reports', null,
      'only an admin may read adverse-event reports',
      'Until a pharmacovigilance contact is named, adverse-event flags go to your company''s admin. Ask an admin.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to adverse-event reports requires a reason'
      using errcode = '22023',
            hint = 'Say why the reports are being read. The reason is recorded with the read.';
  end if;
  -- Half a cursor is a caller bug, and silently treating it as "first page" would show the same
  -- page twice and look like the end of the list.
  if (p_before_received_at is null) <> (p_before_id is null) then
    raise exception 'cursor_incomplete: pass p_before_received_at and p_before_id together, or neither'
      using errcode = '22023';
  end if;
  -- Bounded here rather than trusted. 200 is `search_audit_log`'s ceiling and this follows it.
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_org   := public.current_user_organisation_id();

  -- Audit first. If this throws, nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, public.effective_role(), 'select', 'adverse_event_reports', null, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  with page as (
    select c.id, c.visit_id, c.source, c.reported_by_mr_id, c.received_at, c.statutory_due_at,
           c.hours_remaining, c.overdue
      from public.adverse_event_clock c
      join public.visits v on v.id = c.visit_id
      join public.user_profiles rep on rep.id = v.mr_id
     where rep.organisation_id = v_org
       and (p_before_id is null
            or (c.received_at, c.id) < (p_before_received_at, p_before_id))
     order by c.received_at desc, c.id desc
     limit v_limit + 1
  ),
  numbered as (
    select page.*, row_number() over (order by page.received_at desc, page.id desc) as rn
      from page
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',             n.id,
           'visitId',        n.visit_id,
           'source',         n.source,
           'receivedAt',     n.received_at,
           'statutoryDueAt', n.statutory_due_at,
           'hoursRemaining', n.hours_remaining,
           'overdue',        n.overdue,
           -- Null for a transcript detection: a detection carries nobody's name.
           'reportedByMrId', n.reported_by_mr_id,
           'reportedByName', reporter.full_name,
           'doctorId',       v.doctor_id,
           'doctorName',     d.full_name,
           -- The visit's day by the one rule every screen uses (`visit_day`, the rep's zone).
           'visitDate',      public.visit_day(v))
           order by n.received_at desc, n.id desc)
           filter (where n.rn <= v_limit), '[]'::jsonb),
         max(n.received_at) filter (where n.rn = v_limit),
         (array_agg(n.id) filter (where n.rn = v_limit))[1]
    into v_count, v_rows, v_next_at, v_next_id
    from numbered n
    join public.visits v on v.id = n.visit_id
    join public.doctors d on d.id = v.doctor_id
    left join public.user_profiles reporter on reporter.id = n.reported_by_mr_id;

  return jsonb_build_object(
    'data',                 v_rows,
    -- Pass both back, AS RETURNED, for the next page; both null on the last page.
    'nextBeforeReceivedAt', case when v_count > v_limit then v_next_at else null end,
    'nextBeforeId',         case when v_count > v_limit then v_next_id else null end,
    'readAt',               clock_timestamp(),
    'auditLogId',           v_audit_id);
end;
$$;

comment on function public.list_adverse_events(text, integer, timestamptz, uuid) is
  'BE-W215. The caller''s own organisation''s adverse-event reports, newest first, keyset-paged '
  '(p_before_received_at + p_before_id, at most 200 a page), with the clock, the reporting rep''s '
  'name, the doctor and the visit day -- never reported_text. Admin only (refuse_read otherwise); '
  'a reason is required and the read is audited before rows are returned. Q-13, C1.';

-- ----------------------------------------------------------------------------
-- 3. One report, with the words, on purpose
-- ----------------------------------------------------------------------------
--
-- `read_consent_record`'s shape exactly: identity, refusal, reason, audit, THEN the scoped select.
-- The audit row is written before the row is looked for, so an admin trying an id from another
-- company is in the trail with the reason they gave -- and gets `data: null`, which is precisely
-- what an id that exists nowhere returns. Whether a foreign id exists is not this company's
-- business, so the two cases are made indistinguishable rather than refused differently.
create or replace function public.read_adverse_event(p_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org      uuid;
  v_audit_id bigint;
  v_row      jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.effective_role() is distinct from 'admin' then
    return public.refuse_read(
      'adverse_event_reports', p_id::text,
      'only an admin may read an adverse-event report',
      'Until a pharmacovigilance contact is named, adverse-event flags go to your company''s admin. Ask an admin.');
  end if;
  -- The one place a reason is never optional: this returns the rep's own words, the field that can
  -- carry patient information (BE-W7's header; the §2.6-versus-DPDP question Q-13's signatory owns).
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to an adverse-event report requires a reason'
      using errcode = '22023',
            hint = 'Say why the report is being read. The reason is recorded with the read.';
  end if;
  v_org := public.current_user_organisation_id();

  -- Audit first. If this throws, nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, public.effective_role(), 'select', 'adverse_event_reports', p_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  -- Keys built explicitly in the contract's camelCase (`AdverseEventDetailSchema`), never
  -- `to_jsonb(row)` -- the BE-W100 drift between snake_case rows and a camelCase contract.
  select jsonb_build_object(
           'id',                   a.id,
           'visitId',              a.visit_id,
           'source',               a.source,
           'receivedAt',           c.received_at,
           'statutoryDueAt',       c.statutory_due_at,
           'hoursRemaining',       c.hours_remaining,
           'overdue',              c.overdue,
           'reportedByMrId',       a.reported_by_mr_id,
           'reportedByName',       reporter.full_name,
           'doctorId',             v.doctor_id,
           'doctorName',           d.full_name,
           'visitDate',            public.visit_day(v),
           'reportedText',         a.reported_text,
           'redactedTranscriptId', a.redacted_transcript_id,
           'transcriptSegmentId',  a.transcript_segment_id,
           'clientReportedAt',     a.client_reported_at,
           'createdAt',            a.created_at)
    into v_row
    from public.adverse_event_reports a
    join public.adverse_event_clock c on c.id = a.id
    join public.visits v on v.id = a.visit_id
    join public.user_profiles rep on rep.id = v.mr_id
    join public.doctors d on d.id = v.doctor_id
    left join public.user_profiles reporter on reporter.id = a.reported_by_mr_id
   where a.id = p_id
     and rep.organisation_id = v_org;

  return jsonb_build_object('data', v_row, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$$;

comment on function public.read_adverse_event(uuid, text) is
  'BE-W215. One adverse-event report of the caller''s own organisation, including reported_text. '
  'Admin only (refuse_read otherwise); a reason is required and one audit_log row is written before '
  'the row is looked for. Another organisation''s id returns data: null, like an id that does not '
  'exist. Q-13, C1.';

-- ----------------------------------------------------------------------------
-- 4. Grants
-- ----------------------------------------------------------------------------
--
-- REVOKE FIRST. A newly created function in `public` is born executable by `anon` (FIX-14 B), and
-- the two new ones are reads of statutory records. `authenticated` only: the role check is in the
-- body, where it can be audited.
revoke all on function public.adverse_event_clock_summary() from public, anon;
revoke all on function public.list_adverse_events(text, integer, timestamptz, uuid) from public, anon;
revoke all on function public.read_adverse_event(uuid, text) from public, anon;
grant execute on function public.adverse_event_clock_summary() to authenticated;
grant execute on function public.list_adverse_events(text, integer, timestamptz, uuid) to authenticated;
grant execute on function public.read_adverse_event(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The guard -- fails the deploy, as `20260924000300`'s does
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  -- Every body here must refuse through the auditing helper and scope by organisation. A
  -- `create or replace` that silently kept an older body would otherwise pass unnoticed.
  select string_agg(p.proname, ', ' order by p.proname) into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('adverse_event_clock_summary', 'list_adverse_events', 'read_adverse_event')
     and (position('refuse_read' in p.prosrc) = 0
          or position('organisation_id = v_org' in p.prosrc) = 0);
  if v_missing is not null then
    raise exception 'BE-W215: these are not admin-only and organisation-scoped: %', v_missing;
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('adverse_event_clock_summary', 'list_adverse_events', 'read_adverse_event')
       and (has_function_privilege('anon', p.oid, 'execute')
            or not has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception 'BE-W215: an adverse-event read is callable by anon, or not by authenticated';
  end if;
end;
$$;
