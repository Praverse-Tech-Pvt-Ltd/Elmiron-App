# Handover

**Read this first, every session.** Then `constraints.md`. Then the code.

**Working notes, tracked since BE-W8.** `PROJECT-OVERVIEW.md` and `docs/gotchas.md` are the
durable, cumulative, append-only record. **If anything here disagrees with those, they are
right.**

> **Correction — 14 September 2026 (MR-32 D2).** The header of this file used to read
> *"Untracked, and that is the only reason this file is allowed to exist."* **That is false
> and has been since BE-W8.** `.gitignore:22-26` records the reversal: `.ai-collab/` and
> `handoff.md` are committed and *"expected to be updated regularly, not treated as a
> point-in-time snapshot."* The same stale claim survived in two other places and is corrected
> in all three — see the grep note at the end of this file.

**Restructured 14 September 2026 (MR-32 D1).** This file had a "Current state" block dated
17 August — *seventeen migrations, the three GitHub secrets are not set* — sitting above four
hundred lines of later material that contradicted it. There are now 56 migrations and the
secrets were set during BE-W8. Nothing was deleted: every session narrative is in
`PROJECT-OVERVIEW.md` in a longer form, and the index below says where. What is kept here is
the durable half.

---

## Current state — 14 September 2026, after MR-32

- **Backend:** 56 migrations, deployed. Gate 0 passed; field capture server-enforced; the
  offline queue conflict-free; audio that consent does not cover structurally impossible to
  hold; 90-day retention enforced by scheduled workflows.
- **Frontend:** `G-WRITE` met — all five MR writes reach Supabase from real screens, online
  and offline, exactly once. A real dev-client APK exists and has been driven.
- **The two device gates are blocked by the handset alone**, seven weeks outstanding.
- **Recovery:** the restore runbook has been executed once (MR-32 B). Its reconciliation
  works and its step 2 has no mechanism behind it — no PITR, no dump script, no off-machine
  copy. `BE-W11` is the gap.
- **Open and compounding:** `BE-W93`, the fiduciary name — every consent captured before the
  organisation's registered name exists is permanently defective, and `consent_records` is
  append-only so it cannot be amended. See `docs/blocked-on-you.md`.

---

## Avoid — things that look like a good idea and are not

- **Adding a second upload mechanism, or a second dead-letter mechanism.** Uploads are
  ordinary sync items on purpose; they inherit attempt counting, dead-lettering and
  reinstatement unchanged.
- **Making the reconciliation destroy things by default.** It is dry-run unless `--apply`, and
  a tool that destroys audio the first time somebody runs it to see what it does is not a
  compliance tool.
- **"Simplifying" `assert_upload_still_permitted` by checking session state first.** The
  consent check is deliberately first; reordering it tells an MR their recording was malformed
  when the doctor withdrew.
- **Trusting a green suite as proof a guard works.** Break the guard and confirm something
  goes red. That has caught a hollow *test* twice, not just a hollow guard — and in MR-31 a
  mutation caught a guard that was **inert while the code was correct**, which no test could
  have failed on.
- **`pg_cron` for the purge**, without re-reading `PROJECT-OVERVIEW.md` → BE-W7 §1. It is
  available and it was rejected for substantive reasons, not availability.
- **Reading a discriminant's existence as proof it is used.** Count the call sites. `zone.source`
  was documented as *"a caller must be able to tell an answer from a fallback"* and had **zero
  readers** for four sessions.
- **Trusting an exit code.** `pnpm --filter` on a package name that does not exist prints a
  message and **exits 0** — three commands in the restore runbook did exactly that until
  MR-32. And the inverse: exporting `MSYS_NO_PATHCONV=1` shell-wide made three unrelated runs
  exit 1 from a corepack crash rather than from the check under test.

---

## Where the history went — the index

| Era | Read |
| --- | --- |
| BE-W7, the 17 August sessions, the production deploy and the auth hook | `PROJECT-OVERVIEW.md` → `### BE-W8 — Operational readiness` and the BE-W7 sections before it |
| Decisions, dated, with what they replaced | `.ai-collab/decisions.md` |
| Constraints that outrank a reviewer instruction | `.ai-collab/constraints.md` |
| MR-14 → MR-28, the write paths and `G-WRITE` | `PROJECT-OVERVIEW.md` → `### MR-28 — the last G-WRITE item` |
| MR-29 → MR-32 | `PROJECT-OVERVIEW.md` → the `### MR-29` … `### MR-32` sections |
| Open work items | `docs/COMPLETION-PLAN.md` |
| Traps and classes of defect | `docs/gotchas.md` |
| What is blocked on a human | `docs/blocked-on-you.md` |
| Recovery and migration-deploy procedure | `docs/restore-runbook.md` |

