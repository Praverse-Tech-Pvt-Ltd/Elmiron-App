# Gotchas

Machine, tooling and environment failures hit on this project, with what actually
resolved them. Everything here cost real time and none of it is discoverable from
the error message.

This file is **cumulative and durable** — append to it, do not rewrite it. It is
deliberately not a handoff document: a point-in-time snapshot in git is worse than
none, because the next person trusts it.

Current state of the work lives in `PROJECT-OVERVIEW.md`.

---

## Git and GitHub

### `git push` rejected for the workflow file, with a token that has `workflow` scope

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token to
  create or update workflow `.github/workflows/ci.yml` without `workflow` scope)
```

**The account was never the problem.** `gh`, the git identity and the cached
credential all resolved to the same user. The cause was that the token stored in
**Windows Credential Manager** predated the workflow-scope grant, and
`credential.helper=manager` meant git used that stale token and never consulted
`gh` — whose token *did* have the scope.

**Fix:** `gh auth setup-git`. That registers `gh` as the credential helper for
`github.com` specifically, taking precedence over the manager.

**Not** worked around by deleting the workflow file. CI that fails the build is a
BE-W1 deliverable, and dropping it to make a push succeed trades a real control for
a green terminal.

Symptom to recognise next time: a scope error naming a scope you know the token
has. Check what git is actually sending, not what `gh auth status` reports.

### `git commit -m` with a PowerShell here-string containing double quotes

The shell word-split the message and produced a wall of `pathspec did not match`
errors — which points at the file arguments, not at the message, so it reads as a
completely different problem.

**Fix:** use `git commit -F <file>` for any multi-line message on this machine.

---

## Node and pnpm on Windows

### `corepack enable` fails with `EPERM` on `C:\Program Files\nodejs`

It wants to write shims next to the Node binary, which needs administrator rights.

**Fix, no admin required:**

```powershell
corepack enable --install-directory "$env:APPDATA\npm"
```

### Long paths

A five-package pnpm workspace exceeds the legacy 260-character limit. **Both** of
these are needed — one without the other still fails:

```powershell
# Registry, then reboot
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' LongPathsEnabled 1
```

```bash
git config --system core.longpaths true
git config --global core.longpaths true
```

---

## Supabase CLI

### `env(VAR)` in `config.toml` does not fail when the variable is missing — it passes the literal string through

Moving `site_url` to `env(APP_SITE_URL)` looked like it worked: the stack started,
no error, no warning. Checking the container showed GoTrue had received the literal
string `env(APP_SITE_URL)` as its site URL.

The CLI resolves `.env` **relative to `--workdir`**, and there is no `--env-file`
flag. With the repo's `.env` at the root and `--workdir services/api`, nothing
resolves.

**Consequence:** a silently broken auth redirect that no error message points at.
Reverted to literal values in `config.toml` with the reasoning inline. The
application-level values live in `packages/core/src/shared/config.ts`, which
validates them and fails loudly on absence.

If you use `env()` in that file, **verify it resolved** by checking the running
container:

```bash
docker exec supabase_auth_<project> printenv GOTRUE_SITE_URL
```

### Analytics crash-loops on Windows

The CLI points the `vector` log shipper at `DOCKER_HOST=tcp://host.docker.internal:2375`,
which Docker Desktop does not expose. It restarts forever.

**Fix:** analytics is disabled in `services/api/supabase/config.toml`. The
alternative — exposing the Docker daemon on TCP 2375 — was rejected: that endpoint
is unauthenticated and daemon access is root-equivalent on the host.

**Consequence:** Studio's Logs pane is empty. Use
`docker logs -f supabase_<service>_<project>` instead.

### `pg_cron` and `pg_net` are both available; the edge runtime is not

Measured on the local stack rather than assumed, because the scheduling decision
turned on it:

```
 name    | default_version | installed_version
 pg_cron | 1.6.4           |                     -- in shared_preload_libraries, CREATE EXTENSION works
 pg_net  | 0.20.4          | 0.20.4              -- already installed
```

So a database-side schedule is genuinely possible. Two things that are not obvious
from that:

- **`pg_net` is asynchronous.** `net.http_delete()` returns a request id and the
  response lands in `net._http_response` later. Any protocol that must confirm an
  action only *after* verifying the HTTP call succeeded — the audio purge is exactly
  this — needs two passes, and is therefore a second implementation of the worker.
- **`supabase start` does not run the edge runtime** unless asked, and the CLI stops
  it by default on this project. An edge-function-based job cannot be exercised by
  the test suite at all here, so it cannot be a compliance control.

### The direct database connection does not work from GitHub Actions

The dashboard offers `db.<ref>.supabase.co:5432` first, and it is the wrong one for
CI. Supabase serves **direct connections over IPv6 only** — an IPv4 address is a paid
add-on — and **GitHub-hosted runners are IPv4-only**. The failure is a connection
timeout, which reads like a wrong password and sends you to check the secret.

Use the **session pooler**: `aws-0-<region>.pooler.supabase.com:5432`, user
`postgres.<ref>` rather than `postgres`.

**Session (5432), not transaction (6543).** The transaction pooler recycles the
connection between statements, which breaks prepared statements and anything
session-scoped. The retention worker holds `SELECT ... FOR UPDATE SKIP LOCKED` across
statements and the reconciliation worker holds a run id, so both need session mode.
All three strings are written out in `.env.example`.

### Rollback files inside `supabase/migrations/`

The CLI has no down-migration step, and anything matching `*.sql` in that directory
is a candidate for being applied. Rollbacks live in `services/api/rollbacks/` for
that reason, and are exercised by `pnpm --filter @elmiron/api verify:rollbacks`.

---

## Postgres and RLS

### `postgres` is not a superuser in Supabase, but it holds `BYPASSRLS`

Measured, because assuming it costs an entire test suite:

```
 rolname       | rolsuper | rolbypassrls
 postgres      | f        | t
 service_role  | f        | t
 authenticated | f        | f
```

Consequences that are not obvious:

- **`FORCE ROW LEVEL SECURITY` does not constrain either role.** `BYPASSRLS` skips
  the row-security system entirely and is unaffected by `FORCE`, which only removes
  the separate *owner* exemption. With FORCE on, `postgres` still reads every row.
- Therefore **immutability cannot be an absent UPDATE policy.** It has to be a
  trigger (BYPASSRLS does not skip triggers) plus revoked grants (privileges are a
  separate mechanism). Two independent layers.
- A test that connects as `postgres` proves nothing about RLS. Use
  `set local role authenticated` plus a `request.jwt.claims` GUC.

### A row-level trigger never fires for a zero-row UPDATE

An out-of-scope `UPDATE` that matches nothing reports "0 rows affected" and reads as
success. Append-only guards are therefore **statement-level**, which fires before
the scan and errors every time.

### `convert_to()` is STABLE, not IMMUTABLE

So it cannot appear in a generated column. Wrap it in a function marked IMMUTABLE
that pins the encoding to a literal — and know that the promise depends on the
database encoding never changing.

### `select f()` on a composite-returning function

`node-pg` hands back an opaque string like `(uuid,uuid,...)`. Use
`select * from f()` to get real columns.

### Supabase grants `TRUNCATE` on new public tables by default

To `authenticated` and `anon`, even when the Data API is not auto-exposing them —
and `TRUNCATE` ignores row-level security completely. Every migration does
`revoke all ... from anon, authenticated` **before** granting.

---

## Vitest

### Module-scope memoisation does not dedupe across spec files

Each spec file gets its own module registry, so a memoised promise runs once *per
file*, not once per run. Measured with a throwaway second file: the warning printed
twice.

Cost is bounded because files run in parallel — `ceil(files / workers) × 3s`, not
`files × 3s`. A real cross-file fix needs `globalSetup` with `provide`/`inject`.

### Spec files run in parallel against ONE database and ONE bucket

Every `.spec.ts` gets its own worker thread, and they all commit into the same
Supabase stack. Anything that reads global state is a cross-file race waiting for a
third spec file to be added. BE-W7 took the suite from seven files to ten and turned
two latent races into roughly one-in-ten CI failures:

- **A global count.** `select count(*) from audit_log where table_name = 'visits'`
  before and after an insert, expecting +1. Another file committing a visit between
  the two reads makes it +2, which reads as a trigger bug. Scope the count to the
  row's own id.
