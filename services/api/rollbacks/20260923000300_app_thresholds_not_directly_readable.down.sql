-- Rollback for MR-52 D -- restores the direct read on app_thresholds, and with it the defect:
-- any signed-in user reads any company's territory settings and the user id that set them.
--
-- The deadline row is NOT removed: `app_thresholds` is append-only by trigger, so a row cannot be
-- deleted, and a dated acceptance surviving a rollback is the correct direction anyway.

drop function if exists public.be_w106_decision_status();

grant select on public.app_thresholds to authenticated;
create policy app_thresholds_select_authenticated on public.app_thresholds
  for select to authenticated
  using (true);
