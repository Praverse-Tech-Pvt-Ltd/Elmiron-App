# Frontend — Actual State

> [!IMPORTANT]
> This is the canonical frontend status; the Claude-side mirror at `claude/frontend-status.md` is a convenience copy and defers to this file.

**Snapshot at Phase 4 close, 3 September 2026.** Describes what exists, not what was planned.

If this file and a chat window disagree, this file is wrong — update it. If this file and the repo disagree, **the repo wins**: `PROJECT-OVERVIEW.md`, `.ai-collab/decisions.md`, `.ai-collab/constraints.md`, `docs/gotchas.md` and `docs/brand-identifier-decision.md` are tracked. This is a summary for people on the Claude side who cannot see the repo.

---

## One-line status

**Every test green locally. Nothing pushed, CI has never run, and FE-G1/FE-G2 remain open.** The app has been signed into and driven end to end on the emulator — `emulator-passed / device-pending`, never a passed gate.

**47 commits ahead of `origin/main`, 0 behind**, checked 3 September. The push is **not** a token-scope problem: `Devpt1904` does not have write access to the repository, which is an account-level authorisation failure no scope change fixes. `workflow` scope is a second gate behind it. See `docs/push-readiness.md`, which is where that misdiagnosis was caught.

**All four design phases are built except three frames, each blocked on a decision rather than on engineering** — see *Design phases* below.

---

## Sprint state

| Sprint | Built | Gate | State |
|---|---|---|---|
| FE-W1 | Monorepo, tokens, extraction lint rule, config, password sign-in, five routes | **FE-G1** — signed-in APK on a physical device | **OPEN** |
| FE-W2 | Sync reducer + explanation layer, mutation-tested | **FE-G2** — full offline day, then sync accepted | **OPEN** |
| FE-R1 / R1a | Package identifier rename. Unplanned, necessary. | — | Done |
| FE-H1 | Render harness — jest for `.tsx`, vitest for `.ts`, boundary enforced by tests | — | Done |
| **FE-W2b** | **`packages/ui` harness + CI · 19 route cases · the queue screen · 3 mutation proofs** | — | **Done** |
| **FE-W3** | **The field surface — tabs, Today, doctors, beat plan, visit, mileage, transparency, settings, the outbox** | — | **Done** |
| **Phase 2** | **28/28 frames. C5 samples and B7 day-end closed it on 3 September.** | — | **Done** |
| **Phase 3** | **The consent handoff — 3 variants, the legal layer, the declined state (D1–D5)** | — | **D6/D7 blocked on audio** |
| **Phase 4** | **The MR's coaching (D1–D3) and the admin console (E3)** | — | **E1/E2 held by §3.6** |
| **Phase 1** | **14/14 components, tokens, DM Sans, the Cormorant brand line** | — | **Done** |

### Design phases — what is left, and who owns it

| Frame | Blocked on | Owner |
|---|---|---|
| Phase 3 D6 · recording bar | Audio capture. No `expo-audio`/`expo-av`; adding a native module takes the app out of Expo Go. FE-W4. | Engineering, once the dev-build path is chosen |
| Phase 3 D7 · voice note | Same. | Same |
| Phase 4 E1 · coaching queue | §3.6 — puts an AI analysis of a named employee in front of their manager. The 3 September reversal covered the MR's own screens only. | A human decision |
| Phase 4 E2 · analysis review | Same. | Same |

A bar reading "Recording · he agreed at 11:58" over an app that captures nothing is not an unfinished feature, it is a false statement to a doctor who has just been asked to trust it. That is why D6/D7 stay unbuilt rather than being stubbed.

**Checks** all pass. **Gates** — none have passed. Both terms were used interchangeably early on; fixed in the repo record.

### Test counts — per workspace, per runner

| Workspace | Runner | Count | Was, 31 Aug |
|---|---|---|---|
| `field` | vitest | 302 | 44 |
| `field` | jest | 72 | 24 |
| `ui` | vitest | 4 | 4 |
| `ui` | jest | 212 | 19 |
| `ui-tokens` | vitest | 54 | 38 |
| `core` | vitest | 21 | 21 |
| `mock` | vitest | 40 | 40 |
| `api` | vitest | 344 (stack up, passed not skipped) | 333 |

**1,049 total. A single figure spans two runners and seven workspaces and hides which one moved — always report the split.**

**A count is not coverage, and three defects this week were found by running the app rather than the suite:** the consent copy misgendered the rep, the "no notice" gate fired while still loading, and the sync indicator printed a raw UTC timestamp on the home screen. Each now has a regression test naming the emulator run that caught it. The suite is worth what it asserts, not what it totals.

