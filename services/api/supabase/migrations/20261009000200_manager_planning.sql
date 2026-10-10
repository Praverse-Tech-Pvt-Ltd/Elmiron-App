-- `BE-W171` / `BE-C78` -- the MANAGER plans a rep's day; a rep's own visit is an explicit UNPLANNED
-- visit with a reason; an admin grants extra planning scope and never writes a visit.
--
-- **What existed.** Versioned beat plans (`20260813000100`: a revision is version N+1 that supersedes
-- N, never an edit), entries per version, and visits that carry a nullable `beat_plan_id`. **Nothing
-- planned anyone's day**: the only writer of `beat_plans` was the rep, over REST, for themselves; the
-- seed scripts wrote the rest as the owner. And the phone never creates a visit -- a stop with no
-- server visit has `visitId: null` and cannot be checked in -- so a plan with no visit rows behind it
-- is a plan the rep cannot work.
--
-- **And a plan-less visit was indistinguishable from a malformed one.** `beat_plan_id is null` is what
-- an unplanned visit looked like, and also what a visit looked like when a client dropped the field,
-- and what 37 fixture inserts across 19 suites look like. A null foreign key is not a classification.
--
-- **The rules (`BE-C78`, the development instruction of 9 October 2026, answering Q-16/17/18):**
--   1. A FIELD MANAGER plans a rep's day, for a rep whose territory is in the manager's subtree, or
--      in a territory an admin has GRANTED them for that date. Nobody else plans.
--   2. An ADMIN grants and revokes that extra scope. An admin never plans and never writes a visit.
--   3. Every save is a new plan version; history is never edited. A visit that has started, finished
--      or was not met is never touched by a later plan. A visit not yet started follows the plan.
--   4. Reassigning planned work to another rep is an explicit, audited act. Nothing moves silently.
--   5. A rep may make an UNPLANNED visit without approval. It is marked so, and carries a reason. The
--      manager reviews it afterwards.
--
-- **What "planned" means in the schema now:** `visits.origin`. `planned` requires a plan and a date;
-- `unplanned` requires NO plan and a reason; `unclassified` is every row that existed before this
-- migration and every row the owner writes -- and **no signed-in caller may create one**, so from
-- here on a null `beat_plan_id` alone never makes a visit look legitimate.
--
-- Rollback: services/api/rollbacks/20261009000200_manager_planning.down.sql

-- ---------------------------------------------------------------------------
-- 1. The classification on visits
-- ---------------------------------------------------------------------------

create type public.visit_origin as enum ('planned', 'unplanned', 'unclassified');

alter table public.visits
  add column origin           public.visit_origin not null default 'unclassified',
  add column planned_date     date,
  add column unplanned_reason text;

alter table public.visits
  add constraint visits_planned_has_plan_and_date
    check (origin <> 'planned' or (beat_plan_id is not null and planned_date is not null)),
  add constraint visits_unplanned_has_no_plan_and_a_reason
    check (origin <> 'unplanned'
           or (beat_plan_id is null and char_length(btrim(coalesce(unplanned_reason, ''))) between 3 and 500)),
  add constraint visits_reason_only_on_unplanned
    check (unplanned_reason is null or origin = 'unplanned'),
  add constraint visits_planned_date_only_on_planned
    check (planned_date is null or origin = 'planned');

-- One live planned visit per rep, doctor and day. This is what makes a re-save, a retried RPC or a
-- race between two managers unable to produce a second visit: the database refuses it.
create unique index visits_one_live_planned_per_mr_doctor_day
  on public.visits (mr_id, doctor_id, planned_date)
  where origin = 'planned' and status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 2. Who wrote a plan version, and the key that makes a save idempotent
-- ---------------------------------------------------------------------------

alter table public.beat_plans
  add column planned_by_user_id uuid references public.user_profiles (id) on delete restrict,
  add column request_id         uuid;

alter table public.beat_plans
  add constraint beat_plans_request_id_unique unique (request_id);

-- `beat_plan_current` is `select bp.*`, and a view's `*` is frozen into a column list when the view
-- is made. Redefined so the newest version carries who planned it; `create or replace` may only add
-- columns at the end, which is all this does, and it keeps the view's grants.
create or replace view public.beat_plan_current
with (security_invoker = true) as
  select bp.*
    from public.beat_plans bp
   where not exists (
     select 1 from public.beat_plans newer where newer.supersedes_beat_plan_id = bp.id
   );

-- ---------------------------------------------------------------------------
-- 3. Extra planning scope, granted by an admin -- append-only, revoked by a second row
-- ---------------------------------------------------------------------------

create table public.planning_territory_grants (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  manager_id         uuid not null references public.user_profiles (id) on delete restrict,
  territory_id       uuid not null references public.territories (id) on delete restrict,
  valid_from         date not null,
  valid_until        date,
  reason             text not null check (char_length(btrim(reason)) between 3 and 500),
  granted_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  created_at         timestamptz not null default now(),
  constraint planning_grants_dates_ordered check (valid_until is null or valid_until >= valid_from),
  constraint planning_grants_not_self check (granted_by_user_id <> manager_id)
);

create index planning_territory_grants_manager_idx on public.planning_territory_grants (manager_id);

create table public.planning_territory_grant_revocations (
  id                 uuid primary key default gen_random_uuid(),
  grant_id           uuid not null unique references public.planning_territory_grants (id) on delete restrict,
  revoked_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  reason             text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Reassignment and review records -- append-only
-- ---------------------------------------------------------------------------

create table public.plan_reassignments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  request_id            uuid not null,
  from_visit_id         uuid not null references public.visits (id) on delete restrict,
  to_visit_id           uuid not null references public.visits (id) on delete restrict,
  from_mr_id            uuid not null references public.user_profiles (id) on delete restrict,
  to_mr_id              uuid not null references public.user_profiles (id) on delete restrict,
  planned_date          date not null,
  reason                text not null check (char_length(btrim(reason)) between 3 and 500),
  reassigned_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  constraint plan_reassignments_once_per_request unique (request_id, from_visit_id),
  constraint plan_reassignments_from_visit_once unique (from_visit_id),
  constraint plan_reassignments_different_rep check (from_mr_id <> to_mr_id)
);

create table public.unplanned_visit_reviews (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits (id) on delete restrict,
  reviewer_id uuid not null references public.user_profiles (id) on delete restrict,
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  constraint unplanned_visit_reviews_once unique (visit_id, reviewer_id)
);

