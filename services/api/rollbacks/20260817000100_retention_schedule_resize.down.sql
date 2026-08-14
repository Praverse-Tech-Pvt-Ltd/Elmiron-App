-- Rollback for 20260817000100_retention_schedule_resize.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- app_thresholds is append-only: the statement-level reject_mutation trigger blocks
-- DELETE for every role, including postgres and service_role, which hold BYPASSRLS.
-- There is nothing this file can do to remove the inserted row directly, and that is
-- by design -- the same reasoning 20260816000300_resumable_upload.down.sql already
-- documents for its own app_thresholds inserts.
--
-- The row is inert once rolled back this far: threshold() always resolves the LATEST
-- effective_from, so if a later migration re-adds an earlier-behaviour row it simply
-- wins by timestamp. The row is permanently removed only when
-- 20260815000100_thresholds_and_shift_defaults.down.sql drops the app_thresholds
-- table entirely, which runs after this file in the reverse-migration-order rollback
-- sequence and takes this row with it.

select 1; -- no-op; see the note above.
