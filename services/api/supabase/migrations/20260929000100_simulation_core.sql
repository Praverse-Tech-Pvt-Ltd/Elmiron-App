-- W1-D Part B -- AI Doctor: personas, scenarios, sessions, turns and the coach analysis.
--
-- `C22` puts practice simulation in scope; `C23` puts AI analysis of practice in scope. **None of
-- this needs `#5`.** It is built against the stub provider through the gateway `C30` approved, and
-- swapping in a real model is one file in `supabase/functions/_shared/`.
--
-- **THREE THINGS THIS SCHEMA MUST NOT TOUCH, and the absence is structural rather than promised.**
--
--   * **No real doctor.** There is no foreign key anywhere below to `public.doctors`, `visits`,
--     `consent_records` or `analyses`. A persona is authored content with a LABEL for a name.
--   * **No recording.** A turn is `text`. There is no audio column, no storage key, no upload
--     grant, and no reference to the `audio` bucket. `C21` keeps consultation recording off and
--     voice practice waits on a vendor.
--   * **No patient data.** `C25`. The gateway's existing `detectPatientSignals` refuses a turn
--     carrying it BEFORE any provider call -- the same guardrail `product_qa` uses, not a copy.
--
-- `services/api/tests/sim-core.spec.ts` asserts all three by querying the catalogue, because a
-- comment is not a control.
--
-- **On reusing the approval mechanism rather than writing a second.** `W1-D B2` requires it, and
-- what is reused is the *state machine and its meaning*: the same `knowledge_version_status` enum,
-- the same `draft -> in_review -> approved -> retired` arrows with `rejected` terminal, the same
-- four-eyes constraint expressed as a table CHECK, the same required written attestation, and the
-- same W1-A E1 rule that an insert may not claim a status. **What is NOT shared is the RPC bodies**
-- -- `submit_sim_content` below covers BOTH tables with one implementation, where knowledge has one
-- per verb per table. That is a third place the pattern appears in this schema and it should be the
-- last: extracting one generic content-approval helper across knowledge, prompt versions and
-- simulation content is registered as **`BE-W121`**, deliberately not attempted here, because doing
-- it would rewrite two working, tested subsystems in a session whose job is to add a third.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.sim_persona_stance as enum ('receptive', 'sceptical', 'rushed', 'hostile');
create type public.sim_session_state  as enum ('open', 'ended');
create type public.sim_turn_role      as enum ('rep', 'doctor');

revoke all on type public.sim_persona_stance, public.sim_session_state, public.sim_turn_role
  from public, anon;
grant usage on type public.sim_persona_stance, public.sim_session_state, public.sim_turn_role
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Personas and scenarios -- ADMIN-EDITABLE DATA, not code (D1)
-- ---------------------------------------------------------------------------

-- A scenario is addable by an admin through the console with no deployment: it is rows, and the
-- only thing standing between a draft and a rep is the four-eyes approval below.
create table public.sim_personas (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null default public.current_user_organisation_id()
                        references public.organisations (id) on delete restrict,
  -- A LABEL. "Dr A. Sharma (practice)" is right; a real doctor's name is not, and no constraint can
  -- tell the difference -- it is an authoring rule the approver enforces, stated in the review
  -- screen's caution rather than pretended to be mechanical.
  display_name          text not null,
  specialty             text not null,
  stance                public.sim_persona_stance not null,
  -- The authored brief the model is given. Frozen on submit, exactly as a knowledge version's body.
  brief                 text not null,
  status                public.knowledge_version_status not null default 'draft',
  authorship            public.knowledge_authorship not null default 'human',
  authoring_model       text,
  created_by_user_id    uuid not null references public.user_profiles (id) on delete restrict,
  submitted_at          timestamptz,
  submitted_by_user_id  uuid references public.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  decided_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  approval_attestation  text,
  rejection_reason      text,
  retired_at            timestamptz,
  retired_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sim_personas_name_present    check (length(btrim(display_name)) > 0),
  constraint sim_personas_brief_present   check (length(btrim(brief)) > 0),
  -- W1-A E1's rule, extended: a model-drafted persona must name its model.
  constraint sim_personas_authorship_names_its_model
    check ((authorship = 'ai_generated' and length(btrim(coalesce(authoring_model, ''))) > 0)
           or (authorship = 'human' and authoring_model is null)),
  constraint sim_personas_submitted_is_stamped
    check (status = 'draft' or (submitted_at is not null and submitted_by_user_id is not null)),
  constraint sim_personas_approval_is_attested
    check (status not in ('approved', 'retired') or length(btrim(approval_attestation)) > 0),
  constraint sim_personas_rejection_has_reason
    check (status <> 'rejected' or length(btrim(rejection_reason)) > 0),
  -- FOUR EYES, as a table constraint so no RPC can be the only thing holding it.
  constraint sim_personas_four_eyes
    check (decided_by_user_id is null
           or (decided_by_user_id <> created_by_user_id
               and decided_by_user_id is distinct from submitted_by_user_id))
);

