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
| **Tests** | `node scripts/test-counts.mjs` -- fixed in MR-39 A1 to report PASSING cases and to exit 1 on any suite that failed to run. The old advice to avoid it no longer applies |

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

---

## After MR-33 — 15 September 2026

**Read `docs/blocked-on-you.md` first this time. Two of the three new items are the session's
actual output.**

| | |
| --- | --- |
| **Production** | **37 migrations behind.** 56 files on `main`, **19** applied, nothing applied off-`main`. Last deployed 14 August, at `BE-W8`. The September security hardening and the whole `sync_pull`/`sync_push` layer are **not on production**. Nothing is broken today only because nothing points at it. Needs an operator `supabase db push` — `blocked-on-you` **6.1** |
| **`BE-W11`** | **Built and proven by restoring.** `pnpm backup:database` produces a plain-SQL `pg_dump` plus a manifest; `pnpm backup:verify` restores it into a scratch database and **queries the restored copy**. 56/56 migrations, 36/36 tables, 36/36 RLS, 48/48 policies, 5,447/5,447 `auth.users` |
| **...and where it lands** | **Nowhere yet, by design.** The dump is a package of personal data. `.github/workflows/backup.yml` checks for a destination *before producing anything* and is red daily until one exists — `blocked-on-you` **6.3** |
| **PITR** | **Re-opened.** Both premises of the "do not buy it" decision are absent: the Pro plan is unresolved (item 5.2) and the runbook step it was weighed against was the single word *"Restore."* — `blocked-on-you` **6.2** |
| **Tests** | **1,640 passing, zero skipped, zero failing.** Read them from the runners |

**The backup commands, both of which refuse things on purpose:**

```bash
pnpm --filter @fieldforce/api backup:database            # default --out ./backups (gitignored)
pnpm --filter @fieldforce/api backup:database --container # pg_dump INSIDE the db container
pnpm --filter @fieldforce/api backup:verify <artefact>   # restores into a scratch DB, then QUERIES it
```

`backup:database` refuses a non-local target that was not named on the command line, so the
file is never produced because an environment variable was left set. `backup:verify` refuses
to restore over an existing database — a verifier that can overwrite what it verifies is a
delete command with a reassuring name.

**Three traps measured this session, all now in `docs/gotchas.md`:**

1. **`supabase db dump` is not a backup of this database.** Schema: **zero** `auth.` and
   `storage.` tables. Data: **zero** rows of `auth.users`. It is scoped to `public`. Raw
   `pg_dump` is what the scripts use.
2. **`MSYS_NO_PATHCONV=1` must be scoped to the single docker command.** Exporting it
   shell-wide breaks corepack (`Cannot find module 'D:\c\Program Files\nodejs\...'`), which
   turns a check into a crash that exits 1 for the wrong reason.
3. **A synchronous test double can hide an ordering defect completely.** `FE-W45`'s first
   ordering test passed against the defect because React batched the two updates.

**Namespace, again:** the workspaces are `@fieldforce/*`. `pnpm --filter @elmiron/api …`
prints *"No projects matched the filters"* and **exits 0** — the runbook carried the stale
name and the exit code hid it.

| Session | Where the narrative is |
| --- | --- |
| MR-33 — `BE-W11`, there is no restore | `PROJECT-OVERVIEW.md` → `### MR-33 — the restore mechanism` |

---

## After MR-34 — 15 September 2026

**Read `docs/blocked-on-you.md` 6.1 and 7.1 before doing anything with production.**

