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

**Offline backup, 31 August:** `C:/dev/elmiron-app-31aug2026.bundle` — 1,043,791 bytes,
a single file holding the complete history and all five refs, requiring no remote and
no permissions. `git bundle verify` reports *"okay"* and *"records a complete
history"*. Test-restored by cloning it to a scratch directory: tip `142e6bc`, 71
commits, `f34ceef` present, `backup/pre-merge-31aug` carried across, and
`apps/field/package.json` reading `@fieldforce/field`. The scratch clone was deleted.

**It is not yet a backup.** It sits on the same disk as the repository, so it protects
against a bad merge and nothing else — not disk failure, not theft, not a reinstall.
It becomes a backup at the moment a copy exists somewhere off this machine, and not
before.

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

**`Devpt1904` does not have write access to `Praverse-Tech-Pvt-Ltd/Elmiron-App`.**
That is the whole of it. The push fails with:

```
remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904.
fatal: unable to access 'https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git/':
The requested URL returned error: 403
```

This is an **authorisation failure at the account level, not the token level.** A
token carries the permissions of the account that issued it and cannot exceed them, so
no scope change fixes this. Read the error literally: GitHub names the account and
says *denied*, which it does not say for a missing scope.

**The fix is one of these, and every one of them needs another person:**

1. **An org owner grants `Devpt1904` write access** to the repository — as a
   collaborator, or by adding the account to a team that holds it. This is the direct
   fix.
2. **Push from an account that already has write access.** `Rabbitshah`
   (`126866160+Rabbitshah@users.noreply.github.com`) authored *and* committed
   `b5d03a5` on 23 August, so that account can write to this repository.
3. **Fallback only:** if the org enforces SAML SSO, a token additionally needs
   authorising for the org. Treat this as unlikely here — it presents as a distinct
   error naming SSO, which this one does not.

**Secondary, and only once write access exists:** the token also needs `workflow`
scope, because `.github/workflows/ci.yml` is among the modified files. A token with
`repo` but not `workflow` rejects a push *specifically* for touching that path, with a
different message. It is a second gate, not the current one.

_This document is where the mistake was caught._ The blocker was recorded across
several prompts as a token **scope** problem; writing the exposure down meant pasting
the actual error text, and the error text names an account, not a scope. A diagnosis
nobody has to write out is a diagnosis nobody checks.

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
