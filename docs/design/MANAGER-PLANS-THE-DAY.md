# The manager plans the MR's day — design only (W1-U3 E, 2 October 2026)

**Nothing here is built.** Captured the day the operator decided it, so the build starts from their
words and from what the schema actually does — which turned out to be the opposite of the decision.

## The decision — the operator's words (`docs/operator/2026-10-02-operator-direction.md`)

**Item 10:** *"THE MANAGER WILL PLAN THE MR'S DAY. The manager should be able to: Select an MR · Select
doctors/clinics · Create weekly/daily visit plans · Assign visits · Modify/reschedule visits · Review
completion. The MR should execute the assigned plan. The MR may request/add an unplanned visit where
allowed, but the normal planned workflow should originate from the manager."*

**Item 11:** *"Admin should manage: Masters · Users · Territories · Products/content · System
configuration. Admin should not be responsible for manually planning every MR's day."*

## What exists — measured from the catalogue, not assumed (W1-U3)

| Piece | What the schema does today |
| --- | --- |
| `beat_plans` | One plan per MR **per day** (`plan_date`), with `territory_id`, `status` (`draft → submitted → approved / rejected`), `approved_by_user_id`, `approved_at`, and **versioning** (`version`, `supersedes_beat_plan_id`) |
| `beat_plan_entries` | The stops of a plan |
| `visits` | One per stop or unplanned (`beat_plan_id` nullable); status advances through check-in / check-out |
| **Who may WRITE a plan, entry or visit** | **Only the MR, for themselves** — `beat_plans_insert_own` / `_update_own`, `beat_plan_entries_write_own_plan`, `visits_insert_own` / `_update_own`, all `mr_id = auth.uid()` |
| **What a manager may do** | **Read only** — `*_select_own_or_team` via `visible_user_ids()` |
| Functions that create or approve a plan | **None.** Only `apply_sync_item`, `record_check_in` and `record_check_out` write visits; nothing writes `beat_plans` |
| The rep's app | Receives plans and visits through `sync_pull` (built); **cannot create a visit** (`outbox.ts`: `case 'visit': return blocked('not_convertible')`, `FE-W28`) |
| A planning screen | **None** — the console has admin, coaching, knowledge, practice and prompts; no manager screen |

**So the gap is not "the feature is missing" — it is "the permission points the wrong way".** The
schema was built for the MR to propose a plan and the manager to approve it (`BE-W23`). The decision
is the reverse: the manager writes, the MR executes.

## What it needs

### The permission boundary

| Who | May | May not |
| --- | --- | --- |
| **Manager** | create, edit, reschedule and cancel plans and visits **for MRs who report to them** (decide: direct reports only, or the whole subtree — see the questions); read completion | plan for MRs outside their reporting line; change a visit the MR has started (checked in) |
| **MR** | read their plan; execute it (check-in, consent, samples, call report, check-out — all built); **add an unplanned visit where allowed** | create or edit a planned visit |
| **Admin** | masters, users, territories, products, configuration (item 11) | **plan anyone's day** — an explicit exclusion, enforced, not merely absent |

Enforced in the database (row-level policies plus a small set of security-definer functions:
`create_beat_plan`, `assign_visit`, `reschedule_visit`, `cancel_visit`), exactly as every other write
here is — never by a screen hiding a button.

### The screens

| Screen | Where | What |
| --- | --- | --- |
| **Plan a week** | Manager's console (web) — **to confirm, see questions** | Pick an MR → pick doctors/clinics from the MR's territory → place them on days → save as daily plans |
| **Reschedule / cancel** | same | Move or cancel a visit not yet started; the change is a new plan version, so history is kept |
| **Completion review** | same | Per MR, per day: planned vs checked-in vs completed vs not met, from data that already exists |
| **Today, assigned** | MR's app | Already built — it shows what the pull delivers |
| **Add an unplanned visit** | MR's app | `FE-W28` — new; the server already accepts a `visit` item |

### Size — in working days, by owner

| Part | Owner | Days |
| --- | --- | --- |
| Policies reversed, the four planning functions, tests (including "an admin cannot plan" and "a manager cannot plan outside their line", both two-sided) | **Backend** | **3–4** |
| The three manager screens | **Whoever owns the console** — to confirm | **5–8** |
| Unplanned visit in the app (`FE-W28`), plus a plan that changes while the MR is offline | **Frontend (app)** | **2–3** |
| **Total** | | **10–15 working days**, about **2–3 weeks**, once the questions below are answered |

These are estimates from the size of comparable work in this repository, not measurements.

## What the decision does not answer — the operator's, cheaper to ask now

1. **Whose MRs may a manager plan for** — direct reports only, or everyone beneath them?
2. **Where does the manager plan** — the web console, or the phone app?
3. **Weekly plans:** is a "weekly plan" seven daily plans made together, or one object the MR sees as a week?
4. **An unplanned visit "where allowed"** — allowed by whom, and does it need the manager's approval before
   or after it happens?
5. **A rep reassigned to another manager or territory:** what happens to plans already made for future days?
6. **Changing a plan the MR has already started** (checked in to the first visit) — allowed, refused, or a
   new version only for the visits not yet started?
7. **Approval:** the schema has `submitted → approved`. With the manager writing the plan, is there still an
   approval step — and if so, who approves a manager's plan?
8. **A doctor outside the MR's territory** — may a manager assign one?

**Nothing is built until 1, 2 and 4 are answered**: they change the permission boundary and where the
screens live.
