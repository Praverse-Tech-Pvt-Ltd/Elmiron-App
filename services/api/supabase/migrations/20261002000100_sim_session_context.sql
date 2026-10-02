-- W1-R C (`BE-W136`) — the practice conversation's context comes from the SERVER, not the request.
--
-- Before this, the AI gateway took the persona brief, stance, objective, objection and the earlier
-- turns from the request body, although every one of them is already stored:
--
--   * the persona's `brief` is approved content (two admins, `BE-C7`) and `start_sim_session` never
--     returns it, so NO real client could send it — the model was briefed with whatever the client
--     typed, or with nothing;
--   * the coach scored the `turns` the client sent, so a rep could submit a conversation that never
--     happened and have its score stored where their admin reads it (`BE-C63`);
--   * an earlier "doctor" turn was the client's word (`BE-W135`'s residual).
--
-- One read, for the caller's OWN session: not yours and not existing are the same refusal (42501),
-- exactly as `record_sim_turn` refuses. An admin cannot read context through this either — it exists
-- for the gateway acting as the rep, and admins read sessions through the tables' own policies.

create or replace function public.sim_session_context(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_session  public.sim_sessions%rowtype;
  v_scenario public.sim_scenarios%rowtype;
  v_persona  public.sim_personas%rowtype;
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

  select * into v_scenario from public.sim_scenarios where id = v_session.scenario_id;
  select * into v_persona from public.sim_personas where id = v_session.persona_id;

  return jsonb_build_object(
    'sessionId', v_session.id,
    'state', v_session.state,
    'personaBrief', v_persona.brief,
    'personaStance', v_persona.stance,
    'objective', v_scenario.objective,
    'objection', v_scenario.objection,
    'turns', coalesce((
      select jsonb_agg(jsonb_build_object('turnIndex', t.turn_index, 'role', t.role, 'text', t.text)
                       order by t.turn_index)
        from public.sim_turns t
       where t.session_id = v_session.id), '[]'::jsonb));
end;
$$;

revoke all on function public.sim_session_context(uuid) from public, anon;
grant execute on function public.sim_session_context(uuid) to authenticated;
