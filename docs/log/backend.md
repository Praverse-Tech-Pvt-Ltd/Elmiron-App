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

### W1-H — not sharing the database · 30 September 2026 · Model: Claude Opus 5

**One line: `BE-W125` is closed by running one spec file at a time, which costs 45 seconds and was
the cheap way to stop sharing — the expensive way was named first and would only have half-worked.**

#### A1 — the two ways to stop sharing, measured before choosing

**Both measured on a clean database with the Edge Function freshly served, 8 runs each.**

| | (a) file parallelism — before | (b) one file at a time — `fileParallelism: false` |
| --- | --- | --- |
| Failing runs | **1 of 8** | **0 of 8** |
| Wall clock | 52, **90**, 55, 52, 56, 57, 55, 54 s | 98, 99, 98, 100, 100, 105, 111, 103 s |
| Median | **55s** | **100s** |
| Every run's counts | — | `Test Files 73 passed (73)` · `Tests 972 passed \| 4 skipped (976)` |

**It also removes the variance, which was not the goal but is worth having:** the parallel set swung
52→90s, the serial set 98→111s.

**CI cost, from the green run on `c4d177f`:** the `Database and Gate 0 tests` step took **54s** inside
a **5m23s** job. Doubling that step puts the job at roughly **6m20s** — about 17% more, on a job that
had already absorbed 59 seconds of new browser time without complaint.

##### Why NOT per-worker databases, which was my own first answer

The template problem is solvable — build a dedicated `elmiron_template`, migrate it, never point
PostgREST at it, then `create database w<n> template elmiron_template`. **The reason it fails is
different, and decisive:**

```bash
grep -l "API_URL\|FUNCTION_URL\|signIn(" services/api/tests/*.spec.ts | wc -l   # 15
ls services/api/tests/*.spec.ts | wc -l                                         # 73
```

**15 of 73 spec files reach the database through PostgREST, GoTrue or the Edge Function**, and those
components are pointed at ONE database by the Supabase stack's own configuration. They cannot move to
a private database without reconfiguring and restarting the whole stack per worker.

So per-worker databases would isolate 58 files and **leave those 15 sharing** — the deadlock class
surviving in exactly the suites most likely to trigger it, since they are the ones that COMMIT global
rows and talk to out-of-process components. Plus a permanent fork in how a test reaches the database,
`db.ts` and `auth.ts` rewritten, a global setup creating and dropping N databases, and CI changes.
**Days of work to half-fix it.**

**Chosen: `fileParallelism: false`.** One line, no new code, nothing to re-tune, and the race cannot
occur rather than occurring less often.

#### A2 — the rates, and the verification that the config is real

**A flag is not a config.** The 8 runs above used `--no-file-parallelism` on the command line. That
proves the *behaviour* and says nothing about whether the committed config delivers it — which is this
session's entire subject. So it was measured again with **no flag at all**:

| | Median |
| --- | --- |
| parallel baseline | **55s** |
| `--no-file-parallelism` flag | **100s** |
| **config only, no flag** | **105s** (107, 104, 105 — 3 of 3 clean) |

The no-flag runs match the flag runs and not the baseline, so **`fileParallelism: false` is in
force.** Had they come back at 55s, the line would have been decoration and the flag would have been
doing all the work.

**Two of five verification runs were stopped early, deliberately.** Three runs already separated 105s
from 55s unambiguously, and the browser suite needed an uncontended database more than a fourth sample
was worth. Recorded rather than quietly dropped.

#### A3 / A4 — what CI's signal was worth, and where that is written

At **1 spurious red in 8**, a red on this suite was **not evidence about the change under test** — and
this project has already ruled that condition a broken signal once, in `BE-W92`. `W1-G` came within
one rerun of banking a green bought that way.

**That warning now lives in one place: `docs/COMPLETION-PLAN.md`, the `BE-W125` row**, which this
commit closes. It is not repeated in four files, because four copies of a caveat is how the undated
sentence in `blocked-on-you.md` reached the frontend track as current.

#### A — the mutation, designed to isolate WHICH mechanism is load-bearing

Two mutants, because "it passes now" does not say whether the config or `BE-W124`'s advisory lock is
doing the work. Same four files each time — `ai-control-plane`, `ai-gateway`, `sim-gateway`,
`tenant-boundary-restrictive`.

| Mutant | Result |
| --- | --- |
| **A** — lock removed from `ai-gateway`, config left at `fileParallelism: false` | **3 of 3 runs: `Tests 49 passed (49)`** |
| **B** — lock removed **and** `fileParallelism: true` | **3 of 3 runs: exactly 1 failed**, always `AI-D0 … each missing prerequisite alone refuses`, with **48 passing** as the positive control |

**What that settles.** Mutant A shows the advisory lock is now **uncontended, not load-bearing** — the
config alone suffices. Mutant B shows the race is real and that the config is precisely what suppresses
it. **The lock stays anyway**, because it is what makes re-enabling parallelism safe for the
`app_thresholds` half; it is inert, not redundant, and `vitest.config.ts` says so beside the setting.
**The DDL half has no such guard, so re-enabling parallelism brings `BE-W125` straight back.**

Both restored; `git diff` on `ai-gateway.spec.ts` is empty and the four files pass **49/49 in 3 of 3**
runs.

#### B1 — every turbo task, enumerated from the files

**Two `turbo.json` files** — `./turbo.json` and `./services/api/turbo.json`, found with `find`, not
recalled. **5 task definitions. 25 task instances** across 7 workspaces.

| Task | Instances | Declared `outputs` | What it writes | Verdict |
| --- | --- | --- | --- | --- |
| `build` | **4** — core, ui-tokens, mock, console | `dist/**`, `.next/**`, `!.next/cache/**` | core/ui-tokens/mock → `dist/` (incl. `dist/.tsbuildinfo`, resolved through `tsconfig.build.json` → `tsconfig.json` → `outDir: dist`); console → `.next/` (no `distDir`, no `output: standalone`) | ✔ **now** — `.next` was the mismatch, fixed in W1-G |
| `typecheck` | **7** | *(none)* | `apps/console/tsconfig.tsbuildinfo` — console is the only tsconfig with `incremental: true` | **mismatch, deliberately NOT fixed** |
| `lint` | **7** | *(none)* | nothing — no `--fix` and no `--cache` in any of the 7 scripts | ✔ |
| `test` | **7** | *(none)* | nothing — no coverage, no reporters, no `outputFile` anywhere; jest's cache is in OS temp, outside the repo | ✔ |
| `test` (api override) | **1** | `cache: false` | n/a | ✔ exempt by design |

**2 mismatches in 25.**

#### B2 — what a false cache hit would have hidden, per mismatch

**`build` → `apps/console`, the one that bit.** A false hit hid **the entire production build**.
`next start` died with *"Could not find a production build in the '.next' directory"*, reaching
Playwright as the uninformative `Process from config.webServer was not able to start. Exit code: 1`.

**And the version we did not get, which is worse.** The cache restored *nothing*, so the failure was
loud. **Had it restored a STALE `.next`, `next start` would have served an older build and the browser
suite would have passed against yesterday's code while reporting on today's** — silently, with a green
tick. **Absence is loud; staleness is silent. We were lucky in the direction of the failure.**

**`typecheck` → `apps/console`: a false cache hit hides NOTHING, and declaring the output would make
things worse.** Nothing consumes the `tsbuildinfo`; not restoring it costs a little time on the next
run. But a `tsbuildinfo` is how `tsc` records what it has already checked — so restoring one from a
cache keyed on a different input set could let `tsc --noEmit` skip work and report success. **That
would turn a speed cache into a seventh instance of the stale-artefact class.**

**So the test for `outputs` is not "does the task write it".** It is: *does something later CONSUME it,
and is a cached copy always as good as a fresh one?* For `.next`, yes to both. For a `tsbuildinfo`, no
to both.

#### B3 — proven two-sided, in this session

| Glob | Cold run | Then delete `.next` and re-run |
| --- | --- | --- |
| **corrected** `["dist/**", ".next/**", "!.next/cache/**"]` | `BUILD_ID` present | `Cached: 3 cached, 3 total` → **`BUILD_ID` RESTORED** |
| **wrong** `["dist/**"]` | `BUILD_ID` present, plus `WARNING no output files found for task @fieldforce/console#build` | `Cached: 3 cached, 3 total` → **reported success and produced NOTHING** |

`turbo.json` restored; `git diff` empty; a further cold-then-cached cycle confirms `BUILD_ID` comes
back.

#### B4 — the pattern, in `docs/gotchas.md`

All six instances are now in one table with the rule, because the pattern is the entry and the
instances are what make it persuasive: a **stale bundle** (`BE-W119`), a **stale function body**
(W1-C A2), a **stale database** (W1-E B3), a **stale knowledge graph** (`MR-35 D1`), a **stale test
report** (W1-G D2), and a **build cache that stored absence and replayed it as success** (W1-G).

> **When a check reads something it did not just produce, ask what produced it and when.**

#### C — `BE-W122`, and the correction that goes with it

**C1 was already done, and the brief's premise was one session out of date.** `/prompts` shipped in
W1-G E1 and is committed at `ed8d0b0`: the route, `prompt-review.tsx`, `prompt-review-list.tsx`, a nav
entry, and two browser specs. It calls the four existing RPCs and reuses `approvalAffordance` from
`knowledge-review.tsx` — **the third caller**, so four-eyes is one implementation across knowledge,
simulation content and prompts. **Verified by reading the files, not assumed from having written
them.**

**C2 — proven in the browser, and then checked in the database.** `7 passed (59.0s)`. The test names
are not the evidence; this is:

| | Observed |
| --- | --- |
| Session | `fe33093f-a270-4793-bd4d-668b11fd43ad`, started `2026-09-30T05:59:51Z` |
| The prompt it pinned | `ai_doctor` **version 1**, status **`approved`**, text `"Practice prompt for run 3fee39…"` — a string minted by that run, so it can only have come from `/prompts` |
| `created_by_user_id <> decided_by_user_id` | **true** — drafted by one admin, approved by a second |
| Stored attestation | `"Placeholder prompt for a local test. No product claim."` |

So a prompt was drafted through the UI by one admin, approved through the UI by a second, and
`start_sim_session` pinned **that** prompt — having refused the same scenario before approval.
**Nothing in the path touched SQL.**

**C3 — the seeder is still needed, and should be KEPT.** Enumerated from the file: it now inserts into
exactly three tables — `organisations`, `territories`, `user_profiles` — plus `createAuthUser` through
GoTrue's admin API. **It creates no content whatsoever**; the only surviving mention of
`ai_prompt_versions` is a comment recording that it used to.

Three things stop it becoming the route people use:

1. **`assertLocalhostOnly` on BOTH URLs before either is touched** — and the order matters, because the
   identity is minted over HTTP before the database connection opens, so a guard on the DB URL alone
   would refuse after the user already existed.
2. **There is nothing left for it to bypass.** No prompt, no persona, no scenario — so it cannot route
   around four-eyes. That was only ever possible while `ai_prompt_versions` had no screen.
3. **What it does create, no screen can.** Minting an `auth.users` identity is a GoTrue admin-API
   operation, correctly not exposed to any console. That is the whole of its remaining job.

**C4 — the mis-filing, recorded as its own failure.** `BE-W122` said the table had *"no RPC and no
console route"*. **All four RPCs existed** — `submit`, `approve`, `reject` and
`retire_ai_prompt_version`, in `AI_RPC` since `20260924000700`. Only the route was missing. **I filed a
gap without grepping for the thing I claimed was absent**, and it described the work at twice its true
size. **A register that carries a wrong gap costs more than one carrying none, because somebody builds
against it** — the same shape as the undated `blocked-on-you.md` sentence the frontend track read as
current.

#### D — the watchdog's blind spot

Written for the operator in `docs/blocked-on-you.md` → **W1-H Part D**. The property: **a monitor
running on the same platform as the thing it monitors cannot detect that platform stopping.** All five
workflows went quiet together, 23 Aug – 7 Sep, from one cause. **No change inside this repository fixes
it**, because any check added here runs on the same platform and disappears with it.

Four options with costs are tabled there; **the dead-man's switch is recommended and deliberately NOT
added** — it is a dependency and a recurring cost, and the only option whose logic points the right
way: it alarms on the *absence* of a signal, so the outage cannot silence the alarm.

Beside it, D3: **`destroyedTotal` is 0**, so a schedule alarm still would not tell you the purge works.
That needs one object aged past `purge_after` in staging and observed leaving Storage.

#### E — the merge

Measured: `main`'s `ci.yml` is blob `c345ec3` and contains **none** of the five steps this branch added
(Edge Function serve, Chromium, console build, browser suite, proof gate). `main` has **75 migrations
against 85**; the branch is **39 commits ahead**; `gh pr view 2` reports **MERGEABLE**; **still
draft**.

Merging would newly give `main`: an exercised Edge Function, a console that is actually **built**, a
real browser loading it with the hydration assertion, and 10 more migrations proven to apply and roll
back. **Recommendation unchanged: un-draft now, merge after the 4 October demo** — the AGAINST case was
always timing and expires on 5 October. **One thing now argues against leaving it long after that:**
`main` has no check that loads the built application, and two of the six stale-artefact instances were
findable only by one.

**Not merged. The decision is the operator's.**

### W1-I — the chatbot · 30 September 2026 · Model: Claude Opus 5

**One line: `mr_chat` exists, through the same gateway as the other three features, and the thing that
stops it inventing a product claim is a catalogue-derived check on its ANSWER — not its prompt.**

#### A1 — serialisation holds in CI, and the log proves it rather than the stopwatch

| | before (`c4d177f`) | after (`6766e0e`) |
| --- | --- | --- |
| `Database and Gate 0 tests` step | **54s** | **102s** |
| database job total | **5m23s** | **5m40s** |
| counts | — | `Test Files 73 passed (73)` · `Tests 972 passed \| 4 skipped (976)` |

**The direct evidence is vitest's own duration breakdown, not the timing:**

```
Duration 97.47s (transform 1.03s, setup 0ms, collect 7.37s, tests 77.25s, environment 13ms, prepare 4.40s)
```

**`tests 77.25s` INSIDE a 97.47s wall clock.** Under file parallelism that figure is the sum of
per-file time across workers and exceeds wall clock badly — W1-G's CI log showed **`tests 932.92s` in
a 54-second step**, seventeen times oversubscribed. Sequential execution is the only way `tests` fits
inside `Duration`. That is the log showing one file at a time.

**Note the job total rose 17s, not 48s.** Other steps happened to be faster on that run. The honest
claim is that the *step* doubled; the job cost is smaller than the step cost and varies.

#### A2 — what could override the config, established by enumeration

1. CI invokes the suite **once**: `pnpm turbo run test --filter @fieldforce/api --force`
   (`ci.yml:248`). No flags.
2. **Zero occurrences** of `fileParallelism`, `no-file-parallelism`, `maxWorkers`, `minWorkers` or any
   `VITEST_*` across `ci.yml`, `scripts/ci-local.mjs`, both `package.json`s and both `turbo.json`s.
3. The api `test` script is exactly `vitest run` — nothing to conflict with.
4. Seven `vitest.config.ts` files, one per workspace; vitest resolves from the package root, so only
   `services/api/vitest.config.ts` applies to this suite.
5. **No `vitest.workspace.*` file exists** — the one thing that could re-declare pooling across
   packages and silently beat a per-package config.

#### A3 — the line for a future session asked to "speed up CI"

**The 45 seconds bought `BE-W125`. At 1 spurious red in 8, a red was not evidence about the change
under test. Re-enabling `fileParallelism` brings the deadlock straight back: the `app_thresholds` half
is guarded by the advisory lock in `tests/global-thresholds.ts`, the DDL half has no guard at all.**
Recorded beside the setting and in the closed `BE-W125` row, not only here.

#### B — `mr_chat`, built

| Piece | Where |
| --- | --- |
| The flow and its contract | `packages/core/src/field/gateway/mr-chat.ts` |
| The catalogue behind the control | `services/api/supabase/migrations/20260930000100_mr_chat_scope_terms.sql` |
| Its **own** stub shape | `_shared/stub-provider.ts` — `inScope: false`, so a stubbed chat redirects rather than says something |
| Gateway dispatch | `ai-gateway/index.ts` — a fourth feature, still one function |
| Unit tests | `mr-chat.test.ts` — **20 passed (20)** |
| End to end | `services/api/tests/mr-chat.spec.ts` — **13 passed (13)** |

**B1 — nothing shared with `product_qa`, and it is asserted rather than claimed.** Its own feature id,
its own `ai_feature_enabled:mr_chat`, its own approved prompt, and **its own output schema name**
`MrChatOutputSchema`. One test turns `product_qa` **on** while `mr_chat` stays **off** and shows
`mr_chat` still refused `45011` → 403. Sharing an output schema name is how two modes start being one,
which the spec forbids.

#### B3 — what stops an invented product or medical claim

**`mr_chat` cannot be restricted to approved knowledge, and that is not a shortcut.** Approved
knowledge *is* product material; a chat limited to it could not answer *"how do I file a call
report"*, which is its whole purpose (`AI-SPEC` §2 A1). So the question has to be answered without
that constraint, and the honest answer has three parts:

1. **`detectPatientSignals` on the message, before anything leaves the building.** The spec calls this
   the capability where it matters most, and §10's *"must not become a clinical decision-support
   system"* has this as its only enforcement.
2. **A catalogue-derived product-name check on the QUESTION** — if the rep names one of their own
   organisation's products, the model is never called.
3. **The same check on the ANSWER, and this is the one that matters.** A reply naming a product is
   **discarded**. This is the half a prompt cannot provide: it does not ask the model to behave, it
   refuses to pass on the result when it did not.

**`inScope` in the output is the model's own declaration and is treated as a hint** — honoured when
false, ignored when true. A control that asks the thing being controlled whether it complied is not a
control.

**Where the terms come from is the point.** `mr_chat_scope_terms()` reads `products` under RLS —
brand names **and** generic names, active and inactive. That tenant's real catalogue, not a keyword
list in a TypeScript file that would go stale the first time a product was renamed and be wrong for
every other organisation from the day it was written.

**THE RESIDUAL RISK, and it is real.** *"Is 400mg twice daily normal for interstitial cystitis?"*
names no product, carries no patient identifier, and reaches the model. **Nothing in this code stops
it.** That is not an oversight — it is the cost of having a general assistant at all, and the honest
options are to accept it or to delete `mr_chat`. It is **a test in the suite**, so the gap is visible
rather than implied, and it is written up for the operator rather than mitigated with prompt wording
that would only look like a fix.

#### B2 / B4 — the end-to-end evidence

**13 of 13 over real HTTP**: a real GoTrue password sign-in, a real `POST` to the served Edge
Function, the function's own Deno process calling the RPCs as that MR.

| Asserted | Observed |
| --- | --- |
| The **database** chose the prompt | `ai_requests.prompt_version_id` = the approved `mr_chat` version; the caller never names one |
| Feature recorded | `feature = 'mr_chat'` |
| Cost fields | `model_provider = 'stub'`, `model_name`, `input_tokens`, `output_tokens` all non-null |
| Whose request | `user_id` = the signed-in MR, `organisation_id` = their org — not whoever the gateway runs as |
| no token | **401** |
| no `message` | **400 / `22023`** |
| `45011` | **403** |
| `45012` | **429** |