---

## The grep note — MR-32 D2

MR-30 A3 produced the rule *"when you correct a fact, grep for every other mention of it"*
after finding one fact in six places with five of them stale. Applying it to the claim this
restructure had to correct:

| Location | Said | Corrected |
| --- | --- | --- |
| `.ai-collab/handover.md:5` | *"Untracked, and that is the only reason this file is allowed to exist"* | here, above |
| `CLAUDE.md:35` | *"the same rule that keeps `handoff.md` and `.ai-collab/` out of git"* | corrected in place |
| `.gitignore:36` | *"the same staleness argument that keeps `handoff.md` out of git above"* | corrected in place |

**The third one is the sharpest.** `.gitignore:22-26` states the reversal, and
`.gitignore:36` refers back to *"above"* for the rule those lines say no longer holds — **the
contradiction is ten lines apart in the same file.** And the copy in `CLAUDE.md` is loaded
into every session's context, which makes it the highest-leverage stale fact found so far.

---

## After MR-33 — 15 September 2026

**The two facts that change what you should do next:**

1. **Production is 37 migrations behind.** Applied: 19. On `main`: 56. Nothing was ever
   applied off-`main`, so this is a deploy that never happened, not a divergence. The app as
   it now exists **cannot run against production**. `blocked-on-you` 6.1.
2. **There is now a restore mechanism, and it has nowhere to send its output.** `BE-W11` is
   built and proven by restoring; where the artefact may lawfully live is a data-processing
   decision, not an engineering one. `blocked-on-you` 6.3.

**Avoid, added this session:**

- **Do not use `supabase db dump` as the backup.** Measured on the local stack: the schema
  dump has **zero** `auth.` and `storage.` tables and the data dump has **zero** rows of
  `auth.users`. A database restored from it holds the consent ledger and has nobody who can
  sign in. The scripts use raw `pg_dump` of the whole database.
- **Do not judge a backup by producing one.** The only check that caught the above was
  restoring the artefact and querying the restored copy. In MR-32's failed drill,
  `CREATE DATABASE` succeeded and the log had zero `ERROR` lines while nothing had restored.
- **Do not `export MSYS_NO_PATHCONV=1`.** Scope it to the one docker command; shell-wide it
  breaks corepack and the failure looks like the check failing.
- **Do not trust an ordering test that has never failed.** A synchronous test double makes
  React batch the updates, so the intermediate render the test exists to catch never occurs.

| Session | Where the narrative is |
| --- | --- |
| MR-33 — `BE-W11`, there is no restore | `PROJECT-OVERVIEW.md` → `### MR-33 — the restore mechanism` |

---

## After MR-34 — 15 September 2026

**Read `docs/blocked-on-you.md` 6.1 and 7.1 before doing anything with production.**

| | |
| --- | --- |
| **The deploy** | **Rehearsed.** `docs/restore-runbook.md` → *"Applying 37 migrations to a database at 19"*. Five phases, both failure paths executed |
| **And it has a landmine** | `20260908000800_user_profiles_organisation.sql` runs `min(id)` on a uuid column. **PostgreSQL has no `min` for uuid.** If production has any territory-less profile the deploy either crashes (1 organisation) or refuses (more than 1). Only the empty-database path has ever run, and that is the only path CI runs. **7.1** |
| **Sequencing** | **THE DEPLOY MUST HAPPEN BEFORE THE DATA.** `B11` reference data is dated ~22 Sep — seven days out. Data first means it lands on a schema with `BE-W76`'s cross-tenant admin read still open. **6.1** |
| **The graph** | **A museum. Rebuild before trusting it.** Built 11 Aug; 80% of tracked code files absent; `apps/field` is 131-of-131 absent. `docs/graphify-notes.md` |
| **Backup workflow** | No longer a daily red. Three states, weekly, deferral expires **2026-10-15**; re-enable by setting `BACKUP_DESTINATION` |
| **Tests** | **1,640 passing, zero skipped, zero failing.** Read them from the runners |
| **Push** | **BLOCKED.** Nine commits held locally; `git push` was denied by the environment. No CI run exists for MR-33 or MR-34 |

### The pre-flight query — one SELECT, and nobody has run it

It decides whether the deploy is six seconds or a half-applied schema:

```bash
psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || ' organisations=' || (select count(*) from public.organisations);"
```

`territory_less=0` → clean. Anything else → read `blocked-on-you` 7.1 first.

### Three traps measured this session

