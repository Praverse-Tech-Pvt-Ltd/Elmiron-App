# Constraints

Hard boundaries. Not suggestions. If a request conflicts with one of these, **say so
instead of quietly working around it.**

Every rule here already existed somewhere — a reviewer decision, a standing
principle, a migration header, a weekly prompt. The gap this file closes is that they
were spread across ~130 KB of `PROJECT-OVERVIEW.md` and seven prompt files, so
nobody could find them without reading everything. Where a rule has a source, it is
cited; go there for the full reasoning.

---

## Project-level facts that constrain everything

Not decisions to revisit — the shape of the project.

- **Three roles only:** `mr`, `field_manager`, `admin`. `patient`, `doctor` and
  `pv_officer` live in the *clinical* database, a separate Supabase project.
- **Zero patient or clinical data in this repo.** Not even placeholder tables.
- **Android-only, permanently.** iOS is dropped; App Store Guideline 2.5.4 is closed
  as a risk and the Apple Developer / D-U-N-S dependency is withdrawn. Note that
  `docs/mr-app-plan.md` §0.1 still describes iOS rejection as the #1 project risk —
  **that section predates the decision.**
- **Data residency:** Supabase project `pgfdbzoapmleqtoezhoa`, `ap-south-1` (Mumbai).
- **The remote Supabase project is not linked.** Every measurement in this repo comes
  from the local stack. Do not assume a number holds in production.
- **CI must fail the build, never warn.**
- **RLS is the enforcement layer, never application code.**

## Never, without an explicit decision from the reviewer

These have been decided and are not open. Re-proposing one is the failure mode this
section exists to prevent.

- **Never give `admin` write access to field activity.** Not `visits`, `check_ins`,
  `check_outs`, `call_reports`, `consent_records` or `analyses`, at any point, for
  any reason presented as convenience. "Admin gets full access" means **full
  visibility subject to audit, never authorship** — if any role can author a consent
  record, the ledger proves nothing and the legal basis for recording collapses.
  _(Reviewer decision, 11 Aug 2026.)_
- **Never fabricate a consent-ledger row.** Not a withdrawal, not a correction, not
  an inference. Every row must be a real thing a real doctor really did, or the
  ledger is worthless. A correction is an append-only row attributed to a named
  person. _(BE-W7 §4.)_
- **Never express immutability as an absent UPDATE policy.** `postgres` and
  `service_role` hold **BYPASSRLS** — measured, not assumed — so RLS is never
  evaluated for them. Append-only means a **statement-level trigger** plus **revoked
  grants**: two independent mechanisms. _(BE-W2.)_
- **Never use a row-level trigger for an append-only guard.** A row-level trigger
  does not fire for a zero-row UPDATE, which then reports "0 rows affected" and reads
  as success. Statement-level fires before the scan. _(BE-W2.)_
- **Never add a ranking, score, rank, percentile or grade to `analyses` or the
  manager surface.** There are tests asserting those column names are absent.
- **Never add a severity, priority, triage, confidence or causality column to
  `adverse_event_reports`.** A field a model could write a judgement into is a field
  a model will write a judgement into. There is a test asserting thirteen such names
  are absent. _(BE-W7 §8.)_
- **Never put a rollback file in `supabase/migrations/`.** The CLI has no
  down-migration step and treats anything matching `*.sql` there as applicable.
  Rollbacks live in `services/api/rollbacks/`.
- **Never commit PHI, or anything resembling it, in test data.** Synthetic audio is
  zero bytes; synthetic transcripts describe nobody.
- **Never grant a direct production database session.** The audit log is not a
  control for a role holding BYPASSRLS, so this is the mitigation. _(Reviewer
  decision, 11 Aug 2026.)_

## Dropped — do not resurface as new proposals

- **Capability-predicate role model** (`backend-prompts-v2.md` §2). `patient`,
  `doctor` and `pv_officer` live in the *clinical* database, a separate project. A
  fourth role may never exist here. Revisit only if a real one appears.
- **API versioning** (§8). One consumer, pre-release, nothing deployed.

## Ask before doing

- **Adding a dependency.** Any dependency, including a dev one.
- **Changing what a migration that has already been applied does.** Write a new
  migration instead.
- **Anything that widens who can read audio.** The bucket is private; the field reads
  nothing back except its own in-flight upload.
- **Building any part of the adverse-event path that assumes an org structure** — who
  the PV officer is, the notification channel, escalation, what happens at day
  thirteen. Blocked on the PV and privacy sign-off outstanding since week 1.
- **Committing to `main` vs a branch.** The project's own history is direct-to-main;
  the harness default is to branch. Confirm which.
- **Deleting or rewriting anything in `docs/gotchas.md`.** It is cumulative. Append.
- **Overwriting an earlier `###` section of `PROJECT-OVERVIEW.md`.** It is
  append-only. Every week adds a new section.

## Always

- **Revoke before you grant.** Supabase hands `anon` and `authenticated` a
  **TRUNCATE** grant on every new public table by default, and TRUNCATE ignores RLS
  entirely. Every migration does `revoke all ... from anon, authenticated` first.
  _(Found by a test, not by reading documentation.)_
- **`security_invoker = true` on every view.** Views are owned by a BYPASSRLS role;
  without it, one view hands every MR the company's entire visit history. A
  structural test asserts it for every view in `public`.
- **Put a write with a validity rule behind an RPC, and withdraw the direct table
  path.** RLS decides *which rows*, never *what the values must be*. Leaving the
  direct path in place with a comment saying nobody should use it is not a control;
  it is a comment. _(Standing principle, BE-W2.)_