| | |
| --- | --- |
| **The deploy** | **Rehearsed.** `docs/restore-runbook.md` → *"Applying 37 migrations to a database at 19"*. Five phases, both failure paths executed |
| **And it has a landmine** | `20260908000800_user_profiles_organisation.sql` runs `min(id)` on a uuid column. **PostgreSQL has no `min` for uuid.** If production has any territory-less profile the deploy either crashes (1 organisation) or refuses (more than 1). Only the empty-database path has ever run, and that is the only path CI runs. **7.1** |
| **Sequencing** | **THE DEPLOY MUST HAPPEN BEFORE THE DATA.** `B11` reference data is dated ~22 Sep — seven days out. Data first means it lands on a schema with `BE-W76`'s cross-tenant admin read still open. **6.1** |
| **The graph** | **A museum. Rebuild before trusting it.** Built 11 Aug; 80% of tracked code files absent; `apps/field` is 131-of-131 absent. `docs/graphify-notes.md` |
| **Backup workflow** | No longer a daily red. Three states, weekly, deferral expires **2026-10-15**; re-enable by setting `BACKUP_DESTINATION` |
| **Tests** | **1,640 passing, zero skipped, zero failing.** Read them from the runners |
| **Push** | **BLOCKED.** Nine commits held locally; `git push` was denied by the environment. No CI run exists for MR-33 or MR-34 |

### The pre-flight query — one SELECT, and nobody has run it

It decides whether the deploy is six seconds or a half-applied schema:

```bash
psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || ' organisations=' || (select count(*) from public.organisations);"
```

`territory_less=0` → clean. Anything else → read `blocked-on-you` 7.1 first.

### Three traps measured this session

1. **A partial deploy has the same table count as a complete one.** When the push failed it left
   17 of 37 applied: 36 tables and `rls_forced=36`, *identical to a finished deploy*, with 42
   policies and no `organisation_id`. **Only `check:migration-drift` and the presence of
   `user_profiles.organisation_id` distinguish them.** `db push` is not transactional across
   migrations, and a partial application is not a failed one — nothing rolls back.
2. **A full rollback leaves the drift check reporting NO DRIFT against an empty database.**
   `verify:rollbacks` passes 56/56 and ends with the schema empty — and never touches
   `supabase_migrations.schema_migrations`, so the database claims all 56 applied with zero
   tables. The exact inverse of trap 1, defeating the same check. **Forward recovery only.**
3. **You cannot rehearse this deploy on a bare `create database`.** It fails at migration 1 with
   *"schema `auth` does not exist"*. No migration creates anything in `auth`/`storage` but 38 of
   56 reference them, so the baseline must come from the platform's own init — use
   `supabase db reset` against a copy of the supabase directory with only the 19 in it.

### And one that is not new but keeps earning its place

`check:migration-drift` piped to `tail` reported `exit=0` for a command that exited 1. **`$?`
after a pipe is the last command's status.** Observed live this session.

| Session | Where the narrative is |
| --- | --- |
| MR-34 — the deploy rehearsal | `PROJECT-OVERVIEW.md` → `### MR-34 — the deploy rehearsal` |

---

## After MR-35 — 15 September 2026

**The pre-flight query is now the first thing on `docs/blocked-on-you.md`. It is still the
highest-value action available and still nobody has run it.**

| | |
| --- | --- |
| **Push** | **Unblocked.** MR-34's failure was the local agent harness, not GitHub — `git` never ran, so there was nothing for an org owner to fix. `4e8ba61..abf6ff3` pushed; CI run `34951701710` green on `abf6ff3` |
| **The crashing migration** | **Fixed — and it had a TWIN.** `20260908000800` and `20260908001200` both called `min(id)` on a uuid column. Neither had ever executed anywhere |
| **Editing an applied migration** | Permitted **in this one named case**. The ledger verifies a NAME, not a hash — see `.ai-collab/constraints.md`, "The one time a migration was edited in place" |
| **Drift check** | Now asserts its own preconditions. It **refuses** to report on a database the rollbacks emptied, and names the SHAPE of a shortfall rather than its size |
| **The graph** | **Deleted.** `graphify-out/` is gone; `CLAUDE.md` no longer says "read it first" |
| **Tests** | **1,658 passing, zero skipped, zero failing.** Read them from the runners |

### Before you deploy: one query, and it decides which of three futures you are in

```bash
psql "<direct url>" -At -c "select 'territory_less=' || (select count(*) from public.user_profiles where territory_id is null) || ' organisations=' || (select count(*) from public.organisations) || ' consent_notices=' || (select count(*) from public.consent_text_versions);"
```