1. **A partial deploy has the same table count as a complete one.** When the push failed it left
   17 of 37 applied: 36 tables and `rls_forced=36`, *identical to a finished deploy*, with 42
   policies and no `organisation_id`. **Only `check:migration-drift` and the presence of
   `user_profiles.organisation_id` distinguish them.** `db push` is not transactional across
   migrations, and a partial application is not a failed one — nothing rolls back.
2. **A full rollback leaves the drift check reporting NO DRIFT against an empty database.**
   `verify:rollbacks` passes 56/56 and ends with the schema empty — and never touches
   `supabase_migrations.schema_migrations`, so the database claims all 56 applied with zero
   tables. The exact inverse of trap 1, defeating the same check. **Forward recovery only.**
3. **You cannot rehearse this deploy on a bare `create database`.** It fails at migration 1 with
   *"schema `auth` does not exist"*. No migration creates anything in `auth`/`storage` but 38 of
   56 reference them, so the baseline must come from the platform's own init — use
   `supabase db reset` against a copy of the supabase directory with only the 19 in it.

### And one that is not new but keeps earning its place

`check:migration-drift` piped to `tail` reported `exit=0` for a command that exited 1. **`$?`
after a pipe is the last command's status.** Observed live this session.

| Session | Where the narrative is |
| --- | --- |
| MR-34 — the deploy rehearsal | `PROJECT-OVERVIEW.md` → `### MR-34 — the deploy rehearsal` |

---

## After MR-35 — 15 September 2026

**The pre-flight query is now the first thing on `docs/blocked-on-you.md`. It is still the
highest-value action available and still nobody has run it.**

| | |
| --- | --- |
| **Push** | **Unblocked.** MR-34's failure was the local agent harness, not GitHub — `git` never ran, so there was nothing for an org owner to fix. `4e8ba61..abf6ff3` pushed; CI run `34951701710` green on `abf6ff3` |
| **The crashing migration** | **Fixed — and it had a TWIN.** `20260908000800` and `20260908001200` both called `min(id)` on a uuid column. Neither had ever executed anywhere |
| **Editing an applied migration** | Permitted **in this one named case**. The ledger verifies a NAME, not a hash — see `.ai-collab/constraints.md`, "The one time a migration was edited in place" |
| **Drift check** | Now asserts its own preconditions. It **refuses** to report on a database the rollbacks emptied, and names the SHAPE of a shortfall rather than its size |
| **The graph** | **Deleted.** `graphify-out/` is gone; `CLAUDE.md` no longer says "read it first" |
| **Tests** | **1,658 passing, zero skipped, zero failing.** Read them from the runners |

### Before you deploy: one query, and it decides which of three futures you are in

```bash
psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || ' organisations=' || (select count(*) from public.organisations) || ' consent_notices=' || (select count(*) from public.consent_text_versions);"
```

All three zero → both backfills no-op and the deploy is seconds. Anything non-zero → the
backfills **execute**; they are fixed now, but they have still never run anywhere outside a
test. `docs/restore-runbook.md` → Phase 0.

### The `api` suite is flaky about two runs in seven, and it is NOT your change

`tenant-boundary-restrictive.spec.ts` fails with `deadlock detected` inside `mirrorTable` on
roughly **2 of 7** full-suite runs. **Pre-existing**, measured this session, `BE-W92`'s problem.

- **A single red `api` run is not a regression.** Re-run, and check whether it is that test and
  that error.
- **A single green run does not clear a change either.** This is the direction that bites: if
  you are testing whether something you wrote causes flakiness, you need a *rate* on both sides.
  This session nearly shipped a false diagnosis on three clean runs.
- CI runs the suite once per push, so about a **one-in-four** chance of a spurious red.

### Two traps measured this session

1. **`delete from public.user_profiles` is illegal on this schema once fixtures exist.**
   `app_thresholds.set_by_user_id` is `ON DELETE SET NULL` and `app_thresholds` is append-only,
   so the delete raises *"append-only: UPDATE is not permitted by any role"*. A test that clears
   tables passes alone and fails in the full run. If a test needs whole-table control, give it
   its own scratch **database** — the `verify-backup.mjs` pattern.
2. **A `supabase db reset` can fail and leave a half-built stack.** It reported
   `LegacyDbSetupError: error running container: exit 1`, and `auth.users` then had no
   `email_confirmed_at` because the auth container had not re-applied its own schema. **Assert
   the starting state before measuring anything against it.**

| Session | Where the narrative is |
| --- | --- |
| MR-35 — the crashing migration | `PROJECT-OVERVIEW.md` → `### MR-35 — the crashing migration` |
