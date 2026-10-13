-- Rollback for `BE-W187` (20261013000210_console_territory_admin): the console can no longer read
-- or edit the territory tree or its hours; edits go back to the SQL editor.
--
-- WHAT ROLLING BACK MEANS. Territories created or renamed, and hours set or cleared, through
-- these functions STAY as they are -- they are ordinary rows, audited by the existing triggers. Roll
-- the console (`/territories`) back with this.

drop function if exists public.admin_clear_territory_hours(uuid);
drop function if exists public.admin_set_territory_hours(uuid, time, time, text, integer, smallint[]);
drop function if exists public.admin_rename_territory(uuid, text);
drop function if exists public.admin_create_territory(text, text, uuid);
drop function if exists public.territory_tree();
drop function if exists public.console_territory_json(uuid);