---

## What FE-W2b actually produced

**The first MR-facing surface in this project.**

- **Five route files, 17 `it()` blocks / 19 executed cases.** `app/_layout.tsx` deliberately untested — the only honest assertion available is "it did not throw."
- **The queue screen** — component in `packages/ui`, binding in `apps/field`. It decides nothing. `packages/ui` cannot import the reducer, so `QueueScreenProps` is structural and **the binding's straight-through pass is the compile-time check**. That guarantee is *bounded*: it covers only fields the props type names.
- **Five states**, each with a glyph and a text label, fed by contract-parsed input through the real reducer — not by mock fixtures.
- **`LONG_RETRY_AFTER_ATTEMPTS = 3`, display only.** Three tests prove it changes presentation and nothing else, including that a row crossing it does not move — *position is read as priority, and priority is a verdict the server owns*.

### The decision worth carrying forward

**No duration is computed anywhere on this screen.** The only timestamp rendered is `RejectionRecord.receivedAt` — the server's clock — and only for items the server has answered. A queued item has **no server timestamp**, so the screen shows **no time at all** rather than passing off the device clock as though the server knew about the work. A test asserts that absence.

That is also *why the threshold counts attempts rather than elapsed time*: there is no trustworthy clock to measure from. Recorded, so nobody "improves" it back.

### Accessibility — asserted vs deferred

**Asserted:** every state renders a text label, so meaning is never carried by colour or glyph alone; the glyph is invisible to the accessibility tree, **proved by the query engine failing to find it without `includeHiddenElements: true`**; glyphs are pinned to an explicit five-codepoint allowlist.

**Deferred to device verification, not implied to be checked:** 44px touch targets (`minHeight` set, not measured) · 16px minimum body, weight 400 minimum (tokens used, resolved size unverified).

---

## Toolchain — where the build actually stands

Android Studio is installed. API 36 platform present. The emulator in use is **Pixel_10, API 36 / Android 16** — verified with `adb shell getprop ro.build.version.sdk`. An earlier "API 37.1" in these records was the emulator *tool* version mistaken for an API level; there is no API 37 in this toolchain. All three blockers below are now resolved.

| Issue | State |
|---|---|
| `ANDROID_PREFS_ROOT` + `ANDROID_USER_HOME` both defined | **Resolved.** Process-scope injection by the IDE. Build from an external terminal. |
| API 36 platform missing | **Resolved.** Installed. |
| **JDK 25 fails at CMake configuration** | **Resolved.** JEP 472 restricted-method error on `react-native-screens` and `react-native-worklets`; JDK 17 installed for both Gradle and terminal `JAVA_HOME`. |
| Windows path length during CMake | **Resolved.** pnpm switched to the `hoisted` linker. `CMAKE_OBJECT_PATH_MAX` is the *hypothesis*, supported by the fix working — nothing measured the path length before or after. |

**The app has been built and run on the emulator** (27 August, first native build; sign-in screen captured 31 August). It has never run on a physical handset.

---

## The blocking chain

| # | Blocker | Whose |
|---|---|---|
| 1 | ~~**JDK 17**~~ | Resolved 27 August |
| 2 | **`git push`** — 34 commits, CI has never run. Blocked on token scope: `repo`, plus `workflow` because the CI file changed. Only a human can grant it, in GitHub's web UI. | Human |
| 3 | **A physical Android handset** | Human, ~₹8–15k *(unverified)* |

An emulator pass is recorded as **`emulator-passed / device-pending`**, never as a passed gate.

---

## Since FE-W2b — FE-Build-1 through 2f (27–31 August)

Toolchain and hygiene work, plus one real defect. No feature work.

- **First native build** on the emulator, after JDK 17 and the hoisted pnpm linker.
- **Reconciled with `origin/main`.** Merge, not rebase — both backend commits touch
  files the frontend also touches, and replaying 32 commits through them is the same
  conflict up to 32 times. In the event there were no conflicts: `ort` auto-merged
  both files. Nothing frontend changed; the R1 rename `f34ceef` is still an ancestor.
- **The safe-area defect: every screen, not one.** `SafeAreaProvider` was mounted and
  nothing consumed it, and the `Stack` runs `headerShown: false`, so no header
  reserved the status bar. Fixed once in `packages/ui`'s `Screen`, which every route
  renders inside — a per-screen `SafeAreaView` leaves the next new screen broken by
  default, which is how it arrived. Two tests, negative-controlled (`Expected 63,
  Received 16` with the fix removed).
