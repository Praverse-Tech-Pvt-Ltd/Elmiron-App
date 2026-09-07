# Frontend → Backend Handoff

**Written:** 3 September 2026 · **From:** frontend · **For:** whoever picks up backend
**Frontend head:** `7862964` on `fe/phase2-c5-b7-and-phase3-consent`
**State as of:** 3 September 2026, 17:30 IST. Anything dated after this is not in here.

> **This is not the root `handoff.md`, on purpose.** That one is **yours** — the
> backend handoff of 17 August — and it is still live: `.ai-collab/handover.md`
> calls it current and its Next Steps are unfinished (three unset GitHub secrets, a
> manual `Audio retention` dispatch, production reference data). Overwriting it
> would have destroyed instructions nobody has carried out. **Read that one for
> your own work; read this one for what the frontend now needs from you.**
>
> **Nothing below is pushed.** 53 commits sit on one laptop. See §5.
>
> Tracked records that outrank this file if they disagree:
> `docs/frontend-status.md`, `docs/fe-w3-spec.md` (§4a — every frontend decision),
> `docs/gotchas.md`, `docs/push-readiness.md`, `PROJECT-OVERVIEW.md`.

---

## 1. Goal

The frontend built the Expo/React Native field app and the Next.js manager console
against the four committed design documents in `docs/design/`. **All four phases
are now built.**

For you, the useful framing is narrower: **the frontend is now a real consumer of
your API.** It calls 27 client methods, and it has stopped at a small number of
places where the contract has no path, no column, or no answer. Those places are
§2 "Blocked on backend" and they are the whole reason this document exists.

Two constraints of ours you should know, because they explain requests you may find
odd:

- **The frontend refuses to display anything the server has not told it.** No
  invented UCPMP cap, no invented rupee-per-km rate, no invented retention figure,
  no "sent" over an unsent file. Where a number is missing, the UI says it is
  missing and names what would supply it. That is why the asks below are specific.
- **`frontend-plan-v2.md` §3.6's ban on any score, rank, percentile or grade was
  never reversed.** Two other parts of §3.6 were reopened on 3 September (below).
  If a future endpoint returns a composite score, the frontend has nowhere to put
  it and will not grow one.

---

## 2. Current State

### What the frontend now consumes from your API

27 client methods in `packages/core/src/field/client.ts` — **a shared package, so
this file is as much yours as ours.** I added 9 this session:

| Added                     | Path                                | Notes for you                                                                                                  |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getActiveConsentText`    | `GET /consent-text-versions/active` | Fetched per visit. Its `fullText` is rendered **verbatim** to the doctor and its id goes on the consent record |
| `listConsentTextVersions` | `GET /consent-text-versions`        | Only used to discover which languages have a live notice                                                       |
| `createSampleAndInput`    | `POST /samples-and-inputs`          |                                                                                                                |
| `listSamplesAndInputs`    | `GET /samples-and-inputs`           |                                                                                                                |
| `getAnalysis`             | `GET /analyses/:id`                 | The frontend assumes **this call is what stamps `mrViewedAt`**. Please confirm                                 |
| `respondToAnalysis`       | `POST /analyses/:id/response`       |                                                                                                                |
| `createAnalysisOverride`  | `POST /analyses/:id/overrides`      |                                                                                                                |
| `createRecording`         | `POST /recordings`                  |                                                                                                                |
| `createVoiceNote`         | `POST /voice-notes`                 |                                                                                                                |

**One contract question answered by running it, which you should sanity-check.**
`POST /voice-notes` and `POST /recordings` return an **`UploadSession`**, not the
entity. The frontend originally typed them as `VoiceNote`/`Recording`; it compiled,
linted and passed every test, and failed the moment a real device ran it. The mock
returns `fx.uploadSession` for both. If that is not what production does, tell us —
it is now load-bearing in `apps/field/app/voice-note/[visitId].tsx`.

### Blocked on backend — in priority order

These are the frontend's actual asks. Each has a visible consequence in the app
today.

1. **The resumable upload has no client because it has no client-usable path yet.**
   `API_PATHS.uploadSession` / `uploadCompletion` exist; nothing in the frontend
   uses them. **Consequence: audio is recorded and never leaves the phone.** The
   voice-note screen currently tells the MR "uploading them is not in this build."
   This is the single biggest gap and it makes the whole audio feature inert.
2. **No `GET /analyses/:id/overrides`.** There is a POST that records an override
   and no path that lists them back. **Consequence:** the manager console's "Your
   overrides this month" panel (Phase 4 E1) says "not built" instead of a count.
3. **No audit-log path.** `audit_log` is append-only and written by trigger, but
   nothing exposes it. **Consequence:** the admin console's audit panel (E3) is a
   stated gap. It also blocks the promise the MR's transparency screen makes —
   "every read of your data is logged and shown to you."
4. **No retention path.** The retention schedule is server-side with no endpoint.
   **Consequence:** E3 prints no retention period rather than the design's "90
   days", because the console has not been told it.
5. **No organisation name anywhere in the contract.** `GetMeResponse` has a profile
   and territory ids; `Territory` has an `organisationId` and no name; there is no
   organisations path. **Consequence:** the consent screen's Data Fiduciary line
   reads "_<rep first name>_'s employer is the Data Fiduciary" instead of naming
   the company — on the sentence that tells a doctor who holds their data.
6. **`CreateCheckInRequestSchema.coordinates` is required and non-nullable.**
   **Consequence:** Phase 2 S4's promise — "the app fully works with location
   denied" — is unimplementable. A denied permission genuinely blocks check-in and
   the MR is told so plainly. Needs `coordinates` nullable or a `manual-no-fix`
   variant. Already recorded in `fe-w3-spec.md` §4a as BLOCKED ON BACKEND.
7. **No UCPMP cap anywhere.** `samples_and_inputs` has no limit column, no check
   constraint and no function computing a month to date, and the RLS policy grants
   a plain insert — but `SampleAndInputSchema`'s comment says "UCPMP caps are
   enforced server-side". **That comment is currently untrue and worth correcting
   either in code or in the schema.** Consequence: the samples screen says plainly
   that the app is not counting, and asks the MR to keep their own count.
8. **`Territory` has no language field.** The design sets the doctor's consent
   language per territory. **Consequence:** the MR picks the language on the
   handoff screen instead, from whatever `listConsentTextVersions` reports live.
   Arguably better — but it is a deviation you should know about.

### Things in your tree that I changed

Small, and flagged because `services/api/` is yours:

- **`services/api/scripts/seed-one-mr.mjs` — rewritten.** It imported
  `../tests/fixtures.js` from a `.mjs` file and **had never run**: `fixtures.ts` is
  NodeNext TypeScript whose imports carry `.js` specifiers only the compiler
  rewrites, so Node died with `ERR_MODULE_NOT_FOUND` before touching the database.
  Now self-contained like its five siblings (plain `.mjs`, `pg`, `fetch`), with a
  `.d.mts` beside it, and it verifies the sign-in before printing credentials.
- **`services/api/tests/seed-one-mr.spec.ts` — added.** 11 tests. The CLI half runs
  anywhere; the seeding half skips without a database, per your existing rule.
- **`services/api/package.json`** — added `seed:mr`.

Usage: `pnpm --filter @fieldforce/api seed:mr [-- --email me@example.test]`.

### Two §3.6 reversals, 3 September — you should know these happened

§3.6 bans "any screen that displays a transcript, analysis or AI summary". It was
upheld on 2 September, then reopened **twice** on 3 September: first for the MR's
own screens, then separately for the manager's. Recorded as two decisions in
`fe-w3-spec.md` §4a with their scope, because they are two different questions.
**The scoring ban was in neither.** If anyone tells you §3.6 is "lifted", it is
lifted in two specific places and nowhere else.

### Test and build status — observed, not assumed

`pnpm turbo run lint typecheck test` → **23/23 tasks successful**. Format clean.

| Workspace   | Runner        | Count                                     |
| ----------- | ------------- | ----------------------------------------- |
| `field`     | vitest / jest | 320 / 72                                  |
| `ui`        | vitest / jest | 4 / 221                                   |
| `ui-tokens` | vitest        | 54                                        |
| `core`      | vitest        | 21                                        |
| `mock`      | vitest        | 40                                        |
| `console`   | vitest        | 10                                        |
| `api`       | vitest        | 344 (local stack up; passed, not skipped) |

**1,086 total.** Report the split, never the single figure.

**A count is not coverage.** Five defects this session passed lint, typecheck and
the entire suite and were caught only by running the app — see §5.

### Unverified

- **FE-G1 and FE-G2 remain open.** Both are _device_ gates; everything here is
  emulator-only.
- **CI has never executed**, on any branch, for any commit.
- **The console has only been exercised by fetching HTML.** `OverrideForm`'s submit
  path has never been clicked in a browser.
- **`POST` writes are unverified against a real server.** `services/mock` returns
  static fixtures and does not persist, so a consent record or sample written by
  the app is accepted and forgotten. Nothing has been round-tripped through
  Supabase.

---

## 3. Active Files

| File                                     | Status        | Why it matters to you                                                                     |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `packages/core/src/field/client.ts`      | Modified      | **Shared.** 9 new methods; the response-shape note above lives here                       |
| `services/api/scripts/seed-one-mr.mjs`   | Rewritten     | Your tree. Was broken, now works                                                          |
| `services/api/tests/seed-one-mr.spec.ts` | Created       | Your tree                                                                                 |
| `services/api/package.json`              | Modified      | Added `seed:mr`                                                                           |
| `docs/fe-w3-spec.md`                     | Modified      | §4a — every frontend decision, both §3.6 reversals, every BLOCKED ON BACKEND note         |
| `docs/gotchas.md`                        | Modified      | JDK 25 native-build trap                                                                  |
| `docs/frontend-status.md`                | Modified      | Canonical frontend status, brought current                                                |
| `docs/push-readiness.md`                 | Modified      | The 403, re-confirmed; the refreshed bundle                                               |
| `handoff.md`                             | **Untouched** | Yours. Still live                                                                         |
| `apps/field/src/capture/recording.ts`    | Created       | The consent gate for the microphone — the device half of a rule your server also enforces |
| `apps/field/src/consent/record.ts`       | Created       | Notice version/language handling; no-notice-no-question gate                              |
| `apps/console/`                          | Created       | The Next.js console — was a one-file placeholder                                          |

---

## 4. Changes Made

Ten commits, `cb075b1` → `7862964`. Every message carries its own reasoning.

| Commit    | What                                                                            |
| --------- | ------------------------------------------------------------------------------- |
| `cb075b1` | `seed-one-mr` rewritten and tested                                              |
| `2536862` | Phase 2 C5 + B7; Phase 3 consent handoff; carries the uncommitted FE-W3 surface |
| `0b6a94c` | DM Sans loaded — the app had shipped in Roboto for three phases                 |
| `517447c` | Phase 4 MR coaching; Next.js console stood up                                   |
| `b8d3703` | Cormorant brand line; status docs corrected                                     |
| `c96cbbb` | Console E1 + E2 under the second §3.6 reversal                                  |
| `c483f3b` | Audio capture, consent-gated, on a real Android dev build                       |
| `2d4ccca` | Blank dev build fixed; wrong capture response type fixed                        |
| `4563d34` | Offline bundle refreshed; 403 re-confirmed                                      |
| `7862964` | Tab-bar icons                                                                   |

---

## 5. Failed Attempts

**1. Push to `origin` — failed twice, still blocking, no local workaround.**

```
remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904.
fatal: ... The requested URL returned error: 403
```

Account-level authorisation, **not** a token scope — the error names an account and
says denied. `docs/push-readiness.md` is where that misdiagnosis was originally
caught. Needs an org owner to grant `Devpt1904` write access, or a push from
`Rabbitshah`, which authored `b5d03a5`. A second gate waits behind it: `workflow`
scope, because `.github/workflows/ci.yml` is modified.

Mitigation: `C:/dev/elmiron-app-03sep2026.bundle` — all six refs, `git bundle
verify` clean, test-restored to a scratch clone. **It is on the same disk as the
repo, so it is not yet a backup.**

**2. `org.gradle.jvmargs` for the JDK 25 native-build failure — did not work.** The
restricted-access warning comes from a forked worker that does not inherit the
property. `JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED` does. In
`docs/gotchas.md`.

**3. `expo install` / `pnpm add` failing with `ERR_PNPM_ENOENT` on `importPackage`.**
Metro and the mock held file handles in the hoisted `node_modules` while pnpm
rewrote it. Stop every `node` process first. Not a pnpm bug to chase.

**4. Five defects that passed lint, typecheck and 1,086 tests and were found only by
running the app.** The most transferable thing on this page:

| Defect                                                                                            | Why the suite missed it                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Consent copy misgendered the rep — "His team reviews how he presented" against a rep named Ananya | Nothing asserted pronouns                                 |
| The "no notice" gate fired _while loading_, telling the MR no notice existed                      | Loading and absent were one state                         |
| Sync indicator printed a raw UTC ISO timestamp on the home screen                                 | No test rendered the formatted value                      |
| Both capture endpoints typed to return the entity; both return an `UploadSession`                 | Tests covered request builders, never the response parse  |
| Font gate returned `null` with no deadline → permanently blank app                                | `useFonts` reports loaded or failed, but promises neither |

Each now has a regression test naming the run that found it.

---

## 6. Next Steps

**Yours first — these are backend actions, in the order the frontend feels them.**

1. **Do your own `handoff.md` §6 first.** It is unchanged and still correct: set the
   three GitHub secrets, dispatch `Audio retention` once by hand, seed production
   reference data, chase contract I3 (CI deadline **30 September 2026**) and the
   PV/privacy sign-off. Nothing in this document supersedes it.
2. **Ship the resumable upload as something a client can call.** This is the
   frontend's largest blocker: audio is recorded and never sent. Acceptance: a
   voice note recorded on the dev build reaches storage and the app stops saying
   "uploading them is not in this build."
3. **Add `GET /analyses/:id/overrides`.** Unblocks E1's overrides panel.
4. **Decide `CreateCheckInRequestSchema.coordinates`** — nullable, or a
   `manual-no-fix` variant. Until then Phase 2 S4 is a promise the app cannot keep.
   `fe-w3-spec.md` §4a has the full note.
5. **Correct or implement the UCPMP claim.** `SampleAndInputSchema` says caps are
   "enforced server-side" and nothing enforces them. Either add the constraint or
   change the comment — the frontend has already told MRs the app is not counting.
6. **Expose the audit log and the retention schedule.** Both are stated gaps in the
   admin console today.
7. **Confirm `POST /voice-notes` and `POST /recordings` really return an
   `UploadSession`** in production, not only in the mock. The app depends on it.
8. **Confirm `GET /analyses/:id` is what stamps `mrViewedAt`.** The MR's screens
   claim "you saw this before your manager acted on it" and that claim rests on it.

**Ours, for the next frontend session** — listed so you are not surprised:

9. Get the push unblocked, then run CI once. Expect the first run to be red.
10. Run on physical hardware; close FE-G1/FE-G2.
11. Fix `CLAUDE.md` line 35 — it says `handoff.md` and `.ai-collab/` are kept out of
    git; `acaaa33` made both tracked, and the root `handoff.md` header repeats the
    stale claim.
12. Decide the console's auth story before it is shown to anyone.

### How to run the frontend, if you need to

```bash
pnpm db:start                                    # local Supabase
pnpm mock                                        # mock API on :4010
pnpm --filter @fieldforce/api seed:mr            # prints working credentials
# dev build only — expo-audio is native, Expo Go will not load this app
adb install -r apps/field/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:54321 tcp:54321 && adb reverse tcp:4010 tcp:4010
pnpm --filter @fieldforce/field exec expo start --dev-client
```

`127.0.0.1` inside the emulator is the emulator — the `adb reverse` lines are not
optional, and they die with the emulator. Rebuilding the APK needs
`JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED` on JDK 25.
