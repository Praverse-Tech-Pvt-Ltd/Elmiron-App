# Project Handoff — Backend

**Written:** 7 September 2026 · **Head:** `a60423a`, `main` level with `origin/main`
**Phase:** Backend stopped, by decision, at the end of BE-W8 (14 August). Frontend has
since done four sprints/phases of work on top of it. No backend code has moved except
one unblocking script. **This file was last written 17 August and had gone stale in
exactly the way `handover.md` warns about — it described BE-W8 as "not started" three
weeks after it finished.** Rewritten from the actual repo state, not from the previous
version of this file.

> `.ai-collab/` and this file are **tracked as of BE-W8** (14 Aug) — the original
> BE-W6 untracked-on-principle decision was explicitly reversed, on request, because a
> file nobody can find is worse than one that goes stale, provided it is kept current.
> It had not been touched by backend since. The durable, append-only records are
> `PROJECT-OVERVIEW.md` and `docs/gotchas.md` — if this file disagrees with those,
> they are right.

---

## 1. What week are we at

- **Backend: BE-W8 complete, nothing started since.** Last backend migration is
  `20260817000200_purge_backlog_stall_detection.sql` (19 total). No `### BE-W9`
  section exists in `PROJECT-OVERVIEW.md`.
- **Frontend has moved a long way in the meantime:** FE-W1 → FE-W3, plus a separate
  "Phase 1–4" design/build track reaching consent-gated audio capture and a manager
  console (`a60423a`, 7 September). None of it required backend schema changes beyond
  one script (§4).
- **The only backend-owned change since 14 August:** `cb075b1` (3 Sept, Dev Patel) —
  `seed-one-mr.mjs` was dead code (wrong import specifiers, would `ERR_MODULE_NOT_FOUND`
  the instant anyone ran it, and nothing ever had). Rewritten self-contained to match
  its five siblings and given a real test. Not a new feature; a repair of something
  that never worked.
- **The whole monorepo scope renamed** `@elmiron/*` → `@fieldforce/*` (`f34ceef`,
  Frontend, "remove a third party's trademark from the permanent identifiers" — Elmiron
  is a real branded drug name, and this app is not that drug). 53 files, all package
  names, imports and CI `--filter` arguments. It reached `main` as a fast-forward — no
  backend work was in flight to conflict with it, so nothing needed reconciling. Worth
  knowing the identifier changed everywhere including `services/api/package.json`.

## 2. Verified this session, not assumed

```
services/api  typecheck   clean
services/api  lint        clean
services/api  vitest run  344 passed, 14 files (Docker up)
verify:rollbacks           19/19 reversed, public schema empty, database restored
```

344, not the 312 from 17 August — the seed-one-mr repair added its own spec file. Full
monorepo `pnpm run build` was **not** waited on this session (frontend packages make it
slow); backend-scoped checks above ran directly and are what this handoff is based on.

## 3. Production — reconfirmed 7 September, after being found paused

**Update, same session as the paragraph below was first written:** a live connection
attempt failed with `tenant/user postgres.pgfdbzoapmleqtoezhoa not found`. Checked via
the Management API rather than guessed at: `status: "INACTIVE"` — the project had
**auto-paused**. The org is on Supabase's free plan, and free-tier projects pause after
a period of no database activity; both retention workflows had been
`disabled_manually` since 23 August, which removed the only regular traffic keeping it
warm. Self-inflicted, not an infrastructure failure.

**Resumed and reverified with a real query, not the dashboard's word for it:**
`POST /v1/projects/<ref>/restore`, polled to `ACTIVE_HEALTHY` (~3 minutes), then
confirmed directly — 19 migrations, 40 public tables, and all three BE-W8 threshold
values intact (`purge_batch_limit=250`, `purge_backlog_multiplier=3`,
`purge_max_silence_hours=12`). Nothing was lost across the pause. Full timeline in
`.ai-collab/decisions.md` → 7 September.

**Still true: both retention workflows remain `disabled_manually`.** Resuming the
project makes it reachable; it does not put anything back on a schedule. If they stay
off with nothing else touching the database, the project will pause again the same
way — this is not a one-time fix.

