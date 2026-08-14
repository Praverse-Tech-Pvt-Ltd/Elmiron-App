# Local AI-collaboration notes

**Not tracked by git.** See the `.ai-collab/` entry in `.gitignore` for why.

## What lives here, and what deliberately does not

This project already had most of what the AI-collab system asks for, in a stronger
shape: append-only, in git, and verified by CI. Duplicating those here would create a
second copy that drifts, which is worse than not having one.

So the rule for this directory is: **real content only where there was a real gap; a
pointer everywhere else.**

| File | Status | Why |
| --- | --- | --- |
| `constraints.md` | **Real content** | The genuine gap. The hard boundaries existed but were scattered across ~130 KB of `PROJECT-OVERVIEW.md` and seven weekly prompt files. Nobody could find them without reading everything. |
| `test-checklist.md` | **Real content** | `PROJECT-OVERVIEW.md` lists the commands but not the **expected output** — and on this project "229 skipped" and "229 passed" look nearly identical in a terminal. That confusion has cost real time before. |
| `handover.md` | **Real content** | Untracked, which is the whole reason it is allowed to exist here at all. |
| `flow.md` | **Real content** | The consent → grant → chunk → finalise → purge path crosses SQL, HTTP and a Node worker, and no single file shows the whole trip. |
| `bug-log.md` | **Real content** | The four BE-W7 bugs the tests caught, in found → tried → worked → verified form. |
| `decisions.md` | **Pointer + this week** | The real decision log is `PROJECT-OVERVIEW.md`. This holds only what is not yet written there. |
| `architecture.md` | **Pointer** | `docs/mr-app-plan.md` and `docs/mr-app-architecture.html` already do this properly. |
| `rollback.md` | **Pointer** | `services/api/rollbacks/` plus `pnpm --filter @elmiron/api verify:rollbacks` is a rollback system that is actually **executed in CI**, which beats a markdown description of one. |

## The tracked equivalents, so nobody looks in the wrong place

- **Current state and every architectural decision** → `PROJECT-OVERVIEW.md`
  (append-only; every week adds a `###` section under "Phase log")
- **Machine, tooling and platform failures that cost real time** → `docs/gotchas.md`
  (cumulative; append, never rewrite)
- **What to do after a database restore** → `docs/restore-runbook.md`
- **The week's brief** → `docs/backend-prompt-w*.md`
