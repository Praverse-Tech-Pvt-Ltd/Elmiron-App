-- ============================================================================
-- BE-W2 · Commercial schema
--
-- Commercial data only. No patient data, no clinical data, no placeholder for
-- either. `doctors` holds professional information: name, registration number,
-- specialty, qualification, clinic addresses, territory, assigned MR. It holds no
-- prescribing volume, no patient count, and nothing that profiles the doctor.
--
-- Policies and grants are NOT here. They live in 20260811000400_rls_policies.sql
-- so the entire security boundary can be read as one document.
--
-- Rollback: services/api/rollbacks/20260811000100_commercial_schema.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FORCE ROW LEVEL SECURITY, retrofitted onto the BE-W1 tables
-- ----------------------------------------------------------------------------

-- Correcting a BE-W1 decision. BE-W1 omitted FORCE on the reasoning that it would
-- subject the SECURITY DEFINER helpers (owned by postgres) to their own policies
-- and break them. Measured, and that reasoning was wrong: `postgres` in Supabase is
-- not a superuser but does hold the BYPASSRLS attribute, and BYPASSRLS wins over
-- FORCE. The helpers are unaffected.
--
-- The same measurement shows what FORCE does NOT buy, which matters more:
--
--   * with FORCE on, `postgres` still reads every row  (BYPASSRLS)
--   * with FORCE on, `service_role` still reads every row  (BYPASSRLS)
--
-- So FORCE closes the owner-bypass vector only for an owner without BYPASSRLS.
-- It is worth having — ownership can move, and it costs nothing — but nothing in
-- this schema may rely on it to stop `service_role`. Immutability and append-only
-- are enforced by TRIGGERS, which BYPASSRLS does not skip. See the consent ledger
-- and audit log migrations.

alter table public.territories   force row level security;
alter table public.user_profiles force row level security;

-- ----------------------------------------------------------------------------
-- 2. Carried task 1 — make a territory cycle unrepresentable
-- ----------------------------------------------------------------------------

-- docs/amendment-gate0-criterion.md, task 1. The CYCLE clause in
-- visible_territory_ids makes the read safe; it does not stop a cycle being
-- written. Only service_role can write territories today, but the admin write APIs
-- land in week 11 and nobody will remember this by then.
create or replace function public.reject_territory_cycle()
returns trigger
language plpgsql
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_ancestor uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'territory % cannot be its own parent', new.id
      using errcode = 'check_violation';
  end if;

  -- Walk up from the proposed parent. If we reach the row being written, the edge
  -- would close a cycle.
  for v_ancestor in
    with recursive ancestors as (
      select t.id, t.parent_id from public.territories t where t.id = new.parent_id
      union all
      select p.id, p.parent_id
        from public.territories p
        join ancestors a on p.id = a.parent_id
    ) cycle id set is_cycle using path
    select ancestors.id from ancestors where not ancestors.is_cycle
  loop
    if v_ancestor = new.id then
      raise exception 'territory % cannot be a descendant of itself (parent %)',
        new.id, new.parent_id
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

create trigger territories_reject_cycle
  before insert or update of parent_id on public.territories
  for each row execute function public.reject_territory_cycle();

-- ----------------------------------------------------------------------------
-- 3. Carried task 3 — reporting_manager_id constraints
-- ----------------------------------------------------------------------------

-- docs/amendment-gate0-criterion.md, task 3. Nothing required the referenced user
-- to be a manager, and nothing stopped a cycle in the management chain. Both are
-- the same class of defect as the territory cycle, at lower stakes.
--
-- A trigger rather than a CHECK constraint: a CHECK cannot reference another row.
create or replace function public.validate_reporting_manager()
returns trigger
language plpgsql
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_manager_role public.app_role;
  v_cursor       uuid;
  v_hops         integer := 0;
