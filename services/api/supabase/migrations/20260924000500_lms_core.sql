-- ============================================================================
-- AI-B2 -- LMS core: courses, versions, modules, lessons, assignments, enrolments, completions.
-- ============================================================================
--
-- `docs/ai-platform/phase-a-recon.md` §1.9: no LMS exists. This is the half of one that does not
-- wait on a decision.
--
-- **What is deliberately NOT here, and why.**
-- * **No score, grade, mark, percentage or pass/fail.** `.ai-collab/constraints.md` forbids a
--   score on `analyses` or "the manager surface", and a manager will read enrolments. Whether a
--   training assessment is exempt is X2 in the Phase A doc -- a decision for a named person, not
--   for a migration. Assessments, attempts and certificates arrive after it.
-- * **No AI.** Nothing here calls a model or stores model output.
-- * **Nothing about a patient or a doctor.** Lessons are training text an admin wrote.
--
-- **The shape, and the one rule everything else follows from: a published version never
-- changes.** The master prompt: "All course/version history must be preserved. Do not overwrite
-- completed training history." So:
-- * A `course` is only a name. Its content lives in `course_versions`.
-- * A version is `draft` (editable by an admin), then `published` (frozen -- its own fields, its
--   modules and its lessons), then `retired` (still frozen, no new enrolments).
-- * Publishing a version retires the previous published version of the same course **for the
--   same market** (`market_id`, null = not market-specific). A learner already enrolled keeps
--   the version they started: an enrolment pins a version, so what someone completed is always
--   the exact text they read.
-- * Lesson completions are append-only. A course's `completed_at` is stamped once, by the
--   server, when the last lesson is completed, and never changes.
--
-- **Who does what.**
-- * Admin: writes courses, drafts, modules and lessons (direct table writes, policy-checked),
--   and publishes/retires through RPCs -- a state change with validity rules is an RPC
--   (`constraints.md`, "Put a write with a validity rule behind an RPC").
-- * Admin and field manager: assign a course to someone they can already see
--   (`visible_user_ids()`), with an optional due date.
-- * Anyone signed in: starts a published course and completes its lessons, for themselves only.
--   Assignment is not required to learn; it is a requirement with a date, not a gate.
-- * Read: course content -- everyone in the organisation, drafts only for admins. Assignments,
--   enrolments, completions -- whoever `visible_user_ids()` already lets see that person: the MR
--   themselves, their manager's subtree, their organisation's admin.
--
-- **Clocks are the server's.** Every time here that means something -- published, retired,
-- assigned, started, completed -- is `clock_timestamp()`, never a parameter.
--
-- **Not yet called by anything.** No screen reads or writes these tables yet. Per the master
-- prompt §56 and `constraints.md` ("Check that anything you build is actually called by
-- something"), that makes the whole feature UNVERIFIED until an app exercises it.

-- ----------------------------------------------------------------------------
-- 1. Types and tables
-- ----------------------------------------------------------------------------

create type public.course_version_status as enum ('draft', 'published', 'retired');

create table public.courses (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.current_user_organisation_id()
                  references public.organisations (id) on delete restrict,
  title           text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint courses_title_present check (length(btrim(title)) > 0)
);

create table public.course_versions (
  id                   uuid primary key default gen_random_uuid(),
  -- Derived from the course by trigger.
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  course_id            uuid not null references public.courses (id) on delete restrict,
  -- Assigned by trigger: the next number for this course.
  version_number       integer not null,
  status               public.course_version_status not null default 'draft',
  title                text not null,
  summary              text,
  product_id           uuid references public.products (id) on delete restrict,
  -- Null = not specific to a market ("global" training content).
  market_id            uuid references public.markets (id) on delete restrict,
  published_at         timestamptz,
  published_by_user_id uuid references public.user_profiles (id) on delete restrict,
  retired_at           timestamptz,
  retired_by_user_id   uuid references public.user_profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint course_versions_number_once unique (course_id, version_number),
  constraint course_versions_title_present check (length(btrim(title)) > 0),
  constraint course_versions_published_is_stamped
    check (status = 'draft' or (published_at is not null and published_by_user_id is not null)),
  constraint course_versions_retired_is_stamped
    check (status <> 'retired' or (retired_at is not null and retired_by_user_id is not null))
);

create index course_versions_course_idx on public.course_versions (course_id, status);

create table public.course_modules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  course_version_id uuid not null references public.course_versions (id) on delete restrict,
  position          integer not null,
  title             text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint course_modules_position_positive check (position > 0),
  constraint course_modules_title_present check (length(btrim(title)) > 0)
);

