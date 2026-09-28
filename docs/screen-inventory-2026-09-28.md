# MR app screen inventory — 28 September 2026

**Status: accepted 28 September 2026.** Q1–Q3 were ruled the same day; the rulings and the amended
build order are in `PROJECT-OVERVIEW.md` → FE-D2. Read-only survey of `apps/field` at `5313513`
(plus FE-D1, which changes no screen). Every claim cites a `file:line`. Items **c** and **d** were
gathered by two read-only survey agents and then spot-checked by hand. The claims checked, all of
which held: `queue.tsx:37`, `DayEndScreen.tsx:161-163`, `AnalysisReplyScreen.tsx:66` together with
`reply/[analysisId].tsx:97-102`, `config.ts:42`, and the existence of every real function named in
**d**. Anything not checked by hand is marked *(survey)*.

Design codes are those printed in `docs/design/*.dc.html`: A = first run, B = the day,
C = support screens, S = states, D = consent / coaching, E = console.

---

## a. Routes, what they render, and whether a rep can reach them

The entry point is `index.tsx`. Signed out it goes to `/sign-in`; first run goes to
`/onboarding/notifications`; after that, `/home` (`index.tsx:37-49`). There are four tabs (`(tabs)/_layout.tsx:23-47`): Today,
Doctors, Coaching, Me.

| Route | Renders | Reached from | Reachable? |
| --- | --- | --- | --- |
| `sign-in` | A1 sign in | `index` redirect, `auth-gate.tsx:57` | yes |
| `onboarding/notifications` | A3 | first run (`index.tsx:49`) | yes, first run only |
| `onboarding/battery` | A5–A8, one route with OEM content | notifications `:33`; Me `me.tsx:50` | yes |
| `onboarding/location` | A2 | **Me only** (`me.tsx:56`) | yes, but **not part of first run** (see finding 3) |
| `onboarding/microphone` | A4 | **nothing** | **NO. Finding 1** |
| `onboarding/location-denied` | S4 | **nothing** | **NO. Finding 2** |
| `transparency` | A9 / C3 | battery `:119`, location `:66`, home `:221`, Me `:53`, day-end `:138` | yes |
| `(tabs)/home` | B1 / B2 | tab | yes |
| `(tabs)/doctors` | B8 | tab; home `:224` | yes |
| `doctor/[id]` | B9 | doctors `:135`, beat-plan `:115` | yes |
| `beat-plan` | B3 | home `:227` ("See today's route") | yes |
| `visit/[id]` | B5 | **home "start next visit" only** (`home.tsx:236`), plus the return from consent (`consent:302`) | **only the one "next" visit. Finding 4** |
| `consent/[visitId]` | D1–D5 | visit `:505` | yes, via a visit |
| `voice-note/[visitId]` | B6 / D7 | visit `:523` | yes, via a visit |
| `samples/[visitId]` | C5 | visit `:544` | yes, via a visit |
| `report/[visitId]` | C6 | visit `:547` | yes, via a visit |
| `queue` | C1 | home `:218`, day-end `:135` | yes |
| `day-end` | B7 | home `:230`, Me `:47` | yes |
| `mileage` | C2 | Me `:44` | yes |
| `(tabs)/me` | C4 | tab | yes |
| `(tabs)/coaching` | D1 (phase 4) | tab | yes |
| `analysis/[id]` | D2 | coaching `:134`, reply `:94` | yes |
| `reply/[analysisId]` | D3 | coaching `:137`, analysis `:166` | yes |

**Finding 1: `onboarding/microphone` (A4) is unreachable.** Its header says it "is reached from a
visit that has already started" (`microphone.tsx`, doc comment). No code navigates there. Microphone
permission is requested inline instead (`visit/[id].tsx:229`, `voice-note/[visitId].tsx:139`), so
the rationale screen the design puts in front of the prompt is never shown.

**Finding 2: `onboarding/location-denied` (S4) is unreachable.** Its header says "the MR arrives
because they went looking for it". Nothing links to it, so there is nowhere to go looking from.

**Finding 3: first run skips A2.** The design's order is A1 sign in → A2 location → A3
notifications. The code goes sign in → notifications → battery → transparency → home. Location is
reached only from Me. I haven't found a comment saying the omission is deliberate. **Question for
you.**

