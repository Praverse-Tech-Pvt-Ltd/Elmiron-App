-- ============================================================================
-- MR-51 B1 -- BE-W110: create_analysis_override returns the contract's shape.
-- ============================================================================
--
-- The function returned the table row type, so PostgREST answered with analysis_id, finding_id,
-- overridden_by_user_id, created_at. packages/core's AnalysisOverrideSchema -- which the client
-- parses the answer with -- declares analysisId, findingId, overriddenByUserId, createdAt. The same
-- defect BE-W100 fixed on the read (20260922000100), here on the write. Under C8 these rows are the
-- human-review record SOP monitoring relies on.
--
-- A return type cannot change under CREATE OR REPLACE, so the function is dropped and recreated in
-- one transaction, and its grants are restored exactly as the catalogue held them: EXECUTE for
-- postgres and authenticated, nobody else. Nothing in the database calls it (checked in pg_proc
-- before writing this), so the drop cascades to nothing.
--
-- Only the return shape changes. The role check, the reason requirement and the scope check are the
-- live definition's, unchanged (from 20260917000100).

DROP FUNCTION public.create_analysis_override(uuid, uuid, text);

CREATE FUNCTION public.create_analysis_override(p_analysis_id uuid, p_finding_id uuid, p_reason text)
 RETURNS jsonb
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

  -- MR-51 B1 / BE-W110. The contract's keys, built explicitly -- the same form as the read.
  return jsonb_build_object(
    'id', v_row.id,
    'analysisId', v_row.analysis_id,
    'findingId', v_row.finding_id,
    'overriddenByUserId', v_row.overridden_by_user_id,
    'reason', v_row.reason,
    'createdAt', v_row.created_at);
end;
$function$;

revoke all on function public.create_analysis_override(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.create_analysis_override(uuid, uuid, text) to authenticated;

do $$
declare
  v_fn regprocedure := 'public.create_analysis_override(uuid, uuid, text)'::regprocedure;
begin
  if (select prorettype from pg_proc where oid = v_fn) <> 'jsonb'::regtype then
    raise exception 'MR-51 B1: create_analysis_override does not return jsonb';
  end if;
  if position('overriddenByUserId' in pg_get_functiondef(v_fn)) = 0 then
    raise exception 'MR-51 B1: create_analysis_override does not emit the camelCase keys';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'MR-51 B1: create_analysis_override lost SECURITY DEFINER';
  end if;
  if (select proacl::text from pg_proc where oid = v_fn)
       <> '{postgres=X/postgres,authenticated=X/postgres}' then
    raise exception 'MR-51 B1: create_analysis_override grants are not the ones it had: %',
      (select proacl::text from pg_proc where oid = v_fn);
  end if;
end;
$$;
