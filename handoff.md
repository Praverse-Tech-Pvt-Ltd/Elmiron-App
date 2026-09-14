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

---

# STATUS AS OF 11 SEPTEMBER 2026 — read this first

**Everything above this line describes 7 September and is kept for history. Where it
disagrees with this section, this section is right; where this section disagrees with
`PROJECT-OVERVIEW.md` or `docs/gotchas.md`, THOSE are right.** Those two are append-only
and durable; this file is a snapshot and goes stale the way the version above it did.

## What changed in four days

**The backend did not stop at BE-W8.** Migrations went from 19 to **56**. Twenty-eight
review rounds (`MR-14` → `MR-28`) ran across 9–11 September, and the work was not "frontend
on top of a frozen backend" — most rounds changed both halves, because most defects were in
the seam between them.

## The one-line state

**`G-WRITE` is MET.** All five MR write paths — check-in, check-out, consent, samples, call
report — write to Supabase from real screens, **online and offline**, exactly once, with
capture timestamps preserved through the queue, and all four project SQLSTATE refusals
(`45001`, `45004`, `45007`, `45008`) reach the MR with their own remedy and never another's.
Proved on an emulator with the database watched, not asserted.

**`FE-G1` and `FE-G2` are NOT met and are blocked on two things that are not engineering:**
a real Xiaomi/Oppo/Vivo/Realme handset (`blocked-on-you` 5.1, open seven weeks) and a
**dev-client build** — JDK 17, CMake, `expo prebuild` — deferred since MR-14 and now the only
item on the critical path from this side. Expo Go cannot load
`react-native-background-geolocation` or `expo-audio`'s native halves.

## What a new reader most needs to know

**The app is no longer on the mock for the paths that matter.** Reads come from `sync_pull`
through `apps/field/src/sync/pulled-store.tsx`; writes go through one `sync_push` RPC via
`apps/field/src/sync/push-client.ts`. `createClientForScenario()` (the `:4010` mock) still
serves `coaching`, `analysis`, `mileage`, `reply`, `day-end` and `beat-plan`. The
module/screen split is the two-column table in `PROJECT-OVERVIEW.md`'s MR-14 section,
updated since.

**Nothing in the client decides permissions, and nothing re-derives a server rule.** Two
rules earned the hard way:

- The **ordering** of consent-notice precedence exists exactly once, in
  `public.consent_text_version_precedence`, and is *transmitted* to the client (MR-27 B1).
  The client mirrored it for one session and that duplication would have failed as a `45001`
  in front of a doctor, not as a red test.
- The **clock** is always the server's. `serverTime` from the last pull drives both the
  territory day (MR-15 A2) and the consent activation window (MR-28 A2). Reading
  `new Date()` for either is a defect, and both have been shipped once.

**`sync_push` now carries a refusal's FIGURES, not just its sentence** (`BE-W97`, MR-28 B).
`sqlDetail` and `sqlHint` are the raise site's `DETAIL`/`HINT`, verbatim, and are
**rendered, never parsed**. `sqlState` is the contract.

## The blocking list has not moved

`docs/blocked-on-you.md` is current and is the file to read next. The three that matter:

1. **5.13 / `BE-W93` — the fiduciary name.** `consent_records` is append-only, so every
   consent captured before the organisation's registered name exists is permanently
   defective **and cannot be amended by design**. This one compounds daily; the rest wait.
2. **5.9 — the UCPMP cap value.** A build-failing deadline of **6 November** is wired, with
   a warning from 16 October. Do not invent a value; `check:decision-debt` exists to stop
   exactly that.
3. **5.1 — the handset.** Two device gates, seven weeks, nothing else can close them.

## Two things that are true and easy to misread

- **A dead-letter REPLAY carries no refusal figures.** `sync_items` stores the message and
  no SQLSTATE, so the sixth attempt at an item answers `sqlDetail: null` — the first five
  each carried them. Recorded, not closed; closing it is two new columns.
- **`FE-W41`** — the samples screen's cap note says the app does not count against the UCPMP
  cap. That becomes false the day **5.9** is answered, and it sits three lines under a
  refusal that quotes the cap. Copy defect, not a write-path defect.

