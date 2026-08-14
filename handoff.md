# Project Handoff

**Written:** 17 August 2026 · **Head:** `0086d15`, pushed, `main` level with `origin/main`
**Phase:** weeks 1–7 of 12 built. Schema and auth deployed to production. BE-W8 not started.

> **Untracked on purpose.** `.gitignore` line 34 ignores `handoff.md`, and BE-W6
> decided this project keeps no handoff *in git* — a snapshot goes stale within hours
> and the next person trusts it anyway, which has already happened once here. The
> tracked records are `PROJECT-OVERVIEW.md` and `docs/gotchas.md`. **If this file
> disagrees with those, they are right.**
>
> Fuller working notes live in `.ai-collab/` (also untracked): `handover.md`,
> `constraints.md`, `decisions.md`, `flow.md`, `test-checklist.md`, `bug-log.md`.

---

## 1. Goal

Backend for a pharmaceutical field-force mobile app used by medical representatives in
India. 12-week build, pilot at 100 MRs. Backend owns the monorepo, CI, Supabase, auth,
RBAC, audit, consent, all APIs, offline sync, audio storage and lifecycle, pipeline
orchestration and adverse-event routing.

Constraints that hold throughout:

- **Three roles only:** `mr`, `field_manager`, `admin`.
- **Zero patient or clinical data.** Separate app, separate database.
- **Data residency:** `pgfdbzoapmleqtoezhoa`, `ap-south-1` (Mumbai).
- **Android-only, permanently.** iOS dropped; the Apple/D-U-N-S dependency is withdrawn.
- **Row-level security is the enforcement layer**, never application code.
- CI must **fail** the build, not warn.

Two standing principles that govern new work:

1. **RLS decides which rows a caller may write; never what the values must be.** A
   write with a validity rule beyond "is this row mine" goes behind an RPC, and the
   direct table path is *withdrawn*, not merely unused.
2. **Immutability is a trigger plus a revoked grant, not an absent policy.** `postgres`
   and `service_role` both hold `BYPASSRLS`, so RLS is never evaluated for them.

---

## 2. Current State

### Verified working, 17 August, on this machine

```
pnpm run build          Tasks: 3 successful, 3 total
pnpm run typecheck      Tasks: 8 successful, 8 total
pnpm run lint           Tasks: 6 successful, 6 total
pnpm run format:check   All matched files use Prettier code style!

@elmiron/core    21 passed (21)
@elmiron/mock    40 passed (40)
@elmiron/api    312 passed (312), 10 files   <- with Docker up
verify:rollbacks  all 17 reversed, public schema empty, database restored
```

17 migrations apply from empty and reverse in order.

### Production — deployed and independently verified

All 17 migrations applied to `pgfdbzoapmleqtoezhoa`. Checked **on the remote** rather
than trusting the CLI's success line:

| Check | Result |
| --- | --- |
| migrations recorded | 17 |
| public tables | 34 |
| policies | 41 |
| views | 6, all `security_invoker` |
| tables without RLS enabled **and** forced | none |
| `llm_gateway` grants on raw transcripts / recordings / voice notes / consent | none |
| `llm_gateway` on `transcripts_redacted` | present |
| `audio` bucket | exists, private, 3 `storage.objects` policies |
| `app_thresholds` seeded | 9 rows |
| `org_default_shift_window` | null — capture refuses, as intended |
| `TRUNCATE` granted to `anon` / `authenticated` | none |

The **custom access token hook is enabled**, set via the Management API and proven by
a real sign-in (throwaway user created, signed in, token issued, user deleted).

### Incomplete

- **The three GitHub secrets do not exist.** `gh secret list` is empty. Nothing
  enforces the 90-day retention promise on production.
- **Nothing is seeded on production.** No organisations, territories, doctors,
  consent-text versions or shift windows — so capture would refuse there today.
  Correctly, and loudly.
- **No scheduled workflow run has ever fired.** Every run in the history is
  `event: push`. The predicted daily failure is a prediction, not an observation.
- No adverse-event detection beyond ingest, no LLM calls, no analysis, no UI.

### Environment assumptions

