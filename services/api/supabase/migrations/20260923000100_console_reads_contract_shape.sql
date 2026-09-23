-- ============================================================================
-- MR-52 A2 -- FE-W66: the console's reads return the contract's shape.
-- ============================================================================
--
-- `read_analysis`, `list_analyses` and `list_consent_records` shaped their rows with `to_jsonb(row)`
-- and so emitted the table's snake_case, while `AnalysisSchema` and `ConsentRecordSchema` declare
-- camelCase. Nothing noticed because nothing consumed them: every console page read the mock on
-- :4010. That is `FE-W66`, and this is the same correction BE-W100 made on the overrides read and
-- BE-W110 on the write -- the third and last of that family.
--
-- TWO COLUMNS THE CONTRACT DECLARES AND THIS SCHEMA DOES NOT HAVE, stated rather than faked:
--
--   * `findings` -- emitted as an empty array. `20260811000100` records why the table does not
--     exist: "Findings and their transcript citations arrive with the analysis engine in week 10
--     under contract I5". An empty array is the true answer today: no finding has been made. When
--     the engine lands, this select grows a join and the console renders what it returns.
--   * `transcriptId` -- emitted as null, and `AnalysisSchema` is relaxed to nullable in the same
--     change. The same migration says `transcript_id` is "not referenced here because transcripts
--     do not exist until week 8".
--
-- Inventing either would be worse than an empty one: a console that shows findings nothing
-- generated is the fabricated-override defect (BE-W56) in a new place.
--
-- The envelope -- `data`, `readAt`, `auditLogId` -- is unchanged, because tests and callers already
-- depend on it and it is the shape `list_analysis_overrides` established. Only the ROW keys change.
-- Every scope check, admin-reason rule and audit-first write below is the live definition's,
-- unchanged.
--
-- Rollback: services/api/rollbacks/20260923000100_console_reads_contract_shape.down.sql

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

  if v_role = 'admin' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'admin access to an analysis requires a reason'
      using errcode = '22023';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, table_name, row_id, reason, request_id, ip_address, occurred_at)
  values
    (v_uid, v_role, 'select', 'analyses', p_analysis_id::text, p_reason,
     public.current_request_id(), public.current_client_ip(), clock_timestamp())
  returning id into v_audit_id;

  select * into v_row
    from public.analyses a
   where a.id = p_analysis_id
     and a.mr_id in (select public.visible_user_ids());

  return jsonb_build_object(
    'data', case when v_row.id is null then null else public.analysis_contract_row(v_row) end,
    'readAt', clock_timestamp(),
    'auditLogId', v_audit_id);
end;
$function$;

-- One shaping function, so the read and the list cannot drift from each other.
CREATE OR REPLACE FUNCTION public.analysis_contract_row(p_row public.analyses)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_row.id,
    'visitId', p_row.visit_id,
    'mrId', p_row.mr_id,
    -- Not a column. See the header: transcripts arrive in week 8, the engine in week 10.
    'transcriptId', null,
    'status', p_row.status,
    'refusalReason', p_row.refusal_reason,
    'rubricVersion', p_row.rubric_version,
    'modelProvider', p_row.model_provider,
    'modelVersion', p_row.model_version,
    'findings', '[]'::jsonb,
    'mrViewedAt', p_row.mr_viewed_at,
    'mrResponse', p_row.mr_response,
    'mrRespondedAt', p_row.mr_responded_at,
    'generatedAt', p_row.generated_at,
    'createdAt', p_row.created_at);
$function$;

revoke all on function public.analysis_contract_row(public.analyses) from public, anon;
grant execute on function public.analysis_contract_row(public.analyses) to authenticated;

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

  select coalesce(jsonb_agg(public.analysis_contract_row(a) order by a.created_at desc), '[]'::jsonb)
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'visitId', c.visit_id,
           'doctorId', c.doctor_id,
           'capturedByMrId', c.captured_by_mr_id,
           'outcome', c.outcome,
           'notAskedReason', c.not_asked_reason,
           'consentTextVersionId', c.consent_text_version_id,
           'displayedLanguage', c.displayed_language,
           'supersedesConsentRecordId', c.supersedes_consent_record_id,
           'isWithdrawal', c.is_withdrawal,
           'capturedAt', c.captured_at,
           'receivedAt', c.received_at,
           'createdAt', c.created_at) order by c.captured_at desc), '[]'::jsonb)
    into v_rows
    from public.consent_records c
   where c.captured_by_mr_id in (select public.visible_user_ids())
     and (p_visit_id is null or c.visit_id = p_visit_id);

  return jsonb_build_object('data', v_rows, 'readAt', clock_timestamp(), 'auditLogId', v_audit_id);
end;
$function$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.read_analysis(uuid, text)',
    'public.list_analyses(uuid, text)',
    'public.list_consent_records(uuid, text)'
  ] loop
    if position('to_jsonb(' in pg_get_functiondef(v_fn::regprocedure)) > 0 then
      raise exception 'MR-52 A2: % still shapes rows with the row-to-json form', v_fn;
    end if;
  end loop;

  if position('capturedByMrId' in pg_get_functiondef('public.list_consent_records(uuid, text)'::regprocedure)) = 0 then
    raise exception 'MR-52 A2: list_consent_records does not emit the camelCase keys';
  end if;
  if position('rubricVersion' in pg_get_functiondef('public.analysis_contract_row(public.analyses)'::regprocedure)) = 0 then
    raise exception 'MR-52 A2: analysis_contract_row does not emit the camelCase keys';
  end if;
  -- The list and the read must shape rows through the SAME function, or they drift.
  if position('analysis_contract_row' in pg_get_functiondef('public.list_analyses(uuid, text)'::regprocedure)) = 0
     or position('analysis_contract_row' in pg_get_functiondef('public.read_analysis(uuid, text)'::regprocedure)) = 0 then
    raise exception 'MR-52 A2: the analysis read and list do not share one row shaper';
  end if;
end;
$$;
