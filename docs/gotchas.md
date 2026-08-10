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