- Node 24, pnpm 11, Docker Desktop running. Native Windows, not WSL.
- Supabase CLI is a dev dependency: `supabase --workdir services/api`.
- Supabase **analytics is disabled** in `config.toml` — the `vector` shipper
  crash-loops on Windows. Studio's Logs pane is empty; use `docker logs`.
- **Nothing loads `.env` into `process.env`.** No `dotenv` anywhere. That is the only
  reason a production credential can sit in that file at all.

### Unverified

- **Whether Supabase retains a "destroyed" storage object** in backups, object
  versioning or a soft-delete window. The purge deletes via the storage API and the
  object 404s afterwards — that is verified. Platform retention is not, and it decides
  whether the 90-day claim is literally true.
- Behaviour at volume: purge batch limit is 100; `sync_push` takes 500 items in one
  transaction. Neither has been run against a real backlog.
- The suite shares one database and one bucket across ten parallel workers. Two latent
  races were fixed in BE-W7; the *pattern* recurs with each new spec file.

---

## 3. Active Files

| File | Status | Purpose |
| --- | --- | --- |
| `PROJECT-OVERVIEW.md` | Modified, pushed | The durable record. **Append a `### BE-W8` section; never overwrite an earlier one.** |
| `docs/gotchas.md` | Modified, pushed | Cumulative platform failures. Read before debugging anything environmental. |
| `.env.example` | Modified, pushed | Tracked contract. Now carries the `.env` → GitHub-secret name mapping and the deploy ordering. |
| `.env` | Modified, untracked | One name per credential; every password percent-encoded. `SUPABASE_DB_URL` pinned to localhost. |
| `.ai-collab/handover.md` | Modified, untracked | Fuller session-by-session notes. Read first next session. |
| `.ai-collab/decisions.md` | Modified, untracked | Records that the leave-secrets-empty decision **expired the same day**. |
| `.github/workflows/retention.yml` | Reviewed | Purge worker. Fails daily until the secrets exist — deliberately. |
| `.github/workflows/retention-watchdog.yml` | Reviewed | Separate workflow on purpose, so it does not die with what it watches. |
| `services/api/scripts/purge-expired-audio.mjs` | Reviewed | The retention worker. **Still unscheduled against production.** |
| `services/api/supabase/migrations/` | 17 files, deployed | `20260810000100` → `20260816000500`. |
| `services/api/rollbacks/` | 17 files | One per migration, executed by CI. |
| `handoff.md` | Created, untracked | This file. |

---

## 4. Changes Made

### Deployment

- **`supabase db push --db-url <direct> --yes`** — all 17 migrations to production.
  Dry run first. Verified on the remote afterwards (table above). The storage policies
  were the doubtful part, since `storage.objects` is owned by `supabase_storage_admin`
  and hosted Supabase does not always permit it; all three applied.
- **Custom access token hook enabled** via `PATCH /v1/projects/<ref>/config/auth`,
  chosen over the dashboard so the change is reproducible. Preflight confirmed
  `supabase_auth_admin` holds EXECUTE on the function and SELECT on `user_profiles`
  with a matching policy, and that `authenticated` does **not** hold EXECUTE.

### `.env` hygiene

- **Every password percent-encoded.** None of the four connection strings worked
  before this; a `?` in the password makes the URL invalid and `pg` rejects it before
  any network call, with the value redacted so nothing shows which character is wrong.
- **`SUPABASE_REMOTE_URL` deleted** — it duplicated `SUPABASE_REMOTE_DB_URL`. One name
  per credential, so a rotation has one place to change.
- **`SUPABASE_DB_URL` pinned to localhost** with a comment. It is the only variable in
  the file read by code, and `verify:rollbacks` reads it to decide what to drop.

### Tracked documentation

- `.env.example`: the four previously undocumented keys, the secret-name mapping, and
  the warning that `EXPO_PUBLIC_*` is inlined into the shipped bundle — publishable
  key only, never the secret key.
- `docs/gotchas.md`: the `?`-in-password trap, the IPv6 direct-connection confirmation,
  and the two-line query that distinguishes "bad credential" from "empty database".

---

## 5. Failed Attempts

