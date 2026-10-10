-- Rollback for `BE-C77` (20261009000100_author_submits): any admin of the organisation may submit a
-- draft again -- which re-opens `BE-W170`. The three bodies are the definitions installed by
-- 20260924000600_knowledge, 20260924000700_ai_control_plane and 20260929000200_simulation_rpcs,
-- unchanged since. No row changes.

alter table public.knowledge_document_versions drop constraint knowledge_versions_author_submits;
alter table public.ai_prompt_versions drop constraint ai_prompt_versions_author_submits;
alter table public.sim_personas drop constraint sim_personas_author_submits;
alter table public.sim_scenarios drop constraint sim_scenarios_author_submits;

create or replace function public.submit_knowledge_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.knowledge_document_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
  v_chunks  integer;
begin
  v_version := public.knowledge_admin_version(p_version_id);
  if v_version.status <> 'draft' then
    raise exception 'knowledge version % is already %', v_version.id, v_version.status
      using errcode = '22023';
  end if;

  update public.knowledge_document_versions
     set status = 'in_review', submitted_at = v_now, submitted_by_user_id = (select auth.uid())
   where id = v_version.id;

  -- Cut AFTER the freeze, from the frozen text: what is reviewed is what will be retrieved.
  v_chunks := public.knowledge_chunk_version(v_version.id);
  if v_chunks = 0 then
    raise exception 'knowledge version % has no text to review', v_version.id using errcode = '22023';
  end if;

  return jsonb_build_object(
    'documentVersionId', v_version.id, 'status', 'in_review', 'submittedAt', v_now,
    'chunkCount', v_chunks);
end;
$$;

create or replace function public.submit_ai_prompt_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.ai_prompt_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
begin
  v_version := public.ai_admin_prompt_version(p_version_id);
  if v_version.status <> 'draft' then
    raise exception 'prompt version % is already %', v_version.id, v_version.status using errcode = '22023';
  end if;
  update public.ai_prompt_versions
     set status = 'in_review', submitted_at = v_now, submitted_by_user_id = (select auth.uid())
   where id = v_version.id;
  return jsonb_build_object('promptVersionId', v_version.id, 'status', 'in_review', 'submittedAt', v_now);
end;
$$;

create or replace function public.submit_sim_content(p_kind text, p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_now    timestamptz := clock_timestamp();
  v_status public.knowledge_version_status;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.current_app_role() <> 'admin' then
    raise exception 'only an admin may submit simulation content' using errcode = '42501';
  end if;
  if p_kind not in ('persona', 'scenario') then
    raise exception 'unknown simulation content kind %', p_kind using errcode = '22023';
  end if;

  if p_kind = 'persona' then
    select status into v_status from public.sim_personas
     where id = p_id and organisation_id = public.current_user_organisation_id();
  else
    select status into v_status from public.sim_scenarios
     where id = p_id and organisation_id = public.current_user_organisation_id();
  end if;

  -- Not found and another organisation's are DELIBERATELY the same answer. Telling an admin that a
  -- row exists but is not theirs is a cross-tenant existence oracle.
  if v_status is null then
    raise exception '% % is not yours', p_kind, p_id using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception '% % is already %', p_kind, p_id, v_status using errcode = '22023';
  end if;

  if p_kind = 'persona' then
    update public.sim_personas
       set status = 'in_review', submitted_at = v_now, submitted_by_user_id = v_uid
     where id = p_id;
  else
    update public.sim_scenarios
       set status = 'in_review', submitted_at = v_now, submitted_by_user_id = v_uid
     where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'status', 'in_review', 'submittedAt', v_now);
end;
$$;
