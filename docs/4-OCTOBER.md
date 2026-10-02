# 4 October — the honest list, two days out

**Rewritten 2 October 2026 (W1-R Part E). This is the version to read on the day.** Every line is
measured, and says where: the backend from this branch (PR #2, CI green), the frontend from its own gap
map on its branches (`fe-d14-screens` → `fe-d17-practice`), production from the drift check.

**Four categories:**

| Mark | Means |
| --- | --- |
| **BUILT AND REAL** | Working against real data, on a real server, today |
| **BUILT BUT STUBBED** | Finished and tested — but every AI answer is written by a labelled placeholder, because no model is connected |
| **NOT STARTED** | Engineering has not done it. Engineering could |
| **BLOCKED ON A CREDENTIAL** | **Nobody can do it yet.** It waits on a key, account or person only the company can supply |

**And one more column, which is the point of this version: by 4 October, is it**

* **READY** — true today;
* **COULD BE READY** — not ready, but everything it waits on could still land before the 4th, and the
  work after it is small enough to fit;
* **CANNOT BE READY** — even if what it waits on arrived today, it will not be finished by the 4th.
  **This is the column to re-plan against.**

**Three facts underlie the whole page:**

1. **Production has applied 19 of this branch's 93 database migrations** (drift check, run
   `36871733061`, 1 October: "the first 19 of 75" on `main`; this branch adds 18). **Nothing the app
   records reaches production until the deploy runs** — everything marked REAL is real on the
   development server.
2. **No AWS key exists for this project** (checked 2 October: no credential in any environment, file or
   setting reachable from it). Every AI answer is the stub's.
3. **PR #2 is not merged**, and **the frontend's branches are not merged**. Work on a branch is not on
   `main`; nothing on a branch is in a build a rep holds.

---

## The list

