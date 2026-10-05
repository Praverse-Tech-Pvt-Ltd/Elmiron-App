-- W1-D Part B -- the RPCs that reach the simulation tables. Nothing above exists without these.
--
-- Split from `20260929000100` deliberately: the tables and the behaviour over them are separable,
-- and a rollback of the behaviour should not have to drop the data.
--
-- **Every function here is `security definer` with `set search_path = ''`, and every one of them
-- decides from `auth.uid()` and `current_app_role()` rather than from an argument.** The gateway
-- calls these as the USER'S token (`C30`), so an argument a client controls can never be the thing
-- that grants access.

-- ---------------------------------------------------------------------------
-- 1. The approval path for personas and scenarios -- ONE implementation, two tables
-- ---------------------------------------------------------------------------

-- `p_kind` is 'persona' or 'scenario'. A text discriminator rather than two near-identical function
-- families, which is the `W1-D B2` requirement to reuse rather than duplicate. `BE-W121` registers
-- the larger extraction across knowledge and prompt versions.
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

create or replace function public.approve_sim_content(
  p_kind text, p_id uuid, p_attestation text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_now   timestamptz := clock_timestamp();
  v_row   record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.current_app_role() <> 'admin' then
    raise exception 'only an admin may approve simulation content' using errcode = '42501';
  end if;
  if p_kind not in ('persona', 'scenario') then
    raise exception 'unknown simulation content kind %', p_kind using errcode = '22023';
  end if;
  -- An attestation is REQUIRED, and an empty one is refused rather than stored. This row is the
  -- evidence that a human read the content; a blank one proves a click happened.
  if length(btrim(coalesce(p_attestation, ''))) = 0 then
    raise exception 'an approval requires a written attestation' using errcode = '22023';
  end if;

  if p_kind = 'persona' then
    select id, status, created_by_user_id, submitted_by_user_id into v_row
      from public.sim_personas
     where id = p_id and organisation_id = public.current_user_organisation_id();
  else
    select id, status, created_by_user_id, submitted_by_user_id into v_row
      from public.sim_scenarios
     where id = p_id and organisation_id = public.current_user_organisation_id();
  end if;

  if v_row.id is null then
    raise exception '% % is not yours', p_kind, p_id using errcode = '42501';
  end if;
  if v_row.status <> 'in_review' then
    raise exception '% % is %, not in review', p_kind, p_id, v_row.status using errcode = '22023';
  end if;
  -- FOUR EYES. The table CHECK holds the same rule, so this refusal is the readable half rather
  -- than the only half -- two independent mechanisms, which is this schema's standing pattern.
  if v_uid = v_row.created_by_user_id or v_uid = v_row.submitted_by_user_id then
    raise exception 'the author or submitter of % % cannot approve it', p_kind, p_id
      using errcode = '42501';
  end if;

  if p_kind = 'persona' then
    update public.sim_personas
       set status = 'approved', decided_at = v_now, decided_by_user_id = v_uid,
           approval_attestation = btrim(p_attestation)
     where id = p_id;
  else
    update public.sim_scenarios
       set status = 'approved', decided_at = v_now, decided_by_user_id = v_uid,
           approval_attestation = btrim(p_attestation)
     where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'status', 'approved', 'decidedAt', v_now);
end;
$$;

