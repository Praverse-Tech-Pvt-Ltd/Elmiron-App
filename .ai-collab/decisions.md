# Decisions

> **The real decision log is `PROJECT-OVERVIEW.md`** — "Architecture decisions", the
> reviewer decisions, and one `###` section per week under "Phase log". It is tracked,
> append-only, and reviewed. **Do not duplicate it here**; a second copy drifts, and a
> drifted decision log is worse than none.
>
> This file holds only decisions **not yet written there**, and a short index of where
> the big ones live.

---

## BE-W7 — 16 August 2026 · Model: Claude Opus 5

All of these are written up in full in `PROJECT-OVERVIEW.md` → BE-W7. Kept here in
one-line form for scanning.

### Scheduled GitHub Actions, not `pg_cron`

- **Decision:** two scheduled workflows (worker + separate watchdog), plus a
  database-side backstop that refuses new audio when the purge stalls.
- **Alternatives:** `pg_cron` + `pg_net` calling an Edge Function (the reviewer's
  recommendation); `pg_cron` doing the whole job in SQL.
- **Why this won:** `pg_net` is asynchronous, so a SQL worker would have to confirm a
  destruction before knowing the delete succeeded — which destroys the one guarantee
  the design has. An Edge Function means a second implementation of a
  compliance-critical worker, and the local stack runs no edge runtime, so it could
  not be tested at all. Both extensions were verified available first, so this is a
  choice and not a limitation.
- **Cost accepted:** the schedule lives in the repo, not next to the data. Mitigated
  by the backstop, which cannot be switched off.

### The upload grant covers the whole object

- **Decision:** one grant per object, re-validated on every resume and chunk;
  single-use means consumed at **finalisation**, not at first byte. Two clocks — a
  15-minute slide under an immovable 24-hour ceiling.
- **Alternative:** a grant per chunk.
- **Why this won:** a grant is permission to write one object at one key, and the key
  is unique — per-chunk grants would re-issue the same key repeatedly, which makes
  "single-use" meaningless rather than stricter.

### Consent is checked *before* session state

- **Decision:** in `assert_upload_still_permitted`, consent first.
- **Why:** the withdrawal cascade sets the session to `revoked`, so a state-first
  ordering tells the MR "this grant is revoked" — true, useless, and it maps to
  `validation_failed`, whose sentence is *"the server refused the contents of this
  item"*. The MR would be told their recording was malformed when the doctor simply
  changed their mind.

### The reconciliation does not fabricate a withdrawal

- **Decision:** quarantine the visit; a named person clears it with a mandatory
  reason.
- **Alternative:** insert the withdrawal the absence implies.
- **Why this won:** the ledger's entire value is that every row is a real thing a real
  doctor really did. An inferred row would be indistinguishable from a genuine one
  forever afterwards. A blocked recording is recoverable; an un-withdrawn consent is
  not.

### Quarantine scope is the visit, not the doctor

- **Decision:** visit. The doctor id is recorded on the finding so widening it is one
  insert.
- **Why:** a missing object can be an ordinary storage fault, and blocking a doctor
  on that evidence turns a *possible* compliance question into a *certain* outage
  across their territory. Stated rather than hidden, because it is a genuine trade.

### `storage_ceiling_exceeded` was drafted and removed

- **Why:** the ceiling is checked in `begin_upload`, which the client calls
  interactively, so the refusal never travels through the queue. A rejection code no
  code path can produce is a vocabulary entry that looks like coverage and is not.

### `reported_text` kept on the adverse-event record

- **Decision:** keep it, and flag it hard.
- **Why:** a report with no description discharges no duty. It is also the one field
  that can carry patient information — the §2.6-vs-DPDP contradiction nobody has
  ruled on. Omitting it would have decided that question silently by making the
  feature useless. **This is the top item for the PV/privacy sign-off.**

### An adverse-event report survives a consent withdrawal

- **Decision:** it survives.
- **Why:** a pharmacovigilance duty is a separate legal basis from consent, and
  destroying a statutory record to satisfy a privacy request is not a trade a schema
  should make on its own. **This is a default, not a ruling** — flagged for the
  sign-off.

---

## 17 August 2026 · Model: Claude Opus 5

### The retention schedules stay live while the secrets are absent

- **Decision:** leave `retention.yml` and `retention-watchdog.yml` firing on their
  cron with no secrets set, so both fail daily until deployment. **Do not** comment
  out the `schedule:` blocks, and do not add a skip.
- **Alternative:** disable the two schedules, keep `workflow_dispatch`, and re-enable
  them as a deployment step.
- **Why this won:** the daily red *is* the reminder. Disabling it removes the only
  thing that would otherwise surface a forgotten deployment step, and the window is
  about five weeks to pilot rather than open-ended.
- **Cost accepted, explicitly:** roughly 70 failed runs before pilot, and the alert
  fatigue that comes with them. If people start filtering these mails, the decision
  has failed and disabling the schedules becomes the better option — that is the
  signal to revisit, not a fixed date.
- **Why the absence was safe when this was written:** the remote database held none
  of the 17 migrations, so there were no `recordings` rows, no `received_at` on
  anything, and the 90-day clock had not started. There was also no field app.
  **If any of those three become false, this decision expires.**
- **The backstop that makes forgetting survivable:** `begin_upload` refuses new audio
  once objects are past their purge date. A forgotten purge becomes "uploads stop",
  not "audio retained unlawfully".

> ### EXPIRED THE SAME DAY — 17 August, a few hours later
>
> **`supabase db push` was run. All 17 migrations are deployed.** The first of the
> three conditions above is now false, so the reasoning that justified leaving the
> secrets unset no longer holds.
>
> What has *not* changed: the schedules should still stay live and red. That part of
> the decision was about skip-versus-fail and is unaffected.
>
> What HAS changed: **setting the secrets is now the correct next action rather than
> a premature one.** The specific objection — that a worker pointed at an empty
> database dies on `function public.claim_expired_audio does not exist`, a red that
> reads as a code defect — is gone, because the function now exists on the remote.
>
> Still true and still a reason for care: there is no seeded data and no field app,
> so a purge run would claim nothing. It would be green and harmless, which is the
> right state to reach before there is anything to lose.

---

## 14 August 2026 (real date) · BE-W8 · Model: Claude Sonnet 5

### The retention schedule was under-provisioned ~16x — resized, not just documented

- **Finding:** Part 3.1's local measurement showed the DB side draining 5,000 objects
  in ~30s (50 runs × ~591ms at batch 100). The bottleneck was never throughput — it
  was that the cron only ran once a day. Against the stated pilot size (100 MRs × 8
  visits/day, each visit producing a doctor recording and an MR voice note ≈ 1,600
  audio objects/day), a daily cron at batch 100 drains 100/day against ~1,600/day
  arrival: short by roughly 16x, on day 91, by arithmetic rather than by accident.
- **Decision:** `retention.yml` moved from daily (`30 19 * * *`) to hourly
  (`0 * * * *`), same batch of 100 → 2,400/day, 1.5x headroom. The watchdog
  (`retention-watchdog.yml`) moved with it (15-min offset), and
  `purge_max_silence_hours` moved 48 → 3 (migration
  `20260817000100_retention_schedule_resize.sql`, applied to production).
- **Why hourly rather than a bigger daily batch:** a failed run costs an hour of
  drain instead of a day, and the blast radius per run stays small — more forgiving
  of the kind of environmental failure this project has already hit twice (the
  secrets gap, the IPv6 direct-connection trap).
- **What the backstop means here:** `begin_upload` refusing new audio when the purge
  stalls is *correct* — an availability failure beats a compliance failure. The
  finding is that it would have fired by arithmetic, not by accident, three months
  into the pilot, taking every MR in the fleet down to record at once. Now it has
  1.5x headroom instead of a 16x deficit.
- **Surfaced a real test hazard, not a coincidence:** tightening the threshold from
  48h to 3h turned two already-committed test fixtures (`consent-audio.spec.ts`,
  backdated 1 day) into a cross-file race — any test running concurrently against
  the shared local database would see the global stall flag trip. Fixed with a named
  constant (`OVERDUE_NOT_STALLED_MINUTES` in `tests/db.ts`) rather than a smaller
  raw interval, so the next author reaches for it instead of re-discovering the trap.

### PITR — decided, not bought

- **Decision:** do not buy Point-in-Time Recovery. Daily backups (included in the
  Pro plan) plus `docs/restore-runbook.md` is the right posture.
- **Why:** a restore on this project is a documented compliance event that can
  un-withdraw a consent — that is the entire reason the runbook and the post-restore
  reconciliation worker (`reconcile-after-restore.mjs`) exist. Paying for
  finer-grained restore points buys more of the exact thing the design already
  defends against, not less risk.
- **Cost, stated plainly:** if a real incident needs a restore point finer than the
  last daily backup, that gap is accepted. Revisit if a real incident makes that
  gap the actual problem, not preemptively.
- **Unverified, flagged rather than silently trusted:** the ~$100/month PITR figure
  in `docs/backend-prompt-w8.md` is dated 11 August and explicitly marked
  "re-verify before spending." This decision doesn't depend on the exact price —
  the reasoning holds regardless of what PITR costs — but anyone revisiting this
  should re-check the number before treating it as current.

### Addendum, same day — the 3h stall threshold was itself dangerous

- **Finding:** the threshold change above fixed the cadence but shipped a check
  that trips on a **single** overdue object. With an hourly cron and a 3h bar, two
  ordinary GitHub Actions scheduling delays (already observed: 1h46m on a real run)
  are enough to refuse the whole fleet. Flagged by the reviewer before this reached
  production for real.
- **Decision:** `audio_purge_is_stalled()` redefined into two signals —
  **primary**: backlog > `purge_backlog_multiplier` (3) × `purge_batch_limit` runs'
  worth of overdue objects; **secondary**: a single object's age > 12h (was 3h).
  `purge_batch_limit` moved from a hardcoded 100 to a threshold, default 250.
  See `PROJECT-OVERVIEW.md` → BE-W8 §7 for the full writeup.
- **Correction, later the same day: this IS now applied to production.** Written
  originally when held back per explicit instruction to run nothing further until
  told. See the entry below — deployed, verified on the remote directly, and both
  workflows re-enabled.
- **Self-correction, recorded rather than hidden:** an earlier draft of this fix
  wrongly claimed `audio_purge_health()` had never returned `stalled`/
  `liveObjectCount` since BE-W6. It does — `20260816000300_resumable_upload.sql`
  redefines the function correctly; the wrong claim came from reading only the
  first `create or replace` in `20260815000300` and missing the later one. Caught
  by re-verifying against a real DB reset before committing, not after. Nothing
  incorrect was pushed.
- **Also true and unresolved, named so it isn't lost:** the reviewer's "13 hours
  out" catch was right — that line was written after the cron had already moved to
  hourly, reasoning from a schedule that no longer existed. The `.ai-collab/`
  split (durable six stay tracked as-is; strip point-in-time claims from
  `handover.md`/`handoff.md` into pointers) and the production-migration-audit-trail
  gap (two hand-run `db push` calls, no runbook step yet) are both accepted asks,
  deferred deliberately — real, cheap, and not worth another backend week ahead of
  FE-W1.

### Retention workflows: disabled, then deployed and re-enabled — the full timeline

- **Disabled:** both `retention.yml` and `retention-watchdog.yml` disabled via
  `gh workflow disable`, in-session, on the reviewer's explicit instruction ("I need
  the runs to stop for now ill tell when u are supposed to run"), shortly before
  07:00 UTC on 14 August. **Who:** the agent, on direct user instruction — not a
  unilateral call. **Why:** the stall-detection fix above was mid-review and not yet
  verified; nothing should fire against production while a change to the
  fleet-availability backstop was still being checked.
- **The reminder mechanism this removed, named rather than left implicit:** the
  17 August entry above records that a daily red run *is* the reminder against a
  forgotten deployment step. A disabled workflow is silent — it produces no red, no
  alert, nothing. For the ~35 minutes both were off, that protection did not exist.
  Not dangerous in that window specifically (no audio, no seed data, no field app),
  but the gap is the same shape the original decision existed to prevent, and it is
  now on record rather than invisible.
