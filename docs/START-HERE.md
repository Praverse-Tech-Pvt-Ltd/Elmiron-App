# Start here

**For a developer who has never seen this project.** Read this page first; it links to everything
else. It was written on 8 October 2026 (W2-K) by cloning the repository into an empty directory and
bringing it up from nothing, following only what is written down. Where a step below says
**[ran]**, it was run that way on that day and the result is recorded. **[not run]** means it was
not, and the step is only as good as the document it cites.

Numbers that change — test counts, migration counts, what is blocked — are deliberately **not** copied
onto this page. Each is given as the command or the file that tells you today's value.

---

## 1. Get it running, from nothing

**Platform: native Windows 11, PowerShell or Git Bash.** That is how this project is developed and how
everything below was run. `docs/backend-setup.md` recommends WSL2; it was written before any code
existed (6 August), and several of its commands no longer apply — see "Traps".

### Install, in this order

| # | Tool | Version | How you know | |
| --- | --- | --- | --- | --- |
| 1 | Git | any recent; long paths ON (`git config --global core.longpaths true`) and the Windows `LongPathsEnabled` registry value set, then reboot — `docs/gotchas.md`, "Long paths" | `git config --global core.longpaths` prints `true` | **[not run]** — already set on the machine used |
| 2 | Node | **24.x** — `package.json` `engines` is `>=24 <25`; `.nvmrc` says `24` | `node -v` | [ran] 24.18.0 |
| 3 | pnpm | **exactly the version in `package.json` `packageManager`**, through corepack: `corepack enable` (if it fails with `EPERM`: `corepack enable --install-directory "$env:APPDATA\npm"`, `docs/gotchas.md`) | `pnpm -v` in the repository | [ran] 11.21.0 |
| 4 | Docker Desktop | recent; running | `docker ps` answers | [ran] 29.5.3 |
| 5 | *Only to build the Android app:* JDK 17, Android SDK (build-tools, NDK), and a CMake **3.31 or newer with its own ninja** (Visual Studio's bundled CMake works; the SDK's 3.22.1 does not) | the demo build script's `-CheckOnly` names what is missing | [ran] JDK 17.0.12, NDK 27.1, VS 18's CMake 4.3.1 |

The Supabase CLI is **not** installed separately: it is a dependency and runs as
`npx supabase --workdir services/api …` [ran, 2.113.0].

### Then, in the repository

| # | Run | What it does | What proves it worked | Time measured [ran] |
| --- | --- | --- | --- | --- |
| 1 | `git clone https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git` into a **short** path (e.g. `C:\dev\ea`) | | | 2 s |
| 2 | `pnpm install` | | ends `Done … using pnpm v<the pinned version>` | **1 min** with an empty package store |
| 3 | **`pnpm hooks:install`** | turns on the commit and push checks **for this clone** | `git config core.hooksPath` prints `.githooks` | seconds |
| 4 | `pnpm ci:local` | CI's static job, exactly: builds the shared packages, typecheck, lint, format, the repository checks, every unit-test suite | the last line: `All N step(s) passed` | **6 min** |
| 5 | `pnpm db:start` | the local Supabase stack in Docker; applies every migration from empty | **ten** containers in `docker ps`; the last migration line, then `log_lock_waits=on` | **1 min** with the Docker images already present — **not measured** for a first image download, which is several GB |
| 6 | `pnpm ci:local --with-db` | CI's static AND database jobs: the database suites, the Edge Function, the console in a real browser, every rollback | `All N step(s) passed`; read the two test-runner lines (`Test Files …`, `Tests …`) — a skipped suite also exits 0 | **4 min** after step 4 (its static half was cached) |
| 7 | the console: copy `apps/console/.env.example` to `apps/console/.env.local`, then `pnpm --filter @fieldforce/console dev` | the admin web app on port 3100 | `http://localhost:3100/sign-in` shows "Sign in" | 15 s |
| 8 | the app, as a demo APK: see "The app" below | builds a debug-signed APK against the stack on this laptop | the script prints `DEMO APK READY` with a path, and the file is there | **18 min** (1,068 s) |

