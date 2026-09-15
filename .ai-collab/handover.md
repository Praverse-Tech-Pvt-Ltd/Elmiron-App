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
