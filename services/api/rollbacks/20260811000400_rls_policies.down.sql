-- Rollback for 20260811000400_rls_policies.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
-- Run the BE-W2 rollbacks in reverse order: 400, 300, 200, 100.

drop view if exists public.visit_summary;

drop policy if exists consent_records_insert_own                on public.consent_records;
drop policy if exists consent_text_versions_select_authenticated on public.consent_text_versions;
drop policy if exists samples_and_inputs_insert_own             on public.samples_and_inputs;
drop policy if exists samples_and_inputs_select_own_or_team     on public.samples_and_inputs;
drop policy if exists call_reports_update_own_not_approval      on public.call_reports;
drop policy if exists call_reports_insert_own                   on public.call_reports;
drop policy if exists call_reports_select_own_or_team           on public.call_reports;
drop policy if exists check_outs_insert_own                     on public.check_outs;
drop policy if exists check_outs_select_own_or_team             on public.check_outs;
drop policy if exists check_ins_insert_own                      on public.check_ins;
drop policy if exists check_ins_select_own_or_team              on public.check_ins;
drop policy if exists visits_update_own                         on public.visits;
drop policy if exists visits_insert_own                         on public.visits;
drop policy if exists visits_select_own_or_team                 on public.visits;
drop policy if exists beat_plan_entries_write_own_plan          on public.beat_plan_entries;
drop policy if exists beat_plan_entries_select_via_plan         on public.beat_plan_entries;
drop policy if exists beat_plans_update_own                     on public.beat_plans;
drop policy if exists beat_plans_insert_own                     on public.beat_plans;
drop policy if exists beat_plans_select_own_or_team             on public.beat_plans;
drop policy if exists clinic_addresses_admin_all                on public.clinic_addresses;
drop policy if exists clinic_addresses_select_visible_doctor    on public.clinic_addresses;
drop policy if exists doctors_admin_all                         on public.doctors;
drop policy if exists doctors_select_in_territory               on public.doctors;
drop policy if exists user_profiles_admin_all                   on public.user_profiles;
drop policy if exists user_profiles_select_team                 on public.user_profiles;
drop policy if exists territories_admin_all                     on public.territories;
drop policy if exists organisations_admin_all                   on public.organisations;
drop policy if exists organisations_select_authenticated        on public.organisations;

drop function if exists public.is_admin();
drop function if exists public.effective_role();
