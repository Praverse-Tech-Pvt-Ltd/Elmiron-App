-- Rollback for BE-W14 -- the audit log read path.
--
-- WHAT APPLYING THIS MEANS. The console has no way to read `audit_log` again. The table is
-- still written on every auditable action and is still queryable in SQL by anyone with
-- database access; what goes is the scoped, admin-only, self-auditing view of it.
--
-- Nothing else depends on this function: it is a read path added in MR-39 and the append-only
-- trigger, the RLS posture and every writer are untouched by its removal.
--
-- `FE-W13`'s audit screen consumes it. Roll that back with this or the screen renders an error.

drop function if exists public.list_audit_log(integer, bigint, text);
