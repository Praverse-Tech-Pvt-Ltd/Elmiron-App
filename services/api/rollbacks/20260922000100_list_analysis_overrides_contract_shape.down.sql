-- Rollback for MR-50 C2 -- restores list_analysis_overrides byte-for-byte as the catalogue held it
-- before 20260922000100, and with it the defect: rows in snake_case against a camelCase contract.

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