create trigger planning_territory_grants_reject_mutation
  before update or delete or truncate on public.planning_territory_grants
  for each statement execute function public.reject_mutation();
create trigger planning_grant_revocations_reject_mutation
  before update or delete or truncate on public.planning_territory_grant_revocations
  for each statement execute function public.reject_mutation();
create trigger plan_reassignments_reject_mutation
  before update or delete or truncate on public.plan_reassignments
  for each statement execute function public.reject_mutation();
create trigger unplanned_visit_reviews_reject_mutation
  before update or delete or truncate on public.unplanned_visit_reviews
  for each statement execute function public.reject_mutation();

create trigger planning_territory_grants_audit after insert on public.planning_territory_grants
  for each row execute function public.write_audit_row();
create trigger planning_grant_revocations_audit after insert on public.planning_territory_grant_revocations
  for each row execute function public.write_audit_row();
create trigger plan_reassignments_audit after insert on public.plan_reassignments
  for each row execute function public.write_audit_row();
create trigger unplanned_visit_reviews_audit after insert on public.unplanned_visit_reviews
  for each row execute function public.write_audit_row();

-- beat_plans and beat_plan_entries had no audit trigger. A plan is now a manager's instruction to
-- someone else, so who wrote which version is an audit fact.
create trigger beat_plans_audit after insert or update on public.beat_plans
  for each row execute function public.write_audit_row();
create trigger beat_plan_entries_audit after insert on public.beat_plan_entries
  for each row execute function public.write_audit_row();

