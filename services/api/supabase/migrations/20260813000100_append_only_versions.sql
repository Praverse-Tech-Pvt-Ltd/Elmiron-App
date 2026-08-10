-- ============================================================================
-- BE-W4 (1 of 2) · Eliminating conflicts before resolving them
--
-- An MR works a full day with no signal and syncs at 6pm. Merge logic for that is
-- hard to get right and impossible to reason about later. Append-only data has no
-- conflicts at all — only ordering, which received_at and occurred_at already
-- handle. So this migration removes the mutability rather than writing merge rules
-- for it.
--
--   call_reports  — an edit becomes a NEW VERSION referencing the previous one
--   beat_plans    — same, so an MR working yesterday's plan keeps a valid reference
--
-- Approval moves OUT of call_reports into its own append-only table. It has to:
-- once the report is immutable, an UPDATE that sets `approved` is not available,
-- and pushing approval into a new *version* would make the manager an author of the
-- report — the one thing the brief says a manager must never be.
--
-- Rollback: services/api/rollbacks/20260813000100_append_only_versions.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Call reports become append-only versions
-- ----------------------------------------------------------------------------

-- The withdrawn approval columns. Their replacement is call_report_approvals.
alter table public.call_reports drop constraint call_reports_approval_is_attributed;
alter table public.call_reports drop column approved_by_user_id;
alter table public.call_reports drop column approved_at;

-- One row per visit becomes one row per visit per version.
alter table public.call_reports drop constraint call_reports_one_per_visit;

alter table public.call_reports
  add column version integer not null default 1 check (version >= 1),
  add column supersedes_call_report_id uuid references public.call_reports (id) on delete restrict;

alter table public.call_reports
  add constraint call_reports_one_per_visit_version unique (visit_id, version),
  add constraint call_reports_v1_supersedes_nothing
    check ((version = 1) = (supersedes_call_report_id is null)),
  add constraint call_reports_no_self_supersede
    check (supersedes_call_report_id is null or supersedes_call_report_id <> id),
  -- The author sets draft or submitted. approved and rejected are decisions, and a
  -- decision is a row in call_report_approvals made by somebody else.
  add constraint call_reports_author_status
    check (status in ('draft', 'submitted'));

create index call_reports_visit_version_idx on public.call_reports (visit_id, version desc);
create index call_reports_supersedes_idx on public.call_reports (supersedes_call_report_id)
  where supersedes_call_report_id is not null;

-- A new version must belong to the same visit and the same author, and must not
-- fork: two versions cannot both supersede the same parent.
create or replace function public.validate_call_report_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.call_reports%rowtype;
begin
  if new.supersedes_call_report_id is null then
    return new;
  end if;

  select * into v_parent
    from public.call_reports c
   where c.id = new.supersedes_call_report_id;

  if not found then
    raise exception 'call report % does not exist', new.supersedes_call_report_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_parent.visit_id <> new.visit_id then
    raise exception 'a call report version must stay on the same visit'
      using errcode = 'check_violation';
  end if;

  if v_parent.mr_id <> new.mr_id then
    raise exception 'a call report version must keep the same author'
      using errcode = 'check_violation';
  end if;

  if new.version <> v_parent.version + 1 then
    raise exception 'version % does not follow version %', new.version, v_parent.version
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.call_reports c
              where c.supersedes_call_report_id = new.supersedes_call_report_id) then
    raise exception 'call report % has already been superseded', new.supersedes_call_report_id
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger call_reports_validate_version
  before insert on public.call_reports
  for each row execute function public.validate_call_report_version();

-- Same two-layer model as the consent ledger: the trigger binds BYPASSRLS roles,
-- the revoked grant binds everyone else, and the statement-level scope means a
-- zero-row UPDATE errors instead of reporting success.
create trigger call_reports_reject_mutation
  before update or delete or truncate on public.call_reports
  for each statement execute function public.reject_mutation();

drop policy if exists call_reports_update_own_not_approval on public.call_reports;
revoke update, delete, truncate on table public.call_reports from authenticated;
revoke update, delete, truncate on table public.call_reports from service_role;

-- ----------------------------------------------------------------------------
-- 2. Approval as its own append-only record
-- ----------------------------------------------------------------------------