- **The append-only rule is now a CI control**, not prose inside the file it protects,
  after `prettier --write` reformatted a frozen table. Negative-controlled too.
- **Hoisting drifted 40 package versions** into the lockfile and removed none. The
  `react-native-worklets` pin held; a second copy of the Expo and Metro toolchains
  came in through `jest-expo`'s peers, so tests do not necessarily run against the
  toolchain the app builds with. Reported, not pinned — a pin is a decision.
- **Root-anchored `.gitignore` entries.** `apps/field/android/` never matched a
  root-level `android/`, which an Expo prebuild run from the wrong directory created.

---

## Standing rules earned

**Toolchain**

- **This project's toolchain is deliberately pinned. Newer is not better.** Three failures in one session traced to bleeding-edge versions: API 37 emulator, JDK 25, Gradle 9.3.1. React Native's Android path lags by design.
- Android Studio's Gradle JDK and the terminal's `JAVA_HOME` are **separate settings**. Fix one and you get a build that works in the IDE and fails on the CLI.
- The emulator's system image API and `compileSdkVersion` are **separate installs**.
- AGP's `AndroidLocationsException` says *"different paths"* while printing two identical ones. The rule is that only **one** mechanism may be defined.

**Verification**

- **A mutation that removes the check is not a proof of the check.** If the case count drops, the mutation was a no-op and the proof is void.
- **Assert the observable consequence, not the prop.** Testing `importantForAccessibility="no"` passes whenever the prop exists; querying the accessibility tree proves what actually reaches TalkBack.
- **Allowlists beat ranges.** "Below U+2800" does not exclude emoji — U+2705, U+274C, U+26A0 all sit below it. U+2714 is one codepoint from U+2713 and has emoji presentation. An explicit five-codepoint allowlist kills that; the range check passed it silently.
- **A control invoked by a hand-maintained list will eventually be left off it.** `ui-tokens`' contrast guard never ran in CI until FE-H1. All six workspaces with real test scripts are now invoked.
- Anything landing in `AndroidManifest.xml` is verified **at prebuild, never at config** — `expo config --type introspect` resolves happily on a config whose intent filters never reach the manifest. This matters for `ACCESS_BACKGROUND_LOCATION` and background audio in FE-W3/W4.

**Architecture**

- **Routes bind, screens render.** The extraction lint rule bans RN primitives in `apps/field` and therefore cannot see a screen assembled from `@fieldforce/ui` components. Proposed fix: `import/no-restricted-paths` using the existing `eslint-plugin-import`. **Proposal, not implemented.**
- **Hiding a row is navigation, not permission.** Never implement permission logic in the client. A denial renders as a denial, never as an empty list.
- Dead-lettering is the server's decision. Server rejection sentences render verbatim; a test fails on rewording.

**Records**

- Section headers carry the date of the work, from the commit timestamp, and are **never edited afterwards**. A false claim gets corrected in the *current* section, dated, saying what it replaced — not rewritten in place, which erases that it was ever wrong.
- Report **blocks and cases** separately wherever parameterised tests exist.

---

## Two-tool routing, and how it has gone wrong

**Gemini in Android Studio owns the toolchain. Claude Code owns the repo.** Gemini has no context on this repo's conventions.

**That boundary has been crossed twice** — both times because a Claude Code prompt was pasted into Gemini. The first produced an in-place edit to `PROJECT-OVERVIEW.md` (since reverted and re-recorded correctly). The second edited a test file in `packages/ui`, which the Gemini fence explicitly forbids.

Neither caused damage. Both were caught in review. The routing needs watching, not the tools.

---

## Known gaps

- **OTP sign-in was never built**, and could not work today — no deep-link scheme was ever in Supabase's `additional_redirect_urls`. **Backend request outstanding:** add `com.praversetech.fieldforce://auth-callback`.
- **The `payload` residual** — `z.record(z.string(), z.unknown())`. At type level `unknown` is not a function, so a JSON-shape assertion passes while closing nothing. **Trigger: the moment any code path invokes something out of `payload`, this becomes a live arbitrary-execution path and the import-list guard stays green.**
- **`services/mock` fixtures are unreachable** — no `exports` map, and an entrypoint that starts a listener on import.
- **The retry/backoff schedule is undefined** until FE-W3/W4, so whether `= 3` attempts is reached in seconds is unknown.

---

## O2 — closed for India

ELMIRON is registered by the client's team in **classes 9 and 42**, covering software. The package ID stays **`com.praversetech.fieldforce`** — reverting costs another 53-file sweep and buys nothing, since a neutral identifier is correct under either answer. The display name carries the branding; that half was always meant to be free.