All three zero → both backfills no-op and the deploy is seconds. Anything non-zero → the
backfills **execute**; they are fixed now, but they have still never run anywhere outside a
test. `docs/restore-runbook.md` → Phase 0.

### The `api` suite is flaky about two runs in seven, and it is NOT your change

`tenant-boundary-restrictive.spec.ts` fails with `deadlock detected` inside `mirrorTable` on
roughly **2 of 7** full-suite runs. **Pre-existing**, measured this session, `BE-W92`'s problem.

- **A single red `api` run is not a regression.** Re-run, and check whether it is that test and
  that error.
- **A single green run does not clear a change either.** This is the direction that bites: if
  you are testing whether something you wrote causes flakiness, you need a *rate* on both sides.
  This session nearly shipped a false diagnosis on three clean runs.
- CI runs the suite once per push, so about a **one-in-four** chance of a spurious red.

### Two traps measured this session

1. **`delete from public.user_profiles` is illegal on this schema once fixtures exist.**
   `app_thresholds.set_by_user_id` is `ON DELETE SET NULL` and `app_thresholds` is append-only,
   so the delete raises *"append-only: UPDATE is not permitted by any role"*. A test that clears
   tables passes alone and fails in the full run. If a test needs whole-table control, give it
   its own scratch **database** — the `verify-backup.mjs` pattern.
2. **A `supabase db reset` can fail and leave a half-built stack.** It reported
   `LegacyDbSetupError: error running container: exit 1`, and `auth.users` then had no
   `email_confirmed_at` because the auth container had not re-applied its own schema. **Assert
   the starting state before measuring anything against it.**

| Session | Where the narrative is |
| --- | --- |
| MR-35 — the crashing migration | `PROJECT-OVERVIEW.md` → `### MR-35 — the crashing migration` |

---

## After MR-36 — 15 September 2026

**CI's signal is back, but not perfect.** The `api` suite's spurious-red rate is down from
**~2 in 7 to ~1 in 21**. Plan for about one push in twenty, not one in four.

| | |
| --- | --- |
| **`BE-W92`** | **Named on both sides at last:** a test's DDL versus GoTrue minting an identity, contending on `auth.users` / `auth.identities`. Mitigated by making DDL tests take the identity advisory lock. **Not cured** — ~5% remains and the residual mechanism is unknown |
| **`FE-W45`** | **Was still half open.** The zone's discriminant existed all along and **no screen read it**. One banner at the root now says when dates are UTC-because-unknown |
| **`FE-W46`** | Worse than recorded: the fabricated `sizeBytes: 1` is persisted and summed, so the per-MR storage ceiling is inert |
| **The bundle** | **Moot.** `origin/main` has everything; a bundle on the same disk was never the control it was described as |
| **Tests** | **1,664 passing, zero skipped, zero failing** |

### If the `api` suite goes red, do this before investigating

```bash
docker logs --since 60m supabase_db_Elmiron-App 2>&1 | grep -A4 "deadlock detected"
```

One red run is not a regression at a ~5% rate. Re-run, and check whether the failure is
`deadlock detected`. **And check the log even when the suite is green** — a deadlock that loses
the race to a rollback never reaches vitest. Fourteen green runs hid one.

### Writing a test that issues DDL

**Use `inDdlTransaction` from `tests/auth.ts`, not `inRolledBackTransaction`.** It holds the
identity advisory lock on its own connection, so a schema change and a GoTrue mint are never in
flight together. Use it **only** where a test really changes the schema — every use serialises
against every fixture mint in the suite.

DDL is not just `create table` / `create policy`: **`create trigger`, `drop trigger`,
`create function`, `create sequence` and `alter table` all count.** The first sweep this session
missed three of those and looked like a cure for 14 runs.

### Three traps recorded in `docs/gotchas.md`

1. **The absence of an event is evidence only against a known rate.** Three clean runs is not a
   baseline. Against a 2-in-7 rate, zero in three has probability 0.36.