create table public.call_report_approvals (
  id               uuid primary key default gen_random_uuid(),
  call_report_id   uuid not null references public.call_reports (id) on delete restrict,
  decided_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  approved         boolean not null,
  reason           text,
  decided_at       timestamptz not null default now(),
  received_at      timestamptz not null default clock_timestamp(),
  created_at       timestamptz not null default now(),
  -- A reversal is a new row referencing the one it reverses, never an edit.
  supersedes_approval_id uuid references public.call_report_approvals (id) on delete restrict,
  constraint call_report_approvals_no_self_supersede
    check (supersedes_approval_id is null or supersedes_approval_id <> id)
);

create index call_report_approvals_report_idx on public.call_report_approvals (call_report_id, decided_at desc);

create trigger call_report_approvals_stamp_received_at
  before insert on public.call_report_approvals
  for each row execute function public.stamp_received_at();

create trigger call_report_approvals_audit
  after insert on public.call_report_approvals
  for each row execute function public.write_audit_row();

create trigger call_report_approvals_reject_mutation
  before update or delete or truncate on public.call_report_approvals
  for each statement execute function public.reject_mutation();

comment on table public.call_report_approvals is
  'Append-only approval decisions. Separate from call_reports so that a manager can '
  'decide without ever authoring the report they are deciding on.';

-- ----------------------------------------------------------------------------
-- 3. The current view
-- ----------------------------------------------------------------------------

-- security_invoker so the call_reports policy remains the scope filter. Asserted
-- for every view in the public schema by services/api/tests/rls.spec.ts.
create view public.call_report_current
with (security_invoker = true) as
  select cr.*,
         a.approved      as approval_decision,
         a.decided_by_user_id,
         a.decided_at,
         case
           when a.id is null then cr.status::text
           when a.approved then 'approved'
           else 'rejected'
         end as effective_status
    from public.call_reports cr
    left join lateral (
      select ap.*
        from public.call_report_approvals ap
       where ap.call_report_id = cr.id
       order by ap.decided_at desc, ap.received_at desc
       limit 1
    ) a on true
   where not exists (
     select 1 from public.call_reports newer where newer.supersedes_call_report_id = cr.id
   );

-- ----------------------------------------------------------------------------
-- 4. Authoring a new version, and deciding on one
-- ----------------------------------------------------------------------------

create or replace function public.revise_call_report(
  p_id                  uuid,
  p_supersedes_id       uuid,
  p_summary             text,
  p_product_ids         uuid[] default '{}',
  p_objections_raised   text default null,
  p_next_step           text default null,
  p_status              public.call_report_status default 'submitted'
)
returns public.call_reports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_parent public.call_reports%rowtype;
  v_existing public.call_reports%rowtype;
  v_row    public.call_reports%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotent on the client-generated id, like every other capture path.
  select * into v_existing from public.call_reports c where c.id = p_id;
  if found then
    if v_existing.mr_id <> v_uid then
      raise exception 'call report % belongs to another user', p_id using errcode = '42501';
    end if;
    return v_existing;
  end if;

  select * into v_parent from public.call_reports c where c.id = p_supersedes_id and c.mr_id = v_uid;
  if not found then
    raise exception 'call report % is not yours', p_supersedes_id using errcode = '42501';
  end if;

  insert into public.call_reports
    (id, visit_id, mr_id, summary, product_ids_discussed, objections_raised, next_step,
     status, draft_source, version, supersedes_call_report_id)
  values
    (p_id, v_parent.visit_id, v_uid, p_summary, p_product_ids, p_objections_raised, p_next_step,
     p_status, v_parent.draft_source, v_parent.version + 1, p_supersedes_id)
  returning * into v_row;

  return v_row;
end;
$$;

-- The return type changes from call_reports to call_report_approvals, so this is a
-- drop-and-create rather than a replace.
drop function if exists public.approve_call_report(uuid, boolean, text);

create or replace function public.approve_call_report(
  p_call_report_id uuid,
  p_approved       boolean,
  p_reason         text default null
)
returns public.call_report_approvals
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_role   public.app_role;
  v_report public.call_reports%rowtype;
  v_row    public.call_report_approvals%rowtype;
  v_prior  uuid;
