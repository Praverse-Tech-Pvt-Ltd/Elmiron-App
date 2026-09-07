# PROMPT FE-W2b — Render harness and the queue screen

> Paste everything between the lines into Claude Code. Written 14 August 2026.
> Amended after the FE-W2b stop report — see §1 and §3. Follows FE-W2. This is not FE-W3.

---

## Stop condition — read this before anything else

If `git push` has not succeeded, stop. Do not start this sprint. Report that you stopped, and why.

Ten commits with CI never run is already more unverified work than is safe. Adding a screen sprint on top turns the first CI run into a multi-day untangle with no bisect point, because every failure arrives at once. `gh auth login` is a two-minute human action and it is the one blocker not to build around.

- If push succeeded and CI is green — proceed.
- If push succeeded and CI failed — fix CI first. Report every failure and its cause before touching anything below.

Diagnosis so far, carried forward: the repo is private, the clone succeeded, and push returns 403. A credential with read access is therefore in use and is refused for write. That is consistent with either a stale or under-scoped token (a fine-grained PAT with `Contents: read` behaves exactly this way) or an account without write permission on the org. `gh auth login && gh auth setup-git` separates the two. Check the PAT scope first — if that is the cause it is self-service; if it is an org permission it needs someone else.

## Read first

1. `.ai-collab/constraints.md`
2. `docs/gotchas.md`
3. `PROJECT-OVERVIEW.md` — never overwrite an existing `###` section
4. `.ai-collab/decisions.md`
5. `docs/frontend-plan-v2.md`

## What this sprint is for

Five route files from FE-W1 have zero tests. There are no screens at all. The screens are the entire deliverable to an MR — and none of this work needs a physical device. A renderer is enough.

This sprint does not close FE-G1 or FE-G2. Both need hardware. State that plainly in the report; do not let a green sprint imply a passed gate.

## 1. Render test harness

Authorised dependencies — two, not three: `jest-expo` and `@testing-library/react-native`.

`@testing-library/jest-native` is deprecated; its matchers were folded into `@testing-library/react-native` (v12.4+, per current understanding — confirm the version against the registry and state what you found). Do not install a third package as a substitute. If the registry contradicts this, stop and report rather than choosing.

Anything beyond these two: ask.

- Wire it into the existing turbo check tasks so it runs alongside everything else, and in CI.
- Include one test that proves the harness fails when an assertion fails. A harness that reports green on a broken render is worse than no harness.

## 2. Tests for the five FE-W1 route files

Pin what each route renders. Not to raise a count — every test must pin a fact.

- Role-aware routing for `mr`, `field_manager`, `admin`. Roles come from JWT claims installed by Backend's auth hook. Read them; never infer.
- A role reaching a route it should not get must render the permission-denied state — not a blank screen, not a crash.
- If a route file cannot be meaningfully tested today, name it and say why. Do not write a test that merely asserts something rendered.

## 3. The queue screen — and where it lives

`my_upload_queue()` is the MR's only proof their day's work is safe. Build it as a pure function of reducer state — it takes state, it renders, it decides nothing.

Placement is settled: the screen component goes in `packages/ui`. The file in `apps/field` is a route binding only — read params, pass state down, render the component. Nothing else. The console and the patient app both consume this later; a screen that lives in `apps/field` is a screen that gets rewritten.

On the lint-rule gap you identified: you are right that the current rule cannot see it. Banning React Native visual primitives in `apps/field` permits a full reusable screen assembled from `@elmiron/ui` components to sit there undetected. That gap is real and it is the exact failure the rule exists to prevent.

Do not implement a fix blind. Propose the rule extension in your report — what it would assert, what legitimate route code it would wrongly reject, and how noisy it would be — and I will rule. The distinction the rule needs to encode is **routes bind, screens render**. If the honest answer is that no lint rule expresses that cleanly, say so and we enforce it in review instead, recorded as such.

Five states, each visually distinct:

- **empty** — no queued work. This must read as reassuring, not as an error or a failure.
- **queued, retrying normally**
- **queued, retrying a long time**
- **rejected** — carrying the server's sentence
- **dead-lettered** — the server's reason, and the fact that it is reversible

Feed all five from `services/mock` fixtures, not hand-written literals in the test file, so the shapes stay tied to the contract.

## 4. The long-retry display rule

- The threshold is display only. It must not change the item's status, its ordering in any way that implies a verdict, or any client decision. The server owns the outcome.
- A test must assert that crossing the threshold changes presentation and nothing else.
- Wording must be specific and honest. Never "something went wrong." The reducer already carries `attemptCount` and `oldestUnsyncedClientCreatedAt`.
- Never render a client-computed duration. If elapsed time is shown, derive it from a server timestamp, and state in the report exactly which field you used.

## 5. Server sentences, rendered verbatim

Rejections carry an MR-readable sentence written by Backend. Display it as given.

Add a test that fails if the client substitutes, truncates, or wraps its own wording around a server sentence.

## 6. The payload residual — done

Recorded in `PROJECT-OVERVIEW.md` during the stop. No further action this sprint.

Standing trigger, restated so it is not lost: the moment any code path begins invoking or dereferencing something out of `payload`, this stops being a residual and becomes a live arbitrary-execution path — and the import-list guard will still be green while it happens. Narrowing `payload` to a recursive JSON value in `packages/core` is what closes it, and that is Backend's file, so it is a request, not a change.

## Do not build

- PowerSync, or any local persistent store. Still stopped.
- Anything requiring a device, an emulator, or a native build.
- Any FE-W3 feature — beat plan, doctor search, check-in / check-out, background geolocation, mileage.
- Any screen displaying a transcript, analysis, summary or AI output.
- Any ranking, score, rank, percentile or grade. Anywhere. For any reason.
- Anything in `apps/console`. That is FE-W6.
- Any iOS configuration. Android only, permanently.

## Rules

- No dependencies beyond the two authorised in §1.
- No test written to raise a count.
- Ambiguity → stop and ask. Do not choose a default.

## Required at the end

Append `### FE-W2b — Render harness and queue screen` to `PROJECT-OVERVIEW.md`. Never overwrite an earlier section. Include:

- The CI result — the actual one, from the runner, not local
- The `@testing-library/react-native` version confirmed, and what the registry said about the deprecated package
- The five route files, and what each test pins
- Your proposed lint-rule extension, with its false-positive cost — proposal only, not implemented
- The long-retry threshold chosen, and the server field used for elapsed time
- Test counts split: reducer / routes / screen
- FE-G1 and FE-G2 restated as open, with the reason — no device
- Anything in this prompt you believe is the wrong call

Then append to `docs/gotchas.md` anything this sprint cost that would cost the next developer the same. Cumulative — append, never rewrite.

## Reviewer checklist

- [ ] Did CI actually run, or is "green" still local?
- [ ] Does the harness fail on a broken render, proven by a test?
- [ ] Are route tests pinning facts, or asserting that something rendered?
- [ ] Is the queue screen component in `packages/ui`, with only a binding in `apps/field`?
- [ ] Is the lint-rule extension a proposal, or was it implemented unasked?
- [ ] Is the queue screen a pure function of reducer state, or does it decide anything?
- [ ] Does the long-retry threshold touch status, ordering or any client decision?
- [ ] Is any displayed duration client-computed?
- [ ] Are server sentences rendered verbatim, with a test that fails on rewording?
- [ ] Does the empty state read as reassuring or as an error?
- [ ] Any unrequested feature or speculative abstraction? It gets removed.
