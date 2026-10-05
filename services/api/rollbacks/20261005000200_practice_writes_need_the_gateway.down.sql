-- Rollback for W1-Z A: the practice writers go back to being callable by the rep (`authenticated`) —
-- which re-opens `BE-W144`. Bodies are the definitions installed before 20261005000200_practice_writes_need_the_gateway, captured with
-- pg_get_functiondef. No row changes.

drop function public.record_sim_turn(uuid, text, text, uuid, uuid[]);
drop function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.record_sim_turn(p_session_id uuid, p_rep_text text, p_doctor_text text, p_ai_request_id uuid DEFAULT NULL::uuid, p_knowledge_version_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_sim_coach_analysis(p_session_id uuid, p_overall_score integer, p_dimension_scores jsonb, p_strengths jsonb, p_improvements jsonb, p_suggested_modules jsonb, p_summary text, p_model_provider text, p_model_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_session  public.sim_sessions%rowtype;
  v_analysis uuid;
  v_dim      text;
  v_finding  jsonb;
  v_score    jsonb;
  v_module   jsonb;
  -- THE SEVEN SCORED DIMENSIONS, in one place. Before W1-M this list was written out twice in this
  -- body, once for scores and once for findings; now both read it.
  v_dims     text[] := array['opening', 'product_knowledge', 'scientific_accuracy',
                             'objection_handling', 'response_relevance', 'communication',
                             'closing'];
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

  -- ALL SEVEN dimensions, each 0-100. A missing dimension would otherwise read as a zero, which is
  -- a judgement the model never made.
  foreach v_dim in array v_dims loop
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
    if v_finding -> 'dimension' is null or not ((v_finding ->> 'dimension') = any (v_dims)) then
      raise exception 'finding has an unknown dimension %', v_finding ->> 'dimension'
        using errcode = '23514';
    end if;
  end loop;

  -- SUGGESTED LEARNING MODULES -- `BE-C34`'s ninth item. An array of at most three; EMPTY is valid
  -- and honest when nothing published fits, and the alternative -- requiring one -- would force a
  -- model to suggest something irrelevant whenever the catalogue is thin.
  --
  -- Each must name a module the rep could open TODAY (see `sim_coach_suggestable_modules`), say
  -- which dimension it addresses, and say why. A suggestion with no reason is a link, not advice.
  if p_suggested_modules is null or jsonb_typeof(p_suggested_modules) <> 'array' then
    raise exception 'suggested modules must be an array (empty when nothing fits)'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_suggested_modules) > 3 then
    raise exception 'at most three suggested modules, got %', jsonb_array_length(p_suggested_modules)
      using errcode = '22023';
  end if;
  if (select count(distinct m ->> 'moduleId') from jsonb_array_elements(p_suggested_modules) m)
     <> jsonb_array_length(p_suggested_modules) then
    raise exception 'a module is suggested more than once' using errcode = '23514';
  end if;
  foreach v_module in array (
    select coalesce(array_agg(m), '{}') from jsonb_array_elements(p_suggested_modules) m
  ) loop
    if jsonb_typeof(v_module -> 'moduleId') is distinct from 'string'
       or (v_module ->> 'moduleId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'every suggested module needs a moduleId' using errcode = '22023';
    end if;
    if jsonb_typeof(v_module -> 'reason') is distinct from 'string'
       or length(btrim(v_module ->> 'reason')) = 0 then
      raise exception 'suggested module % has no reason', v_module ->> 'moduleId'
        using errcode = '22023';
    end if;
    if v_module -> 'dimension' is null or not ((v_module ->> 'dimension') = any (v_dims)) then
      raise exception 'suggested module % names an unknown dimension %',
        v_module ->> 'moduleId', v_module ->> 'dimension' using errcode = '23514';
    end if;
    if not exists (select 1
                     from public.sim_coach_suggestable_modules(v_session.organisation_id) s
                    where s.module_id = (v_module ->> 'moduleId')::uuid) then
      raise exception 'suggested module % is not a published module in your organisation',
        v_module ->> 'moduleId' using errcode = '23514';
    end if;
  end loop;

  if length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception 'an analysis needs a summary' using errcode = '22023';
  end if;

  insert into public.sim_coach_analyses
    (organisation_id, session_id, mr_id, overall_score, dimension_scores, strengths, improvements,
     suggested_modules, summary, prompt_version_id, model_provider, model_name)
  values
    (v_session.organisation_id, p_session_id, v_session.mr_id, p_overall_score, p_dimension_scores,
     p_strengths, p_improvements, p_suggested_modules, btrim(p_summary),
     v_session.prompt_version_id, p_model_provider, p_model_name)
  returning id into v_analysis;

  return jsonb_build_object('analysisId', v_analysis, 'sessionId', p_session_id,
                            'overallScore', p_overall_score);
end;
$function$;

revoke all on function public.record_sim_turn(uuid, text, text, uuid, uuid[]) from public, anon;
revoke all on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text)
  from public, anon;
grant execute on function public.record_sim_turn(uuid, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text)
  to authenticated;