-- ---------------------------------------------------------------------------
-- 5. The day zone, readable without the caller check
-- ---------------------------------------------------------------------------
-- `day_zone_for` refuses a caller who cannot see the rep -- right for a client, wrong for a planner
-- holding a GRANT (the granted rep is outside the manager's `visible_user_ids`). The body moves
-- here, unchanged and ungranted; `day_zone_for` keeps its check and calls it. One rule, one place:
-- no second timezone default is minted.

create or replace function public.day_zone_unchecked(p_mr_id uuid)
returns table (time_zone text, source text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_territory uuid;
  v_zone      text;
begin
  select p.territory_id into v_territory
    from public.user_profiles p
   where p.id = p_mr_id and p.is_active;

  if v_territory is not null then
    select w.timezone into v_zone from public.resolve_shift_window(v_territory) w;
  end if;

  if v_zone is null then
    return query select 'UTC'::text, 'fallback_utc'::text;
  else
    return query select v_zone, 'territory'::text;
  end if;
end;
$$;

create or replace function public.day_zone_for(p_mr_id uuid)
returns table (time_zone text, source text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is not null
     and p_mr_id not in (select public.visible_user_ids()) then
    raise exception 'not permitted to read the day zone of that user'
      using errcode = '42501';
  end if;
  return query select z.time_zone, z.source from public.day_zone_unchecked(p_mr_id) z;
end;
$$;

revoke execute on function public.day_zone_unchecked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Who may plan for whom
-- ---------------------------------------------------------------------------

-- The territories a manager may plan in on a date: their own subtree, plus the subtree of every
-- grant active that day. Not granted to clients, like `visible_territory_ids` -- it takes an
-- arbitrary user id.
create or replace function public.plannable_territory_ids(p_manager_id uuid, p_on date)
returns setof uuid
language plpgsql
stable
security definer
set search_path to ''
set statement_timeout to '5s'
as $$
declare
  v_role public.app_role;
  v_org  uuid;
  v_active boolean;
begin
  select p.role, p.organisation_id, p.is_active into v_role, v_org, v_active
    from public.user_profiles p where p.id = p_manager_id;
  if v_role is distinct from 'field_manager' or v_active is not true or v_org is null then
    return;
  end if;

  return query
    select t from public.visible_territory_ids(p_manager_id) t
    union
    select sub.id from (
      with recursive subtree as (
        select t.id from public.territories t
          join public.planning_territory_grants g on g.territory_id = t.id
         where g.manager_id = p_manager_id
           and g.organisation_id = v_org
           and t.organisation_id = v_org
           and g.valid_from <= p_on
           and (g.valid_until is null or g.valid_until >= p_on)
           and not exists (select 1 from public.planning_territory_grant_revocations r
                            where r.grant_id = g.id)
        union all
        select c.id from public.territories c join subtree s on c.parent_id = s.id
         where c.organisation_id = v_org
      ) cycle id set is_cycle using path
      select subtree.id from subtree where not subtree.is_cycle
    ) sub;
end;
$$;

revoke execute on function public.plannable_territory_ids(uuid, date) from public, anon, authenticated;

-- The caller, if they are an active field manager; otherwise a refusal. Admins are refused with a
-- hint naming the rule, because "an admin cannot plan" is the surprising half of it.
create or replace function public.planning_manager()
returns public.user_profiles
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.is_active is not true or v_me.role is distinct from 'field_manager' then
    raise exception 'only a field manager plans a rep''s day'
      using errcode = '42501',
            hint = 'BE-C78: a manager plans; an admin grants planning scope and never writes a visit.';
  end if;
  return v_me;
end;
$$;

revoke execute on function public.planning_manager() from public, anon, authenticated;

-- The rep, if this manager may plan for them on this date. Not found, another organisation's, not a
-- rep, inactive, and out of scope are ONE answer: telling a manager a rep exists elsewhere is an
-- existence oracle across territories and tenants.
create or replace function public.plannable_rep(p_manager public.user_profiles, p_mr_id uuid, p_on date)
returns public.user_profiles
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_rep public.user_profiles;
begin
  select * into v_rep from public.user_profiles p where p.id = p_mr_id;
  if v_rep.id is null
     or v_rep.organisation_id is distinct from p_manager.organisation_id
     or v_rep.role is distinct from 'mr'
     or v_rep.is_active is not true
     or v_rep.territory_id is null
     or v_rep.territory_id not in (select public.plannable_territory_ids(p_manager.id, p_on)) then
    raise exception 'you may not plan for rep % on %', p_mr_id, p_on
      using errcode = '42501',
            hint = 'A manager plans within their territory subtree, or a territory an admin has granted them for that date.';
  end if;
  return v_rep;
end;
$$;

revoke execute on function public.plannable_rep(public.user_profiles, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Writing one plan version -- the single path every planning act goes through
-- ---------------------------------------------------------------------------
-- Returns the summary. Assumes the caller has been authorised and the per-rep-per-day lock is held.
--
-- `p_entries` is an ordered array of `{doctorId, clinicAddressId?}`. Order is the route.
--
-- What happens to visits, for this rep and day:
--   * a doctor in the new plan with a live, NOT STARTED planned visit -> that visit follows the new
--     version (plan id, clinic, scheduled time). Same row, same id: the phone keeps its reference.
--   * a doctor in the new plan with no live planned visit -> one is created.
--   * a doctor in the new plan whose planned visit has started, finished or was not met -> nothing.
--     That visit is history and keeps pointing at the version it was worked against.
--   * a NOT STARTED planned visit whose doctor left the plan -> `cancelled`.
--   * any started, completed, not-met, unplanned or unclassified visit -> never touched.
create or replace function public.write_plan_version(
  p_manager    public.user_profiles,
  p_rep        public.user_profiles,
  p_plan_date  date,
  p_entries    jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_current   public.beat_plans;
  v_plan_id   uuid;
  v_version   integer;
  v_zone      text;
  v_shift     time;
  v_sched     timestamptz;
  v_entry     jsonb;
  v_doctor    uuid;
  v_clinic    uuid;
  v_seq       integer := 0;
  v_seen      uuid[] := '{}';
  v_same      boolean;
  v_created   integer := 0;
  v_moved     integer := 0;
  v_cancelled integer := 0;
  v_kept      integer := 0;
  v_existing  public.visits;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'a plan is an array of stops' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 60 then
    raise exception 'a plan has at most 60 stops, this one has %', jsonb_array_length(p_entries)
      using errcode = '22023';
  end if;

  -- Validate every stop before writing anything.
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_doctor := nullif(v_entry ->> 'doctorId', '')::uuid;
    v_clinic := nullif(v_entry ->> 'clinicAddressId', '')::uuid;
    if v_doctor is null then
      raise exception 'stop % has no doctor', v_seq + 1 using errcode = '22023';
    end if;
    if v_doctor = any (v_seen) then
      raise exception 'doctor % appears twice in one plan', v_doctor using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.doctors d
       where d.id = v_doctor
         and d.organisation_id = p_rep.organisation_id
         and d.territory_id = p_rep.territory_id
         and d.is_active
    ) then
      raise exception 'doctor % is not an active doctor in rep %''s territory', v_doctor, p_rep.id
        using errcode = '42501',
              hint = 'A rep is planned against doctors in their own territory. Reassign the rep or the doctor first.';
    end if;
    if v_clinic is not null and not exists (
      select 1 from public.clinic_addresses a where a.id = v_clinic and a.doctor_id = v_doctor
    ) then
      raise exception 'clinic address % is not doctor %''s', v_clinic, v_doctor using errcode = '23514';
    end if;
    v_seen := v_seen || v_doctor;
    v_seq := v_seq + 1;
  end loop;

  select * into v_current from public.beat_plans b
   where b.mr_id = p_rep.id and b.plan_date = p_plan_date
   order by b.version desc limit 1;

  -- A save identical to the current version writes nothing. Compared on (doctor, clinic, order).
  if v_current.id is not null then
    select coalesce(
             (select array_agg(array[e.doctor_id::text, coalesce(e.clinic_address_id::text, '')]
                               order by e.planned_sequence)
                from public.beat_plan_entries e where e.beat_plan_id = v_current.id),
             '{}')
           = coalesce(
             (select array_agg(array[(x.value ->> 'doctorId'),
                                     coalesce(nullif(x.value ->> 'clinicAddressId', ''), '')]
                               order by x.ordinality)
                from jsonb_array_elements(p_entries) with ordinality x),
             '{}')
      into v_same;
    if v_same and v_current.planned_by_user_id is not null then
      return jsonb_build_object(
        'beatPlanId', v_current.id, 'version', v_current.version, 'unchanged', true,
        'visitsCreated', 0, 'visitsMoved', 0, 'visitsCancelled', 0, 'visitsKept', 0);
    end if;
  end if;

  v_version := coalesce(v_current.version, 0) + 1;
  insert into public.beat_plans
    (mr_id, territory_id, plan_date, status, approved_by_user_id, approved_at, version,
     supersedes_beat_plan_id, planned_by_user_id, request_id)
  values
    (p_rep.id, p_rep.territory_id, p_plan_date, 'approved', p_manager.id, now(), v_version,
     v_current.id, p_manager.id, p_request_id)
  returning id into v_plan_id;

  select z.time_zone into v_zone from public.day_zone_unchecked(p_rep.id) z;
  select w.shift_start into v_shift from public.resolve_shift_window(p_rep.territory_id) w;
  -- The visit's day is `visit_day()`: the scheduled time in the rep's zone. Anchored at the shift
  -- start, so it is on the plan's date whatever the zone; noon only if no window resolves at all.
  v_sched := (p_plan_date + coalesce(v_shift, time '12:00')) at time zone v_zone;

  -- The planning flag lets `validate_visit` tell this path from a client writing a planned visit.
  perform set_config('app.planning_write', 'on', true);

  v_seq := 0;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_doctor := (v_entry ->> 'doctorId')::uuid;
    v_clinic := nullif(v_entry ->> 'clinicAddressId', '')::uuid;
    insert into public.beat_plan_entries (beat_plan_id, doctor_id, clinic_address_id, planned_sequence)
    values (v_plan_id, v_doctor, v_clinic, v_seq);
    v_seq := v_seq + 1;

    select * into v_existing from public.visits v
     where v.mr_id = p_rep.id and v.doctor_id = v_doctor and v.planned_date = p_plan_date
       and v.origin = 'planned' and v.status <> 'cancelled'
     for update;

    if v_existing.id is null then
      insert into public.visits
        (id, mr_id, doctor_id, beat_plan_id, clinic_address_id, status, scheduled_for,
         origin, planned_date)
      values
        (gen_random_uuid(), p_rep.id, v_doctor, v_plan_id, v_clinic, 'planned', v_sched,
         'planned', p_plan_date);
      v_created := v_created + 1;
    elsif v_existing.status = 'planned' and v_existing.started_at is null then
      update public.visits
         set beat_plan_id = v_plan_id, clinic_address_id = v_clinic, scheduled_for = v_sched
       where id = v_existing.id;
      v_moved := v_moved + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;

  update public.visits v
     set status = 'cancelled'
   where v.mr_id = p_rep.id and v.planned_date = p_plan_date and v.origin = 'planned'
     and v.status = 'planned' and v.started_at is null
     and not (v.doctor_id = any (v_seen));
  get diagnostics v_cancelled = row_count;

  perform set_config('app.planning_write', 'off', true);

  return jsonb_build_object(
    'beatPlanId', v_plan_id, 'version', v_version, 'unchanged', false,
    'visitsCreated', v_created, 'visitsMoved', v_moved, 'visitsCancelled', v_cancelled,
    'visitsKept', v_kept);
end;
$$;

revoke execute on function public.write_plan_version(public.user_profiles, public.user_profiles, date, jsonb, uuid)
  from public, anon, authenticated;

-- The rep's local today. Planning a day that has already begun in the rep's zone is allowed (a
-- manager adjusting this afternoon); planning a day that has ENDED is not -- it would cancel or
-- re-point nothing real and only rewrite what the rep was told.
create or replace function public.rep_today(p_mr_id uuid)
returns date
language sql
stable
security definer
set search_path to ''
as $$
  select (now() at time zone z.time_zone)::date from public.day_zone_unchecked(p_mr_id) z;
$$;

revoke execute on function public.rep_today(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The planning RPCs
-- ---------------------------------------------------------------------------

create or replace function public.plan_mr_day(
  p_mr_id      uuid,
  p_plan_date  date,
  p_entries    jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me      public.user_profiles := public.planning_manager();
  v_rep     public.user_profiles;
  v_replay  public.beat_plans;
begin
  if p_request_id is null then
    raise exception 'a plan save carries a request id' using errcode = '22023';
  end if;

  -- One writer per rep and day at a time. Two managers saving together get two versions in order,
  -- never two version-N+1 rows racing on the unique key.
  perform pg_advisory_xact_lock(hashtextextended('plan:' || p_mr_id::text || ':' || p_plan_date::text, 0));

  -- A retried request returns what it wrote the first time, and writes nothing.
  select * into v_replay from public.beat_plans b where b.request_id = p_request_id;
  if v_replay.id is not null then
    if v_replay.mr_id <> p_mr_id or v_replay.plan_date <> p_plan_date
       or v_replay.planned_by_user_id is distinct from v_me.id then
      raise exception 'request id % was already used for a different plan', p_request_id
        using errcode = '22023';
    end if;
    return jsonb_build_object('beatPlanId', v_replay.id, 'version', v_replay.version,
                              'unchanged', false, 'replayed', true);
  end if;

  v_rep := public.plannable_rep(v_me, p_mr_id, p_plan_date);

  if p_plan_date < public.rep_today(v_rep.id) then
    raise exception 'plan_date_in_past: % has ended in the rep''s timezone', p_plan_date
      using errcode = '22023',
            hint = 'A finished day is history. Plan today or later.';
  end if;

  return public.write_plan_version(v_me, v_rep, p_plan_date, p_entries, p_request_id)
         || jsonb_build_object('replayed', false);
end;
$$;

-- Reassign selected future planned visits to another rep. Explicit, per visit, audited.
-- Each source visit is removed from its rep's plan (a new version, which cancels it) and added to
-- the target rep's plan (a new version, which creates a new planned visit). The pair is recorded in
-- `plan_reassignments`. History -- anything started, finished or not met -- cannot be selected.
create or replace function public.reassign_planned_visits(
  p_visit_ids  uuid[],
  p_to_mr_id   uuid,
  p_reason     text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me       public.user_profiles := public.planning_manager();
  v_target   public.user_profiles;
  v_source   public.user_profiles;
  v_visit    public.visits;
  v_entries  jsonb;
  v_new      uuid;
  v_done     jsonb := '[]';
  v_sub      uuid;
begin
  if p_request_id is null then
    raise exception 'a reassignment carries a request id' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reassignment_needs_reason' using errcode = '22023';
  end if;
  if p_visit_ids is null or cardinality(p_visit_ids) = 0 then
    raise exception 'no visits selected' using errcode = '22023';
  end if;

  -- Replay: the same request returns the pairs it recorded.
  if exists (select 1 from public.plan_reassignments r where r.request_id = p_request_id) then
    return jsonb_build_object('replayed', true, 'reassigned',
      (select jsonb_agg(jsonb_build_object('fromVisitId', r.from_visit_id, 'toVisitId', r.to_visit_id)
                        order by r.created_at)
         from public.plan_reassignments r
        where r.request_id = p_request_id and r.reassigned_by_user_id = v_me.id));
  end if;

  foreach v_sub in array p_visit_ids loop
    select * into v_visit from public.visits v where v.id = v_sub;
    if v_visit.id is null then
      raise exception 'visit % is not yours to reassign', v_sub using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('plan:' || v_visit.mr_id::text || ':' || coalesce(v_visit.planned_date::text, ''), 0));
    perform pg_advisory_xact_lock(hashtextextended('plan:' || p_to_mr_id::text || ':' || coalesce(v_visit.planned_date::text, ''), 0));
    select * into v_visit from public.visits v where v.id = v_sub for update;

    if v_visit.origin <> 'planned' or v_visit.status <> 'planned' or v_visit.started_at is not null then
      raise exception 'visit_not_reassignable: visit % is % and %', v_visit.id, v_visit.origin, v_visit.status
        using errcode = '22023',
              hint = 'Only a planned visit that has not started can be reassigned. History stays with the rep who did it.';
    end if;

    -- Both reps must be plannable by this manager on that day.
    v_source := public.plannable_rep(v_me, v_visit.mr_id, v_visit.planned_date);
    v_target := public.plannable_rep(v_me, p_to_mr_id, v_visit.planned_date);
    if v_source.id = v_target.id then
      raise exception 'the visit is already this rep''s' using errcode = '22023';
    end if;
    if v_visit.planned_date < public.rep_today(v_source.id) then
      raise exception 'plan_date_in_past: % has ended', v_visit.planned_date using errcode = '22023';
    end if;
    if not exists (select 1 from public.doctors d where d.id = v_visit.doctor_id
                     and d.territory_id = v_target.territory_id) then
      raise exception 'doctor_outside_target_territory: doctor % is not in rep %''s territory',
        v_visit.doctor_id, v_target.id
        using errcode = '22023',
              hint = 'A rep is only planned against doctors in their own territory.';
    end if;

    -- Source: the current plan without this doctor.
    select coalesce(jsonb_agg(jsonb_build_object('doctorId', e.doctor_id, 'clinicAddressId', e.clinic_address_id)
                              order by e.planned_sequence), '[]')
      into v_entries
      from public.beat_plan_entries e
     where e.beat_plan_id = (select b.id from public.beat_plans b
                              where b.mr_id = v_source.id and b.plan_date = v_visit.planned_date
                              order by b.version desc limit 1)
       and e.doctor_id <> v_visit.doctor_id;
    perform public.write_plan_version(v_me, v_source, v_visit.planned_date, v_entries, null);

    -- Target: the current plan plus this doctor, last.
    select coalesce(jsonb_agg(jsonb_build_object('doctorId', e.doctor_id, 'clinicAddressId', e.clinic_address_id)
                              order by e.planned_sequence), '[]')
      into v_entries
      from public.beat_plan_entries e
     where e.beat_plan_id = (select b.id from public.beat_plans b
                              where b.mr_id = v_target.id and b.plan_date = v_visit.planned_date
                              order by b.version desc limit 1)
       and e.doctor_id <> v_visit.doctor_id;
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object('doctorId', v_visit.doctor_id, 'clinicAddressId', v_visit.clinic_address_id));
    perform public.write_plan_version(v_me, v_target, v_visit.planned_date, v_entries, null);

    select v.id into v_new from public.visits v
     where v.mr_id = v_target.id and v.doctor_id = v_visit.doctor_id
       and v.planned_date = v_visit.planned_date and v.origin = 'planned' and v.status <> 'cancelled';

    insert into public.plan_reassignments
      (organisation_id, request_id, from_visit_id, to_visit_id, from_mr_id, to_mr_id, planned_date,
       reason, reassigned_by_user_id)
    values
      (v_me.organisation_id, p_request_id, v_visit.id, v_new, v_source.id, v_target.id,
       v_visit.planned_date, btrim(p_reason), v_me.id);

    v_done := v_done || jsonb_build_array(jsonb_build_object('fromVisitId', v_visit.id, 'toVisitId', v_new));
  end loop;

  return jsonb_build_object('replayed', false, 'reassigned', v_done);
end;
$$;

-- Admin: grant a manager planning scope over a territory (and its subtree) for a date range.
create or replace function public.grant_planning_access(
  p_manager_id  uuid,
  p_territory_id uuid,
  p_valid_from  date,
  p_valid_until date,
  p_reason      text
)
returns public.planning_territory_grants
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles;
  v_row public.planning_territory_grants;
begin
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.role is distinct from 'admin' or v_me.is_active is not true then
    raise exception 'only an admin grants planning access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_profiles p where p.id = p_manager_id
                   and p.organisation_id = v_me.organisation_id and p.role = 'field_manager' and p.is_active) then
    raise exception 'user % is not an active field manager in your organisation', p_manager_id
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.territories t where t.id = p_territory_id
                   and t.organisation_id = v_me.organisation_id) then
    raise exception 'territory % is not in your organisation', p_territory_id using errcode = '42501';
  end if;
  if p_valid_from is null then
    raise exception 'a grant has a start date' using errcode = '22023';
  end if;

  insert into public.planning_territory_grants
    (organisation_id, manager_id, territory_id, valid_from, valid_until, reason, granted_by_user_id)
  values
    (v_me.organisation_id, p_manager_id, p_territory_id, p_valid_from, p_valid_until, btrim(p_reason), v_me.id)
  returning * into v_row;
  return v_row;
end;
$$;

-- Admin: revoke a grant. Revoking twice returns the first revocation.
create or replace function public.revoke_planning_access(p_grant_id uuid, p_reason text)
returns public.planning_territory_grant_revocations
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles;
  v_row public.planning_territory_grant_revocations;
begin
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.role is distinct from 'admin' or v_me.is_active is not true then
    raise exception 'only an admin revokes planning access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.planning_territory_grants g where g.id = p_grant_id
                   and g.organisation_id = v_me.organisation_id) then
    raise exception 'grant % is not yours', p_grant_id using errcode = '42501';
  end if;

  select * into v_row from public.planning_territory_grant_revocations r where r.grant_id = p_grant_id;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.planning_territory_grant_revocations (grant_id, revoked_by_user_id, reason)
  values (p_grant_id, v_me.id, btrim(p_reason))
  on conflict (grant_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.planning_territory_grant_revocations r where r.grant_id = p_grant_id;
  end if;
  return v_row;
end;
$$;

-- Manager: the reps they may plan for on a date, for the console's picker.
create or replace function public.plannable_reps(p_on date)
returns table (mr_id uuid, full_name text, territory_id uuid, territory_name text, via_grant boolean)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles := public.planning_manager();
begin
  return query
    select p.id, p.full_name, p.territory_id, t.name,
           p.territory_id not in (select public.visible_territory_ids(v_me.id))
      from public.user_profiles p
      join public.territories t on t.id = p.territory_id
     where p.organisation_id = v_me.organisation_id
       and p.role = 'mr' and p.is_active
       and p.territory_id in (select public.plannable_territory_ids(v_me.id, p_on))
     order by p.full_name;
end;
$$;

-- Manager: the doctors they may put on this rep's plan for this date, with their clinics. An RPC and
-- not a table read because a GRANTED territory is outside the manager's RLS scope -- the grant is
-- planning scope, not general visibility, so it is honoured here and nowhere else.
create or replace function public.plannable_doctors(p_mr_id uuid, p_on date)
returns table (doctor_id uuid, full_name text, specialty text, clinics jsonb)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles := public.planning_manager();
  v_rep public.user_profiles := public.plannable_rep(v_me, p_mr_id, p_on);
begin
  return query
    select d.id, d.full_name, d.specialty,
           coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'city', a.city)
                                      order by a.label)
                       from public.clinic_addresses a where a.doctor_id = d.id), '[]')
      from public.doctors d
     where d.organisation_id = v_rep.organisation_id
       and d.territory_id = v_rep.territory_id
       and d.is_active
     order by d.full_name;