**Measured on 8 October [ran]: about 15 minutes from a clone to a green full run** (2 s + 1 min + 6 min
+ 1 min + 4 min + 15 s), **and 18 more for the demo APK.** **These are lower bounds:** this machine
already had every tool, the Docker images and Gradle's caches, so a truly fresh machine is longer — by
an estimate, not a measurement, about an hour more for installing the tools and downloading several GB
of images.

**Step 6 stops the stack when it finishes.** Run `pnpm db:start` again before anything that needs it.

### Accounts to sign in with

The stack starts empty. `pnpm --filter @fieldforce/api run seed:day -- --another` makes a company with a
rep and a day of visits and **prints the accounts to use** [not run in W2-K; used daily in earlier
sessions]. `node services/api/scripts/seed-practice-world.mjs` makes a throwaway company with two admins
and a rep, and prints them as JSON [ran in W2-I].

### The AI gateway, locally

`pnpm --filter @fieldforce/core build`, then `pnpm functions:serve` from the repository root. **The build
comes first:** the function imports `packages/core/dist`, which a fresh clone does not have
(`services/api/supabase/functions/_shared/core.ts`). With no model access it answers from a labelled
**practice stub**, which refuses to run on anything but a local address. Day one with a real model:
`docs/ai-platform/DAY-ONE.md`.

### The app

`apps/field` is an Expo app. A **demo APK** — debug-signed, labelled "(demo)", talking to the stack on
your laptop over the Wi-Fi — is built by `apps/field/scripts/build-demo-apk.ps1`:

```powershell
# the phone and the laptop on the same Wi-Fi; the address from ipconfig; the stack running (step 5)
$env:EXPO_PUBLIC_APP_JWT_AUDIENCE = 'authenticated'
$env:EXPO_PUBLIC_APP_SITE_URL = 'http://127.0.0.1:3000'
$env:EXPO_PUBLIC_APP_DEEP_LINK_SCHEME = 'com.praversetech.fieldforce'
$env:EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS = 'com.praversetech.fieldforce://auth-callback'
powershell -ExecutionPolicy Bypass -File apps\field\scripts\build-demo-apk.ps1 -Ip <laptop address> -CheckOnly
powershell -ExecutionPolicy Bypass -File apps\field\scripts\build-demo-apk.ps1 -Ip <laptop address>
```