2. **Before enumerating why an action failed, establish it was attempted.** A push was reported
   as denied by "the environment" and three remote causes were offered; `git` never ran.
3. **`render()` must be awaited in `apps/field`'s jest suites.** A bare `render(...)` leaves
   `screen` unpopulated, and both symptoms point at the component instead of the missing `await`.

### For the operator

`docs/blocked-on-you.md` opens with the one `SELECT` that decides whether §6.1 is a scheduling
item or an incident. `docs/COMPLETION-PLAN.md` now ends with **engineering versus waiting, side
by side with estimates** — the cheapest engineering item left is one half-day; the most expensive
item on the page is the fiduciary name, which costs nothing and compounds daily.

| Session | Where the narrative is |
| --- | --- |
| MR-36 — restoring the signal | `PROJECT-OVERVIEW.md` → `### MR-36 — restoring the signal` |

---

## After MR-37 — 16 September 2026

**Read the top of `docs/blocked-on-you.md` first. There are now TWO dated deadlines and the
nearer one gives no warning.**

| | |
| --- | --- |
| **30 September** | `CONTRACT_I3_DEADLINE` — **14 days**, and the test has **no warning state**. Green until 2026-09-30T18:29:59Z, red after. Verified: no `TranscriptV1Schema` exists anywhere and the date has never been moved |
| **`FE-W46`** | **Closed, server-side.** `complete_upload` now stores the size Storage OBSERVED. No client change was needed |
| **`FE-W48`** | **New.** Client and server disagree about what an absent capture source means (`manual` vs `automatic`). Unreachable today |
| **`seed:mr`** | **Now refuses a non-localhost target**, like its two siblings always have |
| **Schema** | **57 migrations** — one added this session |
| **Tests** | **1,677 passing, zero skipped, zero failing** |

### The rule that earned its place this session

**Before asking for a dependency, ask whether the server already knows the fact.**

`FE-W46` was registered as blocked on `BE-W7` for three sessions, on the reasoning that the real
byte count needed `expo-file-system`. It did not. The bytes reach Storage before finalisation and
Storage records what arrived in `storage.objects.metadata ->> 'size'` — 118 of 118 objects carry
it. The fix is one migration, no client change, and it makes the number unforgeable as a
side-effect.

### If you are writing a test that has to fail against a mutant

**The ceiling test in `upload.spec.ts` passed against its own mutant twice.** Both causes are
worth knowing because they are properties of this suite, not of that test:

1. **Other tests in the same file COMMIT rows for the same fixture MR.** A fixed threshold was
   already breached before the test stored anything, so it threw the right message for the wrong
   reason. Derive thresholds from a measured baseline.
2. **`reservedBytes` counts too** — neighbouring tests leave open grants committed. A baseline
   that reads only `liveBytes` is not a baseline.

### Four rule-sweeps were run across the repo, and their counts are in `docs/gotchas.md`

Two found nothing real. **That is recorded with denominators on purpose**, so nobody spends a
morning rediscovering it:

- discriminants with zero readers — **0 genuine** of 8 unions + 17 aliases;
- sentinels — 20 candidates, **1 registered, 0 live**;
- guards without preconditions — **1, fixed** (`seed-one-mr`);
- controls that never fired — **the method is unsound**, 302 sites, and 210 SQLSTATE assertions
  are invisible to a message match. One genuine gap found by spot-check and fixed.

**An `===` grep does not see keyed dispatch**, and a sweep for controls that never fired cannot
see a control that was never written — Part B added one that did not exist, and five tests had
been relying on its absence.

### Engineering, sequenced — and three items are no longer blocked

`BE-W13`, `BE-W14`, `BE-W15` and `BE-W47` are all **closed**, which MR-36's table did not know.

```
FE-W10 (1 half-day, nothing blocks it)  ->  FE-W12 (2)  ->  FE-W13 (3)  ->  BE-W89 (unsized)
```