- **A shared catalogue.** Every fixture run seeds its own `en-IN` consent text with
  `effective_from now()`, so all runs compete to be the version
  `active_consent_text()` returns. Reading it in one statement and using it in the
  next, under READ COMMITTED, gets two different answers. Put both in one statement
  so they share a snapshot.
- **A shared worker.** `claim_expired_audio` uses `for update skip locked`, so a
  purge started by another file can claim your object first. Asserting after exactly
  one `runPurge` is asserting that no other worker exists. Worse, a claim by a worker
  that then dies is invisible for the fifteen-minute stale window.

The symptom is a different test failing each run, in files nobody touched.

### A skipped suite and a passing suite look similar in a terminal

The database tests report **skipped** when no database is reachable, and CI throws
rather than skipping. Both behaviours are deliberate: before that fix, a run against
no database reported *152 passed*.

**When reading a test run, check for "passed" rather than "skipped".** If the local
Supabase stack is still coming up, the whole suite skips and the summary still looks
broadly green.

---

## Supabase Storage

### A row delete does not delete the object

`delete from storage.objects` removes the row and leaves the file in the storage
backend. Supabase now refuses the statement outright — *"this prevents accidental
data loss from orphaned objects"* — which is the right call, but it means **any
deletion path needs two systems and any deletion test needs two assertions**.

Consequence for this project: the 90-day retention worker cannot live in Postgres.
It claims a batch in SQL, deletes each object through the storage HTTP API, then
confirms in SQL. See `services/api/scripts/purge-expired-audio.mjs`.

Consequence for rollbacks: `20260815000300...down.sql` deliberately does **not**
drop the bucket. Empty it through the API first.

### A chunked upload is an UPSERT, so a `using (false)` SELECT policy silently forbids it

Supabase Storage does not issue an `UPDATE` when a client writes to an object that
already exists. It issues:

```sql
INSERT INTO storage.objects (...) VALUES (...)
ON CONFLICT (name, bucket_id) DO UPDATE SET ... RETURNING *
```

Postgres applies **SELECT policies to the conflicting row** of an upsert, and to any
`UPDATE` whose `WHERE` clause references columns. BE-W6's `audio_no_public_read`
(`for select ... using (false)`) therefore made every chunk after the first fail:

```
new row violates row-level security policy for table "objects"
```

**The message names the wrong thing.** It points at a `WITH CHECK` on the write; the
policy actually refusing is the SELECT one. And a plain `UPDATE ... WHERE name = ...`
under the same policy reports **"0 rows affected"**, which reads as success.

Fix: scope the read rather than forbidding it. `audio_select_live_upload_only` allows
reading only an object the caller holds a live, open, unconsumed grant for — so a
completed recording stays unreadable and resumable upload works.

Diagnose this class of failure by running the exact statement from the storage
container's log as `set local role authenticated` with a `request.jwt.claims` GUC.
The service's error body carries the real statement; the HTTP status does not.

### `DELETE object` returns HTTP 400 when the object is missing, with the 404 in the body

```
HTTP 400
{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
```

So `if (response.ok || response.status === 404) return;` — the obvious idempotency
check, and what BE-W6's retention worker had — **never fires**. Deleting an object
something else already removed was being treated as a hard failure.

It stayed invisible for a week because nothing reached it: `claim_expired_audio` does
not re-claim a destroyed row, so the retention worker never asks twice. The
post-restore reconciliation walks the bucket instead of a claim list and hit it on
its first run. The check now parses the body — see `services/api/scripts/storage.mjs`,
which both workers share.

The same 400-wrapping applies to `GET` of a missing object.

### A bucket walk is a smear across time, not a snapshot

`storage.objects` is a table in the same database, so a PITR restore rewinds it with
everything else. The only witness that did not travel back is the object store
itself, over HTTP — and walking it takes long enough that rows change underneath.

An upload that starts between the database read and the storage walk looks like an
object with no row. Reversing the order just moves the error to the other direction.
**Both snapshots have to be re-verified per finding immediately before acting**, or a
reconciliation destroys live uploads. Found by another spec file racing this one.

### Creating buckets and storage policies from SQL works, but `storage.objects` is not yours

`storage.objects` is owned by `supabase_storage_admin`. `postgres` can still
`create policy` on it and `insert into storage.buckets` — verified before designing
against it, which is worth doing rather than assuming either way.

---

## More Postgres

### `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds it

PG12+ allows the statement inside a transaction, but the new label is not usable
until that transaction commits. Each Supabase migration file is one transaction, so
**adding an enum value and using it needs two migration files**. That is why
`20260815000100` adds `org_default_shift_window` and `20260815000200` uses it.

### `SET ROLE` to a role you created still needs membership

`create role llm_gateway nologin` does not let `postgres` become it.
`grant llm_gateway to postgres` does. Without that, a test that tries to prove a
denial fails with *"permission denied to set role"* — which looks like the thing you
are testing and is not.

### `round(double precision, integer)` does not exist

Only `round(numeric, integer)`. `percentile_cont` returns double precision even over
a numeric input, so it needs an explicit `::numeric` before rounding.

### An append-only table cannot carry an `ON DELETE SET NULL` foreign key

`SET NULL` is implemented as an **UPDATE against the referencing table**, so a
statement-level append-only trigger refuses it — and the failure surfaces somewhere
else entirely. `adverse_event_reports.redacted_transcript_id` written as
`references public.transcripts_redacted (id) on delete set null` made every consent
withdrawal fail:

```
adverse_event_reports is append-only: UPDATE is not permitted by any role
```

The withdrawal cascade deletes redacted transcripts, which fired the FK, which fired
the guard. Seven BE-W6 withdrawal tests went red pointing at a table BE-W6 never
heard of.

`ON DELETE RESTRICT` is worse here: it lets an adverse-event report veto a doctor's
withdrawal. The column is a plain `uuid` with no FK, and the pointer dangles once the
transcript is destroyed — which is the honest state of affairs.

### `ALTER TABLE ... ADD CONSTRAINT` validates existing rows, including ones you may not delete

Narrowing a CHECK during a rollback fails if history violates it:

```
ERROR: check constraint "audio_destruction_log_object_kind_check" is violated by some row
```

On an ordinary table you would delete the offending rows. On an **append-only** one
you cannot, by construction — that is the whole point of it. Use `NOT VALID`, which
binds new rows and leaves the record intact.

Caught by `verify:rollbacks`, which is the entire argument for executing rollback
files rather than merely writing them.

### `now()` is transaction start; `clock_timestamp()` is now

Inside one transaction, a row stamped with `clock_timestamp()` is *later* than
`now()`. A threshold expressed as `x < now() - interval` will therefore not fire for
something written moments earlier in the same transaction. This produced a
confusing test failure; the test was rewritten to use a ratio threshold instead of a
clock one.

---

## Bash on this machine

### Large heredocs in the Bash tool are unreliable

Multi-hundred-line `cat > file <<'EOF'` blocks have twice failed with
`unexpected EOF while looking for matching quote`, on content that contains no
unbalanced quotes. Write files with the editor tool instead, or with a short Python
block. Do not debug the heredoc; it is not the interesting problem.

### Backticks inside a JS template literal end the literal

Obvious in isolation, invisible in a 900-line test file: a SQL comment written inside
a `` ` ``-quoted query that itself contains `` `auth.uid()` `` terminates the string
and produces a parse error 40 lines away. Use plain words in SQL comments inside
template literals.

---

## Remote connection strings

### A `?` in the database password breaks the URL, and the error tells you nothing

Supabase generates passwords containing characters that are structural in a URL —
`?` is the fatal one, because it begins the query string. A connection string with an
unencoded `?` in the password is not a valid URL, so `pg` refuses it before any
network call:

```
TypeError: Invalid URL
  code: 'ERR_INVALID_URL',
  input: '*****REDACTED*****',
```

**`pg` redacts the value in its own error**, which is correct behaviour and also
means you cannot see which character is at fault. It reads like a malformed host or a
library bug. It is neither.

**Fix:** percent-encode the password segment only — `?` → `%3F`, `+` → `%2B`,
`#` → `%23`, `@` → `%40`, `/` → `%2F`. `.env.example` says "percent-encode them in
all three" for this reason; the instruction is easy to skip because the string looks
fine.

Verified 17 Aug 2026: both the session-pooler and direct strings for this project
failed as stored and connected immediately once the password was encoded. Nothing
about the host, user or port was wrong.

### The direct string works from a laptop and will not work from Actions

