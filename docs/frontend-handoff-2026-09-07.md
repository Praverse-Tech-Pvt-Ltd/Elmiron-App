# Frontend Handoff — 7 September 2026

**From:** the frontend · **For:** the team · **Head:** `32cb85e` on
`fe/phase2-c5-b7-and-phase3-consent` · **Tree:** clean

> **Read `handoff-frontend.md` (3 September) first if you are backend.** It is still
> current and unsuperseded — its §2 is the list of eight things the frontend needs
> from the API, in priority order, and none of them have moved. This document is the
> wider team's version: what exists, how to run it yourself, and what is actually
> holding the project.
>
> Tracked records that outrank this file if they disagree: `docs/frontend-status.md`
> (canonical status), `docs/fe-w3-spec.md` §4a (every frontend decision),
> `docs/gotchas.md`, `docs/push-readiness.md`, `PROJECT-OVERVIEW.md`.

---

## 1. Where the project actually is

**The app is built and it runs.** All four design phases are implemented except four
frames, and every one of those four is blocked on a decision or an endpoint, not on
engineering. It has been signed into and driven on the emulator. It has **never** run
on a physical handset, and **nothing has ever been pushed** — 54 commits sit on one
laptop and CI has never executed on any of them.

|                                |                                                                     |
| ------------------------------ | ------------------------------------------------------------------- |
| Commits ahead of `origin/main` | **54** (0 behind)                                                   |
| CI runs, ever                  | **0**                                                               |
| Suite                          | **23/23 turbo tasks green · 1,086 tests** across 7 workspaces, 2 runners |
| Emulator                       | Signed in, driven end to end — `Pixel_10`, API 36 / Android 16      |
| Physical device                | Never                                                               |
| Gates FE-G1 / FE-G2            | **Both open.** Both are device gates                                |

**The single most important sentence in this document:** the three things standing
between this project and a verifiable state — a push, a handset, and an org owner
granting write access — are all **human actions**, and have been for three weeks.
See §5.

---

## 2. What you get if you run it today

Signed in as a seeded MR, the app renders the Today screen: the next visit, a
visits-done counter, a sync status line and the four-tab bar (Today · Doctors ·
Coaching · Me). The doctor list, beat plan, visit flow, consent handoff, samples,
mileage, transparency, settings and the outbox are all built and navigable.

**What you are looking at is mostly fixtures.** Authentication is real — it goes to
Supabase GoTrue and returns a session the app accepts. Every other read comes from
`services/mock`, which returns static fixtures and **persists nothing**: a consent
record or a sample written by the app is accepted and forgotten. No `POST` has ever
been round-tripped through a real server.

**Audio records and never leaves the phone.** The voice-note screen says so, in
those words, to the MR. That is the largest functional gap in the product and it is
backend work — item 1 of `handoff-frontend.md` §2.

---

## 3. How to run it — the corrected recipe

The recipe in `handoff-frontend.md` no longer works as written; its last line fails.
This is the version that was executed today, in order. All paths are from the repo
root, **`C:/dev/Elmiron-App`**.

```bash
# 0. Prerequisites: Docker Desktop running, an emulator booted (Pixel_10),
#    Node 24, pnpm 11.21. Rebuilding the APK additionally needs JDK 17 —
#    this machine's terminal JAVA_HOME is JDK 25, which fails at CMake.
pnpm install

# 1. Backend. Auth lives here — without it you cannot get past the first screen.
pnpm db:start                                   # retry once on
                                                # LegacyStatusDbNotReadyError; the DB
                                                # container is still starting
pnpm mock                                       # mock API on :4010, separate terminal
pnpm --filter @fieldforce/api seed:mr           # prints working credentials

# 2. The app.
adb install -r apps/field/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:54321 tcp:54321 && adb reverse tcp:4010 tcp:4010
cd apps/field && node ../../node_modules/expo/bin/cli start --dev-client
adb shell monkey -p com.praversetech.fieldforce -c android.intent.category.LAUNCHER 1
```

**Three traps, all of which cost time today:**

1. **`pnpm --filter @fieldforce/field exec expo start` is broken.**
   `node-linker=hoisted` puts `expo` in the root `node_modules`; `pnpm exec` resolves
   the workspace-local shim first and it points at a path that layout never creates.
   Call the hoisted CLI directly, as above.
2. **The package id is `com.praversetech.fieldforce`.** The root `app.json` still
   says `com.anonymous.elmironapp` — a leftover from a prebuild run in the wrong
   directory. Launching that id aborts with "No activities found to run."
3. **`adb reverse` dies with the emulator** and is not optional — `127.0.0.1` inside
   the emulator is the emulator. Re-run all three lines after every emulator restart.

