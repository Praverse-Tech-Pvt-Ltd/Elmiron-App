# Frontend gap map — 1 October 2026 (FE-D15)

Every line of the **Dev – Frontend** section of the operator's start-of-week message
(`docs/direction-2026-09-28.md`), mapped against the code on branch `fe-d14-screens`.

**Statuses:**

- **done**: built, tested and reachable;
- **partial**: some of it is built, and the line says which part;
- **not started**: nothing is built;
- **blocked**: it cannot start or finish until the named item arrives.

**Blocker codes are from the 1 October decision set:**

- **A-1** background location library choice;
- **C-1** AWS key;
- **C-2** Google Maps key;
- **C-3** Firebase;
- **D-3** tracking privacy notice.

Each blocker row names its owner.

**This week's frontend commits, all on `fe-d14-screens`:**

| Commit | What |
| --- | --- |
| `6fb2f15` | Mileage reads the real server (`daily_mileage`) instead of the mock |
| `e58ac35` | Day end reads the real server: visits from the pull, distance from `daily_mileage`, times in the territory zone |
| `e5fdfcd` | The AI-limit warning (`AiAllowanceNotice`), plus FE-CR-6 |
| `4fa8c5f` | FE-CR-7, the chat contract on `main` |
| `ebbce78` | Assistant logic: the request carries only the typed text, plus the outcome mapper and the sample fixture |
| `06dda1d` | `AssistantScreen`, with eight distinct states |
| `74b0010` | The assistant route, reachable from Me, behind `EXPO_PUBLIC_ASSISTANT_SAMPLE` (off by default) |
| `a0e91df` | This message, saved verbatim |

---

## The Dev section, line by line

| Line in the message | Status | Evidence | Blocker and owner |
| --- | --- | --- | --- |
| All remaining screens | **partial** | 26 routes in `apps/field/app` (FE-D13 §2). Every design code except B4 has a route (`docs/screen-inventory-2026-09-28.md` §f). New this week: `app/assistant.tsx` (`74b0010`). Still to build: see "Six screens" below | Maps and tracking screens: **C-2** (operator), **A-1**, **D-3** (operator). AI screens on real data: **C-1** (operator) and FE-CR-7 (backend) |
| Complete navigation | **partial** | Tab bar Today / Doctors / Me (`app/(tabs)/_layout.tsx`). Day end and Mileage are reachable from Today and Me (`home.tsx:229-230`, `me.tsx`). The assistant is reachable from Me when its flag is on (`assistant-nav.test.tsx`). Coaching is hidden by decision (`app/(tabs)/_layout.tsx:73`). There is no in-app way to reach S4 (location off), as the screen inventory recorded (finding 2) | — |
| Chatbot UI | **done (sample data)** | `packages/ui/src/AssistantScreen.tsx` (`06dda1d`). Its states are empty, sending, answer, refusal, "not available yet", warning, at-limit, offline, and error with retry (`AssistantScreen.test.tsx`, 13/13). There is no chatbot design in `docs/design/`, so it uses existing components and tokens only | — |
| Chatbot answer flow | **blocked** | Built against the branch contract and running on a labelled sample fixture (`apps/field/src/assistant/*`, `ebbce78`, `74b0010`). It sends only what the rep typed (`assistant-route.test.tsx`). It does not call the real gateway yet | **FE-CR-7** (backend: the contract on `main`). **C-1** (operator: AWS key; until then every answer is a stub). On a local stack the stub returns `out_of_scope` for every question (`stub-provider.ts:120-125` on the AI branch) |
| Loading/error/empty states | **partial** | FE-D2 and FE-D3: unknown values are shown as "not available", never as zero. Day end and Mileage were re-done on real data this week, each state tested (`day-end-route.test.tsx` 11/11, `mileage-route.test.tsx` 8/8). The assistant has every state (`06dda1d`). Not audited: Coaching, Analysis and Reply (hidden, still on the mock) | — |
| Maps and live tracking UI | **blocked** | Nothing built. There is a recorded design decision against it: `packages/ui/src/BeatPlanScreen.tsx:18`, "There is no map". The operator's message now asks for it. See "Maps plan" below | **C-2** Google Maps key (operator). A map library is a dependency and needs approval (operator). Live tracking: **A-1** library choice and **D-3** privacy notice (operator), plus the Play background-location policy finding (`docs/4-OCTOBER.md` row 6 on the AI branch) |
| Animations | **partial** | Pressed states from the design (`1022425`, FE-D7 2). One screen transition everywhere, off when "Remove animations" is on (`5c975a6`, `app/_layout.tsx:132-138`). Nothing else animates: no list or state-change animation exists in `packages/ui` (a grep for `Animated`, `LayoutAnimation` and `reanimated` finds none) | — |
| Transitions | **done** | `slide_from_right` on every stack screen, or none with reduce motion (`app/_layout.tsx:138`, `transitions.test.tsx`, `5c975a6`) | — |
| Responsiveness | **partial** | Only `BottomSheet` and `Toast` read the window size (`BottomSheet.tsx:64`, `Toast.tsx:83`). Screens scroll (`Screen scrollable`). No test runs a small screen, a tablet or a large font scale. No device other than the Pixel_10 emulator has been used | A real handset of each make the reps carry (operator) |
| Smoothness | **not started** | No frame-rate or start-up measurement exists in the repo or in any FE-D session. The only measurements are suite timings | A real mid-range handset (operator) |
| Proper API integration with Maanav's backend | **partial** | Real: sign-in, `sync_pull`, `sync_push`, `begin_upload`, `my_shift_window`, `recording_permission`, and, this week, `daily_mileage` on Day end and Mileage (`6fb2f15`, `e58ac35`). No reachable screen reads the mock now. Not yet: the AI gateway (FE-CR-7). Coaching, Analysis and Reply still read the mock (hidden) | **FE-CR-7** (backend). **C-1** (operator) |
| Voice-related UI wherever required | **partial** | The voice note screen (`app/voice-note/[visitId].tsx`, D7) and consultation recording, which is off by two switches (`recording-permission.ts:97`). No voice practice or voice modulation UI exists | **C-1** (operator), and a speech vendor (`docs/4-OCTOBER.md` row 8 on the AI branch, backend) |
| Overall visual consistency | **partial** | Polish audit against `docs/design` (`71b13e3`, FE-D7). Final visual pass with fixes V1–V5 (`5ae5b40`…`9f44211`, FE-D12). Seven demo-visible items were skipped (S1–S7) and eleven were minor (`docs/final-visual-pass-2026-09-30.md`). The new assistant screen has no design to check against | — |
| Final user experience polishing | **partial** | The FE-D7 and FE-D12 passes, above. Open: S7 (a finished visit shows no check-out time) and the "Your list has been rebuilt" banner on a first pull (FE-D12 §4) | Product decision on the banner (operator) |