begin
  if new.reporting_manager_id is null then
    return new;
  end if;

  if new.reporting_manager_id = new.id then
    raise exception 'user % cannot report to themselves', new.id
      using errcode = 'check_violation';
  end if;

  select p.role into v_manager_role
    from public.user_profiles p
   where p.id = new.reporting_manager_id;

  if v_manager_role is null then
    raise exception 'reporting manager % has no profile', new.reporting_manager_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_manager_role = 'mr' then
    raise exception 'reporting manager % is an mr; only field_manager or admin may manage',
      new.reporting_manager_id
      using errcode = 'check_violation';
  end if;

  -- Walk the chain upwards looking for the row being written.
  v_cursor := new.reporting_manager_id;
  while v_cursor is not null and v_hops < 64 loop
    if v_cursor = new.id then
      raise exception 'reporting chain for % contains a cycle', new.id
        using errcode = 'check_violation';
    end if;
    select p.reporting_manager_id into v_cursor
      from public.user_profiles p
     where p.id = v_cursor;
    v_hops := v_hops + 1;
  end loop;

  if v_hops >= 64 then
    raise exception 'reporting chain for % is longer than 64 hops; refusing', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger user_profiles_validate_reporting_manager
  before insert or update of reporting_manager_id on public.user_profiles
  for each row execute function public.validate_reporting_manager();

-- ----------------------------------------------------------------------------
-- 4. Enums
-- ----------------------------------------------------------------------------

create type public.beat_plan_status         as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.visit_status             as enum ('planned', 'in_progress', 'completed', 'cancelled');
create type public.geofence_status          as enum ('inside', 'outside', 'unavailable');
create type public.capture_source           as enum ('automatic', 'manual');
create type public.call_report_status       as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.call_report_draft_source as enum ('manual', 'voice_note');
create type public.sample_or_input_kind     as enum ('sample', 'input');
create type public.analysis_status          as enum ('pending', 'completed', 'failed', 'refused');

-- ----------------------------------------------------------------------------
-- 5. Organisations
-- ----------------------------------------------------------------------------

create table public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

-- NOT NULL with no backfill. `territories` is empty in every environment: only
-- service_role can write it and nothing has. If this migration fails here, the
-- table has rows it should not, and failing loudly is the right outcome.
alter table public.territories
  add column organisation_id uuid not null references public.organisations (id) on delete restrict;

create index territories_organisation_id_idx on public.territories (organisation_id);

-- ----------------------------------------------------------------------------
-- 6. Doctors and clinic addresses
-- ----------------------------------------------------------------------------