Confirmed from this machine: `db.<ref>.supabase.co:5432` connects fine, because the
machine has IPv6. GitHub-hosted runners are IPv4-only, so the same string there fails
as a **network timeout that reads like a bad password**. Use the session pooler
(`aws-0-<region>.pooler.supabase.com:5432`) for anything running in CI — not the
transaction pooler on 6543, which recycles the connection between statements and
would silently drop a `for update skip locked` claim held across them.

### Check whether the remote schema exists before blaming credentials

```sql
select count(*) from information_schema.tables where table_schema = 'public';
select count(*) from information_schema.tables
 where table_schema = 'supabase_migrations' and table_name = 'schema_migrations';
```

Zero and zero means `supabase db push` has never run — the credential is fine and the
database is empty. A worker pointed at that fails on a missing function, which looks
like a code defect rather than an unfinished deployment.

## Node's `URL` and IPv6 hosts

### `new URL(...).hostname` keeps the brackets on an IPv6 literal

`new URL('postgresql://x@[::1]:5432/db').hostname` returns `"[::1]"`, not `"::1"`.
A guard comparing against the bare address (`::1`, `127.0.0.1`, `localhost`) has to
strip `^\[|\]$` first, or it refuses a genuinely-local IPv6 URL as if it were remote.
Caught by a test asserting the guard *allows* `[::1]`, not just that it refuses a
remote host — the refusal path would have passed either way.

## Cron cadence and a threshold that is itself data

### A negative claim ("has never fired") rots the moment it becomes false

`handover.md` asserted the retention and watchdog crons had never fired, twice, in
two separate sessions. Both were already false when re-checked with
`gh run list --workflow="<name>" --json event,createdAt,conclusion` — the schedules
had been firing daily and failing (missing secrets) for two days by the time anyone
looked. Any claim of the shape "X has never happened" or "Y is absent" needs the
command that re-checks it written next to the claim, not just the claim, or the next
reader inherits a timestamp as if it were a fact.

### A test threshold that "just happens" to sit under a stall check is a landmine

`app_thresholds` values (like `purge_max_silence_hours`) are read by both production
code and by test fixtures that deliberately backdate a `purge_after` column to
simulate "overdue." A **committed** fixture backdated by an amount that's safely
under today's threshold (e.g. 1 day, under a 48-hour stall window) is silently a
future cross-file hazard: tighten the threshold later (BE-W8 moved it to 3 hours)
and that same fixture now trips a *global* stall check for every test running
concurrently on the shared local database — a flake that reads as unrelated failures
in other files, with no obvious connection to the commit that actually caused it.
Rolled-back fixtures (`inRolledBackTransaction`/`asUserTx`) are immune, because
nothing they write is ever visible to another connection. A **committed** fixture
that needs "overdue" should use a small, named constant
(`OVERDUE_NOT_STALLED_MINUTES` in `services/api/tests/db.ts`) rather than a
raw interval that happens to clear whatever the threshold is today.

## Arithmetic beats intuition for a scheduled worker's batch size

A worker that drains its backlog quickly in isolation (5,000 objects in 50 runs of
~591ms, well within a single CI job) can still be under-provisioned by an order of
magnitude at the *stated* target scale, because the constraint was never throughput
— it was cadence. Batch-size-per-run × runs-per-day has to be checked against
arrival-rate-at-pilot-scale explicitly; "the database handles this batch fast" says
nothing about whether the schedule around it can keep up. Found by doing the
arithmetic against the plan's own numbers (100 MRs × 8 visits/day), not by load
testing — the deficit (~16x) was visible before running anything.

## `create or replace function` means reading one definition tells you nothing

### Auditing a function's behaviour from a migration file finds the WRONG definition if a later migration redefines it

A migration chain full of `create or replace function public.foo()` is a chain of
overwrites, not a chain of additions. `public.audio_purge_health()` was defined once
in `20260815000300_audio_consent_retention.sql` (missing two fields the JS consumer
reads) and redefined completely in `20260816000300_resumable_upload.sql` (fields
present, correctly wired). Reading only the first definition and concluding "this
function has been broken since it shipped" produced a wrong, confidently-stated claim
that made it into a migration's own comments before being caught.

**The fix is procedural, not just "be more careful":** to know what a function
*actually does today*, either `grep` every migration file for every
`create or replace function public.<name>` and read the LAST one in migration order,
or — far more reliably — query the live database directly:

```sql
select prosrc from pg_proc where proname = 'audio_purge_health';
```

or, simpler still, call the function and inspect its real return shape. A local
`db reset` with the migration under suspicion held out of the migrations directory,
then re-applied after confirming the claim, is what caught this one — the claim
didn't survive contact with the actual database.

## A `BEFORE INSERT` trigger that stamps a compliance column defeats a fixture that sets it directly

### Third time this recurred: `stamp_audio_retention` silently overwrites whatever `purge_after` a test fixture supplies on `INSERT`

`stamp_audio_retention()` is a `BEFORE INSERT` trigger on `recordings` and
`voice_notes` that unconditionally sets `purge_after := received_at + interval '90
days'`, regardless of what the `INSERT` statement supplied. Any fixture that does

```sql
insert into public.recordings (..., purge_after) values (..., now() - interval '10 days')
```

silently gets a row 90 days in the *future*, not 10 days in the past — the insert
succeeds, nothing errors, and the test that depends on the row being overdue either
fails confusingly or (worse) passes for the wrong reason, because whatever it's
actually testing happened to be true anyway. Hit three separate times on this
project: the Part 3.1 volume measurement, the Part 3.2 cross-file race fixtures, and
the BE-W8 addendum's backlog-stall tests.

**The pattern that works:** insert first (with any placeholder value, or omit the
column and let the trigger run), then a separate `UPDATE` afterward to backdate the
column for real — the trigger only fires `BEFORE INSERT`, not `BEFORE UPDATE`, so the
second write sticks:

```sql
insert into public.recordings (..., purge_after) values (..., now());
update public.recordings set purge_after = now() - interval '10 days' where id = $1;
```

**The general rule, for any table in this schema:** before writing a fixture that
sets a column a trigger also writes to, check for a `before insert` trigger on that
table (`\d public.<table` in psql, or grep the migrations for
`before insert ... execute function`). If one exists and touches the column, the
fixture needs the insert-then-update shape above — a single `INSERT` with the
"right" value is not evidence the value survived.

---

## Expo, Metro and pnpm — FE-W1

### `disableHierarchicalLookup` in `metro.config` breaks resolution under pnpm

Expo's monorepo guide gives a Metro config with
`config.resolver.disableHierarchicalLookup = true`. **That guide assumes npm or
yarn.** Under those, every package is flat at the workspace root and the upward
walk finds only duplicates, so switching it off is a speed-up. Under pnpm a
package's own dependencies live nested inside the virtual store, and the upward
walk is the only way to reach them.

With it on, the bundle fails one package at a time:

```
Unable to resolve module @expo/metro-runtime from .../expo-router/entry-classic.js
Unable to resolve module whatwg-fetch      from .../@expo/metro-runtime/src/...
Unable to resolve module invariant         from .../expo-router/build/renderRootComponent.js
```

Each name belongs to a package **you did not install and cannot fix by
installing**, because the import is inside somebody else's file. It reads as a
broken dependency tree. It is a resolver setting.

**Fix: do not set it.** Set `watchFolders` and `nodeModulesPaths` and stop there.
With hierarchical lookup left on, the app bundles under pnpm's default isolated
linker with no hoisting at all.

**What this cost, and what it nearly cost.** The first two failures were read as
"pnpm cannot do React Native", and the fix reached for was `nodeLinker: hoisted`
across the workspace. That would have worked, and it would have silently deleted
the install-time guarantee that a package cannot import what it has not declared —
for `core`, `mock` and `api` as well, to accommodate one app. If you find yourself
hoisting to fix a resolution error, check `disableHierarchicalLookup` first.

### When a fix needs a repo-wide control weakened for one workspace, the diagnosis is wrong

Stated separately because it generalises past Metro.

The two resolution failures above were read as "pnpm cannot do React Native", and
the fix reached for was `nodeLinker: hoisted` across the workspace. That would have
worked. It would also have deleted, for `core`, `mock` and `api` as well, the
install-time guarantee that a package cannot import what it has not declared — to
accommodate one app. The actual cause was one line of our own Metro config.

**The install-time guard was correctly reporting a real problem, and we were about
to remove it for being right.**

