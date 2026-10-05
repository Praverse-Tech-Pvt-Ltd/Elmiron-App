# Frontend facts — 1 October 2026 (FE-D13)

Facts taken from the code at `593e5f0` (`main`, after PR #11 merged), on branch `fe-d13-facts`.
Every answer cites a file and line, or a command and its output. "Not established" means the
code or the commands could not settle it.

---

## Summary (paste-ready)

- **Repo:** https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App. Default branch `main`. The demo
  build came from `fe-d12-final` (`dc5003f`), which is now merged into `main` (PR #11, `593e5f0`).
- **Maanav (Rabbitshah) has `admin` on the repo.** He can read, push, maintain and administer it.
- **Frontend and backend are in this one repository.** All 75 migrations on `main` are in
  `services/api` here, and so are Maanav's latest commits (today, on the AI branch
  `worktree-ai-platform-phase-a`). No other remote, submodule or repo reference exists. The org's
  `Elmiron` (patient web, last push 10 July) and `Elmiron-LMS-Demo` (learning demo site, 24–25
  September) repos are separate projects, not this app's frontend.
- **Screens still on test data:** Day end and Mileage read the mock server and are reachable.
  Coaching, Analysis and Reply also read the mock server but are hidden in this build. No screen
  uses fixtures compiled into the app.
- **Contract:** `apps/field` uses `@fieldforce/core` from the workspace (`workspace:*`, linked to
  `packages/core`). There are no duplicated Zod schemas. Three small type unions and the RPC names
  are re-declared locally instead of imported.
- **CI:** every PR and every push to `main` runs typecheck, lint, format and every workspace's
  unit tests, plus all migrations, the database suite and the rollbacks. In the last green run on
  `main` that was **2,158 tests**. It does **not** run jest as Android (iOS preset only; the
  Android preset fails to load), builds no APK, and runs nothing on a device or emulator.
- **Voice-note deletion in production: not established.** The hourly job is wired to production,
  its secrets are set and it succeeds. It would delete an expired note's audio and mark the row
  destroyed (the row is kept). But it has never destroyed anything in production, and the app
  cannot currently store a voice note there. The copy stays "marked for deletion"; nothing was
  changed.

---

## 1. Repository

**Remote, default branch, demo branch.**

- `git remote -v` → `origin https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git` (fetch and
  push). It is the only remote.
- `gh repo view --json url,defaultBranchRef,visibility` →
  `"defaultBranchRef":{"name":"main"}`, `"visibility":"PUBLIC"`.
- The demo APK was built from `dc5003f` on `fe-d12-final`
  (`PROJECT-OVERVIEW.md`, FE-D12 §6). PR #11 merged it into `main`:
  `gh pr view 11 --json state,mergeCommit` → `"state":"MERGED"`, merge commit `593e5f0`.

**Maanav's access.**

```
$ gh api repos/Praverse-Tech-Pvt-Ltd/Elmiron-App/collaborators/Rabbitshah/permission
{"permission":"admin", ... "permissions":{"admin":true,"maintain":true,"push":true,"triage":true,"pull":true},"role_name":"admin"}
```

**Is the backend in this repository? Yes.**

- `ls services/api/supabase/migrations | wc -l` → 75 on `main`. The newest is
  `20260924000300_refused_reads_are_audited.sql`.
- `git log --format='%h %ad %an | %s' --date=short origin/main -- services/api/supabase/migrations`
  → the six newest migration commits are all Maanav Shah's (`dcadaae`, `30e174a`, `91be945`,
  `df1300f`, `7403c25`, `2f4a34b`, 23–24 September).
- `git log --format='%an' origin/main | sort | uniq -c` → Maanav Shah 213, Pratham Shrivastav 101,
  Devpt1904 75, Dev Patel 53. All four work in this repo.
- Maanav's newest commits are on `origin/worktree-ai-platform-phase-a` (PR #2):
  `d704163` and `59cac51`, both 1 October 2026. That branch holds 91 migrations
  (`git ls-tree … services/api/supabase/migrations | grep -c sql`), the newest
  `20261001000300_write_rejections.sql`. All 48 commits ahead of `main` are his.

**Is there a separate backend or frontend repository?**

