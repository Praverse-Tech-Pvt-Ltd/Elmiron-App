-- Rollback for MR-42 A2 -- BE-W101, the cross-tenant admin escape.
--
-- ****************************************************************************
-- WHAT APPLYING THIS MEANS: IT RE-OPENS THE TENANT BOUNDARY.
-- ****************************************************************************
--
-- This restores the eight bodies byte-for-byte as the catalogue held them before
-- `20260917000100_close_the_admin_escape.sql`, which means restoring
--
--     where (v_role = 'admin' or <actor column> in (select public.visible_user_ids()))
--
-- and therefore restoring the defect: an admin of ANY organisation can again read another
-- organisation's consent ledger and analyses, and can again APPROVE another organisation's
-- call reports, override its analyses and reinstate its sync items. MR-40 and MR-41 measured
-- all eight, two-sided, with positive and negative controls.
--
-- It exists because `verify:rollbacks` requires every migration to have one, and because a
-- rollback that has never run is a claim rather than a rollback (BE-W1). It is NOT an
-- operational option: `.ai-collab/decisions.md` C1 settled that `admin` is a TENANT
-- administrator and that cross-tenant access is a separate audited break-glass path, out of
-- MR v1. Applying this contradicts that decision.
--
-- The forward migration's postcondition guard is deliberately NOT reproduced here -- it would
-- fail, because its whole purpose is to refuse the state this file creates.

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
   where (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()))
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
     and (v_role = 'admin' or c.captured_by_mr_id in (select public.visible_user_ids()));

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
     and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()));

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
   where (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
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
       and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
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
     and (v_role = 'admin' or cr.mr_id in (select public.visible_user_ids()));

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
       and (v_role = 'admin' or a.mr_id in (select public.visible_user_ids()))
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
     and (v_role = 'admin' or s.mr_id in (select public.visible_user_ids()));

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
