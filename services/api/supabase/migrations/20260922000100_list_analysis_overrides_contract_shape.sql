-- ============================================================================
-- MR-50 C2 -- BE-W100: list_analysis_overrides returns the contract's shape.
-- ============================================================================
--
-- The function shaped its rows with to_jsonb(o) and so emitted analysis_id, finding_id,
-- overridden_by_user_id, created_at. packages/core's AnalysisOverrideSchema -- and the mock, typed
-- to it -- declare analysisId, findingId, overriddenByUserId, createdAt. Nothing noticed because
-- nothing consumed the read (MR-38 B). It matters more now: under C8 the overrides are the
-- human-review record that SOP monitoring relies on.
--
-- Only the row-shaping expression changes. The scope check, the admin reason requirement and the
-- audit-first write are the live definition's, unchanged (from 20260917000100).

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


do $$
begin
  if position('to_jsonb(o)' in pg_get_functiondef('public.list_analysis_overrides(uuid, text)'::regprocedure)) > 0 then
    raise exception 'MR-50 C2: list_analysis_overrides still shapes rows with to_jsonb';
  end if;
  if position('overriddenByUserId' in pg_get_functiondef('public.list_analysis_overrides(uuid, text)'::regprocedure)) = 0 then
    raise exception 'MR-50 C2: list_analysis_overrides does not emit the camelCase keys';
  end if;
end;
$$;
