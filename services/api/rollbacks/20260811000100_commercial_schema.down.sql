-- Rollback for 20260811000100_commercial_schema.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>

drop function if exists public.visible_user_ids();

drop table if exists public.analyses;
drop table if exists public.samples_and_inputs;
drop table if exists public.call_reports;
drop table if exists public.check_outs;
drop table if exists public.check_ins;
drop table if exists public.visits;
drop table if exists public.beat_plan_entries;
drop table if exists public.beat_plans;
drop table if exists public.clinic_addresses;
drop table if exists public.doctors;

alter table public.territories drop column if exists organisation_id;
drop table if exists public.organisations;

drop type if exists public.analysis_status;
drop type if exists public.sample_or_input_kind;
drop type if exists public.call_report_draft_source;
drop type if exists public.call_report_status;
drop type if exists public.capture_source;
drop type if exists public.geofence_status;
drop type if exists public.visit_status;
drop type if exists public.beat_plan_status;

drop trigger if exists user_profiles_validate_reporting_manager on public.user_profiles;
drop function if exists public.validate_reporting_manager();

drop trigger if exists territories_reject_cycle on public.territories;
drop function if exists public.reject_territory_cycle();

-- Back to BE-W1: RLS stays enabled, FORCE comes off.
alter table public.user_profiles no force row level security;
alter table public.territories   no force row level security;