`FE-W10` first: one file, and the only item on the page that makes the product lie.
`docs/COMPLETION-PLAN.md` also now carries **what gets cut if the AI layer is cut** — including
that it would resolve the 30 September deadline, and that it puts the entire audio path in
question.

| Session | Where the narrative is |
| --- | --- |
| MR-37 — the deadline and the ceiling | `PROJECT-OVERVIEW.md` → `### MR-37 — the deadline and the ceiling` |

---

## After MR-38 — 16 September 2026

**The 30 September deadline now warns, and it is warning today.** `pnpm --filter
@fieldforce/core test` prints a `::warning::` annotation with the days remaining. It stops
warning and starts failing at `2026-09-30T18:29:59Z`.

| | |
| --- | --- |
| **The bigger question** | **Top of `docs/blocked-on-you.md`, above the deadline:** does the MR app record audio at all if there is no AI layer? Verified: **nothing in MR v1 consumes a recording** — no playback anywhere, by design, documented in the code itself |
| **The sweep** | **No fourth instance.** 47 RPCs, 121 client parameters, 24 pure numbers — none feeds a decision the server could have derived |
| **`FE-W10`** | **DONE.** The console no longer claims two screens it ships are forbidden |
| **`FE-W12`, `FE-W13`** | **Blocked**, and MR-37 was wrong to call them unblocked — see below |
| **`BE-W94`** | New. `complete_upload.p_recorded_at` is the device's word with no bounds |
| **Tests** | **1,688 passing, zero skipped, zero failing** |

### MR-37's "newly unblocked" was wrong about two of three, and the check is why

**`BE-W14` and `BE-W15` are NOT closed**, so `FE-W13` is still blocked. `BE-W14`'s recorded check
is two clauses and only the first was run:

```
grep -c "auditLog" packages/core/src/field/endpoints.ts -> >=1     <- passed, for the wrong reason
an RLS test proves a non-admin gets permission denied              <- nothing behind it
```

The grep's two matches are a prose comment and the `auditLogId` field on the *overrides*
response. Measured directly: the only `public` functions matching `%audit%` or `%retention%` are
**`write_audit_row` and `stamp_audio_retention` — both writers.** No read path, no schema, no
mock route.

**If a check's command could pass on a file that merely says the words, it is not a check.**

### Before you start `FE-W12`

Two things are missing and neither is a workaround away:

1. **There is no client method for `GET /analyses/:id/overrides`.**
   `ListAnalysisOverridesResponseSchema` exists in `packages/core` and is **consumed by
   nothing**. The RPC and the mock route both exist, so `BE-W13` is closed by its own check —
   the gap is between the two items and neither owns it.
2. **Its recorded check needs a renderer the console does not have.** `apps/console` pages are
   React Server Components; `vitest.config.ts` says exercising them needs a browser or a Next
   harness and neither exists. Adding one is a **dependency ask**.

### Two flakes now have denominators

- **`BE-W92`** — the api-suite deadlock, ~1 in 21 after MR-36's mitigation.
- **NEW: `packages/ui` jest suites can fail to LOAD under `pnpm -r test`** — `Cannot find module
  './pure'` from inside `@testing-library/react-native`'s own `dist`. **1 in 7 observed.**

**Recognise it by the totals, not the failures:** `Test Suites: 2 failed` with
`Tests: 237 passed, 237 total` and **zero failures** — a suite that never ran reports no
failures and a smaller total. Re-run the workspace alone; it passes 243/243. **Do not reinstall
on one occurrence.**

### Still open and needing a decision, not work

**`FE-W11`.** `FE-W10` unblocks it, but its recorded check requires editing
`docs/frontend-status.md` in place (`grep "E1/E2 held by"` → no match), while the standing
instruction is that the file takes appends only. The same false claim is live at lines 34, 43
and 44. **That conflict needs resolving before somebody resolves it silently.**

| Session | Where the narrative is |
| --- | --- |
| MR-38 — the fourth instance | `PROJECT-OVERVIEW.md` → `### MR-38 — the fourth instance` |
