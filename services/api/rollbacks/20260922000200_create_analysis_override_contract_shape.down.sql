-- Rollback for MR-51 B1 -- restores create_analysis_override exactly as the catalogue held it before
-- 20260922000200 (pg_get_functiondef, captured before the migration), and with it the defect: it
-- returns the table row, in snake_case, against a camelCase contract. Grants restored to what they
-- were: EXECUTE for postgres and authenticated only.

DROP FUNCTION public.create_analysis_override(uuid, uuid, text);

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

revoke all on function public.create_analysis_override(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.create_analysis_override(uuid, uuid, text) to authenticated;
