-- W1-V C (`BE-W138`) — the rejection log becomes append-only, the way every other record of what
-- happened is.
--
-- W1-T B4 swept the catalogue: 31 tables guarded as history, by `reject_mutation` or a guarded update
-- trigger; `write_rejections` (`20261001000300`) was the one record-of-what-happened table with
-- neither. Users could never change it — `authenticated` holds SELECT only, under forced RLS — but
-- the table owner and anything running as it (every SECURITY DEFINER function, a service-role
-- session, a dashboard SQL editor) could UPDATE, DELETE or TRUNCATE a rejection and leave the count
-- `count_write_rejections()` reports quietly wrong.
--
-- Matched to its fully append-only peers (`audit_log`, `consent_records`, `call_reports`,
-- `audio_destruction_log`, `app_thresholds`, ...): ONE statement-level trigger, BEFORE DELETE OR
-- UPDATE OR TRUNCATE, executing the shared `reject_mutation()` (SQLSTATE 23001). The other
-- protections those peers carry this table already has — grants revoked from anon / authenticated /
-- service_role with SELECT back to authenticated only, RLS enabled AND forced, foreign keys
-- `on delete restrict`. INSERT is untouched: `sync_push` and `complete_upload` still write it.

create trigger write_rejections_reject_mutation
  before delete or update or truncate on public.write_rejections
  for each statement execute function public.reject_mutation();
