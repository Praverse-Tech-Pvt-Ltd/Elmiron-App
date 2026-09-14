# Project Handoff

**Working notes. Not the record.** `PROJECT-OVERVIEW.md` and `docs/gotchas.md` are the
durable, cumulative, append-only record; this file is the thing you read first to find out
where to look. Where this file disagrees with either of those, **they are right.**

**Restructured 14 September 2026 (MR-32 D).** This file had grown to 627 lines with a
banner reading *"STATUS AS OF 11 SEPTEMBER — read this first"* at line 353, and three later
sessions appended beneath it, each contradicting parts of the block that told you to read it
first. Nothing was deleted: every per-session narrative it carried is in `PROJECT-OVERVIEW.md`
in a longer form, and the index below says exactly where. What is kept here is the durable
half — the commands, the traps and the rules — plus one dated statement of where things
stand.

Permitted by `.gitignore:22-26`, which records the BE-W8 decision that these files are
*"expected to be updated regularly, not treated as a point-in-time snapshot"*. The
section-freezing rule in `.ai-collab/decisions.md` is scoped to `PROJECT-OVERVIEW.md` and
does not govern this file.

---

## Where things stand — 14 September 2026, after MR-32

| | |
| --- | --- |
| **`G-WRITE`** | **MET.** All five MR writes reach Supabase from real screens, online and offline, exactly once, with capture timestamps preserved; all four `450xx` refusals reach the MR with their own remedy |
| **The dev client** | **Built and driven.** A Gradle-built debug APK, signed in, a live check-in written to Postgres, `expo-audio` proved by the Android audio HAL opening a record session for the app's own pid |
| **`FE-G1` / `FE-G2`** | **Blocked by the handset alone.** Background location is *unwritten*, not untested, and neither gate needs it. Seven weeks outstanding |
| **The clock** | No screen in `apps/field` takes *now* **or** a local calendar field from the handset. Both halves are lint-enforced |
| **Recovery** | The runbook has now been executed once. Its reconciliation works; **step 2 has no mechanism behind it** — no PITR, no dump script, no off-machine copy (`BE-W11`) |
| **Tests** | Read them from the runners, never from `test-counts.mjs` |

**The three blockers that are not engineering**, in `docs/blocked-on-you.md`, which is the
file to read next:

1. **5.13 / `BE-W93` — the fiduciary name.** Compounds daily. `consent_records` is
   append-only, so every consent captured before the organisation's registered name exists is
   permanently defective and cannot be amended by design.
2. **5.9 — the UCPMP cap.** A build-failing deadline of **6 November**, warning from
   16 October. Do not invent a value; `check:decision-debt` exists to stop exactly that.
3. **5.1 — the handset.** Two device gates, seven weeks, nothing else can close them.

---

## Durable rules — the ones earned the hard way

**Nothing in the client decides permissions, and nothing re-derives a server rule.**

- **Precedence lives once.** Consent-notice ordering is `public.consent_text_version_precedence`
  and is *transmitted* to the client. The client mirrored it for one session, and that
  duplication would have failed as a `45001` in front of a doctor, not as a red test.
- **The clock is the server's — and so is the calendar.** `serverTime` drives the territory
  day and the consent activation window. `getMonth()`/`getDate()` on a correct instant are
  still wrong, because they answer in the *device's* zone; five screens were wrong that second
  way after the first was fixed.
- **A refusal's FIGURES are rendered, never parsed.** `sqlDetail`/`sqlHint` are the raise
  site's `DETAIL`/`HINT` verbatim; `sqlState` is the contract.
- **When a type has no room for "I don't know", something plausible gets put there.** The
  diagnostic is not *"is the absence representable"* — it is **count the call sites that read
  the discriminant**. A discriminated union with zero readers is a sentinel with extra steps.
- **Before using `null` for "unknown", check what `null` already means.** It meant "never
  visited", and a nullable clock would have told an MR that a doctor seen last week never was.

---

## Verification commands, in the order a new machine needs them

```
pnpm db:start            # also runs db:instrument (BE-W92's log_lock_waits)
pnpm --filter @fieldforce/api seed:day
pnpm ci:local            # static steps only
pnpm ci:local --with-db  # needs Docker; verify:rollbacks EMPTIES the schema, db:reset after
```

**`pnpm ci:local` green is not "CI will pass".** It deliberately omits the database job and
says so on stderr.

**Operational checks, all with the `@fieldforce/` scope — the runbook said `@elmiron/` until
MR-32 and `pnpm --filter` on a name that does not exist prints a message and exits 0:**

