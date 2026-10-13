-- `BE-W190` -- the rep's working day joins the outbox: one enum value, in a file of its own.
--
-- `.ai-collab/constraints.md`, "Always": an enum value is ADDED in one migration and USED in another,
-- because `ALTER TYPE ... ADD VALUE` cannot be used inside the transaction that adds it and each
-- migration file is one transaction. `20261013000310_work_days` is the file that uses it.
--
-- Rollback: services/api/rollbacks/20261013000300_work_day_sync_kind.down.sql (a no-op: Postgres
-- cannot drop an enum value, and `sync_entity_kind` itself is dropped by the rollback of the
-- migration that created it).

alter type public.sync_entity_kind add value if not exists 'work_day';