**Stop every `node` process before `pnpm install`.** Metro and the mock hold file
handles in the hoisted `node_modules` and pnpm fails with `ERR_PNPM_ENOENT`. Not a
pnpm bug; do not chase it.

---

## 4. What is not built, and why

Four frames. **None is an engineering gap.**

| Frame                          | Blocked on                                                                                   | Owner   |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------- |
| Phase 3 D6 · recording bar     | Resumable upload has no client-usable path. Audio is captured and cannot be sent              | Backend |
| Phase 3 D7 · voice note        | Same                                                                                          | Backend |
| Phase 4 E1 · overrides panel   | No `GET /analyses/:id/overrides` — there is a POST and no way to read them back                | Backend |
| Phase 4 E3 · audit + retention | No audit-log path, no retention path                                                          | Backend |

Plus two the app has had to say out loud to the user:

- **Location-denied check-in is unimplementable.**
  `CreateCheckInRequestSchema.coordinates` is required and non-nullable, so Phase 2
  S4's promise — "the app fully works with location denied" — cannot be kept. Needs
  the field nullable or a `manual-no-fix` variant. **A product decision, not a bug.**
- **Nothing counts UCPMP caps.** The schema comment says caps are "enforced
  server-side"; no column, constraint or function does it. The samples screen tells
  the MR plainly that the app is not counting and asks them to keep their own count.
  Either implement it or correct the comment.

**Why the app says these things instead of hiding them:** the frontend refuses to
display anything the server has not told it. No invented cap, no invented rate, no
invented retention figure, no "sent" over an unsent file. A bar reading "Recording ·
he agreed at 11:58" over an app that captures nothing is not an unfinished feature,
it is a false statement to a doctor who has just been asked to trust it.

---

## 5. What is blocking, and whose it is

| #   | Blocker                                                                                                                                                                                                                                                           | Owner                          | Cost                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------- |
| 1   | **`git push` returns 403.** `Devpt1904` has no write access to `Praverse-Tech-Pvt-Ltd/Elmiron-App`. This is **account-level authorisation, not token scope** — the error names an account and says denied. A second gate waits behind it: `workflow` scope, because `.github/workflows/ci.yml` is modified | An org owner, in GitHub's web UI | Minutes                     |
| 2   | **No physical Android handset.** FE-G1 and FE-G2 are both device gates and cannot be closed on an emulator                                                                                                                                                          | A human with a budget          | ~₹8–15k *(unverified)*      |
| 3   | **The eight backend asks** in `handoff-frontend.md` §2                                                                                                                                                                                                              | Backend                        | —                           |
| 4   | **The console's auth story** has never been decided, and it should be before anyone is shown it                                                                                                                                                                     | A human decision               | —                           |

Mitigation for (1) while it stays blocked: `C:/dev/elmiron-app-03sep2026.bundle` —
all six refs, `git bundle verify` clean, test-restored to a scratch clone. **It is on
the same disk as the repo, so it is not yet a backup.**

---

## 6. What to trust in this repo, and what not to

- **`docs/frontend-status.md` is the canonical frontend status.** It is written in
  dated sections that are never edited afterwards — a wrong claim gets corrected in
  the _current_ section, saying what it replaced, rather than rewritten in place.
- **`PROJECT-OVERVIEW.md` is append-only and CI-enforced.** Frozen sections are never
  edited; add a correction section.
- **A test count is not coverage.** Five defects passed lint, typecheck and the
  entire suite and were caught only by running the app — including consent copy that
  misgendered the rep, a "no notice" gate that fired while still loading, and a font
  gate that returned `null` with no deadline and left the app permanently blank. Each
  now has a regression test naming the run that found it. **Run the app.**
- **Always report the test split**, never the single figure — 1,086 spans two runners
  and seven workspaces and hides which one moved.
- **This machine has a second, wrong checkout** at
  `C:/Users/devp0/StudioProjects/Elmiron-App`. It is not the working repository, it
  uses the `@elmiron/*` namespace instead of `@fieldforce/*`, and one commit landed in
  it by mistake. `NOT-THE-REPO.md` in that tree has the audit. **Check
  `git rev-parse --show-toplevel` before you work.**

---

## 7. If you are picking this up next

In the order that unblocks the most:

1. **Get the push unblocked**, then run CI once. Expect the first run to be red — it
   has never executed against any of this.
2. **Run on a physical handset** and close FE-G1/FE-G2. Everything claimed here is
   emulator-only.
3. **Backend: ship the resumable upload.** It is the difference between an audio
   feature and a screen apologising for one.
4. **Decide `coordinates` nullability** — Phase 2 S4 is a promise the app cannot
   currently keep.
5. **Decide the console's auth story** before it is demonstrated to anyone.
6. Fold today's three run traps into `docs/gotchas.md`, and fix the stale
   `com.anonymous.elmironapp` in the root `app.json`.