**The guardrail proof is not a message.** The stub always reports itself as `stub` with non-null
tokens, so **`model_provider IS NULL` is reachable only if `generate` never ran** — asserted with its
positive control, because a null could otherwise mean a broken insert. The catalogue check is proven
the same way: a question naming this run's brand is `blocked` with **no provider recorded**, so the
redirect came from the catalogue and not from asking a model. The generic name matches too.

#### B5 — cross-tenant, two-sided

The rival organisation's MR gets terms **excluding** this run's brand and generic name. **Positive
control:** after inserting a product into *their* catalogue, the same function returns **their** brand
and still not ours — so an empty array cannot be mistaken for a dead function.
`has_function_privilege('anon', 'public.mr_chat_scope_terms()', 'execute')` is **false**.

#### B6 — the mutation

Removing the **answer-side** catalogue check — the clause that discards a reply naming a product even
when the model claims it stayed in scope — killed **exactly 1 test**
(*"DISCARDS an answer naming a product even when the model claims it is in scope"*), with **19
passing** as the positive control. Restored; `MUTANT` count 0; **20/20**; core rebuilt.

#### Two things found rather than assumed

**`BE-W126` — the patient guardrail misses a bare `patient <Firstname Lastname>`.** My first guardrail
test failed, and the reason was not my test. Measured against the built guardrail:

```
"my patient Mr Sharma should take what dose"   -> patient_named, patient_specific_advice
"patient named Meena has bladder pain"         -> patient_named
"patient Meena Kumari, 42, has bladder pain"   -> NOTHING
```

Every `patient_named` pattern needs a title or the literal word `named`, so the commonest way a person
writes it falls through — **in the capability the spec says it matters most in.** Registered, and
deliberately **not** fixed here: widening it is two lines with a large false-positive surface
(*patient portal*, *patient safety*, *Patient Information Leaflet*), and the guardrail's own header
states the asymmetry that must decide the tuning. **A test asserts the current behaviour**, so fixing
`BE-W126` makes that test fail, and the failure is the instruction to rewrite it as a refusal.

**A teardown that could never succeed.** My first `afterAll` copied `ai-gateway.spec.ts`'s
`delete from public.ai_requests ...`, which printed on **every** run:

```
ai_requests is append-only: DELETE is not permitted by any role
```

The table is an audit trail and refuses deletion by design, so that line can never work in any suite.
Removed from this one — **a warning that always fires is a warning people learn to skim**, which is
worse than no cleanup at all. **`ai-gateway.spec.ts` still carries the identical dead line**; it is
noise rather than a defect, and it is recorded here rather than fixed in a commit about something else.

#### C — the frontend handover

Three contract requests appended to `docs/contract-requests.md` under **"Answers — 30 September"**,
each to `CR-5`'s completeness: **`BE-CR-3`** Product Q&A, **`BE-CR-4`** the practice session,
**`BE-CR-5`** MR Chat. Each gives who may call it, the exact schema names in `packages/core` (read
from the source, not recalled), every refusal with its SQLSTATE **and** HTTP status, and what the
screen shows for each.

**C2's rulings, and the rule that produced them.** The demo ruling was that a stubbed answer must not
be shown to an audience. **A screen is not an audience — a developer building against a stub is being
unblocked, not misled. A rep in a pilot IS an audience, and the most consequential kind**, because an
audience at a demo knows it is a demo and a rep believes the app.

> **A screen may reach a rep when the stub's behaviour is indistinguishable from a legitimate real
> state.**

| | Build now | To a pilot rep |
| --- | --- | --- |
| `BE-CR-3` Product Q&A | **Yes** | **Yes** — `not_available` is the truthful state of a company with no approved knowledge |
| `BE-CR-4` conversation | **No** | **No** — every turn is the stub marker, which no working system ever produces |
| `BE-CR-4` list / history / picker | **Yes** | **Yes** — real today, unchanged by `#5` |
| `BE-CR-5` MR Chat | **Yes** | **Yes, with the flag off** |

**And the flag is the mechanism rather than a promise:** `ai_feature_enabled:mr_chat` ships **off**, so
a pilot rep can have the screen and see nothing until somebody switches it on. **The code enforces
that, not a plan to remember it.**

**C3 — repeated where they will see it, for the third time**, at the top of the new section: six
screens can leave `127.0.0.1:4010` today with no backend change, a real device cannot reach
`127.0.0.1` at all, and **if the switch does not happen before the developer moves, it does not
happen.**

#### D1 — the flag, and why there is no small honest fix

**Plainly: there isn't one, and the engineer stays in the loop until `BE-W106` is answered.**

The reasoning is not a preference. `ai_feature_enabled:<feature>` is an `app_thresholds` row with
`scope = 'global'`, and `20260923000300_app_thresholds_not_directly_readable.sql` states the model
question in its own words: *"a `global` row is shared by every tenant. That is the model question"*,
and *"this migration does not answer `BE-W106`."*

So:

* **A write screen is not a small fix, it is a tenancy violation.** One company's admin pressing a
  toggle would switch the feature on for **every** organisation, because the row is global. That is
  precisely what `BE-W106` exists to decide.
* **A territory-scoped row does not help.** `app_thresholds.scope` does support `'territory'`, but
  `ai_begin_request` calls `threshold('ai_feature_enabled:' || feature)` with **no territory**, so the
  resolver matches `territory_id is null` only. Making territory rows visible means changing
  production SQL, which pre-empts the decision outright.
* **Even a READ-ONLY indicator pre-empts it.** `app_thresholds` is no longer directly readable, so it
  would need its own RPC — and a per-company console saying *"AI is ON for your company"* would be
  reporting a **global** fact in per-company words. That is the exact model confusion `BE-W106` is
  about, shipped as a screen.

**What can be done now, and it is documentation rather than a mechanism:** the checklist's step 1
carries the exact statement to run, so the engineer's involvement is one auditable copy-paste per
company rather than a diagnostic conversation. **That is the whole of the available improvement, and
calling it a fix would be dishonest.**

#### D2 — PR #2

**Un-drafted, as recommended.** `gh pr ready 2` → *"marked as ready for review"*; `gh pr view 2` now
reports **`draft=false`, `MERGEABLE`**. It costs nothing and it is the one thing that should not wait.

**What merging after 4 October requires:**

1. **A review.** 40 commits, 11 new migrations against `main`'s 75, four console routes, a browser
   suite and a new CI section. Nobody has reviewed it.
2. **`main` merged in again** on the day, and `gh pr view 2 --json mergeable` re-read — a `CONFLICTING`
   answer must be re-read after 30 seconds before it is believed.
3. **Nothing technical.** CI is green on `HEAD` on both jobs and `main ahead: 0`.

**What `main` gains that it does not have today** — measured, `main`'s `ci.yml` is blob `c345ec3` and
contains none of it: an exercised Edge Function, a console that is actually **built**, a real browser
loading it with the hydration assertion and its negative control, and 11 more migrations proven to
apply to an empty database and to roll back.

**Not merged. The decision is the operator's.**

### W1-J — closing the guardrail · 30 September 2026 · Model: Claude Opus 5

**`BE-W126` is closed with a corpus, the clinical residual is closed with a control, and the sweep
found the dead teardown was the only one of its kind in the repository.**

**A correction to my own framing first, because the reviewer was right and it changes the scope.** I
wrote that *"`mr_chat` shipped with a known hole in its most important control."* That is wrong in the
way that matters: **`detectPatientSignals` is shared**, and `grep` gives the blast radius —
`product-qa.ts:149`, `mr-chat.ts:191`, `sim-doctor.ts:117`. The gap was in `product_qa` and
`ai_doctor` from the day they were written; `mr_chat` only exposed it. **`ai_coach` does not call it**,
which is defensible — it analyses turns already guarded at record time — and is stated here rather
than glossed as "all four".

**And the mitigation I offered was worse than the reviewer's objection.** I said the exposure was
limited because `#5` is open so nothing reaches a real provider. **That is a mitigation whose expiry I
do not control.** The operator may answer `#5` any day. A hole guarded by somebody else's unanswered
email is not guarded.

#### A1 — the corpus, written before the patterns were touched

`packages/core/src/field/gateway/guardrails.corpus.ts`. Every entry carries its own reason, because a
phrase without one cannot be argued with.

**The hard half is `MUST_NOT_REFUSE`, and the hardest thing in it is a DOCTOR'S NAME.** `AI-SPEC`
§2 A3: *"A doctor's name: possible — it is free text."* A rep types doctor names constantly; it is the
core of the job. **`patient Meena Kumari` and `Dr Meena Kumari` are the same shape of text and need
opposite answers**, which is why *a sequence of capitalised words* can never be the signal, and why
any tuning that refuses `add Dr Sharma to my beat plan` has broken the product in order to protect it.

#### A2 — what the detection uses, and why it is more than a longer regex

Three parts, none of which works alone:

1. **The keyed token** — `patient` or `pt`, the latter being how a clinician abbreviates.
2. **A stoplist, `PATIENT_COMPOUND_WORDS`** — `portal`, `safety`, `information`, `support`,
   `education`, `adherence`, `leaflet` and the rest of the product's own vocabulary. **This is what
   makes the widened rule usable at all**; without it, `where is the patient portal` is a patient.
3. **A capitalisation test on the FOLLOWING word**, which distinguishes a name from a common noun —
   and which is only safe *because* (2) has already removed the title-cased app vocabulary.

Plus a second, independent rule for the half with no keyed token at all — `Mrs Sharma aged 62`,
`58M with IC`, `a 42 year old female`: an age or sex marker near a person, **suppressed by a clinician
title**. That suppressor is the only reason this rule can exist beside a product whose core workflow
is doctor names.

#### A3 — the numbers, including what the tuning gets wrong

**Corpus: 15 must-refuse, 27 must-not-refuse. 15 of 15 refused. 0 of 27 wrongly refused.**

