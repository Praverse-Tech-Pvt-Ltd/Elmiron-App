-- Rollback for `BE-W188` (20261013000220_console_audit_search): the audit log can no longer be
-- filtered or paged from the console. `list_audit_log` (the compliance panel's read) is untouched.
-- No row changes: the reads this function recorded stay in `audit_log`. Roll the console
-- (`/audit`) back with this.

drop function if exists public.search_audit_log(text, integer, bigint, uuid, text, text, timestamptz, timestamptz, boolean);