**I overwrote a value based on a stale reading, and reverted it.** Early in the session
`SUPABASE_DB_URL` was a malformed 72-char pooler fragment. By the time I edited the
file it was a complete 88-char direct production URL — it had been changed in between
and I did not re-read before acting. I replaced it with localhost on the strength of
the old reading. Caught when a sanity check contradicted my own earlier finding;
restored byte-identically from a backup, then applied only the encoding fix.
**Lesson: `.env` was being edited concurrently; re-read before each write.**

**`env()` substitution in `supabase/config.toml` does not work and fails silently.**
Tried in BE-W4. The stack started with no error; the container had received the
literal string `env(APP_SITE_URL)`. The CLI resolves `.env` relative to `--workdir`
and there is no `--env-file` flag. **Reverted**; app-level config lives in
`packages/core/src/shared/config.ts` instead.

**Deleting storage rows in a rollback.** `20260815000300…down.sql` originally did
`delete from storage.objects where bucket_id='audio'`. Supabase refuses it — *"this
prevents accidental data loss from orphaned objects"* — and is right to, because the
row delete leaves the file behind. **Reverted**: the rollback drops only the policies
and documents that the bucket must be emptied through the storage API first.

**A probe script that threw outside its own error handling.** `new Client()` parses
the connection string eagerly and throws synchronously, so the `try` around
`connect()` never saw it and one bad URL aborted the whole run. Fixed by moving the
constructor inside the `try`. Worth knowing when writing any similar probe.

**Cross-file memoisation of the DB reachability check** (BE-W1) never worked: vitest
gives each spec file its own module registry, so it runs once per file, not per run.
**Not reverted** — still correct within a file — but the comment states the measured
behaviour.

---

## 6. Next Steps

1. **Set the three GitHub repository secrets.** This is now the correct next action —
   the reason to delay is gone, because `db push` has run and the function a worker
   would call exists on the remote.
   ```bash
   gh secret set SUPABASE_DB_URL            # <- from SUPABASE_POOLER_SESSION_URL
   gh secret set SUPABASE_URL               # <- https://<ref>.supabase.co
   gh secret set SUPABASE_SERVICE_ROLE_KEY  # <- from SUPABASE_SECRET_KEY
   ```
   Not the localhost `SUPABASE_DB_URL`; not the 6543 transaction pooler; not the direct
   `db.<ref>` string. Acceptance: `gh secret list` shows three.
2. **Dispatch `Audio retention` once by hand**, before trusting the watchdog:
   `gh workflow run "Audio retention" && gh run watch`. It should be green and destroy
   nothing. The watchdog will fail on an empty run history until this has happened once
   — that is not a misconfiguration.
3. **Seed production reference data**, or capture keeps refusing: organisations,
   territories, **territory shift windows**, doctors, consent-text versions. Shift
   windows need real per-territory hours from the client (see chase 4 below).
4. **Ask Supabase whether a deleted storage object survives** in backups, versioning or
   a soft-delete window. Not an engineering task; it decides whether the 90-day claim is
   literally true, and it is needed before the pilot.
5. **Chase contract I3 from AI/ML** — five weeks late, and now has a CI deadline of
   **30 September 2026**, after which the build goes red unless `TranscriptV1` exists.
   Still owed: the measured Hinglish word error rate and the vendor decision.
6. **Chase the PV and privacy sign-off** — outstanding since week 1 and now blocking
   more. The two specific questions: may `adverse_event_reports.reported_text` contain
   patient information, and does an adverse-event report survive a consent withdrawal?
   Both are currently answered by a default, not a decision. Draft in
   `docs/escalations-week3.md`.
7. **Then BE-W7's successor prompt.** Append a `### BE-W8` section to
   `PROJECT-OVERVIEW.md`.

### Conventions to keep

- **Mutation-test every new suite** — break each rule deliberately, confirm something
  goes red. It has caught a hollow *test* twice, not just a hollow guard.
- Every migration gets a matching `rollbacks/*.down.sql`; CI executes them.
- Announce any `packages/core` change — Frontend and AI/ML build against it.
- `git commit -F <file>` for multi-line messages on this machine.
- Never export a production URL in a shell where the api scripts run. Pass the
  localhost URL explicitly to `verify:rollbacks`.
