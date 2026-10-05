# Phase log — frontend / field app track

> **This file is append-only.** New sections go at the end. Never edit above the last one, and never
> run a formatter over it — the same rule `PROJECT-OVERVIEW.md` keeps, for the same reason.

**Read `PROJECT-OVERVIEW.md` first.** Everything up to and including **W1-E** is there, in one
chronological order, and nothing has moved out of it. This file starts at the frontend track's first section after 29 September 2026.

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
W1-F onwards a reader must open this file and `docs/log/backend.md` and interleave them by date to
reconstruct a week. The interleaving in `PROJECT-OVERVIEW.md` is how the racing of two tracks was
visible; that is no longer free. Both files stay dated and append-only, so the interleave is
mechanical.

**Nothing already written moved**, so no citation anywhere in the repository breaks.

---
