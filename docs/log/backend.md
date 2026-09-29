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