**A clean sweep meant the corpus was too kind, so twenty further realistic phrases were probed.**
Three fired, and two were genuine false positives the first tuning would have shipped:

| Probe | Verdict |
| --- | --- |
| `the 12F form needs signing` | **FALSE POSITIVE** — a form number read as age+sex |
| `I have 25M in my territory target` | **FALSE POSITIVE** — twenty-five million read as a 25-year-old male |
| `patient X reported nausea` | **fires, and correctly** — pseudonymised or not, it is one person's case, and the asymmetry favours refusing |

**Both false positives were fixed by requiring a clinical context word after the shorthand** —
`58M with IC` has one, `25M in my territory` does not — and **both are now permanent corpus entries**,
along with four more probes (`the study had 400 patients aged 18 to 65`, `how many patients are on the
programme`, `Mrs Iyer from the pharmacy called`, `aged care facility visit tomorrow`). A second probe
round of twenty fresh phrases found **nothing** wrong on either side, including `15M rupees`,
`60M population`, `Dr Iyer has 200 patients aged over 60` and `a 42 year old programme`.

**What it still gets wrong, named rather than counted:**

| Phrase | Result | Why it is left |
| --- | --- | --- |
| `Sharma has been on it three months and reports burning` | **not refused** | A bare surname with no title, no `patient` token and no age. **Indistinguishable from a doctor's name** — this is a ceiling, not a tuning failure |
| `she has been on it three months, any concerns` | **not refused** | A pronoun. No identifier of any kind |
| `aged 62 and still working` | **not refused** | An age with no name and no sex word is indistinguishable from `the policy aged 62 days` |

**One bug in what I wrote, caught by the corpus rather than by me:** the title regex had no `i` flag,
so `Mrs Sharma aged 62` matched nothing. The corpus failed, named the phrase, and the fix was one
character.

#### A4 — the test that asserted the old behaviour

W1-I wrote it as `expect(result.kind).toBe('answered')` with the note that fixing `BE-W126` would make
it fail and **that the failure was the instruction to rewrite it as a refusal.** It failed exactly as
predicted — `AssertionError: expected 'patient_specific' to be 'answered'` — and it is now rewritten as
the refusal, with the change recorded in the test body rather than made quietly.

#### A5 — before the provider, for EVERY feature sharing the guardrail

All three already had a `model_provider IS NULL` proof, but **all three used old-pattern phrases**
(a phone number, `my patient is 62`, `my patient Mr Sharma`) — so none exercised the new detection.
One end-to-end test was added to each, using the bare-name phrase that caught nothing before:

| Feature | Suite | Proof |
| --- | --- | --- |
| `product_qa` | `ai-gateway.spec.ts` | blocked, `model_provider IS NULL`, existing positive control |
| `mr_chat` | `mr-chat.spec.ts` | blocked, `model_provider IS NULL`, existing positive control |
| `ai_doctor` | `sim-gateway.spec.ts` | blocked, `model_provider IS NULL`, **and its own positive control in the same session** |

**43 of 43** across the three suites.

#### A6 — the mutation

The first mutant (removing the bare-name rule entirely) killed **6** tests — too broad to locate
anything. The narrow one isolates what probing taught: **removing the context-word requirement from
the age-sex shorthand killed exactly 1 test**, with **67** passing as the positive control, and the
killed test named the two phrases. Restored; 68 passed | 4 skipped.

#### B — the clinical question, decided

**Options and costs are tabled for the operator in `docs/blocked-on-you.md` → W1-J Part B.** A prompt
instruction was not among them, for the reason this project already established.

**Built: a deterministic check on the QUESTION and the ANSWER**, the same shape as the catalogue
check. The reviewer's position survived contact with the corpus, with one addition — **the suppressor
is what makes it usable**. A clinical term only counts when the question is not framed as a procedure,
because these all contain clinical words and must all be answerable:

* **`how do I report an adverse event`** — a regulatory obligation, and the worst false positive
  available
* `what do I do if a doctor asks about dosing`
* `the doctor asked about contraindications, what is the process`

**B3 numbers: 11 of 11 clinical questions refused, 0 of 17 process questions wrongly refused.**

**A second bug the corpus caught in what I had just written:** the unit was written `\bmg\b`, which
never matches `400mg` — there is no word boundary between a digit and a letter. **The exact sentence
W1-I recorded as the residual still passed.** The digits had to be part of the pattern.

**And the W1-I test asserting the limit failed**, exactly as A4's did, and is rewritten the same way —
plus a new one proving a clinical claim in the ANSWER is discarded whatever the question was.

#### C1 — the sweep

**14 tables are deleted from across the suites. Seven refuse DELETE unconditionally** — tested with
`delete … where false`, so only statement-level refusals fire: `ai_requests`, `consent_records`,
`adverse_event_reports`, `analysis_overrides`, `app_thresholds`, `course_enrolments`,
`lesson_completions`.

**Every occurrence against those seven was then classified, and the result is reassuring:**

| Suite | Table | Verdict |
| --- | --- | --- |
| `ai-gateway.spec.ts` | `ai_requests` | **DEAD TEARDOWN — the only one. Removed.** |
| `ai-control-plane.spec.ts` | `ai_requests` | assertion (`sqlstate(...)`) |
| `adverse-events.spec.ts` | `adverse_event_reports` | assertion (`rejects.toThrow(/append-only/)`) |
| `consent-withdrawal-bounds.spec.ts` | `consent_records` ×2 | assertions |
| `decision-debt.spec.ts` | `app_thresholds` | assertion |
| `lms-core.spec.ts` | `course_enrolments`, `lesson_completions` | assertions |
| `rls.spec.ts` | `consent_records`, `analysis_overrides` | assertions |

**One dead line in the whole repository, and every other delete against an append-only table is a
deliberate assertion that the refusal works.** The warning it printed every run is gone.

#### C2 — did the contract requests reach the frontend, and what happens if they do not

**Appended is not read, and I cannot claim they were read.** What can be established: `BE-CR-3`,
`BE-CR-4` and `BE-CR-5` are in `docs/contract-requests.md` on **this branch**, which is **PR #2, still
unmerged**. So they are not on `main`, and a frontend developer working from `main` has not seen them
unless they are reading this branch.

**That is the honest status: written, pushed, unmerged, unacknowledged.** There is no read receipt in
this repository and inventing one would be worse than saying so.

**What happens if the developer moves before the switch.** `CR-3`'s answer has now been repeated three
times: six screens can leave `127.0.0.1:4010` today with no backend change, and **a real device cannot
reach `127.0.0.1` at all** — on a handset that address is the handset. If the switch does not happen
before they move, **the demo runs on an emulator or not at all**, and the three contract requests
become documentation for whoever inherits the app rather than instructions for the person who can act
on them this week. **The backend cannot make that switch; it is entirely frontend work.**

#### D1 — the state of the week

| # | Capability | State | Waiting on |
| --- | --- | --- | --- |
| 1 | **Product Q&A** (`product_qa`) | **BUILT AGAINST A STUB** — flow, guardrails, citations, audit, end to end over HTTP | **`#5`** only. The screen is `BE-CR-3` and can be built now |
| 2 | **MR Chat** (`mr_chat`) | **BUILT AGAINST A STUB** — flow, patient guardrail, catalogue check, clinical check, end to end | **`#5`** only. The screen is `BE-CR-5` and can be built now |
| 3 | **Learning tutor** (`lms_tutor`) | **DOES NOT EXIST** — no flow file, no gateway dispatch, no tests | Design, then `#5`. Nothing has been started |
| 4 | **AI Doctor** (`ai_doctor`) | **BUILT AGAINST A STUB** — sessions, turns, personas and scenarios authored and approved through the console, proven in a browser | **`#5`**, plus the prompt text somebody must write |
| 5 | **AI Coach** (`ai_coach`) | **BUILT AGAINST A STUB** — analysis contract, five dimensions, `C27` enforced in RLS | **`#5`**, plus the scoring question the operator has not answered |
| 6 | **Voice in practice** | **DOES NOT EXIST** — no flow, no vendor, no corpus | A speech vendor (`BE-W32`), the bake-off corpus, and `#5`. Furthest away |

**The control plane under all six is BUILT AND PROVEN**: flags, approved prompts with four eyes, the
daily allowance, the audit trail with no conversation in it, and the Edge Function gateway — exercised
in CI on every push.

#### D2 — what changes on the day `#5` is answered

**One file changes for three features.** `createStubProvider` is swapped for a real
`LlmProvider` in `services/api/supabase/functions/ai-gateway/index.ts`. `product_qa`, `mr_chat` and
`ai_doctor` become real that day, because everything else — the flag, the approved prompt, the
guardrails, the citation validation, the audit row, the refusal mapping — is already there and already
tested against a stub that deliberately returns the least useful valid answer.

**What still needs work after that, and it is not small:**

* **`ai_coach` needs the scoring question answered** before a score is shown to anybody. The flow
  works; what a number means is a product decision.
* **`product_qa` needs approved knowledge.** With none, it correctly answers *"approved information
  not available"* to everything. `#7`, the product catalogue, is the blocker — not `#5`.
* **`ai_doctor` needs its prompt written** by the sales training lead, and a persona and scenario
  approved by two admins. The screens exist; the content does not.
* **`lms_tutor` and voice need building**, not configuring.
* **`BE-W106`** still means the AI flag is a global row with no screen, so an engineer switches each
  feature on per company.

**So: `#5` makes three features real in one file, and changes nothing about the two that do not exist
and the one that is waiting on a different decision.**

### W1-K — the learning tutor · 30 September 2026 · Model: Claude Opus 5

**`lms_tutor` exists, is dispatched, and is the strongest of the five features — because it is the one
with approved text in front of it.** Five of six capabilities are now built against the stub; only
voice remains unbuilt.

