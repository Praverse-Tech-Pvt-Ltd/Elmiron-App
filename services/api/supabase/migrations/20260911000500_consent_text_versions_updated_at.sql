-- MR-26 B1 -- `consent_text_versions` gains `updated_at`, so it can ride the pull.
--
-- `sync_pull` orders and cursors every arm on `(updated_at, id)` with `xmin` for visibility.
-- This table had `created_at` and no `updated_at`, so it could not participate.
--
-- WHY `created_at` WOULD NOT DO. The table is immutable except for one column:
-- `reject_consent_text_rewrite` raises `restrict_violation` if `id`, `version_label`,
-- `language`, `full_text`, `effective_from` or `created_at` change. The single permitted
-- UPDATE is setting `effective_until` -- RETIRING a notice. That is precisely the change a
-- client must learn about: a retired notice must stop being offered to a doctor, and FIX-02
-- exists because capturing against a superseded version is the defect that matters here.
-- Cursoring on `created_at` would sync new notices and never sync retirements, which is the
-- wrong half.
--
-- The immutability trigger is deliberately NOT amended: it guards a named list and
-- `updated_at` is not on it, so the column is free to move while everything that makes a
-- notice a legal artefact stays frozen. That is the right shape -- the guard names what must
-- not change rather than what may.
--
-- `set_updated_at` is the same trigger function `visits`, `doctors` and `clinic_addresses`
-- use. Existing rows are backfilled from `created_at` rather than `now()`: a notice published
-- three weeks ago has not been modified since, and stamping them all with the migration's
-- clock would tell every client that every notice had just changed and force a pointless
-- re-download of every `full_text`.

alter table public.consent_text_versions
  add column if not exists updated_at timestamptz not null default now();

update public.consent_text_versions set updated_at = created_at where updated_at <> created_at;

drop trigger if exists consent_text_versions_set_updated_at on public.consent_text_versions;
create trigger consent_text_versions_set_updated_at
  before update on public.consent_text_versions
  for each row execute function public.set_updated_at();
