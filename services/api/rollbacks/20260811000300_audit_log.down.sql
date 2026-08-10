-- Rollback for 20260811000300_audit_log.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: dropping audit_log destroys the audit trail. In a deployed environment
-- that is almost certainly the wrong thing to do — export it first.

drop function if exists public.respond_to_analysis(uuid, text);
drop function if exists public.approve_call_report(uuid, boolean, text);
drop function if exists public.list_consent_records(uuid, text);
drop function if exists public.read_consent_record(uuid, text);
drop function if exists public.list_analyses(uuid, text);
drop function if exists public.read_analysis(uuid, text);

drop trigger if exists consent_text_versions_audit on public.consent_text_versions;
drop trigger if exists consent_records_audit       on public.consent_records;
drop trigger if exists analyses_audit              on public.analyses;
drop trigger if exists samples_and_inputs_audit    on public.samples_and_inputs;
drop trigger if exists call_reports_audit          on public.call_reports;
drop trigger if exists visits_audit                on public.visits;
drop trigger if exists doctors_audit               on public.doctors;
drop trigger if exists territories_audit           on public.territories;
drop trigger if exists user_profiles_audit         on public.user_profiles;

drop function if exists public.write_audit_row();

-- The append-only trigger has to go before the table can be dropped.
drop trigger if exists audit_log_reject_mutation on public.audit_log;
drop table if exists public.audit_log;
drop type if exists public.audit_action;

drop function if exists public.current_client_ip();
drop function if exists public.current_request_id();
