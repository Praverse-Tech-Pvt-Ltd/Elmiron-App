# Phase log — backend / AI platform track

> **This file is append-only.** New sections go at the end. Never edit above the last one, and never
> run a formatter over it — the same rule `PROJECT-OVERVIEW.md` keeps, for the same reason.

**Read `PROJECT-OVERVIEW.md` first.** Everything up to and including **W1-E** is there, in one
chronological order, and nothing has moved out of it. This file starts at **W1-F**.

**Why this file exists — `BE-W120`.** Both tracks appended to `PROJECT-OVERVIEW.md`, and **every
conflict observed on 28 September — four in one day — was in that file or in
`.ai-collab/decisions.md`.** Each conflict silently removed CI from PR #2, because GitHub cannot
build `refs/pull/N/merge` for a conflicting pull request, so **no workflow run is created at all**.
A conflict in a log file was costing the branch its verification.

**What this does NOT fix, stated so nobody credits it with more than it does.**

* It does not prevent conflicts in shared **code**.
* It did not fix the `C20` id collision. That needed per-track *prefixes* and got them
  (`BE-C3`, recorded in `CLAUDE.md`). `BE-W118` conflated the two problems, and the conflation is
  what made the renumbering a surprise. **Two problems, two fixes.**

**What it costs a reader, which is real.** One file used to be the whole history in one order. From
W1-F onwards a reader must open this file and `docs/log/frontend.md` and interleave them by date to
reconstruct a week. The interleaving in `PROJECT-OVERVIEW.md` is how the racing of two tracks was
visible; that is no longer free. Both files stay dated and append-only, so the interleave is
mechanical.

**Nothing already written moved**, so no citation anywhere in the repository breaks.

---

### W1-F — the authoring screens · 29 September 2026 · Model: Claude Opus 5

**The one-sentence result.** A practice session could not be started by anybody, because the
persona and scenario it needs could only be created by a test; `/practice` now creates and approves
both, and `start_sim_session` was observed **refusing** a scenario and then **accepting the same
scenario** once a second admin approved it.

#### A1 — why the anon guard caught the trigger functions in CI and not locally

**Two causes, and the first one is the one that matters.**

**1. The guard was never RUN locally. This is a missing mechanism, not staleness.**
`privilege-posture.spec.ts` and `rls.spec.ts` run only through
`pnpm turbo run test --filter @fieldforce/api`, which `ci.yml` invokes at **line 248 — inside the
DATABASE job, which starts at line 135.** At the time of the W1-D push:

* `.githooks/pre-commit` ran `node scripts/ci-local.mjs --only=typecheck,lint,format:check`.
  **No tests at all**, by design — its own header says a hook that costs minutes is a hook people
  pass `--no-verify` to.
* There was **no pre-push hook**.

So nothing between writing the migration and pushing it executed the assertion that would have
failed. **The guard did not miss the defect; it was never asked.**

**2. Had it run, the answer would still have depended on database state.** W1-E B3 established this
with a two-sided measurement rather than an argument: `rls.spec.ts` passes **98/98** on this
machine's accumulated database and fails **1 of 98** on a reset one, because a grant left behind by
an earlier session is indistinguishable from a grant the migrations create.

**Both are closed by the same mechanism**, which is why W1-E built one thing rather than two:
`.githooks/pre-push` resets the database and then delegates to `ci-local.mjs --with-db`, which
derives its steps by reading `ci.yml` — so it runs whatever CI runs, on a database that is clean for
the same reason CI's is.

**The honest limit:** `git push --no-verify` still bypasses it. Git allows that by design. CI
remains the enforcement; this is the thing that tells you before the push rather than twenty minutes
after.

#### B — the screens

`/practice` (`apps/console/src/app/practice/page.tsx`), with `sim-content.tsx` (the forms and the
review card), `sim-content-row.ts` (the pure row builders) and `sim-content-list.tsx` (the client
boundary and every write).

**The four-eyes rule is IMPORTED, not reimplemented.** `approvalAffordance` comes from
`knowledge-review.tsx` unchanged, because a persona and a scenario carry the same three fields it
reads. **This is checkable, and it was checked** — see the mutation below.

**What the server holds, and the screen only explains:** `approve_sim_content` refuses `42501` to
the author or submitter, `42501` to a non-admin, `42501` across tenants, and `22023` on an empty
attestation. A hidden control is legibility, never enforcement.

**A defect this session created and fixed.** `/practice` returned **500** the first time it was
requested with a real cookie: *"Attempted to call simPersonaRow() from the server but simPersonaRow
is on the client."* The row builders were pure functions living in a `'use client'` module, whose
exports are client *references*, not functions. Typecheck, lint and the render tests were all green
— none of them requests a page. Fixed by moving the pure part to `sim-content-row.ts`.
**This is the repository's characteristic failure in its exact form: a thing that was built,
typechecked and tested, and was nevertheless unreachable until something actually called it.**

**A second defect, in a CHECK rather than in the code.** The cross-tenant assertion first failed
because it looked for `"Dr A. Sharma (practice)"` on the outsider's page — and that exact string is
**example text inside the form's own caution**, so the check was matching static copy, not a row.
Nothing had leaked. The check now uses a per-run name that no page can contain by accident.
**A check a page can satisfy without the thing being true is not a check.**

#### B7 — the mutations, two-sided