| Fact, as verified (14 Aug, reconfirmed 7 Sept) | |
| --- | --- |
| Migrations applied | 19 (includes both BE-W8 additions) |
| Tables | 40 |
| RLS enabled and forced | on every table |
| Custom access token hook | enabled, proven by a real sign-in |
| `purge_max_silence_hours` / `purge_batch_limit` / `purge_backlog_multiplier` | 12h / 250 / 3 — the backlog-based stall fix (§5) |
| Seeded reference data | **none.** No orgs, territories, doctors, consent-text. Capture refuses, correctly. |
| GitHub Actions secrets | all three set (`SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) |

## 4. What frontend has been waiting on backend for

Two concrete, cheap, still-open items — found in `docs/blocked-on-you.md` and
`docs/backend-request-scope-rename.md`, both addressed to backend and neither closed:

1. **Deep-link redirect URL, `services/api/supabase/config.toml`.** Never added:
   ```toml
   additional_redirect_urls = ["http://127.0.0.1:3000", "https://127.0.0.1:3000", "com.praversetech.fieldforce://auth-callback"]
   ```
   Not urgent — nothing exercises the redirect path yet, the app signs in with the
   password grant — but it matters the moment OTP, a magic link or OAuth is used, and
   it is a one-line miss that will read as a mystery bug later. Same config change
   needed on any hosted project, not just local.
2. **The package-scope rename (§1) landed cleanly** — the sequencing risk in
   `backend-request-scope-rename.md` never materialised because backend had nothing
   in flight to conflict with it. Nothing to do here now; noted so nobody re-reads
   that file and thinks it's still live.

## 5. What BE-W8 actually shipped (for anyone who only has this file)

Full detail is `PROJECT-OVERVIEW.md` → `### BE-W8` and its `§7` addendum, and
`.ai-collab/decisions.md`. Summary:

- **`verify:rollbacks` and `reconcile-after-restore --apply` refuse a non-local /
  implicit target.** The hazard `.ai-collab/handover.md` had documented three times as
  a rule for humans to remember is now enforced in code.
- **Retention schedule found under-provisioned ~16x at pilot scale** (daily cron,
  batch 100, against ~1,600 audio objects/day arrival) — moved to hourly, batch made
  configurable (`app_thresholds.purge_batch_limit`, default 250).
- **Stall detection redesigned from a single-object trip-wire to backlog-based.** The
  first version of this fix (3h, single object) would have refused the whole fleet on
  ordinary GitHub Actions scheduling jitter — caught before it reached production.
  Now: primary signal is backlog size (`purge_backlog_multiplier` × batch), secondary
  is a 12h hard ceiling for a worker that dies before any backlog accumulates.
- **A caught-and-corrected false claim, on the record rather than buried:** an early
  draft of that fix wrongly asserted `audio_purge_health()` had been broken since
  BE-W6. It hadn't — a later migration had already fixed it; the claim came from
  reading one `create or replace` and missing another. Caught by querying the live
  database before pushing, not after.
- **Idempotent reference-data seed script exists** (`seed-reference-data.mjs`) but has
  **never been run against production** — no real org/territory/doctor data exists to
  seed it with.
- **PITR decision: do not buy it.** Daily backups + `docs/restore-runbook.md` is the
  posture. Recorded in `.ai-collab/decisions.md` with reasoning.
- **Retention workflows are currently `disabled_manually`**, on explicit instruction,
  as of 23 August. Both had been running green on real hourly/15-min cron since the
  14 August re-enable — this was not a response to a failure, and no reason was given.
  **This is the reminder-mechanism gap flagged in `decisions.md`: a disabled workflow
  is silent, and it directly caused the project to auto-pause (§3)** — three weeks
  with no traffic at all, on a free-tier project, is exactly what makes Supabase pause
  it. Production is reachable again as of 7 September (§3), but **the schedules are
  still off**, so the same thing will happen again unless someone either re-enables
  them or decides, on purpose, to accept the pause-and-manually-resume cycle.

## 6. Explicitly deferred, not forgotten

Both named and accepted as real, cheap, and correctly not worth another backend week
ahead of frontend's progress:

- **The `.ai-collab/` split** — track the six durable files as-is (`constraints.md`,
  `bug-log.md`, `flow.md`, `test-checklist.md`, `rollback.md`, `architecture.md`);
  strip point-in-time claims out of `handover.md` and this file specifically into
  pointers at `PROJECT-OVERVIEW.md`. **This handoff is itself evidence for why:** it
  went stale in three weeks exactly as predicted.
- **Production-migration audit trail.** Two `supabase db push` calls were run by hand
  outside CI during BE-W8. No incident resulted, but there's no runbook step or
  workflow enforcing verification — named so a third one doesn't go wrong silently.

## 7. Open items with real dates, unchanged since BE-W7/W8, not touched by any of the above

From `docs/blocked-on-you.md` §4 and `PROJECT-OVERVIEW.md`'s open questions — none of
this moved while backend was stopped:

1. **Contract I3 (STT vendor + Hinglish WER) — CI goes red 30 September** unless
   `TranscriptV1` exists. Today is 7 September. **Three weeks.**
2. **PV/privacy sign-off** — two specific questions (does `reported_text` carry patient
   info; does an AE report survive a consent withdrawal), open since sprint 1, both
   currently answered by default rather than decision, both baked into a deployed
   schema.
3. **Supabase DPA question** — infrastructure-level retention of a deleted storage
   object. Draft exists (`docs/escalations-week8.md`), not yet sent. Decides whether
   the 90-day promise is literally true.
4. **Per-territory shift hours from the client** — capture refuses without them; the
   org-default window expires 60 days after being set.
5. **`sync_push` at real concurrency** (100 MRs at 6pm, one session pooler) — a
   connection-count question, explicitly unmeasured, explicitly out of BE-W8's scope.

## 8. Immediate next steps, in order

1. ~~Confirm production is actually reachable~~ **Done, 7 September** — it had
   auto-paused (free tier, no traffic since the 23 Aug disable); resumed and
   reverified with a real query. See §3.
2. ~~Decide on `retention.yml` / `retention-watchdog.yml`~~ **Done, 7 September** —
   both re-enabled (`gh workflow enable`). **Not yet reconfirmed on a real cron
   cycle** — check `gh run list --workflow=retention.yml
   --json event,createdAt,conclusion` for an `event: schedule` success before
   trusting it, same as BE-W8 required the first time.
3. **Decide on the `.ai-collab/` split and the migration-audit-trail gap** (§6), or
   consciously defer again with a reason.
4. **Send the two drafted-but-unsent escalations** (§7.2, §7.3) — both have been
   ready to send since sprint 1 and sprint 7 respectively.
5. **Add the deep-link redirect entry** (§4.1) — one line, no dependencies.
6. Only after the above: pick up wherever `PROJECT-OVERVIEW.md`'s next backend prompt
   points, or write one.

---

## Correction — 7 September 2026 (FIX-01)

This section corrects two facts stated earlier in this file and elsewhere. **The earlier
statements are left in place**, per the section-freezing rule in `.ai-collab/decisions.md`.

### "40 public tables" is 34 tables and 6 views

**Replaces:** the figure `40 public tables` at line 66 of this file, in the account of the
7 September production resume, and the same figure in `.ai-collab/decisions.md` under
7 September.

Measured against the applied 19-migration schema:

```
tables in public                             -> 34
RLS enabled | forced | total (relkind='r')   -> 34 | 34 | 34
policies in public                           -> 41
views in public                              ->  6
tables + views                               -> 40
```

`34 + 6 = 40`. The most likely origin is a count over `information_schema.tables`, which
includes views unless filtered to `table_type = 'BASE TABLE'`.

**`PROJECT-OVERVIEW.md` was already correct** — it has said "34 tables … 41 policies,
6 views" since BE-W2. The append-only record outranked the handoff, which is what it is for.

**Scope of this correction, stated honestly:** the measurement above was taken on a **local**
stack running the same 19 migrations. Production could not be verified from the machine that
found this — the Elmiron-App project is not in the Supabase account connected there, and no
production credentials are present. The *arithmetic* is not in doubt; that production carries
the identical schema is inferred from the migration count and is **UNVERIFIED**. Anyone with
production access should confirm with:

```sql
select
  (select count(*) from pg_tables where schemaname='public') as tables,
  (select count(*) from pg_views  where schemaname='public') as views;
```

Nothing about the resume account changes: the project was paused, was resumed, and lost
nothing. Only the noun is wrong.

### There is no root `app.json`

**Replaces:** the claim — carried in `docs/frontend-handoff-2026-09-07.md` (lines 94 and
186), `docs/frontend-status.md` (line 276) and `PROJECT-OVERVIEW.md` (line 3820) — that the
**root** `app.json` still declares `com.anonymous.elmironapp` from a prebuild run in the
wrong directory.

```
$ find . -maxdepth 2 -name app.json -not -path "./node_modules/*"
./apps/field/app.json
```

There is no root `app.json`. `apps/field/app.json` correctly declares
`"package": "com.praversetech.fieldforce"`, and `com.anonymous.elmironapp` now survives
**only in the four prose references above**. Any task list carrying "fix the stale package
id in the root app.json" should treat it as a no-op and correct the prose instead.

---

## Correction — 8 September 2026: the 23 August disable WAS preceded by failures, and the cause was not the workflows

**Replaces:** the claim at §5, *"Both had been running green on real hourly/15-min cron
since the 14 August re-enable — this was not a response to a failure, and no reason was
given."* The first half of that sentence is true up to a point in time; **the second half
is wrong.** The text above is left exactly as written, per the section-freezing rule.

### What the run history says

```
$ gh api "repos/.../actions/runs?created=2026-08-20..2026-08-24"
runs in 20-24 Aug: 100
  ('Audio retention',          'schedule', 'failure') -> 33
  ('Audio retention',          'schedule', 'success') -> 17
  ('Audio retention watchdog', 'schedule', 'failure') -> 32
  ('Audio retention watchdog', 'schedule', 'success') -> 17
  ('CI',                       'push',     'failure') ->  1
```

There is **exactly one transition** in that window, and no flapping:

```
TRANSITION success -> failure at 2026-08-21T22:11:01Z   (run 32531877892)
runs after the transition: 65
any success after it: 0
workflows affected: ['Audio retention', 'Audio retention watchdog', 'CI']
last success anywhere before it: 2026-08-21T21:12:17Z
```

So both retention workflows had been failing for **about 34 hours** before the 23 August
disable, and so had CI.

### What made them fail — and it was not the retention code

The job objects are the evidence, and the comparison is decisive:

```
last success  21 Aug 21:12 -> runner_id 1000000703, runner_name 'GitHub Actions 1000000703', steps: 12, 23s
first failure 21 Aug 22:11 -> runner_id 0,          runner_name '',                          steps:  0,  3s
23 Aug CI push, both jobs  -> runner_id 0,          runner_name '',                          steps:  0,  2s
```

**No runner was ever assigned and no step ever ran.** That is not a purge failure, a
database failure, a credential failure or a migration failure — nothing in this repository
executed. `gh run view --log-failed` returns `log not found` for every one of them, which
is consistent: there is no log because there was no run.

The signature — a job created, never dispatched, `conclusion: failure` rather than
`startup_failure` (so the workflow parsed and the job existed), across **every** workflow
including CI on a push — is what GitHub produces when a job cannot be allocated a hosted
runner. The ordinary cause is Actions minutes or a spending limit being exhausted at the
account level.

**UNVERIFIED: the specific account-level cause.** That is on a billing page this machine
cannot read. What *is* verified is that it was infrastructure-level and repository-wide,
not workflow- or code-level.

### The sequence, corrected

1. **21 Aug ~21:12–22:11** — jobs stop being assigned runners. Every workflow, not just
   retention.
2. **21–23 Aug** — 65 consecutive failures, zero successes.
3. **23 Aug** — the retention workflows are disabled.
4. **24 Aug – 6 Sept** — **zero workflow runs of any kind.**
5. **7 Sept** — re-enabled; both scheduled runs succeed with real runners and all steps.

**The reviewer's proposed sequence — "failed 22 Aug → disabled rather than fixed → no
traffic → auto-paused" — is right about the order and wrong about the middle.** They were
not disabled *rather than fixed*: nothing in this repository could have fixed them, because
nothing in this repository was running. Disabling a workflow that fails every hour without
executing a line is a reasonable response to noise. **The consequence still stands
exactly**: no runs → no traffic → the free-tier project auto-paused → unnoticed for two
weeks.

And §5's "no reason was given" is now explained, if not excused: there *was* a reason, it
was 34 hours of red builds, and it was not written down.

### Is the cause still present?

**No.** The 7 September scheduled runs were assigned real runners and executed every step:

```
retention.yml          run 34135046578  2026-09-07T14:49:25Z  event: schedule  success
retention-watchdog.yml run 34136136779  2026-09-07T15:01:48Z  event: schedule  success

purge 38e1d02f-…: closed 0 stale session(s), claimed 0, destroyed 0, failed 0
{ "stalled": false, "destroyedTotal": 0, … }
Audio retention is healthy.
```

**UNVERIFIED: what changed.** Nothing in this repository explains it. A billing-cycle reset
between 21 August and 7 September is consistent with the evidence and is not evidence.
**What to watch:** the same signature — `runner_id: 0`, zero steps, a few seconds — is how
it will look if it recurs, and it will look identical for CI and for retention, which is
the quickest way to tell an account-level outage from a code failure.
