# Push readiness

**Written 31 August 2026.** A statement of exposure, not a status document and not a
plan. It exists so that whoever picks this up cold — including a future session with
no memory of this one — can tell what is true from what is merely claimed.

`docs/frontend-status.md` is the status document. `PROJECT-OVERVIEW.md` is the record.

---

## What is waiting

**34 commits**, ahead of `origin/main` and 0 behind it after the 31 August merge. The
oldest is `dd9c1a4`, **14 August 2026** — "FE-W1 §1: workspace config, and a lint-time
replacement for the linker guard". Seventeen days of work exists on one laptop.

`backup/pre-merge-31aug` is a local branch pointing at the pre-merge tip. It is also
only on this machine, so it is not a backup of anything against the loss of the
machine.

## What is claimed, and by whom

**CI has never executed in this repository.** Not once, on any branch, for any commit.
Every quality figure below was produced by the same machine that wrote the code, and
none has been reproduced anywhere else:

- **523 tests passing** — core 21, mock 40, ui-tokens 38, ui 4 + 19, field 44 + 24,
  api 333 (against a local Supabase stack, passed rather than skipped).
- **typecheck 9/9**, **lint 7/7**, **`format:check` clean** on every tracked file.

Treat all of it as self-reported. The first CI run is expected to be red; a green one
would itself be worth questioning before it is believed.

## What is on `origin` today

`origin/main` is at `b5d03a5` and carries the **pre-rename `@elmiron/*` package
identifiers**. The FE-R1 trademark rename — `f34ceef`, "remove a third party's
trademark from the permanent identifiers" — exists only on this machine and on
`backup/pre-merge-31aug`.

**Anyone cloning this repository today gets the version with a third party's
trademark in the package identifiers.** That is the single most consequential fact on
this page and it stays true until the push lands.

## The one blocking action, and who owns it

**A human, in GitHub's web UI, granting the personal access token two scopes:**

- **`repo`** — the current token authenticates as `Devpt1904`, which has no write
  access to `Praverse-Tech-Pvt-Ltd/Elmiron-App`. The push fails with
  `remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904.`
  and HTTP 403.
- **`workflow`** — required in addition, because `.github/workflows/ci.yml` is among
  the modified files. A token with `repo` but not `workflow` rejects the push
  specifically for touching that path, which reads as a different failure and has
  cost time on this project before.

Nothing else is blocked on anything else. No agent can do this step.

## Deferred verification — needs the emulator

Two things are fixed and tested but not confirmed by looking at them:

1. **The safe-area inset.** `packages/ui/src/Screen.tsx` adds the device inset to the
   token padding, asserted arithmetically with a negative control. Mock insets are not
   device insets: a fresh sign-in screenshot on the Pixel 10 emulator, showing the
   heading clear of the status bar and the punch-hole, is what closes it.
2. **The glyph rendering.** The queue screen's five status glyphs are pinned to a
   five-codepoint allowlist and asserted in the test tree. Whether they *render* —
   rather than appearing as tofu boxes — has never been looked at on a device.

Neither is closed by a passing test, and neither should be described as closed until
the screenshot exists.