| Mutant | Killed | Positive control |
| --- | --- | --- |
| `productWithoutMarket = false` — the product/market rule removed | **exactly 1** test: *"refuses to save a product scenario with no market"* | the other **23** still passed |
| the **author branch deleted from the SHARED `approvalAffordance`** | **4** tests: three in `knowledge-review.test.tsx` **and one in `sim-content.test.tsx`** | the other **35** passed |

**The second mutant is the reuse proof and could not have been produced any other way.** Mutating
knowledge's helper kills a *persona* test. Had the rule been copied rather than imported, the
persona test would have gone on passing while the shared rule was broken.

Both restored; `git diff` on `knowledge-review.tsx` is empty and **39/39** pass.

#### B5/B6 — the end-to-end proof, over real HTTP, on a RESET database

Every call carried a real GoTrue token for a real person. **The service-role key was not used for
any of them.** Four people: two admins in one organisation, one MR, one admin in a second.

**19 of 19 checks passed**, including:

| Check | Observed |
| --- | --- |
| `B5` **BEFORE** | `start_sim_session` → **`22023` "scenario … is draft, not approved"** |
| `B5` **AFTER** | the **same scenario id** → **200**, `sessionId` returned |
| `C24` | a persona sent with `status: 'approved'`, bypassing the screen → **`23514`** |
| four eyes | the author approving their own persona → **`42501`** |
| attestation | approving with three spaces → **`22023`** |
| role | a **rep** approving → **`42501` "only an admin may approve"** |
| `B6` rows | the other tenant's admin reading `sim_personas` → **`[]`** |
| `B6` RPC | the other tenant's admin approving → **`42501` "is not yours"** |
| `B6` page | the other tenant's admin served `/practice` → **200, this run's persona absent** |
| the screen | the author's served HTML carries knowledge's own author note and **no Approve control**; the second admin's carries **both** controls |

**WHAT THIS PROOF DOES NOT COVER, stated plainly.** The brief asked for a BROWSER. There is **no
browser driver in this repository**, and installing one is a dependency install, which
`.ai-collab/constraints.md` requires be asked about first. So the pages were fetched from the
**running Next dev server with real `@supabase/ssr` session cookies**, and every write was issued
over real HTTP with the same RPC names and argument names the client component uses — but **no
click was simulated.** The link between a click and those arguments is covered by the render tests
(`onCreate` is asserted to receive exactly the trimmed values); the link between those arguments and
the server is covered above. **The one thing neither covers is the client bundle executing in a
real browser** — which is precisely the class of defect the 500 above belonged to. The offer to
install Playwright and close it is open.

#### C — what the operator can and cannot do without an engineer

Full numbered checklist in `docs/blocked-on-you.md` → **W1-F Part C**. The two things a reader of
this log should know:

**`BE-W122`: one step still needs SQL.** `ai_prompt_versions` has RLS, a `draft → in_review →
approved` trigger machine and four eyes — and **no RPC and no console route.** The approved
`ai_doctor` prompt for the proof above was written with three raw `update` statements over `psql`.
So the checklist has exactly one step that says *"an engineer runs SQL"*, which is the kind of step
W1-F existed to remove. Registered; half a day; blocked on nothing.

**With `#5` unanswered, the operator sees the stub and can tell it is the stub.** Every reply is the
literal string `[PRACTICE STUB - no AI provider is configured; decision #5 is open, so no model was
called]`, and every coach score is **0**. That is deliberate: a stub returning `72/100` would be
read as a judgement of a real person.

#### D — `BE-W120`, done as an append

`docs/log/{backend,frontend}.md` and `.ai-collab/decisions-{backend,frontend}.md` now exist;
`PROJECT-OVERVIEW.md` and `.ai-collab/decisions.md` each gained a **short, stable index** at the end
and **nothing above it moved.** This section is the first use, which is the only evidence that the
split works.

**The earlier reasoning said to wait for the merge, and that reasoning was about a different
change.** It feared a large diff to the most conflict-prone file. Scoped to an append plus two new
files, the diff to `PROJECT-OVERVIEW.md` is about twenty-five lines at the very end — the least
conflict-prone place in it.

#### The merge question, re-assessed

**Unchanged: merge after the 4 October demo, and take PR #2 out of draft now.** Nothing in this
session moved either side of it. The AGAINST case was always about *timing* — a large unrehearsed
schema change under the demo's critical path — and it still expires on 5 October. W1-F adds a
screen, not a schema risk. **`BE-W120` is no longer a reason to wait**, because it landed as an
append instead of a rewrite. `pr-mergeable.yml` stays **inert** until PR #2 merges; its own header
says so, and until then the two manual commands at the top of every brief are the only protection.

**I have not merged it. The decision is the operator's.**

#### A correction to W1-E, found by pushing this commit — `BE-W123`

**The pre-push clean-database check did not run, and the push said nothing.** `git push` printed the
two remote lines and exited 0. That is the shape `verify-clean-db.mjs`'s own header warns about:
*"a check that silently skips is the inert control this repository keeps finding."* It was written
to fail loudly when the stack is down. It was never reached at all.

**The cause.** `core.hooksPath` is set to `D:\Praverse\Elmiron-App\.githooks` — an **absolute path
into the MAIN checkout's working tree**, shared by every worktree through the common `.git`
directory. `.githooks/pre-push` is tracked on **this branch**, so it exists in this worktree; the
main checkout is on `main`, which does not have it yet. **A hook added on a branch is invisible from
every worktree until that branch reaches `main`'s checkout.** `pre-commit` ran because it has been
on `main` since 24 September.

