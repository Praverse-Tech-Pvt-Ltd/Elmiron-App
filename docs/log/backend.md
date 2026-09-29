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
