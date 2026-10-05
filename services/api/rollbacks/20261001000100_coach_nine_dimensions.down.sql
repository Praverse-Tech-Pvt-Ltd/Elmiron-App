-- Rollback for W1-M Part C -- the coach analysis returns to FIVE dimensions and no module list.
--
-- **What rolling back MEANS.** `record_sim_coach_analysis` goes back to its 8-argument W1-D form,
-- which validates five dimension scores and knows nothing about suggested modules, and
-- `sim_coach_module_candidates()` is gone. **The `suggested_modules` column is DROPPED, and with it
-- every suggestion stored since W1-M** -- the column has no meaning without the function that
-- validated it, and a column nothing writes or checks is a place for unvalidated data to land.
-- Analyses themselves stay, with their seven scores in `dimension_scores` (a jsonb object the
-- five-dimension function never reads back).
--
-- **Roll back `packages/core` and `supabase/functions/` with this.** `analyseSimSession` calls
-- `sim_coach_module_candidates()` and the 9-argument recorder; against this schema every `ai_coach`
-- request fails with "function does not exist", surfaced as the generic failure. `ai_doctor`,
-- `product_qa`, `mr_chat` and `lms_tutor` are unaffected.
--
-- The 8-argument body below is copied verbatim from 20260929000200_simulation_rpcs.sql, so this
-- rollback restores exactly what was there rather than a retyped approximation of it.

drop function if exists public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text);
drop function if exists public.sim_coach_module_candidates();
drop function if exists public.sim_coach_suggestable_modules(uuid);

alter table public.sim_coach_analyses
  drop constraint if exists sim_coach_analyses_suggested_modules_at_most_three,
  drop constraint if exists sim_coach_analyses_suggested_modules_array,
  drop column if exists suggested_modules;

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

revoke all on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text)
  from public, anon;
grant execute on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text)
  to authenticated;
