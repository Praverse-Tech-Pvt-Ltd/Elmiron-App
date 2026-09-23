-- Rollback for MR-52 A2 -- restores read_analysis, list_analyses and list_consent_records exactly as
-- pg_get_functiondef held them before 20260923000100, and with them the defect: rows shaped with the
-- row-to-json form, so the database emits snake_case against a camelCase contract.

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


drop function if exists public.analysis_contract_row(public.analyses);