create index course_modules_version_idx on public.course_modules (course_version_id, position);

create table public.lessons (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  module_id         uuid not null references public.course_modules (id) on delete restrict,
  -- Denormalised from the module so the freeze check and the read policy are one lookup.
  course_version_id uuid not null references public.course_versions (id) on delete restrict,
  position          integer not null,
  title             text not null,
  body              text not null,
  estimated_minutes integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lessons_position_positive check (position > 0),
  constraint lessons_title_present check (length(btrim(title)) > 0),
  constraint lessons_body_present check (length(btrim(body)) > 0),
  constraint lessons_minutes_positive check (estimated_minutes is null or estimated_minutes > 0)
);

create index lessons_module_idx on public.lessons (module_id, position);
create index lessons_version_idx on public.lessons (course_version_id);

create table public.course_assignments (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  course_id            uuid not null references public.courses (id) on delete restrict,
  assignee_user_id     uuid not null references public.user_profiles (id) on delete restrict,
  assigned_by_user_id  uuid not null references public.user_profiles (id) on delete restrict,
  due_on               date,
  assigned_at          timestamptz not null default clock_timestamp(),
  cancelled_at         timestamptz,
  cancelled_by_user_id uuid references public.user_profiles (id) on delete restrict,
  constraint course_assignments_cancel_is_stamped
    check ((cancelled_at is null) = (cancelled_by_user_id is null))
);

-- One live assignment of a course per person. A cancelled one stays, as history.
create unique index course_assignments_one_live
  on public.course_assignments (course_id, assignee_user_id) where cancelled_at is null;
create index course_assignments_assignee_idx on public.course_assignments (assignee_user_id);

create table public.course_enrolments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  user_id           uuid not null references public.user_profiles (id) on delete restrict,
  course_version_id uuid not null references public.course_versions (id) on delete restrict,
  started_at        timestamptz not null default clock_timestamp(),
  completed_at      timestamptz,
  constraint course_enrolments_once unique (user_id, course_version_id)
);

create index course_enrolments_user_idx on public.course_enrolments (user_id);

create table public.lesson_completions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enrolment_id    uuid not null references public.course_enrolments (id) on delete restrict,
  -- Denormalised from the enrolment so the read policy needs no join.
  user_id         uuid not null references public.user_profiles (id) on delete restrict,
  lesson_id       uuid not null references public.lessons (id) on delete restrict,
  completed_at    timestamptz not null default clock_timestamp(),
  constraint lesson_completions_once unique (enrolment_id, lesson_id)
);

create index lesson_completions_user_idx on public.lesson_completions (user_id);

-- ----------------------------------------------------------------------------
-- 2. The freeze, and tenancy derivation
-- ----------------------------------------------------------------------------

/**
 * course_versions, BEFORE INSERT: tenant from the course, next version number, born a draft.
 *
 * The status and stamp columns are not merely defaulted but FORCED here, because the admin's
 * insert grant covers the whole row and a default is only a suggestion.
 */