end;
$$;

-- Manager: a rep's days -- the current plan, every visit kept apart by origin, and the reviews.
create or replace function public.manager_day_review(p_mr_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles := public.planning_manager();
  v_rep public.user_profiles;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'a review covers 1 to 32 days' using errcode = '22023';
  end if;
  -- Scope is checked at the START of the range: a grant that ends mid-range still lets the manager
  -- see the days it covered, and nothing before it began.
  v_rep := public.plannable_rep(v_me, p_mr_id, p_from);

  return jsonb_build_object(
    'mrId', v_rep.id,
    'fullName', v_rep.full_name,
    'today', public.rep_today(v_rep.id),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'beatPlanId', b.id, 'planDate', b.plan_date, 'version', b.version,
               'plannedBy', b.planned_by_user_id, 'createdAt', b.created_at,
               'entries', coalesce((select jsonb_agg(jsonb_build_object(
                                     'doctorId', e.doctor_id, 'doctorName', d.full_name,
                                     'clinicAddressId', e.clinic_address_id,
                                     'sequence', e.planned_sequence) order by e.planned_sequence)
                                     from public.beat_plan_entries e
                                     join public.doctors d on d.id = e.doctor_id
                                    where e.beat_plan_id = b.id), '[]'))
             order by b.plan_date)
        from public.beat_plan_current b
       where b.mr_id = v_rep.id and b.plan_date between p_from and p_to), '[]'),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'visitId', v.id, 'doctorId', v.doctor_id, 'doctorName', d.full_name,
               'origin', v.origin, 'status', v.status, 'beatPlanId', v.beat_plan_id,
               'plannedDate', v.planned_date, 'visitDay', public.visit_day(v),
               'startedAt', v.started_at, 'completedAt', v.completed_at,
               'notMetReason', v.not_met_reason, 'unplannedReason', v.unplanned_reason,
               'reviewedByMe', exists (select 1 from public.unplanned_visit_reviews r
                                        where r.visit_id = v.id and r.reviewer_id = v_me.id),
               'reassignedTo', (select r.to_mr_id from public.plan_reassignments r
                                 where r.from_visit_id = v.id))
             order by public.visit_day(v), v.created_at)
        from public.visits v
        join public.doctors d on d.id = v.doctor_id
       where v.mr_id = v_rep.id
         and public.visit_day(v) between p_from and p_to), '[]'));
