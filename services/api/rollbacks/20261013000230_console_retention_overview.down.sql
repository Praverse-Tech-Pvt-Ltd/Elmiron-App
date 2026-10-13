-- Rollback for `BE-W189` (20261013000230_console_retention_overview): an admin can no longer see
-- the retention worker's runs. `retention_status` (the compliance panel's four figures) and the
-- worker itself are untouched. No row changes: the reads recorded stay in `audit_log`. Roll the
-- console (`/retention`) back with this.

drop function if exists public.retention_overview(text, integer);