create table public.sim_scenarios (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null default public.current_user_organisation_id()
                        references public.organisations (id) on delete restrict,
  persona_id            uuid not null references public.sim_personas (id) on delete restrict,
  title                 text not null,
  objective             text not null,
  objection             text not null,
  product_id            uuid references public.products (id) on delete restrict,
  market_id             uuid references public.markets (id) on delete restrict,
  status                public.knowledge_version_status not null default 'draft',
  authorship            public.knowledge_authorship not null default 'human',
  authoring_model       text,
  created_by_user_id    uuid not null references public.user_profiles (id) on delete restrict,
  submitted_at          timestamptz,
  submitted_by_user_id  uuid references public.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  decided_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  approval_attestation  text,
  rejection_reason      text,
  retired_at            timestamptz,
  retired_by_user_id    uuid references public.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sim_scenarios_title_present     check (length(btrim(title)) > 0),
  constraint sim_scenarios_objective_present check (length(btrim(objective)) > 0),
  constraint sim_scenarios_objection_present check (length(btrim(objection)) > 0),
  -- §47, the same rule approved knowledge carries: content about a product must name its market.
  -- One country's promotional or regulatory content never applies everywhere.
  constraint sim_scenarios_product_names_market
    check (product_id is null or market_id is not null),
  constraint sim_scenarios_authorship_names_its_model
    check ((authorship = 'ai_generated' and length(btrim(coalesce(authoring_model, ''))) > 0)
           or (authorship = 'human' and authoring_model is null)),
  constraint sim_scenarios_submitted_is_stamped
    check (status = 'draft' or (submitted_at is not null and submitted_by_user_id is not null)),
  constraint sim_scenarios_approval_is_attested
    check (status not in ('approved', 'retired') or length(btrim(approval_attestation)) > 0),
  constraint sim_scenarios_rejection_has_reason
    check (status <> 'rejected' or length(btrim(rejection_reason)) > 0),
  constraint sim_scenarios_four_eyes
    check (decided_by_user_id is null
           or (decided_by_user_id <> created_by_user_id
               and decided_by_user_id is distinct from submitted_by_user_id))
);

create index sim_scenarios_persona_idx on public.sim_scenarios (organisation_id, status, persona_id);

-- ---------------------------------------------------------------------------
-- 3. Sessions and turns (D2)
-- ---------------------------------------------------------------------------

create table public.sim_sessions (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null default public.current_user_organisation_id()
                         references public.organisations (id) on delete restrict,
  -- The rep. A session belongs to one person and is never reassigned.
  mr_id                  uuid not null references public.user_profiles (id) on delete restrict,
  scenario_id            uuid not null references public.sim_scenarios (id) on delete restrict,
  persona_id             uuid not null references public.sim_personas (id) on delete restrict,
  product_id             uuid references public.products (id) on delete restrict,
  market_id              uuid references public.markets (id) on delete restrict,
  -- Pinned for the session's whole life. A prompt approved mid-session must not change the doctor
  -- the rep is halfway through talking to -- the same reason a learner keeps their course version.
  prompt_version_id      uuid not null references public.ai_prompt_versions (id) on delete restrict,
  knowledge_version_ids  uuid[] not null default '{}',
  state                  public.sim_session_state not null default 'open',
  started_at             timestamptz not null default now(),
  ended_at               timestamptz,
  turn_count             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint sim_sessions_ended_is_stamped
    check (state = 'open' or ended_at is not null),
  constraint sim_sessions_turn_count_sane check (turn_count >= 0)
);

