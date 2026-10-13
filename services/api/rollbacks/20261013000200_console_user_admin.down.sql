-- Rollback for `BE-W185` (20261013000200_console_user_admin): the console can no longer list or
-- change users, and accounts go back to being made BY HAND (`docs/DEPLOY-RUNBOOK.md` step 4).
--
-- WHAT ROLLING BACK MEANS. Profiles created or changed through these functions STAY exactly as they
-- are -- they are ordinary `user_profiles` rows, and their audit rows stay in `audit_log`. The
-- provisioning records are dropped with their table, so a creation started and not finished is
-- forgotten: an account it made without a profile is then visible only in the dashboard. Roll the
-- console (`/users`) and the `admin-accounts` Edge Function back with this, or the screen calls
-- functions that no longer exist.

drop function if exists public.admin_authorize_password_reset(uuid, text);
drop function if exists public.admin_set_user_active(uuid, boolean, text);
drop function if exists public.admin_update_user(uuid, text, public.app_role, uuid, uuid, text, text);
drop function if exists public.admin_cancel_user_creation(uuid, text);
drop function if exists public.admin_finish_user_creation(uuid);
drop function if exists public.admin_begin_user_creation(text, text, public.app_role, uuid, uuid, text);
drop function if exists public.admin_list_users(text);
drop function if exists public.console_user_json(uuid);
drop function if exists public.validate_console_profile(uuid, uuid, public.app_role, uuid, uuid);
drop function if exists public.console_audit(public.user_profiles, public.audit_action, text, text, text);
drop function if exists public.territory_depth(uuid);
drop function if exists public.console_admin();

drop table if exists public.user_provisioning;
