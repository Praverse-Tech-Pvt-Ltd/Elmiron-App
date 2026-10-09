-- `BE-W170` / `BE-C77` -- only the AUTHOR submits a draft for review; a different admin decides it.
--
-- `submit_knowledge_version`, `submit_ai_prompt_version` and `submit_sim_content` accepted ANY admin
-- of the organisation, and every approve/reject refuses the author AND the submitter -- in the RPC
-- and again in each table's four-eyes CHECK. So a draft submitted by the admin who did not write it
-- left a two-admin organisation with nobody who may decide it: a permanent `in_review`. Two admins is
-- exactly what Q-14 supplies.
--
-- The controlling rule (`BE-C77`, operator instruction 9 October 2026): AUTHOR drafts -> AUTHOR
-- submits -> a DIFFERENT admin approves or rejects. The author may not decide their own content.
--
-- What changes: the three submit functions refuse anyone but the draft's author (`42501`), and a
-- table CHECK on each of the four tables holds the same rule for every writer -- the schema's
-- two-mechanism pattern. What does NOT change: the approve/reject functions and the existing
-- four-eyes CHECKs. With submitter = author they reduce exactly to "the decider is not the author",
-- which is the rule; loosening them would be a second change for no gain.
--
-- Courses are untouched: `publish_course_version` is one step by design, and whether a course needs
-- a second admin is the open operator question Q-21.

-- ---------------------------------------------------------------------------
-- 1. The constraint, on every table that has a submit step
-- ---------------------------------------------------------------------------

alter table public.knowledge_document_versions
  add constraint knowledge_versions_author_submits
  check (submitted_by_user_id is null or submitted_by_user_id = created_by_user_id);

alter table public.ai_prompt_versions
  add constraint ai_prompt_versions_author_submits
  check (submitted_by_user_id is null or submitted_by_user_id = created_by_user_id);

alter table public.sim_personas
  add constraint sim_personas_author_submits
  check (submitted_by_user_id is null or submitted_by_user_id = created_by_user_id);

alter table public.sim_scenarios
  add constraint sim_scenarios_author_submits
  check (submitted_by_user_id is null or submitted_by_user_id = created_by_user_id);

-- ---------------------------------------------------------------------------
-- 2. The readable refusal, in each submit function
-- ---------------------------------------------------------------------------
-- `create or replace` keeps each function's grants. Each body is the previous definition with the
-- author check added after the existing admin/organisation/status checks, so every earlier refusal
-- keeps its order and its SQLSTATE.

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
  if v_version.created_by_user_id is distinct from (select auth.uid()) then
    raise exception 'only the author of knowledge version % submits it', v_version.id
      using errcode = '42501',
            hint = 'BE-C77: the author submits; a different admin approves or rejects.';
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
  if v_version.created_by_user_id is distinct from (select auth.uid()) then
    raise exception 'only the author of prompt version % submits it', v_version.id
      using errcode = '42501',
            hint = 'BE-C77: the author submits; a different admin approves or rejects.';
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
  v_author uuid;
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
    select status, created_by_user_id into v_status, v_author from public.sim_personas
     where id = p_id and organisation_id = public.current_user_organisation_id();
  else
    select status, created_by_user_id into v_status, v_author from public.sim_scenarios
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
  if v_author is distinct from v_uid then
    raise exception 'only the author of % % submits it', p_kind, p_id
      using errcode = '42501',
            hint = 'BE-C77: the author submits; a different admin approves or rejects.';
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
