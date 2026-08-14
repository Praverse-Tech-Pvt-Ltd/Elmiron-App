# Backend Prompt — BE-W8

**Issued after the BE-W7 review.** Reviewed against the pasted report *and* the `.ai-collab/` set, `handoff.md` and `handover.md` as of 17 August.

---

## This week is not the pipeline. Read why before you argue with it.

The plan says week 8 is pipeline orchestration — queue, retries, dead-letter for transcription → redaction → analysis.

**There is nothing to orchestrate.**

- No speech vendor has been chosen. Contract I3 is five weeks late and may still come back as *"the word error rate is too high, cut the AI layer."*
- The redaction engine does not exist. It is AI/ML's week 4–5 deliverable and has not been reported.
- `TranscriptV0` is a placeholder you wrote yourself, with a CI deadline of 30 September precisely because nobody trusts it.

Building an orchestrator whose every stage is hypothetical produces the most expensive kind of code: correct, tested, and possibly deleted. If the bake-off comes back bad, the entire pipeline is cut and this week's work goes with it.

**Meanwhile production is deployed and cannot be used.** No secrets, no seed data, no observed scheduled run, and three unverified behaviours that only matter under load. The pilot is roughly five weeks out.

So this week is **operational readiness**. It is all work that must be true before anyone records anything, and none of it is at risk of being deleted.

---

## Part 1 — The control that is currently a habit

### 1.1 `verify:rollbacks` must refuse to run against anything but localhost

From your own `constraints.md`:

> **A guard that is not a trigger, a policy or a revoked grant is not a guard.**

You have applied that rule rigorously to the schema and not once to yourself. `handover.md` documents this hazard three times, in escalating language, and every mitigation offered is a rule for humans to follow:

> *"Never export any of them in a shell where the api scripts run."*
> *"When you must run `verify:rollbacks`, pass the localhost URL explicitly."*

That is a comment saying nobody should use the direct path. You withdrew a database write path for exactly this reason in BE-W2. **Production now holds 34 tables. Two lines of PowerShell drop all of them.**

Fix it in the script, not in the documentation:

- Parse `SUPABASE_DB_URL` before doing anything destructive.
- **Refuse unless the host resolves to `127.0.0.1`, `::1` or `localhost`.** Not a warning. A non-zero exit and no connection opened.
- No `--force` flag, no environment variable escape hatch. If someone genuinely needs to reverse migrations on a remote, they can write that command by hand and own it.
- A test asserting the refusal fires, using a fake remote-looking URL. It must not need a real remote to prove it.

**Do this first, before anything else this week.** It is the highest-value change available on this project and it takes twenty minutes.

While you are there, audit every other script in `services/api/scripts/` for the same shape: anything destructive that takes its target from the environment gets the same treatment, matched to what it is allowed to touch.

### 1.2 Do the same thinking for the reconciliation worker

`reconcile-after-restore.mjs` is dry-run unless `--apply`, which is right. But `--apply` against production deletes storage objects. Decide whether that command should also require the target to be explicitly named on the command line rather than inherited from the environment, and say what you chose.

---

## Part 2 — Make the deployment real

### 2.1 Set the three secrets and stop the daily red

`decisions.md` records that the leave-them-empty decision **expired the same day it was made**. It is now costing roughly 70 failed CI runs before pilot, for no remaining benefit.

- Set `SUPABASE_DB_URL` (from `SUPABASE_POOLER_SESSION_URL` — session pooler on 5432, **not** the 6543 transaction pooler, **not** the direct `db.<ref>` string), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from `SUPABASE_SECRET_KEY`).
- Percent-encode before pasting. The `?` trap is already in `docs/gotchas.md`.
- Acceptance: `gh secret list` shows three.

### 2.2 Prove the schedule fires, do not predict it

`handover.md` is honest that **no scheduled run has ever fired** — every run in the history is `event: push`. The daily failure everyone is planning around is a prediction.

- Dispatch `Audio retention` once by hand. It should be green and destroy nothing.
- Then let the watchdog run and **observe** it.
- Record in `PROJECT-OVERVIEW.md` what the first real cron fire actually did, including the timestamp. If it never fires, that is the finding.

A retention control that has never executed on its schedule is not yet a control.

### 2.3 Seed production reference data