| # | Must-have | Status | Waiting on | By 4 October |
| --- | --- | --- | --- | --- |
| 1 | **The MR app's core day** — sign in, plan, doctors, check-in/out, consent, samples, call report, voice note, upload queue | **BUILT AND REAL** | The production deploy (17) to be real **in production** | **READY** on the development server; in production only if 17 runs |
| 2 | **Day end and Mileage** | **BUILT AND REAL — on the frontend's branch** (`6fb2f15`, `e58ac35`), reading `daily_mileage` | **Merging the frontend's branch** | **COULD BE READY** — a merge and a build |
| 3 | **Coaching, Analysis, Reply** | **Hidden by decision**; Reply is out | The frontend keeps Coaching hidden until its content is real | **CANNOT BE READY** as real-call analysis — real recording is deferred (operator, item 4); practice coaching is item 5 |
| 4 | **The five AI features** — Product Q&A, MR Chat, tutor, AI Doctor practice, coaching | **BUILT BUT STUBBED** — every branch, guardrail and refusal tested over HTTP against stub output | **BLOCKED ON A CREDENTIAL: the AWS key (Q-1)**, then about a day of adapter work (`docs/ai-platform/KEY-DAY-CHECKLIST.md`), then **approved prompts (needs Q-14)** | **CANNOT BE READY** as real AI. Even with the key today: adapter, first-call failures (the checklist predicts thirteen), and no prompt can be approved without the second admin |
| 5 | **AI screens in the MR app** — assistant and AI Doctor practice | **BUILT ON SAMPLE DATA — on the frontend's branches**, behind flags that are off (`74b0010`, `3eb838e`) | **PR #2 merged** (the chat and practice contracts, `FE-CR-7`, `FE-CR-11`), then item 4 for real answers | **COULD BE READY on sample data** after two merges; **CANNOT BE READY on real answers** (item 4) |
| 6 | **The 80% AI-limit warning on the rep's screen** | **Server BUILT AND REAL** (every answer and the 429 carry the figures and the reset time); **component built on the frontend's branch** (`e5fdfcd`) | Item 5's screens, since the warning rides on an AI answer | Same as 5: **sample data yes, real no** |
| 7 | **Approval of content** (prompts, personas, knowledge, lessons — four eyes) | **BUILT AND REAL, unusable** | **BLOCKED ON A CREDENTIAL: the second production admin (Q-14)** | **COULD BE READY** if Q-14 lands — it is "being provisioned now" (`BE-C57`) — and someone authors content to approve |
| 8 | **Product Q&A answering from approved material, refusing otherwise** | **Refusal BUILT AND REAL; answering STUBBED** | Approved product content (**Q-9**), its approval (**Q-14**), and the model (**Q-1**) | **CANNOT BE READY** — three company inputs in a row |
| 9 | **AI drafting of training content** | **NOT STARTED** beyond the draft/approve lifecycle | **BLOCKED ON A CREDENTIAL** — drafting is a model call (Q-1) | **CANNOT BE READY** |
| 10 | **Voice practice** | **NOT STARTED** | The AWS account (Q-1) for speech, and no stub-built capability by the operator's rule | **CANNOT BE READY** |
| 11 | **Maps** — basic doctor location and navigation | **NOT STARTED** (planned on the frontend's branch) | **BLOCKED ON A CREDENTIAL: Google key (Q-2)**, a map-library dependency approval, and a new build — the key is compiled in | **CANNOT BE READY** — key, approval, library work and a rebuild in two days |
| 12 | **Notifications** (operator: deferred second if capacity forces) | **NOT STARTED** | **BLOCKED ON A CREDENTIAL: Firebase (Q-3)**, plus a dependency approval | **CANNOT BE READY** |
| 13 | **Live tracking** (operator: deferred first if capacity forces) | **NOT STARTED, designed** | The paid library (a purchase), the separate privacy notice approved (Q-12), real handsets | **CANNOT BE READY** — and the operator already ordered it deferred first |
| 14 | **Territory / MR import** | **BUILT AND REAL** (template + checker) | Master data (Q-5) | **READY** as a tool; the data is the company's |
| 15 | **Working hours per territory** | **BUILT AND REAL** | Master data (Q-8); a test value is in place | **READY** with test hours |
| 16 | **Rejected writes counted** | **BUILT AND REAL** for every path the app uses (`BE-W130` closed) | — | **READY** |
| 17 | **Production deploy** — the 74 missing migrations, then reference data, then a smoke test (operator's order, `BE-C58`) | **NOT STARTED** | Engineering, **after PR #2 merges** and the operator's go-ahead; the paid plan is the operator's action | **COULD BE READY** — it is hours of work, not days, once the go-ahead and the merge exist. **Every REAL item depends on it to be real in production** |
| 18 | **External uptime monitor** | **NOT STARTED** | A dependency ask (an external service) | **COULD BE READY** if approved — it is configuration |

## Counted

**By what stops each item today** (each counted once):

| Group | Items | Count |
| --- | --- | --- |
| **BUILT AND REAL** (on the development server) | 1, 14, 15, 16 | **4** |
| **BUILT AND REAL, on a branch not yet merged** | 2 | **1** |
| **BUILT BUT STUBBED / on sample data** | 4, 5, 6 | **3** |
| **BLOCKED ON A CREDENTIAL** | 7, 9, 10, 11, 12 | **5** |
| **Waiting on company inputs in sequence** (content, approval, model) | 8 | **1** |
| **NOT STARTED — engineering, waiting on a merge or an approval** | 17, 18 | **2** |
| **Out of this release by decision** | 3, 13 | **2** |
| **Total** | | **18** |

**By what 4 October can hold:**

| By 4 October | Items | Count |
| --- | --- | --- |
| **READY** | 1, 14, 15, 16 | **4** |
| **COULD BE READY** — each needs one thing to land in time | 2 (a merge), 5 and 6 on sample data (merges), 7 (Q-14), 17 (merge + go-ahead), 18 (an approval) | **6** |
| **CANNOT BE READY** | 3, 4, 8, 9, 10, 11, 12, 13 — and 5 and 6 on **real** answers | **8** |
| **Total** | | **18** |

---

## What the operator can still change before the 4th

**Four actions, and nothing else on this page moves without them:**

1. **Merge PR #2** (Maanav). It carries the AI contracts the frontend's screens are waiting for, and it
   is the precondition for the deploy. CI is green on it.
2. **Merge the frontend's branches** (Dev). Day end and Mileage become real in a build; the assistant
   and practice screens become available on sample data.
3. **Say go to the production deploy** (operator), and confirm the paid plan. It is the difference
   between "real on a laptop" and "real".
4. **Finish Q-14, the second admin** (operator). Nothing can be approved without it — not even the
   prompt each AI feature needs before it will run.

**What no action before the 4th can change:** real AI answers (the key has not arrived, and after it
there is adapter work, first-call failures and approvals), maps, notifications, live tracking, voice
practice and AI drafting. **Plan the 4th without them.**

## The day the AWS key arrives — still true

The stub is replaced behind one line of the gateway; the checklist says what changes, what to assert
and which thirteen things will fail first. **An MR still sees no real AI** until the prompts are
approved (Q-14) and the frontend's screens call the gateway (merges above).