```
pnpm --filter @fieldforce/api check:purge-health
pnpm --filter @fieldforce/api check:migration-drift
pnpm --filter @fieldforce/api reconcile:restore            # dry run; --apply needs --db-url
```

---

## Environment traps, all measured on this machine

- **`JAVA_HOME` is unset and `java` is already 17.0.12.** There is **no JDK 25 on this
  machine at all**; Android Studio's JBR is 21.0.10. Any document saying otherwise is stale —
  five of them were.
- **`gotchas.md`'s "CMake 3.22.1 cannot build this app" did not reproduce** under RN 0.86.2.
  Test before installing 3.31.6 and re-applying a pin that `expo prebuild` erases.
- **The Android build fails at `:app:packageDebug` with `OutOfMemoryError: Java heap
  space`** — Gradle's own heap, `-Xmx2048m`, while packaging four ABIs. For the emulator:

  ```
  ./gradlew.bat assembleDebug --no-daemon --max-workers=3 -PreactNativeArchitectures=x86_64
  ```

  **That APK is x86_64 only.** A handset build drops the flag and then needs the heap raised.
- **`adb emu geo fix` delivers nothing**, and `set-test-provider-location` is not enough on
  its own — `fused` must be **added** as a test provider first, latitude first, and the fix
  re-pushed while the screen is asking.
- **Airplane mode cannot simulate offline for a DEBUG build** — the JS bundle comes from Metro
  at launch. Remove the API's reverse ports and leave `tcp:8081`.
- **Git Bash rewrites absolute paths passed to `docker` and `adb`.** `/tmp/x` becomes
  `C:/Program Files/Git/tmp/x`. Use `MSYS_NO_PATHCONV=1` **scoped to that one command** —
  exporting it shell-wide breaks corepack's own resolution and makes `pnpm` fail with a
  `MODULE_NOT_FOUND` that looks like your script's fault.
- **To drive calendar-dependent state on the device, edit the app's storage, not the clock.**
  `adb root` is refused on a production emulator image. A debug build is `debuggable`, so
  `run-as <pkg> cat databases/RKStorage` pulls AsyncStorage's SQLite file. **Check which
  tenant you edited** — a first attempt in MR-31 moved another seed run's row, RLS kept it out
  of this MR's pull, and the screen correctly did not change.

---

## If you are converting a screen to `serverTime`

- `serverTime` is **nullable**. Every fallback is a lie of the same shape: the device clock is
  `FE-W40` option B, and any fixed value renders exactly like a measured one.
- Check what your **label function** does with the `null` you are now able to pass it.
- The window helpers are in `src/today/server-window.ts` and take the instant rather than
  reading one. Do not reach for `getMonth()`.
- Test with values that **straddle 18:30Z**. `07:44Z` is the same date in UTC and IST and
  proves nothing.
- The pattern to copy is `app/(tabs)/home.tsx`: read `dayOrigin` beside `today`, render the
  age when anchored, and say *why* when expired rather than borrowing the network's message.

---

## Where the history went — the index

Every per-session narrative this file used to carry is in `PROJECT-OVERVIEW.md`, longer and
frozen. Nothing was deleted.

| Era | Read |
| --- | --- |
| BE-W7 / BE-W8 and the production deploy | `PROJECT-OVERVIEW.md` → `### BE-W8 — Operational readiness` |
| FIX-01 and the 8 September corrections | `.ai-collab/decisions.md` → *7 September 2026 — FIX-01 corrections*; `PROJECT-OVERVIEW.md` |
| MR-14 → MR-28, the write paths and `G-WRITE` | `PROJECT-OVERVIEW.md` → `### MR-28 — the last G-WRITE item` and the sections before it |
| MR-29 — the dev-client build | `PROJECT-OVERVIEW.md` → `### MR-29` |
| MR-30 — `FE-W40`, the cold-start day | `PROJECT-OVERVIEW.md` → `### MR-30 — FE-W40` |
| MR-31 — `FE-W42` and the sentinel class | `PROJECT-OVERVIEW.md` → `### MR-31 — FE-W42 and the sentinel class` |
| MR-32 — the restore drill | `PROJECT-OVERVIEW.md` → `### MR-32 — the restore drill` |
| Open work items | `docs/COMPLETION-PLAN.md` |
| Traps and classes of defect | `docs/gotchas.md` |
| What is blocked on a human | `docs/blocked-on-you.md` |
