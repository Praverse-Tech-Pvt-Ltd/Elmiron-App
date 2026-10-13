-- Rollback for 20261013000300_work_day_sync_kind.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- DELIBERATELY EMPTY, for the reason `20260816000100_vocabulary_additions.down.sql` gives: Postgres
-- cannot remove a value from an enum, and rebuilding `sync_entity_kind` would mean rewriting
-- `sync_items`, the rep's durable record of what the server accepted and refused.
--
-- With `20261013000310` rolled back first (reverse order), `apply_sync_item` has no `work_day`
-- branch, so an item of that kind is refused `0A000` ("not yet accepted by sync") -- the truth. The
-- type itself is dropped by `20260813000200_offline_sync.down.sql`, which runs after this file.

select 'no-op: enum values cannot be removed; the parent type is dropped downstream'
  as rollback_note;
