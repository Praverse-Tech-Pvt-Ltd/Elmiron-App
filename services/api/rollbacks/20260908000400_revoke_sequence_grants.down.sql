-- Rollback for 20260908000400_revoke_sequence_grants.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the grant that let `anon` call setval() on the audit log's identity sequence.
-- There is no good reason to apply this. It exists because every migration in this
-- schema has a rollback, and because a rollback file that has never been executed is a
-- claim rather than a rollback -- `verify:rollbacks` runs this one.
--
-- If it is ever applied, `privilege-posture.spec.ts` will fail the build immediately,
-- which is the correct behaviour and is the whole point of that test.

grant usage, select, update on sequence public.audit_log_id_seq                       to anon;
grant usage, select, update on sequence public.audio_destruction_log_id_seq           to anon;
grant usage, select, update on sequence public.restore_reconciliation_findings_id_seq to anon;