create or replace function public.course_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_org uuid;
begin
  select c.organisation_id into v_course_org from public.courses c where c.id = new.course_id;
  new.organisation_id := v_course_org;

  select coalesce(max(v.version_number), 0) + 1 into new.version_number
    from public.course_versions v where v.course_id = new.course_id;

  new.status := 'draft';
  new.published_at := null;
  new.published_by_user_id := null;
  new.retired_at := null;
  new.retired_by_user_id := null;

  if new.product_id is not null and not exists (
    select 1 from public.products p
     where p.id = new.product_id and p.organisation_id = new.organisation_id) then
    raise exception 'course_versions: product is not in this organisation' using errcode = '23514';
  end if;
  if new.market_id is not null and not exists (
    select 1 from public.markets m
     where m.id = new.market_id and m.organisation_id = new.organisation_id) then
    raise exception 'course_versions: market is not in this organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger course_versions_before_insert
  before insert on public.course_versions
  for each row execute function public.course_versions_before_insert();

/**
 * course_versions, BEFORE UPDATE: a version that has left draft does not change, except by the
 * one legal transition (published -> retired, stamped). Draft -> published is also legal.
 * Nothing else is: not a content edit, not a re-publish, not an un-retire.
 *
 * Enforced here rather than by column grants alone because `publish_course_version` and
 * `retire_course_version` run as the owner, and so would any future function; the trigger holds
 * for every role that can write the table.
 */
create or replace function public.course_versions_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.course_id is distinct from old.course_id
     or new.organisation_id is distinct from old.organisation_id
     or new.version_number is distinct from old.version_number then
    raise exception 'course_versions: identity columns cannot change' using errcode = '23514';
  end if;

  if old.status <> 'draft' and (
       new.title is distinct from old.title
       or new.summary is distinct from old.summary
       or new.product_id is distinct from old.product_id
       or new.market_id is distinct from old.market_id
       or new.published_at is distinct from old.published_at
       or new.published_by_user_id is distinct from old.published_by_user_id) then
    raise exception 'course version % is % and cannot be edited; create a new version',
      old.id, old.status
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'published')
       or (old.status = 'published' and new.status = 'retired')) then
    raise exception 'course version % cannot go from % to %', old.id, old.status, new.status
      using errcode = '23514';
  end if;

  if old.status = 'retired' and (new.retired_at is distinct from old.retired_at
       or new.retired_by_user_id is distinct from old.retired_by_user_id) then
    raise exception 'course version % is retired and cannot change', old.id
      using errcode = '23514';
  end if;

  if new.product_id is not null and new.product_id is distinct from old.product_id
     and not exists (select 1 from public.products p
                      where p.id = new.product_id and p.organisation_id = new.organisation_id) then
    raise exception 'course_versions: product is not in this organisation' using errcode = '23514';
  end if;
  if new.market_id is not null and new.market_id is distinct from old.market_id
     and not exists (select 1 from public.markets m
                      where m.id = new.market_id and m.organisation_id = new.organisation_id) then
    raise exception 'course_versions: market is not in this organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger course_versions_before_update
  before update on public.course_versions
  for each row execute function public.course_versions_before_update();

/**
 * Modules and lessons: tenant and version derived from the parent, and the parent version must
 * be a draft for any insert, update or delete. This is the other half of "a published version
 * never changes" -- a version whose own row is frozen but whose lessons can be rewritten is not
 * frozen.
 */
create or replace function public.course_content_is_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_org        uuid;
  v_status     public.course_version_status;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.course_version_id;
  elsif tg_table_name = 'lessons' then
    select m.course_version_id into v_version_id from public.course_modules m where m.id = new.module_id;
  else
    v_version_id := new.course_version_id;
  end if;

  select v.organisation_id, v.status into v_org, v_status
    from public.course_versions v where v.id = v_version_id;

  if v_status is distinct from 'draft' then
    raise exception 'course version % is %; its content cannot change', v_version_id, v_status
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'lessons'
     and old.course_version_id is distinct from v_version_id then
    raise exception 'lessons: a lesson cannot move to another course version' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'course_modules'
     and new.course_version_id is distinct from old.course_version_id then
    raise exception 'course_modules: a module cannot move to another course version'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.organisation_id := v_org;
  if tg_table_name = 'lessons' then
    new.course_version_id := v_version_id;
  end if;
  return new;