## Verification commands, in the order a new machine needs them

```
pnpm db:start            # now also runs db:instrument (BE-W92's log_lock_waits)
pnpm --filter @fieldforce/api seed:day
pnpm ci:local            # 13 static steps; --with-db adds the database job's 6
pnpm ci:local --with-db  # needs Docker; verify:rollbacks EMPTIES the schema, db:reset after
```

**`pnpm ci:local` green is not "CI will pass".** It deliberately omits the database job and
says so loudly on stderr. The half that needs no database —
`verify-rollbacks.mjs --files-only` — was moved into the STATIC job precisely because the
end-of-run warning fired at the wrong moment twice (MR-26, MR-27).

## MR-29 — the dev-client build

**The app now runs as a real Android build.** `com.praversetech.fieldforce`, a 79 MB debug
APK from `apps/field/android/`, installed on the Pixel_10 AVD, signed in, driven to Today,
and used to write a real check-in to Postgres. Not Expo Go.

- **CI `34598547854`** — workflow `CI`, event `push`, SHA
  `f7a684c569f73a4062039d8af3ac736be015942a`, **success**, and that SHA **equals HEAD**.
- **`BE-W92`'s instrument earned itself on its first run.** A live deadlock in
  `tenant-boundary-restrictive.spec.ts` was named down to its relations. It has now happened
  twice in three local runs and the relations DIFFERED between them — `auth.users` /
  `auth.identities` once, `storage.objects` / `storage.buckets` once. Registered as
  **`BE-W99`**; CI is green on the same SHA, so it will meet this eventually.
- **The device-clock class is closed at the SOURCE** (`A3`). Eleven sites, six allowlisted,
  five real and registered as **`FE-W42`**, blocked on `FE-W40`. Adding the rule exposed
  **`FE-W43`**: MR-25 C1's screens-only block had silently switched the component-extraction
  rule OFF for every screen, because flat config REPLACES `no-restricted-syntax` rather than
  merging it. Verified, not reasoned — the same import raised 2 errors in `src/` and 0 in a
  screen.
- **Defect 12 was not an exactly-once failure** and the record now says so. The second press
  made a genuinely new request id and `sync_items.id` did what it promises; the defect was
  that the screen did not reflect the FIRST acceptance. Confirmed fixed on the real build.
- **One new defect, found by pressing the button.** The voice-note screen reported a failed
  network fetch as *"Could not open the microphone"* — one `.catch` over two unrelated
  operations, so the MR got the wrong remedy. Split, with a new route test and a two-sided
  mutation.

### What a new machine needs that the old notes get wrong

- **`JAVA_HOME` is unset here and `java` is already 17.0.12.** The "terminal JAVA_HOME is
  JDK 25" lines in `frontend-status.md:287/:344` and `frontend-handoff-2026-09-07.md:70` are
  **stale**; `frontend-status.md:100/:111` records the same problem RESOLVED on 27 August.
- **`gotchas.md`'s "CMake 3.22.1 cannot build this app" did not reproduce** under RN 0.86.2.
  AGP auto-provisioned `cmake;3.22.1` and `ndk;27.1.12297006` and every CMake task passed.
  Do not spend an afternoon installing 3.31.6 before testing whether you need it.
- **The build fails at `:app:packageDebug` with `OutOfMemoryError: Java heap space`** —
  Gradle's heap, not system memory. `org.gradle.jvmargs=-Xmx2048m` while packaging four ABIs.
  For the emulator, pass the flag that file's own line 30 documents rather than editing it:

```
cd apps/field/android
./gradlew.bat assembleDebug --no-daemon --max-workers=3 -PreactNativeArchitectures=x86_64
```

  **That APK is x86_64 only.** A handset build needs the flag dropped, and then the heap
  raised, because four ABIs is what ran it out.
- **`adb emu geo fix` still delivers nothing, and the documented `set-test-provider-location`
  is not enough on its own** — `fused` must be ADDED as a test provider first, or it answers
  *"fused provider is not a test provider"*:

