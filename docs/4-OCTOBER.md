> **RETIRED 7 October 2026 (W2-G C, `BE-C76`) — not a plan any more; do not re-plan against it.**
> The single list of what the operator asked for is `docs/operator/must-haves.json` — the operator's own
> 2 October text, fourteen items — and the status table in the latest section of `docs/log/backend.md`
> is checked against it in CI (`services/api/scripts/check-status-table.mjs`). This file listed eighteen items of its own and never had LMS as one.
> Everything below is kept unchanged, as the record of the day it was written.

# 4 October — the honest list, the last version before the date

**Rewritten 2 October 2026 (W1-S Part E). This is the version to read on the day.** Every line is
measured, and says where: the backend from this branch (PR #2), the frontend from its own gap map on
its branches, production from the drift check run this morning.

**Four categories:**

| Mark | Means |
| --- | --- |
| **BUILT AND REAL** | Working against real data, on a real server, today |
| **BUILT BUT STUBBED** | Finished and tested — but every AI answer is written by a labelled placeholder, because no model is connected |
| **NOT STARTED** | Engineering has not done it. Engineering could |
| **BLOCKED ON A CREDENTIAL** | **Nobody can do it yet.** It waits on a key, account or person only the company can supply |

**And by 4 October:** **READY** (true today) · **COULD BE READY** (everything it waits on could still
land, and the work after it fits) · **CANNOT BE READY** (even if what it waits on arrived now). **Re-plan
against the last column.**

**What is true this morning, 2 October — measured:**

1. **Production has applied 19 of this branch's 94 migrations**, in order, nothing applied by hand
   (drift check run `36975013243`, this morning, against this branch — it counted 93; W1-S added one).
2. **No AWS key exists for this project** — checked again this morning, every place one could live.
3. **Nothing has been merged.** PR #2 is open; the frontend's PRs #13, #14 and #15 are open; `main` is
   where it was on 1 October (`dbc17dd`).
4. **The deploy is now a rehearsed procedure, not a plan** — `docs/DEPLOY-RUNBOOK.md`, every step run
   this morning against a copy of production's state, with a smoke test of seven commands and their
   expected answers.

---

## The list

| # | Must-have | Status | Waiting on | By 4 October |
| --- | --- | --- | --- | --- |
| 1 | **The MR app's core day** — sign in, plan, doctors, check-in/out, consent, samples, call report, voice note, upload queue | **BUILT AND REAL** on the development server | **In production:** the deploy (17), the rep's accounts — **created by hand** (`BE-W137`) — and **a consent notice, which waits on the registered legal name (Q-11)**. Until then the consent step refuses in production | **READY** on the development server. **In production: CANNOT BE READY for consent** unless Q-11 arrives; the rest of the day could be, with 17 |
| 2 | **Day end and Mileage** | **BUILT AND REAL — on the frontend's branch**, reading `daily_mileage` | **Merging the frontend's PRs** | **COULD BE READY** — a merge and a build |
| 3 | **Coaching, Analysis, Reply** | **Hidden by decision**; Reply is out | Real recording is deferred (operator) | **CANNOT BE READY** as real-call analysis; practice coaching is 5 |
| 4 | **The five AI features** | **BUILT BUT STUBBED** — every branch tested over HTTP against stub output; failures now distinguishable in the log (a refusal is `model_refused`; a vendor error keeps its name) | **BLOCKED ON A CREDENTIAL: the AWS key (Q-1)**, then the adapter (`KEY-DAY-CHECKLIST.md`), then **approved prompts (Q-14)** | **CANNOT BE READY** as real AI |
| 5 | **AI screens in the MR app** — assistant and AI Doctor practice | **BUILT ON SAMPLE DATA — on the frontend's branches**, flags off | **PR #2 merged** (`FE-CR-7`, `FE-CR-11`), then 4 for real answers | **COULD BE READY on sample data**; **CANNOT BE READY on real answers** |
| 6 | **The 80% AI-limit warning** | **Server BUILT AND REAL**; component on the frontend's branch | 5's screens | Same as 5 |
| 7 | **Approval of content** (four eyes) | **BUILT AND REAL, unusable** | **BLOCKED ON A CREDENTIAL: the second admin (Q-14)** — created the same way as the reps (runbook step 4) | **COULD BE READY** if Q-14 lands and someone authors content |
| 8 | **Product Q&A answering from approved material** | Refusal **REAL**; answering **STUBBED** | Approved content (Q-9), its approval (Q-14), the model (Q-1) | **CANNOT BE READY** |
| 9 | **AI drafting of training content** | **NOT STARTED** | **BLOCKED ON A CREDENTIAL** (Q-1) | **CANNOT BE READY** |
| 10 | **Voice practice** | **NOT STARTED** | Q-1, and no stub-built capability | **CANNOT BE READY** |
| 11 | **Maps** | **NOT STARTED** | **BLOCKED ON A CREDENTIAL: Google (Q-2)**, a dependency approval, a rebuild | **CANNOT BE READY** |
| 12 | **Notifications** (deferred second) | **NOT STARTED** | **BLOCKED ON A CREDENTIAL: Firebase (Q-3)**, a dependency approval | **CANNOT BE READY** |
| 13 | **Live tracking** (deferred first) | **NOT STARTED, designed** | A purchase, the notice (Q-12), handsets | **CANNOT BE READY** — and ordered deferred first |
| 14 | **Territory / MR import** | **BUILT AND REAL** — checker + loader **rehearsed this morning**, re-runnable | Master data (Q-5) | **READY** as a tool. **The MR accounts are not imported by it** — by hand (`BE-W137`) |
| 15 | **Working hours per territory** | **BUILT AND REAL** | Master data (Q-8). **Set after reference data, not before** (rehearsal) | **READY** with test hours |
| 16 | **Rejected writes counted** | **BUILT AND REAL** | — | **READY** |
| 17 | **Production deploy** | **REHEARSED, NOT RUN** — 74 pending migrations applied in **8 seconds** on a copy; a forced failure stopped cleanly and resumed | **PR #2 merged** and the operator's go-ahead | **COULD BE READY — an estimated hour of watched steps** (rehearsed on a copy; production timing not measured) once both exist. **Every REAL item depends on it to be real in production** |
| 18 | **External uptime monitor** | **NOT STARTED** | A dependency ask | **COULD BE READY** if approved |

## Counted

| By 4 October | Items | Count |
| --- | --- | --- |
| **READY** (on the development server) | 1, 14, 15, 16 | **4** |
| **COULD BE READY** — each needs one thing to land | 2, 5 and 6 on sample data, 7, 17, 18 | **6** |
| **CANNOT BE READY** | 3, 4, 8, 9, 10, 11, 12, 13 — and 5, 6 on real answers, and **consent in production** (1) without Q-11 | **8** |
| **Total** | | **18** |

---

## The four actions — what has happened, as of the morning of 2 October

| Action | Owner | Happened? | What it unblocks the moment it does |
| --- | --- | --- | --- |
| **Merge PR #2** | Maanav | **No** — open, CI green on `e91859c` | The AI contracts the frontend's screens wait for (5, 6); the precondition for the deploy (17) |
| **Merge the frontend's PRs #13–#15** | Dev | **No** — all three open | Day end and Mileage real in a build (2); assistant and practice screens on sample data (5, 6) |
| **Say go to the production deploy, confirm the paid plan** | Operator | **No record of it** | The deploy (17) — `docs/DEPLOY-RUNBOOK.md`, an estimated hour, watched |
| **Finish Q-14, the second admin** | Operator | **No record of it** — Q-14 still open | Every approval (7), including the prompt each AI feature needs |

**Two inputs that decide whether production is usable by reps at all, not just deployed:** the
**legal name (Q-11)** — without it the consent step refuses — and the **territory and MR sheet
(Q-5)**, whose reps are then created by hand.

**What no action before the 4th can change:** real AI answers, maps, notifications, live tracking,
voice practice and AI drafting. **Plan the 4th without them.**

---

## Scored after the day — 5 October 2026 (W1-Y E)

**What was true on 4 October, from evidence, not from this page:**

* **`main` was `dbc17dd` — unchanged since 1 October.** `main`'s first-parent history goes from PR #12
  (1 October, 15:39) straight to PR #2 (5 October, 09:54). Nothing merged on the 2nd, 3rd or 4th.
* **Production had applied 19 of 75 migrations** — scheduled drift run `37203438592`, 4 October 12:49
  UTC, on `dbc17dd`. Nothing was deployed.
* **No AI answered anywhere.** The Bedrock adapter was not on `main`, model access was `NOT_AUTHORIZED`
  when measured on 2 and on 5 October (no measurement exists for the 4th), and production had none of the
  AI tables, so even a deployed gateway could not have begun a request.
* **This page's own premise was already stale the day it was written:** it says "No AWS key exists". The
  key arrived later on 2 October (W1-U); the blocker became model access, which it still is. The outcome
  is the same; the reason on the page is not.

**The score, line by line — wrong in either direction:**

| # | Predicted for the 4th | What happened | Verdict |
| --- | --- | --- | --- |
| 1 | READY — on the development server | True off `main` only; nothing reached production | **Right as worded** — and the wording was the hedge: "development server" is not what a demo of the product needs |
| 2 | COULD BE READY — "a merge and a build" | The merge happened on the **5th** (PR #13) | **Did not happen** — one day late |
| 3 | CANNOT BE READY | Could not | **Right** |
| 4 | CANNOT BE READY — the key | Could not — but the cause moved from "no key" to "no model access" | **Right outcome, stale cause** |
| 5, 6 | COULD on sample data; CANNOT on real answers | Not merged on the 4th; still sample-only on the 5th (the transports were never switched) | **"Could" did not happen; "cannot" right** |
| 7 | COULD — if the second admin lands | No second admin recorded | **Did not happen** |
| 8–13 | CANNOT BE READY | Could not | **Right** (six rows) |
| 14, 15, 16 | READY | True on PR #2's branch; on `main` only from the 5th | **Right about the code, wrong about where** |
| 17 | **COULD BE READY — "an estimated hour"** | **Could never have been ready.** Its first step needs a backup, and there is nowhere to put one — and even with a destination set, the backup job stores nothing (`BE-W143`). Attempted on the 5th; stopped at step 0.1 | **WRONG, optimistic** — the page's one real miss |
| 18 | COULD — if approved | Not approved | **Did not happen** |

**In one sentence: every CANNOT was right, no COULD became a did, and one COULD was never possible.**
Eight of eight CANNOTs held. None of the six COULDs landed on the day, because nothing merged until the
5th. And the production deploy — the item "every REAL item depends on" — was called an hour's work when
its first step was impossible. The page did not check that step; W1-W found it by running it.