end;
$$;

create trigger course_modules_is_draft
  before insert or update or delete on public.course_modules
  for each row execute function public.course_content_is_draft();
create trigger lessons_is_draft
  before insert or update or delete on public.lessons
  for each row execute function public.course_content_is_draft();

create or replace function public.courses_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'courses: organisation_id cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger courses_before_update
  before update on public.courses
  for each row execute function public.courses_before_update();

/** An enrolment's completion is stamped once and never moves. Nothing else about it changes. */
create or replace function public.course_enrolments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.course_version_id is distinct from old.course_version_id
     or new.organisation_id is distinct from old.organisation_id
     or new.started_at is distinct from old.started_at
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'course_enrolments: only an unset completed_at may be set' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger course_enrolments_before_update
  before update on public.course_enrolments
  for each row execute function public.course_enrolments_before_update();

create trigger course_enrolments_reject_delete
  before delete or truncate on public.course_enrolments
  for each statement execute function public.reject_mutation();

-- Append-only, the way `consent_records` is: a statement-level trigger (fires even for a
-- zero-row statement) plus revoked grants -- two mechanisms (`constraints.md`, BE-W2).
create trigger lesson_completions_reject_mutation
  before update or delete or truncate on public.lesson_completions
  for each statement execute function public.reject_mutation();

-- An assignment may be cancelled once. Nothing else about it changes.
create or replace function public.course_assignments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.cancelled_at is not null
     or new.id is distinct from old.id
     or new.organisation_id is distinct from old.organisation_id
     or new.course_id is distinct from old.course_id
     or new.assignee_user_id is distinct from old.assignee_user_id
     or new.assigned_by_user_id is distinct from old.assigned_by_user_id
     or new.due_on is distinct from old.due_on
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'course_assignments: an assignment can only be cancelled, once'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger course_assignments_before_update
  before update on public.course_assignments
  for each row execute function public.course_assignments_before_update();

create trigger course_assignments_reject_delete
  before delete or truncate on public.course_assignments
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 3. updated_at and audit
-- ----------------------------------------------------------------------------

create trigger courses_set_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
create trigger course_versions_set_updated_at before update on public.course_versions
  for each row execute function public.set_updated_at();
create trigger course_modules_set_updated_at before update on public.course_modules
  for each row execute function public.set_updated_at();
create trigger lessons_set_updated_at before update on public.lessons
  for each row execute function public.set_updated_at();

create trigger courses_audit after insert or update or delete on public.courses
  for each row execute function public.write_audit_row();
create trigger course_versions_audit after insert or update or delete on public.course_versions
  for each row execute function public.write_audit_row();
create trigger course_modules_audit after insert or update or delete on public.course_modules
  for each row execute function public.write_audit_row();
create trigger lessons_audit after insert or update or delete on public.lessons
  for each row execute function public.write_audit_row();
create trigger course_assignments_audit after insert or update on public.course_assignments
  for each row execute function public.write_audit_row();
create trigger course_enrolments_audit after insert or update on public.course_enrolments
  for each row execute function public.write_audit_row();
create trigger lesson_completions_audit after insert on public.lesson_completions
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 4. The RPCs
-- ----------------------------------------------------------------------------
--
-- Refusals follow the existing convention (`respond_to_analysis`): 28000 no identity, 42501 not
-- yours / not permitted, 22023 invalid request or wrong state. No new 45xxx code is added: none
-- of these refusals is one an MR could act on differently from "refresh and try again", and a
-- new code is a contract change for every client (`refusals.ts`, `error-contract.spec.ts`).

