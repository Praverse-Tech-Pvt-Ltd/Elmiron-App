# 4 October — what can actually be done, feature by feature

**Written 1 October 2026 (W1-N Part E). Three working days remain.** Backend's view, marked
honestly. **BUILDABLE** = can be working in the app by 4 October. **PARTLY** = some of it, and the
line says which part. **NOT** = will not be working by 4 October, and the line says why.

**"Working" means an MR can use it on a phone.** Code that exists, passes its tests and is reached by
no screen is not working — this project's own rule, and the reason this page exists.

| # | Feature | 4 Oct | Why — and what it depends on |
| --- | --- | --- | --- |
| 1 | **Real AI answers** (Product Q&A, MR Chat, tutor, AI Doctor, coaching) | **NOT, unless Q-1 arrives by 2 Oct** | Every AI feature answers from a labelled stub. The Bedrock adapter is about **a day** of work **after** AWS access exists, plus a real-vendor proof. **Depends on: Q-1 (AWS)** |
| 2 | **AI screens in the MR app** | **NOT** | **No file in `apps/` calls the AI gateway — measured.** The backend for all five is built and tested; no MR can reach any of them. **Frontend-owned** |
| 3 | **The screens still reading the MOCK server** (A-8) — **5 of the app's 24, named below (W1-O)** | **BUILDABLE** | **Every server function they need exists and is proved for an MR over real HTTP** (`CR-3`, `cr3-mr-reads.spec.ts`). The switch is **frontend-only**. Two of them — **Day end and Mileage — are reachable today and would send a release build to whatever `EXPO_PUBLIC_API_BASE_URL` names**, which only the mock serves |
| 4 | **AI-limit warning in the UI** (A-8) | **PARTLY** | **Built (backend):** the 80% line, one logged row per MR per day, `allowanceWarning` returned to the gateway. **Not built:** carrying it to each flow's result (`BE-W128`, ~0.5 day) and showing it on a screen (frontend). Doable by 4 Oct only if frontend has the room |
| 5 | **Maps** (A-6) | **NOT** | Needs **Q-2 (Google keys)**, a **map library added to the app (a dependency ask)**, the screens, and a **new Android build** (the key is compiled in). None started |
| 6 | **Live tracking** (A-5) | **NOT** | Designed, not built (`docs/ai-platform/LIVE-TRACKING-DESIGN.md`). Needs: a **dependency decision**, an **approved notice with four answers only you can give** (Q-12), and **a working day on a real handset of each make the MRs carry** — battery behaviour cannot be tested on an emulator. **And a recorded finding (`FE-W3-SPEC`, 31 Aug) that Google Play's background-location declaration does not list employee monitoring as an acceptable use** — to be checked before anything is built |
| 7 | **Notifications** (A-7) | **NOT** | Needs **Q-3 (Firebase)**, a **notifications library (a dependency ask)**, the server send path, and a new build. None started |
| 8 | **Voice practice** | **NOT** | Nothing built. Needs Q-1 plus Amazon Transcribe and an India-hosted speech-out service, unverified |
| 9 | **Coaching on nine items** | **PARTLY** | **Built and tested end to end** — nine items, suggested modules that must be real courses. **Real scoring** needs item 1 and an approved coaching prompt (item 11) |
| 10 | **AI drafting of training content** (B-6) | **NOT** | The draft → approve lifecycle is built; **the drafting is a model call** — item 1 |
| 11 | **Approvals** (prompts, personas, knowledge, lessons — four eyes) | **BUILT, unusable until Q-14** | Author and approver must be different accounts; **with one admin, every approval is refused.** Depends on the second admin you are provisioning |
| 12 | **Territory and MR import** (B-1) | **BUILDABLE** | Template and checker built this session (`docs/operator/territory-template.xlsx`). **Depends on Q-5 — your data.** MR sign-in accounts are created one per row after the territories load |
| 13 | **Product master; Q&A refuses without approved material** (B-3, B-4) | **BUILT** | Q&A says *"approved information not available"* and never calls the model when nothing approved matches. **Empty until Q-6 / Q-9** |
| 14 | **Doctor and clinic import** (B-5) | **PARTLY** | **Import built** (`seed:reference`). **An admin entry screen was not verified in this session.** AI Doctor does not depend on it |
| 15 | **Working hours per territory and company** (B-2) | **BUILT** | 09:00–18:00 is a test value; the real one is admin-set (Q-8) |
| 16 | **Rejected writes counted** (`BE-C32`, `BE-C60`) | **BUILT** (this session) | Every rejection on the path the app uses is a countable row an admin can query. Direct API paths the app does not use are `BE-W130` |
| 17 | **Production deploy** (C-3, C-4) | **PARTLY** | The order is defined and the schema is ready. **The paid plan is your action; the external heartbeat monitor is a dependency ask and not built** |