**Why W1-E did not catch it.** W1-E installed the hook and verified it by running
`node scripts/verify-clean-db.mjs` directly. That proves the script works. **It does not prove the
hook fires** — and those are different claims, which is the same distinction `FIX-07` makes: *a
control that cannot be exercised is not a control.*

**The verification was done by hand instead**, against a reset database, and is recorded above.

**The one-line fix on this machine**, until the branch merges:

```bash
cp .claude/worktrees/ai-platform-phase-a/.githooks/pre-push D:/Praverse/Elmiron-App/.githooks/
```

**The durable fix is `BE-W123`:** the hook in `main`'s `.githooks` should be a thin shim that runs
the hook from the pushing worktree's own tree, so a branch that changes a hook is exercised by the
branch that changes it. **Not done here** — it is a change to the thing that guards every push, it
belongs in its own commit, and it needs its own two-sided proof that the shim fires and that a
deliberately failing hook blocks a push.

**Until then, before any push from a worktree, run the check by hand:**

```bash
node scripts/verify-clean-db.mjs
```

#### The browser gap is closed — Playwright, on the operator's approval

**Correction to B5/B6 above.** That section says no click was simulated and offers to install a
browser driver. **The operator approved it, and it is done.** The paragraph stays as written because
this file is append-only; this is what is true now.

`@playwright/test` **1.63.0** with Chromium, in `apps/console`. Three specs in
`apps/console/e2e/practice.spec.ts`, **3 passed**:

1. **the whole flow, in one browser, in two browser contexts** — the author signs in through the
   real sign-in form, types a persona into the real form, submits it, **is shown knowledge's own
   four-eyes note and no Approve control at all**; a second context signs in as the other admin,
   finds Approve **disabled until an attestation is typed**, approves; the author then drafts and
   submits a scenario; `start_sim_session` **refuses it**; the second admin approves it in the
   browser; `start_sim_session` **accepts the same scenario id**.
2. **`B6`** — an admin of the other organisation is served `/practice` and neither this run's
   persona nor its scenario appears.
3. **no real doctor, recording or patient data** — asserted against the rendered `main`, not
   promised in a comment.

**The mutant, because three passing browser tests prove nothing on their own.** Replacing
`approvalAffordance(row, viewerUserId)` with a constant `may_decide` — i.e. offering the author the
Approve button — **killed exactly spec 1**, on the assertion that the author is served no Approve
control, while specs 2 and 3 passed as the positive control. Restored; `git diff` on
`sim-content.tsx` is empty and 3 pass again.

**It is deliberately outside `turbo run test`.** The workspace `test` script is `vitest run`, whose
include is `src/**`; these live in `e2e/`. **CI has no browser binary**, and a suite that cannot run
is worse than one that is not wired up — the first goes red for the wrong reason and the second is
silent and says so in `playwright.config.ts`. Run it with
`pnpm --filter @fieldforce/console test:e2e` against a local stack.

**Two things the browser found within minutes that nothing else had.**

**1. The sign-in page was not hydrating, and every spec failed at the sign-in form.**
`/_next/static/chunks/main-app.js` answered **404**, so React never attached, so the form fell back
to a native submit and the URL became `/sign-in?` with nothing having happened. **The cause was
environmental** — the dev server had been running since before `pnpm add` relinked `node_modules`,
and its build output was stale — not a product defect. But note what it means: **every check in this
repository until today could have passed against an application whose client bundle does not load at
all.** Nothing else requests a page, and nothing else runs the page's JavaScript.

**2. `tsconfig.json` and `eslint` did not cover the new files.** `include` was `src/**` only, so the
spec and the Playwright config were typechecked by nothing; `lint` was `eslint src`. Both now name
`e2e` and `playwright.config.ts`, and the spec's first lint run found a forbidden non-null
assertion. **A test file that is not typechecked is a test file that silently rots.**

**`seed-practice-world.mjs` is now committed** rather than thrown away, because the browser suite
needs it every run. It refuses any non-localhost target on both URLs before touching either, and its
header states plainly why it seeds one `ai_prompt_versions` row when the brief says not to — there
is no screen for that table (`BE-W122`) and without an approved prompt the thing under test cannot
start. The prompt text identifies itself as a placeholder, and the approval goes through the real
`draft → in_review → approved` transition with two different admins, because the table's four-eyes
CHECK refuses anything else.

#### The clean-database check refused this push — `BE-W124`

**It worked.** `verify-clean-db.mjs` reset the database, ran what CI runs, and stopped the push on
**1 failed of 976**. The wrapper reported exit 0 because of how the command was chained; the
verdict line in the log is `PUSH REFUSED`. **An exit code is not a verdict** — the same lesson as
every other entry in this log.

**What failed, and it is not this commit.** `ai-control-plane.spec.ts` asserts that a feature with
**no** `app_thresholds` row refuses `45011`. It got `null` — the call succeeded, so a flag was on.

**The mechanism, established two-sidedly rather than guessed:**

| Run | Result |
| --- | --- |
| `vitest run tests/ai-control-plane.spec.ts` **alone** | **15 passed** |
| the same file **with `ai-gateway.spec.ts` and `sim-gateway.spec.ts`** | **fails**, `no flag: expected null to be '45011'` |

`ai-gateway.spec.ts` and `sim-gateway.spec.ts` **must commit** `ai_feature_enabled:*` globally,
because the Edge Function runs out of process and cannot see a transaction. While one of them holds
its flag `true`, the control-plane suite's absence assertion sees it.