**Finding 4: a rep can open only the "next" visit.** `visit/[id]` is pushed from exactly one
place: home's `onStartNextVisit`, for the single visit `summariseDay` picks (`today/plan.ts`,
`nextVisitFrom`). Beat plan (`beat-plan.tsx:115`) and doctor profile open the **doctor**, and the
doctor profile has no visit action. A rep who wants to see doctors out of order has no path to
check in anywhere else. B3 in the design shows the stops but not what tapping one does. **Question
for you** (see "Questions" at the end).

**Finding 5: the notifications buttons do nothing.** "Allow notifications" and "Not now" both call
`next`, which only navigates (`notifications.tsx:33, 50-51`). No permission is requested, and
`expo-notifications` is not a dependency. Its header says "the app has no behaviour that depends on
this being granted", which is true, but the button label promises something it doesn't do. It also
says "`docs/design/` is not in this repository", which is **stale**: the designs have been tracked
since `bc289f8` (1 September).

## b. The four phase design files

**Present and tracked.** `docs/design/phase1-tokens-and-components.dc.html`,
`phase2-first-run-and-the-day.dc.html`, `phase3-consent-handoff.dc.html`,
`phase4-coaching-and-console.dc.html`. All were last changed in `bc289f8` (2026-09-01). Phase 2
announces "Twenty-eight screens" and lists 28 codes: A1–A9, B1–B9, C1–C6, S1–S4.

## c. Loading, error and empty states *(survey, spot-checked)*

Common pattern: every `packages/ui` screen returns early with a critical `Banner` when `failure` is
set, so errors never render on top of content. Spinners don't block the rest of the screen.

