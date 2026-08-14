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
