-- Rollback for MR-26 B1 -- `consent_text_versions.updated_at`.
--
-- Drops the trigger and then the column, in that order: the trigger reads the column, and
-- dropping the column first would leave `set_updated_at` firing against a field that is no
-- longer there.
--
-- `if exists` on both, so this is safe to apply to a schema where the migration never ran --
-- `verify:rollbacks` applies every rollback in reverse order against whatever state the
-- previous ones left behind.
--
-- Nothing else reads `updated_at` on this table once `sync_pull`'s arm is gone, which the
-- rollback beside this one removes first.

drop trigger if exists consent_text_versions_set_updated_at on public.consent_text_versions;

alter table public.consent_text_versions drop column if exists updated_at;
