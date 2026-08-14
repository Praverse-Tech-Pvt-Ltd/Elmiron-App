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
  after the deploy was verified, 07:28 UTC, 14 August. First real scheduled cycle
  (not a manual dispatch) observed at — *fill in from the next hourly/watchdog run;
  see `PROJECT-OVERVIEW.md` → BE-W8 §7 for the timestamp once it lands.*

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

## Where the earlier ones live

| Decision | Where |
| --- | --- |
| `admin` has full visibility, never authorship | `PROJECT-OVERVIEW.md` → "Settled by the reviewer, 11 Aug" |
| Audit row stays in the caller's transaction; no `dblink` | same |
| Immutability is a trigger, not a policy | → "Added in BE-W2" |
| RLS decides which rows, never what values | → "Standing principle" |
| Three requirements dropped (roles, versioning, source search) | → "Closed by the reviewer, 12 Aug" |
| `app_thresholds` is append-only, not updatable | → BE-W6 |
| Team-size floor of 8 for the consent anomaly | → BE-W6 |
| Withdrawal cascade order, and why the object is not deleted inline | → BE-W6 |