begin
  v_uid  := (select auth.uid());
  v_role := public.effective_role();

  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if v_role not in ('field_manager', 'admin') then
    raise exception 'only a field_manager or admin may decide a call report'
      using errcode = '42501';
  end if;

  select * into v_report
    from public.call_reports cr
   where cr.id = p_call_report_id
     and (v_role = 'admin' or cr.mr_id in (select public.visible_user_ids()));

  if v_report.id is null then
    raise exception 'call report % is not in your scope', p_call_report_id using errcode = '42501';
  end if;

  if v_report.mr_id = v_uid then
    raise exception 'the author of a call report may not decide it' using errcode = '42501';
  end if;

  if v_report.status <> 'submitted' then
    raise exception 'call report % is %; only a submitted report can be decided',
      p_call_report_id, v_report.status using errcode = '22023';
  end if;

  if exists (select 1 from public.call_reports newer
              where newer.supersedes_call_report_id = p_call_report_id) then
    raise exception 'call report % has been superseded by a newer version', p_call_report_id
      using errcode = '22023';
  end if;

  -- A change of mind is a new row referencing the previous decision.
  select ap.id into v_prior
    from public.call_report_approvals ap
   where ap.call_report_id = p_call_report_id
   order by ap.decided_at desc
   limit 1;

  insert into public.call_report_approvals
    (call_report_id, decided_by_user_id, approved, reason, supersedes_approval_id)
  values
    (p_call_report_id, v_uid, p_approved, p_reason, v_prior)
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Beat plans become append-only versions
-- ----------------------------------------------------------------------------

-- The stale-plan case: a manager revises the plan while the MR is offline working
-- the old one. Versioning means the MR's visits keep pointing at the version they
-- actually worked, and the manager's revision exists alongside it. Neither is
-- discarded, and there is nothing to merge.
alter table public.beat_plans drop constraint beat_plans_one_per_mr_per_day;

alter table public.beat_plans
  add column version integer not null default 1 check (version >= 1),
  add column supersedes_beat_plan_id uuid references public.beat_plans (id) on delete restrict;

alter table public.beat_plans
  add constraint beat_plans_one_per_mr_per_day_version unique (mr_id, plan_date, version),
  add constraint beat_plans_v1_supersedes_nothing
    check ((version = 1) = (supersedes_beat_plan_id is null)),
  add constraint beat_plans_no_self_supersede
    check (supersedes_beat_plan_id is null or supersedes_beat_plan_id <> id);

create index beat_plans_supersedes_idx on public.beat_plans (supersedes_beat_plan_id)
  where supersedes_beat_plan_id is not null;

create view public.beat_plan_current
with (security_invoker = true) as
  select bp.*
    from public.beat_plans bp
   where not exists (
     select 1 from public.beat_plans newer where newer.supersedes_beat_plan_id = bp.id
   );

-- Is the beat plan this work was filed against still the current one? Used by
-- sync_push to warn rather than reject: the MR's work is valid either way.
create or replace function public.beat_plan_is_stale(p_beat_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.beat_plans newer where newer.supersedes_beat_plan_id = p_beat_plan_id
  );
$$;

-- ----------------------------------------------------------------------------
-- 6. Boundary
-- ----------------------------------------------------------------------------

alter table public.call_report_approvals enable row level security;
alter table public.call_report_approvals force row level security;

revoke all on table public.call_report_approvals from anon, authenticated;
revoke update, delete, truncate on table public.call_report_approvals from service_role;

-- An MR must see the decision on their own report; a manager sees their team's.
create policy call_report_approvals_select_scope
  on public.call_report_approvals for select to authenticated
  using (
    call_report_id in (
      select cr.id from public.call_reports cr
       where cr.mr_id in (select public.visible_user_ids())
    )
  );

grant select on table public.call_report_approvals to authenticated;

revoke all on public.call_report_current from anon, authenticated;
revoke all on public.beat_plan_current   from anon, authenticated;
grant select on public.call_report_current to authenticated;
grant select on public.beat_plan_current   to authenticated;

grant execute on function public.revise_call_report(uuid, uuid, text, uuid[], text, text, public.call_report_status) to authenticated;
grant execute on function public.approve_call_report(uuid, boolean, text) to authenticated;
grant execute on function public.beat_plan_is_stale(uuid) to authenticated;