```
adb shell appops set 2000 android:mock_location allow
adb shell cmd location providers add-test-provider fused
adb shell cmd location providers set-test-provider-enabled fused true
adb shell cmd location providers set-test-provider-location fused --location LAT,LNG
```

  Latitude first, and re-push it while the screen is actually asking — a one-shot fix goes
  stale and the check-in honestly refuses rather than inventing a position.
- **`react-native-background-geolocation` is NOT a dependency of this app.** Location is
  `expo-location`, with no config-plugin entry, no `expo-task-manager`, and no
  `ACCESS_BACKGROUND_LOCATION` in the generated manifest. Background location is unwritten
  code, not untested code. `expo-dev-client` is not a dependency either and was not needed.

### Where MR-29 stopped

**After Part D, with Part C (`FE-W40` option D) deliberately not started.** It spans a new
pure module, a persisted anchor that must be cleared with the store, new state on
`pulled-store.tsx` which every screen reads, a new `TodayScreen` prop in `packages/ui`, and
the straddling-`18:30Z` matrix the decision document specifies. Part B was the session's
headline and landed end to end; starting a store-wide change on the tail of it is how the
wrong API gets frozen into the thing everything reads.

## MR-30 — FE-W40

**A cold start with no signal now shows the day.** It was the last engineering item standing
between an MR and a full offline morning, and an 8-hour `FE-G2` run met it on its first one.

- **CI `34826160203`** — `CI` / `push` / `246f216adc3107cfae84ecfef34c2c403ac06b99`,
  **success**, and that SHA **equals HEAD**.
- **`FE-G1` and `FE-G2` are blocked by the HANDSET ALONE.** `react-native-background-geolocation`
  is not a dependency of this app — background location is **unwritten**, not untested — and
  neither gate needs it. The Transistorsoft licence never blocked existing code; it blocks a
  build-versus-buy decision for unstarted work. `blocked-on-you.md` now says so where a buyer
  will read it.
- **`FE-W42` is unblocked** by `FE-W40`. Its five screens were waiting on exactly the answer
  that now exists. Copy `app/(tabs)/home.tsx`; the `eslint-disable`s carrying that id are the
  worklist.
- **`BE-W92` and `BE-W99` are one entry now**, and the measurement **refuted** the hypothesis
  `BE-W92` was carrying: `public.organisations` appears in none of the three samples.

### `FE-W40`, in one paragraph

The pull persists a `DayAnchor { serverTime, receivedAt, timeZone, zoneSource }` beside the
records. On a cold start the app projects the server instant forward by the elapsed device time
and renders the day **only while it still falls on the same territory day**; past that it
renders nothing and says why. `today` keeps its exact prior meaning, so only `home.tsx` changed;
`dayOrigin` (`live | anchored | expired | none`) is the new field and nothing else reads it.

**Two things to know before touching it.** The zone is persisted **with** the anchor, because
`fetchTerritoryZone` never throws — offline it answers `UTC_FALLBACK`, meaning *"the server
declined to say"*, and letting that overwrite a restored `Asia/Kolkata` renders every clock
5h30m wrong. And the anchor clears **with** the store, in one `persistence.clear`, because an
anchor outliving its records renders a real date over an empty store.

### New traps, all met this session

- **`eslint-disable-next-line` must be the LAST comment line.** A multi-line reason after it
  moves the directive onto a comment; ESLint then reports an *unused directive* **warning** and
  the real **error** separately, and neither points at the cause.
- **Airplane mode cannot simulate offline for a DEBUG build** — the JS bundle comes from Metro
  at launch, so the app never starts. Remove the API's reverse ports and leave `tcp:8081`.
- **Git Bash rewrites absolute DEVICE paths in `adb` commands.** `adb push x /data/local/tmp/x`
  fails with `secure_mkdirs()` because MSYS expands it to `C:/Program Files/Git/data/...`.
  `export MSYS_NO_PATHCONV=1`.