create index sim_sessions_mine_idx on public.sim_sessions (organisation_id, mr_id, started_at desc);

create table public.sim_turns (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  session_id       uuid not null references public.sim_sessions (id) on delete cascade,
  -- 1-based, contiguous, SERVER-ASSIGNED. A client cannot choose where its turn lands, so it cannot
  -- rewrite history by re-sending index 1.
  turn_index       integer not null,
  role             public.sim_turn_role not null,
  text             text not null,
  ai_request_id    uuid references public.ai_requests (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint sim_turns_text_present check (length(btrim(text)) > 0),
  constraint sim_turns_index_positive check (turn_index > 0),
  constraint sim_turns_index_once unique (session_id, turn_index)
);

-- ---------------------------------------------------------------------------
-- 4. The coach analysis (D4)
-- ---------------------------------------------------------------------------

-- **Scores live here and NOT on `public.analyses`, and the distinction is the whole rule.**
-- `constraints.md`: *"Never add a ranking, score, rank, percentile or grade to `analyses` or the
-- manager surface."* `analyses` holds analyses of REAL doctor visits, which is employee monitoring
-- (`C8`). This holds a practice session the rep chose to run against a synthetic persona, and `C27`
-- rules those scores visible to THE MR AND THE COMPANY ADMIN AND NOBODY ELSE.
--
-- **There is deliberately no team, cohort, percentile, rank or comparison column.** A score with
-- nothing to compare against cannot become a leaderboard by someone writing a `GROUP BY`.
create table public.sim_coach_analyses (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  session_id         uuid not null references public.sim_sessions (id) on delete cascade,
  -- Denormalised so RLS can scope to the rep without joining, and so a session delete cannot orphan
  -- the ownership fact before the cascade runs.
  mr_id              uuid not null references public.user_profiles (id) on delete restrict,
  overall_score      integer not null,
  dimension_scores   jsonb not null,
  strengths          jsonb not null,
  improvements       jsonb not null,
  summary            text not null,
  prompt_version_id  uuid not null references public.ai_prompt_versions (id) on delete restrict,
  model_provider     text not null,
  model_name         text not null,
  created_at         timestamptz not null default now(),
  -- One per session. A second analysis would leave two scores and no rule for which is current.
  constraint sim_coach_analyses_once unique (session_id),
  constraint sim_coach_analyses_score_range check (overall_score between 0 and 100),
  constraint sim_coach_analyses_summary_present check (length(btrim(summary)) > 0),
  constraint sim_coach_analyses_findings_are_arrays
    check (jsonb_typeof(strengths) = 'array' and jsonb_typeof(improvements) = 'array'),
  -- At least one of each: an analysis that only criticises, or only praises, is not feedback.
  constraint sim_coach_analyses_findings_present
    check (jsonb_array_length(strengths) > 0 and jsonb_array_length(improvements) > 0),
  constraint sim_coach_analyses_dimensions_object
    check (jsonb_typeof(dimension_scores) = 'object')
);

-- ---------------------------------------------------------------------------
-- 5. Revoke first, then grant. Supabase hands anon/authenticated TRUNCATE by default, and
--    TRUNCATE ignores RLS entirely.
-- ---------------------------------------------------------------------------

revoke all on table public.sim_personas, public.sim_scenarios, public.sim_sessions,
                    public.sim_turns, public.sim_coach_analyses
  from anon, authenticated, service_role;

-- Admins author personas and scenarios directly (insert/update as drafts); everyone reads approved
-- ones. State changes go through the RPCs, and the direct UPDATE path is withdrawn for the columns
-- that carry a decision -- see the before-update triggers.
grant select, insert, update on table public.sim_personas  to authenticated;
grant select, insert, update on table public.sim_scenarios to authenticated;
-- Sessions, turns and analyses are written ONLY by their RPCs. No direct insert.
grant select on table public.sim_sessions, public.sim_turns, public.sim_coach_analyses
  to authenticated;

alter table public.sim_personas       enable row level security;
alter table public.sim_scenarios      enable row level security;
alter table public.sim_sessions       enable row level security;
alter table public.sim_turns          enable row level security;
alter table public.sim_coach_analyses enable row level security;

alter table public.sim_personas       force row level security;
alter table public.sim_scenarios      force row level security;
alter table public.sim_sessions       force row level security;
alter table public.sim_turns          force row level security;
alter table public.sim_coach_analyses force row level security;

-- Personas and scenarios: approved ones are readable by the whole organisation; every status is
-- readable by an admin, who needs to see drafts to review them.
create policy sim_personas_read on public.sim_personas for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (status = 'approved' or public.is_admin()));
create policy sim_personas_author on public.sim_personas for insert to authenticated
  with check (organisation_id = public.current_user_organisation_id() and public.is_admin());
