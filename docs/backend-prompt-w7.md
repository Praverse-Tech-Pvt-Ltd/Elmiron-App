# Backend Prompt — BE-W7

**Issued after the BE-W6 review (commit `5e44af5`).** Supersedes nothing. BE-W6 is closed.

---

## The three open items you raised — answered

### 1. Supabase object retention — answered from vendor documentation, with one thing you did not consider

Two statements from Supabase's own docs settle most of it:

> "When you delete one or more objects from a bucket, **the files are permanently removed and not recoverable.**"
> — https://supabase.com/docs/guides/storage/management/delete-objects

> "**Database backups do not include objects you store via the Storage API**, as the database only includes metadata about these objects. Restoring an old backup does not restore objects you deleted after that backup."
> — https://supabase.com/docs/guides/platform/backups

So: deletion through the Storage API is permanent, and database backups and PITR do not carry objects. Your purge does what it claims. You were also right to delete through the API rather than SQL — the same docs say a SQL delete orphans the object rather than removing it.

**But the risk runs the other way, and it is worse than the one you were worried about.**

A PITR or backup restore rewinds *the database* and not *the objects*. So a restore to a point before a withdrawal:

- **Un-withdraws the consent.** The withdrawal row disappears. The consent ledger now says the doctor consented and never withdrew.
- Leaves the audio genuinely gone, because objects do not come back.
- Produces metadata rows pointing at objects that no longer exist.

The first of those is a compliance failure, not an inconvenience. A restore silently rewrites the record of what a doctor agreed to — which is the exact thing the consent ledger exists to prove.

**Build for it this week:** a documented, tested post-restore reconciliation that detects rows whose objects are missing, and re-applies any withdrawal or purge that the restore erased. And a written statement in `docs/` that a PITR restore is never a routine operation on this project.

Residual, and still a real gap: Supabase's infrastructure-level S3 behaviour — versioning, soft-delete windows, sub-processor retention — is not in the public docs. **That belongs in the DPA, not in a docs search.** Keep it on the escalation list as a contractual question rather than an engineering one.

### 2. The purge has no scheduler — correct, and it means the 90-day promise is currently false

Not "approximately true". False. A control nobody runs is not a control, and `audio_purge_health()` reporting a stopped purge to nobody is the same problem one level up.

**Both halves ship this week:**

- Something runs the worker on a schedule.
- Something notices when it stops, and reaches a human.

**Recommendation, not a mandate:** `pg_cron` invoking an Edge Function through `pg_net`. It keeps the schedule next to the data, survives a CI or repo change, and needs no external secret. A scheduled GitHub Action is the simpler alternative and is acceptable if you'd rather not add two extensions — say which you chose and why.

The health check needs an actual destination. Until the console exists there is no screen, so pick something crude and real — a failing CI check, an email, anything a person receives. **A health function nobody calls is the scheduler problem again, wearing a different hat.**

### 3. `voice_notes` at 90 days — keep it, but your reasoning is the weaker one

You justified it by symmetry: they're audio, so treat them the same. The stronger argument is that the exposure is worse, not equal:

- An MR's voice note summarising a consultation **can name a patient the doctor discussed.** Same DPDP exposure as the recording.
- And unlike the recording, **nobody consented to it at all.** The doctor consented to the conversation being recorded; they did not consent to the MR's subsequent commentary about it.
- Separately, it is an employee's voice held by their employer. Holding it longer than needed makes the worker-monitoring position worse, never better.

**Keep 90 days. Replace the reasoning in the code comment with this one.** If someone later argues for a longer retention to improve performance assessment, that argument now has to beat a privacy position rather than a consistency preference.

---

## Two decisions on the things you flagged rather than objected to

### The org-default shift window gets an expiry

You're right that a flag nobody displays is invisible until Frontend's week 11, and that strict is safer than an invisible flag.

**Make the org default self-cancelling.** It carries a mandatory `expires_at`, no more than 60 days out, set at configuration time. After expiry it stops applying and capture refuses again — back to the strict rule, automatically, with no one needing to remember.

That converts "we'll fix this before the pilot" from an intention into a deadline the system enforces. It also means if the client never sends the real data, the system tells them by failing, which is the only message anyone reliably reads.

The default stays `null` unless someone deliberately configures it.

### `TranscriptV0` gets a hard expiry test

"A placeholder that works is a placeholder that stays" is exactly right, and a header comment does not stop it.

Write a test that **fails after a fixed date** unless a real `TranscriptV1` exists. Two requirements:

- The failure message states what is wrong, who owns it (AI/ML, contract I3), and how to extend the date **deliberately** if that is the honest answer.
- Extending it is a one-line change that shows up in a diff with someone's name on it.

A CI break on a date is a blunt instrument. That is the point — it is the only mechanism that survives everyone forgetting.

### One thing worth saying about your own process

Mutation testing found a truncation feature you had shipped with no test, and nothing else caught it. That is the harness earning its cost, and it is the second time it has caught something inside the code that implements a guard rather than in a feature. Keep it.

---

# PROMPT BE-W7 — Upload path, purge scheduling, adverse-event ingest

> Paste everything between the lines.

---

Read `PROJECT-OVERVIEW.md`, `docs/gotchas.md` and `mr-app-plan.md` §0 first. This is week 7 of 12.

## Read this before planning your week

