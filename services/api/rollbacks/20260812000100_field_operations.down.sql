-- Rollback for 20260812000100_field_operations.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: dropping received_at destroys the only record of when the server took
-- delivery of each row. There is nothing to backfill it from. Export first if this
-- is run anywhere with real data in it.

drop function if exists public.search_doctors(text, uuid, integer);
drop function if exists public.daily_mileage(date, date, uuid);
drop function if exists public.record_check_out(uuid, uuid, double precision, double precision, timestamptz, double precision, public.capture_source);
drop function if exists public.record_check_in(uuid, uuid, double precision, double precision, timestamptz, double precision, public.capture_source);
drop function if exists public.is_within_shift(uuid, timestamptz);
drop function if exists public.effective_shift_window(uuid);

drop index if exists public.beat_plans_territory_date_idx;
drop index if exists public.doctors_registration_number_idx;
drop index if exists public.doctors_territory_active_name_idx;
drop index if exists public.doctors_specialty_trgm_idx;
drop index if exists public.doctors_full_name_trgm_idx;
-- pg_trgm is deliberately NOT dropped: other objects may come to depend on it, and
-- dropping a shared extension during a rollback is a wider blast radius than this
-- migration owns.

drop policy if exists territory_shift_windows_admin_all       on public.territory_shift_windows;
drop policy if exists territory_shift_windows_select_visible  on public.territory_shift_windows;
drop trigger if exists territory_shift_windows_audit          on public.territory_shift_windows;
drop trigger if exists territory_shift_windows_set_updated_at on public.territory_shift_windows;
drop table if exists public.territory_shift_windows;

alter table public.check_outs drop column if exists duration_seconds;

drop trigger if exists consent_records_stamp_received_at    on public.consent_records;
drop trigger if exists samples_and_inputs_stamp_received_at on public.samples_and_inputs;
drop trigger if exists call_reports_stamp_received_at       on public.call_reports;
drop trigger if exists check_outs_stamp_received_at         on public.check_outs;
drop trigger if exists check_ins_stamp_received_at          on public.check_ins;
drop trigger if exists visits_stamp_received_at             on public.visits;
drop function if exists public.stamp_received_at();

alter table public.consent_records    drop column if exists received_at;
alter table public.samples_and_inputs drop column if exists received_at;
alter table public.call_reports       drop column if exists received_at;
alter table public.check_outs         drop column if exists received_at;
alter table public.check_ins          drop column if exists received_at;
alter table public.visits             drop column if exists received_at;

drop function if exists public.distance_metres(double precision, double precision, double precision, double precision);

-- Restore the BE-W2 direct-insert path that this migration withdrew.
create policy check_ins_insert_own
  on public.check_ins for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

create policy check_outs_insert_own
  on public.check_outs for insert to authenticated
  with check (
    mr_id = (select auth.uid())
    and visit_id in (select v.id from public.visits v where v.mr_id = (select auth.uid()))
  );

grant insert on table public.check_ins  to authenticated;
grant insert on table public.check_outs to authenticated;
