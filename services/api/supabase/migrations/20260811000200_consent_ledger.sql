-- ============================================================================
-- BE-W2 · The consent ledger
--
-- A doctor's consent is the legal basis for the entire recording feature. Three
-- properties have to hold, and none of them can be left to RLS:
--
--   1. Records are immutable. No UPDATE, no DELETE, by ANY role.
--   2. Withdrawal is a new row referencing the original, never an edit.
--   3. A record cannot exist without the exact consent text version that was shown.
--
-- Why triggers rather than the absence of an UPDATE policy: `service_role` and
-- `postgres` both hold the BYPASSRLS attribute (measured, see the commercial schema
-- migration). RLS is not evaluated for them at all, so "no UPDATE policy" stops
-- neither. A trigger is not skipped by BYPASSRLS. Grants are revoked as well, so
-- both layers have to be defeated.
--
-- The triggers are STATEMENT-level on purpose. A row-level trigger never fires for
-- an UPDATE that matches no rows, so an out-of-scope UPDATE would report
-- "0 rows affected" and look like a success. Statement-level fires before the scan
-- and errors every time.
--
-- Rollback: services/api/rollbacks/20260811000200_consent_ledger.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The shared refusal trigger
-- ----------------------------------------------------------------------------

create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not permitted by any role', tg_table_name, tg_op
    using errcode = 'restrict_violation',
          hint = 'Withdrawal and correction are new rows, never edits.';
end;
$$;

comment on function public.reject_mutation() is
  'Statement-level guard for append-only tables. Fires for every role including '
  'service_role and postgres, which BYPASSRLS makes invisible to RLS policies.';

-- ----------------------------------------------------------------------------
-- 2. The outcome enum — exactly three values, all of them valid
-- ----------------------------------------------------------------------------

-- Mirrors ConsentOutcome in packages/core. Adding a fourth value, or reordering
-- these so `declined` reads as a failure state, is a review conversation.
create type public.consent_outcome as enum ('consented', 'declined', 'not_asked');

-- ----------------------------------------------------------------------------
-- 3. Consent text versions
-- ----------------------------------------------------------------------------