| Route | Loading | Error | Empty | Collapsed? |
| --- | --- | --- | --- | --- |
| home | yes (`TodayScreen.tsx:205`) | yes (`:188`). Stale-but-cached is suppressed on purpose (`home.tsx:176-181`) | yes, three distinct messages (`TodayScreen.tsx:219-255`) | no |
| doctors | yes (`DoctorListScreen.tsx:165`) | yes, denied vs unreachable (`doctors.tsx:73-89`) | yes, three messages | no |
| coaching | yes (`CoachingFeedScreen.tsx:140`) | yes (`:115`) | yes (`:142`) | no |
| mileage | spinner (`MileageScreen.tsx:74`) | yes (`:61`) | yes (`:91`) | partly: total reads "0.0 km" while loading (`mileage.tsx:95`) |
| **queue** | **none**: starts as `emptyQueue` (`queue.tsx:37`) ✔ checked | unreadable → banner | "Everything is sent" | **yes**: shows "Everything is sent" before the disk read resolves, on the screen a rep opens when they suspect a problem ✔ |
| **day-end** | spinner, with zero figures rendered under it | only denial or no server clock (`day-end.tsx:77-102`); other errors swallowed (`:103`), mileage failure `.catch(() => null)` (`:91`) | none | **yes**: failed, empty and loading all show zero counts, and 0 of 0 reads **"you went to all of them"** (`DayEndScreen.tsx:161-163`) ✔ |
| **doctor/[id]** | spinner (`DoctorProfileScreen.tsx:89`) | yes (`:79`), not-found separate | "You have not visited this doctor yet" | **yes**: that sentence shows during loading, and when the server clock is null (`doctor/[id].tsx:100-101`) |
| **beat-plan** | yes (`BeatPlanScreen.tsx:120`) | only when there's no plan | yes (`:122-126`) | **yes**: a failed pull with a plan and no stops reads "still syncing" (`beat-plan-view.ts:152`) |
| **consent** | yes (`ConsentScreen.tsx:255`) | through `blocked` | through `blocked` | error and "no notice" share one banner, differing only in wording (`:270`) |
| **analysis/[id]** | yes (`AnalysisScreen.tsx:134`) | yes (`:115`) | **none**: no findings renders only a header; uncited findings are dropped silently (`analysis/[id].tsx:139`) | empty looks like a finished load |
| **reply/[analysisId]** | **none** | load failure (`AnalysisReplyScreen.tsx:66`) | n/a | **yes**: a SEND failure goes down the same channel, replaces the form, and says "What you wrote is still on the screen" when it isn't; never reset ✔ |
| **visit / samples / voice-note** | spinner / none | early return (`VisitScreen.tsx:193`, `SamplesScreen.tsx:144`, `VoiceNoteScreen.tsx:101`) | n/a | **write errors replace the whole screen and `setFailure(null)` is never called** (`visit:243,386,412`; `samples:141-142`) |
| report/[visitId] | none | read errors swallowed into the placeholder "This visit" (`report:54-57`); write errors banner | n/a | read loading = read error |
| index | spinner (`index.tsx:22-34`) | **none**: no `.catch` on `hasCompletedFirstRun` (`:19`) | n/a | a failed disk read leaves the spinner up forever |
| transparency | none | no catch (`:34`) | n/a | static |
| sign-in, onboarding/* | busy label / n/a | banners where relevant | n/a | static, N/A |

## d. Real endpoint or mock-only *(survey; function existence checked by hand)*

**Real** means Supabase (`createPushClient`, `pullOnce`, `supabase`). **Mock** means
`createClientForScenario`, which sends to `apiBaseUrl`, and that **defaults to
`http://127.0.0.1:4010`** (`config.ts:42`) ✔.

| Route | Operation | Target |
| --- | --- | --- |
| home, doctors, doctor/[id], beat-plan, and every screen's store reads | pull | **real**: `sync_pull` (`20260908000300_sync_pull_phase2.sql`), `my_shift_window` (`20260815000100_…`) |
| visit | check-in / check-out | **real**: `sync_push` |
| visit | recording permission / upload | **real**: `recording_permission` (`20260923000400_…`), `begin_upload`, bucket `audio`, `sync_push` |
| voice-note | upload, `voice_notes.received_at` | **real** |
| consent, samples, report | writes | **real**: `sync_push` |
| queue | flush | **real** |
| sign-in | password | **real**: Supabase Auth |
| **report** | reads visits, doctors (labels) | **MOCK-ONLY.** The same data is already in the pulled store |
| **day-end** | reads visits, mileage | **MOCK-ONLY.** Real: pulled store + `daily_mileage` ✔ |
| **mileage** | monthly mileage | **MOCK-ONLY.** Real: `daily_mileage` ✔ |
| **coaching** | analyses, visits, doctors | **MOCK-ONLY.** Real: `list_analyses` ✔ |
| **analysis/[id]** | analysis, visits, doctors, consent records | **MOCK-ONLY.** Real: `read_analysis` ✔, `list_consent_records` ✔ |
| **reply/[analysisId]** | read analysis; **write** reply | **MOCK-ONLY.** Real: `read_analysis`, `respond_to_analysis` ✔ |

Every mock-only operation has a real function already in migrations, so **no screen needs a new
backend endpoint.** What isn't established from the tree is whether an **MR** is allowed to call
each of those, and whether each response parses against the `packages/core` schema the screen uses.
Filed as **CR-3**. The frontend's own dead code: `src/capture/visits.ts:44,78,98` already wraps
`.from('visits')` and `rpc('daily_mileage')`, and nothing outside tests imports it *(survey)*.

## e. Production code pinned to a demo or fixture

1. **`src/config.ts:42`, `apiBaseUrl ?? 'http://127.0.0.1:4010'`** ✔. This is the one that
   matters. In a release APK with the env var unset, `127.0.0.1` is the phone itself, so **six
   screens (report's labels, day-end, mileage, coaching, analysis, reply) fail on every real
   device.** Unlike the Supabase config, nothing refuses an unset value. `api.ts:25-28` also sends the
   rep's Supabase access token to whatever that URL is *(survey)*.
2. No scenario name is hard-coded. Every production call to `createClientForScenario()` passes no
   argument *(survey)*.
3. `onboarding/location-denied.tsx:46-54` ships design-estimate figures ("14 minutes", "₹600")
   that its own comment calls unmeasured. It's static copy in an unreachable screen.
4. Recording is dev-only by design: `EXPO_PUBLIC_RECORDING_ENABLED` is refused unless Supabase is
   local (`packages/core/src/shared/config.ts:80-84`) *(survey)*. Deliberate, not a pin.

## f. Design screens with no route

| Code | Screen | Why |
| --- | --- | --- |
| **B4** | Arrival prompt, "geofence fired" | needs background location, which is out of scope. `onboarding/location.tsx` says `fe-w3-spec.md` §4a settled "discrete fixes only" |
| **C4, partly** | Settings · data & language | the route exists (`me.tsx` → `SettingsScreen`), but WiFi-only, 100 MB warning, app language and consent language are all `state: 'not-yet'` (`src/settings/content.ts:56-90`) |
| **B3, partly** | "Open in Maps", "Reorder", "Best window", "go before Shah?" | no map by decision (`BeatPlanScreen.tsx:18`). The suggestions are ranking, which is out of scope |
| **S1–S4** | states | S1–S3 are states inside screens (see **c**). S4 is a route, but unreachable (finding 2) |
| E1–E3 | console | web, out of scope |

Every other code (A1–A9, B1–B3, B5–B9, C1–C3, C5–C6, D1–D7 of phase 3, D1–D3 of phase 4) has a
route.

## g. Chatbot, maps, live location, voice (report only)

- **Chatbot:** none. No route, component or string anywhere in `apps/field` or `packages/ui`.
- **Maps:** none, by decision (`BeatPlanScreen.tsx:18`, "There is no map"). The "route" is the
  beat-plan list.
- **Live location:** none. Every `watchPosition` / `TaskManager` / geofence hit is a comment.
  `takeFix` runs only on a button press (`capture/location.ts:66`).
- **Voice:** the voice-note screen (`voice-note/[visitId].tsx`, D7), and consultation recording on
  the visit screen (D6), which sits behind two off-by-default switches: `EXPO_PUBLIC_RECORDING_ENABLED`
  (`recording-permission.ts:97`) and the server's `recording_permission`. There is no
  transcription UI.

---

## Proposed build order, Tuesday 29 September to Thursday 1 October

Frontend-only. Anything backend is in `docs/contract-requests.md`, not here.

**Tuesday: what a rep uses every day**

1. **Open any of today's visits, not only the "next" one** (finding 4). It's the one daily path
   that's missing. *Blocked on your answer to Q1.*
2. **Report and day-end read from the pulled store instead of the mock.** Both are daily. The data
   is already on the phone, so there's no endpoint question.
3. **Day-end mileage and the mileage screen use `daily_mileage`.** It's the real function, and
   `capture/visits.ts` already wraps it. *Blocked on CR-3's answer for `daily_mileage`.*
4. **`apiBaseUrl` refuses an unset value in a release build, the way the Supabase config does.**
   This is frontend config (`apps/field/src/config.ts`). It turns six silent failures into one loud
   one. *Q3 decides whether this is in scope.*

**Wednesday: loading, error and empty states, daily screens first**

5. **Visit / samples / voice-note: a write error clears and gives the screen back.** Daily, and
   the rep is currently left staring at a banner.
6. **Queue: a real loading state.** Today it says "Everything is sent" before it knows, which is
   the worst possible wrong answer on that screen.
7. **Day-end: loading, failed and empty become three states.** "You went to all of them" must not
   appear for 0 of 0.
8. **Beat-plan "failed" vs "syncing", doctor profile's "not visited yet" while loading, mileage
   "0.0 km" while loading.** Smaller, same class.
9. **`index` spinner forever on a failed disk read.** It's first thing on launch, so rare but
   total.

**Thursday: reachability, weekly screens, polish**

10. **Wire A4 (microphone) before the first inline prompt, and give S4 (location-denied) an
    entry point.** Both screens are built and nothing reaches them. *Q2 decides whether A2 also
    joins first run.*
11. **Coaching / analysis / reply onto the real functions**, plus reply's send-failure channel
    and analysis's missing empty state. These are weekly rather than daily. *Blocked on CR-3.*
12. **Polish against phase 1 tokens.** Only what's left.

**Not on the list, written down:** notifications permission (needs `expo-notifications`, a new
dependency); C4's not-yet rows (each is a feature); B4, maps, chatbot, live location (out of
scope); the `packages/ui` jest 5000 ms timeout under load (field raised it to 20 000 in MR-22 A2;
`ui` didn't); `visit-route.test.tsx`'s location mock missing `capturedAt`; the stale "not in this
repository" line in `notifications.tsx`.

## Questions: the build waits on these

- **Q1.** How should a rep open a visit other than the "next" one: tap a stop on the beat plan, a
  visit row on the doctor profile, or both? B3 doesn't show it.
- **Q2.** Is A2 (location) meant to be in first run, as the design orders it, or is Me-only
  deliberate?
- **Q3.** Is hardening `apiBaseUrl` for release builds in this week's scope, or config work for
  later?
