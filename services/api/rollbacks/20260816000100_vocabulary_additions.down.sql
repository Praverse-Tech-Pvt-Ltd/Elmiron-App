-- Rollback for 20260816000100_vocabulary_additions.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- DELIBERATELY EMPTY, and this is not laziness.
--
-- Postgres cannot remove a value from an enum. There is no `ALTER TYPE ... DROP
-- VALUE` and there never has been; the only way back is to build a replacement type,
-- rewrite every column that uses it, and drop the original — which for
-- `sync_rejection_code` means rewriting `sync_items`, a table that holds an MR's
-- durable record of what the server refused and why.
--
-- Leaving five unused labels behind is strictly safer than that. The same choice was
-- made in BE-W6 for `team_exception_kind`, and for the same reason.
--
-- The types are dropped outright when the migrations that created them are rolled
-- back: `audio_destruction_reason` by 20260815000300.down.sql and
-- `sync_rejection_code` by 20260813000200.down.sql. Both run after this file in
-- reverse order, so the labels do not outlive a full rollback.

select 'no-op: enum values cannot be removed; the parent types are dropped downstream'
  as rollback_note;