- **To drive calendar-dependent state, edit the app's storage rather than the clock.**
  `adb root` is refused on a production emulator image, but a debug build is `debuggable`:
  `run-as <pkg> cat databases/RKStorage` pulls AsyncStorage's SQLite file. Force-stop first and
  delete the `-journal`.

### And the rule this session produced

**When you correct a fact, grep for every other mention of it.** *"The terminal `JAVA_HOME` is
JDK 25"* stood in five places while `frontend-status.md:100` had recorded it resolved on
27 August. A reviewer working faithfully from the documents inherited the stale copy and wrote a
brief on it. The cost of the grep is nothing; the cost of skipping it is a session started on a
false premise.

## MR-31 — FE-W42 and the sentinel class

**No screen in `apps/field` takes the current instant from the handset any more.** The five
`FE-W42` sites are converted and the `eslint-disable`s carrying that id are gone. What remains
are the allowlisted elapsed measurements in `pulled-store.tsx` and the
`captured_at`/`occurred_at`/`recorded_at` records the server bounds with 45007 and 45008.

- **CI `34829719365`** — `CI` / `push` / `d76ca200c3c30509f2801881e9f9ba3c7141a9f5`,
  **success**, and that SHA **equals HEAD**.
- **`C1`'s verdict, which the last report left unstated: DEFER (`BE-W98`).**
  `explanation.ts:196` makes the action `escalate` for a dead letter whatever the SQLSTATE is,
  so the figures cannot change what anyone does next. Trigger to reverse: a manager-facing
  dead-letter queue.
- **`FE-W44`–`FE-W47`** registered from the sentinel sweep. `FE-W44` is the strongest: a
  corrupt queue store renders **"Everything sent"**, and the fix needs one sentence of copy
  nobody has written.

### The sentinel class has two sub-forms, and the second is worse

The brief said `UTC_FALLBACK` had no room in its type for "I don't know". It did:
`TerritoryZone.source` is `'territory' | 'fallback_utc'` and the type's own comment says a
caller must be able to tell. **Nothing read it** — `zone.source` was consumed in zero places
app-wide until MR-30.

- **(a) no room in the type** — `sqlState: ''`, `sizeBytes: 1`. Add room.
- **(b) room exists, nobody opens it** — worse, because the type review passes and the comment
  promises the property. The test is **"count the call sites that read the discriminant"**.

### Two defects in this session's own work, neither found by reading the diff

1. **`deserialiseAnchor` accepted any non-empty string as a timezone.** `Intl` throws on a bad
   zone, and that throw happened during hydration *before the pull ran*, so nothing rewrote the
   bad anchor — **sync permanently wedged, reported as "could not reach the server"**. Found by
   asking what the function does with input it has not validated.
2. **`lastSeenLabel(null)` reads "never visited".** With a nullable server clock a *visited*
   doctor produces `daysSince === null` too, so the list would have said a doctor seen last week
   had never been seen. Three states, not two; the third renders the date.

And a **dead guard I had just written**: `record.code === null || !RETRYABLE.has(...)` — the
null clause was inert, because `RETRYABLE.has(null)` is already false. Only mutation could tell,
because the code was *correct*. Restated positively so the type enforces it.

### If you are converting a screen to `serverTime`

- `serverTime` is nullable. Every fallback is a lie of the same shape — the device clock is
  `FE-W40` option B, and any fixed value renders like a measured one.
- Check what your **label function** does with the null you are now able to pass it. Two of the
  three states in `app/(tabs)/doctors.tsx` exist because of this.
- The window helpers are in `src/today/server-window.ts` and take the instant rather than
  reading one. Use them; do not reach for `getMonth()`.
- Test with values that **straddle 18:30Z**. `07:44Z` is the same date in UTC and IST and
  proves nothing.

### To drive a calendar-dependent state on the device

`adb root` is refused on a production emulator image, so the clock cannot be moved. Edit the
data instead, and **check which tenant you edited**: a first attempt this session moved a row
belonging to another seed run, RLS kept it out of this MR's pull, and the screen did not change.
Reading the device's own AsyncStorage is what separated *"the app is wrong"* from *"the app
never saw it"*.
