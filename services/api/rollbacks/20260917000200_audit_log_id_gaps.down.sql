-- Rollback for MR-43 B1 -- the audit_log.id gap comment.
--
-- WHAT APPLYING THIS MEANS. The column comment goes; nothing else changes. No data, no
-- constraint, no grant and no behaviour is touched by either direction of this migration --
-- it adds a sentence to the catalogue and this removes it.
--
-- It is worth saying what is LOST, because it is not nothing: an auditor who finds a gap in
-- an append-only ledger's ids no longer finds the reason at the table. They find it only in
-- `docs/gotchas.md` and in PROJECT-OVERVIEW's MR-43 section, which are in a repository they
-- may not have open, at a moment when the obvious reading is that a row was deleted.

comment on column public.audit_log.id is null;
