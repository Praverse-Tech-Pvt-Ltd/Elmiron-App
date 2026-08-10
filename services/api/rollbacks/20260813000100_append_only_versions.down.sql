-- Rollback for 20260813000100_append_only_versions.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: this collapses call reports back to a single mutable row per visit. If more
-- than one version exists for any visit, the unique constraint below will fail —
-- which is correct. Decide which version survives before forcing it.

drop function if exists public.beat_plan_is_stale(uuid);
drop view if exists public.beat_plan_current;

alter table public.beat_plans drop constraint if exists beat_plans_no_self_supersede;
alter table public.beat_plans drop constraint if exists beat_plans_v1_supersedes_nothing;
alter table public.beat_plans drop constraint if exists beat_plans_one_per_mr_per_day_version;
drop index if exists public.beat_plans_supersedes_idx;
alter table public.beat_plans drop column if exists supersedes_beat_plan_id;
alter table public.beat_plans drop column if exists version;
alter table public.beat_plans add constraint beat_plans_one_per_mr_per_day unique (mr_id, plan_date);

drop function if exists public.revise_call_report(uuid, uuid, text, uuid[], text, text, public.call_report_status);
drop function if exists public.approve_call_report(uuid, boolean, text);
drop view if exists public.call_report_current;

drop policy if exists call_report_approvals_select_scope on public.call_report_approvals;
drop trigger if exists call_report_approvals_reject_mutation  on public.call_report_approvals;
drop trigger if exists call_report_approvals_audit            on public.call_report_approvals;
drop trigger if exists call_report_approvals_stamp_received_at on public.call_report_approvals;
drop table if exists public.call_report_approvals;

drop trigger if exists call_reports_reject_mutation on public.call_reports;
drop trigger if exists call_reports_validate_version on public.call_reports;
drop function if exists public.validate_call_report_version();

alter table public.call_reports drop constraint if exists call_reports_author_status;
alter table public.call_reports drop constraint if exists call_reports_no_self_supersede;
alter table public.call_reports drop constraint if exists call_reports_v1_supersedes_nothing;
alter table public.call_reports drop constraint if exists call_reports_one_per_visit_version;
drop index if exists public.call_reports_supersedes_idx;
drop index if exists public.call_reports_visit_version_idx;
alter table public.call_reports drop column if exists supersedes_call_report_id;
alter table public.call_reports drop column if exists version;

alter table public.call_reports add constraint call_reports_one_per_visit unique (visit_id);
alter table public.call_reports
  add column approved_by_user_id uuid references public.user_profiles (id) on delete set null,
  add column approved_at timestamptz;
alter table public.call_reports
  add constraint call_reports_approval_is_attributed
    check (status <> 'approved' or (approved_by_user_id is not null and approved_at is not null));

grant update on table public.call_reports to authenticated;
create policy call_reports_update_own_not_approval
  on public.call_reports for update to authenticated
  using (mr_id = (select auth.uid()))
  with check (mr_id = (select auth.uid()) and status <> 'approved');