create policy sim_personas_edit on public.sim_personas for update to authenticated
  using (organisation_id = public.current_user_organisation_id() and public.is_admin())
  with check (organisation_id = public.current_user_organisation_id() and public.is_admin());

create policy sim_scenarios_read on public.sim_scenarios for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (status = 'approved' or public.is_admin()));
create policy sim_scenarios_author on public.sim_scenarios for insert to authenticated
  with check (organisation_id = public.current_user_organisation_id() and public.is_admin());
create policy sim_scenarios_edit on public.sim_scenarios for update to authenticated
  using (organisation_id = public.current_user_organisation_id() and public.is_admin())
  with check (organisation_id = public.current_user_organisation_id() and public.is_admin());

-- **`C27` IS ENFORCED HERE, AND NOWHERE ELSE WOULD DO.** A session, its turns and its coach
-- analysis are readable by the rep who owns it and by an admin. **A field manager is NOT included**,
-- and that is the whole of the no-manager-surface rule: `visible_user_ids()` -- the helper every
-- manager read uses -- is deliberately absent from these predicates.
create policy sim_sessions_read on public.sim_sessions for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (mr_id = (select auth.uid()) or public.is_admin()));

create policy sim_turns_read on public.sim_turns for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and exists (select 1 from public.sim_sessions s
                      where s.id = session_id
                        and (s.mr_id = (select auth.uid()) or public.is_admin())));