- **Deployed:** `20260817000200_purge_backlog_stall_detection.sql` pushed to
  production at 07:27:56 UTC, 14 August. Verified directly against the remote
  (not the CLI's success line): all three `purge_max_silence_hours` history rows
  present (48 → 3 → 12), `threshold_number()` resolves `purge_batch_limit=250`,
  `purge_backlog_multiplier=3`, `purge_max_silence_hours=12`, and
  `audio_purge_health()` returns the correct shape with `stalled: false`.
- **Re-enabled:** both workflows re-enabled via `gh workflow enable` immediately
  after the deploy was verified, 07:28 UTC, 14 August.
- **First real scheduled cycle, proven, not dispatched:** `Audio retention` fired on
  its own cron at **08:55:45 UTC**, `event: schedule` (not `workflow_dispatch`),
  run [31785943559](https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App/actions/runs/31785943559).
  Completed green in 22s: claimed 0, destroyed 0, failed 0 (empty database, as
  expected). `check-purge-health` ran immediately after in the same job and reported
  `"stalled": false` from the NEW backlog-based function — the whole chain proven
  end to end, not just the migration in isolation. `Audio retention watchdog`'s
  first post-re-enable fire is the remaining piece; see
  `PROJECT-OVERVIEW.md` → BE-W8 §7 for its result once it lands.

---

## 23 August 2026 · Model: Claude Sonnet 5

### Retention workflows disabled again

- **Decision:** `retention.yml` and `retention-watchdog.yml` disabled via
  `gh workflow disable`, at 08:44 UTC, 23 August.
- **Who:** the agent, on direct user instruction ("disable the scheduled workflows
  again") — not a unilateral call.
- **Why:** not stated by the user; not inferred or invented here. Both workflows had
  been running green on their real hourly/15-min cadence since the 14 August
  re-enable (last observed runs: retention at 08:15:58 UTC, watchdog at 07:47:31 UTC,
  23 August, both `schedule`-triggered and successful) — this was not a response to
  a failure.
- **The reminder-mechanism gap applies again, same as 14 August:** a disabled
  workflow produces no red, no alert. If this stays off for any length of time,
  nothing will surface a forgotten re-enable. No expiry or follow-up was requested;
  none is assumed here.
- **State as of this entry:** both `disabled_manually`. Migration
  `20260817000200_purge_backlog_stall_detection.sql` remains applied to production
  from 14 August — only the schedules are off, not the fix.

---

## 7 September 2026 · Model: Claude Sonnet 5

### Production had auto-paused; resumed and verified, not assumed

- **Finding:** asked to confirm production was reachable ahead of a handoff rewrite,
  a live pooler connection failed with `tenant/user postgres.pgfdbzoapmleqtoezhoa
  not found` — a Supabase-side error, not DNS or local network. Checked directly via
  the Management API (`GET /v1/projects/<ref>`) rather than guessing from the
  connection error alone: `status: "INACTIVE"`. The org is on the **free** plan.
  Free-tier Supabase projects auto-pause after a period of no database activity —
  and both retention workflows had been `disabled_manually` since 23 August (above),
  which removed the only regular traffic keeping it warm. Self-inflicted, not an
  infrastructure failure, and said so plainly rather than left ambiguous.
- **Decision:** resumed, on explicit instruction, via `POST
  /v1/projects/<ref>/restore`. Polled `GET /v1/projects/<ref>` until
  `ACTIVE_HEALTHY` (`COMING_UP` → `RESTORING` → `ACTIVE_HEALTHY`, ~3 minutes).
- **Verified with a real query afterward, not the API status alone:** 19 migrations
  recorded, 40 public tables, and all three BE-W8 addendum thresholds intact
  (`purge_batch_limit=250`, `purge_backlog_multiplier=3`,
  `purge_max_silence_hours=12`). Nothing was lost across the pause.
- **Still true, not resolved by this:** both retention workflows remain
  `disabled_manually`. Resuming the project makes it reachable again; it does not
  put anything back on schedule, and no instruction to re-enable was given here.
  Whatever kept the project paused for two weeks (no traffic at all) will recur
  the same way if the workflows stay off and nothing else touches the database.

### Retention workflows re-enabled

- **Decision:** `retention.yml` and `retention-watchdog.yml` re-enabled via
  `gh workflow enable`, at 08:40 UTC, 7 September — same session as the pause above,
  on explicit instruction.
- **Closes the loop from this same entry:** the project auto-paused specifically
  because these were off with no other traffic touching the database. Re-enabling
  them is what keeps that from recurring; leaving production resumed with the
  schedules still off would just delay the same pause, not prevent it.
- **Not yet observed on a real cron cycle this time** — both went from
  `disabled_manually` straight to `active`; the next scheduled fire (hourly for
  retention, `:15` for the watchdog) has not been checked. Worth a quick
  `gh run list --workflow=retention.yml --json event,createdAt,conclusion` next
  session rather than assuming green.

---

## FE-W1 — 14 August 2026 · Model: Claude Opus 5

Written up in full in `PROJECT-OVERVIEW.md` -> FE-W1. One-line form for scanning.

### Extraction rule removes the capability, not the symptom

- **Decision:** `apps/field` cannot import React Native visual primitives at all.
- **Alternatives:** a lint rule failing when a component is *defined* there (what was
  specified); a naming or directory convention.
- **Why this won:** same shape as "there is no upload endpoint without consent, not a
  disabled button". Detection finds a component after someone writes it; removing the
  materials means it cannot be written.
- **Cost accepted:** `import * as RN from 'react-native'` routes around it. Stops the
  accident, not the intent.

### No hoisting; the isolated-linker guard is intact

- **Decision:** `pnpm-workspace.yaml` unchanged. The Expo resolution failures were
  caused by `disableHierarchicalLookup` in our own Metro config, not by pnpm.
- **Alternatives:** repo-wide `nodeLinker: hoisted`; `publicHoistPattern` globs.
- **Why this won:** neither is needed once the Metro setting is removed. Hoisting
  would have deleted the install-time "cannot import what you have not declared"
  guarantee for `core`, `mock` and `api` to accommodate one app.
- **Compensating control added anyway:** `import/no-extraneous-dependencies`, so the
  property also holds at lint time if anyone hoists later.

### Production credentials moved out of the repo tree

- **Decision:** nine values to `~/.elmiron-prod.env`. Repo `.env` keeps localhost and
  public constants only.
- **Why this won:** three denylists had accumulated around one hazard, and the
  directory is uploaded to a third party at build time. Removing the class beats a
  fourth denylist.

---

## FE-W8 open item — the Android signing key

**Decide before the first Play Store upload. Unrecoverable afterwards.**

EAS Build generates the Android keystore and holds it on Expo's servers. Google
requires every update to an installed app to carry the same signing key, and there is
no recovery path if access to that key is lost — a lost Expo account means an app
that can never be updated, only republished under a new listing.

Two mitigations. Pick one:

1. **Download and back up the keystore** (`eas credentials`) somewhere durable and
   outside the Expo account.
2. **Enrol in Play App Signing**, so Google holds the app signing key and Expo holds
   only an upload key — an upload key can be reset if lost.

*Confidence: medium-high on the Play App Signing model. Verify against current Play
Console documentation before relying on it — this was not verified against Google's
docs during FE-W1.*

Cheap now, impossible later. Same pattern as the region choice and the D-U-N-S lead
time.

---
## FE-W8 BLOCKING — the Android package ID and the Play Console account

**Two decisions, neither of them the developer''s, both permanent after the first
Play Store upload.** `com.praversetech.elmironmr` is currently in `app.json` as a
**placeholder I chose from the GitHub organisation name.** It has not been approved
by anyone.

### 1. Whose Play Console account ships this?

It decides the package ID, who owns the store listing, who holds the keystore, and
what happens to all three if the client relationship ends. Pairs directly with the
EAS keystore item below — the same question asked from the other side.

- **Praverse ships it:** we control releases and the signing key; the client depends
  on us to publish, and transferring a listing later is a manual Google process.
- **The client ships it:** they own the listing and the identity permanently; we need
  access to build and release, and the package ID should be theirs from the start.

### 2. Should a pharmaceutical brand name be in a permanent public identifier?

If "Elmiron" is the client''s mark rather than ours, `com.praversetech.elmironmr`
bakes their trademark into a string that **can never be changed** — a different
package ID is a different app listing, with no upgrade path for anyone who installed
the first one. Something neutral, `com.praversetech.fieldforce`, costs nothing today
and avoids a conversation that has no good outcome later.

**Owner:** reviewer. **Needed by:** before the first Play upload, FE-W8.
**Until then:** the placeholder stays and is not to be treated as decided.

---

## FE-W1 — accepted deviations

### `apps/field/tsconfig.json` does not extend the repo base

- **Decision:** it extends `expo/tsconfig.base` and repeats every strictness flag
  explicitly, dropping exactly one: `noPropertyAccessFromIndexSignature`.
- **Why:** the repo base sets `module: NodeNext`, which requires `.js` extensions on
  relative imports; Metro does not resolve them. And Expo inlines environment values
  by rewriting `process.env.EXPO_PUBLIC_X` at build time, matching **dot access
  only** — the bracket access that rule demands is not rewritten and yields
  `undefined` in a release bundle while working fine in development.
- **Do not "fix" this back.** Re-adding the flag and switching to bracket access
  breaks env inlining in release builds only, which is the worst place to find it.

### "Declined is not an error" has no control yet — FE-W4

Today `Banner` and `ColorTokens` carry comments saying `critical` is never for a
declined consent. **A comment is not a control.** The consent screen is FE-W4; the
test belongs with it, and it should assert that the `declined` path:

- carries no error styling and no `critical` token,
- has no confirmation or "are you sure?" step,
- has a tap target no smaller than `consented`, and
- sits at equal visual weight — neither outcome is the secondary action.

Recorded now so the control is built with the screen rather than remembered after.

---
## Standing rule while the project is blocked — 14 August 2026

Fourteen items need a human; engineering is otherwise stopped. The rule for what may
still be built:

> **Pure logic with tests can be built ahead. Anything that renders waits for a
> device.**

The FE-W2 reducer qualified because it is the hardest logic in the frontend, fully
decidable from the contract in `packages/core`, and verifiable by its own test suite
today. FE-W3 has no equivalent — doctor search filtering, mileage formatting and
refusal-state selection are a few small pure functions, and everything else in that
sprint renders.

**A screen that cannot be run is the "code nothing has executed" trap**, which this
project has already paid for twice. Manufacturing work to keep the queue from looking
short would be the wrong instinct, and is explicitly not to be done.

---

## FE-W2 open item — what the queue screen shows during a long retry

Raised in review and not yet built, because no queue screen exists.

An item honestly sitting `queued` after fifty failed attempts is **correct** — the
client never dead-letters and the server holds the budget. It is also a trust
problem: indefinite silent retry reads to an MR as "nothing is happening", and
`my_upload_queue()` is described in the plan as their only proof the day's work is
safe.

This is a screen-state decision, not a dead-letter decision, and it belongs in FE-W2
rather than FE-W7 polish. The queue must visibly distinguish **retrying normally**
from **retrying for six hours** — the second is not an error state and must not be
styled as one, but it cannot look identical to the first either.

Build it with the screen. The reducer already carries what it needs
(`attemptCount`, `oldestUnsyncedClientCreatedAt`); nothing in the state machine has
to change.

## What "the blocked period" means, precisely

Named because "blocked" without an object is how a status becomes unfalsifiable.

**Blocked on:** a physical Android device, an Expo account (`eas login`), push
credentials for the repository, an elevated shell for `LongPathsEnabled`, the brand
guideline, and the Play account / package ID decision.

**Not blocked on:** the AI layer. Contract I3 is late and is the highest-consequence
open item, but the sprint order was deliberately arranged so FE-W2 through FE-W5 do
not depend on it. It is not what is stopping work today.

The distinction matters because the first list is procurement and credentials — an
afternoon and a purchase — while the second is a measurement nobody has taken.
---

## Push sequencing while CI has never run — 14 August 2026

Three pushes, each green before the next. Not a preference; a diagnosis rule.

1. **The ten existing commits alone.** First CI run has one candidate cause:
   existing code against existing config.
2. **The render harness alone** — `jest-expo` wired into turbo and CI, plus the
   deliberately-failing test. A red CI here is the runner configuration and nothing
   else.
3. **Everything else** — route tests, the queue screen, the rest of FE-W2b.

Folding 2 into 3 gives a red CI two candidate causes. Folding 2 into 1 gives it
three. The stop condition that kept FE-W2b from starting exists to stop exactly this,
and it has the same failure mode one layer down.

**Not yet reflected in `docs/frontend-prompt-w2b.md`**, deliberately: it only binds at
execution time, and by then there will be CI results to fold into the same amendment.
One amendment beats two.

### Revised 17 August 2026 — four pushes, not three

The O2 rename is a code change touching ~70 files. It slots in **before** the
harness, because a harness written against the old namespace gets rewritten a week
later.

1. **The thirteen existing commits alone** — one candidate cause: existing code
   against existing config.
2. **The O2 rename alone** — `com.praversetech.fieldforce`, the `elmironmr` URL
   scheme, and the `@elmiron/*` workspace scope, in one pass. Approved 17 August;
   **not to be executed until push 1 has had a CI run.**
3. **The render harness alone** — `jest-expo` wired into turbo and CI.
4. **Route tests, queue screen, the rest of FE-W2b.**

No exception was made for the rename despite it being a change the reviewer wanted.
A red CI with two candidate causes costs more than a day of waiting.
### Related, and not self-service

Push currently 403s with `gh` unauthenticated. Checking the PAT scope is a human
action in GitHub's web UI, not something reachable from the repository — and the push
does not have to come from this session at all. The commits exist; any authenticated
client moves them.

If a push still 403s **after** authenticating, that is the org-permission branch on
`Praverse-Tech-Pvt-Ltd` and it needs someone with admin. Worth raising the same day
rather than discovering it on a third attempt.
---

## How dates in the record are read — 17 August 2026

Recorded because two documents disagreed and the wrong one was almost "corrected".

> **A `###` section header carries the date of the work it describes, taken from the
> commit timestamp. It is never edited afterwards. Summary and handoff documents
> carry their own snapshot date. Where the two differ, that is provenance, not
> drift.**

The case that produced it: `PROJECT-OVERVIEW.md` carries FE-W1, FE-W2 and BE-W8 as
14 August 2026, matching the commits that hold them. `handoff.md` and a frontend
status summary say 17 August. The temptation was to edit the FE sections to agree
with the summary — which would have inverted which document is authoritative, and
would have created a fresh inconsistency by leaving BE-W8 at the old date.

The append-only log yields to nothing. The summary is the document that gets updated.

Consequence worth stating: a section header is **not** a reliable "when did this get
written" for anything that spans days, and should not be used to order work across
roles. Use the commit history for that.
---

## O2 — the name in permanent identifiers: EXECUTED, commit `f34ceef` (17 Aug 2026)

**Status: RULED 17 Aug -> EXECUTED 17 Aug.** The ruling below is kept in full; it is
not superseded, it is done. Package id `com.praversetech.fieldforce`, scheme
`praversefieldforce`, scope `@fieldforce/*`, display name moved to configuration.
472 tests unchanged, all three old tokens at zero in code and config. Full write-up:
`PROJECT-OVERVIEW.md` -> FE-R1. **Superseded by FE-R1a:** the scheme is now the reverse-DNS form `com.praversetech.fieldforce`,
verified into the generated `AndroidManifest.xml` by `expo prebuild`. **Outstanding from it: Backend must add**
`praversefieldforce://auth-callback` **to `additional_redirect_urls` — no deep-link
scheme was ever in that allow-list, so this is a pre-existing gap the rename
surfaced.**

### The original ruling

`docs/brand-identifier-decision.md`, 17 August 2026.

Escalated from a naming question to a legal one on one finding: **ELMIRON® is a
registered trademark of a third party** (IVAX Research, LLC, per the FDA prescribing
information), so `com.praversetech.elmironmr` would put another company''s
pharmaceutical mark into a permanent public Play Store identifier published under
Praverse''s account. Whether that is a problem needs counsel, not engineering.

The brief''s substance, so it is not lost if the file moves:

- Only **two** identifiers actually matter — the Android package ID and the URL
  scheme. The other 187 occurrences are free to change.
- The cost curve has a specific cliff: after a pilot with 100 MRs, renaming the
  package forces an uninstall, **and queued offline work does not survive an
  uninstall unless it has already synced.** That turns a branding decision into a
  data-loss one.
- Recommended option: neutral identifier (`com.praversetech.fieldforce`), keeping the
  **display name** as a separate freely-changeable string. That decouples branding
  from the irreversible choice and unblocks FE-W8 without waiting for the trademark
  answer.

Needs: a trademark position for software in India (counsel), the Play Console account
owner (client), and sign-off to rename if option B. Pairs with the existing
FE-W8-blocking entries — the package ID and the account owner are one conversation.
---

## Where the earlier ones live

| Decision | Where |
| --- | --- |
| `admin` has full visibility, never authorship | `PROJECT-OVERVIEW.md` → "Settled by the reviewer, 11 Aug" |
| Audit row stays in the caller's transaction; no `dblink` | same |
| Immutability is a trigger, not a policy | → "Added in BE-W2" |
| RLS decides which rows, never what values | → "Standing principle" |
| Three requirements dropped (roles, versioning, source search) | → "Closed by the reviewer, 12 Aug" |
| `app_thresholds` is append-only, not updatable | → BE-W6 |
| Withdrawal cascade order, and why the object is not deleted inline | → BE-W6 |

---

## 27 August 2026 · Model: Gemini 3.1 Pro

### Section freezing rule

- **Decision:** A `###` section in `PROJECT-OVERVIEW.md` is editable while its sprint is open. **Once the sprint closes, the section freezes.** Any later correction goes in the current section, dated, saying what it replaced and where.
- **Why:** To prevent erasing the discovery of errors and maintain a durable, auditable record of the project's actual history.


---

## 7 September 2026 — FIX-01 corrections

Recorded under the section-freezing rule above: the earlier statements stay, and the
correction is made here, dated, saying what it replaced and where.

### "40 public tables" is 34 tables and 6 views

- **Replaces:** "40 public tables" in the 7 September production-resume entry of this file,
  and the same figure in `handoff.md` line 66.
- **Correct figures**, measured against the applied 19-migration schema: **34 tables**, RLS
  enabled **and forced** on all 34, **41 policies**, **6 views**. `34 + 6 = 40`.
- **Why the wrong number is plausible:** `information_schema.tables` counts views unless
  filtered to `table_type = 'BASE TABLE'`. A count taken that way returns exactly 40.
- **`PROJECT-OVERVIEW.md` was already right** and has been since BE-W2. The append-only
  record outranked the handoff, exactly as the precedence rule intends.
- **UNVERIFIED, and it matters:** the measurement was taken on a **local** stack running the
  same 19 migrations. The machine that found this has no production credentials and the
  project is absent from its connected Supabase account, so *production* was not re-counted.
  The arithmetic is certain; that production carries the identical schema is inferred.
- **Nothing else in the resume entry changes.** The pause happened, the resume worked, and
  nothing was lost. Only the noun was wrong.

### There is no root `app.json`

- **Replaces:** the claim in `docs/frontend-handoff-2026-09-07.md:94,186`,
  `docs/frontend-status.md:276` and `PROJECT-OVERVIEW.md:3820` that a **root** `app.json`
  still carries `com.anonymous.elmironapp`.
- **Fact:** `find . -maxdepth 2 -name app.json` returns only `./apps/field/app.json`, which
  declares `com.praversetech.fieldforce`. The stale identifier survives **only in prose**.
- **Consequence:** the recurring task "fix the stale package id in the root app.json" is a
  no-op. It has been carried forward through at least three documents as though it were
  outstanding engineering work.

## `visits.status` gains `not_met` with a required reason — a REVIEWER decision, 8 September 2026

**Taken on the operator's behalf, after five sessions unanswered, and REVERSIBLE until real
data exists.**

### What was decided

`visit_status` gains a fourth member, `not_met`, carrying a **required reason**, mirroring
`consent_outcome.not_asked` — which is the same shape the product already models and
already enforces with a check constraint (`consent_records_not_asked_has_reason`).

### Why it was taken rather than waited for

The question — *does "2 of 3 visits done" count a visit where the MR arrived and the doctor
was unavailable?* — was first raised in MR-04 §B3 and asked in every session since. It has
blocked the read conversion twice.

**Waiting is now costlier than being wrong, and being wrong is still cheap.** Nothing but
synthetic seed rows carry a `visits.status` today, and those are disposable. Once a pilot
has written real ones, changing the meaning of `completed` means rewriting history, because
every row already stored as `completed` becomes permanently ambiguous between *met* and
*attended*. The window in which this is reversible is closing, and it closes on the day the
first real visit is recorded.

### The reasoning

- **Two facts are conflated today: attendance and outcome.** The missed-visit nudge and
  coverage-versus-beat-plan need the first. Consent rate and call reporting need the second.
  A single `completed` cannot carry both.
- **`check_outs` records position and time and nothing about whether the call happened** —
  every column is `latitude`, `longitude`, `accuracy_metres`, `geofence_status`,
  `distance_from_clinic_metres`, `source`, `occurred_at`. A check-out is a departure.
- **So `check_out -> completed` makes the app tell an MR their day went to plan when a
  doctor was unavailable**, and tells coverage-versus-beat-plan and §5's Tier 1 nudge that a
  call took place that did not.
- **The product already models this.** `consent_outcome.not_asked` carries a required
  reason. "Attended, nothing happened" is a state this schema knows how to express; it is
  simply not expressed on `visits`.

### The terms it was taken on

1. **The copy changes with it.** *"2 of 3 visits done"* and *"That's the day done"* claim
   success. They must claim **attendance**. An MR who found three doctors unavailable must
   not read a congratulation.
2. **`not_met` is attributed to the territory or the doctor and NEVER scored against the
   MR** — MR scope §3. A metric that punishes an honest outcome manufactures dishonest
   ones, which is the same reason a declined consent is never a negative signal.
3. **The operator may overturn this until real data exists.** If they disagree, the change
   to make is a migration reversing the enum member and the copy, and it costs nothing while
   only seed rows carry a status.

### Status

**Decided, NOT YET IMPLEMENTED.** MR-11 recorded the decision and stopped before building
it; the implementation is MR-12 Part C. Recording it separately from building it is
deliberate: a decision taken in the operator's absence should be visible as a decision
rather than absorbed into a diff.

> **Superseded 9 September 2026 — IMPLEMENTED in MR-12 Part D**, commit `ff76f13`. The
> paragraph above is left as written, per the append-only rule; it named the part wrongly
> (D, not C) and its status is no longer current.
>
> All three terms were met in one commit: `not_met` with a REQUIRED reason enforced by the
> same constraint PAIR `consent_records` uses for `not_asked`; the copy changed from
> *"visits done"* to *"visits attended"* and from *"That's the day done"* to *"That's
> everyone on the plan"*; and no column anywhere attributes the outcome to a person, which
> is asserted by a test rather than promised in prose.
>
> **Still reversible.** Only seed rows carry the status. The reversal is
> `services/api/rollbacks/20260909000300_visits_not_met_reason.down.sql`, which rewrites
> any `not_met` visit to `cancelled` and says how many — the less flattering of the two
> available lies, chosen deliberately.

---

## Reviewer decisions transcribed from the review conversation — 9 September 2026

**These existed only in the review conversation.** MR-13 §2 required them written into the
repository before that conversation ended, because nothing else records them and Claude
Code cannot derive them from the code. Each is a **REVIEWER** decision, taken on the
operator's behalf, and each is reversible by the operator.

### C1 — `admin` is a TENANT administrator, not a platform operator

**Decided.** The `admin` role administers **one organisation**. It is not a platform
operator and must never be treated as one.

Platform access — the ability to act across tenants — is a **separate, audited break-glass
path** and is **out of MR v1 scope**. It is not a bigger `admin`; it is a different thing
with its own audit trail.

**Why it matters now:** the tenant boundary is `RESTRICTIVE` as of MR-06, so it cannot be
widened by adding a permissive policy. Anyone who later needs cross-tenant access will be
tempted to relax that boundary for `admin`. That is the wrong change, and this entry exists
so the next person finds the decision before they make it.

### C2 — `not_met` on `visit_status`

Recorded in full above (*"`visits.status` gains `not_met` with a required reason"*,
8 September 2026). **Confirmed present and complete**, and its Status section is corrected
below: it is now IMPLEMENTED, in MR-12 Part D, with its copy change in the same commit.

### C3 — Audio is OUT of MR v1, and NOT for engineering reasons

**Decided.** The recording feature does not ship in MR v1.

This is a **legal and compliance** decision, not a capability one. The mechanism is built.
Two things block it:

- **MR scope §2.4** creates a **legal adverse-event screening duty** over recorded content.
- **MR scope §8.6** requires a **named PV/DPDP signatory before the recording feature
  ships.** There is no such person named.

**The consequence, stated so nobody rediscovers it:** Tier 1 automations **1, 4, 5 and 6**
all sit downstream of the transcript. They go with it. Anyone planning those should treat
them as blocked on a signature, not on a sprint.

### C4 — Coaching is OUT of MR v1

**Decided.** Two independent reasons, either sufficient:

- **§3.6 is unrecorded** — the decision it depends on has never been written down with a
  named human.
- **There are no analyses to display**, because there is no AI layer, because there is no
  transcript, because of C3.

### C5 — `BE-W69` / `pg_cron` DECLINED

**Declined.** The keep-warm idea is a workaround for the Supabase **free tier** pausing the
project. Scheduling a job to poke the database so it does not sleep treats a billing
decision as an engineering problem, and leaves a cron job in the schema whose real purpose
is invisible to whoever finds it next.

**The honest fix is paying for the plan** — see `docs/blocked-on-you.md`, ~$25/month, open.

### C6 — the open human items

Transcribed into `docs/blocked-on-you.md` under *"Transcribed from the review conversation"*
with owners. They are **not engineering items** and none of them is blocked on this
codebase.

---

## MR-14 → MR-28 — the decisions, 9–11 September 2026

Recorded here because `PROJECT-OVERVIEW.md` records what was DONE and this file records
what was CHOSEN, including the options that were rejected. Where the two disagree, the
overview is right.

### D-28.1 — the client applies the effective window; the server transmits the ORDER

**Decided MR-27 B1, corrected the reviewer's own proposal.**

The obvious move was to transmit *which consent notice is active*. That is wrong, and the
reason generalises: **activeness is time-dependent and a pull is a snapshot.** A notice that
becomes active tomorrow because the clock passed `effective_from` does not CHANGE, so its
`updated_at` does not move, so `sync_pull` — a cursor over `updated_at` — never re-emits it.
A client holding a transmitted `is_active` flag would offer yesterday's notice forever with
nothing to correct it.

**So the split follows what each side can know.** The server transmits `precedence`, a rank,
which carries no clock and is the half the client got wrong on its own. The client applies
the window, because it has a clock and the pull does not.

`public.consent_text_version_precedence` holds the `order by` **once**;
`active_consent_text_at` reads it and `sync_pull` joins it. `security_invoker = true` is not
optional — without it the view runs as its owner and BE-W79's RESTRICTIVE tenant boundary
would not apply to the join.

**Rejected:** mirroring the ordering in the client (MR-26 B1's shipped version). It worked
and it created two copies of one rule, and a disagreement between them does not fail in a
test — it fails as a `45001` refusal, at capture, with a doctor waiting.

### D-28.2 — the activation window uses `serverTime`, and a stale one is not cleared

**Decided MR-28 A2.**

The window was applied against `new Date()`. Now it is `serverTime` from the last pull, the
same value that already produces `today`, so the day boundary and the consent window read
one clock.

**A failed pull does NOT clear it**, and the two directions are deliberately asymmetric:

| | behaviour | why acceptable |
| --- | --- | --- |
| notice becomes active after the last pull | withheld until a pull succeeds | nothing false is shown |
| notice retired after the last pull | still offered | `capture_consent` re-resolves and refuses `45001` with its own remedy |

Clearing on failure would blank the consent screen on every transient error — the defect
MR-26 B3 removed from three screens. **With no server clock at all, the screen declines to
decide rather than guessing.** Falling back to the handset is `FE-W40` option B and is
refused.

### D-28.3 — `BE-W97`: refusal DETAIL is transmitted verbatim and never parsed

**Decided MR-28 B.**

`sync_push` read `MESSAGE_TEXT` out of `get stacked diagnostics` and nothing else, so
**fifteen** `raise ... using detail = format(...)` sites died inside one exception handler.
`sqlDetail` and `sqlHint` now travel beside `sqlState`.

**Rejected: emitting the figures as JSON so the client composes its own sentence.** All
fifteen sites use prose `format()`, so JSON would be a convention of one — and a client that
parses server prose is precisely the defect FIX-06 minted `45002`/`45003` to remove, where
`when v_message ilike '%shift window%'` stood in for a real code and outlived it by three
sessions.

**Rejected: special-casing 45004 in the transport.** It would have left fourteen sites where
they were and put a second copy of the cap rule in `sync_push`.

**Accepted cost:** some DETAILs carry UUIDs and read like support notes. That is a wording
problem at each raise site, fixable where the raise lives — and the worst offender, the
45004 message's raw `doctor_id`, was fixed in its own migration so the two changes can be
told apart.

### D-28.4 — a test-only threshold IS admissible, with conditions

**Decided MR-27 C1/C2, applied again in MR-28 B4.** MR-26 E left this unsettled.

A refusal that cannot be driven cannot be proved to reach the MR. So a threshold may be set
purely to make a refusal reachable, provided: it is **reverted in the same session**, the
revert is **verified by reading the value back**, `app_thresholds` being append-only means
both the set and the revert are **rows carrying their own notes**, and the note says plainly
that it is **not a product decision**.

This does **not** touch `blocked-on-you` **5.9**. A cap set to prove a refusal is not an
answer to what the ceiling should be, and the note on every such row says so.

### D-28.5 — `BE-W92` is instrumented, not reproduced, and not theorised about

**Decided MR-28 D, following MR-27 D1's measurement.**

One deadlock, seen once, MR-26. MR-27 D1 ran the suite three times concurrently and five
times sequentially: **0 in 9**, and the concurrent runs failed on cross-run interference
they manufactured themselves. **Concurrency against one database is the wrong instrument.**

`log_lock_waits` is now on, which names the relation — the first thing that item's
verification order asks for. It also catches waits that RESOLVE, which is the point: a
deadlock seen once is a race lost once, and the same contention is being won silently the
rest of the time.

**`deadlock_timeout` is deliberately left at its default**, and a test asserts it still is.
Lowering it would fire sooner and read as progress while changing the thing being measured.
**No mechanism is proposed and none should be read into this file.**

**Implementation note that cost time:** it was written as a migration and the migration
failed — `permission denied to set parameter "log_lock_waits"`. It is a `SUSET` parameter
and Supabase's `postgres` role, which every migration runs as, is not a superuser. It is now
`services/api/scripts/enable-lock-logging.mjs`, connecting as `supabase_admin`, which
nothing else in this repository does and nothing else should.

### D-28.6 — `FE-W40`: engineering recommends option D, and it is not implemented

**Written MR-27 E1 as a decision for the product owner.** Full text in
`docs/decisions/FE-W40-cold-start-staleness.md`.

An MR who cold-starts with no signal sees no day, because `today` comes from the pull's
`serverTime` and is not persisted. Four options. **B (fall back to the device clock) is
named and refused** so it is not proposed again as an obvious shortcut — it is MR-15 A2's
defect behind a condition. **C (persist and label the age) is the reviewer's lean and its
cost is stated with it**: crossing midnight is the common case, and "yesterday's visits,
labelled yesterday" is a subtler wrong than an error message.

**D — persist, bounded at the territory day boundary — is engineering's recommendation.** It
needs no new number: `dayIn(anchor, zone)` versus `dayIn(anchor + elapsed, zone)`, which
`territory-day.ts` already computes.

And the thing to write down rather than rediscover: **with no server clock, some
device-clock dependence is the price of rendering anything at all.** D buys the least.

### D-28.7 — a refusal is never queued, and that removed where refusals were EXPLAINED

**MR-24 decided the first half; MR-27 C1 paid for the second.**

A refusal is a verdict, so queueing it would push the same refused item forever. Correct —
and the queue screen was *the only place a refusal was explained*. After that change a
consent refused at `45001` reached nobody. `sendOrQueue`'s refused outcome now carries
`sqlState`, `explanation.ts` gained `remedyForSqlState`, and MR-28 added `refusalTextFor`
so a screen refused in the moment gets the remedy **and** the server's figures.

The general rule is now in `docs/gotchas.md`: **when a fix removes where something was
shown, check where it is shown now.**


---

## 14 September 2026 — MR-32

### The restore runbook's commands are corrected IN PLACE, not appended to

- **Decision:** `docs/restore-runbook.md`'s broken commands were rewritten where they stood,
  with a dated divergence log appended beneath recording what was wrong.
- **Why:** A runbook is a **procedure**, not a record. An operator under pressure runs the
  first command they see, and three of these exited 0 while doing nothing. MR-30's own rule is
  that a correction which leaves the original standing with equal authority has not corrected
  anything. The section-freezing rule protects `PROJECT-OVERVIEW.md`; it does not require a
  procedure to keep a command that silently fails.

### `BE-W40` is a DETECTOR, and is labelled as one

- **Decision:** `check:migration-drift` plus a daily workflow, paired with a runbook step that
  asks a human to write down the SHA, the versions, the date and who ran it.
- **Why:** `supabase_migrations.schema_migrations` has no timestamp and no actor, so **no
  check written against it can produce an audit trail**. Claiming otherwise would have been
  the defect this project keeps finding — a control that looks solved. The check makes a
  hand-run push impossible to hide for longer than a day; it cannot prevent one, because
  preventing one means taking production credentials away from people, which is an access
  decision rather than an engineering one.
- **Unverified:** its production leg. Credentials are not on this machine.

### `handoff.md` and `.ai-collab/handover.md` are working notes and may be restructured

- **Decision:** Both were restructured rather than appended to — 627 → 151 and 441 → 100
  lines — with every per-session narrative replaced by an index into `PROJECT-OVERVIEW.md`.
- **Why, and this settles a direct contradiction in the instruction rather than a preference:**
  `.gitignore:22-26` records the BE-W8 decision that these files are *"expected to be updated
  regularly, not treated as a point-in-time snapshot"*, and the **section-freezing rule above
  is scoped, in its own words, to "a `###` section in `PROJECT-OVERVIEW.md`"** — it does not
  govern these two. `handoff.md` had invoked it by analogy, which is how the rule appeared to
  cover more than it says.
- **Evidence it was needed:** `handoff.md` carried *"read this first"* at line 353 of 627 with
  three later sessions beneath it contradicting it.

### `BE-W92`: no mechanism, and the previous comparisons are withdrawn

- **Decision:** No mechanism proposed; `deadlock_timeout` untouched. The recorded rate
  comparison is withdrawn rather than refined.
- **Why:** Eight idle runs gave 3 deadlocks and eight loaded runs gave 1 — load made it
  **less** frequent, and 37.5% idle is six times the 1-in-16 the entry carried. The
  "1-in-16 versus 2-in-2" asymmetry three sessions reasoned from rests on a two-sample
  denominator. The correction is to the method.

## 15 September 2026 — MR-33

### `BE-W11` uses raw `pg_dump`, not `supabase db dump`, and the reason is measured

The obvious choice was the project's own CLI: already a dependency, no new tooling, no
question to ask. Measured against the local stack it produces a **340 KB schema dump with zero
`auth.` and zero `storage.` tables** and a **16 MB data dump with zero rows of `auth.users`**.
It is scoped to `public`.

A database restored from that holds the full consent ledger and has **nobody who can sign in**,
with `storage.objects` empty — the exact metadata the runbook's step-3 reconciliation walks.

**Decision: raw `pg_dump` of the whole database, plain SQL, not `--format=custom`.** Plain SQL
is restorable by `psql`, readable by anything, and checkable with `sha256sum`. A backup whose
only reader is the tool that wrote it is a backup you find out about on the day you need it.

**This was not decided by reading the docs. It was decided by producing both and counting rows
in each** — which is also why `backup:verify` proves an artefact by restoring it rather than by
producing it.

### The backup workflow fails daily, on purpose, and produces nothing while it does

A dump of this database is a package of personal data: `doctors.full_name`, `user_profiles`,
`transcripts_redacted`, 5,447 `auth.users`, and `adverse_event_reports.reported_text`, whose
lawful contents are still **open question 4.1**. Where that file may land has a DPA dimension.

`.github/workflows/backup.yml` therefore checks for `BACKUP_DESTINATION` **before producing
anything** — a run with no destination leaves no artefact anywhere, including in the runner's
own storage — and is scheduled daily and red until one exists. Precedent: `retention.yml`.

**The alternative was worse:** a green workflow that writes to the runner and lets the artefact
expire is the failure mode `BE-W11` was registered to prevent, wearing a passing badge.

### `FE-W47` is closed as "correct as written", not deferred

`destinationsFor(role ?? 'mr')` in `home.tsx` renders no false claim — the screen already says
*"Signed in as unknown role"* — and the server decides what a role may do. Changing the
fallback would mean **the client** deciding what an unknown role may see, which the standing
rules forbid. Recorded so the verdict is on the record rather than inferred from silence.

### `CLAUDE.md` holds only claims that hold for all time, or that print their own check

`CLAUDE.md` is loaded before any code is read, so a stale claim there is a stale prior in every
future session, arriving with more authority than anything read afterwards. It carried
*"1,221 nodes"*, *"159 named communities"*, and *"all 34 migrations"* — **when there are 56**.

The snapshots moved to `docs/graphify-notes.md`; the migration sentence now prints
`ls services/api/supabase/migrations/*.sql | wc -l` instead of a number.

## 15 September 2026 — MR-34

### The backup workflow's daily red is REVERSED, and this overrides MR-33

**MR-33 recorded:** *"Keep this schedule live and red. The daily failure is the reminder that
the recovery posture does not exist yet, and silencing it removes the only thing saying so."*

**That is withdrawn.** The argument is sound in isolation and this repository has already run
the experiment and got the other answer.

**The evidence, from this repository:** the retention workflows went red, were disabled on
**23 August** (`b5d03a5`, *"Record: retention workflows disabled again, 23 August"*), and
`docs/COMPLETION-PLAN.md:602` **still asks why — the reason was never recorded.** In the silence
that followed, production auto-paused from **23 August to 7 September** and was discovered by a
failed connection rather than by an alert (`COMPLETION-PLAN.md:561`).

**A red that is correct every day is indistinguishable from a red that is broken.** It stops
being an alarm, becomes noise, gets disabled, and the disabling is itself silent — which is
worse than the original gap, because absence of runs looks like health.

**Decision: three states, not two, on the shape `check:decision-debt` uses for the UCPMP cap.**

| State | Outcome |
| --- | --- |
| destination configured | runs, produces, proves by restoring |
| no destination, deferral live | **green, `::notice`**, naming the decision, the trigger and the expiry |
| no destination, deferral expired | **red, `::error`** — the deferral lapsed, not the backup broke |

Weekly rather than daily. The deferral (`DEFERRAL_EXPIRES`, **2026-10-15**) is a dated record in
the file, changeable only in a commit that says why — the same escape hatch as the UCPMP
deadline: possible, and impossible to do silently. **The re-enable trigger is named and needs no
code change: set the `BACKUP_DESTINATION` secret.**

**What did not change, and was never in question:** the destination check still runs **first**,
so a run with nowhere lawful to put the data still produces nothing, not even on the runner.

**The generalisable half:** *the disabled state must be a RUN, not an absence.* A workflow
switched off in the GitHub UI produces no runs, and no runs is exactly what 23 August looked
like from the outside.

### `min(uuid)` in a pending migration is an ASK, not a fix, and a new migration cannot help

`20260908000800_user_profiles_organisation.sql` calls `min(id)` on a `uuid` column. PostgreSQL
has no such aggregate — verified on `server_version` 17.6, zero matching entries in `pg_proc`.
Both non-empty branches of that backfill were executed against seeded databases in MR-34 B5.

**`.ai-collab/constraints.md:78` makes editing an applied migration an "ask before doing", and
the usual remedy does not apply.** "Write a new migration instead" works when the defective
migration completes. This one **aborts the deploy**, so no successor ever runs. The fix must go
in that file or nowhere.

**Decision: do not edit it in this session. Register it and ask.** `docs/blocked-on-you.md` 7.1
names the one-expression change and the cheaper alternative — run the Phase 0 pre-flight query
and find out whether the branch can fire at all.

**Recorded because the reasoning is the point:** a constraint whose stated remedy does not work
for a particular case is a constraint that needs a human, not a constraint to be routed around
quietly.

### The checked-in graph is to be rebuilt, not caveated

Measured in MR-34 A3: built 11 August, **80% of tracked code files absent**, 39 of 56 migrations
absent, and `apps/field` **131 of 131** absent — its whole representation is two config files
and a `placeholder.ts` that no longer exists.

**Decision: treat a graph whose build date lags the code by weeks as unusable, not as degraded.**
It is *dangerous* rather than merely useless: every node carries a `source_file` and a line
number, so a stale answer arrives with the strongest available signal of being checkable.

**Not rebuilt in this session** — regenerating needs `pip install "graphifyy[sql]"`, and adding
a dependency is itself an ask. The verdict and the measurements are in `docs/graphify-notes.md`;
`CLAUDE.md` gained one time-invariant line that prints its own freshness check.

**Note for whoever rebuilds it:** the `[sql]` extra was **not** the problem here. The graph has
226 `.sql` nodes, so SQL parsed fine. It is stale, not mis-built, and those have different
fixes.

## 15 September 2026 — MR-35

### A migration may be edited in place ONLY under the four conditions now named in constraints.md

The deciding question was mechanical and was established from the tooling rather than from
memory: **does the migration ledger verify a hash of each file, or only a name?** Only a name.
`schema_migrations` holds `version`, `name` and `statements` and **no checksum column**;
`check-migration-drift.mjs` reads `version` only; `supabase migration list` pairs local and
remote by version; and editing an applied migration's body then running `db push --dry-run`
reports `"upToDate":true` — with a positive control, because "nothing pending" is also what a
dead command prints: adding a new file to the same directory **was** reported as pending.

**So no database anywhere can observe the edit, and constraint 78's purpose is untouched.**

The full exception, with all four conditions and the one that makes this case different — a
migration that ABORTS the deploy cannot be fixed by a successor, because nothing ordered after
it runs — is in `.ai-collab/constraints.md` under *"The one time a migration was edited in
place"*, with a pointer at the constraint itself so nobody finds the rule without the exception.

**Condition 3 is deliberately fragile.** The `statements` column already holds the SQL. A future
CLI that compares it kills this exception, and the answer becomes a Phase 0 pre-flight fix with
the file left alone.

### The stale graph is DELETED rather than kept with a warning

MR-34 measured `graphify-out/` at 80% of tracked code absent and called it a museum, then left
it in place with a caveat. **Three weeks of sessions would have read `CLAUDE.md`'s "read this
first" before reaching the caveat.** Writing the warning was not the same as acting on it.

Deleted rather than rebuilt because rebuilding needs `pip install "graphifyy[sql]"` and adding
any dependency is an ask. Gitignored, zero tracked files, so no clone is affected.

**The generalisable half:** a derived artefact that carries `source_file` and line numbers is
*dangerous* when stale, not merely useless — a wrong answer arrives with the strongest available
signal of being checkable. For those, delete beats caveat.

### A guard may not report healthy from a claim

`check:migration-drift` compared the ledger against the files and never looked at the database.
After a full `verify:rollbacks` it reported **no drift** against a schema with zero tables,
because the ledger and the files agreed perfectly — about a database that no longer existed.

**Decision: every guard reads the thing, not the record of the thing.** The check now refuses to
give a verdict in either direction when the ledger and the schema contradict each other, when a
schema exists with no ledger, or when it read zero migration files — that last one being this
script in the wrong directory, which would otherwise be reported as a confident finding about
the wrong system.

It also classifies **how** an applied set falls short rather than how far, because a deploy that
stopped and a set of cherry-picked versions need different responses and no count distinguishes
them.

### Establish the rate before claiming a cause

A deadlock in `tenant-boundary-restrictive.spec.ts` was attributed to a suite added the same
session, on three clean runs without it against two failures in four with it. **Widening the
baseline to seven runs without it produced the deadlock twice.** Pre-existing, ~2 in 7,
unrelated.

**The rule, recorded because it nearly shipped as a diagnosis:** *"the fix worked" is not
evidence the diagnosis was right* has a twin — **"it stopped happening" is not evidence either,
when the rate it was happening at was never established.** Three runs is not a baseline; it is a
coincidence with a plausible story attached.

The rate is now in `docs/gotchas.md`, which is the part nobody had: the deadlock was known to
occur, and how often was never written down — which is exactly what makes a spurious red
indistinguishable from a real one.

## 15 September 2026 — MR-36

### The signal comes before the diagnosis, and the diagnosis turned out to be free

**Decision: mitigate `BE-W92` now rather than hold out for the mechanism.** A one-in-four
spurious red is not a weak signal, it is an absent one — and this repository has already run
that experiment to its end: red became routine on 22 August, the workflows were disabled on
23 August **with no reason recorded**, and production auto-paused unnoticed for two weeks.

**The part worth carrying forward is that the two were not actually in tension.** Six fully
detailed deadlock reports — both statements, both relations — were already in the container log
from this session's own earlier runs. `BE-W92` had been registered as *waiting for a
measurement* while the measurement accumulated on disk for months.

**Rule: before designing a way to observe something, check whether it is already being logged.**

### DDL in tests takes the identity advisory lock — reuse, not a new mechanism

Three mechanisms have been proposed for this defect and refuted, one of them reasoned from the
schema and naming a relation that appears in none of the samples. So the change is deliberately
**not** a new theory: `createAuthUser` has serialised GoTrue mints behind
`pg_advisory_lock(0x5eed1de7)` since MR-12, and DDL tests now take the same lock. Both sides of
the measured cycle are named, and they are simply prevented from being in flight together.

**On its own connection, not the transaction's** — a session holding an advisory lock while
waiting on a heavyweight lock can itself close a cycle, and advisory locks are visible to the
deadlock detector.

**Judged by a rate, not a story:** ~29% → ~5%, denominators 7 and 21, p≈0.008. **Recorded as a
mitigation, not a cure**, because one deadlock survived with every DDL site wrapped and the
residual path is unknown. Calling it fixed would give the next session a false baseline, which
is the same error one layer down.

### A discriminant that nobody reads is not a fix

`TerritoryZone.source` has existed since the type was written. `FE-W45` was registered against
it, and MR-33 fixed the render ORDERING. **Eleven screens still rendered a date computed in that
zone and not one of them asked which case it was in.**

**Decision: the test for a sentinel is the number of READERS of its discriminant, not whether
the type can express the absence.** A labelled union with zero readers is the same defect as a
bare sentinel value, with better documentation.

Fixed with one banner at the root rather than eleven edits, for the reason `FE-W44` taught: MR-31
recorded two consumers of `loadQueueState` and there were five. **N separate warnings are N
places to forget the N+1th screen.** The decision returns the sentence or `null` — a string, not
a boolean — so no caller can render a warning without its reason.

### An estimate wearing the shape of a measurement is worse than an obviously false value

`FE-W46`'s `sizeBytes: 1` is visibly wrong, which is why every reader has re-checked it. The
available substitute — `bitrateKbps × durationSeconds / 8` — would be plausible, and the next
reader would stop checking.

**Decision: leave the obviously false value and register the consequence instead.** And the
consequence is bigger than "a wrong number": it is persisted and summed by
`audio_storage_bytes()`, so the per-MR storage ceiling **cannot fire**. A control that exists,
runs, and measures nothing is the `BE-W6` shape again.

## 16 September 2026 — MR-37

### Ask whether the SERVER already knows, before asking for a dependency

`FE-W46` was registered as blocked on `BE-W7` across three sessions, on the reasoning that a real
byte count needed `expo-file-system` and that adding it is an ask. **The server had the number the
whole time.** The bytes reach Storage before finalisation — `apply_sync_item` says so in its own
comment — and Storage records what arrived in `storage.objects.metadata ->> 'size'`. Measured:
118 of 118 objects carry it.

**Decision: `complete_upload` reads the observed size and ignores `p_size_bytes`.** The signature
is unchanged, so no client has to ship for it to take effect.

**The generalisable half, now a standing rule:** a client-asserted fact that the server can
observe is not merely redundant, it is **forgeable** — and here the number fed a ceiling that
limits that same client. This is the third time the same correction has been made
(`capture_consent`, `record_check_in`, now `complete_upload`). If the server knows, the server
decides.

### "Cannot fire" and "has an inert term" are different claims

MR-36 recorded that the storage ceiling *"cannot fire"*. Reading the formula term by term shows
that is too strong: `begin_upload` refuses when `liveBytes + reservedBytes + requested > ceiling`,
and the last two terms were always real — there has been a test for an oversized request since
BE-W8. **What was inert is `liveBytes`.** The ceiling worked as a per-session limit and failed as
the per-MR storage limit it is written to be.

**Decision: corrected in place in the migration's own header and in `PROJECT-OVERVIEW.md`, rather
than left as the stronger and more quotable claim.** Overstating a defect sets the next session up
to measure against a false baseline — the same error MR-35 made by calling a mitigation a cure.

### A rule is not applied until it is swept

Four rules were each swept across the whole repository rather than at the site that produced them,
and **the counts are recorded even where they are zero**, so nobody re-runs them.

**Decision: an empty sweep is a result and gets a denominator.** Two of the four found nothing
real. Without the count, the next session cannot tell "swept and clean" from "never swept".

**And one sweep is recorded as a method that does not work.** Matching refusal messages against
the suite claimed 233 of 302 controls untested; three of four spot-checks were false positives,
because 210 SQLSTATE assertions are invisible to a text match. **A method that produces a
confident wrong number is worse than no method, and deleting it quietly would let somebody
rebuild it.**

### Reachability decides whether a fallback is a defect

`${parts['hour'] ?? '00'}` renders a plausible wall-clock time for an unreadable clock, which is
the sentinel shape exactly. **It was left alone**, because `partsIn` requests `hour` and `minute`
and both failure modes throw rather than returning partial parts: no conforming runtime reaches
it.

**Decision: establish reachability before adding a branch.** `territory-day.ts` already had its
`24:00` normalisation removed for precisely this reason, and its comment names the defect — *"a
guard no runtime reaches, carrying a comment that says it is needed"*. Adding one back would have
been that defect, introduced by the rule meant to prevent it.

## 16 September 2026 — MR-38

### A check that can pass for an unrelated reason is not a check

**MR-37 D1 declared three console items newly unblocked, having run each dependency's own
recorded verification command. Two of the three were wrong.** `BE-W14`'s check is
`grep -c "auditLog" packages/core/src/field/endpoints.ts → ≥1`, and it returns 2 — **a prose
comment and the `auditLogId` field on the analysis overrides response.** Neither has anything to
do with an audit-log read path, which does not exist: the only `public` functions matching
`%audit%` or `%retention%` are `write_audit_row` and `stamp_audio_retention`, both writers.

**Decision: a verification command that a file can satisfy by merely containing the words is not
a verification.** The second clause of that same row — *"an RLS test proves a non-admin gets
`permission denied`, not an empty list"* — is the real check, and running the cheap half and
stopping is what produced the wrong answer.

This belongs with `pnpm --filter @elmiron/api` exiting 0 while matching no projects, and with
MR-37's refusal-message sweep that reported 233 untested controls of which three in four
spot-checks were false. **It was trusted by the session that wrote the rule about not trusting
it**, which is the part worth remembering.

### A negative sweep result is a result, and gets its denominator

`capture_consent`, `record_check_in` and `complete_upload` were three instances of one shape — a
client asserting a fact the server had observed — so the whole surface was swept for the fourth.
**There is no fourth.** 47 RPCs, 121 client-supplied parameters, 70 numbers or identifiers, 24
pure numbers, and every one is excluded for a stated reason.

**Decision: record the denominator and the classification, not just "nothing found".** Otherwise
the next session cannot tell "swept and clean" from "never swept", and the prior was strong
enough that somebody would look again.

**And the exclusion that mattered was measured, not reasoned.** `p_duration_seconds` looks
exactly like the class. `storage.objects.metadata` carries `size`, `contentLength`, `mimetype`,
`eTag`, `cacheControl`, `lastModified` and `httpStatusCode` — **and no duration.** The server
cannot know it without decoding the audio, so it is not in the class however much it looks like
it.

### Reuse a mechanism by shape when you cannot reuse it by import

The `CONTRACT_I3` deadline needed `5.9`'s three-state warning. The obvious move — extend
`check:decision-debt` — is forbidden: `FIX-08 B2`'s `scripts-convention.spec.ts` fails the build
if anything in `services/api/scripts/` imports `packages/core`, because no workflow builds
workspace dependencies before running those scripts directly.

**Decision: reuse the shape at the site that already holds the fact.** Same 21 days, same
non-failing warning, same `::warning::` annotation — implemented in the test that can check the
*runtime* export rather than in a script that could only grep source for a symbol. **Reuse means
the mechanism, not necessarily the module.**

### Stopping is the result when the recorded check cannot be met

`FE-W12` needs a `packages/core` client method that does not exist, and its recorded check asks
for a console test asserting a **render** in a workspace with no renderer. The substitute — test
the shaping in node, assert the page source mentions the call — would have reported it done.

**Decision: report it blocked and stop.** The estimate was 2 half-days on the assumption the GET
was consumable; it is not, and the honest column is *1 half-day done and 6 newly revealed*
rather than *6 ready*.

## 16 September 2026 — MR-39

### A count is read from both of a runner's lines, not one

`Tests: 237 passed, 237 total` with `Test Suites: 2 failed` is internally consistent and wrong:
the cases in a suite that failed to *collect* are counted nowhere, so every test-level number
agrees with every other one while six tests silently do not exist.

**Decision: the reporter fails on a non-zero suite failure regardless of the case counts**, and
the standing rule is corrected to name both lines. `scripts/test-counts.mjs` also now fails on
`numFailedTests`, which it had been capturing into a variable and never reading — a reporter
that prints a failure count it does not act on reports failures as green.

**The generalisable half:** when a tool reports several numbers about the same run, ask which of
them can be *right while the run is wrong*. Here it was all of them but one.

### A grep in a recorded check is a defect in the check

Two were found this session, both by running them rather than by reading them.

`BE-W14`'s `grep -c "auditLog" endpoints.ts → ≥1` matched a prose comment and the `auditLogId`
field on an unrelated response. `FE-W13`'s `grep -c "90" <screen> → 0` returns **2** today, and
both matches are comments explaining why the number is *not* printed — it **fails on a screen
behaving correctly** and would **pass on one rendering the figure** from any expression without
those digits.

**Decision: a check whose command can pass or fail for a reason unrelated to the property is
replaced, not re-run.** `BE-W14`'s replacement requires the schemas to be **exported**, to be
**zod schemas**, and to **reject a malformed payload** — an exported name that parses anything is
not a contract.

**Grep locates; it does not decide.** That is now a standing rule because this project has now
been misled by the same shape three times.

### A SECURITY DEFINER read against a policy-less table puts the whole boundary in one body

`audit_log` has RLS enabled *and* forced with **no SELECT policy at all**. There is therefore no
policy to fall back on, and a scoping mistake inside `list_audit_log` is not caught by anything
downstream.

**Decisions taken because of that:**

- **No `or v_role = 'admin'` escape.** `list_consent_records` has one, written before BE-W76.
  Copying it into a new function would reopen the tenant boundary the console is the first
  surface to exercise in anger.
- **A non-admin is refused, never given an empty list.** An empty list claims there is nothing to
  see; a refusal claims something about who is asking, and only one of those is true.
- **The read audits itself, before gathering data.** Reading the trail appends to the trail. And
  the limit is recorded: a *refused* read is **not** audited, because the refusal rolls back the
  row written in the same transaction.
- **Rows with a null actor are excluded and COUNTED.** They have no tenant, and a short page
  should read as scoped rather than as empty.

### A figure the console prints must be the figure the database enforces

The retention period was a bare `interval '90 days'` inside `stamp_audio_retention`. A read path
returning its own `90` would have agreed **by luck** and drifted the first time either moved.

**Decision: one number, two readers.** `public.audio_retention_days()` is called by the trigger
and by `retention_status()`, and the test asserts both — the value *and* that the trigger's body
calls the function. That is why the console may now print it, having been right to refuse before.

### "Blocked" and "out of room" are different words

`FE-W13` is unblocked by this session's Part B and was not started, because a 3-half-day build at
the end of a long session produces a half-built screen.

**Decision: say which it is.** Twelve previous stops were blockages. Recording this one the same
way would have taught the next session to distrust both.

## 16 September 2026 — MR-40

### A boundary that lives in a function body is not covered by a policy audit

`BE-W76` scoped `visible_user_ids()` and the six `*_admin_all` RLS policies, and that was
reasonable — it is where a tenant boundary normally lives. **It is not where this one leaked.**
Eight `SECURITY DEFINER` functions carry `where (v_role = 'admin' or … visible_user_ids())`, and
the `or` short-circuits before the scoped half runs. No policy runs behind them, because the
tables have RLS **forced with no policy at all**.

**Decision: a tenant-boundary audit must enumerate FUNCTION BODIES as well as policies**, and the
two `SECURITY DEFINER` reads added in MR-39 were deliberately written without the escape.

**Why the existing test did not catch it.** `FIX-04`'s matrix tested `list_consent_records`
**before** `BE-W76`, when an admin's emptiness came from territory scoping incidentally rather
than from a tenant boundary deliberately. **A test that passed for a reason since removed is not
a test that still passes** — and nothing re-examined it when the reason was replaced.

### Record a known-open defect with `it.fails`, not with a characterisation test

`BE-W101` is open and was deliberately not fixed. The two probes state the **correct** property
and are marked as not currently holding.

**Decision: never assert the defective behaviour as if it were the specification.** A
characterisation test reads as approval of the defect, and the next person to fix the function
has to delete an assertion that looks deliberate. `it.fails` inverts that: **closing the escape
makes the tests fail**, which forces whoever fixes it to come and update them on purpose.

It also keeps CI green on a known-open defect without hiding it, which is the only honest way to
leave one in the tree.

### A duplicate id is a register that has stopped being one

Two ids were assigned twice, one session apart, **both by me**: `BE-W94` and `BE-W95`. The brief
named one; sweeping all 129 ids found the second.

**Decision: when an id collision is reported, sweep the register rather than fix the item named.**
And spot-check the sweep — 12 of the 14 candidates were the same item at different stages, which
a naive reading would have reported as twelve more collisions.

### A recorded check must constrain WHAT matched

Third time this has been earned, so it is now a rule rather than an observation. 14 of 137
recorded checks are grep-based; **2 are sound**.

The sharpest instance: `BE-W60`'s check — *"`grep -rl list_consent_records` returns a file"* —
**passes**, a suite exists, and that suite is titled `'list_consent_records is scoped and
audited'`. The function it names was proven open by this same session. The check asked whether a
file mentions the function. A file does.

**Decision: replace a defective check, never re-run it.** A defective check re-run is a defective
answer obtained twice.

### The gap in the audit trail is a property of the pattern, not of one function

MR-39 recorded "a refused read is not audited" as a note on `BE-W14`. It is true of **all seven**
read paths that audit-then-return inside one transaction.

**Decision: register it once, with the count and the cost of each escape route, and build
nothing.** PostgreSQL has no autonomous transaction; `dblink` is a dependency *and* a new
privilege surface on exactly the functions whose privileges are in question; and logging at the
PostgREST layer is the one place the actor is already known but moves part of the trail outside
the database that guarantees the rest.

**And the answer to "is it recorded anywhere" is "here, but not in the audit trail", not
"nowhere".** That was measured — `log_min_error_statement = error` puts the refusal in the
Postgres log — and the three reasons it is not a substitute are written down with it.

## 17 September 2026 — MR-41

### Enumerate a code pattern from the catalogue, not from grep

The eight `SECURITY DEFINER` bodies carrying `v_role = 'admin'` were listed with
`pg_get_functiondef` over `pg_proc where prosecdef`, not with `grep` over the migrations.

**Decision: when the question is "which functions in the running database have this shape",
ask the database.** Two things fall out that grep cannot give: the migrations are a *history*
and the catalogue is the *current state*, so a body later replaced is counted once and
correctly; and the same query surfaced `visible_user_ids` and `visible_territory_ids` carrying
the identical branch, where it **is** the scoping and is tenant-bounded — a distinction grep
locates but cannot make.

### A rolled-back transaction turns a write into a probe

Three of the eight sites are writes and had gone untested for two sessions because testing them
appeared to mean performing a cross-tenant write.

**Decision: call the write inside `begin … rollback` and read whether it was ACCEPTED or
refused.** `approve_call_report` was accepted for an admin of another tenant and refused for a
non-admin in the attacker's own tenant, and the database was unchanged afterwards. The three
write sites went from *shape-identical, untested* to **proven open** in one pass.

**The negative control is what makes it a measurement.** Accepted-for-admin alone is compatible
with the function accepting everything; refused-for-MR on the identical call and target localises
the failure to the `v_role = 'admin'` branch.

### A stop can be a third kind — and conflating it with the other two teaches the wrong lesson

MR-41's brief said: stop if the escape is open, because that changes what the session is. It was
open at all eight sites.

**Decision: record that as neither BLOCKAGE nor ROOM.** Nothing was in the way, and there was
budget left. It was a **conditional stop the brief itself defined, on a condition that turned out
to be true.** Calling it "room" would read as deferred by judgment; calling it "blockage" would
read as something failing. The register now carries three words rather than two.

### A false premise in a brief is answered from the record, not from memory

MR-41 A2 asserted that MR-40's Parts A3, B and C may never have run. They did.

**Decision: answer a premise about the repo by quoting the repo** — the section, its line number,
its length and its headings — rather than by recalling the session. The standing rule already
says anything the reviewer asserts is hearsay; the corollary is that anything *I* recall is too.

## 17 September 2026 — MR-42

### Remove the escape, do not replace it with a predicate

Eight `SECURITY DEFINER` bodies carried `(v_role = 'admin' or X in (select visible_user_ids()))`.

**Decision: delete the disjunct; add nothing.** `visible_user_ids()` has been the tenant boundary
since `BE-W76`, so the surviving half already grants a tenant admin every row in their own
organisation — exactly what `C1` describes. A second organisation predicate in eight bodies would
be a second copy of a rule that has one home, and that duplication is how these eight drifted
away from the helper to begin with.

### A migration asserts its own postcondition, from the catalogue

**Decision: a migration that closes a class of defect ends with a `DO` block that re-derives the
class from `pg_proc` and raises if any instance survives.** It fails the deploy rather than
leaving a boundary half-closed, and because it enumerates rather than listing, it catches a site
the migration never heard of. The identical assertion also lives in the test suite: one fails a
build, the other fails a deploy.

### "Needs a decision" is a claim to check, not a state to wait in

`BE-W101` sat as *needs a decision* for two sessions. The decision existed — `C1`, 9 September.

**Decision: when a register row says it needs a decision, search `.ai-collab/decisions.md` before
accepting that, and record the pointer in the row.** The missing thing was the pointer, not the
answer. The brief's own citation ("MR-07 §3") matched nothing in that file, which is how a real
decision comes to look absent.

### A permanent red is a broken alarm

The drift workflow was red on every commit reporting a known accepted state, and
`docs/blocked-on-you.md` led with a red banner for a defect that had been fixed.

**Decision: a check that reports a known accepted state gets three states, not two** — accepted
(green, with a notice naming the state, a date and the trigger that ends it), expired (red, saying
the acceptance lapsed), and the real finding (red, at any date). **And the acceptance must be
proven unable to swallow the real finding**, on the same date, with the same shape.

### The refusal has to name what it refused

**Decision: a guard's recorded check asserts the refusal NAMES THE HOST, never that the exit code
is non-zero.** `getaddrinfo ENOTFOUND` is precisely what a missing guard looks like, so a test
satisfied by any failure would have passed before the guard existed. It caught a `SyntaxError` of
mine posing as a guard the same hour it was written.

### Guard the accident, not the capability

`purge:audio` and `check:purge-health` run against production on a schedule; that is the
compliance control working.

**Decision: for a script that may legitimately touch a deployment, refuse a non-local target
unless it is opted into deliberately** (`ELMIRON_ALLOW_REMOTE_TARGET=1`, set in a reviewed
workflow file), rather than refusing deployments outright. Copying the seeds' localhost-only guard
onto them would have switched the retention promise off — the guard would have become the outage.

---

## 17 September 2026 — MR-43 A5: CANONICAL IDS. One decision, one name.

**`BE-W101` waited two sessions for a decision that had been taken on 9 September. The decision
was not missing — its NAME was.** The same ruling was called three things in three places:

| Where | What it was called |
| --- | --- |
| this file | **`C1`** |
| `20260908000800`'s exception hint | *"MR-06 section 3"* |
| the MR-42 brief | *"MR-07 §3"* |

Searching the repository for "MR-07" returns nothing in this file, so a reader following the
brief's pointer concludes the decision does not exist — and waits.

**The rule from here: a decision has ONE id, and every other label is a pointer to it.** The id
is the heading in this file. If a migration comment, a brief or a register row needs to cite a
decision, it cites that id.

### The canonical ids, and their known aliases

| Canonical | Subject | Known aliases to redirect |
| --- | --- | --- |
| **`C1`** | `admin` is a TENANT administrator; platform access is a separate audited break-glass path, out of MR v1 | *"MR-06 §3"*, *"MR-06 section 3"*, *"MR-07 §3"* |
| **`C2`** | `not_met` on `visit_status` | the 8 September entry *"`visits.status` gains `not_met` with a required reason"* — the same ruling, recorded twice in this file |
| **`C3`** | Audio is OUT of MR v1, on legal/compliance grounds, until a named PV/DPDP signatory exists | `blocked-on-you.md` **5.8** |
| **`C4`** | Coaching is OUT of MR v1 | `blocked-on-you.md` **5.6**; *"§3.6"* |
| **`C5`** | `BE-W69` / `pg_cron` keep-warm DECLINED; the honest fix is the paid plan | `blocked-on-you.md` **5.2** |
| **`O2`** | The name in permanent identifiers — package id `com.praversetech.fieldforce` | `FE-R1`, `FE-R1a` (which superseded the SCHEME only), `blocked-on-you.md` **2.2** |
| **`D-28.1` … `D-28.7`** | The MR-14 → MR-28 rulings | already unique; no aliases found |

**Two of these aliases were actively misleading, not merely redundant:**

1. **`C1` as "MR-07 §3"** — points at nothing. Cost: two sessions.
2. **`O2`'s own "Outstanding" line** — see the correction below.

### Correction to `O2`, appended rather than edited

`O2` ends with:

> *"**Outstanding from it: Backend must add** `praversefieldforce://auth-callback` **to
> `additional_redirect_urls`**"*

**Both halves of that are now wrong, and it has read as an open task ever since.**

- **The scheme is not `praversefieldforce`.** `O2`'s own earlier sentence says `FE-R1a`
  superseded it to the reverse-DNS form. The line quoted above was never updated.
- **The work is done, locally.** `services/api/supabase/config.toml` holds
  `"com.praversetech.fieldforce://auth-callback"` in `additional_redirect_urls`.

**What genuinely remains is neither of those**: that file configures the LOCAL stack only, and
its own comment says so — *"The same entry is needed on any HOSTED project … where it belongs in
Authentication → URL Configuration → Redirect URLs."* So the outstanding item is a **dashboard
action on the hosted project**, not a backend code change, and it belongs on
`docs/blocked-on-you.md` rather than here.

**Recorded as the shape, because it will recur:** an "Outstanding" line inside a decision entry
ages independently of the decision. The decision was right and stayed right; the task note beside
it went stale twice over and nothing was watching it. **A task does not belong inside a decision
record** — the decision is permanent, the task is not.

## 17 September 2026 — MR-43

### A decision has ONE id, and every other label is a pointer

`C1` was called `C1` here, *"MR-06 section 3"* in a migration hint, and *"MR-07 §3"* in a brief.
The third matches nothing, so a reader following it concludes the decision is missing.

**Decision: the canonical id of a decision is its heading in this file.** A migration comment, a
brief or a register row cites that id. Aliases live in the canonical-ids section and nowhere else.
Cost of not having this rule, measured: two sessions.

### A task note does not belong inside a decision record

`O2`'s *"Outstanding: backend must add `praversefieldforce://auth-callback`"* named a scheme
`FE-R1a` had already superseded, and claimed work that `config.toml` had already done.

**Decision: a decision record holds the ruling and its reasoning. Tasks arising from it are filed
where tasks are tracked** — `docs/blocked-on-you.md` for a human, the register for engineering.
The decision is permanent; the task is not, and the two age at different rates with nothing
watching the second.

### Contiguity is never an integrity check on a sequence-keyed table

`audit_log_id_seq` moved 29337 → 29356 with zero rows committed, because sequences are
non-transactional.

**Decision: never assert `max(id) - min(id) + 1 = count(*)`, and never read a gap as a deletion.**
On an append-only ledger that reading is wrong in the most alarming possible context. **The reason
is recorded ON THE COLUMN**, not only in a narrative, because the person who meets a gap will be
looking at the table. What guarantees the ledger is the statement-level trigger, forced RLS and
audit-before-return — and the comment names all three, so a reader who loses one check is handed
the real ones.

### Safe-by-delegation is a property, and a property needs a test

`approve_call_reports_bulk` has no scoping of its own and was never open.

**Decision: when a function is correct only because it delegates, assert the inherited property at
the DELEGATING function**, with a mutant that removes the delegation while keeping the write. A
mutant that breaks everything proves the test runs; a mutant that breaks only the boundary proves
the test is about the boundary.

### Calibrate the sweep before believing its count

Three enumerations were wrong this session — the delegation definition (1 instead of 4), the
script classifier (3 misreports), and MR-42's claim about gap-free ids.

**Decision: a sweep reports its METHOD alongside its count, and the method gets a control.** *Grep
locates, it does not decide* already applies to recorded checks; it applies equally to the query
that audits them. A narrowed definition produces a confident, wrong, small number — which is worse
than an obviously incomplete one.

### A document's alarms need the same treatment as CI's

`docs/blocked-on-you.md` opened with four alarms that were no longer true, including one resolved
in August.

**Decision: sweep the escalation document for stale alarms whenever the thing it describes
changes**, and strike items through with their evidence rather than deleting them. A permanent red
in CI and a dead alarm on the page written for the least-informed reader are the same defect; only
one of them had been noticed.

## 17 September 2026 — MR-44

### Generate a `create or replace` from the CATALOGUE, never from the migration that created it

Taking `emit_sync_event` from `20260908000300` would have reverted `20260909000100`'s exhaustive
version — silently, because `create or replace` succeeds.

**Decision: any migration that replaces an existing function generates its body from
`pg_get_functiondef`, applies a minimal edit, and asserts the edit applied exactly once.** A
migration file records what the schema WAS at one moment; the catalogue records what it IS. The
same mistake on the entity constraint failed loudly against live rows, which is the only reason
the function half was caught at all.

### A decision record holds rulings, not tasks

**Decision: tasks arising from a decision are filed where tasks live** — `blocked-on-you.md` for a
human, the register for engineering — **never inside the decision entry.** The decision is
permanent and is re-read as settled; a task note inside it inherits that authority and is the last
thing anybody re-checks. `O2` was right for a month while its "Outstanding" line was wrong twice
over.

### Reconcile duplicate register rows on COMPLETENESS, not on age

**Decision: when two rows describe one ask, the canonical one is whichever states it most fully.**
Two of MR-44's four pairs were subset/superset rather than duplicates; collapsing onto the older
row would have deleted `5.3`'s foreground-only alternative and `5.7`'s reference-data half — and
reference data is what `§6.1` is sequenced around.

### A sweep's population is a property of its definition

Three definitions of "safe only by delegation" gave 4, 2 and 11 members.

**Decision: run a sweep under at least two definitions that differ in KIND — textual versus
structural — and report the definition beside the count.** Choose the definition against the RISK
rather than convenience: the more natural query counted a delegator as independently scoped and
lost half the population. Over-inclusion is cheap; under-inclusion hands you a confident small
number with no way to know what it never looked at.

### An undeclared package may be used to VERIFY and never to IMPORT

`js-yaml` resolves from the root and from `services/api`, and is declared in no workspace
`package.json`.

**Decision: a hoisted transitive may be used in a throwaway command and must not be imported by
committed code.** The difference is whether its disappearance breaks the build. Declaring it is an
ASK — a small and reasonable one — but it must be made rather than assumed by hoisting.

### Refused: marking a plan approved so a filter passes

`BE-W89`'s screen filters on `status === 'approved'` and nothing in this system ever writes that
value.

**Decision: the filter changes, not the data.** A plan marked approved that no manager approved is
a false record, in a product whose differentiator is that it does not make those. The screen will
render the plan with its real status shown honestly — *"Submitted — not yet approved"* — and the
approval action stays out of v1 with the console.

## 21 September 2026 — MR-45

### A value check compares the rendered value to the SERVER's, not to "something rendered"

The converted beat plan rendered, counted and looked right: *"3 planned · 1 done"*. A `select`
showed the "done" visit was five days old.

**Decision: when a screen leaves the mock, its values are checked against a query of what the
server holds, at values chosen to expose a defect** — an order that differs from alphabetical and
insertion order, an instant where the UTC and territory dates differ. A screen that renders proves
nothing about what it rendered.

### When the client must decide a server concept, it uses the server's rule

The route had to decide which visits count as done today. `coverage()` already decides that, for
the manager: `(completed_at at time zone 'Asia/Kolkata')::date`.

**Decision: reuse the server's definition rather than invent one**, so the MR's screen and the
manager's report cannot disagree about the same fact. Where the server's rule is itself
questionable (it hard-codes the zone), record it rather than silently diverge.

### Elimination outranks inspection — including of the record you wrote

MR-44 recorded the Doctors screen as mock, by inspection. With the mock dead, it rendered.

**Decision: a real-versus-fixture row is marked with its method, and an inspection row is treated
as a claim.** Elimination is one command and settles it. A row I wrote with confidence the session
before was the one that was wrong.

### A cited identifier must exist before it is cited

MR-44 wrote "registered as `FE-W50`" and "registered as `FE-W51`" into a migration, a fixture and a
status document. Neither row existed.

**Decision: an id is created in the register first and cited second.** Citing an unregistered id
is inventing it.

### A sweep's label is a hypothesis about a boundary, and is tested by crossing it

`BE-W105` called three functions "safe only by delegation". One of them hands any caller another
organisation's configuration.

**Decision: a finding that a function is safe is not recorded until a cross-tenant probe with both
controls has failed to cross it.** Finding the function is the sweep's job; deciding what it is
requires trying.

## 21 September 2026 — MR-46

### When one line of a user-facing claim is false, every line is checked

2.6 named two false rows in the privacy notice. Checking all eight found six false or partly false.

**Decision: a notice, consent text or any other statement to a user is verified whole, claim by
claim against the code, once any one line of it is found false.** The defect that produced one false
line — a claim true when written and never re-checked — does not stop at one line.

### A statement to a user waits for the operator; the change does not

The corrected notice is ready but unapproved. **Decision: prepare it on a branch, pushed and tested,
and record that the false version is live** — rather than either shipping unapproved wording or
leaving the work undone. The approval then costs one merge.

### An ACL claim in a comment is checked against the ACL

`20260916000300` said `audio_purge_health()` was "granted to nobody". It was granted to every
signed-in user. **Decision: a comment asserting who can execute or read something is not written
without the `has_*_privilege` query that shows it**, and one found without that query is treated as
hearsay.

### "Restrict to admins" is not a tenant fix here

`admin` is a tenant role (C1). **Decision: a whole-database view is revoked from signed-in roles
entirely**, and the per-company question is answered by a separate, scoped function — as
`retention_status()` already does.

### A client that "uses the server's rule" calls it

MR-45's day filter was described as the server's rule; it was a copy that already differed.
**Decision: the phrase is reserved for a client that reads the server's answer.** A client
re-implementation is recorded as a copy, with how it differs.

## 21 September 2026 — MR-47

### A finding made by reading code is a hypothesis about the device

MR-46 registered `FE-W53` — declined consultation audio may stay on the phone — from code. On the
Pixel 10 no consultation recording can start at all; the audio that does stay is the MR's own voice
notes. **Decision: a finding about what exists on a device is registered as "by inspection" and is
not acted on — no dependency added, no deletion built — until the device has been listed.**

### Know how a function runs before revoking what it calls

The BE-W106 lesson was "revoke whole-database helpers from signed-in users". Applied to the day-rule
helpers it broke `sync_pull`, which is `SECURITY INVOKER`. **Decision: before revoking EXECUTE on a
helper, list its callers and each caller's `prosecdef`. Where an invoker needs it, grant it and
scope the helper to the caller's `visible_user_ids()`, refusing with 42501 — never answering for an
id the caller cannot see.**

### One day rule, and the server sends it

The route, the report and Today each reckoned a visit's day. **Decision: a visit's day is
`visit_day()`, sent on the pull; a client that needs it reads `visitDay` and never re-derives it.**
Today's third copy is `FE-W57`, pending a product answer on what "today" means there.

### A green run is read, not glanced at

The production drift run is green while printing `drifted: true` (19 of 63). It is a recorded,
dated acceptance, not an accident — **and it means no session's migration since 7 September is in
production.** **Decision: every session that reasons about production reads that run's output, not
its status.**

## 21 September 2026 — MR-48

### Today never hides the visit the MR is standing inside

Today shows visits whose server day is today, and always any visit in progress. **Decision (the
operator's, applied by MR-48):** the one thing a screen that is the only door into a visit must not
do is hide the visit the MR is in — it made check-out unreachable on the Pixel 10.

### A sweep is searched two ways, and the second is the test of the first

The name-and-behaviour search for the day rule found one decider; the data-flow search (every read
of a visit's instants) found two more copies. **Decision: a sweep for copies of a rule reports both
methods and whether the second changed the list.**

### Codes from the gateway are measured, not listed

`PGRST303` and `PGRST301` come from PostgREST, not a function body. The error contract's guard
failed on them, and its own comment said to fix the derivation. **Decision: a code raised outside
the database joins the derivation by being MEASURED each run** — a request that produces it — never
by a static list.

### An audited read is a product cost, not an implementation detail

Making the visit screen say what the server says about consent means an audited read per open,
against the reasoning MR-12 Q4 recorded. **Decision: such a change is raised with its options, not
made silently.**

## 21 September 2026 — MR-49

### Everything a device stores about a rep is keyed by the rep

The offline queue was one key for everyone; the next rep's app sent the previous rep's work under its
own sign-in. **Decision: any per-user state on the device — queue, pulled store, witnessed consent —
is keyed by the signed-in user id, and with no user signed in there is nothing to read or write.**
Legacy unkeyed data is never read, because it cannot be attributed.

### "Refused" is not "harmless"

The server refused rep A's writes sent as rep B, so nothing false was recorded — but A's work was
lost and the ledger names B. **Decision: a server refusal is not accepted as the safety net for a
client that sends the wrong user's work; the client must not send it.**

### A promise on screen has its mechanism tested

The sign-out banner says unsent work "sends the next time you sign in here". The flusher did not run
on sign-in, and only the device showed it. **Decision: a screen sentence that promises a future
action ships with a test of the trigger that performs it.**

### The device's own witnessed facts are shown as such

For consent, no audited read and no reversal of MR-12 Q4. **Decision: where the server's answer is
deliberately not on the device, the screen states what the device itself witnessed — labelled "on
this phone" — or states that it has nothing, and never implies either answer.**

### A compliance count's clock is stated, not inherited

The UCPMP cap took its month from the session timezone. **Decision (proposed, `BE-W108`): any
period boundary on a compliance count names its zone explicitly in the function.**

## Operator decisions — 22 September 2026 (recorded in MR-50)

**Unlike `C1`–`C6`, which were REVIEWER decisions taken on the operator's behalf, these four are the
operator's own**, relayed in the MR-50 brief. They continue the same id series so there is one
canonical place to cite them. The MR-50 brief referred to a table of decisions that did not reach the
session; only the decisions the brief states in its own words are recorded here, and nothing is
applied that is not in this list.

### C7 — KEEP the AI layer

**Decided.** The AI layer stays. **This answers the ship-or-cut question the 30 September
`CONTRACT_I3_DEADLINE` existed to force** — `packages/core/src/field/transcript-v0.expiry.test.ts`
and `docs/blocked-on-you.md` → *"TWO DATED DEADLINES"*.

**It is not resolved by a placeholder schema.** `TranscriptV1` is designed as the real,
vendor-agnostic contract (MR-50 B). What stays OPEN: the STT vendor choice and measured Hinglish error
rate (`blocked-on-you` 4.2) — a bake-off needs labelled audio the project does not have yet.

**Relation to `C3` and `C4`.** `C3` (audio out of MR v1 for legal reasons) is **not reversed**: its two
blockers — the §2.4 adverse-event screening duty and the §8.6 PV/DPDP signatory — still stand before a
recording reaches a real doctor. `C7` means engineering builds towards the AI layer; `C3` still decides
when it may touch a real doctor. `C4`'s second reason ("no AI layer") no longer holds; its first
(§3.6 unrecorded) does, so coaching stays out of v1 until §3.6 is written down.

### C8 — The purpose of the audio

**Decided, in the operator's words:** *recordings and voice notes are kept so the AI layer can
support proper review and monitor that SOPs are followed.*

**This answers the question open since MR-38** (`blocked-on-you` → *"Does the MR app record audio at
all, if there is no AI layer?"*). It is the DPDP purpose. It also changes what the audio IS: review
for SOP adherence is **monitoring of the rep**, not only a record of the doctor's consent — which is
what `C8`'s requirements (below, and MR-50 A3) follow from.

**What the purpose requires before any real recording is made** — registered, not blocking
engineering:

1. **The consent text shown to doctors names this purpose.** Today's notice says the team *"reviews
   how they presented"*; it does not say SOP monitoring or AI processing.
2. **The privacy notice to reps says their visits may be recorded and reviewed for SOP adherence** —
   employee monitoring, stated as such (`FE-W52`, `blocked-on-you` 2.6).
3. **The PV/DPDP signatory (§8.6) is still required before the recording feature reaches a real
   doctor**, because transcripts create the adverse-event screening duty in §2.4.

**Engineering may proceed on everything that does not touch a real doctor.**

### C9 — Voice notes are KEPT (option b), and `expo-file-system` is approved

**Decided.** Option (b) of `blocked-on-you` → *"Voice notes — option (a) or (b)"*: voice-note
recording stays; discarded audio is deleted from the phone. **`expo-file-system` is approved** — the
dependency option (b) required. The upload itself is not in scope yet (MR-50 D5).

### C10 — `apps/console` gets a dev-only test renderer

**Decided (reviewer's choice, approved).** `@testing-library/react` with a DOM environment for the
console's existing runner (vitest), **dev-only** — nothing ships in the app bundle. This answers
`blocked-on-you` 2.5 and unblocks `FE-W12`.
