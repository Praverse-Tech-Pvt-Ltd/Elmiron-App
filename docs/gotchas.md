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