create policy sim_coach_analyses_read on public.sim_coach_analyses for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (mr_id = (select auth.uid()) or public.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. Triggers -- tenancy, the never-born-approved rule, immutability, audit
-- ---------------------------------------------------------------------------

/**
 * Personas and scenarios, BEFORE INSERT: born a draft, authored by the caller.
 *
 * REFUSES rather than coerces, which is W1-A E1's correction applied from the start here instead of
 * being retrofitted: an insert claiming a status, or setting a lifecycle column, is asking to skip
 * the approver and is told so.
 */
create or replace function public.sim_content_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception '% cannot be created as %; every version is born a draft', tg_table_name, new.status
      using errcode = '23514',
            hint = 'C24: content is never born approved. Insert a draft, then submit it and have a '
                   'SECOND admin approve it through approve_sim_content.';
  end if;
  if new.submitted_at is not null or new.submitted_by_user_id is not null
     or new.decided_at is not null or new.decided_by_user_id is not null
     or new.approval_attestation is not null or new.rejection_reason is not null
     or new.retired_at is not null or new.retired_by_user_id is not null then
    raise exception '%: the review and approval columns are set by the RPCs, never on insert',
      tg_table_name using errcode = '23514';
  end if;
  new.created_by_user_id := coalesce((select auth.uid()), new.created_by_user_id);
  return new;
end;
$$;

create trigger sim_personas_before_insert before insert on public.sim_personas
  for each row execute function public.sim_content_before_insert();
create trigger sim_scenarios_before_insert before insert on public.sim_scenarios
  for each row execute function public.sim_content_before_insert();

/**
 * Personas and scenarios, BEFORE UPDATE: only a draft's content changes, and the lifecycle columns
 * move only through the RPCs.
 *
 * The status arrows are checked here so the table cannot be walked to `approved` by a direct update
 * that satisfies every CHECK. **This does NOT close the BYPASSRLS route** -- `BE-W115` is open and
 * `BE-C1` ruled that detection, not a session flag, is the answer. What it does close is the cheap
 * route: a signed-in admin with the table's UPDATE grant.
 */
create or replace function public.sim_content_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The columns the lifecycle owns. Everything else is authored content.
  v_lifecycle text[] := array[
    'status', 'submitted_at', 'submitted_by_user_id', 'decided_at', 'decided_by_user_id',
    'approval_attestation', 'rejection_reason', 'retired_at', 'retired_by_user_id', 'updated_at'
  ];
  v_old jsonb := to_jsonb(old) - v_lifecycle;
  v_new jsonb := to_jsonb(new) - v_lifecycle;
begin
  -- The status arrows. Checked here so the table cannot be walked to `approved` by a direct update
  -- that happens to satisfy every CHECK constraint.
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'in_review')
       or (old.status = 'in_review' and new.status in ('approved', 'rejected'))
       or (old.status = 'approved' and new.status = 'retired')) then
    raise exception '% % cannot go from % to %', tg_table_name, old.id, old.status, new.status
      using errcode = '23514';
  end if;

  -- CONTENT IS FROZEN once it leaves draft: what was reviewed is what is used. Compared through
  -- jsonb minus the lifecycle keys so ONE function serves both tables -- naming columns here would
  -- make this table-specific and it is attached to two.
  if old.status <> 'draft' and v_new is distinct from v_old then
    raise exception '% % is % and its content is frozen', tg_table_name, old.id, old.status
      using errcode = '23514',
            hint = 'What was reviewed is what is used. Create a new draft instead.';
  end if;

  -- Terminal states change in no way at all.
  if old.status in ('rejected', 'retired')
     and to_jsonb(new) - array['updated_at'] is distinct from to_jsonb(old) - array['updated_at'] then
    raise exception '% % is % and cannot be changed', tg_table_name, old.id, old.status
      using errcode = '23001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger sim_personas_before_update before update on public.sim_personas
  for each row execute function public.sim_content_before_update();
create trigger sim_scenarios_before_update before update on public.sim_scenarios
  for each row execute function public.sim_content_before_update();

-- Turns and analyses are append-only: a rep's practice history is not editable, and neither is the
-- feedback on it. Statement-level, because a row-level trigger does not fire for a zero-row UPDATE
-- and that reads as success (`constraints.md`, BE-W2).
create trigger sim_turns_reject_mutation
  before update or delete on public.sim_turns
  for each statement execute function public.reject_mutation();
create trigger sim_coach_analyses_reject_mutation
  before update or delete on public.sim_coach_analyses
  for each statement execute function public.reject_mutation();

create trigger sim_personas_audit  after insert or update on public.sim_personas
  for each row execute function public.write_audit_row();
create trigger sim_scenarios_audit after insert or update on public.sim_scenarios
  for each row execute function public.write_audit_row();
create trigger sim_sessions_audit  after insert or update on public.sim_sessions
  for each row execute function public.write_audit_row();
-- Turns are NOT audited per row, and that is C17's reasoning: a turn is already immutable and
-- belongs to an audited session, and one audit row per conversational turn would bury the
-- transitions that matter under the conversation itself.
create trigger sim_coach_analyses_audit after insert on public.sim_coach_analyses
  for each row execute function public.write_audit_row();
