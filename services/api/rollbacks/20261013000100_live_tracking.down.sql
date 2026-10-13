-- Rollback for `BE-W180` / `BE-W181` (20261013000100_live_tracking). Live tracking stops existing.
--
-- WHAT ROLLING BACK MEANS:
--   * Every stored position, every rep's acceptance and withdrawal, and every notice version and
--     approval are DROPPED with their tables. The positions were promised deletion at 90 days; this
--     deletes them sooner, which breaks no promise. The acceptance ledger is evidence of what each
--     rep agreed to -- export it first if anybody may need it.
--   * `live_tracking_enabled` rows stay in `app_thresholds` (append-only by trigger) and are read by
--     nothing once the functions are gone.
--   * `write_rejections` rows for `record_location_ping` stay (append-only). The entry-point check is
--     restored to its earlier list as NOT VALID, so it binds new rows without failing on those.
--   * The CLIENTS must roll back with this: the field app's tracker (`EXPO_PUBLIC_LIVE_TRACKING`) and
--     the console's `/tracking` page call functions that no longer exist, and the retention worker
--     calls `purge_expired_location_pings` -- revert `purge-expired-audio.mjs` in the same change.

drop function if exists public.purge_expired_location_pings(integer);
drop function if exists public.approve_live_tracking_notice(uuid, text);
drop function if exists public.propose_live_tracking_notice(text, text);
drop function if exists public.set_live_tracking_enabled(boolean, text);
drop function if exists public.live_tracking_trail(uuid, date);
drop function if exists public.live_tracking_overview();
drop function if exists public.record_location_ping(uuid, double precision, double precision, double precision, timestamptz);
drop function if exists public.withdraw_live_tracking();
drop function if exists public.accept_live_tracking_notice(uuid);
drop function if exists public.my_live_tracking();
drop function if exists public.live_tracking_status_for(public.user_profiles);
drop function if exists public.live_tracking_rep();
drop function if exists public.live_tracking_interval_seconds();
drop function if exists public.live_tracking_company_enabled();
drop function if exists public.live_tracking_within_hours(uuid, timestamptz);
drop function if exists public.live_tracking_accepted_version(uuid);
drop function if exists public.current_live_tracking_notice(uuid);

drop table if exists public.location_pings;
drop table if exists public.live_tracking_acceptances;
drop table if exists public.live_tracking_notice_approvals;
drop table if exists public.live_tracking_notice_versions;

drop function if exists public.location_pings_delete_only_expired();
drop function if exists public.location_pings_stamp();
drop function if exists public.live_tracking_notice_approval_valid();

alter table public.write_rejections drop constraint if exists write_rejections_entry_point_known;
alter table public.write_rejections
  add constraint write_rejections_entry_point_known
  check (entry_point in ('sync_push', 'complete_upload')) not valid;