So: *a fix that requires weakening a repo-wide control to accommodate one workspace
is evidence that the diagnosis is wrong, not that the control is too strict.* Bound
the attempt, find the local cause, and only then decide whether the control is
actually the obstacle. The same shape appears earlier in this file — the RLS test
that "proved" nothing because it connected as `postgres`, and the idempotency check
that never fired because the 404 arrived inside an HTTP 400.
### `node-linker` in `.npmrc` is silently ignored by pnpm 11

pnpm 11 reads its settings from `pnpm-workspace.yaml`, not `.npmrc`. A
`node-linker=hoisted` line in `.npmrc` produces no warning, no error, and no
effect — `pnpm install` reports "Already up to date" and the layout is unchanged.
The equivalent key is `nodeLinker` in `pnpm-workspace.yaml`, alongside `storeDir`
and `allowBuilds`.

Related: changing the linker does not relink an existing tree. Every
`node_modules` has to be removed first, or the install is a no-op.

### Metro does not substitute `.js` for `.tsx`

TypeScript's NodeNext resolution maps `./Thing.js` onto `./Thing.tsx`, which is why
the rest of this repo writes `.js` extensions on relative imports. Metro does not.
A bundler-resolved package — `packages/ui` — must use **extensionless** relative
imports, or every import fails at bundle time while `tsc` reports nothing wrong.

### Expo reads `.env` from the app directory, not the workspace root

`EXPO_PUBLIC_*` values in the repo-root `.env` are invisible to `apps/field`. The
app needs its own `.env`. Both are gitignored by the root `.gitignore` (`.env`
matches at any depth), and `apps/field/.env` must hold **only** `EXPO_PUBLIC_*`
values, every one of which is inlined into the shipped bundle and readable from
the APK.

### `expo install` rewrites `package.json` and adds config plugins

It reformats the file and appends a `plugins` array to `app.json` — including
entries for packages you did not ask it to configure. Re-read both files after
running it rather than assuming only dependencies moved.

## pnpm on Windows — FE-W1

### `corepack enable --install-directory "$env:APPDATA\npm"` fails with ENOENT

The fix recorded above under "Node and pnpm on Windows" assumes
`%APPDATA%\npm` exists. On a machine where npm has never installed a global
package it does not, and corepack reports:

```
Internal Error: ENOENT: no such file or directory, lstat 'C:\Users\<user>\AppData\Roaming\npm'
```

The directory is already on `PATH`, which is what makes this confusing — `PATH`
lists it, so it looks present. Create it first:

```powershell
New-Item -ItemType Directory -Path "$env:APPDATA\npm" -Force
corepack enable --install-directory "$env:APPDATA\npm"
```

### Moving the repo invalidates `node_modules`, and pnpm will not purge it without a TTY

After moving the checkout to a new path, `pnpm install` aborts:

```
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
```

`CI=true` allows the purge — **and then blocks the next install that changes the
lockfile**, because `CI` also implies `--frozen-lockfile`. Set it for the purge,
unset it before adding a dependency. The two failures look unrelated and are the
same variable.


## Credentials and `.env` — FE-W1

### Classify by value shape, not by key name

Moving production credentials out of the repo, a first pass filtered on key names —
`*_SECRET_KEY`, `*_ACCESS_TOKEN`, `*_DB_URL`, `*_POOLER_*`. It moved six values and
left three behind: `SUPABASE_URL`, `SUPABASE_JWKS_URL` and
`EXPO_PUBLIC_SUPABASE_URL`, all pointing at the deployed project.

None of those names sounds like a secret, and strictly none is one. **A URL is a
pointer, and a pointer decides which database you talk to.** The Expo one is the
worse of the three: it would have sent the mobile app at production, where there is
no seed reference data and no shift window, so every capture refuses — a confusing
failure rather than a dangerous one, and still the opposite of the instruction that
sign-in runs against the local stack.

Scan the values, not the names:

```bash
grep -nE '=(https?://[a-z0-9]+\.supabase\.co|postgres(ql)?://)' .env
```

Anything matching `<ref>.supabase.co` or a `postgres://` authority is remote no
matter what the key is called. A name-based filter cannot find it, because the name
was chosen before anyone knew which environment the value would hold.

### Filenames arrive stripped of hyphens from the claude.ai download

Three files landed as `frontendplanv2.md`, `frontendpromptw1.md` and
`blockedonyou.md`, each of which should have been hyphenated. The cause is the
download step, not git, OneDrive or Windows.

The alternate data stream on the file shows it:

```powershell
Get-Content docs\blocked-on-you.md -Stream Zone.Identifier
```
```
[ZoneTransfer]
ZoneId=3
ReferrerUrl=https://claude.ai/cowork/...
HostUrl=https://claude.ai/api/organizations/<org>/files/<uuid>/contents
```

The download URL carries a UUID and **no filename**, so the name is generated
client-side from the document title — and the generator strips every non-alphanumeric
character rather than replacing it with a hyphen. "Blocked on you" becomes
`blockedonyou`. The `.md` extension survives because only the basename is sanitised.

**Consequence:** every document arriving this way needs renaming before it is
committed, and the repo convention (`backend-prompt-w6.md`) makes the un-hyphenated
form obvious — which is the only reason all three were caught. Rename on arrival; do
not assume the name you gave the document is the name on disk.

The same stream is worth checking whenever a file's name or encoding looks wrong: it
records where the file actually came from, which no amount of looking at the contents
will tell you.

### The development machine's clock drifted, and tests must not read it

Observed during FE-W2: git stamped most of a session''s commits `2026-08-14` while
the tooling reported the date as `2026-08-17`, and a later commit in the same session
stamped `2026-08-17`. Roughly three days, inside one working session.

`docs/frontend-plan-v2.md` §3.4 already says the **client''s** clock is not trusted
and that every record carries a server `received_at` alongside the device''s
`occurred_at`. That is a product rule about an MR''s phone. This is a different
problem with the same shape: **the development machine''s clock is not trustworthy
either.**

The consequence is specific. Any fixture, seed or assertion that reaches for local
time — `new Date()`, `Date.now()`, `now()` in a seed, a relative window like "within
the last hour" — is a flaky test, and it fails *differently* in CI than locally
because the two clocks disagree. With CI having never run on the frontend, the first
green-locally-red-in-CI run is where that gets discovered, and it reads as a logic
bug rather than a clock one.

**Rule: anything time-sensitive in a test takes an injected or fixed value.** Pass the
instant in, freeze it, or use a constant. Never read the machine. The backend suites
already do the equivalent — `received_at` is stamped by trigger from
`clock_timestamp()` and asserted against the row, not against the test runner''s idea
of now.

If a date in a report and a date in a commit disagree, neither is automatically
wrong. See `.ai-collab/decisions.md` — "How dates in the record are read".

### `pnpm db:start` fails with a named-pipe error when Docker Desktop is not running

```
{"_tag":"Error","error":{"code":"LegacyDockerLifecycleInspectError",
 "message":"failed to inspect container health: failed to connect to the docker API at
 npipe:////./pipe/dockerDesktopLinuxEngine..."}}
```

Reads as a Supabase CLI fault and is not one. Docker Desktop does not start with
Windows by default, so after any reboot the daemon pipe is simply absent. Start
Docker Desktop, wait for the daemon, then re-run. The tell is `npipe://` in the
message — a Supabase problem never mentions a Windows named pipe.

Worth pairing with the existing note that a database suite reports **skipped**, not
failed, when nothing is reachable. Reboot, forget Docker, run the suite, read
"green": that is the whole trap in one sequence.

### Renaming an identifier that is also a word in the prose

FE-R1 had to remove a trademark from package identifiers while leaving the same word
alone in documentation that legitimately describes the drug. A naive
case-insensitive sweep of the brand name would have rewritten 189 occurrences across
70 files, most of them prose, and produced an unreviewable diff.

**The technique: pick tokens that are only ever identifiers.** Here
`@elmiron/` (with the trailing slash) is always the npm scope, `elmironmr` is always
the package id or scheme, and bare `Elmiron` is always the drug. Three exact,
case-sensitive substitutions touched 51 files and 91 occurrences, every one of them
an identifier, and left the prose untouched by construction rather than by review.

Order matters when one token contains another: `com.praversetech.elmironmr` has to be
replaced **before** `elmironmr`, or the result is
`com.praversetech.praversefieldforce`.

The verification then has to report the deliberately-unchanged count *separately*, or
a reviewer reading "17 files still match" cannot tell a design decision from a miss.