Part of this week's original scope is the adverse-event path, and **the PV and privacy sign-off that governs its legal design has not arrived.** It has been outstanding since week 1.

You are therefore building the **mechanical half only** — the parts that are settled by the plan and do not depend on anyone's answer:

- The ingest record and its immutability
- The statutory clock
- The fact that routing goes to a human, never to a model

You are **not** building: who the PV officer is, what the notification channel is, what happens at day 13, or any escalation ladder. Those are organisational decisions and guessing them produces a compliance artifact built on an invention.

**If you find yourself needing to know one of those to proceed, stop and say so rather than picking a default.**

## Part 1 — Close the BE-W6 open items

### 1.1 Schedule the purge, and watch the scheduler

The 90-day retention promise is currently unenforced. Fix both halves:

- The worker runs on a schedule. `pg_cron` + `pg_net` invoking an Edge Function is the recommendation; a scheduled CI job is acceptable. State which you chose and why.
- A stopped purge reaches a human. `audio_purge_health()` must be *called* by something, and its unhealthy state must produce an observable failure — not a row nobody reads.

Test that the schedule exists and that a simulated stopped worker produces the failure.

### 1.2 Post-restore reconciliation

A database restore rewinds rows but not storage objects. A restore to a point before a withdrawal resurrects the withdrawn consent while the audio stays destroyed.

Build and test:

- A reconciliation routine that finds recording rows whose objects are absent, and rows whose withdrawal state disagrees with the object's existence.
- Re-application of any withdrawal or purge the restore erased.
- `docs/` states plainly that a PITR restore on this project is a compliance event requiring this routine, not a routine operation.

### 1.3 Org-default shift window expiry

Mandatory `expires_at`, ceiling of 60 days from configuration. On expiry the default stops applying and capture refuses. Test both sides of the boundary.

### 1.4 `TranscriptV0` expiry test

Fails after a fixed date unless `TranscriptV1` exists. Failure message names contract I3, its owner, and how to extend the date deliberately.

### 1.5 `voice_notes` retention comment

Keep 90 days. Replace the symmetry reasoning with the exposure reasoning: a voice note can name a patient the doctor discussed, nobody consented to it at all, and it is an employee's voice held by their employer.

## Part 2 — Build

### 2.1 Resumable upload

MRs upload 4-minute recordings over Indian mobile networks from clinic corridors. **A failed upload that restarts from zero will be abandoned by the user and the recording is then lost.**

- Resumable, chunked, survives process death and network change.
- Resume must work after the app was killed, not only after a dropped connection.
- The consent grant is checked at resume, not only at initiation. A grant that expired mid-upload does not become valid because bytes are already in flight.
- Bounded: an abandoned partial upload is cleaned up on the same schedule as everything else, and counts toward the storage ceiling while it exists.

### 2.2 Upload queue API

The client is offline-first. Queue state is the MR's only view of whether their day's work is safe.

- Per-item state, attributed, with a reason on every failure.
- Reuses the dead-letter reversibility rules from BE-W5. Do not invent a second mechanism.
- An MR can see what is queued, what failed and why, in their own words rather than an error code.

### 2.3 Adverse-event ingest — mechanical half only

- **The record is append-only.** No update path for any role, including `admin` and `service_role`, exactly as `consent_records` and `audit_log`.
- **The statutory clock starts at ingest, not at triage.** Stamped server-side by trigger. A test inserts a claimed-earlier timestamp and asserts the trigger overwrote it — the same pattern you used for `received_at`.
- **Routing is to a human queue. Always.** There is no automated triage, no severity field the system populates, no priority the system assigns. If a column would let a model write a judgement into this table, do not create the column.
- The clock is visible and countable from day one, because the thing that gets missed is a deadline nobody was counting.

**Do not build** the notification channel, the escalation ladder, the PV officer role, or anything that assumes an org structure. Those wait for the sign-off.

## Things that will bite

- **Resumable upload plus a single-use grant is a contradiction unless you design it.** Decide explicitly whether the grant covers the whole upload or each chunk, and say why.
- **A partial upload is an object.** It occupies storage, it may contain audio, and it has no consent record binding it if the visit was abandoned. Treat it as audio, not as scratch.
- **`pg_cron` runs in the database, and the database cannot reach the storage API without `pg_net`.** Check both extensions are available before designing around them.
- **The AE clock is a legal deadline.** If it can be wrong by a timezone, it will be.

## Rules

No features beyond the list. No speculative abstraction. Reversible migrations. **No PHI in committed test data.** If a requirement is ambiguous — especially anything about who receives an adverse event — stop and ask rather than choosing a default.

If any test passes when it should fail, stop and report it.

## Required at the end

**Append a `### BE-W7 — Upload path, purge scheduling, adverse-event ingest` section to `PROJECT-OVERVIEW.md`.** Never overwrite an earlier section.

Include:

- The scheduling mechanism you chose and why, and where the health signal actually goes
- Your resumable-upload / grant-scope decision and its reasoning
- What the post-restore reconciliation covers and what it cannot
- Everything you were told not to build, restated, so the next reader knows it was deliberate
- Anything you were asked to build that you believe is wrong

Then **update `docs/gotchas.md`**.

---

*Storage and backup behaviour verified against Supabase documentation on 11 August 2026 — see the two citations above. Infrastructure-level S3 retention remains unverified and is a DPA question.*
