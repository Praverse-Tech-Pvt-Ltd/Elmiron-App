-- Rollback for 20260811000200_consent_ledger.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: this destroys the consent ledger. A consent record is the legal basis for
-- every recording that references it. Export before running this anywhere real.

drop trigger if exists consent_records_reject_mutation      on public.consent_records;
drop trigger if exists consent_records_validate_withdrawal  on public.consent_records;
drop table if exists public.consent_records;

drop trigger if exists consent_text_versions_reject_delete  on public.consent_text_versions;
drop trigger if exists consent_text_versions_reject_rewrite on public.consent_text_versions;
drop table if exists public.consent_text_versions;

drop function if exists public.reject_consent_text_rewrite();
drop function if exists public.sha256_hex(text);
drop type if exists public.consent_outcome;

-- reject_mutation is shared with audit_log; drop it only after that migration is
-- rolled back too.
drop function if exists public.reject_mutation();