### `expo prebuild` rewrites your package.json scripts

Running `npx expo prebuild --platform android` to inspect the generated manifest also
rewrote `apps/field`'s `android` script from `expo start --android` to
`expo run:android`. That is correct for a project that keeps its native directories
and wrong for one that does not — and it lands silently in a file you were not
editing.

If you prebuild only to inspect the output, check `git status` afterwards and revert
what you did not mean to change. Deleting the generated `android/` directory does not
undo the script edit.

**Worth doing anyway.** `expo config --type public` and `--type introspect` both
resolved a dotted URI scheme happily while `intentFilters` stayed empty, because the
scheme is applied to the manifest during prebuild rather than at config time. Only
the prebuild proved `<data android:scheme="com.praversetech.fieldforce"/>` actually
lands. Config-level checks would have passed either way.

### Searching a built bundle finds APIs the app never calls

Grepping the tree for `signInWithOtp` matched `apps/field/dist/*.hbc` — the compiled
Hermes bundle, which contains `supabase-js`'s own implementation of every auth method
whether the app calls one or not.

Exclude build output when asking "does our code use X". The answer from a bundle is
always yes.

### Anything that lands in AndroidManifest.xml is verified at prebuild, never at config

**The general rule. The deep-link scheme in FE-R1a was only the first instance.**

`expo config --type public` and `expo config --type introspect` both resolve the
*config*. They do not generate the *manifest*. A value can resolve perfectly at
config level and never reach `AndroidManifest.xml`, and both commands will report
success while it happens.

Measured in FE-R1a: with a dotted URI scheme set, `--type introspect` returned
`scheme: com.praversetech.fieldforce` and `intentFilters: []` — empty. Only
`npx expo prebuild --platform android` produced the actual
`<data android:scheme="com.praversetech.fieldforce"/>` that proves it lands.

**This sits directly in front of FE-W3 and FE-W4.** The same blind spot applies to
every value a config plugin writes into the native manifest:

| Sprint | Value | Written by |
| --- | --- | --- |
| FE-W3 | `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` | Transistorsoft background geolocation |
| FE-W4 | background audio mode, `FOREGROUND_SERVICE_MICROPHONE` | `expo-audio` |

If any of those resolve at config level and do not reach the manifest, the result is
a **runtime failure on a real device that presents as a native-module bug** — you
will spend the day reading Transistorsoft issues. The check is one command:

```bash
npx expo prebuild --platform android --no-install
```

then grep the generated `android/app/src/main/AndroidManifest.xml` for the permission
or intent filter you expect. Delete `android/` afterwards if you do not keep native
directories — **and check `git status`**, because prebuild also rewrites
`package.json` scripts (see the entry above).

### Repo search convention — exclude build artifacts

Grepping this repo for "does our code use X" gives wrong answers unless build output
is excluded. `apps/field/dist/*.hbc` is a compiled Hermes bundle containing
`supabase-js`'s entire SDK, so a search for `signInWithOtp` matches there whether or
not the app has ever called it. That false positive cost time once in FE-R1a.

`apps/field/dist/` is **gitignored, not tracked** (`.gitignore:6` — `dist/`), so
`git ls-files` based searches are already clean. Filesystem searches are not.

Exclude, when asking what the source does:

```
dist/  build/  .expo/  android/  ios/  node_modules/  *.hbc  *.map  coverage/
```

The reliable form is to search tracked files only:

```bash
git ls-files | grep -vE '^docs/|\.(md|html)$' | xargs grep -n 'thingYouAreLookingFor'
```

Documentation is excluded separately there for a different reason — see the
identifier-versus-prose entry above.

## The render harness — FE-H1

### Jest cannot resolve a bare preset name under pnpm

```
● Validation Error:
  Preset jest-expo not found.
```

`jest-expo` is installed and linked at `apps/field/node_modules/jest-expo`, and
node's own resolver finds it from that directory without complaint. Jest uses its
**own** resolver, running from inside `.pnpm/jest@29.../node_modules`, which does not
search the workspace. The error says the package is missing when it is present.

Resolve the path in the config instead, from the config file's own location:

```js
// jest.config.cjs
preset: require('node:path').dirname(require.resolve('jest-expo/jest-preset')),
```

**`dirname` matters.** Passing the resolved *file* gives a different and equally
confusing error: `Module .../jest-preset.js should have "jest-preset.js" or
"jest-preset.json" file at the root`. Jest wants the directory containing the preset.

### The working `transformIgnorePatterns`

`jest-expo`'s preset transforms React Native and Expo packages inside `node_modules`
and skips everything else. That is right until a workspace package is consumed as
**TypeScript source** rather than built JavaScript — which is how `@fieldforce/ui` is
set up, so Metro and Next.js can each transpile it. Without the scope added, jest
hands raw TSX to node and dies on the first `<`.

Verbatim, from `apps/field/jest.config.cjs`:

```js
transformIgnorePatterns: [
  'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@fieldforce/.*))',
],
```

The `(?:.pnpm/)?` and the trailing `@fieldforce/.*` are the two additions to the
stock pattern.

### `@testing-library/react-native` v14: `render` is async

**The most misleading error in this sprint.** In RTL v14 `render` returns a Promise.
Called without `await`, it yields a thenable whose prototype is
`constructor, then, catch, finally` — no query methods — and `screen` throws:

```
`render` function has not been called
```

which reads as though render was never invoked, rather than as an un-awaited promise
one line above. Symptoms: `view.getByText is not a function`, and `screen` throwing
immediately after an apparently successful render.

```tsx
await render(<Thing />);          // not: const view = render(<Thing />)
expect(screen.getByText('x')).toBeTruthy();
```

Queries come from the module-level `screen`, not from a return value. Every render
test needs this.

### Never `Set-Content -Encoding utf8` on Windows PowerShell 5.1 — it writes a BOM

`jest-haste-map` refuses the file outright:

```
Error: Cannot parse .../package.json as JSON: Unexpected token '', "{
  "name"... is not valid JSON
```

PowerShell 5.1's `utf8` means **UTF-8 with BOM**. A BOM had sat in a tracked
`apps/field/package.json` across several commits, because nothing else parsed it
strictly enough to notice — `git`, `pnpm`, `tsc`, `eslint` and `prettier` all
tolerate it.

Use one of these when writing a file other tools will parse:

```powershell
[System.IO.File]::WriteAllText($path, $text)          # no BOM, any PS version
Set-Content $path $text -Encoding utf8NoBOM           # PowerShell 6+ only
```

To find existing ones:

```bash
git ls-files | while read -r f; do head -c 3 "$f" | od -An -tx1 | grep -q 'ef bb bf' && echo "$f"; done
```

## Mutation testing — a rule, not a technique

### A mutation that removes the check is not a proof of the check

Found while mutation-testing the vitest/jest boundary. The first mutation *replaced*
vitest's include glob with `.test.tsx`, intending to create an overlap. Instead it
stopped vitest matching `runner-boundary.test.ts` at all: the check never ran, and
the result read as green.

**A mutation must leave the assertion running and make it fail.** If the test count
drops, the mutation deleted the test rather than breaking it, and the proof is void.

Check the count, not just the colour:

```
before mutation   44 passed
bad mutation      40 passed          <- check vanished, proves nothing
good mutation     2 failed | 42 passed
```

The correct version *widened* the include to `['src/**/*.test.ts', 'src/**/*.test.tsx']`,
which keeps the boundary test running and makes it fail on its own assertion.

This applies to everything mutation-tested on this project, including the FE-W2
reducer guards and the FE-W1 contrast controls — all of which were verified by
failure count rather than by colour, but none of which stated the rule.

### Adding a workspace does not add it to CI — check, do not presume

CI names each suite explicitly rather than running `turbo run test`, so a new
workspace's tests are invisible in CI until somebody adds a line. Nothing warns.
`ui-tokens` carried the WCAG contrast guard — a build-failing accessibility control —
and it had **never executed in CI**, because the step was simply absent. The local
runs were green the whole time.

Every workspace with a real test script must appear in a workflow. Audit with:

```bash
git ls-files '*package.json' | while read -r f; do
  n=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8')).get('name',''))" "$f")
  t=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8')).get('scripts',{}).get('test',''))" "$f")
  case "$t" in ""|echo*) continue;; esac
  grep -q -- "--filter $n test" .github/workflows/*.yml || echo "NOT IN CI: $n"
done
```