#### A — the ceiling, put to the operator in its own words

`docs/blocked-on-you.md` → **W1-K Part A**, as a **named accepted risk** carrying the three actual
sentences rather than the phrase "detection is imperfect":

> *"Sharma has been on it three months and reports burning"*
> *"she has been on it three months, any concerns"*
> *"aged 62 and still working"*

**A3 — it is a ceiling, not a tuning failure, and the entry says so explicitly.** To catch a bare
surname the detector would have to refuse *"Sharma asked for the leaflet"*, and a guardrail that stops
reps naming doctors is switched off within a week. A pronoun carries no identifier at all; no pattern
finds one that is not there.

**A2 — what accepting it means.** Today: nothing, because no provider is configured. **From the day
`#5` is answered, those sentences go to a third-party model.** Four options are tabled with costs. The
honest ranking given: a **confirmation step** is the only in-app option that catches a pronoun, and
**vendor terms** are the only thing that helps with sentences nobody predicted. **A stricter pattern is
the option that looks like progress and is not** — it trades the product's core workflow for one of
the three sentences.

#### B1 — what the tutor's context is restricted to, and why

**One lesson. Not the course, not approved knowledge, not both.**

`lms_tutor_lesson_context(uuid)` returns the title and body of **exactly one lesson**, and only if:

* the caller is **ENROLLED** on that course version — not merely in the same organisation. Without
  this the tutor is a way to read the whole course catalogue;
* the version is **PUBLISHED** — a draft lesson is unapproved text, and explaining it would defeat
  `C24` through a side door;
* the lesson is in the caller's organisation.

**One message for all three failures** (`42501`), because distinguishing them would tell a caller which
courses exist.

**Why not the whole course:** a tutor explaining lesson 3 does not need lesson 7, and **anything it is
given it can quote**. Why not approved knowledge as well: that is `product_qa`'s corpus, and mixing
them would make the tutor a second product-information tool with none of `product_qa`'s citation
machinery.

#### B4 — what stops an invented claim, and here the answer is genuinely stronger

**`mr_chat`'s honest answer was a catalogue check that discards an answer after the fact.** The tutor
is not in that position: it has the company's own published lesson text in front of it. **So yes — it
IS restricted to the lesson's own content, and that restriction is the control.** The same shape
`product_qa` uses, and the only shape that prevents invention rather than catching it:

1. **The model is given one lesson and told to answer only from it.** No other lesson, no course tree,
   no knowledge corpus.
2. **`groundedInLesson` is a required output field**, and false — or an empty explanation — is
   **discarded** and replaced with the referral sentence.
3. **`groundedInLesson: true` is NOT taken on trust.** The explanation is additionally checked with
   `isClinicalQuestion`, so a tutor that wanders from *"what does chronic mean"* into a dose is refused
   whatever it claimed. **A control that asks the thing being controlled whether it complied is not a
   control.**

**Why not demand quoted spans, which would sound stronger:** it would be a false promise. Verifying
that an explanation is *supported* by a passage is the same problem as the explanation; a substring
check is satisfied by quoting one word. `product_qa` can demand exact chunk ids because its answer IS a
retrieval — a tutor's answer is a restatement. **What is enforced is what can be enforced.**

#### B2 / B3 — its own everything, and both guardrails before the provider

Own feature id, own flag (`ai_feature_enabled:lms_tutor`), own approved prompt, own output schema name
`LmsTutorOutputSchema`, own stub shape (`groundedInLesson: false`, so a stubbed tutor refers the
learner to a person). **Proven by a test that switches `mr_chat` ON while `lms_tutor` stays OFF and
shows `lms_tutor` still refusing `45011` → 403.**

**Both shared guardrails fire before any provider call** — the patient detector *and* the clinical
check, the same implementations the other features use, scored against `guardrails.corpus.ts`. The
patient case additionally proves **the lesson is never even fetched**, because the guardrail runs
first.

#### B5 / B6 — end to end over HTTP

**13 of 13** in `services/api/tests/lms-tutor.spec.ts`:

| Asserted | Observed |
| --- | --- |
| The **database** chose the prompt | `ai_requests.prompt_version_id` = the approved `lms_tutor` version |
| Feature recorded | `feature = 'lms_tutor'` |
| Cost fields | `model_provider = 'stub'`, `model_name`, both token counts non-null |
| Whose request | `user_id` = the learner, `organisation_id` = their org |
| no token / no `lessonId` | **401** / **400 `22023`** |
| `45011` / `45012` | **403** / **429** |
| patient question | `blocked`, `model_provider IS NULL`, lesson never fetched |
| clinical question | `blocked`, `model_provider IS NULL` |
| positive control | an ordinary question reaches the provider, `model_provider = 'stub'` |

**Scope, two-sided:** a published lesson in the **same organisation** the learner is not enrolled on →
**403 `42501`**; a **rival organisation's** published lesson → **403 `42501`**; **positive control** —
the enrolled lesson returns **200**. `has_function_privilege('anon', …)` is **false**.

**The mutant:** removing the answer-side clinical check — taking `groundedInLesson: true` on trust —
killed **exactly 1** test, with **85** passing as control. Restored; **86 passed | 4 skipped**.

##### The fixture bug the positive control caught, which is the point of having one

The spec first enrolled the learner with `assign_course` as the admin and stopped there. **That creates
a `course_assignments` row and no enrolment** — enrolment is created by the LEARNER calling
`start_course_version`. So the tutor correctly refused the lesson the learner was supposed to be
enrolled on, and **all three scope tests passed for the wrong reason**: two 403s that meant scope and
one that meant a broken fixture, indistinguishable without the control.

**Three 403s would have read as a working tenant boundary.** The positive control is the only thing
that told them apart, and it is the same lesson W1-J learned about probing: a check that cannot fail
for the right reason is not evidence.

#### C1 — did the contract requests reach the frontend? What I know, not what was written

**I cannot claim they were read, and nothing in this repository could tell me.** What is established:

* `BE-CR-3`, `BE-CR-4` and `BE-CR-5` are in `docs/contract-requests.md` **on this branch**;
* this branch is **PR #2**, which is **un-drafted and MERGEABLE but NOT MERGED**;
* therefore they are **not on `main`**, and a developer working from `main` has not seen them.

**Status: written, pushed, unmerged, unacknowledged.** There is no read receipt here and inventing one
would be worse than saying so. **The one thing that would change it is merging PR #2**, which is the
operator's call and is recommended for after 4 October.

#### C2 — the mock switch: who does it, and when

**Nobody currently does it, and that is the honest answer.**

Six screens can leave `127.0.0.1:4010` today **with no backend change**, and **a real device cannot
reach `127.0.0.1` at all** — on a handset that address is the handset. The work is entirely in
`apps/field`: change the base URL and delete the mock fallback. **The backend cannot do it**, and no
backend session can.

**If the frontend developer moves after the demo without doing it:**

* the demo runs **on an emulator**, or on a device that cannot reach the API;
* the three contract requests become **documentation for whoever inherits the app**, not instructions
  for someone who can act this week;
* and the six screens stay on the mock until somebody is assigned. **There is no scheduled owner.**

**This has now been written three times** — 28, 29 and 30 September — each time to a document. If it
matters, it needs to be said to the person, not to the repository.

#### D1 — what exactly remains unanswered about scoring

**My own W1-J wording was imprecise and this corrects it.** I wrote that `ai_coach` waits on *"the
unanswered scoring question"*, which suggests something about what a score means. It is not that.

**`C26`/`C27` already settled what a score is and who may see it**, and the safe default is **built**:
scores exist on practice simulations and LMS assessments, visible to **the MR and the company admin
only**, with **no manager surface, no team averages, no rankings** — enforced in RLS, with tests that
fail the build if those column names appear on a manager surface.

**The one open question is `#14`: may a manager see an MR's practice scores?** It is about **who may
see it** — not what it means, and not whether numeric scores should exist.

**It is already in `docs/blocked-on-you.md` at line 1368, in one line, in the operator's words**, with
both answers spelled out: **(a) No — the rule stands, nothing to amend, this is what is built**; **(b)
Yes — the recorded rule must be formally amended in writing, and it becomes employee monitoring with
an HR and legal question attached.**

**So nothing is added here.** Appending a second copy would be the failure W1-H named — four copies of
a caveat is how the undated retention sentence reached the frontend as current. **The correction is to
my log line, not to the register.**

#### WHERE THIS STOPPED

**Parts A, B, C and D are complete.** `lms_tutor` is built, dispatched, unit-tested (12), proven end to
end (13), mutated, and rolled back-paired in the same commit — **B7's condition is met: the flow is
reached by the gateway, not left as a file nothing calls.**

**Voice is the only capability still unbuilt**, and it is the one that cannot be started here: it needs
a speech vendor (`BE-W32`), the bake-off corpus the project does not have, and `#5`.

#### A defect in CI's own readiness gate, found by the clean-database check refusing this push

**The check refused with 35 failures across the four gateway suites, and the code was fine.**

Step 18 printed:

```
[18/26] database · Serve the AI gateway Edge Function
Setting up Edge Functions runtime...
ai-gateway answered HTTP 502
```

**and exited 0**, because its condition was *any* HTTP code that is not `000`:

```bash
if [ -n "$code" ] && [ "$code" != "000" ]; then echo "ai-gateway answered HTTP $code"; exit 0; fi
```

**502 means the function is DOWN.** Kong listens on `:54321` from the moment `supabase start`
finishes, so it answers `502` or `503` for a function whose runtime has not come up — **a non-`000`
code that means the opposite of ready.** The gate declared the function live, and the 35 tests that
followed failed with `503 name resolution failed`, looking exactly like a code regression in work that
had passed minutes earlier.

**Fixed: the condition is now `401` or `400` only** — the function *refusing* a request, which is the
function *running*. Every other code keeps polling and is printed while it waits, so a stuck runtime
says what it is stuck on instead of being declared healthy.