- `git remote -v` lists only `origin`. There is no `.gitmodules`.
- `git grep` over `main` for `github.com/<owner>/<repo>` links, "another repo", "separate
  backend/frontend repo" and `Elmiron-LMS-Demo`, excluding vendored skills and well-known
  libraries → no matches.
- `PROJECT-OVERVIEW.md:4` says only that "the patient app is a separate project with a separate
  database".
- `gh repo list Praverse-Tech-Pvt-Ltd` shows two other repos with Elmiron in the name:
  - `Praverse-Tech-Pvt-Ltd/Elmiron`: last push 10 July 2026. Its latest commits are Pratham
    Shrivastav's ("Add Elmiron Care patient support page", "Link Expert Videos to real GIBS
    induction course videos"). That is patient-facing web, not the MR app.
  - `Praverse-Tech-Pvt-Ltd/Elmiron-LMS-Demo`: created 24 September and last pushed 25 September.
    It is a Vite site ("Build Elmiron Learning demo website", "Add MR capability curriculum and AI
    Doctor practice simulator"). It is a demo website, not `apps/field`.

**Verdict:** "the frontend is in another repository" is **not true of the MR app**. `apps/field`
(the phone app), `apps/console` (the manager console), `packages/*` and `services/api` (the
backend) all live in `Elmiron-App`. If the team means one of the two repos above, those are
separate projects.

---

## 2. Screens that still read test data

**How the app reaches each source.**

- **REAL:** Supabase at `EXPO_PUBLIC_SUPABASE_URL` (`apps/field/src/supabase.ts:13`). It is used
  for auth (`session.tsx:83,87`), `sync_pull` (`sync/pull.ts:223`), `sync_push`
  (`sync/push-client.ts:219`), `begin_upload` (`push-client.ts:321`), `my_shift_window`
  (`today/shift-window.ts:38`) and `recording_permission` (`capture/recording-permission.ts:105`).
- **MOCK:** `createClientForScenario()` (`apps/field/src/api.ts:40-58`) points `createApiClient`
  at `EXPO_PUBLIC_API_BASE_URL`.
  - `config.ts:49-51` resolves that variable. A dev build falls back to `http://127.0.0.1:4010`
    (`api-target.ts:19,33`). The demo build sets `http://<ip>:4010` (`build-demo-apk.ps1:197`).
  - Port 4010 is `services/mock` (`services/mock/src/server.ts:1024`). It answers from
    `services/mock/src/fixtures.ts` (`server.ts:5`).
- **FIXTURE compiled into the app:** none. A grep of `apps/field/app`, `apps/field/src` and
  `packages/ui/src` (tests excluded) for fixture, `fx.`, `SAMPLE_` and `DEMO_` imports found no
  matches.

**Per route (`apps/field/app`).**

| Route | Source | Call (file:line) | Hidden in this build |
| --- | --- | --- | --- |
| `_layout.tsx` | REAL (providers) | `PulledStoreProvider` → `sync_pull` (`:120`) | no |
| `index.tsx` | REAL auth + device | `useSession()` (`:14`), `hasCompletedFirstRun()` (`:19`) | no |
| `sign-in.tsx` | REAL | `signIn` → `signInWithPassword` (`:35`, `session.tsx:83`) | no |
| `(tabs)/home.tsx` | REAL + device | `usePulledStore()` (`:72-81`), `loadQueueState()` (`:89`) | no |
| `(tabs)/doctors.tsx` | REAL | `usePulledStore()` (`:31`) | no |
| `(tabs)/me.tsx` | static + device + REAL auth | `settingsGroups` (`:42`), `signOut` (`:89`) | no |
| `(tabs)/coaching.tsx` | **MOCK** | `listAnalyses()`, `listVisits()`, `listDoctors()` (`:71,74`) | **yes** |
| `analysis/[id].tsx` | **MOCK** | `getAnalysis(id)` (`:71`), `listVisits/listDoctors/listConsentRecords` (`:76-80`) | **yes** |
| `reply/[analysisId].tsx` | **MOCK** | `getAnalysis` (`:58`), write `respondToAnalysis` (`:105-106`) | **yes** |
| `day-end.tsx` | **MOCK** + REAL + device | `listVisits()` (`:88`), `listMileage(...)` (`:93`); `today` from `usePulledStore()` (`:49`) | **no** |
| `mileage.tsx` | **MOCK** | `listMileage(monthWindowIn(serverTime, zone))` (`:59-60`) | **no** |
| `beat-plan.tsx` | REAL | `usePulledStore()` (`:109-118`) | no |
| `queue.tsx` | device + REAL | `loadQueueState()` (`:46`), `flushOutbox` → `sync_push` (`:81`) | no |
| `transparency.tsx` | static + flag | `transparencyEntries({recordingEnabled})` (`:52`) | no |
| `doctor/[id].tsx` | REAL | `usePulledStore()` (`:26`) | no |
| `visit/[id].tsx` | REAL + device | `usePulledStore()` (`:118`), `createCheckIn/createCheckOut` (`:398,412`), `takeFix()` (`:390`) | no (recording control off by flag) |
| `consent/[visitId].tsx` | REAL | `usePulledStore()` (`:100`), `createConsentRecord` (`:243`) | no |
| `samples/[visitId].tsx` | REAL | `usePulledStore()` (`:67`), `createSampleAndInput` (`:191`) | no |
| `report/[visitId].tsx` | REAL | `usePulledStore()` (`:31`), `createCallReport` (`:83`) | no |
| `voice-note/[visitId].tsx` | REAL + device | `uploadVoiceNote` (`:248`) → `begin_upload` | no |
| `onboarding/location.tsx` | device | `PermissionsAndroid.requestMultiple` (`:50-51`) | no |
| `onboarding/location-denied.tsx` | device / static | `requestLocationPermission` (`:60`), `Linking.openSettings()` (`:69`) | no |
| `onboarding/microphone.tsx` | device | `PermissionsAndroid.request(RECORD_AUDIO)` (`:59`) | no |
| `onboarding/notifications.tsx` | device + flags | `notificationTypes({coachingEnabled, recordingEnabled})` (`:58`) | no |
| `onboarding/battery.tsx` | device / static | `detectDeviceOem()` (`:33`), `contentFor(family)` (`:34`) | no |

All line numbers are in the route file named in the row unless another file is given.

**Every screen on mock data:**

1. `app/day-end.tsx:88,93`: `listVisits()` (fixture `fx.visits`, `server.ts:238-239`) and
   `listMileage()` (fixture `fx.mileageDays`, `server.ts:313-320`). **Reachable** from Today
   (`home.tsx:229-230`) and Me (`me.tsx:46-47`).
2. `app/mileage.tsx:59-60`: `listMileage()` (`fx.mileageDays`). **Reachable** from Me
   (`me.tsx:43-44`).
3. `app/(tabs)/coaching.tsx:71,74`. **Hidden.**
4. `app/analysis/[id].tsx:71,76-80`. **Hidden.**
5. `app/reply/[analysisId].tsx:58,105-106`. **Hidden.**

**What hides them.**

- `coachingEnabled = process.env.EXPO_PUBLIC_COACHING_ENABLED === 'true'`
  (`apps/field/src/features.ts:20`).
- The tab is removed at `app/(tabs)/_layout.tsx:73`. Each route redirects to `/home` when the flag
  is off (`coaching.tsx:57`, `analysis/[id].tsx:41`, `reply/[analysisId].tsx:35`).
- The demo build script refuses to build with the flag set (`build-demo-apk.ps1:75,229`).

**Not established:**

- The exact environment of any build other than the demo APK. No `apps/field/.env*` file exists,
  so the table assumes the defaults, which leave the flag off.
- A real mileage reader exists but no route uses it: `listMileage` → `db.rpc('daily_mileage')`
  (`apps/field/src/capture/visits.ts:92-98`).

---

## 3. Shared contract

**The dependency.** `apps/field` imports `@fieldforce/core` from the workspace.

- `apps/field/package.json:22`: `"@fieldforce/core": "workspace:*"`.
- `pnpm-lock.yaml:102-104`, the `apps/field` importer: `specifier: workspace:*`,
  `version: link:../../packages/core`.
- `readlink -f apps/field/node_modules/@fieldforce/core` →
  `/c/Users/devp0/StudioProjects/Elmiron-App/packages/core`. `cmd //c dir` shows a `<JUNCTION>`.
- No alias overrides it. `apps/field/metro.config.cjs:29-33` sets only `watchFolders` and
  `nodeModulesPaths`. `apps/field/tsconfig.json` has no `paths`.
- `packages/ui/package.json:31` lists core as a devDependency only (`pnpm-lock.yaml:205-209`,
  `link:../core`). No file in `packages/ui/src` outside tests imports it.

**Duplicated schemas.**

- **Zod: none.** A grep for `from 'zod'`, `z.object(` and `z.enum(` across `apps/field/app`,
  `apps/field/src` and `packages/ui/src` found no matches.
- **Entities are imported, not redeclared.** For example `apps/field/src/capture/visits.ts:7` and
  `capture/visit.ts:1`. Request bodies use core's `Create*RequestSchema`
  (`consent/record.ts:1`, `capture/samples.ts:1`).
- **SQLSTATE map:** no local copy. `refusalForSqlState` exists only in
  `packages/core/src/shared/refusals.ts:158`.

**Near-duplicates: the same values declared locally instead of imported.**

| Local | Core equivalent |
| --- | --- |
| `apps/field/src/onboarding/permissions.ts:92` `type CheckInMethod = 'manual' \| 'automatic'` | `packages/core/src/field/entities.ts:141` `CaptureSourceSchema` |
| `packages/ui/src/SamplesScreen.tsx:47` `type SampleLineKind = 'sample' \| 'input'` | `entities.ts:206` `SampleOrInputKindSchema` |
| `packages/ui/src/ConsentScreen.tsx:64` `type ConsentAnswer = 'consented' \| 'declined'` | Deliberate subset of `packages/core/src/field/consent.ts:19` `ConsentOutcomeSchema` (core adds `not_asked`) |

**RPC and table names are hard-coded.** Core has an endpoint map
(`packages/core/src/field/endpoints.ts:690-745`) that `apps/field` never uses. The app writes the
names as literals instead:

- `sync/pull.ts:223` `'sync_pull'` (core lists pull as `/sync/pull`, `endpoints.ts:728`)
- `sync/push-client.ts:219` `'sync_push'`
- `sync/push-client.ts:321` `'begin_upload'` (no core entry)
- `today/shift-window.ts:38` `'my_shift_window'`
- `capture/visits.ts:98` `'daily_mileage'`
- `capture/recording-permission.ts:105` `'recording_permission'`
- `sync/voice-note-device.ts:35,43` `.from('audio')`, `.from('voice_notes')`

These are names, not schemas. Every response is still parsed against core types.

---

## 4. Automated checks

**What runs.** `.github/workflows/ci.yml:3-6` runs on every `pull_request` and on every `push` to
`main`. A push to another branch runs nothing until a PR is opened.

**`static` job ("typecheck · lint · format · unit tests"):**

- the `PROJECT-OVERVIEW.md` append-only guard;
- `pnpm run build`, `typecheck`, `lint` and `format:check`;
- the check that every migration has a rollback file;
- tests for core, ui-tokens, ui, mock, field and console.

**`database` job ("migrations · Gate 0 RLS suite · rollbacks"):**

- `supabase start`, which applies every migration from empty;
- lock-wait logging;
- the `@fieldforce/api` suite, with `--force`;
- `check:decision-debt`;
- `verify:rollbacks`, which executes every rollback.

**Counts from the latest green run on `main`.** That is run **36530813334** at `f2487e8`
(29 September). The counts come from `gh run view 36530813334 --log`, and are listed in the order
the CI steps run.

| Suite | Runner | Files / suites | Tests |
| --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 4 | 38 |
| `@fieldforce/ui-tokens` | vitest | 3 | 59 |
| `@fieldforce/ui` | vitest | 1 | 4 |
| `@fieldforce/ui` | jest (render) | 24 | 273 |
| `@fieldforce/mock` | vitest | 1 | 43 |
| `@fieldforce/field` | vitest | 45 | 648 |
| `@fieldforce/field` | jest (render) | 33 | 226 |
| `@fieldforce/console` | vitest | 6 | 37 |
| `@fieldforce/api` (database job) | vitest | 63 | 830 |
| **Total** | | | **2,158** |

**CI on the merged head is still running.** At the time of writing, run 36845650674 on `593e5f0`
(the PR #11 merge) had passed the static job and was still in the database job. PR #11's own head
`2195874` was green (run 36539639208).

**The previous push run on `main` failed.** Run 36528224970 at `ef4d53d` (29 September) failed,
and the next push run passed. Its cause is not established in this document.

**What CI does not cover:**

1. **jest runs as iOS only.** Both jest configs use jest-expo's default preset
   (`apps/field/jest.config.cjs:37`, `packages/ui/jest.config.cjs:39`), which takes
   `@react-native/jest-preset` with `defaultPlatform: 'ios'`
   (`node_modules/@react-native/jest-preset/jest-preset.js:17`). So `Platform.OS` is `ios` in
   every render test.
   - The Android preset does not load. FE-D3 A1 ran it once: 27 of 27 suites failed at load with
     `SyntaxError … @react-native/jest-preset/jest/setup.js: Unexpected token (31:12)`, and 0 tests
     ran (`PROJECT-OVERVIEW.md:19512-19520`).
   - Android-only branches, such as the `PermissionsAndroid` paths in onboarding, run in no test
     under Android semantics.
2. **No device or emulator tests.** No workflow builds or installs an app. A grep of
   `.github/workflows/*.yml` for `gradlew`, `assembleRelease`, `eas`, `detox` and `maestro` found
   no matches. All device checks so far were manual (`PROJECT-OVERVIEW.md` FE-D6, FE-D9, FE-D12).
3. **No Android build in CI.** Native build failures (CMake, Gradle heap, the CMake pin that
   `expo prebuild` erases) are found only by running `build-demo-apk.ps1` by hand.
4. **The clock lint covers `apps/field` only** (see §5). No test checks that the lint rules still
   fire.
5. **`pnpm ci:local` skips the database job** unless run with `--with-db` (`handoff.md`,
   "Verification commands").
6. **Production is not tested by CI.** Production is checked only by the scheduled drift,
   retention and backup workflows, which are not PR checks. The drift job accepts an undeployed
   production until 2026-10-31 (`.github/workflows/migration-drift.yml:115-117`).

---

## 5. Clock and calendar rules

**Lint rules.** All are in the root `eslint.config.mjs`. There is no other ESLint config in the
repo.

- **`noDeviceClockAsNow`** (`:148-159`) bans `new Date()` with no arguments (`:150`) and
  `Date.now()` (`:155`). Its message tells you to use `serverTime` from `usePulledStore()` for a
  decision. A device-time record is allowed only with a named disable comment.
- **`noLocalCalendarReads`** (`:128-146`) bans:
  - the local getters `getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours` and the rest (`:131`);
  - `toDateString`, `toTimeString` and `toLocale*String` (`:137`);
  - `new Date(y, m, d)` (`:142`).

  `getUTC*` and `new Date(iso)` are allowed.
- **Where they apply:**
  - `apps/field/**/*.ts(x)` (`:242-251`);
  - `apps/field/app/**` again (`:278-334`), which adds `.slice(11,16)` and bans importing the
    slice-based helpers `clockFrom`, `clockFromOrNull` and `dayMonthFrom` on screens;
  - tests (`:349-361`), which drop the device-clock ban but keep the calendar bans.
- **Not covered:** no block targets `packages/ui`, `packages/core` or `apps/console`. A grep found
  no violations there today, but nothing would stop one.

**Server-time helpers (`apps/field`).**

- `src/today/territory-day.ts`:
  - `partsIn` uses `Intl.DateTimeFormat('en-GB', {timeZone})` (`:79-92`);
  - `dayIn`, `dayMonthIn` and `clockIn` (`:102,149,176`);
  - `territoryToday(serverTime, zone)` (`:189`) takes `serverTime` as a required argument;
  - the UTC fallback is at `:65`, and the user is told about it through `zoneCaveat` (`:208`).
- `src/today/server-window.ts`: `monthIn`, `monthWindowIn` and `recentMonthsIn` (`:20,31,52`).
- `src/today/day-anchor.ts:85`: `resolveAnchoredDay` handles an offline cold start as the last
  server time plus elapsed device time.
- `src/sync/pulled-store.tsx:192,358-359` keeps `serverTime` from each pull.
- `src/today/shift-window.ts:38-61` takes the territory zone from `my_shift_window`.
- `packages/core` defines only the wire field `serverTime` (`endpoints.ts:469,608`). It has no zone
  helpers.

**The one-day-rule migration** (`services/api/supabase/migrations/20260921000200_one_day_rule.sql`):

- `day_zone_for(mr)` (`:48-79`) takes the zone from the MR's territory, falling back to UTC.
- `visit_day(visit)` (`:81-91`) is the visit's date in that zone.
- `coverage()` counts by it (`:98-151`).
- `sync_pull` sends `visit_day` (`:246`) and `serverTime` (`:359`).
- A self-check block (`:405-425`) fails the migration if `coverage` still names Kolkata or
  `sync_pull` stops sending `visit_day`.
- The client uses `visitDay` (`packages/core/src/field/entities.ts:128`) at:
  - `today/beat-plan-view.ts:136`;
  - `today/plan.ts:116`;
  - `capture/samples.ts:139-140`.

**Timezone in `packages/ui`.** None. A grep found no `timeZone` or `Intl.DateTimeFormat`. It
receives formatted strings through props.

**Automated or convention?**

- **`apps/field`: automated.** `ci.yml:79` runs `pnpm run lint` on every PR. `apps/field`'s lint
  is `eslint app src` (`apps/field/package.json:13`).
- **`packages/ui`, `packages/core` and `apps/console`: convention only.** They are linted, but no
  clock rule applies to them.
- **No test checks that the rules still fire.** A grep for `new ESLint`, `lintText` and
  `from 'eslint'` outside `node_modules` found no matches.
- **Allowlisted exceptions.** There are 9 `eslint-disable … no-restricted-syntax` sites for the
  clock rule, each a device-time record or an elapsed duration:
  - `consent/[visitId].tsx:235`
  - `onboarding/microphone.tsx:52`
  - `samples/[visitId].tsx:175`
  - `transparency.tsx:79`
  - `visit/[id].tsx:273`
  - `voice-note/[visitId].tsx:213`
  - `sync/outbox.ts:127`
  - `sync/pulled-store.tsx:263,368`

  Nothing enforces the named reason that `eslint.config.mjs:89-90` asks for.
- **Five `no-restricted-imports` disables** re-enable the slice helpers on the mock-backed screens:
  `coaching.tsx:25,32`, `analysis/[id].tsx:18`, `day-end.tsx:19`, `mileage.tsx:14`.
- **One use the screen-level rule does not cover:** `src/capture/samples.ts:140` uses
  `dayMonthFrom` in `src/`, outside the `app/**` ban.

---

## 6. Voice-note deletion

**Jobs that delete data.**

| Job | Schedule | Deletes voice notes? |
| --- | --- | --- |
| `.github/workflows/retention.yml` ("Audio retention") | `cron: '0 * * * *'` (`:46`) | **Yes.** Runs `purge:audio` (`:125`) → `services/api/scripts/purge-expired-audio.mjs` |
| `.github/workflows/retention-watchdog.yml` | `'15 * * * *'` | No. Reads purge health only |
| `.github/workflows/migration-drift.yml` | `'40 6 * * *'` | No |
| `.github/workflows/backup.yml` | `'25 2 * * 1'` | No. Drops only its own scratch restore database |
| pg_cron | — | None. `cron.schedule` appears in no migration. `retention.yml:7-25` says it was deliberately not used |
| Edge functions | — | None on `main`. `services/api/supabase/functions` does not exist there |

**What the purge does to a voice note.**

1. **The clock is stamped on insert.** `stamp_audio_retention` sets
   `purge_after := received_at + interval '90 days'`
   (`20260815000300_audio_consent_retention.sql:196-197`). The `voice_notes_stamp_retention`
   trigger attaches it (`:206-208`).
2. **Expired notes are claimed.** `claim_expired_audio` selects `voice_notes` where
   `purge_state <> 'destroyed' and purge_after <= now()`
   (`20260816000300_resumable_upload.sql:800-812`).
3. **The stored audio is deleted.** `purge-expired-audio.mjs:105-107` calls `deleteObject(…)`,
   which sends `DELETE /storage/v1/object/audio/<key>` (`services/api/scripts/storage.mjs:47-66`).
4. **The row is kept and marked destroyed.** `confirm_audio_destroyed`
   (`resumable_upload.sql:945-950`) sets `purge_state = 'destroyed'`, `storage_key = null` and
   `upload_status = 'purged'`. It also deletes the note's transcripts (`:933-943`) and writes an
   `audio_destruction_log` row (`:952-956`).

So the code deletes the **audio file**, not the **row**. The row stays as a tombstone.

**Would a voice note stored in production today be deleted after 90 days? Not established.**

**For yes:**

- Everything above is in the first 19 migrations. `ls migrations | sed -n 19p` →
  `20260817000200_purge_backlog_stall_detection.sql`.
- Production has applied exactly those 19. The drift run of 30 September
  (`gh run view 36718280007 --log`) reported `"appliedVersions": 19` against the production pooler.
- The workflow's secrets exist: `gh api …/actions/secrets` returned `SUPABASE_DB_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL`.
- Its recent runs succeed. `gh run list --workflow retention.yml` → 36827155291 (1 October 06:52),
  36795869753 and 36773572791 are all `success`.

**Against, or unproven:**

1. **It has never destroyed anything in production.** The latest run logs
   `claimed 0, destroyed 0` and `"liveObjectCount": 0`. The storage delete against production has
   never run (`PROJECT-OVERVIEW.md:2008-2011`: the dispatch "proves the wiring, not the retention
   path").
2. **The app cannot store a voice note in production today.** Voice notes go through `sync_push`,
   and `handoff.md:162` records that the `sync_pull`/`sync_push` layer is not on production.
3. **The schedule runs less often than designed.** The last three runs are 3.8 and 6.5 hours
   apart, not hourly. This is GitHub's scheduler, not the workflow file.
4. **The retention log does not print its target host.** "Production" is inferred from the shared
   `SUPABASE_DB_URL` secret, which the drift job resolves to the production pooler.

**Copy.** The answer is "not established", so no copy was changed. For the record, the copy that
makes a deletion claim about audio:

- `apps/field/src/transparency/content.ts:48`: voice notes "Marked for deletion 90 days after they
  reach your company." This is accurate. The test `content.test.ts:77-80` pins it.
- `apps/field/src/consent/content.ts:91,95,99,121`: recordings "… then deleted" and "kept 90 days,
  then deleted". This is the same unbacked claim FE-D12 noted.
- `apps/field/src/coaching/content.ts:32`: "audio deleted at 90 days · transcript kept". This is
  hidden in this build. "Transcript kept" also contradicts `confirm_audio_destroyed`, which deletes
  the transcripts.

This is raised as **FE-CR-5** in `docs/contract-requests.md`.

---

## 7. Identifier prefixes

- `docs/contract-requests.md`: CR-1 to CR-4 are now headed FE-CR-1 to FE-CR-4, each with
  "(was CR-n)", so references in `PROJECT-OVERVIEW.md` still resolve.
- Only the four heading lines changed, plus a dated note under the file's header explaining the
  change. That file describes itself as append-only. The rename was made on the operator's
  instruction.
- **FE-CR-5** was appended: whether the voice-note retention promise is kept in production.
- No backend-owned file was edited.

---

## Coaching readiness (FE-D16)

**Paste-ready answer:**

1. **None of the three screens (Coaching, Analysis, Reply) will work the day the AWS key lands, and the key alone changes nothing.** Nothing on `main` or on the AI branch writes an analysis, and findings are hard-coded empty. All three are now wired to the real functions on `main`, still hidden behind the flag (FE-D16).
2. **The backend needs to answer three contract questions first:**
   - **FE-CR-8:** what writes analyses and their findings;
   - **FE-CR-9:** whether opening an analysis is recorded, which is what backs "you see it first";
   - **FE-CR-10:** whether a reply should be queued offline, and the shape `respond_to_analysis` returns.
3. **Turning the flag on also needs:**
   - the **AWS key** (C-1);
   - **consultation recording switched on**: the build flag `EXPO_PUBLIC_RECORDING_ENABLED` and the server's `recording_permission`;
   - **a decision on who may see a rep's analysis** (§3.6). Until then, the feed's "You're seeing this before your manager acts on it" (`apps/field/src/coaching/content.ts`, `SEEN_FIRST`) is not backed by the server.

### Audit

| | Coaching tab (D1) | Analysis (D2) | Reply (D3) |
| --- | --- | --- | --- |
| Route → component | `app/(tabs)/coaching.tsx` → `CoachingFeedScreen` | `app/analysis/[id].tsx` → `AnalysisScreen` | `app/reply/[analysisId].tsx` → `AnalysisReplyScreen` |
| Data **before** FE-D16 | **Mock**: `listAnalyses`, `listVisits`, `listDoctors` through `createClientForScenario()` (`coaching.tsx:71-74` at `fe-d14-screens`) | **Mock**: `getAnalysis`, `listVisits`, `listDoctors`, `listConsentRecords` (`[id].tsx:70-81`) | **Mock**: `getAnalysis` (`:57-58`), and `respondToAnalysis` sent directly (`:105-106`) |
| Real function | `list_analyses`, latest at `20260923000100_console_reads_contract_shape.sql:103` (**on `main`**) | `read_analysis` (`…:31`) and `list_consent_records` (`…:144`) (**on `main`**) | `respond_to_analysis`, `20260811000300_audit_log.sql:461` (**on `main`**, never redefined) |
| MR may call it | Yes. Granted to authenticated (`20260811000400_rls_policies.sql:319`); scoped by `visible_user_ids()` (`…:137`), which for an MR is themselves (`20260908000900_organisation_scoping.sql:271-273`); no reason needed (`:122`) | Yes (`rls_policies.sql:318, 347`). Out of scope returns `data: null` (`…:68`) | Yes (`rls_policies.sql:320`). Only the caller's own analysis (`audit_log.sql:488-489`), else `42501` |
| Matches the schema in `packages/core` | Yes: `ListAnalysesPageSchema` (`endpoints.ts:354`). **But `findings` is always `[]`** (`…console_reads_contract_shape.sql:92`) | Yes: `ReadAnalysisResponseSchema` and `ListConsentRecordsPageSchema`. Same empty findings | **No**: it returns a raw snake_case row (`audit_log.sql:496`), not `AnalysisSchema`. FE-D16 does not read the return |
| States before | loading, failure, denial, empty | loading, failure, denial, refused/pending/failed | load failure, send failure, empty-reply guard |
| States missing (all **added in FE-D16**) | not available (recording off); the AI-written label on rows | not found (`data: null`); completed with no findings; AI provenance without unbacked "who saw it" claims | honest offline: "cannot be queued, not saved" |
| Design | `docs/design/phase4-coaching-and-console.dc.html` D1 FEED (`:60`) | D2 ANALYSIS (`:105`) | D3 REPLY (`:141`) |
| Classification | **NEEDS WIRING** (done) + **NEEDS CONTRACT** (FE-CR-8) | **NEEDS WIRING** (done) + **NEEDS CONTRACT** (FE-CR-8, FE-CR-9) | **NEEDS WIRING** (done; direct, not queued) + **NEEDS CONTRACT** to queue (FE-CR-10) |

**Nothing is READY.**

- **No analysis can exist on `main`.** The only rows ever inserted are test fixtures
  (`services/api/tests/fixtures.ts:514-517`).
- **The AI branch's coach writes elsewhere.** It writes `sim_coach_analyses`, for practice
  sessions (`20261001000100_coach_nine_dimensions.sql:259`), not analyses of real visits.
- **No local analysis can be shown without faking one.** A local stack can produce an analysis only
  by a direct SQL insert, which would be faking one, so none was made.

**Reply is not queued, and cannot be without a backend contract.**

- **No sync entity exists for a reply.** `packages/core/src/field/sync.ts:12-21` has none, and
  neither does the database enum (`20260813000200_offline_sync.sql:48-57`).
- **So a reply has no idempotency key** to give it.
- **The route's existing design also argues against queueing**
  (`app/reply/[analysisId].tsx:23-27`): a half-written argument should not land in a manager's
  queue when signal returns.
- **FE-CR-10 asks.**