As of FE-H1 all five run: `core`, `ui-tokens`, `mock` and `field` in the static job,
`api` in the database job. **`packages/ui` is the next one to catch** — its `test`
script is still a placeholder `echo`, so the audit skips it, and it will need a CI
line the day it gains a real suite.

The general shape: a control that is only invoked by a list somebody maintains by
hand is a control that will eventually be left off the list.

### Report test BLOCKS and CASES separately wherever `it.each` exists

`app/home.tsx`'s route tests are 6 `it()` blocks that execute as 8 cases, because one
block is an `it.each` over three roles. A report quoting 6 while the runner prints 8
is a count nobody can reconcile — the same failure as a single total hiding a
per-runner split.

State both, always:

```
app/home.tsx   6 blocks / 8 cases
```

Sits alongside the mutation rule above: both are about counts that look sound and are
not.

### `it.each` with `as const` tuples produces a signature a destructured callback fails

```
error TS2345: Argument of type '(_state: "waiting" | ..., label: ..., over: ...) => Promise<void>'
is not assignable to parameter of type '(...args: readonly ["waiting", ...] | readonly [...]) => ...'
```

The `as const` makes each row a distinct readonly tuple type, and the callback must
satisfy every one of them at once. Use an array of **objects** instead — jest's `$var`
interpolation works on object keys, so the case names stay readable:

```tsx
it.each([
  { label: 'Waiting to send', attemptCount: 0 },
  { label: 'Still trying', attemptCount: 3 },
])('renders the label "$label"', async ({ label, attemptCount }) => { /* ... */ });
```

### `Array.prototype.reduce` infers the accumulator from the array, not from the seed

Driving the reducer over a literal array of events fails to typecheck: TypeScript
widens the array to a union of its element shapes and then insists the accumulator is
that union, so `state.items` "does not exist".

Annotate the array, not the reduce:

```ts
const events: SyncEvent[] = [ /* ... */ ];
const state = events.reduce(syncQueueReducer, emptyQueue);
```

---

## Android Toolchain and Build

### AndroidLocationsException: "Several environment variables ... contain different paths"

AGP reports this error while printing two IDENTICAL paths. The real rule is that only ONE mechanism may be defined. If both `ANDROID_PREFS_ROOT` and `ANDROID_USER_HOME` are set, the build fails even when they point to the same location.

### ANDROID_PREFS_ROOT injected by IDE

This variable was set at PROCESS scope only, injected by the IDE (Android Studio). A registry check shows nothing, and unsetting it in one shell session does not persist. To ensure a clean environment, build from an external terminal where the variable is not present.

### Emulator API version vs compileSdkVersion

The emulator's system image API (e.g., API 37) and the `compileSdkVersion` (e.g., API 36) are separate SDK components. Having an API 37 emulator does not provide the API 36 platform required for compilation. Both must be installed via the SDK Manager.

### JDK 25 failure (JEP 472) on native modules

JDK 25 fails during CMake configuration with a restricted-method error (JEP 472) when building `react-native-screens` and `react-native-worklets`. JDK 17 is the documented project requirement. Note that Android Studio's Gradle JDK and the terminal's `JAVA_HOME` are separate settings; both must be pointed at JDK 17 to ensure consistency between IDE and CLI builds.

### General Rule: Pinned Toolchain

The toolchain for this project is deliberately pinned to documented versions. Newer versions of the JDK or SDK platforms are not necessarily better and may introduce breaking changes or incompatibilities. Always match the versions specified in the project documentation.

---

## Checking a historical file with `npx` inside a bare `git worktree`

**The trap:** to find out whether a file was already failing `format:check` at an older
commit, the obvious move is a throwaway worktree at that commit and `npx prettier
--check .` inside it. A worktree has no `node_modules`, so `npx` does not find the
repo's pinned prettier — it downloads a different one and answers a different
question, silently, with no error and no version printed.

On 31 August this reported **one** non-conforming file at `90ede3c`. The correct
method found **two**: `apps/field/jest.config.cjs` was also non-conforming and the
worktree run missed it entirely. A wrong "it was already fine" is worse than no answer,
because it closes the question.

**The method that works** — extract the historical content into the working repo,
where the installed tooling is, and run the repo's own binary against it:

```sh
mkdir -p /tmp/check && git show 90ede3c:apps/field/jest.config.cjs > /tmp/check/jest.config.cjs
npx prettier --check /tmp/check/jest.config.cjs     # run FROM the repo, not the worktree
```

Keep the original filename: prettier infers its parser from the extension, and a
`.cjs` renamed to `.txt` is silently skipped.

**The general rule:** any command whose behaviour depends on `node_modules` —
prettier, eslint, tsc, jest — answers a different question inside a worktree that has
none. Either install into the worktree or bring the file to the tooling.

---

## Known flakes

Tests that have failed without a known cause. An entry here is a debt, not a
dismissal: it records the one observation precisely enough that the second one can
be recognised as a pattern rather than re-explained away.

### `apps/field` — `doctors.tsx` › "renders a denial as a denial, never as an empty list"

**The one failure, 31 August 2026.** It failed on the first run of
`pnpm --filter @fieldforce/field test` immediately after `apps/field/jest.setup.cjs`
was added and `setupFiles` was wired into `apps/field/jest.config.cjs` — the run in
which jest first loaded a setup file that had not existed on the previous run. Result
that run: `Test Suites: 1 failed, 5 passed, 6 total`, `Tests: 1 failed, 23 passed, 24
total`, this test the only failure.

**The four outcomes since.** `test:render` alone: passed, 24/24. Then three
consecutive full `test` runs (vitest + jest): passed, 44 + 24 each time. No change to
the test or to the component between the failure and the four passes.

**Hypothesis, and it is only that:** jest's transform cache was stale for that one
run — the setup file changed what the module registry looks like, and the failing run
was the one that straddled the change. Nothing was measured. The failure output was
not captured before the re-run, which is itself the mistake: a flake with no captured
output is a flake that cannot be diagnosed later.

> If this test fails once more under any conditions, it is investigated as a real
> race and not re-run. A test asserting a denial is enforced, that passes
> intermittently, is worse than no test.

### JDK 25 fails the Android native build, and the error names a warning

`./gradlew assembleDebug` dies on `:react-native-worklets:configureCMakeDebug` with:

```
> WARNING: A restricted method in java.lang.System has been called
```

A *warning* reported as the thing that went wrong. JDK 24+ restricts native access
(JEP 472) and emits that line on stderr; the CMake configure task treats non-empty
stderr as failure. The machine here has JDK 25 as the only JDK — Android Studio's
bundled JBR is 25 too, so `JAVA_HOME` does not help.

**Setting `org.gradle.jvmargs` in `gradle.properties` does NOT fix it.** The warning
comes from a forked worker, not the Gradle JVM, and the property does not reach it.
What works is the environment variable, which every JVM inherits:

```powershell
$env:JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED"
./gradlew assembleDebug
```

Build time after that: **6m 40s** cold, producing a 230MB debug APK.

`apps/field/android/` is gitignored and regenerated by `expo prebuild`, so any fix
written into `gradle.properties` is erased by the next prebuild. The environment
variable is the durable form, which is why it is recorded here rather than in a file.

---

## 7 September 2026 — cold-start traps on a third machine

Recorded from a first run of this repository on `C:/Users/Admin/StudioProjects/Elmiron-App`,
a machine that had never built it. Everything here cost time on that run.

### `pnpm --filter @fieldforce/field exec expo start` is broken under `nodeLinker: hoisted`

`pnpm exec` resolves the workspace-local `.bin` shim first, and the hoisted layout never
creates the path that shim points at:

```
Error: Cannot find module '<repo>\apps\field\node_modules\expo\bin\cli'
```

Call the hoisted CLI directly instead:

```sh
cd apps/field && node ../../node_modules/expo/bin/cli start --dev-client
```

This is the same hoisting consequence as the Metro extension rule above, and it is not a
pnpm bug. `nodeLinker: hoisted` is deliberate — it is the fix for the Windows CMake
path-length failure.

### `adb reverse` dies with the emulator, and all three ports must be re-run

`127.0.0.1` inside the emulator **is the emulator**. Every port the app needs from the
host is a separate reverse, and they are lost on every emulator restart — not just on a
cold boot:

```sh
adb reverse tcp:8081 tcp:8081     # Metro
adb reverse tcp:54321 tcp:54321   # Supabase
adb reverse tcp:4010 tcp:4010     # services/mock
```