**This is the seventh instance of one shape**, and it is the sharpest yet because the gate was written
for exactly this job: a bundle, a function body, a database, a knowledge graph, a test report, a build
cache — and now **a readiness probe whose success condition admitted the failure it existed to
detect.** The rule in `docs/gotchas.md` covered artefacts a check reads; this extends it to the
condition a check tests.

**What it cost:** one refused push and the diagnosis above. **What it would have cost unnoticed:** a
CI run where the function never came up, 35 red tests, and a session spent looking for a regression in
`lms_tutor` that was not there. **The clean-database check has now earned its place three times** —
an unpaired rollback, a stale test report, and this.


---

### W1-L — twenty answers · 30 September 2026 · Model: Claude Opus 5

**Twenty operator decisions recorded, Gemini's residency checked before it could be locked in, and
`BE-W106` — open since 15 August — answered and built.**

#### A — the twenty, recorded before anything was built on them

`BE-C6`–`BE-C25` in `.ai-collab/decisions-backend.md`, minted per the `BE-C<n>` rule this
repository's own `CLAUDE.md` exists to enforce. **One is recorded as CONDITIONAL and stayed
conditional** — `BE-C6` chose Gemini 2.5 Flash *subject to* India residency including voice, and a
conditional decision filed as a plain one is how a condition gets quietly dropped.

Recording them closed one gap and opened one. **`BE-W127` was registered, not glossed:** `BE-C19`
makes AI analysis mandatory across **seven** dimensions and `ai_coach` implements **five**.

#### B — Gemini residency: UNVERIFIED, and the evidence points away

`docs/ai-platform/GEMINI-RESIDENCY.md`. Every claim is a quotation with a URL and the date read, or
it is marked UNVERIFIED. Nothing was inferred into a blank, nothing was signed, no SDK added.

**The finding that matters is that there are at least THREE Google products with "Gemini" in the
name and their residency answers differ.** The one India data-residency confirmation located is for
**Gemini Enterprise** — a packaged app product, not the model API — naming **Gemini 3.5 Flash**, on
a page that explicitly excludes 2.5 Pro from the India region. **No India region appears in any
voice/Live API evidence at all**, and the best source found for Live API regions is a developer
forum thread, which is recorded as the weak evidence it is.

Separately and well documented: **the consumer API's FREE tier uses submitted content for training
and allows human reviewers to read API input and output.** On a system whose guardrails admit three
sentences that could describe a patient, that is a disclosure question, not a residency one. **If
Gemini is used at all it must be the paid tier, and that is now a written condition.**

**What it cost to find out: nothing that had to be undone.** B5 measured why — a grep for every
vendor name across `packages/core/src` and the migrations returns **0**, and the only provider
construction site is one line, `services/api/supabase/functions/ai-gateway/index.ts:191`.

#### C — `BE-W106` answered and built: settings belong to a company

`20260930000300_organisation_thresholds.sql`. `app_thresholds` gains an `organisation` scope between
`global` and `territory`, resolving **territory > organisation > global**, latest `effective_from`
within a tier.

**The signature did not change, and that was the design constraint rather than a nicety.**
`threshold()` and `threshold_number()` have **52 call sites across 23 migrations**, and
`threshold_number` delegates to `threshold` — so changing **one body** made all of them per-company
with **no caller edited**. That includes the two that mattered most: the AI feature flag and the
daily allowance are both `threshold()` lookups inside `ai_begin_request`, so the operator checklist
step reading *"an engineer runs SQL"* is gone without `ai_begin_request` being touched.

**The replacement body was generated from `pg_proc.prosrc` on the running database**, per the rule
W1-C A2 earned.

**What happened to the rows that existed: nothing, deliberately.** All 19 stayed `global`, because a
global row IS what every company gets today, so leaving them global changes no company's resolved
value on the day this ships. Copying them per-organisation was rejected — it would freeze today's
defaults as per-company decisions nobody made.

**`auth.uid()` is null for background jobs, so the purge worker and the watchdog fall through to
global.** That path is asserted, not assumed.

#### C — what the mutants proved, and what one existing test proved by breaking

18 new tests, all green on the first run — which is exactly when the question is *what else would
have made this pass*. Three mutants, applied to the live function and then reverted from the
migration file rather than retyped:

| Mutant | Killed |
| --- | --- |
| the organisation predicate removed (every company's row resolves for everybody) | **8**, in both directions, including the background-job fall-through and the positive control |
| organisation rows never resolved (pre-migration behaviour, dead column) | **9** |
| resolution order inverted — organisation beats territory | **exactly 1** |

**And the debt gate detected its own answer without being told.** `be_w106_decision_status()` reads
`information_schema` for this exact column, so three existing tests changed state the moment the
migration ran — one failing with `column "organisation_id" already exists`, because it used to
SIMULATE the answer inside a rolled-back transaction. **That is the gate working.** Two more in
`decision-debt.spec.ts` failed for the same reason and were repointed at `threshold()` directly,
because the property they actually pin is *one row is read*, and `be_w106_decision_status()` was
only ever the convenient probe. `node services/api/scripts/check-decision-debt.mjs` now prints
*"BE-W106: app_thresholds carries organisation scoping. Nothing outstanding."*

**Full suite: 76 files, 1019 passed, 4 skipped, 0 failed — on a database REBUILT from the 88 migrations after `verify:rollbacks` had rolled it all the way back.** That is the clean-database check in its strongest form: the new migration applies in sequence on an empty schema, and its rollback applies in reverse.

**One property is documented rather than fixed:** `threshold()` orders by `effective_from`, and
`now()` is fixed for a transaction, so two rows for one key written in ONE transaction tie. It
predates this work — `ai-control-plane.spec.ts` found it — and in production two admin edits are two
transactions. Tests needing an ordered pair supply an explicit `effective_from`, rather than a
parameter being added to production SQL for a test's benefit.

#### D — one list, and it was four items short of consolidated

`docs/operator-inputs.md`, which `BE-C23` asked for. It supersedes `blocked-on-you.md` §5.x and the
several ask tables in `COMPLETION-PLAN.md` — **three lists with different subsets is the same
failure as none**, because nobody can tell which is current.

**The useful thing the twenty answers did to this list is split it.** Over and over the METHOD is
now decided and the VALUE is not: `BE-C9` settled that the legal name is not to be invented and the
name is still missing; `BE-C11` made the UCPMP cap configurable and no number is configured. **A
configurable cap with no number is still no cap**, and filing those as closed would have been the
easiest way to lose them.

**Writing it caught an omission in my own Part A.** The twenty's "what these do NOT answer" section
named four asks — the PV/DPDP signatory (`#18`), adverse-event content (`#22`), consent-notice
language order (`#25`) and the 72h/120s thresholds (`#26`) — that the first draft of the
consolidated list did not carry. They are D-15 to D-18. **`#18` blocks transcripts entirely, has
been asked before, and all twenty answers went past it**, which the list now says in as many words.

#### E — the four approvals that are not a schedule

Ordered by **what each is blocked by**, not by size or value, because two of the four need something
from outside engineering before a line can be written. `BE-C12`'s content path is first as the only
one unblocked today; `BE-C14` notifications last as the only one no finished feature waits on.

**`BE-C16`'s "must not hold up other development" is recorded as applying to a DIFFERENT item than
the one it is attached to.** The obvious reading — "do vector search quickly" — is wrong. It means
vector search must not become a prerequisite of anything else, and the thing it would most naturally
have become a prerequisite of is knowledge retrieval for `product_qa`, **which is finished and
working on keyword search today**. So the condition governs item #1, and vector search sitting at #3
is that condition being honoured rather than ignored.

### W1-M — the real provider · 1 October 2026 · Model: Claude Opus 5

**The real provider was NOT built: no AWS credentials exist anywhere this session could reach, and
the brief's B1 says stop rather than build an adapter that cannot be exercised. What was built
instead: the coach analysis now covers the operator's nine items, and the daily allowance has its
launch value and an 80% warning. Fifteen operator decisions recorded — not thirty-one.**

**Checkout guard.** Branch `worktree-ai-platform-phase-a`, HEAD `afb12fc`, clean tree. `origin/main`
(`f2487e8`) already an ancestor — merge a no-op. PR #2 `MERGEABLE` / `CLEAN`, both checks `SUCCESS`
at `afb12fc`.

#### A — fifteen decisions, and why not thirty-one

`BE-C26`–`BE-C40` in `.ai-collab/decisions-backend.md`. **The brief said 31 answers and spelled out
13 numbered points**, plus "continue development" (`BE-C39`) and a request for a flow to approve
(`BE-C40`, the brief's "their point 4", which is not the brief's own point 4). **The other sixteen
were not in the text and were not reconstructed** — searched for in the repository, including the
untracked `BACKEND-DECISIONS.md` in the main checkout, which is the 24 September list. Asked for as
`docs/operator-inputs.md` I-11.

Settled, marked in `docs/COMPLETION-PLAN.md` "W1-M": `#5`/`D2` (closed, `BE-C26`), `D-11`, `D-12`,
`D-13`, `D-14` (moot), `D-16`/`#22` (closed), `D-17`/`#25`, `D-18`/`#26` (half — see D), `D-6`
(method), `BE-C19` (superseded), `BE-W127` (closed).

**A2 — `BE-C6` is SUPERSEDED, its condition MOOT, not met.** Recorded as its own entry beside
`BE-C26`, `BE-C6`'s text untouched, with a pointer to `GEMINI-RESIDENCY.md` and the bar a return must
clear (written confirmation from Google, including voice). Nothing anywhere says Gemini passed.

**A3 — the operator said seven; the register says eleven.** `docs/operator-inputs.md` rewritten to
hold only what is still needed: the operator's seven (I-2–I-8) plus **AWS access** (new, I-1),
**approved product content** (old D-8 — `BE-C37` makes Product Q&A answer only from it), **the
second admin actually provisioned** (old D-3), and **the sixteen unrecorded answers** (I-11). Old
D-4 dropped (a rule, recorded as `BE-C8`); old D-10 folded into I-9.

**Found:** `D-14` names two different things — Gemini residency in `operator-inputs.md`, the
console's identity in `handover.md`/`PROJECT-OVERVIEW.md`. The rewritten list uses `I-<n>`.

#### B — STOPPED at B1. A CONDITIONAL STOP THE BRIEF DEFINED

**B1, measured:** no `AWS_*` environment variable; no `~/.aws`; no AWS CLI on the path; no AWS key in
any `.env` in the main checkout, the worktree or `apps/`. The remote Supabase project's function
secrets **could not be listed** — the stored `SUPABASE_ACCESS_TOKEN` returns **401 Unauthorized** —
so whether a key sits there is unknown, not "no"; it would still be unusable from here.

**What is needed, exactly** (I-1): an AWS account the company owns; **Bedrock model access for Claude
Sonnet 5 and Claude Haiku 4.5**; confirmation that **both are offered through the India geographic
inference profile**, with the profile ids copied from the console; an IAM key scoped to
`bedrock:InvokeModel` on those two profiles only, delivered as a function secret.

**⚠ Not verified by me, and said rather than assumed:** that the India geographic inference profile
offers both models; which AWS speech-out service is India-hosted (`BE-C28`).

**B3 — where routing lives and how to tell which model answered.** Not built (no provider). Proposed
in `AI-SPEC.md`: per feature in the approved prompt version's `model_config`. **What is already true
and now tested for the coach:** `model_name` on both `ai_requests` and `sim_coach_analyses` is taken
from the provider's own reply — `sim-doctor.test.ts` "the model that answered is what is recorded".
That is a scripted model; **B4's real-vendor evidence does not exist.**

**B5 — which capabilities are REAL: none.** All five answer from the labelled stub. What each still
needs beyond I-1: `product_qa` — approved content (I-9) and an approved prompt; `mr_chat` — the
product list (I-6) and a prompt; `lms_tutor` — published lessons and a prompt; `ai_doctor` — the six
personas (`BE-C35`) and a prompt; `ai_coach` — a prompt that defines *scientific accuracy* and
*response relevance* in words a model can score against. **Every prompt needs the second admin
(I-10) to be approved.**

#### C — nine items, against what existed

**C1, read from `record_sim_coach_analysis`'s live `prosrc` (identical to its migration):** five
of the nine existed — product knowledge, communication, opening/pitch (`opening`), objection
handling, closing — and *areas for improvement* was already `improvements` (cited findings). **Three
did not:** scientific accuracy, relevance of response, suggested learning modules. **Not built
twice:** no `pitch_quality` beside `opening`, no second improvements list.

**C2 — `20261001000100_coach_nine_dimensions.sql`.** Seven scores (`scientific_accuracy`,
`response_relevance` added), each required, 0–100. `suggestedModules`: an array of **0–3**, each
`{moduleId, dimension, reason}`; empty is valid. Refused: missing/non-uuid id, empty reason,
unknown dimension, more than three, a duplicate. **The 8-argument recorder is DROPPED**, asserted from
`pg_proc` (`pronargs` = `[9]`) — leaving it would leave a way round the checks.

**C3 — what constrains a suggestion.** One predicate, `sim_coach_suggestable_modules(org)`: a module
in a **published** version of an **active** course in the rep's **own** company — exactly what
`start_course_version` lets them enrol on. Used twice: `sim_coach_module_candidates()` is the list the
model is SHOWN (company derived from the caller), and the recorder REFUSES anything outside it. The
flow also refuses an id it did not offer, **before** the database, closing the request `failed` with
`unknown_learning_module` — otherwise the request would be counted with nothing saying why.

**C4 — inheritance, proved, and swept a second way.** The new column sits on the row whose policy is
rep-or-company-admin; a test reads it as the rep (1), the company admin (1), the rep's manager (0)
and a rival company's admin (0). **Second sweep, different in kind — the catalogue, not the policy:**
no view and no function other than the writer references `sim_coach_analyses`, and no app file reads
it. Contract test extended to the **nested** keys (dimension scores, finding, module, candidate) —
the old check only read the top level.

**What I got wrong and caught.** The first green run of the new DB tests had **no test touching
`courses.is_active`** — deleting that clause would have survived. Found by asking what else would
have passed; the deactivated-course case was added before mutating.

**C5 — end to end and mutated.** Over HTTP: the stub's analysis is stored with seven score keys and
`suggestedModules: []`. **The stub suggests nothing, on purpose**, so the populated-module path is
proved at the database (positive control + six refusals) and in the flow against a scripted model,
**not over HTTP** — stated rather than hidden. **`analyseSimSession` had no unit test before
today**; `sim-doctor.test.ts` is new.

| Mutant (applied live, restored from the migration text) | Killed |
| --- | --- |
| `and c.is_active` removed from the predicate | **exactly 1** — the deactivated-course case; positive control green |
| the duplicate-module check removed | **exactly 1** — "the same module suggested twice" |
| the flow's unknown-module refusal disabled (TypeScript) | **exactly 1** — "a suggestion NOT on the list"; restored by file copy |

#### D — what was covered

**D1 — BUILT. `20261001000200_ai_allowance_warning.sql`.** Global rows `ai_daily_requests_per_user`
= 100 and `ai_daily_warning_percent` = 80 (a ceiling may be global; a feature flag may not —
`BE-C29`). `ai_begin_request` (body from `prosrc`) returns `allowanceWarning` and writes **one**
`ai_allowance_warnings` row per rep per India day, recording the request that crossed the line. A
mis-set percentage warns nobody and refuses nothing. **What the warning reaches: the company admin
(a row), and the flow (a field). NOT the rep's screen** — no flow passes it on and no screen shows
it: **`BE-W128`.** Mutant: `on conflict do nothing` removed → **exactly 1** killed ("logged ONCE").

**Found:** the gateway suites' cleanup commits a **global JSON-null limit at `now()`**, which
outranks the migrated 100 on any database they have run against. Test databases only — but it is why
the test asserts the migration's ROWS, not what `threshold()` resolves.

**D2 — config half ALREADY TRUE; log half NOT met; not built.** Every use of 72h/120s is a
`threshold_number()` call, per company since W1-L, settable by any admin — no constant anywhere
(grepped SQL, core and apps). The log, measured: the **sync path stores every rejection** in
`sync_items`, **but as `internal_error`** with the reason only in prose and the SQLSTATE dropped;
**direct RPC paths store nothing**; the bounds live in **three triggers**, where `BE-W102`'s
return-instead-of-raise cannot work. **`BE-W129`**, with the cheap first step named. **A ROOM stop**:
one path fixed and called done is the silent failure the operator named.

**D3 — expiry IS enough; no new label.** 09:00–18:00 exists only in `seed-synthetic.mjs` (localhost-
only, enforced in code) and test fixtures; the reference seeder refuses to write shift windows; an
org default without an `expiresAt` ≤ 60 days is rejected. No script can put the testing value into a
non-local database, and a label would not stop the one remaining route — a human typing it.

#### E — `AI-SPEC.md`

Out of date in **more** than the three named ways: it still said the gateway, the sim tables, the
`mr_chat` flow and the tutor did not exist. Every status re-derived: provider and routing section;
**voice drawn as a separate layer outside the gateway**; the nine items as a table with what refuses
each; both diagrams re-marked with evidence per BUILT box; page one reduced to what remains. Scope,
the hard rule and the appendix carried over verbatim.

#### Counts

`node scripts/ci-local.mjs --with-db`, **exit 0**, all 26 steps — on a database built from **90**
migrations, ending with every rollback applied in reverse to an empty schema, then Supabase stopped.
**`@fieldforce/api` (vitest): Test Files 76 passed (76); Tests 1039 passed | 4 skipped (1043)** —
W1-L was 1019/4; +20 = 15 gateway + 5 control-plane, the 4 skips the same `ai-product-qa` ones.
**`@fieldforce/core`: 9 files, 175 passed | 4 skipped.** Field (jest): **Test Suites 33 passed, Tests
226 passed**; field (vitest) 648; ui (jest) 24 suites / 273; console 76; browser 7 passed, 0 skipped.

**The first full run FAILED at lint** — two unused `_dropped` destructures in my own tests — and
prettier then flagged three of my test files. Fixed, re-run from the top.

#### Where I stopped

**Part B at B1: a CONDITIONAL STOP THE BRIEF DEFINED.** Part D2: **ROOM**. Everything else done.
**CI on the pushed SHA is recorded in the next sub-section**, because a commit cannot name its own
hash.

#### CI — on the SHA, read from the run rather than the badge

Workflow **`CI`**, run `36819533508`, `headSha` **`70efa136e9139a065cc67939ca64f4af2679de36`**
(the W1-M commit), conclusion **success**. Job **"typecheck · lint · format · unit tests": pass.**
Job **"migrations · Gate 0 RLS suite · rollbacks": pass** — its own log reads **Test Files 76 passed
(76); Tests 1039 passed | 4 skipped (1043)**, *"browser suite: 7 passed, 0 skipped, 0 failed"*, and
*"All rollbacks applied in reverse order; public schema is empty."* Same numbers as local. **This
sub-section is a docs-only commit on top**; its own CI result is reported in the session summary.

### W1-N — what they are waiting on · 1 October 2026 · Model: Claude Opus 5

**The operator's four asks written, `BE-W129` closed for every path the app uses, live tracking
designed and deliberately not built, the stub made able to suggest a module, the settings leak fixed
at its source, and one honest page about 4 October.**

**Checkout guard.** `worktree-ai-platform-phase-a` at `cdbd3fc`, clean; `origin/main` (`f2487e8`) an
ancestor, merge a no-op; PR #2 `MERGEABLE`/`CLEAN`. `review-handoff/` did not exist.

**The operator's direction arrived as the reviewer's SUMMARY.** Recorded as `BE-C41`–`BE-C61`, one per
code (A-1 … D-1), with that caveat in the record. **One place the summary and the operator's own rule
differed was resolved for the operator:** the brief said fold four things into one list and "everything
else out"; the operator's rule is "items that need credentials, legal text or master data", which also
covers Firebase (Q-3) and the tracking notice (Q-12). Both are in.

#### A — the consolidated list: `docs/operator-inputs.md`, Q-1 to Q-14

* **Q-1 AWS** — the IAM policy itself: invoke only the two India inference profiles; the two models only
  in `ap-south-1`/`ap-south-2`; an explicit **Deny** on every Bedrock call outside India. Five
  placeholders to copy from the console, and the three things I could not verify named for them to check.
* **Q-2 Google Maps** — two APIs, two keys, each restricted by application and API; the one setting per
  app that holds the key (`GOOGLE_MAPS_ANDROID_API_KEY` in `app.config.ts`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
  in the console) — **a design, not yet built**, and an Android map key needs a rebuild to change.
* **Q-5 the territory template** — `docs/operator/territory-template.xlsx`, **generated from the CSVs a
  test reads** and **opened in Microsoft Excel to confirm** (3 sheets, 11/4/3 rows). The importer did
  not exist as a spreadsheet reader, so "what the importer rejects" would have been fiction:
  `services/api/scripts/check-territory-sheet.mjs` now refuses eleven named problems by row number
  and writes the JSON `seed:reference` already takes. **Found:** `territories.code` is UNIQUE across
  ALL companies, not per company. **Its example rows are refused by name**, so they cannot be loaded.
* **A4 — the sixteen lost subjects CANNOT be listed.** A sweep of the repository, its history since
  27 September and the session records found no ~31-item question list; the W1-M brief contained exactly
  what W1-M recorded. **The loss is upstream of the repository.** The document says so, refuses to send
  a guessed list, and **asks the reviewer to forward the operator's original message verbatim.** The
  operator's second message re-answers at least fourteen subjects that were not in the fifteen.
* **My W1-M error, corrected by append:** I wrote "I-12" for the item that was I-11.

#### B — `BE-W129`: the question, then the build

**B1, the question:** *"for my company, between two dates, how many writes were rejected, of which
kind, through which path?"* — `count_write_rejections(p_from, p_to)`, admin only.

**B2.** A trigger refuses by raising, which rolls back any row written beside it; `BE-W102`'s escape
needs a function returning a body, and a BEFORE trigger returning nothing skips the write while
reporting success. **So the CALLER that catches writes the log**: `sync_push` already runs each item in
a subtransaction, so one `perform` in its handler logs every rejection on the path **all** app writes
take (measured: nothing in `apps/field` calls the direct RPCs). **B4:** the reason is the **SQLSTATE**,
the project's existing refusal vocabulary; prose sits beside it.

**B3, both paths:** sync — every rejection; direct — `complete_upload`, renamed rather than retyped and
wrapped, answering over HTTP with PostgREST's own envelope. **`capture_consent`, `record_check_in`,
`record_check_out` (row-returning) and direct `visits` writes cannot refuse AND commit a row** —
registered as **`BE-W130`** with both ways out costed (withdraw direct grants: 19 test files; or
`dblink`: a dependency ask). **No app traffic uses them.**

**B5, the proof** (`services/api/tests/write-rejections.spec.ts`, 7 tests):
* sync: 45007 and 45008 counted by code; the accepted capture produces nothing;
* **the baseline was measured against the OLD schema first** — direct 45010 → HTTP **400** with code
  45010 — and the new path returns exactly that, now with a row;
* positive controls on both paths; another company's admin, the MR and the manager cannot ask.

**The mutant that mattered:** removing `sync_push`'s one-line guard made an **80-hour-stale recording
come back `accepted` inside an HTTP 400 batch** — the wrapper returned its envelope instead of raising,
and `apply_sync_item` took it as success. **Exactly one test killed.** That failure is what the guard
prevents; it would have been silent in production.

#### C — live tracking, designed: `docs/ai-platform/LIVE-TRACKING-DESIGN.md`

Each of the four conditions with what enforces it: **the device decides when to collect, the server
decides what to keep** — an ingest RPC refusing out-of-hours points and points with no current consent,
every refusal a `write_rejections` row.

**C2, the options:** **A** `expo-location` (already a dependency, `~57.0.14`) + `expo-task-manager`
— free; **B** `react-native-background-geolocation` — a paid Android licence, price not verified;
**C** our own service — engineering time. **Recommended: A, foreground-only, started by the MR.**

**Found by sweeping the tests, and it changes the recommendation:**
`apps/field/src/onboarding/no-background-location.test.ts` forbids background location, citing
`FE-W3-SPEC` (31 Aug): **Google Play's background-location declaration does not list employee
monitoring as an acceptable use.** So background location may not pass review *at all* for this purpose,
the foreground-service route becomes the design rather than an optimisation, and building it means the
frontend track reversing its own guard. **To verify against current policy before a line is written.**

**C3:** seven things only a real handset can show, headed by manufacturer battery managers killing the
service. **C4:** `docs/operator/live-tracking-notice-DRAFT.md`, DRAFT, inserted nowhere, with **four
blanks that are decisions** — chief among them **who may see an MR's position**, which is the
`BE-C13` question in a new place. **C5: nothing built.**

**My mistake, caught by checking:** I first wrote that the shift window is "already sent in sync". It
is not — the app calls `my_shift_window()` directly and reads only the timezone. Corrected.

#### D — the two items left open

**D1.** The stub reads a `[STUB:suggest-offered]` / `[STUB:suggest-unoffered]` directive from the
objective and suggests the first OFFERED module or a known-unoffered id, **its reason being the stub
marker**. Both cases driven over HTTP; a mutant disabling the flow's refusal killed **exactly the
refused-case test**, and showed the database's 23514 as the backstop. **What else the stub cannot
produce — `BE-W132`:** product_qa's other branches are covered by scripted cases; `mr_chat`,
`lms_tutor`, `ai_coach` have **no timeout test**; **`takeDoctorTurn` has no unit test at all.**

**D2 — `BE-W131`, fixed at the source.** Four suites committed GLOBAL settings and reverted them with
more global rows; **`ai-gateway` never reverted the daily limit, leaving `'50'`.** Each helper now
writes ORGANISATION rows for its own per-run fixture company. Proved two ways: after all four suites ran,
the catalogue held **2 global `ai_*` rows (the migration's) and 27 organisation rows**, and a new test
asserts the global default **resolves** to 100/80. **Mutant** (one helper back to global): exactly that
test failed, resolving `200`.

**And D2 had a consequence I did not predict.** The full run then failed at `verify:rollbacks`: W1-L's
`organisation_thresholds` rollback **refuses if any company has its own settings** — and the suites now
leave 27. **That guard had never fired before.** It was right. `verify-rollbacks.mjs` now **proves the
guard refuses (23001)**, then runs the deliberate procedure the file's own header prints, then applies
it. **Mutant** (guard disabled): the run fails naming the missing guard — after I corrected my first
version, which surfaced a misleading check-constraint error instead.

#### E — `docs/4-OCTOBER.md`

| Feature | 4 Oct |
| --- | --- |
| Real AI answers | **NOT, unless Q-1 arrives by 2 Oct** — about a day after AWS access |
| AI screens in the MR app | **NOT** — no file in `apps/` calls the gateway (measured) |
| The six remaining screens | **CANNOT ASSESS** — no document names them |
| AI-limit warning in the UI | **PARTLY** — backend built; flow plumbing (`BE-W128`) + screen not |
| Maps / live tracking / notifications / voice | **NOT** — each waits on credentials, a dependency ask, and (tracking) a handset and a Play-policy check |
| Coaching on nine items | **PARTLY** — built end to end; real scoring needs Q-1 |
| Approvals | **BUILT, unusable until the second admin** |
| Territory import | **BUILDABLE** — needs the data |
| Product master / Q&A refusal, working hours, rejection counting | **BUILT** |
| Doctor import | **PARTLY** — import built; admin entry screen not verified |
| Production deploy | **PARTLY** — order ready; paid plan and external monitor are not engineering's |

#### Counts

`node scripts/ci-local.mjs --with-db`, **exit 0, all 26 steps**, on a volume dropped first
(`supabase stop --no-backup`) so the database was built from **91** migrations. **`@fieldforce/api`:
Test Files 78 passed (78); Tests 1060 passed | 4 skipped (1064)** — W1-M's 1039 + 21 new; the 4 skips
unchanged. **core: 175 passed | 4 skipped.** field: **Test Suites 33 passed, Tests 226 passed**; field
vitest 648; ui **24 suites / 273**; console 76; browser **7 passed, 0 skipped**. Rollbacks: *"guard
held … with 27 organisation setting(s) present"*, then *"public schema is empty"*.

**It took five full runs.** Run 1: two reds — `write_rejections` missing from the hard-coded tenant
list (my omission; the same list W1-M had to update) and `recorded-at-bounds` reading the codes from the
wrapper rather than the renamed body. Run 2: Supabase failed to start on a cold volume (the container
came up healthy 35 s later; environmental). Run 3: the rollback guard above. Run 4: prettier on
`verify-rollbacks.mjs`. Run 5: green.

#### Where I stopped

**All five parts done.** Not built, deliberately: live tracking (C5 — an OPERATOR INSTRUCTION in the
brief), `BE-W130`, `BE-W132`, `BE-W128`. **CI on the pushed SHA follows in the next sub-section.**
