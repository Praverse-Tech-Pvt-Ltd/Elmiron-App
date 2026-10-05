-- W1-M Part C -- the coach analysis covers NINE things, not five. `BE-C34`, closes `BE-W127`.
--
-- **The operator's nine, against what existed** (`record_sim_coach_analysis`, 20260929000200):
--
--   | Operator's item               | Before this migration            | After                          |
--   | ----------------------------- | -------------------------------- | ------------------------------ |
--   | product knowledge             | `product_knowledge` score        | unchanged                      |
--   | scientific accuracy           | **absent**                       | `scientific_accuracy` score    |
--   | communication                 | `communication` score            | unchanged                      |
--   | opening / pitch quality       | `opening` score                  | unchanged -- the same thing    |
--   | objection handling            | `objection_handling` score       | unchanged                      |
--   | relevance of response         | **absent**                       | `response_relevance` score     |
--   | closing / follow-up           | `closing` score                  | unchanged                      |
--   | areas for improvement         | `improvements`, cited findings   | unchanged -- NOT duplicated    |
--   | suggested learning modules    | **absent**                       | `suggested_modules`, validated |
--
-- So: two new SCORES, one new LIST, and two items that already existed under another name and are
-- deliberately not built twice. "Opening/pitch" is one item in the operator's own list, and it is
-- what `opening` scores; a separate `pitch_quality` would be two numbers for one judgement.
--
-- **A suggested module that points at a course the learner cannot open is worse than none** -- it
-- sends the rep to a dead end with the system's authority behind it. So a suggestion is refused
-- unless the module is in a PUBLISHED version of an ACTIVE course in the rep's OWN organisation,
-- which is exactly the set `start_course_version` will let them enrol on. Drafts (unapproved text),
-- retired versions (closed to new learners) and other companies' courses are all refused.
--
-- **One definition of "suggestable", used twice.** The list the model is SHOWN and the check the
-- database APPLIES both read `sim_coach_suggestable_modules()`. Two copies of that predicate would be
-- two definitions, and the day they differ the model would be offered modules the table refuses.
--
-- Scores still have nothing to compare against: no team, rank, percentile or average anywhere, and
-- `sim_coach_analyses`'s read policy (the rep and their company admin, never a manager -- `C27`) is
-- unchanged, so the new column inherits it rather than needing a policy of its own.
--
-- The replacement body of `record_sim_coach_analysis` was generated from `pg_proc.prosrc` on the
-- running database, not retyped from the earlier migration.

-- ----------------------------------------------------------------------------
-- 1. The column. Existing rows get an empty list: they were analysed before modules were asked for,
--    and inventing suggestions for them after the fact would be the model's words written by a
--    migration.
-- ----------------------------------------------------------------------------

alter table public.sim_coach_analyses
  add column suggested_modules jsonb not null default '[]'::jsonb;

alter table public.sim_coach_analyses
  add constraint sim_coach_analyses_suggested_modules_array
    check (jsonb_typeof(suggested_modules) = 'array'),
  add constraint sim_coach_analyses_suggested_modules_at_most_three
    check (jsonb_array_length(suggested_modules) <= 3);

-- ----------------------------------------------------------------------------
-- 2. What may be suggested -- ONE predicate.
-- ----------------------------------------------------------------------------

/**
 * Modules a learner in `p_organisation_id` could open today: in a PUBLISHED version of an ACTIVE
 * course of that organisation. Internal -- callable only from the two security-definer functions
 * below, which pass an organisation they derived themselves, never one a caller supplied.
 */
create or replace function public.sim_coach_suggestable_modules(p_organisation_id uuid)
returns table (module_id uuid, module_title text, course_title text, module_position integer)
language sql
stable
set search_path = ''
as $$
  select m.id, m.title, c.title, m.position
    from public.course_modules m
    join public.course_versions cv on cv.id = m.course_version_id
    join public.courses c          on c.id  = cv.course_id
   where m.organisation_id = p_organisation_id
     and cv.organisation_id = p_organisation_id
     and cv.status = 'published'
     and c.is_active;
$$;

revoke all on function public.sim_coach_suggestable_modules(uuid) from public, anon, authenticated;

/**
 * The list `analyseSimSession` shows the model, for the CALLER's organisation. The organisation is
 * derived from the caller (`lms_caller()`), so there is no parameter through which to ask about
 * another company's catalogue.
 *
 * At most 50, ordered by course then module position. A company with more than 50 published
 * modules will have some that cannot be suggested; that is a bound on the prompt's length, stated
 * rather than hidden.
 */
create or replace function public.sim_coach_module_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller record;
begin
  select * into v_caller from public.lms_caller();
  return coalesce((
    select jsonb_agg(jsonb_build_object('moduleId', s.module_id,
                                        'moduleTitle', s.module_title,
                                        'courseTitle', s.course_title)
                     order by s.course_title, s.module_position)
      from (select * from public.sim_coach_suggestable_modules(v_caller.organisation_id)
             order by course_title, module_position
             limit 50) s
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. The recorder, now nine. A NEW signature, and the old one is DROPPED: leaving the 8-argument
--    overload in place would leave a way to store an analysis without the new checks.
-- ----------------------------------------------------------------------------

drop function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, text, text, text);

create or replace function public.record_sim_coach_analysis(
  p_session_id        uuid,
  p_overall_score     integer,
  p_dimension_scores  jsonb,
  p_strengths         jsonb,
  p_improvements      jsonb,
  p_suggested_modules jsonb,
  p_summary           text,
  p_model_provider    text,
  p_model_name        text
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
$$;

-- ----------------------------------------------------------------------------
-- 4. Grants. Revoke from PUBLIC first; a function is born PUBLIC-executable.
-- ----------------------------------------------------------------------------

revoke all on function public.sim_coach_module_candidates() from public, anon;
revoke all on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text)
  from public, anon;

grant execute on function public.sim_coach_module_candidates() to authenticated;
grant execute on function public.record_sim_coach_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb, text, text, text)
  to authenticated;