**Why it is intermittent rather than always red, which is the part worth understanding.**
`app_thresholds` is append-only, so the gateway suites' `afterAll` "revert" appends a **`false`**
row rather than deleting. After that, the absence assertion passes again — **for the wrong reason**:
it is now reading a row that says off, not the absence of a row. The failure window is only the
gateway suite's true-window. **CI has been lucky, not correct.**

**This suite's own header claims the property in one direction only** — *"Flags and limits are
`app_thresholds` rows written as the owner inside that transaction, so no other suite ever sees
them."* That is true of what it writes and says nothing about what it reads. The rows it reads are
somebody else's.

**Not fixed here, on the operator's instruction, and the reasoning is sound**: the failure exists on
the parent commit too — the one CI passed — so it is not this commit's to carry, and none of the
four available fixes is free. They are written out in `BE-W124`. The root cause is that flags are
global until `BE-W106` gives them an organisation.

**What this costs until it is fixed:** every full-suite run has a chance of one red for a reason
that has nothing to do with the change under test, and `verify-clean-db` will refuse those pushes.
**That is the correct behaviour of the gate and the wrong behaviour of the suite.**

#### And a second one, found by the push itself — `BE-W125`

**CI went red on `33d8450`, which is a DOCS-ONLY commit** — three markdown files, 71 lines added,
no code. So the change cannot be the cause, and that is the useful part of the observation.

The failure was a **deadlock**, `40P01`, in `tenant-boundary-restrictive.spec.ts`:

> Process A waits for **AccessExclusiveLock** on relation X; blocked by process B.
> Process B waits for **RowExclusiveLock** on relation Y; blocked by process A.

**A rerun of the same SHA went green**, and the green is worth exactly as much as that sentence
suggests. **`HEAD` is green because it was retried**, not because the suite is sound. Recorded
rather than banked.

**That file already documents this class of trap in its own header** — an earlier version created a
policy on `public.doctors`, `create policy` takes ACCESS EXCLUSIVE, and a dozen suites read
`doctors`, so it was rewritten to build throwaway tables. It still builds them in `public`, inside a
transaction, and that is evidently enough.

**Same family as `BE-W124`:** two suites sharing one database under file parallelism. Registered
together, because one fix — a per-suite schema, or a serialised DDL group — would close both.

**The rule this leaves behind:** a red on `ai-control-plane.spec.ts` or
`tenant-boundary-restrictive.spec.ts` is **not evidence about the change under test** until those
two are fixed. Check the failing test name against the register before believing it — and do not
rerun a red without reading it first, which is how these two stayed invisible.

### W1-G — retention, and answering the frontend · 29 September 2026 · Model: Claude Opus 5

#### A — is anything actually being deleted?

**The headline, before the numbers: nobody is wrong, and nobody is right.** The retention jobs
**are** running, have run **126 consecutive times without a failure since 7 September**, and **do**
cover voice notes. They have also **destroyed nothing, ever** — because production holds **zero
audio objects**. The promise is not being broken. It has never been tested either.

##### A1 — the run history, read from the API rather than the file

| | `retention.yml` | `retention-watchdog.yml` |
| --- | --- | --- |
| workflow state | **`active`** | **`active`** |
| total runs | **337** | **330** |
| last run | **29 Sep 04:29 UTC — success** | **29 Sep 08:24 UTC — success** |
| scheduled runs since 23 Aug | **134** | **131** |
| of those | **126 success, 8 failure** | **125 success, 6 failure** |
| **every one of those failures** | **on 23 August itself** | **on 23 August itself** |
| since 7 Sep | **126 runs, 126 success, 0 failure** | **125 runs, 125 success, 0 failure** |

**Neither workflow was ever disabled at the workflow level** — the API reports `state=active` for
both. So "switched off" is not what happened to the *workflow*.

**What did happen is a 15-day blackout, and it was repository-wide, not retention-specific.**
Between **23 Aug 08:16 UTC and 7 Sep 14:49 UTC**:

| | runs in that window |
| --- | --- |
| `retention.yml` (schedule) | **0** |
| `retention-watchdog.yml` (schedule) | **0** |
| `backup.yml` (schedule) | **0** |
| `migration-drift.yml` (schedule) | **0** |
| **`ci.yml`, any event at all** | **0** |

**Zero GitHub Actions runs of any workflow, of any trigger, for fifteen days.** That is the
measurement. It matches, exactly, what the record already carries in two places: `COMPLETION-PLAN`
R6 — *"Free-plan auto-pause. Production paused 23 Aug – 7 Sep and was found by a failed connection,
not an alert"* — and `blocked-on-you.md` — *"red became routine on 22 August, the workflows were
disabled on 23 August **with no reason recorded**, and production auto-paused unnoticed for two
weeks."*

**Two things stopped in the same fortnight and the record conflates them.** The Supabase project
auto-paused (that is R6, and it is about the database) **and** Actions stopped creating runs (that
is this measurement, and it is about GitHub). They share a window and a cause is not established
for the second by the run history alone. **I am not certain why Actions stopped** — the state was
`active` throughout, so it was not a workflow-level disable, and the cause is not recoverable from
what the API exposes. The Actions billing history or the organisation audit log would decide it.

##### A2 — the data, and which database

