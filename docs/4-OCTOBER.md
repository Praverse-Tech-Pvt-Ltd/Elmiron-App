# 4 October — the honest list

**Rewritten 1 October 2026, evening (W1-P Part E).** Built on the frontend's own measured gap map,
**`docs/frontend-facts-2026-10-01.md` (FE-D13)**, and on backend's measurements in this repository.

**Four categories, and the last one is the point:**

| Mark | Means |
| --- | --- |
| **BUILT AND REAL** | Working against real data, on a real server, today |
| **BUILT BUT STUBBED** | The code is finished and tested — but every answer it gives was written by a placeholder, because no real AI model is connected |
| **NOT STARTED** | Engineering has not done it. Engineering could |
| **BLOCKED ON A CREDENTIAL** | **Nobody can do it yet.** It waits on an account, key or person only the company can supply |

**"Real" means real on a phone against a server.** One fact underlies the whole page: **production has
applied 19 of this project's 91 database migrations** (FE-D13 §6, drift run `36718280007`). **The app's
offline sync is not on production**, so nothing the app records can reach production until the deploy
runs. Everything below marked REAL is real against the development server.

---

## The list

| # | Must-have | Status | What it is waiting on |
| --- | --- | --- | --- |
| 1 | **The MR app's core day** — sign in, today's plan, doctors, check-in/out, consent, samples, call report, voice note, upload queue (13 screens) | **BUILT AND REAL** | Production deploy (item 17) to be real **in production** |
| 2 | **Day end and Mileage** (2 screens, always reachable) | **BUILT, BUT READING THE MOCK SERVER** | **Frontend only.** The real function exists, works for an MR (`CR-3`, proved over HTTP), and a wrapper for it already exists unused (`apps/field/src/capture/visits.ts:92`). A sideloaded phone cannot reach a laptop's mock, so **on a handset these two show nothing real until switched** |
| 3 | **Coaching, Analysis, Reply** (3 screens) | **BUILT, READING THE MOCK, HIDDEN** | Frontend only, as item 2; hidden by a flag that is off |
| 4 | **The five AI features** — Product Q&A, MR Chat, tutor, AI Doctor practice, coaching | **BUILT BUT STUBBED** | **BLOCKED ON A CREDENTIAL: the AWS key (Q-1).** Logic, guardrails, audit and every branch are tested over HTTP — against stub output |
| 5 | **AI screens in the MR app** | **NOT STARTED** | Frontend. **No file in `apps/` calls the AI gateway** (measured) |
| 6 | **The 80% AI-limit warning on the rep's screen** | **Server BUILT AND REAL; screen NOT STARTED** | Frontend (`BE-CR-6`) — and the AI screens of item 5, since the warning rides on an AI answer |
| 7 | **Approval of content** (prompts, personas, knowledge, lessons — four eyes) | **BUILT AND REAL, UNUSABLE** | **BLOCKED ON A CREDENTIAL: the second production admin (Q-14).** One admin cannot pass a four-eyes check |
| 8 | **Product Q&A answering from approved material, refusing otherwise** | **BUILT** (refusal real; answering stubbed) | **Master data:** approved content (Q-9), plus item 4 |
| 9 | **AI drafting of training content** | **NOT STARTED** beyond the draft/approve lifecycle | **BLOCKED ON A CREDENTIAL** — drafting is a model call (Q-1) |
| 10 | **Voice practice** | **NOT STARTED** | The AWS account (Q-1) for Transcribe; the operator ruled no new stub-built capability |
| 11 | **Maps** — basic doctor location and navigation | **NOT STARTED** | **BLOCKED ON A CREDENTIAL: Google keys (Q-2)**, plus a map-library dependency approval and a new build |
| 12 | **Notifications** (deferred second if capacity forces) | **NOT STARTED** | **BLOCKED ON A CREDENTIAL: Firebase (Q-3)**, plus a dependency approval |
| 13 | **Live tracking** (deferred first if capacity forces) | **NOT STARTED, designed** | The operator chose the **paid** library — a dependency purchase; the **separate notice approved** (Q-12, four decisions); real handsets. Pilot is **sideloaded**, which removes the Play-review question for the pilot (`LIVE-TRACKING-DESIGN.md`) |
| 14 | **Territory / MR import** | **BUILT AND REAL** (template + checker) | **Master data (Q-5)** |
| 15 | **Working hours per territory** | **BUILT AND REAL** | Master data (Q-8); a test value is in place |
| 16 | **Rejected writes counted** (asked for twice) | **BUILT AND REAL** | — (direct API paths the app does not use: `BE-W130`) |
| 17 | **Production deploy** — the 72 missing migrations, then reference data, then a smoke test (operator's order) | **NOT STARTED** | Engineering, in the operator's sequence; the paid plan is the operator's action. **Every REAL item above depends on this one to be real in production** |
| 18 | **External uptime monitor** | **NOT STARTED** | A dependency ask (an external service) |

**Counted — each item once, by what stops it today:**

| Group | Items | Count |
| --- | --- | --- |
| **BUILT AND REAL, nothing waiting but data or the deploy** | 1, 14, 15, 16 | **4** |
| **BUILT, reading the mock — frontend's switch** | 2, 3 | **2** |
| **BLOCKED ON A CREDENTIAL** — AWS key, second admin, Google, Firebase | 4, 7, 9, 10, 11, 12 | **6** |
| **Waiting on master data** | 8 | **1** |
| **NOT STARTED — engineering (frontend: 5, 6)** | 5, 6, 17, 18 | **4** |
| **NOT STARTED — waiting on operator decisions and a purchase** | 13 | **1** |
| **Total** | | **18** |

---

## The day the AWS key arrives — what changes, and what does not

**What changes, within about a day of engineering:** the stub is replaced by Bedrock India behind the
gateway's one construction line; **all five AI features start answering for real**; every branch already
proved against stub output then runs against a real model, which **will differ in length, latency and
failure mode** — that day is when the AI work is actually tested.

**What does NOT change:**

* **An MR still sees no AI**, because no app screen calls it (item 5).
* **No AI content can be approved** until the second admin exists (item 7) — including the prompt each
  feature needs before it will run at all.
* **Product Q&A still refuses** until approved product content is loaded (item 8).
* **Nothing reaches production** until the deploy runs (item 17).

## The plain reading

**The decision in front of the operator is no longer what to cut. It is how fast three things land:
the AWS key, the second admin account, and the go-ahead to deploy.** Six of the eighteen items cannot be
started by anyone until the first two arrive; the production deploy gates whether anything is real
outside a laptop.

**On the frontend's side, the cheapest real gain on the demo path is items 2 and 3**: the functions exist
and are proved, and the switch is theirs.