A missing reverse presents as the app hanging on a request rather than as a connection
error, which is why it is worth re-running all three rather than diagnosing one.

### Stop every `node` process before `pnpm install`

Metro and the mock server hold file handles inside the hoisted `node_modules`, and
`pnpm install` fails with `ERR_PNPM_ENOENT`. Not a pnpm bug and not a corrupted store —
do not delete `node_modules` chasing it.

### The SDK's CMake 3.22.1 cannot build this app — its `ninja` is not long-path aware

The native build dies in `:app:buildCMakeDebug[arm64-v8a]`:

```
ninja: error: Stat(rngesturehandler_codegen_autolinked_build/CMakeFiles/
react_codegen_rngesturehandler_codegen.dir/C_/Users/.../node_modules/
react-native-gesture-handler/shared/shadowNodes/.../
RNGestureHandlerDetectorShadowNode.cpp.o): Filename longer than 260 characters
```

**`LongPathsEnabled = 1` in the registry does not fix this.** It was already `1` on the
machine where this was found. CMake 3.22.1 bundles an old `ninja` that is capped at
`MAX_PATH` regardless of the registry flag. Note also that
`react-native-gesture-handler` is a **transitive** dependency — it is not in
`apps/field/package.json`, so grepping the manifest for the offending package finds
nothing.

Fix:

```sh
sdkmanager "cmake;3.31.6"
```

then pin it, because AGP will otherwise pick the older one:

```gradle
// apps/field/android/app/build.gradle, inside android { }
externalNativeBuild { cmake { version '3.31.6' } }
```

**That pin does not survive.** `apps/field/android/` is gitignored and regenerated by
`expo prebuild`, so the pin is erased every time the native project is regenerated and
must be re-applied. Build after the fix: `BUILD SUCCESSFUL in 3m 32s`, 221MB debug APK.

### The first native build is OOM-killed on a 32 GB machine

With the emulator (~3.2 GB), Docker's WSL VM (~4 GB) and Android Studio (~1.5 GB) all
running, Gradle is killed mid-build with no useful error. Free memory before building:
stop the emulator, and `pnpm db:stop` for the duration — it reports `backup: true` and
the migrations and seeded users survive the restart. Build with

```sh
./gradlew.bat assembleDebug --no-daemon --max-workers=3
```

rather than `expo run:android`, so no device is needed while compiling.

### Piping gradle or turbo into `tail` hides the failure

`./gradlew.bat assembleDebug 2>&1 | tail -40` exits **0** even when the build fails,
because the exit status is `tail`'s. This produced a false "build succeeded" once. Check
for the artefact, or grep the log for `BUILD SUCCESSFUL` / `BUILD FAILED`. The same trap
applies to `pnpm turbo run test | tail`.

### `pnpm 11` forwards `--` literally

`services/api/scripts/seed-one-mr.mjs` documents its own usage as
`pnpm --filter @fieldforce/api seed:mr -- --email me@example.test`. Under pnpm 11 that
separator reaches the script and it dies with `Unrecognised argument: --`. Drop it:

```sh
pnpm --filter @fieldforce/api seed:mr --email me@example.test --password <pw>
```

The comment in the script is stale, not the runner.

### Checkout guard — check the namespace and the remote, never the path

The previous guard required `git rev-parse --show-toplevel` to equal `C:/dev/Elmiron-App`
and existed to catch a second, wrong checkout using the `@elmiron/*` namespace. **A path
check fails open on every new machine**: a third legitimate clone at a third path trips
the STOP for the wrong reason, and a wrong checkout placed at the expected path would pass.
Check the three things that actually identify this repository:

```sh
git rev-parse --git-dir >/dev/null 2>&1 &&
grep -q '"@fieldforce/core"' packages/core/package.json &&
git remote get-url origin | grep -q 'Praverse-Tech-Pvt-Ltd/Elmiron-App' &&
git merge-base --is-ancestor f34ceef HEAD
```

Exit 0 means this is the right tree. `f34ceef` is the commit that renamed the scope off a
third party's trademark, so a checkout predating it — or the `@elmiron/*` tree — fails.

### `@fieldforce/ui` and `@fieldforce/field` time out under parallel `turbo run test`

Under `pnpm turbo run test` with the emulator, Docker and Metro running, four tests fail
with `Exceeded timeout of 5000 ms` on suites that take 20 s — two in
`@fieldforce/ui` (`coaching.test.tsx`, `ConsentScreen.test.tsx`) and the rest in
`@fieldforce/field`. Run sequentially, one workspace at a time, **all 1,086 pass on the
same commit**.

These are machine-load timeouts rather than defects, but the consequence is worth stating
plainly: **a green suite on a loaded developer machine is not evidence, and a red one is
not necessarily a defect.** CI is the arbiter. If these ever fail on CI, where the load
profile is different, treat them as real and investigate rather than re-running.

### `upload.spec.ts` › "destroys the object of an upload the MR simply never came back to"

**A real race between two spec files, not a flake.** Found during FIX-02 and
investigated rather than re-run, per the rule above.

```
AssertionError: expected 0 to be greater than or equal to 1
  tests/upload.spec.ts:770  expect(result.abandoned).toBeGreaterThanOrEqual(1)
```

**Mechanism.** Exactly two specs call the global purge worker —
`grep -ln "runPurge" tests/*.spec.ts` returns `consent-audio.spec.ts` and
`upload.spec.ts` — and `services/api/vitest.config.ts` sets no `fileParallelism`, so
vitest runs spec files concurrently. `runPurge` claims due rows across the whole
database, so whichever spec's purge runs first can claim the other's abandoned grant,
and the second sees `abandoned === 0`.

**Evidence it is the parallelism and not the code:**

```sh
npx vitest run tests/upload.spec.ts              # 35 passed, three consecutive runs
npx vitest run --no-file-parallelism             # 349 passed, twice
npx vitest run                                   # intermittently 1 failed | 348 passed
```

**Not fixed here, because the fix is a choice.** Either the two specs stop sharing the
worker (each purge scoped to its own fixture rows), or the workspace sets
`fileParallelism: false` and pays the wall-clock cost. The second is a repo-wide control
change and the first is the better answer; both are somebody's decision, not a drive-by.

**It has never failed on CI**, which is why it went unnoticed — the hosted runner's
timing differs. Re-check with the three commands above rather than assuming.

---

## 7 September 2026 — an index cannot be used under RLS if its operator is not LEAKPROOF

This one cost a year of a sequential scan on the doctor search, and nothing in the plan
output says why. **If you add an index for a text search on a table with RLS policies, it
will not be used, and you will not be told.**

Postgres will not evaluate a **non-leakproof** qual before a **security qual**, because an
operator that can raise or time differently would leak the contents of rows the policy is
hiding. A qual that cannot be evaluated first cannot become an index condition. So on any
RLS-protected table:

```sql
select proname, proleakproof from pg_proc where proname in ('texteq','textlike','texticlike');
 texteq     | t     -- = uses the index
 textlike   | f     -- LIKE  does NOT
 texticlike | f     -- ILIKE does NOT
```

Measured on `public.doctors` at 99,968 rows, same role, same column, same index:

| predicate | plan | time |
| --- | --- | ---: |
| `full_name ilike '%…%'` as `authenticated` | Seq Scan, 201,488 buffers | 2,205.952 ms |
| `full_name = '…'` as `authenticated` | Bitmap Index Scan on `doctors_full_name_trgm_idx` | 0.396 ms |
| `full_name ilike '%…%'` as `postgres` (BYPASSRLS) | Bitmap Index Scan on the same index | 0.279 ms |

**How to notice.** `explain (analyze)` as the real role, never as `postgres` — the whole
effect disappears for a role with `BYPASSRLS`, which `postgres` has here
(`select rolbypassrls from pg_roles where rolname = current_user` → `t`). A plan taken as
`postgres` is not a plan of what your users run.