**I could not reach production, and that is the honest answer to "which database".**
`~/.elmiron-prod.env` does not exist, `services/api/supabase/.temp/project-ref` does not exist,
`SUPABASE_DB_URL` is unset in this shell, and the three production secrets exist **only** as GitHub
Actions secrets (`SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, all set
14 Aug), which cannot be read back. `HANDOVER-2026-09-08.md` says the same and adds that the project
is not in the Supabase account connected to this machine.

**So I measured production the only way it can be measured from here: I dispatched the watchdog
myself and read its output.** Run **36551995393**, `workflow_dispatch`, 29 Sep **09:52 UTC**,
conclusion **success** — not a scheduled run I found lying around, a measurement taken for this
question:

```
{ "stalled": false,
  "lastRunAt": "2026-09-29T04:29:30.33316+00:00",
  "destroyedTotal": 0,
  "liveObjectCount": 0,
  "openSessionCount": 0,
  "overdueObjectCount": 0,
  "abandonedPartialCount": 0 }
Audio retention is healthy.
```

**The query behind `overdueObjectCount`**, read from
`20260815000300_audio_consent_retention.sql` → `public.audio_purge_health()`:

```sql
(select count(*) from public.recordings  where purge_state <> 'destroyed' and purge_after <= now())
+
(select count(*) from public.voice_notes where purge_state <> 'destroyed' and purge_after <= now())
```

**So the answer to "how many voice notes are past `purge_after` and still present" is zero, and the
count provably includes voice notes** — they are the second half of that sum.

| Measure | Production, 29 Sep 09:53 UTC |
| --- | --- |
| audio objects past `purge_after`, not destroyed (recordings **+ voice notes**) | **0** |
| live audio objects of any age | **0** |
| open upload sessions | **0** |
| **objects ever destroyed, all time** | **0** |
| abandoned partial uploads | 0 |
| worker stalled | false |

**I did not report a local number as though it answered the question.** A freshly reset local
database says nothing about a promise made to doctors in production.

##### A3 — the jobs are ON, so why does the other track believe otherwise

**Because their claim was true when it was written and nobody re-checked it.** 23 August is a real
date: it is the last day retention ran before the blackout, and the day every one of the 14 failures
happened. Between then and 7 September, **nothing deleted anything, and nothing said so.**

**The record they read is `blocked-on-you.md`:** *"the workflows were disabled on 23 August with no
reason recorded."* That sentence is **past tense about a state that has since changed**, sitting in
an operator-facing document, with no date of last verification beside it. **It is not wrong. It
reads as current, and it was read as current** — which is the same failure mode `CLAUDE.md` opens by
describing: a point-in-time snapshot that the next reader trusts.

**Neither record is wrong; one of them is undated.** The fix is a date and a command, not a
correction — and it is applied below.

**The earliest overdue object: there is none.** `overdueObjectCount` is 0, so the question has no
answer rather than an uncomfortable one.

##### A3b — the finding that matters more than the schedule

**`destroyedTotal` is 0. The destruction path has never run against production data.**

`audio_destruction_log` is append-only and counts every object ever destroyed. It is empty. So:

* the 126 successful runs since 7 September each found nothing to do and exited cleanly;
* **"the retention job is green" and "the retention job works" are not the same claim**, and only
  the first has evidence;
* the doctor-facing consent notice promises destruction at 90 days, and that promise currently
  rests on **code that has never destroyed a real object**.

**And the watchdog could not have told anyone.** During the blackout the watchdog was a scheduled
workflow with **zero runs** — so the control that exists to report the purge's absence was absent by
the same cause, at the same moment. **A watchdog that shares a failure domain with the thing it
watches cannot report that thing's absence.** This repository has now found that shape four times.

##### A4 — nothing fixed here

Per the brief, and per the reasoning: if audio promised to be destroyed still existed, that is the
operator's to know before it is anyone's to change. **It does not exist. There is nothing to
destroy and nothing to repair**, so the finding is the deliverable.

##### A5 — what closing it actually requires

**Engineering can do, without asking anybody:**

| | |
| --- | --- |
| **Date the claim** | Put the last-verified date and the one command beside the sentence in `blocked-on-you.md`, so the next reader checks instead of trusting. Done in this commit |
| **Prove the destruction path once** | It has never destroyed a real object. A staging object, uploaded, aged past `purge_after`, and observed leaving Storage **and** appearing in `audio_destruction_log`. Until that exists, `destroyedTotal: 0` is ambiguous between "nothing to do" and "cannot do it" |
| **Give the watchdog a second home** | It cannot report its own absence while it runs only as a GitHub schedule. A dead-man's check from a different system — or `BE-W69`'s in-database half — removes the shared failure domain |

**Only the operator can do:**

| | |
| --- | --- |
| **The paid Supabase plan, about $25/month** | `blocked-on-you.md` item 5.2. **The free tier auto-paused production for two weeks and nobody noticed**; the same pause will happen again on the next quiet fortnight, and a paused database deletes nothing while the calendar keeps moving. **This is the free-tier pause's part in the story, and it is the whole of it:** it is not what broke retention this time — there was nothing to delete — it is what guarantees retention will break silently the first time there *is* |
| **Decide whether 90 days is the promise** | The notice says it. Nothing has tested it |
| **Whether production should hold data at all before the demo** | Today it holds no audio. Every claim about retention is therefore untested, and that is a choice, not an accident |

**The one-line summary for an operator:** *nothing promised to a doctor has been kept late, because
nothing has been recorded yet — and the machinery that would keep the promise has never once had to.*

#### B — answering the frontend, before its developer leaves

All four answers are appended to `docs/contract-requests.md` under **"Answers — 29 September 2026"**.

**B1 — CR-3 was answered on 28 September and they are still on the mock.** The answer was in the
file all along, under "Answers — 28 September". **A buried answer is an unanswered question**, so it
is repeated at the end of the file with the one trap spelled out: `daily_mileage` is the only one of
the five that is not a `jsonb` builder, its wire is snake_case, and `MileageDaySchema` alone will not
parse it — `MileageRowSchema` + `fromMileageRow`. Six screens can leave `127.0.0.1:4010` with no
backend change, and **a real device cannot reach `127.0.0.1` at all**, so it is not optional for the
demo.

**B2 — `BE-C4`: contract-request ids are minted per track now.** The frontend filed a voice-note
item as `CR-5`; `CR-5` was already the practice session API. **`BE-C3` fixed this for decisions and
stopped there**, and contract requests are minted the same way from the same kind of file — so the
`C20` collision happened again in a different register. Backend mints `BE-CR<n>`, frontend
`FE-CR<n>`, `CR-1`–`CR-5` keep their names. Recorded in `CLAUDE.md` beside `BE-C3`, and in
`.ai-collab/decisions-backend.md`.

**The lesson worth more than the ruling: a rule that names one register does not cover the next one
somebody invents.** `BE-W118` conflated two problems; `BE-C3` fixed one of them in one place.

**B3 — `BE-C5`, off-site check-ins.** `check_ins.geofence_status` is a **NOT NULL** enum, so a
verdict has been recorded for every check-in since August; `location_is_approximate` arrived on
28 September with `BE-C2`. **No screen in `apps/field` reads either** — grep over `src` and `app`
returns nothing for both. The three answers: **tell the rep** (it is a fact about their own
check-in, and hiding it is the same omission that makes the privacy notice untrue), **still start
the visit** (the server already does not refuse; refusing would strand a rep standing in front of a
doctor because a clinic's stored coordinates are wrong), and **no manager surface in v1** (nothing
has ruled what "outside" *means*, and the first conclusion drawn from such a screen will be about
somebody's pay). The data is on every row from the start, so the screen can be built later against a
complete history — **that asymmetry is the whole argument**.

**B4 — the privacy notice: the frontend's claim is true of their branch and false of `main`.**
Measured:

| | `origin/main` — **what a rep sees today** | `origin/mr-46/fe-w52-notice-pending-approval` |
| --- | --- | --- |
| entries `state: 'active'` | **0** | **5** |
| entries `state: 'not-yet'` | **4** | 1 |
| merged into `main`? | — | **NO** |

There is **one** copy of `apps/field/src/transparency/content.ts`, single commit `2536862`, and
**PR #2's branch carries `main`'s version too**. `not-yet` renders, from
`packages/ui/src/TransparencyScreen.tsx:72`, as **"Not yet — this app cannot do this today."**

**So a rep opening "What this app records" is told the app cannot record where they are, which
doctors they saw, or their voice notes — while all three are built and working.** It is not stale;
**it states the opposite of the truth in the one place the product promises transparency.** The
branch is `pending-approval` and the blocker is an operator decision, not engineering.

#### C — `BE-W124` and `BE-W125`, one cause, fixed at the cause

**`BE-W124`.** `tests/global-thresholds.ts` — an advisory lock held by the three suites that must
COMMIT global `app_thresholds` rows, taken **before** the identity lock so the two orderings cannot
form a cycle. **The assertion was not weakened**: "every feature is off out of the box" still means
*no row*, because a row saying `false` and no row at all are different states and only one is what a
new organisation gets.

**Four cheaper answers were rejected, and why, is in that file's header** — territory scope (the
resolver is called with no territory, so isolating that way means changing production SQL to suit a
test), a database per worker (`create database … template` needs no other session on the template,
and PostgREST, GoTrue and the edge runtime hold connections all run), `fileParallelism: false`
(55 seconds becomes about fifteen minutes), and weakening the assertion.

**`BE-W125` was a foreign key.** `mirrorTable` created its throwaway table with
`references public.organisations (id)`, which takes a lock on **the one table nearly every other
suite inserts into** through `seedFixtures()`. That is exactly the cycle CI reported on a docs-only
commit. **The FK bought the test nothing** — it asserts how a RESTRICTIVE policy composes with a
PERMISSIVE one, and referential integrity is not part of that claim. Removed.

##### C2 — the rate, both sides, measured not impressed

Four files — `ai-control-plane`, `ai-gateway`, `sim-gateway`, `tenant-boundary-restrictive` — on a
reset database with the Edge Function served, because a gateway failure for an unserved function
would have polluted the baseline.

| | Result |
| --- | --- |
| **BEFORE**, 5 runs | **5 × `Tests 1 failed \| 48 passed (49)`** — deterministic, not flaky |
| **AFTER**, 5 runs | **5 × `Test Files 4 passed (4)` · `Tests 49 passed (49)`** |
| **full API suite, 3 runs** | **3 × `Test Files 73 passed (73)` · `Tests 972 passed \| 4 skipped (976)`** |

##### C3 — the mutant

Removing `acquireGlobalThresholds()` from **one** holder (`ai-gateway.spec.ts`) and leaving the
other two: **exactly 1 test failed, in 3 runs of 3**, always
`AI-D0 … each missing prerequisite alone refuses`, with the other **48 passing** as the positive
control. Restored; `git diff` shows only the intended wiring and the full suite is green.

#### D — the browser suite runs in CI now

**D1.** Two steps in the **database job**, which already has Postgres, PostgREST and GoTrue up:
`playwright install --with-deps chromium`, then `test:e2e`. **Cost: measured in the CI run recorded
below.** It stays out of `turbo run test` — putting it there would demand a browser in every context
that runs tests, including a developer's laptop mid-edit.

**D2 — proof it RAN, in the shape of the serve step.** `playwright test` **exits 0 when it matches
no test files at all** — a renamed directory, a bad `testDir`, a stray `grep` — and the job would go
green having checked nothing. So the run writes a JSON report and a step reads it, prints
`browser suite: N passed, N skipped, N failed`, and **fails if fewer than 7 passed or anything was
skipped**. **The gate was itself checked two-sided** before being committed: it passes on the real
report, and fails on a hand-made report with `expected: 0` and on one with `skipped: 1`.

**D3 — the hydration assertion, with its own permanent negative control.** `Save draft` is disabled
until React state says three fields are filled; typing can only change that if `onChange` is
attached, which only happens after the bundle hydrates. **Server HTML can never satisfy it.** The
second test blocks every `/_next/static/**` request and asserts the button **stays** disabled — so
the first cannot quietly stop being a hydration check.

**A measurement from building it:** blocking only `main-app.js` was **not enough** — the dev build
boots React from more than one chunk and the page hydrated anyway. *"The client bundle does not
load"* has to mean all of it.

**D4 — the class is recorded in `docs/gotchas.md`** with the eight checks that would each have
passed while the console could not be signed into: `tsc` across 9 workspaces, `eslint` across 7,
`prettier --check`, the jsdom render tests, the node tests, the 976-test API suite on a reset
database, an HTTP proof against PostgREST, and `verify-clean-db` — which runs the others, more
slowly, with the same blindness.

#### E

**E1 — `BE-W122` closed, and a correction to my own register entry.** `/prompts` drafts, submits and
approves a prompt, reusing `approvalAffordance` for the **third** time. **The entry I wrote said the
table had "no RPC and no console route". The RPCs existed all along** — `submit`, `approve`,
`reject` and `retire_ai_prompt_version`, in `AI_RPC` since `20260924000700`. Only the route was
missing. **I registered a defect without grepping for the thing I claimed was absent**, and it made
the work sound twice as large as it was.

**Should the seed go? The prompt half of it already has.** `seed-practice-world.mjs` no longer
writes a prompt at all: the browser suite creates and approves one **through the screen**, as two
admins, via `e2e/prompt-through-the-screen.ts`. **The fixture now walks the operator's documented
path, so the two cannot drift** — and if `/prompts` breaks, the practice suite breaks, which is true
of the product too. **What remains in the seeder is only what no screen can do**: minting auth
identities and organisations, which is a GoTrue admin-API operation and correctly not exposed to any
console. **That part should stay.**

**E2 — the checklist is in `docs/blocked-on-you.md`** and supersedes W1-F Part C. **Every step is a
screen.** One line is not: the AI feature flag is a global `app_thresholds` row with no admin screen
— `BE-W106`, and it is now the last of these.

#### A correction to Part C, made by the clean-database check before the push

**`BE-W124` is fixed. `BE-W125` is not, and I closed it prematurely.**

The clean-database check **refused this push**, which is the second time it has earned its place.
Two separate things were in that refusal and only one was real:

**1. Eleven of the twelve failures were my own environment.** A `functions serve` I had left running
held the `supabase_edge_runtime_Elmiron-App` container, so `ci-local`'s serve step could not start
its own — `docker: Conflict. The container name … is already in use` — and every gateway test got
**503 "name resolution failed"**. Not a defect. **It is also exactly why a red must be read before
it is rerun**, which is the rule I wrote into `BE-W125` the day before.

**2. The twelfth was `BE-W125`, in a file I had declared fixed.**

**What I got wrong, precisely.** I found the foreign key to `public.organisations` in `mirrorTable`,
removed it, ran the full suite **three times green**, and wrote CLOSED. **Three green runs of a
failure that fires roughly one run in three is not evidence of anything** — and the entry I was
closing said so in its own text.

**Then two more attempts, both measured, both reverted or downgraded:**

| Attempt | Result |
| --- | --- |
| remove the FK | the same file deadlocked again, on a **different** test, through a helper that never had a foreign key |
| bounded retry on `40P01` in `inDdlTransaction` | `tenant-boundary-restrictive` stopped failing — and the deadlock **moved** to `ai-product-qa.spec.ts`, then `refused-reads-audited.spec.ts`. **2 failures in 6 runs before, 3 in 8 after.** Reverted |

**The finding worth more than all three attempts: the deadlock is a property of 73 spec files
sharing one Postgres, and adding a lock relocates the victim instead of reducing the rate.**
`app_thresholds` alone is written by **15** suites — enumerated from the catalogue, not from
memory:

```bash
grep -l 'insert into public.app_thresholds' services/api/tests/*.ts | wc -l   # 15
```

and `audit_log` is written by all of them through `write_audit_row`. Serialising fifteen suites is
`fileParallelism: false` wearing a different hat. **The only fix at the cause is not sharing a
database**, which is a harness change — per-worker databases need a template with no session
connected to it, so the harness would have to start and own the stack rather than borrow the
developer's.

**Residual, measured over 8 full-suite runs on a clean database with the Edge Function served:
5 clean, 3 with exactly one deadlock, never the same test twice.**

**The FK removal stays** — it takes a real lock off a hot table and costs the test nothing. **The
retry does not**: a retry in a test helper that does not move the number is a liability the next
reader will extend.

**What this costs until `BE-W125` is done:** roughly one full-suite run in three goes red for a
reason unrelated to the change under test, and `verify-clean-db` will refuse those pushes. **Read
the failing test name before rerunning.** If it is a `40P01` deadlock, it is this.

#### D2's gate caught its own defect before the push

**The clean-database check refused again, and this time the thing it caught was the gate itself.**

Step 22 reported **`browser suite: 5 passed`** and failed the floor of 7 — for a run in which
**step 21 had just passed all 7**, visible in its own output. Two mistakes:

* `PLAYWRIGHT_JSON_OUTPUT_NAME` never reached the reporter, so the JSON went to **stdout** and no
  file was written;
* a `playwright-results.json` from an earlier local run — **5 tests, `practice.spec.ts` only,
  timestamped 10:39 UTC** — was still on disk, and the gate read that.

**The proof-of-execution step was satisfiable by an artefact of a previous run.** Had that stale
file said 7, the gate would have passed a run in which nothing executed — which is precisely the
failure it exists to catch.

**Fixed in both halves**: the output path is declared in `playwright.config.ts` so it cannot depend
on an environment variable arriving, and the CI step deletes the report before running. Verified:
the report now names **both** spec files and reads `expected: 7, skipped: 0, unexpected: 0`.

**This is the fifth instance of one shape in this repository** — a stale bundle, a stale function
body, a stale database, a stale knowledge graph, and now a stale test report. Recorded in
`docs/gotchas.md` as the general rule: **when a check reads something it did not just produce, ask
what produced it and when.**

#### And the first CI run of the browser suite failed, in a way only CI could show

**`Timed out waiting 120000ms from config.webServer`.** Not a deadlock, not a defect in the screens
— `next dev` on a cold runner with no `.next` cache has to compile the route before it can answer,
and that is neither fast nor bounded.

**Raising the timeout would have moved the failure rather than removed it.** Dev mode compiles every
*further* route on first navigation, so the 60-second per-test timeout was the next thing in line.

**CI now builds and serves instead: `next build && next start`.** That is safe here for a reason
that can be checked rather than assumed — `next build` reports **every route as `ƒ (Dynamic)`**,
because each carries `export const dynamic = 'force-dynamic'` and `sign-in` is a client component,
so nothing is prerendered and the build never reaches for a database.

**Verified locally through the CI path** (`CI=true`, so the config takes the build-and-serve branch):
**7 passed**. The per-test times also fell — 9.9s to 5.4s on the longest, 2.2s to 0.8s on the
shortest — which is the on-demand compilation that was never being measured, now absent.

**The general point, and it is the one this session keeps making: a check that has only ever run on
one machine has only ever been measured on one machine.** The browser suite passed locally seven
times before CI ran it once and found something local runs structurally could not.

#### Two more CI-only failures, both in the new browser step, both worth the trip

**The browser suite took three CI runs to go green, and each red was a different real defect that no
local run could have produced.**

| Attempt | What CI said | What it actually was |
| --- | --- | --- |
| 1 | `Timed out waiting 120000ms from config.webServer` | `next dev` compiling a route on a cold runner. Raising the timeout would have moved the failure to the per-test timeout, not removed it |
| 2 | `Process from config.webServer was not able to start. Exit code: 1` | `next build` failing with `Can't resolve '@fieldforce/ui-tokens'` on six files. **This job builds only `@fieldforce/core`** — its own step comment says the static job builds everything else |
| 3 | *(caught locally before pushing)* | `pnpm turbo run build --filter @fieldforce/console` reported **`3 successful`** and produced **no build at all** |

**The third is the one worth keeping.** `turbo.json` declared `outputs: ["dist/**"]` for every
workspace, and the console builds with Next, which writes `.next/`. **Turbo cached nothing, then
replayed that nothing as a success** — `3 successful, 2 cached` — and `next start` died with *"Could
not find a production build"*. Turbo warns (`no output files found for task …#build`) and the
warning scrolls past; `3 successful` is the line a human reads.

Fixed as `outputs: ["dist/**", ".next/**", "!.next/cache/**"]`, and **verified two-sided**: a cold
build writes `.next/BUILD_ID`; deleting `.next` and re-running restores it **from the cache** rather
than producing nothing.

**CI now builds the console in a NAMED step** rather than inside `config.webServer`, so the next
failure of this kind names itself instead of arriving as `Exit code: 1`.

**Verified locally through the exact CI sequence from a cold state** — every `dist/` and `.next`
deleted, then the build step, then `CI=true` so the config takes the `next start` branch:
**7 passed in 14.6s**, against 36s through `next dev`.

**The through-line of this whole session, stated once:** *a bundle, a function body, a database, a
knowledge graph, a test report and now a build cache have each reported success for work they did
not do.* Every one was found by making something run somewhere it had not run before.

#### D1 — what the browser suite costs in CI, measured

From the green run on `e82baa9`:

| Step | Duration |
| --- | --- |
| Install Chromium | **25s** |
| Build the console and its workspace packages | **18s** |
| Browser suite (7 tests) | **16s** |
| Prove it executed | **<1s** |
| **Total added to the database job** | **≈ 59 seconds** |

**Under a minute**, for the only check in this repository that loads the built application in a
browser. The `Install Chromium` step is the largest single item and is the one a runner cache would
remove if it ever matters.