## The MR app's 24 screens, by where their data comes from — W1-O

**Measured on `fe-d12-final` (`2195874`, 14 commits ahead of `main`, 0 behind), the frontend's newest
branch in this repository**, by tracing each screen's imports and calls, then cross-checked by a second
method (every file naming the mock client factory — four of the nine hits are comments recording an
earlier move OFF the mock, and are not calls).

| Data from | Count | Screens |
| --- | --- | --- |
| **Real server** (sync, RPCs, auth) | **13** | Launch, Sign in, Today, Doctors, Me, Beat plan, Consent, Doctor profile, Queue, Call report, Samples, Visit, Voice note |
| **Mock server only** | **3** | **Coaching**, **Analysis**, **Reply to analysis** — all three hidden behind the coaching flag, which is OFF |
| **Real AND mock** | **2** | **Day end** (visit list and distance from the mock), **Mileage** (distance from the mock) — **both always reachable** |
| **No server** (permissions, static text) | **6** | Battery steps, Location, Location denied, Microphone, Notifications, Transparency |

| Mock-reading screen | Calls today (mock) | Real replacement | Works for an MR today? |
| --- | --- | --- | --- |
| **Day end** | `GET /visits`, `GET /mileage` | visits from sync (already used elsewhere); `daily_mileage` RPC — **a wrapper already exists, `apps/field/src/capture/visits.ts:92`, and nothing imports it** | **YES** (`CR-3`) |
| **Mileage** | `GET /mileage` | `daily_mileage` — same unused wrapper | **YES** (`CR-3`) — wire is snake_case; use `fromMileageRow` |
| **Coaching** | `GET /analyses`, `/visits`, `/doctors` | `list_analyses`; visits and doctors from sync | **YES** (`CR-3`) |
| **Analysis** | `GET /analyses/:id`, `/consent-records` | `read_analysis`, `list_consent_records` | **YES** (`CR-3`) |
| **Reply** | `POST /analyses/:id/response` | `respond_to_analysis` | **YES** (`CR-3`) — note `endpoints.ts` declares no `/rpc/respond_to_analysis` path |

**What this means for 4 October:** no AI feature has a screen at all (row 2), and **the two always-reachable
mock screens are the immediate risk** — a release build cannot point at a laptop, so on a handset Day end
and Mileage show nothing real unless they are switched first. **The operator's "six remaining screens"
could not be mapped to this list**: their message was not provided to backend (W1-O). The nearest
recorded "six" is `CR-3`'s *"six screens can leave `127.0.0.1:4010`"* (28 Sep) — five still have not.

## The plain reading

**Of the operator's new items for 4 October — maps, live tracking, notifications, voice practice and
the six screens — none will be working on a phone by then.** Three of the five cannot even start
until something arrives from outside engineering (Google, Firebase, AWS keys), and live tracking also
needs real handsets carried for a day.

**What CAN be true on 4 October if Q-1 and Q-14 arrive by 2 October:** real AI answers behind the
gateway, approvable prompts — **but still no MR-app screen calling them**, which is the single largest
gap between "built" and "working", and it is on the frontend side.

**The honest re-plan is therefore not "faster".** It is to choose which two or three of these matter
most on 4 October and supply what each one is waiting on today.