**Closed for India only.** Class 9/42 in one market is not a global position, and a software mark identical to a third party's *pharmaceutical* mark, on an app about that pharmaceutical, is a narrower fact pattern than an unrelated one. Counsel's call.

`PROJECT-CONTEXT.md` §3.1 still overstates its confidence that "Elmiron does not exist in India" — needs a downgrade at the next reconciliation.

---

## Reviewer's read

The device-free runway is **spent**. FE-W2b was the last work that could be done honestly without hardware, and it was done well — the guards are real, the counts are auditable, and the two decisions that mattered most (no client clock, allowlist over range) were both caught and both fixed.

What has not changed in three weeks: nothing has been pushed, CI has never run, and the app has never executed. Every one of those is a human action away.

---

## Related docs

**Repo:** `PROJECT-OVERVIEW.md` · `.ai-collab/decisions.md` · `.ai-collab/constraints.md` · `docs/gotchas.md` · `docs/frontend-plan-v2.md` · `docs/brand-identifier-decision.md` · `docs/backend-request-scope-rename.md`

**Claude side:** `frontend-plan-v2.md` · `frontend-prompt-w1.md` · `frontend-prompt-r1-rename.md` · `frontend-prompt-h1-harness.md` · `frontend-prompt-w2b-final.md` · `gemini-prompt-android-setup.md` · `design-plan.md` *(still needs committing to repo `docs/`)*

---

## 7 September 2026 — the run, re-done from a cold machine

*Appended, not edited. Everything above is the 3 September snapshot and stays as
written. This section records what a cold start actually took, four days later, and
corrects two claims above.*

**No code changed.** Head is still `32cb85e` on
`fe/phase2-c5-b7-and-phase3-consent`, tree clean, **54 commits ahead of
`origin/main` and 0 behind**. CI has still never executed.

### What was verified by running it

The app was installed, started and **signed into** on the emulator (`Pixel_10`,
API 36 / Android 16 — `ro.build.version.sdk` = 36, release 16). Metro bundled
`expo-router/entry` in 1.34s, 1701 modules, no warnings that reached the screen
beyond the standard dev-client notice. Sign-in with a freshly seeded MR
(`pnpm --filter @fieldforce/api seed:mr`) landed on the Today screen with the next
visit, the 2-of-3 counter, the sync line and the four-tab bar all rendering.

**This corrects one line in "Unverified" above.** That section says "nothing has
been round-tripped through Supabase". **Authentication now has been** — the sign-in
went to local GoTrue on `:54321` and returned a session the app accepted. The rest
of the claim stands unchanged: every domain read on that home screen came from
`services/mock` on `:4010`, which returns static fixtures and persists nothing. **No
`POST` write has been round-tripped through Supabase.**

### Suite

`pnpm turbo run lint typecheck test` → **23/23 tasks successful** (fully cached; no
input had changed since 3 September). `@fieldforce/api` was additionally re-run
uncached against the live local stack: **344 passed, 14 files, 0 skipped**. Counts
are otherwise unchanged from the table above — 1,086 across seven workspaces and two
runners.

### One new toolchain trap, found today

**`pnpm --filter @fieldforce/field exec expo start` is broken in this repo** and the
documented run recipe in `handoff-frontend.md` §"How to run the frontend" therefore
fails at its last line:

```
Error: Cannot find module 'C:\dev\Elmiron-App\apps\field\node_modules\expo\bin\cli'
```

`node-linker=hoisted` (set in `.npmrc` and `pnpm-workspace.yaml`, and itself the fix
for the Windows CMake path-length failure recorded above) puts `expo` in the **root**
`node_modules`. `pnpm exec` still resolves the workspace-local `.bin` shim first, and
that shim points at a path the hoisted layout does not create. Working invocation:

```bash
cd apps/field && node ../../node_modules/expo/bin/cli start --dev-client
```

**Not yet written into `docs/gotchas.md`.** It belongs there next to the other
hoisting consequences, alongside the note that the recipe's package id is
`com.praversetech.fieldforce` — the root `app.json` still carries the stale
`com.anonymous.elmironapp` from a prebuild run in the wrong directory, and
`adb shell monkey` against that id aborts with "No activities found to run."

### The environment a cold start needs, which the recipe does not say

Docker was not running, so `pnpm db:start` had nothing to talk to; the first attempt
after starting Docker Desktop failed with `LegacyStatusDbNotReadyError` and succeeded
on retry once the `supabase_db_Elmiron-App` container reported healthy. **Sign-in is
unreachable without that stack** — auth is Supabase, not the mock, so "start the
mock and run the app" is not enough to get past the first screen.