create or replace function public.reject_sim_content(p_kind text, p_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_row record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if public.current_app_role() <> 'admin' then
    raise exception 'only an admin may reject simulation content' using errcode = '42501';
  end if;
  if p_kind not in ('persona', 'scenario') then
    raise exception 'unknown simulation content kind %', p_kind using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a rejection requires a reason' using errcode = '22023';
  end if;

  if p_kind = 'persona' then
    select id, status, created_by_user_id, submitted_by_user_id into v_row
      from public.sim_personas
     where id = p_id and organisation_id = public.current_user_organisation_id();
  else
    select id, status, created_by_user_id, submitted_by_user_id into v_row
      from public.sim_scenarios
     where id = p_id and organisation_id = public.current_user_organisation_id();
  end if;

  if v_row.id is null then
    raise exception '% % is not yours', p_kind, p_id using errcode = '42501';
  end if;
  if v_row.status <> 'in_review' then
    raise exception '% % is %, not in review', p_kind, p_id, v_row.status using errcode = '22023';
  end if;
  if v_uid = v_row.created_by_user_id or v_uid = v_row.submitted_by_user_id then
    raise exception 'the author or submitter of % % cannot decide it', p_kind, p_id
      using errcode = '42501';
  end if;

  if p_kind = 'persona' then
    update public.sim_personas
       set status = 'rejected', decided_at = v_now, decided_by_user_id = v_uid,
           rejection_reason = btrim(p_reason)
     where id = p_id;
  else
    update public.sim_scenarios
       set status = 'rejected', decided_at = v_now, decided_by_user_id = v_uid,
           rejection_reason = btrim(p_reason)
     where id = p_id;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'status', 'rejected', 'decidedAt', v_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sessions
-- ---------------------------------------------------------------------------

/**
 * Start a practice session on an APPROVED scenario, for yourself.
 *
 * Anyone in the organisation may practise -- it is not an admin action, and `C22` puts it in scope
 * for reps. What is NOT permitted is starting one for somebody else: `mr_id` is `auth.uid()` and
 * there is no parameter for it.
 */
create or replace function public.start_sim_session(p_scenario_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org       uuid := public.current_user_organisation_id();
  v_scenario  public.sim_scenarios%rowtype;
  v_persona   public.sim_personas%rowtype;
  v_prompt    uuid;
  v_session   uuid;
  v_now       timestamptz := clock_timestamp();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_scenario from public.sim_scenarios
   where id = p_scenario_id and organisation_id = v_org;
  if not found then
    raise exception 'scenario % is not available', p_scenario_id using errcode = '42501';
  end if;
  if v_scenario.status <> 'approved' then
    raise exception 'scenario % is %, not approved', p_scenario_id, v_scenario.status
      using errcode = '22023',
            hint = 'C24: content is never used before a second admin approves it.';
  end if;

  select * into v_persona from public.sim_personas
   where id = v_scenario.persona_id and organisation_id = v_org;
  -- A scenario whose persona is not approved cannot run either. Checked rather than assumed: the
  -- two are approved separately and an admin can retire a persona under an approved scenario.
  if not found or v_persona.status <> 'approved' then
    raise exception 'the persona for scenario % is not approved', p_scenario_id
      using errcode = '22023';
  end if;

  -- The approved prompt version for ai_doctor, pinned for the session's life. Same shape as
  -- `ai_begin_request`'s lookup, and the same refusal when there is none.
  select id into v_prompt from public.ai_prompt_versions
   where organisation_id = v_org and feature = 'ai_doctor' and status = 'approved'
   order by version_number desc limit 1;
  if v_prompt is null then
    raise exception 'no approved prompt version for ai_doctor' using errcode = '45011';
  end if;

  insert into public.sim_sessions
    (organisation_id, mr_id, scenario_id, persona_id, product_id, market_id, prompt_version_id,
     started_at)
  values
    (v_org, v_uid, v_scenario.id, v_persona.id, v_scenario.product_id, v_scenario.market_id,
     v_prompt, v_now)
  returning id into v_session;

  return jsonb_build_object(
    'sessionId', v_session,
    'personaId', v_persona.id,
    'personaDisplayName', v_persona.display_name,
    'personaStance', v_persona.stance,
    'objective', v_scenario.objective,
    'objection', v_scenario.objection,
    'promptVersionId', v_prompt,
    'startedAt', v_now);
end;
$$;

/**
 * Append a rep turn and the doctor's reply, atomically.
 *
 * **Both turns in one call on purpose.** A rep turn stored without its reply would leave a
 * conversation that reads as though the doctor ignored them, and a retry would append the rep's
 * words twice. One call, one transaction, two rows, contiguous indices the server assigns.
 */
create or replace function public.record_sim_turn(
  p_session_id uuid,
  p_rep_text text,
  p_doctor_text text,
  p_ai_request_id uuid default null,
  p_knowledge_version_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.sim_sessions%rowtype;
  v_rep     integer;
  v_doctor  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if length(btrim(coalesce(p_rep_text, ''))) = 0
     or length(btrim(coalesce(p_doctor_text, ''))) = 0 then
    raise exception 'a turn needs text on both sides' using errcode = '22023';
  end if;

  select * into v_session from public.sim_sessions
   where id = p_session_id
     and organisation_id = public.current_user_organisation_id()
     and mr_id = v_uid;
  -- Not yours and not existing are the same refusal. An admin cannot add turns to a rep's session
  -- either: practice is the rep's own, and an admin writing into it would make the history false.
  if not found then
    raise exception 'session % is not yours', p_session_id using errcode = '42501';
  end if;
  if v_session.state <> 'open' then
    raise exception 'session % has ended', p_session_id using errcode = '22023';
  end if;

  v_rep    := v_session.turn_count + 1;
  v_doctor := v_session.turn_count + 2;

  insert into public.sim_turns (organisation_id, session_id, turn_index, role, text, ai_request_id)
  values (v_session.organisation_id, p_session_id, v_rep, 'rep', btrim(p_rep_text), null);
  insert into public.sim_turns (organisation_id, session_id, turn_index, role, text, ai_request_id)
  values (v_session.organisation_id, p_session_id, v_doctor, 'doctor', btrim(p_doctor_text),
          p_ai_request_id);

  update public.sim_sessions
     set turn_count = v_doctor,
         -- §7-§9 traceability: the knowledge versions the replies drew on, accumulated and
         -- de-duplicated across the session.
         knowledge_version_ids = (
           select coalesce(array_agg(distinct x), '{}')
             from unnest(knowledge_version_ids || coalesce(p_knowledge_version_ids, '{}')) x),
         updated_at = now()
   where id = p_session_id;

  return jsonb_build_object(
    'sessionId', p_session_id, 'repTurnIndex', v_rep, 'doctorTurnIndex', v_doctor,
    'turnCount', v_doctor);
end;
$$;

create or replace function public.end_sim_session(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session public.sim_sessions%rowtype;
  v_now     timestamptz := clock_timestamp();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_session from public.sim_sessions
   where id = p_session_id
     and organisation_id = public.current_user_organisation_id()
     and mr_id = v_uid;
  if not found then
    raise exception 'session % is not yours', p_session_id using errcode = '42501';
  end if;

  -- Idempotent: ending twice is the same answer, because a phone that lost its reply will retry.
  if v_session.state = 'ended' then
    return jsonb_build_object('sessionId', p_session_id, 'state', 'ended',
                              'endedAt', v_session.ended_at, 'turnCount', v_session.turn_count);
  end if;

  update public.sim_sessions
     set state = 'ended', ended_at = v_now, updated_at = now()
   where id = p_session_id;

  return jsonb_build_object('sessionId', p_session_id, 'state', 'ended', 'endedAt', v_now,
                            'turnCount', v_session.turn_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The coach analysis -- the contract, enforced in the database
-- ---------------------------------------------------------------------------

/**
 * Store one coach analysis for an ENDED session, validating the shape the contract declares.
 *
 * **Why the validation is here and not only in Zod.** `packages/core` validates what the MODEL
 * returned, inside the gateway. This validates what reaches the TABLE, which is a different
 * guarantee: a future caller that is not the gateway -- a script, a backfill, a second runtime --
 * cannot store a malformed analysis by skipping the TypeScript. §38's rule is that model output is
 * validated server-side, and the database is the last server.
 *
 * Each refusal below names what is wrong, because an analysis is discarded on any of them and a
 * generic "invalid" would make the cause unfindable.
 */
create or replace function public.record_sim_coach_analysis(
  p_session_id       uuid,
  p_overall_score    integer,
  p_dimension_scores jsonb,
  p_strengths        jsonb,
  p_improvements     jsonb,
  p_summary          text,
  p_model_provider   text,
  p_model_name       text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_session  public.sim_sessions%rowtype;
  v_analysis uuid;
  v_dim      text;
  v_finding  jsonb;
  v_score    jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_session from public.sim_sessions
   where id = p_session_id
     and organisation_id = public.current_user_organisation_id()
     and mr_id = v_uid;
  if not found then
    raise exception 'session % is not yours', p_session_id using errcode = '42501';
  end if;
  if v_session.state <> 'ended' then
    raise exception 'session % has not ended; there is nothing to analyse yet', p_session_id
      using errcode = '22023';
  end if;

  if p_overall_score is null or p_overall_score < 0 or p_overall_score > 100 then
    raise exception 'overall score must be an integer 0-100, got %', p_overall_score
      using errcode = '22023';
  end if;

  -- ALL FIVE dimensions, each 0-100. A missing dimension would otherwise read as a zero, which is
  -- a judgement the model never made.
  foreach v_dim in array array['opening', 'product_knowledge', 'objection_handling',
                               'communication', 'closing'] loop
    v_score := p_dimension_scores -> v_dim;
    if v_score is null or jsonb_typeof(v_score) <> 'number' then
      raise exception 'dimension score % is missing or not a number', v_dim using errcode = '22023';
    end if;
    if (v_score)::numeric < 0 or (v_score)::numeric > 100 then
      raise exception 'dimension score % is out of range', v_dim using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p_strengths) <> 'array' or jsonb_array_length(p_strengths) = 0
     or jsonb_typeof(p_improvements) <> 'array' or jsonb_array_length(p_improvements) = 0 then
    raise exception 'an analysis needs at least one strength and one improvement'
      using errcode = '22023';
  end if;

  -- EVERY FINDING MUST CITE A TURN THAT EXISTS IN THIS SESSION.
  --
  -- The same rule `analysis.ts` enforces for real-visit findings -- *"a finding always carries its
  -- evidence"* -- and the reason is the same: an unciteable criticism is one a rep cannot check.
  -- Validated against the session's real turns, so a model cannot cite turn 9 of a 4-turn
  -- conversation and have it stored.
  foreach v_finding in array (
    select array_agg(f) from jsonb_array_elements(p_strengths || p_improvements) f
  ) loop
    if v_finding -> 'turnIndex' is null or jsonb_typeof(v_finding -> 'turnIndex') <> 'number' then
      raise exception 'every finding must cite a turnIndex' using errcode = '22023';
    end if;
    if not exists (select 1 from public.sim_turns t
                    where t.session_id = p_session_id
                      and t.turn_index = (v_finding ->> 'turnIndex')::integer) then
      raise exception 'finding cites turn % which is not in session %',
        v_finding ->> 'turnIndex', p_session_id using errcode = '23514';
    end if;
    if v_finding -> 'dimension' is null
       or (v_finding ->> 'dimension') not in ('opening', 'product_knowledge', 'objection_handling',
                                              'communication', 'closing') then
      raise exception 'finding has an unknown dimension %', v_finding ->> 'dimension'
        using errcode = '23514';
    end if;
  end loop;

  if length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception 'an analysis needs a summary' using errcode = '22023';
  end if;

  insert into public.sim_coach_analyses
    (organisation_id, session_id, mr_id, overall_score, dimension_scores, strengths, improvements,
     summary, prompt_version_id, model_provider, model_name)
  values
    (v_session.organisation_id, p_session_id, v_session.mr_id, p_overall_score, p_dimension_scores,
     p_strengths, p_improvements, btrim(p_summary), v_session.prompt_version_id,
     p_model_provider, p_model_name)
  returning id into v_analysis;

  return jsonb_build_object('analysisId', v_analysis, 'sessionId', p_session_id,
                            'overallScore', p_overall_score);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants. Revoke from PUBLIC first; a function is born PUBLIC-executable.
-- ---------------------------------------------------------------------------

revoke all on function public.submit_sim_content(text, uuid)               from public, anon;
revoke all on function public.approve_sim_content(text, uuid, text)        from public, anon;
revoke all on function public.reject_sim_content(text, uuid, text)         from public, anon;
revoke all on function public.start_sim_session(uuid)                      from public, anon;
revoke all on function public.record_sim_turn(uuid, text, text, uuid, uuid[]) from public, anon;
revoke all on function public.end_sim_session(uuid)                        from public, anon;
revoke all on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text)
  from public, anon;

-- `authenticated` is the only Postgres role the three application roles collapse into, so the role
-- check lives in each body. Granting less would make these callable by nobody.
grant execute on function public.submit_sim_content(text, uuid)               to authenticated;
grant execute on function public.approve_sim_content(text, uuid, text)        to authenticated;
grant execute on function public.reject_sim_content(text, uuid, text)         to authenticated;
grant execute on function public.start_sim_session(uuid)                      to authenticated;
grant execute on function public.record_sim_turn(uuid, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.end_sim_session(uuid)                        to authenticated;
grant execute on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text)
  to authenticated;

-- A guard that fails the migration rather than leaving a quiet hole, in the style of
-- `20260923000400`'s self-check.
do $$
begin
  if has_function_privilege('anon', 'public.start_sim_session(uuid)', 'execute') then
    raise exception 'W1-D: start_sim_session is callable by anon';
  end if;
  if has_function_privilege('anon', 'public.record_sim_turn(uuid, text, text, uuid, uuid[])', 'execute') then
    raise exception 'W1-D: record_sim_turn is callable by anon';
  end if;
end;
$$;