create table public.doctors (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  full_name           text not null check (length(btrim(full_name)) > 0),
  registration_number text,
  specialty           text,
  qualification       text,
  territory_id        uuid not null references public.territories (id) on delete restrict,
  assigned_mr_id      uuid references public.user_profiles (id) on delete set null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index doctors_territory_id_idx   on public.doctors (territory_id);
create index doctors_assigned_mr_id_idx on public.doctors (assigned_mr_id);

create trigger doctors_set_updated_at
  before update on public.doctors
  for each row execute function public.set_updated_at();

comment on table public.doctors is
  'Professional data only. No prescribing volumes, no patient counts, nothing that '
  'scores or profiles the doctor. Adding such a column is a UCPMP Cl.8 problem, not '
  'a schema decision.';

create table public.clinic_addresses (
  id                     uuid primary key default gen_random_uuid(),
  doctor_id              uuid not null references public.doctors (id) on delete cascade,
  label                  text not null check (length(btrim(label)) > 0),
  line1                  text not null check (length(btrim(line1)) > 0),
  line2                  text,
  city                   text not null,
  state                  text not null,
  postal_code            text not null,
  latitude               double precision check (latitude between -90 and 90),
  longitude              double precision check (longitude between -180 and 180),
  geofence_radius_metres integer not null default 150 check (geofence_radius_metres > 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index clinic_addresses_doctor_id_idx on public.clinic_addresses (doctor_id);

create trigger clinic_addresses_set_updated_at
  before update on public.clinic_addresses
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Beat plans
-- ----------------------------------------------------------------------------

create table public.beat_plans (
  id                  uuid primary key default gen_random_uuid(),
  mr_id               uuid not null references public.user_profiles (id) on delete restrict,
  territory_id        uuid not null references public.territories (id) on delete restrict,
  plan_date           date not null,
  status              public.beat_plan_status not null default 'draft',
  approved_by_user_id uuid references public.user_profiles (id) on delete set null,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint beat_plans_one_per_mr_per_day unique (mr_id, plan_date)
);

create index beat_plans_mr_id_idx on public.beat_plans (mr_id, plan_date);

create trigger beat_plans_set_updated_at
  before update on public.beat_plans
  for each row execute function public.set_updated_at();

create table public.beat_plan_entries (
  id               uuid primary key default gen_random_uuid(),
  beat_plan_id     uuid not null references public.beat_plans (id) on delete cascade,
  doctor_id        uuid not null references public.doctors (id) on delete restrict,
  clinic_address_id uuid references public.clinic_addresses (id) on delete set null,
  planned_sequence integer not null check (planned_sequence >= 0),
  constraint beat_plan_entries_unique_doctor unique (beat_plan_id, doctor_id)
);

create index beat_plan_entries_beat_plan_id_idx on public.beat_plan_entries (beat_plan_id);

-- ----------------------------------------------------------------------------
-- 8. Visits
-- ----------------------------------------------------------------------------

create table public.visits (
  -- Device-generated on the client so the offline queue is idempotent.
  id                uuid primary key,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  doctor_id         uuid not null references public.doctors (id) on delete restrict,
  beat_plan_id      uuid references public.beat_plans (id) on delete set null,
  clinic_address_id uuid references public.clinic_addresses (id) on delete set null,
  status            public.visit_status not null default 'planned',
  scheduled_for     timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint visits_completed_after_started
    check (completed_at is null or started_at is null or completed_at >= started_at)
);

create index visits_mr_id_idx     on public.visits (mr_id, created_at desc);
create index visits_doctor_id_idx on public.visits (doctor_id);

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. Check-ins and check-outs
-- ----------------------------------------------------------------------------

create table public.check_ins (
  id                          uuid primary key,
  visit_id                    uuid not null references public.visits (id) on delete cascade,
  mr_id                       uuid not null references public.user_profiles (id) on delete restrict,
  latitude                    double precision not null check (latitude between -90 and 90),
  longitude                   double precision not null check (longitude between -180 and 180),
  accuracy_metres             double precision check (accuracy_metres >= 0),
  geofence_status             public.geofence_status not null,
  distance_from_clinic_metres double precision check (distance_from_clinic_metres >= 0),
  source                      public.capture_source not null,
  occurred_at                 timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index check_ins_visit_id_idx on public.check_ins (visit_id);
create index check_ins_mr_id_idx    on public.check_ins (mr_id, occurred_at desc);

create table public.check_outs (
  id                          uuid primary key,
  visit_id                    uuid not null references public.visits (id) on delete cascade,
  mr_id                       uuid not null references public.user_profiles (id) on delete restrict,
  latitude                    double precision not null check (latitude between -90 and 90),
  longitude                   double precision not null check (longitude between -180 and 180),
  accuracy_metres             double precision check (accuracy_metres >= 0),
  geofence_status             public.geofence_status not null,
  distance_from_clinic_metres double precision check (distance_from_clinic_metres >= 0),
  source                      public.capture_source not null,
  occurred_at                 timestamptz not null,
  created_at                  timestamptz not null default now()
);

create index check_outs_visit_id_idx on public.check_outs (visit_id);
create index check_outs_mr_id_idx    on public.check_outs (mr_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- 10. Call reports
-- ----------------------------------------------------------------------------

create table public.call_reports (
  id                   uuid primary key,
  visit_id             uuid not null references public.visits (id) on delete cascade,
  -- The author. A field manager approves; a field manager never authors.
  mr_id                uuid not null references public.user_profiles (id) on delete restrict,
  summary              text not null default '',
  product_ids_discussed uuid[] not null default '{}',
  objections_raised    text,
  next_step            text,
  status               public.call_report_status not null default 'draft',
  draft_source         public.call_report_draft_source not null default 'manual',
  approved_by_user_id  uuid references public.user_profiles (id) on delete set null,
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint call_reports_one_per_visit unique (visit_id),
  -- An approved report must say who approved it and when. Nobody self-approves:
  -- the approval path is public.approve_call_report, which rejects the author.
  constraint call_reports_approval_is_attributed
    check (status <> 'approved' or (approved_by_user_id is not null and approved_at is not null))
);

create index call_reports_mr_id_idx  on public.call_reports (mr_id, created_at desc);
create index call_reports_status_idx on public.call_reports (status);

create trigger call_reports_set_updated_at
  before update on public.call_reports
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 11. Samples and inputs
-- ----------------------------------------------------------------------------

create table public.samples_and_inputs (
  id                 uuid primary key,
  visit_id           uuid not null references public.visits (id) on delete cascade,
  mr_id              uuid not null references public.user_profiles (id) on delete restrict,
  doctor_id          uuid not null references public.doctors (id) on delete restrict,
  kind               public.sample_or_input_kind not null,
  item_name          text not null check (length(btrim(item_name)) > 0),
  quantity           integer not null check (quantity > 0),
  declared_value_inr numeric(12, 2) not null default 0 check (declared_value_inr >= 0),
  occurred_at        timestamptz not null,
  created_at         timestamptz not null default now()
);

create index samples_and_inputs_visit_id_idx on public.samples_and_inputs (visit_id);
create index samples_and_inputs_mr_id_idx    on public.samples_and_inputs (mr_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- 12. Analyses
-- ----------------------------------------------------------------------------

-- An MR's performance analysis is sensitive employment data and is treated as such:
-- no direct SELECT grant to `authenticated` at all. Every read goes through a
-- logged RPC (see the audit log migration), so "every read is logged" is true for
-- MRs and managers, not only for admins.
--
-- Deliberately absent and to stay absent: any score, rating, rank, percentile or
-- grade column. Findings and their transcript citations arrive with the analysis
-- engine in week 10 under contract I5; `transcript_id` is not referenced here
-- because transcripts do not exist until week 8.
create table public.analyses (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references public.visits (id) on delete cascade,
  mr_id           uuid not null references public.user_profiles (id) on delete restrict,
  status          public.analysis_status not null default 'pending',
  refusal_reason  text,
  rubric_version  text not null default 'unset',
  model_provider  text not null default 'unset',
  model_version   text not null default 'unset',
  -- The MR sees their own analysis before a manager acts on it, and may reply.
  mr_viewed_at    timestamptz,
  mr_response     text,
  mr_responded_at timestamptz,
  generated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint analyses_one_per_visit unique (visit_id),
  constraint analyses_refusal_has_reason
    check (status <> 'refused' or refusal_reason is not null)
);

create index analyses_mr_id_idx on public.analyses (mr_id, created_at desc);

create trigger analyses_set_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 13. Helper 3 — the user ids whose data the caller may read
-- ----------------------------------------------------------------------------

-- mr            -> themselves only
-- field_manager -> themselves, everyone in their visible territory subtree, and
--                  their whole reporting subtree
-- admin         -> everyone
-- inactive      -> nobody
--
-- One primitive for every "own vs team" policy in this schema. Writing the same
-- subtree logic into twenty policies is how one of them ends up subtly different.
create or replace function public.visible_user_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_uid       uuid;
  v_role      public.app_role;
  v_is_active boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    return;
  end if;

  select p.role, p.is_active into v_role, v_is_active
    from public.user_profiles p
   where p.id = v_uid;

  if v_role is null or v_is_active is not true then
    return;
  end if;

  if v_role = 'admin' then
    return query select p.id from public.user_profiles p;
    return;
  end if;

  if v_role = 'mr' then
    return query select v_uid;
    return;
  end if;

  -- field_manager. Duplicates across the three branches are harmless: every caller
  -- uses this as `... in (select public.visible_user_ids())`.
  return query select v_uid;

  return query
    select p.id from public.user_profiles p
     where p.territory_id in (select public.visible_territory_ids(v_uid));

  return query
    with recursive reports as (
      select p.id from public.user_profiles p where p.reporting_manager_id = v_uid
      union all
      select c.id
        from public.user_profiles c
        join reports r on c.reporting_manager_id = r.id
    ) cycle id set is_cycle using path
    select reports.id from reports where not reports.is_cycle;
end;
$$;

comment on function public.visible_user_ids() is
  'The set of user ids whose data the caller may read. Single source of truth for '
  'every own-vs-team policy in this schema.';