The terminal `JAVA_HOME` on this machine is **JDK 25**, not the JDK 17 the Gradle
build needs. It did not matter today because the existing debug APK was reinstalled
rather than rebuilt. It will matter the moment anyone rebuilds.

### Unchanged, and still the whole story

FE-G1 and FE-G2 are **device** gates and today was an emulator, so both remain open
and this run is recorded as `emulator-passed / device-pending`. The push, the
handset, and the eight backend asks in `handoff-frontend.md` §2 are all exactly where
they were on 3 September. **Nothing in this section is progress; it is confirmation
that four-day-old work still starts.**

---

## 9–11 September 2026 — MR-14 → MR-28, and the gates

**The section above ends with *"nothing in this section is progress; it is confirmation that
four-day-old work still starts."* This one is progress, and the gates still did not move.**

### What closed

**`G-WRITE`: MET.** All five write paths — check-in, check-out, consent, samples, call report
— write to Supabase **from real screens**, online and offline, exactly once, with capture
timestamps preserved through the queue. All four project refusals reach the MR with their own
remedy and never another's:

| SQLSTATE | forced by | proved in |
| --- | --- | --- |
| `45001` | a newer notice published while the device held a stale store | MR-27 C1 |
| `45007` | future tolerance set to −3600 (test-only, reverted, verified) | MR-27 C1 |
| `45008` | lag ceiling set to 0 (test-only, reverted, verified) | MR-27 C1 |
| `45004` | cap of 1 (test-only, reverted, verified) — **with the cap, month-to-date, this entry and the period as real numbers, and the doctor by NAME** | MR-28 B4 |

**`FE-W38`: CLOSED.** MR-26 B4 ran the full five-write cycle with the Supabase ports removed
(**not** by turning wifi off — `adb reverse` runs over the adb transport and wifi cuts
nothing). The app was force-stopped and relaunched still offline; all five survived, then
arrived within two seconds of reconnecting, each as the correct entity type, with the queue
gap visible in the data (`capture_lag = 00:10:04` on the consent row) — which is the proof
that nothing is restamped at flush.

### What did NOT close, and why

**`FE-G1` and `FE-G2` are DEVICE gates and every run above was an EMULATOR.** They are now
blocked on exactly two things:

1. **A real Xiaomi / Oppo / Vivo / Realme handset** — `blocked-on-you` 5.1, open seven weeks.
   A Pixel proves nothing; those four ROMs are the battery killers the app has to survive.
2. **A dev-client build** — JDK 17, CMake, `expo prebuild`. Deferred since MR-14 and now the
   only item on the critical path from this side. Expo Go cannot load
   `react-native-background-geolocation` or `expo-audio`'s native halves.

`FE-G2` is *8 hours offline, ≥20 queued writes, then sync*. MR-26 B4 was five writes over
eleven minutes. **`FE-W40` also means an MR who restarts offline sees no day**, which an
8-hour run would hit.

### Machine facts a rebuild will need

- The terminal `JAVA_HOME` on this machine is **JDK 25**. The Gradle build needs **17**. This
  has been true and unblocking since 3 September only because the existing debug APK keeps
  being reinstalled rather than rebuilt.
- `adb emu geo fix` **returns OK and delivers nothing.** MR-19 recorded a gotcha that was
  never validated. What works:
  `adb shell appops set 2000 android:mock_location allow` then
  `adb shell cmd location providers set-test-provider-location fused --location <LAT>,<LNG>`
  — **latitude first**, the opposite order to `geo fix`.
- Android Studio launches its AVD with `-qt-hide-window`; a blank or off-screen emulator is
  that, not a broken image. Launch the AVD standalone.
- `adb reverse` is needed for **8081, 54321, 54322 and 4010**, and none of it survives a
  reboot.

### Defects found by RUNNING the app, 9–11 September

Twelve numbered, plus several unnumbered. The ones worth the next reader's attention because
they were invisible to every test that existed at the time:

- Every clock read rendered **5h30m early** (MR-15 A2).
- A check-in never marked the visit started, so **check-out was unreachable** (MR-24).
- A doctor's **withdrawal of consent was silently discarded** — the app said "accepted" and
  one row said `consented` (MR-24).
- A **server refusal was shown as an offline save** and re-queued (MR-24).
- A refused consent **reached nobody**: the screen discarded the outcome and navigated back
  whatever the server said (MR-27 C1).
- **Defect 12** — a check-in the server ACCEPTED left the screen on "Not started", so it was
  pressed twice and the server recorded two (MR-28 B4).

The detector in every case was the same one the handover has named since day one: **running
the app.**