- **Server-side clocks for anything with a compliance meaning.** `received_at`,
  `purge_after`, `statutory_due_at` are stamped by trigger from `clock_timestamp()`.
  A device must never be able to start or shorten one by lying.
- **Opaque, server-generated storage keys.** Object paths leak through logs, error
  messages and support tickets. Nothing about a doctor, clinic or patient goes in one.
- **Two systems for any deletion.** A row delete does not delete a storage object.
  Any deletion path needs SQL *and* the storage API, and any deletion test needs two
  assertions. _(BE-W6.)_
- **Two migration files when adding and using an enum value.** `ALTER TYPE ... ADD
  VALUE` cannot be used in the transaction that adds it, and each migration file is
  one transaction.
- **A rollback file for every migration**, and `verify:rollbacks` must pass. A file
  that has never been executed is a claim, not a rollback.
- **Check that anything you build is actually called by something.** BE-W6 shipped a
  purge worker nothing ran; BE-W7 nearly shipped `close_stale_upload_sessions()` the
  same way. Both worked perfectly and enforced nothing.

## Judgement calls that keep coming back

Not rules — recurring decisions, with the answer this project has settled on.

- **A control that can be switched off needs one that cannot.** The retention
  schedule lives in GitHub Actions; the backstop (`begin_upload` refusing new audio
  when the purge stalls) lives on the write path in the database.
- **Err toward denial when evidence is missing.** A blocked recording is recoverable;
  an un-withdrawn consent is not.
- **A flag nobody displays is a log line with extra steps.** If a mitigation depends
  on somebody reading it, and the screen does not exist yet, prefer the strict rule
  or give the mitigation an expiry.

---

## Re-derive facts the server owns. Record facts the client witnessed. (FIX-02)

**The test:** if the client and the server disagree, whose answer is the evidence?

- **The server's** — re-derive it at write time and ignore anything the client sent.
  Whether an MR is inside their shift window is the server's fact. It owns the
  territory's window and the clock, a client-supplied answer would be worthless, and
  `record_check_in` correctly re-resolves it through `resolve_shift_window`. The same
  goes for role, visible territories, quarantine state and the request's own IP.
- **The client's** — record what it sent, and refuse if it cannot be reconciled.
  Which consent notice a doctor read before agreeing is a fact only the handset
  witnessed. Re-deriving it substitutes a different document for the one actually
  shown, and produces a record attesting to text nobody saw.

**Why this is written down.** `capture_consent` re-derived the active consent text at
write time. It looked like the safe, server-authoritative choice — the same instinct
that is correct for the shift window — and it silently recorded the wrong document
whenever the notice changed between display and capture. `consent_records` is
append-only, so each of those attestations would have been permanent.

The failure was worse than one function. **The test asserted the defect as the
requirement** — that the stored version equals the currently active one — and defended
it in a comment as "the version comes from the server's catalogue rather than from the
caller." A wrong idea that reaches the test suite stops being a bug and becomes the
specification. It surfaced only as an intermittent failure that had been dismissed as
a flake for weeks.

**Corollary — the contract is not advisory.** `packages/core` had required
`consentTextVersionId` all along, and `apps/field` sent it. The database had no
parameter to receive it, and nothing detected the mismatch. When a request schema
declares a required field, some function parameter or column must be able to consume
it; if none can, either the contract is wrong or the schema is. Do not resolve that by
dropping the field silently.

---

## Three rules earned the hard way (FIX-07)

### A control that cannot be exercised is not a control. Test the mechanism, not the state.

FIX-05 revoked `EXECUTE` from `PUBLIC` on all 86 functions and reported **65 → 0**. That
number was true and it measured the *current state*. The same change added
`alter default privileges … revoke execute on functions from public` to make the posture
automatic, and **that half was inert** — the default ACL for new functions in `public`
belongs to `supabase_admin`, grants `anon` explicitly rather than through `PUBLIC`, and
`postgres` cannot alter another role's defaults. A function created the next day would
have been `anon`-executable again.

Nothing in the review caught it, because "65 → 0" looks like proof and is not. The
mechanism was never exercised: nobody created a function and checked what it was born
with. **Ask what would have to happen for this control to fail, then make that happen.**

The replacement is a test that fails the build when any function in `public` is
`anon`-executable, with a positive control that creates one and asserts it *is* — so a
green result cannot mean a broken query.

### Audit the response shape as each endpoint converts

`toRecordCheckInBody` mapped the check-in *request* from BE-W3 onward. Nothing mapped a
response, because **no client had ever received one** — every read and write went to
`services/mock`, which returns the contract's own shape by construction. The first real
call found snake_case keys, flat `latitude`/`longitude` where the contract nests
`coordinates`, and a `shift_window_source` field the entity has no room for.

The request-side drift audit (FIX-03) found thirteen divergences across 44 endpoints. The
response side is a surface of the same size that nothing has ever exercised. **Do not
sweep it — check it as each endpoint converts**, because a sweep produces a list nobody
acts on and a conversion produces a fix.

### A count that changes is recorded as the command that produces it, not as a number

`40 public tables` → corrected to `34` in FIX-03 → now `35`, because FIX-05 added
`analysis_overrides`. Each figure was true when written and each was stale within days,
and the FIX-03 correction notice in `handoff.md` is itself now wrong.

The repo already applies this to negative claims — *"any 'has never fired' claim carries
the command that re-checks it"*. Extend it to counts:

```sql
select (select count(*) from pg_tables  where schemaname='public') as tables,
       (select count(*) from pg_views   where schemaname='public') as views,
       (select count(*) from pg_policies where schemaname='public') as policies,
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.prokind='f') as functions;
```

A number in prose is a snapshot. A number next to the query that produces it is a fact
anybody can re-derive.