-- convert_to() is STABLE, not IMMUTABLE — it depends on the database encoding — so
-- it cannot appear in a generated column directly. This wrapper pins the encoding
-- to a literal, which makes the result deterministic for this database, and is
-- marked IMMUTABLE on that basis. The database is UTF8; if that ever changes, this
-- promise breaks and so do the stored hashes.
create or replace function public.sha256_hex(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

create table public.consent_text_versions (
  id             uuid primary key default gen_random_uuid(),
  version_label  text not null check (length(btrim(version_label)) > 0),
  language       text not null check (length(btrim(language)) >= 2),
  full_text      text not null check (length(btrim(full_text)) > 0),
  -- Generated, not supplied. A caller-provided hash is a claim; this is a fact.
  hash           text generated always as (public.sha256_hex(full_text)) stored,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at     timestamptz not null default now(),
  constraint consent_text_versions_unique_label_language unique (version_label, language),
  constraint consent_text_versions_effective_range
    check (effective_until is null or effective_until > effective_from)
);

create index consent_text_versions_language_idx on public.consent_text_versions (language, effective_from desc);

-- The text itself is immutable. Retiring a version is allowed; rewriting one is
-- not — if the displayed text can change after the fact, every consent record
-- pointing at it becomes unprovable, which is the whole failure this table exists
-- to prevent.
create or replace function public.reject_consent_text_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.version_label <> old.version_label
     or new.language <> old.language
     or new.full_text <> old.full_text
     or new.effective_from <> old.effective_from
     or new.created_at <> old.created_at then
    raise exception 'consent_text_versions is immutable except for effective_until'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger consent_text_versions_reject_rewrite
  before update on public.consent_text_versions
  for each row execute function public.reject_consent_text_rewrite();

create trigger consent_text_versions_reject_delete
  before delete or truncate on public.consent_text_versions
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 4. Consent records
-- ----------------------------------------------------------------------------

-- There is no penalty column, no flag column, no score column and no compliance
-- column on this table, and there must never be one. All three outcomes are valid
-- completions of a visit. `declined` is an ordinary, expected result: the doctor is
-- not an employee and cannot be compelled. The visit proceeds, the voice note is
-- still captured, and nothing about the MR's record changes.
create table public.consent_records (
  -- Device-generated so the offline queue is idempotent.
  id                          uuid primary key,
  visit_id                    uuid not null references public.visits (id) on delete restrict,
  doctor_id                   uuid not null references public.doctors (id) on delete restrict,
  captured_by_mr_id           uuid not null references public.user_profiles (id) on delete restrict,
  outcome                     public.consent_outcome not null,
  not_asked_reason            text,
  -- The version that was actually displayed, not the version current today.
  consent_text_version_id     uuid not null references public.consent_text_versions (id) on delete restrict,
  displayed_language          text not null check (length(btrim(displayed_language)) >= 2),
  -- Set when this row withdraws an earlier consent. The earlier row is untouched.
  supersedes_consent_record_id uuid references public.consent_records (id) on delete restrict,
  is_withdrawal               boolean not null default false,
  captured_at                 timestamptz not null,
  created_at                  timestamptz not null default now(),

  constraint consent_records_not_asked_has_reason
    check (outcome <> 'not_asked' or not_asked_reason is not null),
  constraint consent_records_reason_only_when_not_asked
    check (outcome = 'not_asked' or not_asked_reason is null),
  constraint consent_records_withdrawal_references_original
    check (is_withdrawal = false or supersedes_consent_record_id is not null),
  constraint consent_records_supersede_implies_withdrawal
    check (supersedes_consent_record_id is null or is_withdrawal = true),
  -- A withdrawal says the doctor no longer consents. Modelling it as anything else
  -- would leave the ledger reading as though consent still stood.
  constraint consent_records_withdrawal_is_declined
    check (is_withdrawal = false or outcome = 'declined'),
  constraint consent_records_no_self_supersede
    check (supersedes_consent_record_id is null or supersedes_consent_record_id <> id)
);

create index consent_records_visit_id_idx  on public.consent_records (visit_id);
create index consent_records_doctor_id_idx on public.consent_records (doctor_id, captured_at desc);
create index consent_records_mr_id_idx     on public.consent_records (captured_by_mr_id, captured_at desc);
create index consent_records_supersedes_idx on public.consent_records (supersedes_consent_record_id)
  where supersedes_consent_record_id is not null;

comment on table public.consent_records is
  'Append-only consent ledger. Withdrawal is a new row. All three outcomes are '
  'valid completions; declined carries no penalty anywhere in this schema.';

-- Only a record that actually granted consent can be withdrawn, and a withdrawal
-- must concern the same doctor. Cross-referencing a different doctor''s consent
-- would produce a ledger that reads correctly row by row and is wrong as a whole.
create or replace function public.validate_consent_withdrawal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original public.consent_records%rowtype;
begin
  if new.supersedes_consent_record_id is null then
    return new;
  end if;

  select * into v_original
    from public.consent_records c
   where c.id = new.supersedes_consent_record_id;

  if not found then
    raise exception 'consent record % does not exist', new.supersedes_consent_record_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_original.outcome <> 'consented' then
    raise exception 'consent record % has outcome %; only a granted consent can be withdrawn',
      v_original.id, v_original.outcome
      using errcode = 'check_violation';
  end if;

  if v_original.doctor_id <> new.doctor_id then
    raise exception 'withdrawal is for doctor % but the original consent is for doctor %',
      new.doctor_id, v_original.doctor_id
      using errcode = 'check_violation';
  end if;

  if v_original.is_withdrawal then
    raise exception 'consent record % is itself a withdrawal', v_original.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger consent_records_validate_withdrawal
  before insert on public.consent_records
  for each row execute function public.validate_consent_withdrawal();

-- Immutability. Statement-level, so a zero-row UPDATE errors instead of quietly
-- reporting success.
create trigger consent_records_reject_mutation
  before update or delete or truncate on public.consent_records
  for each statement execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- 5. Privilege revocations
-- ----------------------------------------------------------------------------

-- The triggers above are the enforcement. These revocations mean an attacker has
-- to defeat two independent layers, and they make the intent legible in \dp.
revoke all on table public.consent_text_versions from anon, authenticated;
revoke all on table public.consent_records       from anon, authenticated;

revoke update, delete, truncate on table public.consent_text_versions from service_role;
revoke update, delete, truncate on table public.consent_records       from service_role;