**[ran]** On the fresh clone, `-CheckOnly` **without** the four lines is refused (three values missing);
with them, every check passes. The build then ran from the fresh clone and **produced an APK**: the script
printed `DEMO APK READY` and the file is at `C:\dev\demo-apk\` (97.5 MB), named with the laptop's
address, the date and the commit; it took 1,068 s, about 18 minutes, with Gradle's caches already on
this machine. It is debug-signed, as a demo APK is meant to be, so
`apps/field/scripts/verify-release-apk.mjs` refuses it. Installing it on a phone was **[not run]**:
there is no handset. The four values are not secrets; they are also in the
root `.env.example`, but the script reads the shell, not that file.

A **production** APK cannot be built yet — it needs a release key the operator holds; a release build
without one is refused by design (`apps/field/plugins/release-signing.cjs`). `docs/HANDOVER.md`, "The
release key".

### Traps that each cost a day

1. **The hooks are per clone.** A fresh clone runs no checks on commit or push until
   `pnpm hooks:install`. On this project's own machine, `core.hooksPath` once pointed at ANOTHER
   checkout's stale hooks, so every commit ran an out-of-date check (W2-I B2). The value must be the
   relative `.githooks`.
2. **The push hook resets your local database** and runs the whole database job (minutes). It needs the
   stack up (`pnpm db:start`) and refuses the push if it is not.
3. **Build `packages/core` before serving the gateway** (above). The failure is a module-not-found at
   serve time.
4. **The credential file is edited in an editor, never appended with `echo >>`.**
   `services/api/supabase/functions/.env` (git-ignored) holds the AWS values for Bedrock; it has no final
   newline, so `echo` glues a new setting onto the last one and breaks both, silently
   (`docs/ai-platform/DAY-ONE.md`, step 2). Never paste its contents anywhere.
5. **Test runner workers are capped on purpose.** Jest runs with `maxWorkers: 3`
   (`apps/field/jest.config.cjs`, `packages/ui/jest.config.cjs`): the default on a big machine timed out
   nine suites' first tests. The database suites run one file at a time (`fileParallelism: false`,
   `services/api/vitest.config.ts`) because they share one database and deadlocked. Do not "speed them
   up".
6. **`docs/backend-setup.md` is out of date.** Do not run its `pnpm add -D supabase` or
   `pnpm supabase init` (the CLI is already a dependency; `init` would collide with
   `services/api/supabase`), nor `pnpm supabase start` from the root (the stack lives at
   `--workdir services/api`), nor `pnpm@latest` (the version is pinned).
7. **The demo build needs four values in the shell** (above); the only document that said so was dated
   (`docs/demo-path-2026-10-01.md`).
8. **A skipped suite exits 0.** `pnpm ai:live` without model access prints `SKIPPING` and passes. Read
   the runner lines, not the exit code (`docs/gotchas.md`, "A skipped suite and a passing suite look
   similar").
9. More, each with what fixed it: **`docs/gotchas.md`** — read its headings once.

---

## 2. What this is, and how it is put together

**The product.** A field-force app for pharmaceutical medical representatives in India. **Reps** plan
and work their day on an Android phone — the route, checking in and out of clinics (geofenced, offline
first), call reports, samples within the legal cap, day end and mileage, doctor consent — and learn and
practise: courses, product questions answered only from approved material, an assistant, and a practice
doctor with feedback. **Managers** review coaching. **Admins** run the company's content and controls in
a web console: approved material, AI instruction sets, practice doctors, course assignment, consent
versions. Commercial data only: **no patient data, ever** — the patient app is a separate project with a
separate database (`.ai-collab/architecture.md`).

**The four parts.**

| Part | Where | Responsible for |
| --- | --- | --- |
| The phone app | `apps/field` (Expo, React Native) | everything a rep does; an offline queue that syncs when there is signal |
| The console | `apps/console` (Next.js) | admin and manager screens; every write is an RPC as the signed-in user |
| The database and its rules | `services/api/supabase/migrations` (Supabase: Postgres, Auth, PostgREST, Storage) | **all** authorisation and validity: row-level security, `SECURITY DEFINER` functions, triggers, append-only tables |
| The AI gateway | `services/api/supabase/functions/ai-gateway` (a Supabase Edge Function, Deno) | the only path to a model: refuses before any model is called, logs every request, answers only from approved material |

Shared by all of them: **`packages/core`** — the contract: types, Zod schemas, the API client, and the
gateway's flows. `packages/ui` and `packages/ui-tokens` are the design system. `services/mock` is a mock
server the app was built against before the backend existed.

**The decisions you would otherwise undo by accident.**

* **No application server.** PostgREST exposes the schema; rules live in Postgres. The reason, from the backend plan as
  quoted in `.ai-collab/architecture.md`: *a commercial user must never reach clinical data through any
  code path* — so the rule sits where every path passes. **A guard that is not a policy, a trigger or a revoked grant is not a guard**
  (`.ai-collab/architecture.md`, "Where the logic actually lives").
* **Authorisation is in the database, not in code.** RLS is enabled and forced on every table; the most
  sensitive tables have **no policy at all** and are reached only through `SECURITY DEFINER` functions
  that check the caller. `postgres` and `service_role` bypass RLS, so anything that must hold against
  every role is a statement-level trigger plus revoked privileges.
* **The contract package is imported, never copied.** The gateway re-exports the built
  `packages/core/dist` through one file, `services/api/supabase/functions/_shared/core.ts`, so there is exactly one copy of each flow and
  it is the tested one. CI checks that the function runs the same dependency versions as the tests.
* **The service-role key is read in exactly one place** — `services/api/supabase/functions/_shared/practice-writer.ts`, which exposes
  three named database calls and nothing else. `services/api/scripts/check-service-role-reads.mjs` fails
  the build otherwise, and also forbids naming the other platform credentials in function code.

---

## 3. The rules this project works by

Each was learned by breaking it. The cost is the reason to keep it.

| Rule | What it cost when it was broken |
| --- | --- |
| **A control scoped to where a defect was last seen misses the next one.** Guard the class, not the instance. | The service-role check covered one key name; the platform hands every function **three** equivalent credentials, and rules 1–5 guarded one door (`services/api/scripts/check-service-role-reads.mjs`, rule 6, W2-B E). |
| **Tests fed the author's chosen inputs miss what ships.** Test the configuration every build ships. | Consent was invisible on screen: the tests ran recording `blocked`, the setting the author changed, never `off`, the one every build ships (`docs/log/backend.md:4226`). The learning screens read once on mount; nine tests and a browser test passed; a device found it (W2-G). |
| **A check that passes for an unrelated reason is not evidence.** Make it fail for the right reason first (a positive control). | Three tenant-boundary tests passed because the fixture never enrolled the learner — three 403s that "proved" a boundary (`docs/log/backend.md:1575`). |
| **A green run bought with a retry is not a fix.** Measure the rate before and after. | A retry on deadlocks made one suite pass and moved the deadlock to two others: 2 failures in 6 runs before, 3 in 8 after. Removed (`docs/log/backend.md:669`). |
| **A decision with no work item does not happen.** | Of 63 decisions needing something built, 8 had no work item and none was built; an off-site check-in warning was ruled and never made (`docs/log/backend.md:4182`, `:4225`). |
| **Ids and register rows are append-only.** Mint an id in `docs/ids.md` in the commit that first cites it; never edit a row. | Unregistered ids failed CI on four merges in two days (W1-Y D3, `.githooks/pre-commit`); an edited row reached a commit in W2-H because the hook was stale. |
| **Check against a clean database before pushing.** | A commit green locally was red in CI for three separate defects, all hidden by local database state (`.githooks/pre-push`). |
| **Evidence, not recollection; grep before filing a gap; read a red before rerunning it; never pipe a check's output.** | W2-H filed "the hook does not run the id check" without reading the hook; it did (W2-I B2). |

The full list of hard boundaries — security, data, process: **`.ai-collab/constraints.md`**.

**What runs automatically, and what it refuses.**

| When | What | Refuses |
| --- | --- | --- |
| `git commit` (after `pnpm hooks:install`) | `.githooks/pre-commit`: the id ledger, typecheck, lint, format | an unregistered or reused id, an edited register row, any type, lint or format error |
| `git push` | `.githooks/pre-push`: resets the local database and runs CI's static and database jobs (`scripts/verify-clean-db.mjs`) | anything CI would refuse; a push with the stack down |
| every PR and push to `main` | `.github/workflows/ci.yml` — **static**: append-only `PROJECT-OVERVIEW.md`, the id ledger, frozen lockfile, build, typecheck, lint, format, a rollback for every migration, the gateway's dependency versions, the single service-role read, the status table, every unit suite; **database**: every migration from empty, lock logging, the gateway served, the database suites, the console in a real browser (and proof it ran), no decision past its deadline, every migration rolled back | any of those |
| schedules | `retention.yml` (deletes expired audio), `retention-watchdog.yml` (hourly: is anything deleting it), `backup.yml` (weekly), `migration-drift.yml` (daily: production matches `main`), `pr-mergeable.yml` (daily: no open PR silently conflicting) | each fails loudly rather than skipping |

`pnpm ci:local` runs CI's own steps on your machine, reading them from `ci.yml`, so it cannot drift from
CI. `pnpm verify:commit` is the commit hook's subset.

---

## 4. Which documents to trust

**Read these first — the load-bearing five:**

1. **This page.**
2. **`docs/HANDOVER.md`** — what to do when each thing the project is waiting for arrives.
3. **`.ai-collab/constraints.md`** — the hard boundaries.
4. **`docs/gotchas.md`** — machine, tool and database failures, each with its fix.
5. **The last section of `docs/log/backend.md`**, and its status table — where the work is today.

The code, the migrations and `docs/ids.md` outrank every document. `CLAUDE.md` is the instruction file a
coding assistant loads; it is short and also for you.

**Append-only records — true of the day they were written, not of today:** `docs/log/backend.md`,
`docs/log/frontend.md`, `PROJECT-OVERVIEW.md` (its "Phase log"; its "Current state" section was last
rewritten in week 7 and is out of date), `docs/contract-requests.md`, `docs/ids.md` (a ledger: always
current as a list of ids, but a row's text is true of the day it was minted), `.ai-collab/decisions.md`,
`.ai-collab/decisions-backend.md`, `docs/gotchas.md` (cumulative, but each entry stays true).

**Everything else, by kind.**

| Document | Status | For | Answers |
| --- | --- | --- | --- |
| `docs/HANDOVER.md` | current | anyone acting on an arrival | what to do first when a blocker clears |
| `docs/ai-platform/DAY-ONE.md` | current | engineering | the hour model access lands; the predicted failures |
| `docs/DEPLOY-RUNBOOK.md` | current; stopped at step 0.1 on 5 October | the operator, then engineering | how to deploy to production |
| `docs/restore-runbook.md` | current | engineering | restoring the database, and why it is a compliance event |
| `docs/DEMO-SCRIPT.md` | current (rehearsed 2 October) | a presenter | how to show the app |
| `docs/operator-inputs.md` | current | the operator | every input the project is waiting for (Q-1…Q-21) |
| `docs/operator/*-template.md` | current | content owners | the file formats the loaders read |
| `docs/operator/2026-10-02-operator-direction.md` | current | everyone | the operator's priorities, verbatim; the status table is checked against it |
| `docs/ids.md` | current (append-only) | everyone | what an id like `BE-W168` means |
| `docs/gotchas.md` | current (cumulative) | engineering | why a tool or the database misbehaves |
| `.ai-collab/constraints.md` | current | engineering | what you must not do |
| `.ai-collab/architecture.md` | current | engineering | the system map in thirty seconds, and the access model |
| `docs/mr-app-plan.md` | historical (6 August), §0 still holds | engineering | the five findings that shaped the product |
| `docs/mr-work-split.md`, `docs/mr-app-architecture.html` | historical | engineering | the original contracts and diagram |
| `docs/ai-platform/AI-SPEC.md`, `LIVE-TRACKING-DESIGN.md`, `GEMINI-RESIDENCY.md`, `PROVIDER-SHORTLIST.md`, `api-contracts.md` | current reference for their subject | engineering | how the AI platform, live tracking and provider choice were specified |
| `docs/ai-platform/KEY-DAY-CHECKLIST.md` | superseded by `DAY-ONE.md` (it says so) | — | how DAY-ONE's predictions were derived |
| `docs/ai-platform/INVENTORY.md`, `phase-a-recon.md`, `W1-A-recon.md`, `decisions-pending.html` | historical snapshots (late September) | — | what existed on that day |
| `docs/4-OCTOBER.md`, `docs/AFTER-4-OCTOBER.md` | **retired** (7 October) | — | — |
| `docs/COMPLETION-PLAN.md` | historical (7 September plan) | — | the plan at that date |
| `docs/blocked-on-you.md` | historical; its first item is marked resolved | — | operator asks as of mid-September; `operator-inputs.md` replaced it |
| `docs/backend-setup.md` | **stale** (6 August) — see Trap 6 | — | — |
| `docs/push-readiness.md`, `docs/frontend-status.md`, `docs/HANDOVER-2026-09-08.md`, `docs/frontend-handoff-2026-09-07.md`, `docs/screen-inventory-2026-09-28.md`, `docs/frontend-facts-2026-10-01.md`, `docs/frontend-gap-map-2026-10-01.md`, `docs/polish-audit-2026-09-29.md`, `docs/final-visual-pass-2026-09-30.md`, `docs/demo-path-2026-10-01.md`, `docs/direction-2026-09-28.md` | historical snapshots, dated in their names or first lines | — | what was true on that day |
| `docs/backend-brief.md`, `docs/backend-prompt*.md`, `docs/frontend-prompt*.md`, `docs/frontendpromptw1.md`, `docs/frontend-plan-v2.md`, `docs/fe-w3-spec.md`, `docs/escalations-week*.md`, `docs/amendment-gate0-criterion.md`, `docs/backend-request-scope-rename.md`, `docs/spend-approval.*`, `docs/brand-identifier-decision.md`, `docs/machine-inventory.md`, `docs/adr-sync-pull.md`, `docs/decisions/*` | historical: the briefs and decisions of their week | — | why something was built the way it was |
| `handoff.md`, `handoff-frontend.md`, `.ai-collab/handover.md`, `.ai-collab/README.md`, `flow.md`, `rollback.md`, `test-checklist.md`, `bug-log.md` | working notes, last changed in September | — | they say themselves that `PROJECT-OVERVIEW.md` and `gotchas.md` win |
| `docs/graphify-notes.md` | current | anyone tempted to build a code graph | why the last one was deleted |

---

## 5. Where the work is

**Today's state lives in one place: the last status table in `docs/log/backend.md`** (the last `####`
heading containing "status"). CI checks it covers all fourteen of the operator's items
(`docs/operator/must-haves.json`). As of W2-I (8 October): the core rep workflow, the real backend, day
end, mileage, the course and approved-material pipeline and the AI wiring are **done**; everything else
is **blocked on a person** — model access (the AWS account owner), a second admin, content, a handset,
the backup decision Q-19 and a release key (the operator), and a handful of decisions. **No engineering
work is on any critical path.**

**What to do first.**

* **Nothing has arrived:** check that it has not — model access with `pnpm ai:live` (it says `SKIPPING`
  when not granted), and `docs/operator-inputs.md` for answers — and do not invent work. If you must
  learn the code, walk `docs/DEMO-SCRIPT.md` on the emulator.
* **One blocker cleared:** follow its section of **`docs/HANDOVER.md`**. Correct the page from what you
  find.
* **Several:** take them in the order of `docs/HANDOVER.md`'s dependency map — **model access and the
  second admin first**; they unblock the most.

**Where the ice is thin.**

* **No real model has ever answered.** The five AI features have run only against the practice stub; the
  live suites are skipped. `docs/ai-platform/DAY-ONE.md` lists the failures predicted for the first run.
* **No real handset has run the app.** Everything on a phone was an emulator. The offline day has never
  met a real radio. Every past contact with a device found defects the tests missed (W2-B: six untrue
  screens; W2-G: the learning screens).
* **Production has never been deployed** (stopped at the backup step, Q-19), the backup job has never
  stored a backup (`BE-W143`), and the runbook's gateway deploy step has never been rehearsed.
* **A production APK has never been built or signed.** Its signature check has been shown only on a demo
  APK and on text.
* **Where the tests are thin:** the app's route tests replace the transports (W2-G had to add separate
  transport tests); the browser suite is small; the database suites are serialised to stay reliable, so
  concurrency between them is not exercised.

---

## 6. What this page does not cover

* **Clinical and regulatory judgement** — what material may say, pharmacovigilance, the PV/DPDP
  signatory: the operator.
* **Production access and credentials** — Supabase, AWS, the release key: the operator and the AWS
  account owner. None of them belong in the repository, a log or a chat.
* **The patient app** — a separate project.
* **iOS** — out of scope; the app is Android only (`apps/field/app.json`).
* **Design** — the design system lives in `packages/ui` and `docs/design/`.

**Who to ask:** the operator for decisions and inputs (`docs/operator-inputs.md` lists each open one);
Maanav for engineering.