end;
$$;

-- Manager: record that an unplanned visit was reviewed. Twice is once. (Not "acknowledge": `rls.spec`
-- holds that no function by that name exists, so an AI finding is never implied endorsed.)
create or replace function public.review_unplanned_visit(p_visit_id uuid, p_note text)
returns public.unplanned_visit_reviews
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me    public.user_profiles := public.planning_manager();
  v_visit public.visits;
  v_row   public.unplanned_visit_reviews;
begin
  select * into v_visit from public.visits v where v.id = p_visit_id;
  if v_visit.id is null then
    raise exception 'visit % is not yours to review', p_visit_id using errcode = '42501';
  end if;
  perform public.plannable_rep(v_me, v_visit.mr_id, coalesce(public.visit_day(v_visit), current_date));
  if v_visit.origin <> 'unplanned' then
    raise exception 'visit % is %, not unplanned', p_visit_id, v_visit.origin using errcode = '22023';
  end if;

  insert into public.unplanned_visit_reviews (visit_id, reviewer_id, note)
  values (p_visit_id, v_me.id, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (visit_id, reviewer_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.unplanned_visit_reviews r
     where r.visit_id = p_visit_id and r.reviewer_id = v_me.id;
  end if;
  return v_row;
end;
$$;

revoke execute on function public.plan_mr_day(uuid, date, jsonb, uuid) from public, anon;
revoke execute on function public.reassign_planned_visits(uuid[], uuid, text, uuid) from public, anon;
revoke execute on function public.grant_planning_access(uuid, uuid, date, date, text) from public, anon;
revoke execute on function public.revoke_planning_access(uuid, text) from public, anon;
revoke execute on function public.plannable_reps(date) from public, anon;
revoke execute on function public.plannable_doctors(uuid, date) from public, anon;
revoke execute on function public.manager_day_review(uuid, date, date) from public, anon;
revoke execute on function public.review_unplanned_visit(uuid, text) from public, anon;
grant execute on function public.plan_mr_day(uuid, date, jsonb, uuid) to authenticated;
grant execute on function public.reassign_planned_visits(uuid[], uuid, text, uuid) to authenticated;
grant execute on function public.grant_planning_access(uuid, uuid, date, date, text) to authenticated;
grant execute on function public.revoke_planning_access(uuid, text) to authenticated;
grant execute on function public.plannable_reps(date) to authenticated;
grant execute on function public.plannable_doctors(uuid, date) to authenticated;
grant execute on function public.manager_day_review(uuid, date, date) to authenticated;
grant execute on function public.review_unplanned_visit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Visit validation: who a visit is for, and who may create which kind
-- ---------------------------------------------------------------------------
-- The body is `20260908001400`'s, with rules 6-8 added after rule 5.

create or replace function public.validate_visit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_doctor    public.doctors%rowtype;
  v_mr_org    uuid;
  v_mr_role   public.app_role;
  v_tolerance numeric;
  v_clinic_doctor uuid;
  v_plan_mr   uuid;
begin
  select * into v_doctor from public.doctors d where d.id = new.doctor_id;
  if not found then
    raise exception 'doctor % does not exist', new.doctor_id using errcode = '23503';
  end if;

  select p.organisation_id, p.role into v_mr_org, v_mr_role
    from public.user_profiles p where p.id = new.mr_id;

  -- ---- 1. the same tenant ----
  if v_mr_org is distinct from v_doctor.organisation_id then
    raise exception
      'visit links MR % in organisation % to doctor % in organisation %',
      new.mr_id, v_mr_org, new.doctor_id, v_doctor.organisation_id
      using errcode = '42501',
            hint = 'A visit cannot cross a tenant boundary. The doctor belongs to another '
                   'organisation.';
  end if;

  -- ---- 2. the doctor is in a territory this MR can see ----
  if not exists (
    select 1 from public.visible_territory_ids(new.mr_id) t
     where t = v_doctor.territory_id
  ) then
    raise exception
      'doctor % is in territory %, which is not visible to MR %',
      new.doctor_id, v_doctor.territory_id, new.mr_id
      using errcode = '42501',
            hint = 'A visit can only be booked against a doctor in a territory the MR '
                   'covers.';
  end if;

  -- ---- 3. the clinic address belongs to that doctor ----
  if new.clinic_address_id is not null then
    select a.doctor_id into v_clinic_doctor
      from public.clinic_addresses a where a.id = new.clinic_address_id;

    if v_clinic_doctor is distinct from new.doctor_id then
      raise exception
        'clinic address % belongs to doctor %, not to doctor %',
        new.clinic_address_id, v_clinic_doctor, new.doctor_id
        using errcode = '23514',
              hint = 'The geofence is measured from this address, so it has to be the '
                     'address of the doctor being visited.';
    end if;
  end if;

  -- ---- 4. the beat plan belongs to this MR ----
  if new.beat_plan_id is not null then
    select b.mr_id into v_plan_mr
      from public.beat_plans b where b.id = new.beat_plan_id;

    if v_plan_mr is distinct from new.mr_id then
      raise exception
        'beat plan % belongs to MR %, not to MR %',
        new.beat_plan_id, v_plan_mr, new.mr_id
        using errcode = '23514',
              hint = 'A visit can only be attached to its own MR''s beat plan.';
    end if;
  end if;

  -- ---- 5. the clock ----
  v_tolerance := coalesce(
    public.threshold_number('consent_future_tolerance_seconds', null, null), 0);

  if new.started_at is not null
     and new.started_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'a visit cannot have started in the future'
      using errcode = '45007',
            detail = format('started_at %s is more than %s seconds after the server clock %s',
                            new.started_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync again; '
                     'the visit itself is unaffected.';
  end if;

  if new.completed_at is not null
     and new.completed_at > now() + make_interval(secs => v_tolerance) then
    raise exception 'a visit cannot have been completed in the future'
      using errcode = '45007',
            detail = format('completed_at %s is more than %s seconds after the server clock %s',
                            new.completed_at, v_tolerance::integer, now()),
            hint   = 'The device clock is ahead of the server. Correct it and sync again; '
                     'the visit itself is unaffected.';
  end if;

  -- ---- 6. a visit is a REP's (`BE-C78`) ----
  -- Closes every path by which an admin or a manager authors a visit for themselves.
  if v_mr_role is distinct from 'mr' then
    raise exception 'visits belong to reps; % is a %', new.mr_id, v_mr_role
      using errcode = '42501',
            hint = 'BE-C78: a manager plans visits FOR a rep; an admin never writes one.';
  end if;

  if tg_op = 'INSERT' and (select auth.uid()) is not null then
    -- ---- 7. a signed-in caller never creates an UNCLASSIFIED visit ----
    -- Unclassified is history and owner-written fixtures. A client that omits the origin is a
    -- malformed client, and it is refused rather than filed as something it might not be.
    if new.origin = 'unclassified' then
      raise exception 'visit_origin_required: a new visit is planned or unplanned'
        using errcode = '22023',
              hint = 'A rep''s own visit is sent as unplanned, with a reason. Planned visits come from the manager''s plan.';
    end if;

    -- ---- 8. only the plan writes a PLANNED visit ----
    if new.origin = 'planned' and coalesce(current_setting('app.planning_write', true), 'off') <> 'on' then
      raise exception 'planned_visit_from_plan_only: a planned visit is created by the manager''s plan'
        using errcode = '42501',
              hint = 'BE-C78. A rep''s own visit is unplanned.';
    end if;
  end if;

  return new;
end
$$;

-- What a visit IS does not change after it exists. A plan moving an unstarted visit changes its plan,
-- clinic and time; reassignment cancels it and makes a new one. Nothing rewrites its origin.
create or replace function public.visit_origin_is_fixed()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.origin is distinct from old.origin
     or new.planned_date is distinct from old.planned_date
     or new.unplanned_reason is distinct from old.unplanned_reason then
    raise exception 'a visit''s origin, planned date and reason are fixed when it is created'
      using errcode = '42501';
  end if;
  if new.mr_id is distinct from old.mr_id then
    raise exception 'a visit stays with its rep; reassign planned work with reassign_planned_visits'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.visit_origin_is_fixed() from public;

create trigger visits_origin_is_fixed
  before update of origin, planned_date, unplanned_reason, mr_id on public.visits
  for each row execute function public.visit_origin_is_fixed();

-- ---------------------------------------------------------------------------
-- 10. Sync: a rep's visit arrives as UNPLANNED, with a reason, or not at all
-- ---------------------------------------------------------------------------
-- `apply_sync_item` is `20261006000200`'s definition with the visit branch changed. A visit on a
-- plan is refused: the plan created it, and a second copy from the phone would be the duplicate the
-- unique index exists to stop. Each refusal has its own code, so none is silent.

CREATE OR REPLACE FUNCTION public.apply_sync_item(p_entity sync_entity_kind, p_entity_id uuid, p_payload jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
  v_row_id    uuid;
  v_check_in  public.check_ins;
  v_reason    text;
begin
  v_uid := (select auth.uid());

  v_row_id := nullif(p_payload ->> 'id', '')::uuid;
  if v_row_id is null and p_entity not in ('visit', 'recording', 'voice_note') then
    raise exception 'a % item carries no id of its own', p_entity using errcode = '22023';
  end if;

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null then
        raise exception 'planned_visit_from_plan_only: a visit on a plan is created by the plan'
          using errcode = '22023',
                hint = 'BE-C78. Check in against the planned visit the plan sent; a visit of your own is unplanned.';
      end if;
      if coalesce(p_payload ->> 'origin', '') <> 'unplanned' then
        raise exception 'visit_origin_required: a visit sent from the phone is unplanned'
          using errcode = '22023',
                hint = 'Send origin "unplanned" and a reason.';
      end if;
      v_reason := btrim(coalesce(p_payload ->> 'unplannedReason', ''));
      if char_length(v_reason) < 3 then
        raise exception 'unplanned_visit_needs_reason'
          using errcode = '22023',
                hint = 'An unplanned visit records why it happened (at least 3 characters).';
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at,
                                 origin, unplanned_reason)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              null,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz,
              'unplanned',
              v_reason)
      on conflict (id) do nothing;

    when 'check_in' then
      v_check_in := public.record_check_in(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

      if v_check_in.geofence_status = 'outside' then
        v_warnings := array_append(v_warnings, 'check_in_outside_geofence');
      end if;
      if v_check_in.location_is_approximate is true then
        v_warnings := array_append(v_warnings, 'check_in_location_approximate');
      end if;
      -- A check-in against a planned visit whose plan has since been revised: accepted, and said.
      if exists (select 1 from public.visits v where v.id = (p_payload ->> 'visitId')::uuid
                   and v.beat_plan_id is not null and public.beat_plan_is_stale(v.beat_plan_id)) then
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

    when 'check_out' then
      perform public.record_check_out(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source,
        nullif(p_payload ->> 'notMetReason', ''));

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          v_row_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      -- BE-W74. A CAPTURE goes through capture_consent, exactly as check_in goes through
      -- record_check_in. Before this, the offline path did a direct INSERT, so every bound
      -- FIX-02 and FIX-12 built was absent on the one path where they exist to matter --
      -- offline capture is the entire reason FIX-12 validates against captured_at rather
      -- than now(). See the migration header for the proof, both directions.
      --
      -- capture_consent derives doctor_id from the visit and displayed_language from the
      -- version that was actually active at captured_at, so the payload's own `doctorId`
      -- and `displayedLanguage` are deliberately not passed: a client cannot assert either.
      -- It is idempotent on p_id, which is what `on conflict (id) do nothing` was doing.
      if coalesce((p_payload ->> 'isWithdrawal')::boolean, false) then
        -- A WITHDRAWAL is a different act and capture_consent cannot express it: it takes
        -- no supersedes_consent_record_id and no is_withdrawal. The table's own
        -- constraints and the validate_consent_withdrawal trigger are what guard this
        -- shape, and they fire on a direct insert. Routed separately rather than forced
        -- through a function that would have to grow two parameters it has no other use
        -- for.
        insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id,
                                            outcome, not_asked_reason,
                                            consent_text_version_id, displayed_language,
                                            supersedes_consent_record_id, is_withdrawal,
                                            captured_at)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                (p_payload ->> 'doctorId')::uuid,
                v_uid,
                (p_payload ->> 'outcome')::public.consent_outcome,
                nullif(p_payload ->> 'notAskedReason', ''),
                (p_payload ->> 'consentTextVersionId')::uuid,
                p_payload ->> 'displayedLanguage',
                nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
                true,
                (p_payload ->> 'capturedAt')::timestamptz)
        on conflict (id) do nothing;
      else
        perform public.capture_consent(
          v_row_id,
          (p_payload ->> 'visitId')::uuid,
          (p_payload ->> 'outcome')::public.consent_outcome,
          p_payload ->> 'displayedLanguage',
          (p_payload ->> 'consentTextVersionId')::uuid,
          nullif(p_payload ->> 'notAskedReason', ''),
          (p_payload ->> 'capturedAt')::timestamptz);
      end if;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (v_row_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    when 'recording', 'voice_note' then
      -- The bytes are already in storage; this is the finalisation. complete_upload
      -- re-checks consent one last time, so a withdrawal that arrived while the
      -- device was offline stops the row from ever being created.
      if nullif(p_payload ->> 'uploadGrantId', '') is null then
        raise exception 'a % item must carry its uploadGrantId', p_entity
          using errcode = '22023';
      end if;

      perform public.complete_upload(
        (p_payload ->> 'uploadGrantId')::uuid,
        p_entity_id,
        (p_payload ->> 'durationSeconds')::integer,
        (p_payload ->> 'sizeBytes')::bigint,
        coalesce((p_payload ->> 'recordedAt')::timestamptz, now()),
        nullif(p_payload ->> 'bitrateKbps', '')::integer);

    when 'adverse_event' then
      -- W2-C B / `BE-W159`, `BE-C36`. The rep FLAGS a possible adverse event; nothing more. Through
      -- `report_adverse_event`, which already exists and already enforces everything the flag
      -- needs: the visit must be the caller's (42501), there must be words (22023), and the id is
      -- the idempotency key, so a replay is the same report and the same statutory clock.
      perform public.report_adverse_event(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        p_payload ->> 'reportedText',
        nullif(p_payload ->> 'clientReportedAt', '')::timestamptz);

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Boundary
-- ---------------------------------------------------------------------------

-- The rep no longer writes plans. Every plan write is `write_plan_version`, through the RPCs above.
drop policy beat_plans_insert_own on public.beat_plans;
drop policy beat_plans_update_own on public.beat_plans;
drop policy beat_plan_entries_write_own_plan on public.beat_plan_entries;
revoke insert, update, delete on table public.beat_plans from authenticated;
revoke insert, update, delete on table public.beat_plan_entries from authenticated;

alter table public.planning_territory_grants enable row level security;
alter table public.planning_territory_grants force row level security;
alter table public.planning_territory_grant_revocations enable row level security;
alter table public.planning_territory_grant_revocations force row level security;
alter table public.plan_reassignments enable row level security;
alter table public.plan_reassignments force row level security;
alter table public.unplanned_visit_reviews enable row level security;
alter table public.unplanned_visit_reviews force row level security;

revoke all on table public.planning_territory_grants from anon, authenticated;
revoke all on table public.planning_territory_grant_revocations from anon, authenticated;
revoke all on table public.plan_reassignments from anon, authenticated;
revoke all on table public.unplanned_visit_reviews from anon, authenticated;
revoke update, delete, truncate on table public.planning_territory_grants from service_role;
revoke update, delete, truncate on table public.planning_territory_grant_revocations from service_role;
revoke update, delete, truncate on table public.plan_reassignments from service_role;
revoke update, delete, truncate on table public.unplanned_visit_reviews from service_role;

-- Grants: the admins of the organisation, and the manager the grant is for.
create policy planning_grants_select on public.planning_territory_grants
  for select to authenticated
  using (manager_id = (select auth.uid())
         or (public.current_app_role() = 'admin'
             and organisation_id = public.current_user_organisation_id()));

create policy planning_grant_revocations_select on public.planning_territory_grant_revocations
  for select to authenticated
  using (grant_id in (select g.id from public.planning_territory_grants g));

-- Reassignments: the manager who made one, either rep, and the admins of the organisation.
create policy plan_reassignments_select on public.plan_reassignments
  for select to authenticated
  using (reassigned_by_user_id = (select auth.uid())
         or from_mr_id = (select auth.uid())
         or to_mr_id = (select auth.uid())
         or from_mr_id in (select public.visible_user_ids())
         or (public.current_app_role() = 'admin'
             and organisation_id = public.current_user_organisation_id()));

-- Reviews: the reviewer, and whoever can see the visit.
create policy unplanned_visit_reviews_select on public.unplanned_visit_reviews
  for select to authenticated
  using (reviewer_id = (select auth.uid())
         or visit_id in (select v.id from public.visits v));

create policy planning_grants_tenant_boundary on public.planning_territory_grants
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy plan_reassignments_tenant_boundary on public.plan_reassignments
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

grant select on table public.planning_territory_grants to authenticated;
grant select on table public.planning_territory_grant_revocations to authenticated;
grant select on table public.plan_reassignments to authenticated;
grant select on table public.unplanned_visit_reviews to authenticated;