**The fix is `security definer` with the scope applied in the body**, which is what
`20260907000800_search_doctors_sargable.sql` does. `alter function texticlike leakproof` is
not available (superuser-only; this project's `postgres` is `rolsuper = f`) and would be
the wrong trade anyway — global, to buy speed in one function.

### Two traps that travel with it

**`OR` with one non-indexable branch scans everything.** The first version of that fix was
`security definer` with the RLS predicate transcribed verbatim, `or is_admin()` included,
and it still seq-scanned at 2,310 ms. `is_admin()` does not depend on the row, so it does
not belong in the row predicate — resolve the scope to a `uuid[]` first and the predicate
becomes a plain `territory_id = any(...)`, which the planner can use.

**A parameter test in a predicate is fine until the plan goes generic.** `p_query is null
or … ilike …` uses the index under a custom plan and seq-scans under a generic one, and a
cached plan becomes generic after five executions:

```sql
set plan_cache_mode = force_generic_plan;   -- with the null branch: Seq Scan
                                            -- without it: Bitmap Index Scan
```

A query that is fast five times and slow for ever after is the worst shape this can take,
because the first person to measure it sees the fast number. Branch in plpgsql instead.

### And the fixture trap that hid it twice

The synthetic seed names every doctor `SYNTHETIC Doctor SYN-…`, so searching for `'Doctor'`
matches **100% of rows**. No index can help a predicate true for every row, so a
measurement using that query cannot distinguish a broken plan from a query with nothing to
optimise. Derive a selective query from the fixture — `substring(full_name from 18)` off
one row — rather than typing a word that happens to be in every name.

---

## 8 September 2026 — `runner_id: 0` means nothing ran. Do not debug the workflow.

Between 21 and 23 August every workflow in this repository failed, hourly, for 34 hours,
and the project auto-paused as a consequence. **Diagnosing it took a session; it should
take two minutes.** This is the entry that makes that true.

**The signature.** A job that fails in ~3 seconds with `runner_id: 0`, an empty
`runner_name`, and `steps: []`, on a run whose `conclusion` is `failure` (not
`startup_failure`), **across more than one workflow at the same moment**.

```bash
# The one query that identifies it. If runner_id is 0 and steps is 0, nothing executed.
gh api repos/OWNER/REPO/actions/runs/<RUN_ID>/jobs \
  --jq '.jobs[] | {name, conclusion, runner_id, runner_name, steps: (.steps|length),
                   started: .started_at, completed: .completed_at}'
```

A healthy job for comparison, from the last success before the August break:

```
runner_id 1000000703 | runner_name 'GitHub Actions 1000000703' | steps 12 | 23s
```

and the failures, on three different workflows:

```
runner_id 0 | runner_name '' | steps 0 | 3s      Audio retention,          21 Aug 22:11
runner_id 0 | runner_name '' | steps 0 | 2s      CI (both jobs),           23 Aug 08:44
```

**`gh run view --log-failed` returns `log not found`, and that is confirmation rather than
an obstacle.** There is no log because there was no run. Anyone who reads "log not found"
as "the logs expired" will go looking for a code defect that does not exist.

**Is it repo-wide?** This is the discriminator between an infrastructure problem and a
broken workflow. One query:

```bash
gh api "repos/OWNER/REPO/actions/runs?per_page=100&created=YYYY-MM-DD..YYYY-MM-DD" \
  --jq '[.workflow_runs[] | {name, event, conclusion}] | group_by(.name)
        | map({workflow: .[0].name, n: length,
               fail: (map(select(.conclusion=="failure")) | length)})'
```

In August that returned failures on `Audio retention`, `Audio retention watchdog` **and**
`CI` on a push, with a single clean transition and no successes afterwards:

```
TRANSITION success -> failure at 2026-08-21T22:11:01Z
runs after: 65   successes after: 0
```

Three unrelated workflows failing at the same instant is not three bugs.

**What it is not, for this repository.** The obvious cause is Actions minutes or a spending
limit — and **it cannot be that here**, because Actions minutes on standard hosted runners
are free and unmetered for **public** repositories, and this one has been public since the
day it was created:

```bash
$ gh api repos/OWNER/REPO --jq '{private, visibility}'
{"private": false, "visibility": "public"}

$ gh api repos/OWNER/REPO/events --jq '[.[] | select(.type=="PublicEvent") | .created_at]'
["2026-08-06T06:18:53Z"]     # same instant as created_at: public from birth
```

Check both of those before reaching for the billing explanation. **UNVERIFIED: what the
August cause actually was.** The remaining candidates — Actions temporarily disabled at the
org level, an account restriction, or a platform incident — all need the org audit log,
which needs `admin:org` and returns 404 to this token.

**What to do when it recurs.** Do not edit a workflow, do not disable one, and do not
change the retention code. Check the three things above, then look at the org's Actions
settings and githubstatus.com. And **write down that you disabled something and why** — the
August disable had a perfectly good reason (34 hours of red builds) that nobody recorded,
which is how `handoff.md` came to say "this was not a response to a failure" for a month.

---

## 8 September 2026 — a search shaped like the answer you expect cannot find the answer you do not

Two of this project's findings were delayed by a search that could only confirm. They are
different tools and the same mistake, so they belong beside each other.

**Worked example 1 — grepping for `sendOrQueue` to find writes that bypass `sendOrQueue`.**

MR-01 asked which screen writes go through the outbox. The search was:

```bash
grep -rn "sendOrQueue" apps/field/app apps/field/src --include=*.tsx
```

It returned three call sites, and the answer reported was *"exactly three writes from
screens"*. **There are six.** The three it missed — `createCallReport`, `createRecording`,
`createVoiceNote` — are bare `createClientForScenario().create…()` calls, and they were
missed **by construction**: a search for the mechanism can only find code that uses the
mechanism. The question was "what bypasses this?" and the query was "what uses this?".

The search that answers it looks for the thing itself, not for the wrapper:

```bash
grep -rnoE "\.(create|update|delete)[A-Za-z]+\(" apps/field/app --include=*.tsx
```

**Worked example 2 — testing an index as `postgres`, with `enable_seqscan = off`.**

A test called *"uses the trigram index rather than a sequential scan"* ran green from BE-W3
to FIX-10 while `search_doctors` seq-scanned every row on every call, 2,190 ms over 99,968
doctors. It ran a **bare table query**, as **`postgres`** (which holds `BYPASSRLS`), with
**`enable_seqscan = off`** — three departures from the thing it named, each of which
independently hides the defect. Every one of them made the index *more* likely to be chosen.
It could only ever confirm.

### The rule

**Ask what result would disprove the claim, and make sure the query can produce it.**

- A search for a mechanism finds users of the mechanism, never bypassers. To find bypassers,
  search for the underlying operation.
- A test that removes the obstacle — a different role, a disabled planner option, a
  permissive setting — is testing a world the code does not run in.
- Every guard needs a **positive control**: something that must fail. A green result from a
  query that cannot go red is not evidence.

Both examples were eventually caught the same way — by asking *what would this look like if
it were false*, and finding the query could not tell.

---

## 8 September 2026 — relaxing a constraint to accommodate an invalid write legitimises the write

**Worked example.** `apps/field`'s recording screen posts `sizeBytes: 1`. It is not a
measurement: the file's real size is not known on that screen, and
`CreateRecordingRequestSchema` declares `sizeBytes: z.number().int().positive()`, so `1` is
the smallest value that satisfies the shape. The comment beside it says as much — *"Real
bytes arrive with the upload, which is BE-W7 and has no client here."*

The obvious remedy is to make the field nullable. **It is the wrong one**, and the reason
generalises:

> Making the field nullable would not make the write correct. It would make the fabricated
> row **valid**.

The row would then pass every schema check, sit in the database indistinguishable from a
real one, and be counted by anything that counts recordings — while still describing an
upload that never happened. The constraint was not the problem; it was the only thing
saying so.

**The actual finding, once the constraint is left alone:** the write should not happen yet.
`apply_sync_item` refuses a recording item with no `uploadGrantId`, and
`CreateRecordingRequestSchema` has no such field — so this write cannot succeed against the
real server at all, and the fabricated value exists only because the mock accepts it.

### The rule

**When a value is invented to satisfy a constraint, the constraint is reporting a real
problem. Fix the write or postpone it; do not widen the type.**

Three signs you are about to do this:

- A literal appears in a payload with a comment explaining why it is not real.
- A field is made nullable, or a check loosened, and no caller starts supplying a better
  value in the same change.
- The justification is about the schema — *"the contract needs a positive integer"* —
  rather than about the thing being recorded.

The same shape has appeared here twice more, and it is worth seeing them together:
`flushOutbox` stamping `receivedAt: nowIso()` so that a field documented as the server's
clock has *something* in it, and `capture_consent`'s displayed-language once coming from
the client payload so the column could be filled. In each case a value was manufactured to
satisfy a shape, and in each case the honest fix was to change what the code does rather
than what the shape allows.