---

## Six screens

**The source message names no "six screens".** It says "All remaining screens", plus the feature
list above. The "six" in `BE-C48` (`.ai-collab/decisions-backend.md:489` on the AI branch) maps to
no written list, as backend also recorded (`docs/log/backend.md:2096` on that branch).

**The concrete remaining screens,** derived from `docs/design/` and the message's feature list:

| # | Screen | Source | Can start now? |
| --- | --- | --- | --- |
| 1 | **Assistant on real data** | Message: "Chatbot answer flow" | The screen exists. Needs FE-CR-7 (backend) and C-1 (operator) |
| 2 | **Beat-plan map** (B3's "Open in Maps") | Message: "Maps". `phase2-first-run-and-the-day.dc.html` B3 | Needs C-2 and dependency approval. See the plan below |
| 3 | **Live-tracking status / consent** | Message: "live tracking UI" | Needs A-1 and D-3 |
| 4 | **B4 arrival prompt** ("geofence fired") | `phase2` B4. The only design code with no route | Needs background location: A-1 and D-3 |
| 5 | **Voice practice** (AI Doctor) | Message: "Voice-related UI" | Needs C-1 and backend voice |
| 6 | **C4 settings: data and language** | `phase2` C4. The rows exist but are "not yet" (`src/settings/content.ts`) | Needs upload-size and language support. Frontend only for the rows; language needs translations |
| 7 | **Notifications** (what A3 promises) | Message: "Notifications and other app functions" | Needs C-3 Firebase |
| 8 | **Coaching, Analysis, Reply on real data** | `phase4` D1–D3 | The real functions exist (CR-3). Coaching stays hidden by decision until its content is real (`src/features.ts:8-19`) |

Nothing in this list is unblocked frontend-only work except C4's rows. Every other item waits on
a key, a decision, or a backend contract.

---

## Maps plan (plan only: no dependency added)

**What a beat-plan map needs:**

| Need | Detail |
| --- | --- |
| Library | `react-native-maps`. It is the map library Expo supports for SDK 57 (this app: `expo ~57.0.12`, `react-native 0.86.2`, `apps/field/package.json:27,37`). It is a **new dependency**, so it needs the operator's approval first. `expo-maps` is the alternative; its maturity on SDK 57 is **not established** |
| API key | A **Google Maps Android API key** (**C-2**), restricted to the app's package and signing certificate. It is compiled in through `app.json` (`android.config.googleMaps.apiKey`), so **every key change is a new build**. It must never be committed: it would come in through the build script's environment, like the Supabase key (`build-demo-apk.ps1:190`) |
| Permissions | **No new permission.** A map that shows the clinics on today's plan needs none. A "you are here" dot uses the foreground location permission the app already asks for (`onboarding/location.tsx`). **No background location**, so nothing changes in the Play declaration |
| APK size | **Not established.** The map SDK comes from Google Play services, and the JS wrapper is small, but the real increase on the 97.3 MB demo APK has to be measured with a spike build, not estimated. The prebuild runs `--clean` (`build-demo-apk.ps1:327`), so the config plugin must be in `app.json`, not hand-edited |
| Data | **Clinic coordinates do NOT reach the phone.** The pull carries clinic addresses with `coordinates` mapped to `null` on purpose: the contract has no geofence-centre type, and the client never needed one (`packages/core/src/field/endpoints.ts:971-987`). **A map of stops therefore needs a backend contract change first**: a geofence-centre field on the clinic address, as that comment proposes. That is a backend request to file before any map work. The address text (`line1`, `city`) does reach the phone |

**What can be built without live tracking:**

- **"Open in Maps"** for one clinic. This is an Android intent carrying the clinic's **address
  text** (`geo:0,0?q=<address>`), which the phone already holds. It needs **no library, no key and
  no contract change** (`Linking.openURL`). It is the smallest useful step, and the only one
  buildable today;
- a map of **today's beat-plan stops**, opened from the Beat plan screen. This needs the library,
  C-2, and the clinic-centre contract change above;
- the rep's **current position** as a dot, read only while the map is open (foreground).

**What cannot be built without A-1 and D-3:** a trail, a live position seen by anyone else,
arrival prompts (B4), or anything that runs when the app is not open.

**The existing design decision.** `BeatPlanScreen.tsx:18` records "There is no map", and gives
three reasons: slow on a mid-range phone, costly on data, and the surveillance reading of a drawn
trail. The operator's message asks for maps and tracking UI. Building it reverses that decision,
so the operator should confirm the reversal first. The two no-trail options above keep the third
reason intact.
