-- ============================================================================
-- MR-42 A2 -- BE-W101: close the cross-tenant admin escape in eight bodies.
-- ============================================================================
--
-- WHAT WAS OPEN
--
-- Eight SECURITY DEFINER functions carried:
--
--     where (v_role = 'admin' or <actor column> in (select public.visible_user_ids()))
--
-- The `or` short-circuits, so for an admin the scoped half never ran. MR-40 proved two
-- of these sites open; MR-41 measured the remaining six and every one was open, THREE
-- OF THEM WRITES -- an admin of one organisation could approve another organisation's
-- call report, override its analysis and reinstate its rejected sync item.
--
-- These are SECURITY DEFINER against tables with RLS FORCED AND NO POLICY, so the
-- function body IS the boundary. There is nothing behind it to catch this.
--
-- WHY THIS IS A FIX AND NOT A DECISION
--
-- The register carried BE-W101 as needing a decision. It does not. `.ai-collab/
-- decisions.md` C1 (transcribed 9 September 2026) settled it: **`admin` is a TENANT
-- administrator, not a platform operator**, and platform access is "a separate, audited
-- break-glass path" that is "out of MR v1 scope". `20260908000800`'s own exception hint
-- says the same thing to anyone who trips it, citing MR-06 section 3.
--
-- That covers `reinstate_sync_item` too, which reads like platform support: acting
-- across tenants is precisely what C1 refused to fold into the tenant role.
--
-- WHY THE DISJUNCT IS REMOVED RATHER THAN REPLACED WITH A TENANT PREDICATE
--
-- **Because `visible_user_ids()` is already the tenant boundary.** BE-W76 scoped it: for
-- an admin it returns `select p.id from public.user_profiles p where p.organisation_id
-- = v_org` -- every user in that admin's own organisation and nobody else. So
--
--     <actor column> in (select public.visible_user_ids())
--
-- already grants an admin exactly the access C1 describes. The `v_role = 'admin' or`
-- disjunct adds nothing legitimate; it only bypasses the check. Removing it is the whole
-- fix.
--
-- Writing a second organisation predicate into eight bodies would be a SECOND COPY of a
-- rule that already has one home -- which is the shape this repository has been bitten by
-- repeatedly, and is how these eight drifted from `visible_user_ids()` in the first place.
-- One boundary, one definition, eight callers.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
--   * `visible_user_ids()` and `visible_territory_ids()` keep their `if v_role = 'admin'`
--     branch. **That branch IS the scoping** -- it is where the organisation bound is
--     applied -- and it was tenant-bounded by BE-W76. A catalogue sweep for
--     `v_role = 'admin'` will surface both; they are correct and must stay.
--   * The `if v_role = 'admin' and coalesce(btrim(p_reason), '') = ''` guards. Those are
--     the REASON requirement, not the escape, and they are untouched in all eight.
--
-- The bodies below are the current catalogue definitions with that one disjunct removed
-- and nothing else changed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_consent_records(p_visit_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
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
   where c.captured_by_mr_id in (select public.visible_user_ids())
     and (p_visit_id is null or c.visit_id = p_visit_id);

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.read_consent_record(p_consent_record_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and c.captured_by_mr_id in (select public.visible_user_ids());

  return jsonb_build_object(
    'data', case when v_row.id is null then null else to_jsonb(v_row) end,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.read_analysis(p_analysis_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and a.mr_id in (select public.visible_user_ids());

  return jsonb_build_object(
    'data', case when v_row.id is null then null else to_jsonb(v_row) end,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_analyses(p_mr_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
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
   where a.mr_id in (select public.visible_user_ids())
     and (p_mr_id is null or a.mr_id = p_mr_id);

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$function$;

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
    raise exception 'analysis % is not within your scope', p_analysis_id
      using errcode = '42501';
  end if;

  -- Audit first. If this throws, nothing is returned.
  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address,
     occurred_at)
  values
    (v_uid, v_role, 'select', 'analysis_overrides', p_analysis_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
    into v_rows
    from public.analysis_overrides o
   where o.analysis_id = p_analysis_id;

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(),
                            'auditLogId', v_audit_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_call_report(p_call_report_id uuid, p_approved boolean, p_reason text DEFAULT NULL::text)
 RETURNS call_report_approvals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid;
  v_role   public.app_role;
  v_report public.call_reports%rowtype;
  v_row    public.call_report_approvals%rowtype;
  v_prior  uuid;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may decide a call report'
      using errcode = '42501';
  end if;

  select * into v_report
    from public.call_reports cr
   where cr.id = p_call_report_id
     and cr.mr_id in (select public.visible_user_ids());

  if v_report.id is null then
    raise exception 'call report % is not in your scope', p_call_report_id using errcode = '42501';
  end if;

  if v_report.mr_id = v_uid then
    raise exception 'the author of a call report may not decide it' using errcode = '42501';
  end if;

  if v_report.status <> 'submitted' then
    raise exception 'call report % is %; only a submitted report can be decided',
      p_call_report_id, v_report.status using errcode = '22023';
  end if;

  if exists (select 1 from public.call_reports newer
              where newer.supersedes_call_report_id = p_call_report_id) then
    raise exception 'call report % has been superseded by a newer version', p_call_report_id
      using errcode = '22023';
  end if;

  -- A change of mind is a new row referencing the previous decision.
  select ap.id into v_prior
    from public.call_report_approvals ap
   where ap.call_report_id = p_call_report_id
   order by ap.decided_at desc
   limit 1;

  insert into public.call_report_approvals
    (call_report_id, decided_by_user_id, approved, reason, supersedes_approval_id)
  values
    (p_call_report_id, v_uid, p_approved, p_reason, v_prior)
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_analysis_override(p_analysis_id uuid, p_finding_id uuid, p_reason text)
 RETURNS analysis_overrides
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid;
  v_role public.app_role;
  v_row  public.analysis_overrides%rowtype;
begin
  v_uid  := (select auth.uid());
  v_role := public.current_app_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a manager may override a finding'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason'
      using errcode = '22023',
            hint = 'A row with no reason proves a click happened, not that anybody thought.';
  end if;

  -- Scope, before anything is written.
  if not exists (
    select 1 from public.analyses a
     where a.id = p_analysis_id
       and a.mr_id in (select public.visible_user_ids())
  ) then
    raise exception 'analysis % is not within your scope', p_analysis_id
      using errcode = '42501';
  end if;

  insert into public.analysis_overrides
    (analysis_id, finding_id, overridden_by_user_id, reason)
  values
    (p_analysis_id, p_finding_id, v_uid, btrim(p_reason))
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reinstate_sync_item(p_sync_item_id uuid, p_reason text)
 RETURNS sync_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid;
  v_role public.app_role;
  v_item public.sync_items%rowtype;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may reinstate a queued item'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reinstatement requires a reason' using errcode = '22023';
  end if;

  select * into v_item
    from public.sync_items s
   where s.id = p_sync_item_id
     and s.mr_id in (select public.visible_user_ids());

  if v_item.id is null then
    raise exception 'sync item % is not in your scope', p_sync_item_id using errcode = '42501';
  end if;

  if v_item.status <> 'dead_lettered' then
    raise exception 'sync item % is %; only a dead-lettered item can be reinstated',
      p_sync_item_id, v_item.status using errcode = '22023';
  end if;

  insert into public.sync_item_reinstatements
    (sync_item_id, reinstated_by_user_id, reason, attempts_at_reinstatement)
  values (p_sync_item_id, v_uid, p_reason, v_item.attempt_count);

  update public.sync_items
     set status = 'rejected',
         attempts_forgiven = attempt_count,
         resolved_at = null
   where id = p_sync_item_id
  returning * into v_item;

  return v_item;
end;
$function$;

-- ----------------------------------------------------------------------------
-- The migration asserts its own postcondition.
-- ----------------------------------------------------------------------------
--
-- If a ninth site exists, or one of the eight above failed to replace, this fails the
-- deploy rather than leaving a boundary half-closed. It enumerates from the CATALOGUE
-- rather than from the list above, so a function this migration never heard of is still
-- caught.
--
-- `v_role = 'admin' or` is the escape's exact shape. `visible_user_ids()` and
-- `visible_territory_ids()` use `if v_role = 'admin' then`, which does not match, so the
-- two functions that are supposed to keep the branch are not false positives.
do $$
declare
  v_offenders text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_offenders
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and pg_get_functiondef(p.oid) like '%v_role = ''admin'' or%';

  if v_offenders is not null then
    raise exception
      'BE-W101: the cross-tenant admin escape is still present in: %', v_offenders
      using errcode = '42501',
            hint = 'A SECURITY DEFINER body must not short-circuit past '
                   'visible_user_ids() for an admin. See MR-42 and decisions.md C1.';
  end if;
end;
$$;