/** The caller, active, and their organisation -- or a refusal. */
create or replace function public.lms_caller()
returns table (user_id uuid, organisation_id uuid, role public.app_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return query
    select p.id, p.organisation_id, p.role
      from public.user_profiles p
     where p.id = v_uid and p.is_active and p.organisation_id is not null;
  if not found then
    raise exception 'no active profile' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.publish_course_version(p_course_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  record;
  v_version public.course_versions%rowtype;
  v_now     timestamptz := clock_timestamp();
  v_retired uuid[];
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin publishes a course version' using errcode = '42501';
  end if;

  select * into v_version from public.course_versions v
   where v.id = p_course_version_id and v.organisation_id = v_caller.organisation_id
   for update;
  if v_version.id is null then
    raise exception 'course version % is not in your organisation', p_course_version_id
      using errcode = '42501';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'course version % is already %', v_version.id, v_version.status
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.lessons l where l.course_version_id = v_version.id) then
    raise exception 'course version % has no lessons', v_version.id using errcode = '22023';
  end if;

  -- The version it supersedes: same course, same market (null matches null).
  with superseded as (
    update public.course_versions v
       set status = 'retired', retired_at = v_now, retired_by_user_id = v_caller.user_id
     where v.course_id = v_version.course_id
       and v.status = 'published'
       and v.market_id is not distinct from v_version.market_id
    returning v.id
  )
  select coalesce(array_agg(id), '{}') into v_retired from superseded;

  update public.course_versions
     set status = 'published', published_at = v_now, published_by_user_id = v_caller.user_id
   where id = v_version.id;

  return jsonb_build_object(
    'courseVersionId', v_version.id,
    'status', 'published',
    'publishedAt', v_now,
    'retiredCourseVersionIds', to_jsonb(v_retired));
end;
$$;

create or replace function public.retire_course_version(p_course_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_now    timestamptz := clock_timestamp();
  v_id     uuid;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin retires a course version' using errcode = '42501';
  end if;
  if not exists (select 1 from public.course_versions v
                  where v.id = p_course_version_id
                    and v.organisation_id = v_caller.organisation_id) then
    raise exception 'course version % is not in your organisation', p_course_version_id
      using errcode = '42501';
  end if;

  update public.course_versions v
     set status = 'retired', retired_at = v_now, retired_by_user_id = v_caller.user_id
   where v.id = p_course_version_id and v.status = 'published'
  returning v.id into v_id;
  if v_id is null then
    raise exception 'course version % is not published', p_course_version_id using errcode = '22023';
  end if;

  return jsonb_build_object('courseVersionId', v_id, 'status', 'retired', 'retiredAt', v_now);
end;
$$;

create or replace function public.assign_course(
  p_course_id uuid,
  p_assignee_user_id uuid,
  p_due_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_row    public.course_assignments%rowtype;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role not in ('admin', 'field_manager') then
    raise exception 'only an admin or a field manager assigns a course' using errcode = '42501';
  end if;

  -- Someone the caller can already see, and nobody else. The same helper the read policies use,
  -- so assigning can never reach further than reading.
  if p_assignee_user_id is null
     or p_assignee_user_id not in (select public.visible_user_ids()) then
    raise exception 'user % is not in your scope', p_assignee_user_id using errcode = '42501';
  end if;
  if not exists (select 1 from public.courses c
                  where c.id = p_course_id and c.organisation_id = v_caller.organisation_id) then
    raise exception 'course % is not in your organisation', p_course_id using errcode = '42501';
  end if;
  if not exists (select 1 from public.course_versions v
                  where v.course_id = p_course_id and v.status = 'published') then
    raise exception 'course % has no published version to take', p_course_id
      using errcode = '22023';
  end if;
  -- Not validated against the server's date: a due date in the past is a manager's mistake
  -- that shows up as overdue, not a rule. Due/overdue is computed at read, never stored
  -- (`constraints.md`, "A property that depends on the clock cannot ride sync_pull").

  -- Idempotent: assigning what is already assigned returns the live assignment.
  select * into v_row from public.course_assignments a
   where a.course_id = p_course_id and a.assignee_user_id = p_assignee_user_id
     and a.cancelled_at is null;

  if v_row.id is null then
    insert into public.course_assignments
      (organisation_id, course_id, assignee_user_id, assigned_by_user_id, due_on)
    values (v_caller.organisation_id, p_course_id, p_assignee_user_id, v_caller.user_id, p_due_on)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'courseId', v_row.course_id,
    'assigneeUserId', v_row.assignee_user_id,
    'assignedByUserId', v_row.assigned_by_user_id,
    'dueOn', v_row.due_on,
    'assignedAt', v_row.assigned_at);
end;
$$;

create or replace function public.cancel_course_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_now    timestamptz := clock_timestamp();
  v_id     uuid;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role not in ('admin', 'field_manager') then
    raise exception 'only an admin or a field manager cancels an assignment' using errcode = '42501';
  end if;
  if not exists (select 1 from public.course_assignments a
                  where a.id = p_assignment_id
                    and a.assignee_user_id in (select public.visible_user_ids())) then
    raise exception 'assignment % is not in your scope', p_assignment_id using errcode = '42501';
  end if;

  update public.course_assignments a
     set cancelled_at = v_now, cancelled_by_user_id = v_caller.user_id
   where a.id = p_assignment_id and a.cancelled_at is null
  returning a.id into v_id;
  if v_id is null then
    raise exception 'assignment % is already cancelled', p_assignment_id using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_id, 'cancelledAt', v_now);
end;
$$;

/** Start (or resume) a published course version, for the caller only. Idempotent. */
create or replace function public.start_course_version(p_course_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_row    public.course_enrolments%rowtype;
begin
  select * into v_caller from public.lms_caller();

  select * into v_row from public.course_enrolments e
   where e.user_id = v_caller.user_id and e.course_version_id = p_course_version_id;

  if v_row.id is null then
    if not exists (select 1 from public.course_versions v
                    where v.id = p_course_version_id
                      and v.organisation_id = v_caller.organisation_id) then
      raise exception 'course version % is not in your organisation', p_course_version_id
        using errcode = '42501';
    end if;
    -- Only a new enrolment needs a published version. Someone who started before the version
    -- was retired resumes it: what they finish is what they began.
    if not exists (select 1 from public.course_versions v
                    where v.id = p_course_version_id and v.status = 'published') then
      raise exception 'course version % is not open for new learners', p_course_version_id
        using errcode = '22023';
    end if;
    insert into public.course_enrolments (organisation_id, user_id, course_version_id)
    values (v_caller.organisation_id, v_caller.user_id, p_course_version_id)
    on conflict (user_id, course_version_id) do nothing
    returning * into v_row;
    if v_row.id is null then
      -- Lost a race with our own concurrent call; read what won.
      select * into v_row from public.course_enrolments e
       where e.user_id = v_caller.user_id and e.course_version_id = p_course_version_id;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'courseVersionId', v_row.course_version_id,
    'startedAt', v_row.started_at,
    'completedAt', v_row.completed_at);
end;
$$;

/**
 * Complete one lesson of one of the caller's own enrolments. Idempotent. When the last lesson of
 * the version is done, the enrolment's `completed_at` is stamped -- by the server, once.
 */
create or replace function public.complete_lesson(p_enrolment_id uuid, p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller      record;
  v_enrolment   public.course_enrolments%rowtype;
  v_completion  public.lesson_completions%rowtype;
  v_total       integer;
  v_done        integer;
begin
  select * into v_caller from public.lms_caller();

  select * into v_enrolment from public.course_enrolments e
   where e.id = p_enrolment_id and e.user_id = v_caller.user_id
   for update;
  if v_enrolment.id is null then
    raise exception 'enrolment % is not yours', p_enrolment_id using errcode = '42501';
  end if;
  if not exists (select 1 from public.lessons l
                  where l.id = p_lesson_id and l.course_version_id = v_enrolment.course_version_id) then
    raise exception 'lesson % is not part of this course version', p_lesson_id using errcode = '22023';
  end if;

  insert into public.lesson_completions (organisation_id, enrolment_id, user_id, lesson_id)
  values (v_enrolment.organisation_id, v_enrolment.id, v_enrolment.user_id, p_lesson_id)
  on conflict (enrolment_id, lesson_id) do nothing
  returning * into v_completion;
  if v_completion.id is null then
    select * into v_completion from public.lesson_completions c
     where c.enrolment_id = v_enrolment.id and c.lesson_id = p_lesson_id;
  end if;

  select count(*) into v_total from public.lessons l
   where l.course_version_id = v_enrolment.course_version_id;
  select count(*) into v_done from public.lesson_completions c
   where c.enrolment_id = v_enrolment.id;

  if v_enrolment.completed_at is null and v_done >= v_total then
    update public.course_enrolments
       set completed_at = clock_timestamp()
     where id = v_enrolment.id
    returning * into v_enrolment;
  end if;

  return jsonb_build_object(
    'enrolmentId', v_enrolment.id,
    'lessonId', v_completion.lesson_id,
    'lessonCompletedAt', v_completion.completed_at,
    'lessonsCompleted', v_done,
    'lessonsTotal', v_total,
    'courseCompletedAt', v_enrolment.completed_at);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Privileges -- revoke before grant
-- ----------------------------------------------------------------------------

revoke all on table
  public.courses, public.course_versions, public.course_modules, public.lessons,
  public.course_assignments, public.course_enrolments, public.lesson_completions
  from public, anon, authenticated, service_role;

revoke all on type public.course_version_status from public, anon;
grant usage on type public.course_version_status to authenticated;

-- Content: an admin writes, through policies. The status and stamp columns of a version are not
-- in the UPDATE grant -- they move only through the RPCs.
grant select, insert on table public.courses to authenticated;
grant update (title, is_active) on table public.courses to authenticated;
grant select, insert on table public.course_versions to authenticated;
grant update (title, summary, product_id, market_id) on table public.course_versions to authenticated;
grant select, insert, update, delete on table public.course_modules, public.lessons to authenticated;

-- Learning records: read directly, written only through the RPCs.
grant select on table public.course_assignments, public.course_enrolments, public.lesson_completions
  to authenticated;

revoke all on function
  public.course_versions_before_insert(),
  public.course_versions_before_update(),
  public.course_content_is_draft(),
  public.courses_before_update(),
  public.course_enrolments_before_update(),
  public.course_assignments_before_update(),
  public.lms_caller(),
  public.publish_course_version(uuid),
  public.retire_course_version(uuid),
  public.assign_course(uuid, uuid, date),
  public.cancel_course_assignment(uuid),
  public.start_course_version(uuid),
  public.complete_lesson(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.publish_course_version(uuid),
  public.retire_course_version(uuid),
  public.assign_course(uuid, uuid, date),
  public.cancel_course_assignment(uuid),
  public.start_course_version(uuid),
  public.complete_lesson(uuid, uuid)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Row-level security
-- ----------------------------------------------------------------------------

alter table public.courses enable row level security;
alter table public.courses force row level security;
alter table public.course_versions enable row level security;
alter table public.course_versions force row level security;
alter table public.course_modules enable row level security;
alter table public.course_modules force row level security;
alter table public.lessons enable row level security;
alter table public.lessons force row level security;
alter table public.course_assignments enable row level security;
alter table public.course_assignments force row level security;
alter table public.course_enrolments enable row level security;
alter table public.course_enrolments force row level security;
alter table public.lesson_completions enable row level security;
alter table public.lesson_completions force row level security;

/**
 * Is this version's content visible to the caller? Admins see drafts; everyone else sees what
 * has been published, including what has since been retired (a learner mid-course keeps it).
 *
 * `status` is resolved inside the function rather than joined in each policy, so the content
 * policies stay one predicate each.
 */
create or replace function public.course_version_readable(p_course_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.course_versions v
     where v.id = p_course_version_id
       and v.organisation_id = public.current_user_organisation_id()
       and (v.status <> 'draft' or public.is_admin()));
$$;

revoke all on function public.course_version_readable(uuid) from public, anon, authenticated;
grant execute on function public.course_version_readable(uuid) to authenticated;

-- Read
create policy courses_select_own_organisation on public.courses
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());
create policy course_versions_select_readable on public.course_versions
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id()
         and (status <> 'draft' or public.is_admin()));
create policy course_modules_select_readable on public.course_modules
  for select to authenticated
  using (public.course_version_readable(course_version_id));
create policy lessons_select_readable on public.lessons
  for select to authenticated
  using (public.course_version_readable(course_version_id));
create policy course_assignments_select_visible on public.course_assignments
  for select to authenticated
  using (assignee_user_id in (select public.visible_user_ids()));
create policy course_enrolments_select_visible on public.course_enrolments
  for select to authenticated
  using (user_id in (select public.visible_user_ids()));
create policy lesson_completions_select_visible on public.lesson_completions
  for select to authenticated
  using (user_id in (select public.visible_user_ids()));

-- Write: content, admin only, own organisation.
create policy courses_admin_insert on public.courses
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy courses_admin_update on public.courses
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

-- The version's organisation is derived by trigger BEFORE the policy check, so the check sees
-- the course's organisation, not whatever the caller sent.
create policy course_versions_admin_insert on public.course_versions
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy course_versions_admin_update on public.course_versions
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy course_modules_admin_write on public.course_modules
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy lessons_admin_write on public.lessons
  for all to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

-- The boundary, RESTRICTIVE, on every table -- expression copied from `20260908001300`.
create policy courses_tenant_boundary on public.courses
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy course_versions_tenant_boundary on public.course_versions
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy course_modules_tenant_boundary on public.course_modules
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy lessons_tenant_boundary on public.lessons
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy course_assignments_tenant_boundary on public.course_assignments
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy course_enrolments_tenant_boundary on public.course_enrolments
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy lesson_completions_tenant_boundary on public.lesson_completions
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 7. Self-checks
-- ----------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_fn    text;
begin
  foreach v_table in array array['courses', 'course_versions', 'course_modules', 'lessons',
                                 'course_assignments', 'course_enrolments',
                                 'lesson_completions'] loop
    if not (select c.relforcerowsecurity from pg_class c
             where c.oid = format('public.%I', v_table)::regclass) then
      raise exception 'AI-B2: RLS is not forced on %', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'truncate') then
      raise exception 'AI-B2: % is reachable by anon, or truncatable', v_table;
    end if;
    if not exists (select 1 from pg_policy p
                    where p.polrelid = format('public.%I', v_table)::regclass
                      and not p.polpermissive and p.polname = v_table || '_tenant_boundary') then
      raise exception 'AI-B2: % has no restrictive tenant boundary', v_table;
    end if;
  end loop;

  -- Learning records are written only through the RPCs.
  foreach v_table in array array['course_assignments', 'course_enrolments', 'lesson_completions'] loop
    if has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'AI-B2: % must be written only through its RPC', v_table;
    end if;
  end loop;

  -- A version's status cannot be set directly.
  if has_column_privilege('authenticated', 'public.course_versions', 'status', 'update') then
    raise exception 'AI-B2: course_versions.status must move only through the RPCs';
  end if;

  foreach v_fn in array array['public.publish_course_version(uuid)', 'public.complete_lesson(uuid,uuid)',
                              'public.lms_caller()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'AI-B2: % is executable by anon', v_fn;
    end if;
  end loop;
end;
$$;