Organisations, territories, doctors, consent-text versions. Capture currently refuses on production, correctly, because there is nothing there.

Two hard constraints:

- **Idempotent.** Runnable twice with no duplicates, because it will be run twice.
- **`audit_log` is append-only and permanent.** Decide deliberately whether seeding writes audit rows. If it does, those rows are in the compliance log forever. If you suppress them, say exactly how and why that is not a hole in the audit trail. `handover.md` already warns against creating rows on production just to test — this is the same problem with a legitimate reason, which makes it harder, not easier.

**Territory shift windows are not yours to invent.** They need real per-territory hours from the client. Seed everything else and leave shift windows empty, so capture keeps refusing until the real data arrives.

---

## Part 3 — Measure what is currently assumed

`handover.md` lists three unverified behaviours. Two of them decide whether the pilot works.

### 3.1 Volume

- **Purge batch limit is 100.** What happens with a 5,000-object backlog? Does it drain over successive runs, or does the claim window make it fall behind faster than it catches up?
- **`sync_push` takes 500 items in one transaction.** At 100 MRs × 8 visits/day syncing after a day offline, what is the real batch size and how long does that transaction hold?

Measure both against generated data. **Report the numbers, not a reassurance.** If either has a cliff, the number where it appears is the deliverable.

### 3.2 The parallel-race pattern

You fixed two cross-file races and correctly predicted the pattern recurs with each new spec file. Two suites from now somebody loses a day to it again.

Make it structural rather than remembered: a shared fixture convention, per-worker namespacing, or a lint rule — whatever actually prevents a new spec file from reading a global count or competing for the shared catalogue row. **A gotchas entry is not a fix for something that recurs by construction.**

### 3.3 Backups — decide, and it is probably "do nothing"

Pro plan already includes 7 days of daily backups. PITR is an add-on at roughly **$100/month for 7-day retention** *(Supabase pricing, verified 11 August — re-check before committing spend)*.

My read, and you should push back if you disagree: **do not buy PITR.** On this project a restore is a documented compliance event that can un-withdraw a consent, and `docs/restore-runbook.md` exists because of it. Paying to make restores easier and more granular buys more of the thing you have designed defences against. Daily backups plus the runbook is the right posture.

Write the decision down either way, because "we never discussed backups" is not a position you want to be in after an incident.

---

## Part 4 — One calendar

There are now three clocks in this project: real dates, a "project calendar" running five days ahead, and sprint labels. `handover.md` says *"do not try to reconcile them; they are different clocks."*

**Reconcile them.** This project has a 15-day statutory reporting deadline and a 90-day retention promise. Anyone reconstructing an incident later reads the documentation, not the commit metadata, and the documentation is systematically five days wrong. The escalation drafts already got their arithmetic wrong from exactly this confusion.

- **Every date in a document is the real date.** No exceptions.
- Sprint labels stay as labels — `BE-W8`, not "week 8, 23 August".
- Fix the headings in `.ai-collab/handover.md` and `decisions.md` where they carry project-calendar dates, and note the correction rather than silently rewriting.

---

## Part 5 — Do not build

- **No pipeline orchestration.** See the top of this document.
- No LLM gateway beyond the role and grants that already exist.
- No transcription, redaction, analysis or AE detection beyond ingest.
- No adverse-event notification, escalation or org structure. Still blocked on the PV sign-off.
- No new upload mechanism, no second dead-letter mechanism.

## Rules

No features beyond the list. Reversible migrations. No PHI in committed test data. **Ask before adding any dependency.** If a requirement is ambiguous, stop and ask.

Anything you build, check that something calls it. That check has now caught two functions that worked perfectly and enforced nothing.

## Required at the end

**Append a `### BE-W8 — Operational readiness` section to `PROJECT-OVERVIEW.md`.**

Include:

- The localhost guard: what it refuses, and how you proved it refuses
- The measured volume numbers, with the batch sizes and timings, not a verdict
- What the first real scheduled run did, with its timestamp — or that it did not fire
- The seeding decision on `audit_log`, stated plainly
- Your backup decision and reasoning
- Anything in this prompt you think is the wrong call

Then update `docs/gotchas.md`.

---

*Supabase PITR pricing cited from https://supabase.com/docs/guides/platform/backups, read 11 August 2026 — treat as indicative and re-verify before spending.*
