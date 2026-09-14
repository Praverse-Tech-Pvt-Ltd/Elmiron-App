# Handover

**Read this first, every session.** Then `constraints.md`. Then the code.

**Untracked, and that is the only reason this file is allowed to exist.** BE-W6
decided this project has no handoff document *in git*, because a point-in-time
snapshot goes stale within hours and the next person trusts it anyway — which had
already happened once, when a committed handoff described work as untracked that had
been pushed days earlier. The durable, tracked record is `PROJECT-OVERVIEW.md` and
`docs/gotchas.md`. **If anything here disagrees with those, they are right.**

The root `handoff.md` was rewritten on 17 Aug and is current, but it is a summary.
**This file is the fuller one** — where the two overlap, they agree; where they
differ in depth, read this.

---

## Current state

**Done:** weeks 1–7 of 12, **and the schema is now deployed to production.**
Boundary proven (Gate 0 passed), field capture server-enforced, offline queue
conflict-free, manager surface exception-first, audio that consent does not cover
structurally impossible to hold, and the 90-day retention promise enforced by
scheduled workflows rather than by a script somebody has to remember to run.

Seventeen migrations, 312 database tests, 21 core, 40 mock. All green locally on
17 Aug from a fresh `db:reset`, with `verify:rollbacks` green as well.

**Production (`pgfdbzoapmleqtoezhoa`, ap-south-1):** all 17 migrations applied and
independently verified on the remote — 34 tables, RLS enabled *and* forced on every
one, 41 policies, 6 views all `security_invoker`, private `audio` bucket with its 3
`storage.objects` policies, `llm_gateway` with no grant on the sensitive tables.
The custom access token hook is **enabled and proven by a real sign-in**.

**In progress:** nothing half-finished in code. The deployment is partway: schema and
auth hook are done, **the three GitHub secrets are not set** and nothing is seeded.

**Broken / known issues:**

- Nothing failing. The suite was run 15 consecutive times from a fresh
  `db:reset` with zero failures after two pre-existing cross-file races were fixed.
- The two scheduled workflows **fail every day until the three secrets exist**.
  `gh secret list` was still empty at the end of 17 Aug. Keep the schedules live and
  red — the daily failure is the reminder — but note the situation has changed:
  **the reason to delay setting them is gone.** `db push` has run, so the function a
  worker would call now exists. Setting the secrets is the next action, not a
  premature one. See `decisions.md` → 17 August, which records the decision and the
  fact that it expired the same day.
- **No scheduled run has ever fired.** Every run in the history is `event: push`.
  The predicted daily failure is still a prediction, not an observation.

**Avoid:** (things that look like a good idea and are not)

- **Adding a second upload mechanism, or a second dead-letter mechanism.** Uploads
  are ordinary sync items on purpose; they inherit attempt counting, dead-lettering
  and reinstatement unchanged.
- **Making the reconciliation destroy things by default.** It is dry-run unless
  `--apply`, and a tool that destroys audio the first time somebody runs it to see
  what it does is not a compliance tool.
- **"Simplifying" `assert_upload_still_permitted` by checking session state first.**
  The consent check is deliberately first; reordering it tells an MR their recording
  was malformed when the doctor withdrew.
- **Trusting a green suite as proof a guard works.** Break the guard and confirm
  something goes red. That has caught a hollow *test* twice now, not just a hollow
  guard.
- **`pg_cron` for the purge**, without re-reading the reasoning in
  `PROJECT-OVERVIEW.md` → BE-W7 §1. It is available and it was rejected for
  substantive reasons, not availability.

---

## Session 16 August 2026 — BE-W7

- **Did:** upload path, purge scheduling and adverse-event ingest — the full BE-W7
  prompt. Five migrations, five rollbacks, three new spec files (83 tests), two
  scheduled workflows, three new scripts, `docs/restore-runbook.md`. Closed all five
  BE-W6 open items. All 12 mutations killed. Static checks and the full suite green;
  `verify:rollbacks` green.
- **Left:** nothing outstanding in the repo. `main` and `origin/main` are level at
  **`8cbd362`** (38 files, +8018/−60); working tree clean. The stale root
  `handoff.md` was deleted, its three unique facts moved to `constraints.md`.
  _(Superseded: `b49e588` landed after this was written — see the entry below.)_
  - **Both new workflows are live and will start firing on their cron.** They will
    fail until three **repository secrets** exist. As of the last check
    `gh secret list` was **empty**.
  - **`.env` is not the mechanism.** It is git-ignored, it is not on the remote, and
    nothing loads it into `process.env` (no `dotenv`; verified with a bare `node -e`).
    GitHub reads `${{ secrets.X }}` from its own encrypted store.
  - **Do not copy `.env` across verbatim.** Two of the three values are wrong for a
    runner: `SUPABASE_URL` is `127.0.0.1` (unreachable from GitHub), and
    `SUPABASE_SERVICE_ROLE_KEY` does not exist there at all — the file calls it
    `SUPABASE_SECRET_KEY`. Since `SUPABASE_DB_URL` **is** production, copying as-is
    would claim rows in the live database and then fail to delete their objects.
  - **The direct DB URL will probably not work from Actions.** `.env` holds
    `db.<ref>.supabase.co:5432`, a direct connection. Supabase made those IPv6-only
    and GitHub-hosted runners are IPv4-only, so this fails as a *network* error that
    reads like a bad credential. Use the **session pooler** string (port 5432, not
    the 6543 transaction pooler — the worker holds `for update skip locked` across
    statements). _Verify against the dashboard; not confirmed from here._
  - The `workflow`-scope push trap did not bite; `gh auth setup-git` is evidently
    already in place on this machine.

### HAZARD: a production DB URL sits in the repo root

**Corrected 17 Aug — this warning named the wrong variable.** `SUPABASE_DB_URL` in
`.env` is **malformed and cannot connect**: no `postgresql://` scheme, no password, no
`/postgres` database path, and a leading space. Exporting *that* value fails
harmlessly. Do not read this as the hazard being over.

**Three other variables in the same file are complete, credentialed and pointed at
production:** `SUPABASE_POOLER_SESSION_URL`, `SUPABASE_POOLER_TRANSACTION_URL` and
`SUPABASE_REMOTE_URL`. Any one of them substituted below does the damage. Sanitising
`SUPABASE_DB_URL` alone and feeling safe is the trap this correction exists to close.

`.env` sits in the same directory as `verify:rollbacks`, whose job is to drop the
entire public schema. The safety is on — nothing auto-loads that file, re-verified
today by the suite running green against localhost with a malformed
`SUPABASE_DB_URL` present — but

```powershell
$env:SUPABASE_DB_URL = "<the production value>"
pnpm --filter @elmiron/api verify:rollbacks     # destroys production
```

is two lines away at any time. Never export any of them in a shell where the api
scripts run. When you must run `verify:rollbacks`, pass the localhost URL explicitly
on the command line rather than relying on the variable being unset.

### `.env` inventory, checked 17 Aug (names and shapes only, no values read out)

The three the retention workflows need **are all present, under different names**:

**Rewritten 17 Aug after the `.env` clean-up. This supersedes anything above about
malformed values or `SUPABASE_REMOTE_URL`, which no longer exists.**

| Workflow secret | Take it from | Note |
| --- | --- | --- |
| `SUPABASE_DB_URL` | **`SUPABASE_POOLER_SESSION_URL`** | Session pooler, port 5432, `ap-south-1`. **Not** the `SUPABASE_DB_URL` in `.env` — that is deliberately localhost. **Not** `SUPABASE_POOLER_TRANSACTION_URL` (6543, recycles the connection and would drop a `for update skip locked` claim). **Not** `SUPABASE_REMOTE_DB_URL` (direct `db.<ref>`, IPv6-only, fails from runners). |
| `SUPABASE_URL` | `SUPABASE_URL` | `https://<ref>.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **`SUPABASE_SECRET_KEY`** | Name differs. |

All four remaining `.env` connection strings were tested and connect. Every password
is percent-encoded — they did not work before that, and the failure gives you
`TypeError: Invalid URL` with the value redacted. See `docs/gotchas.md`.

`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are both set, so `supabase link`
and `db push` have what they need.

**Both remote strings were tested read-only on 17 Aug. Three results:**

1. **They do not work as stored.** The password contains `?`, which begins a query
   string, so the URL is invalid and `pg` rejects it before any network call —
   with the value redacted, so nothing indicates which character is at fault.
   Percent-encode the password before pasting either into a GitHub secret.
   Both connected immediately once encoded. Full note in `docs/gotchas.md`.
2. ~~**The remote database is empty**, `db push` has never run.~~
   **NO LONGER TRUE — the schema was deployed later the same day.** See the
   deployment entry below.
3. The direct `db.<ref>` string **does** work from this machine, so it has IPv6.
   That is consistent with the documented claim that it fails from IPv4-only
   runners, and is the reason the pooler string is the one CI needs.

Result (3) is why the retention secrets should stay unset: pointing a worker at an
empty database gets a missing-function error, not a working purge.

Gaps, none of them urgent while there is no app:

- **The four `APP_*` variables are absent** — `APP_JWT_AUDIENCE`, `APP_SITE_URL`,
  `APP_ADDITIONAL_REDIRECT_URLS`, `APP_DEEP_LINK_SCHEME`. `loadAppConfig()` in
  `packages/core/src/shared/config.ts` **throws** on any missing one. Nothing calls it
  yet, so this is inert — Frontend hits it the moment they wire config.
- `SUPABASE_REMOTE_DB_URL` is present but **empty**; `SUPABASE_REGION` and `MOCK_PORT`
  are absent. All three have safe fallbacks or are documentation only.
- **`.env.example` has drifted.** Four keys exist in `.env` and are undocumented:
  `SUPABASE_JWKS_URL`, `SUPABASE_REMOTE_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_KEY`. `.env.example` is the tracked contract a new developer
  copies, so anything only in `.env` is invisible to them.
- **Watch out:**
  - **The suite shares one database and one bucket across ten parallel workers.** Two
    latent races became ~1-in-10 failures when this week added three spec files. Both
    are fixed, but the *pattern* will recur: any test that reads a global count, or
    competes for a shared catalogue row, or asserts after exactly one `runPurge`, is
    a race waiting for the eleventh spec file. See `docs/gotchas.md` → "Spec files run
    in parallel".
  - **A claimed-but-unconfirmed purge object is invisible for 15 minutes.** If a
    worker dies between claim and confirm, nothing recovers it until the claim goes
    stale. Correct by design, and long enough to look like a bug in a test.
  - **`begin_upload` now refuses new audio when the purge stalls.** If uploads start
    failing with "the audio retention worker has stopped", the retention worker is
    the thing to look at, not the upload path.
  - Migration numbering is `20260816000100`–`000500`. The `000100` file exists solely
    because `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it.

---

## Session 17 August 2026 — verification only, no code

Resumed a stale session whose context ended at BE-W6. Wrote nothing except this
entry; the value was in checking claims rather than adding to them.

- **Did:** verified the four things the previous entry asserts or predicts.
  - `main` and `origin/main` are level at **`b49e588`**, one commit past the
    `8cbd362` recorded above. Working tree clean.
  - **CI is genuinely green on BE-W7**, not just locally: runs on `8cbd362` and
    `b49e588` both `success` (`gh run list`). The 07:04/07:29 UTC run times are the
    12:31/12:58 IST commits — same events, two clocks.
  - **`gh secret list` is still empty.** Zero repository secrets. `gh` works
    (v2.97.0, exit 0), so this is an absence and not a tooling failure. **The top
    open item is unchanged.**
  - **No scheduled run has ever fired.** Every workflow run in the history is
    `event: push`, all of them CI. `retention.yml` and `retention-watchdog.yml` have
    not yet hit their cron, so the predicted daily failure is still a prediction.
- **Left:** everything above. Nothing was changed.
- **Watch out:**
  - **The first cron fire is the real test of the secrets story**, and it has not
    happened yet. When it does, the failure should name a missing secret. If it names
    something else — a network error that reads like a bad credential — that is the
    IPv6 direct-connection trap already described above, not a wrong key.
  - ~~Docker Desktop is down, so the database tests report *skipped*.~~
    **Resolved in-session: Docker was started and everything was re-verified from a
    fresh `db:reset`.** 17 migrations applied from empty; `build` 3/3, `typecheck`
    8/8, `lint` 6/6, `format:check` clean; **core 21, mock 40, api 312 passed
    (10 files)** — matching the BE-W7 numbers exactly. `verify:rollbacks` reversed
    all 17 and left the public schema empty; database restored afterwards.
  - **`verify:rollbacks` was run with `SUPABASE_DB_URL` pinned to `127.0.0.1` on the
    command line**, after confirming the variable was unset in the shell. Do the
    same. The HAZARD above is not theoretical — that script drops the whole public
    schema and takes its target from the environment.
  - The session headings in this file use the **project calendar** (week 7 = 16
    August) while commits carry **real dates** (11 August). Both BE-W6 and BE-W7 show
    the same five-day offset. Do not try to reconcile them; they are different clocks.

---

## Session 17 August 2026 (later) — production deploy

- **Did:** `supabase db push --db-url <direct> --yes`. **All 17 migrations applied to
  `pgfdbzoapmleqtoezhoa`.** Dry-run first, then the real push; verified on the remote
  afterwards rather than trusting the CLI's success line.
  - 34 tables, RLS enabled **and forced** on every one; 41 policies; 6 views, all
    `security_invoker`.
  - `llm_gateway` exists with **no grant** on `transcripts_raw`, `recordings`,
    `voice_notes` or `consent_records`, and `select` on `transcripts_redacted`.
  - Private `audio` bucket with **3 policies on `storage.objects`** — this was the
    doubtful one, since `storage.objects` is owned by `supabase_storage_admin` and
    hosted Supabase does not always let migrations touch it. It worked.
  - 9 `app_thresholds` rows seeded; `org_default_shift_window` is null, so capture
    refuses rather than falling back.
  - No `TRUNCATE` granted to `anon` or `authenticated`.
- **Also did:** consolidated the four `.env` connection strings. Every password is
  percent-encoded; `SUPABASE_REMOTE_URL` deleted as a duplicate;
  **`SUPABASE_DB_URL` pinned to localhost** with a comment saying why.
- **Left:**
  1. **Enable the custom access token hook** — Dashboard → Authentication → Hooks.
     `config.toml` does not carry over. It affects `current_app_role()` only, which is
     display; authorization goes through `effective_role()` against `user_profiles`,
     so the boundary is not waiting on this.
  2. **The three GitHub secrets can now be set** — the precondition that blocked them
     is gone. Order note is in `.env.example`. Take the `SUPABASE_DB_URL` *secret*
     from `SUPABASE_POOLER_SESSION_URL`, not from the now-localhost `SUPABASE_DB_URL`.
  3. Expect the **watchdog to fail on its first run even after the secrets are set**,
     because `audio_purge_health()` has no successful run to report yet. Dispatch
     `Audio retention` once manually first, then the watchdog goes green.
- **Watch out:**
  - **The `.env` hazard is now live.** Before today the production database was empty,
    so a mistaken `verify:rollbacks` would have dropped nothing. It would now drop 34
    tables. `SUPABASE_DB_URL` is localhost precisely so the default target is safe —
    do not repoint it.
  - Nothing was seeded. There are no users, territories, doctors or consent-text rows
    on the remote, so the app cannot function there yet even though the schema is
    complete. Territory shift windows in particular are absent, which means capture
    would refuse — correctly.

---

## Session 17 August 2026 (third) — auth hook, and the `.env` clean-up

- **Did:**
  - **Enabled the custom access token hook on production**, through the Management
    API (`PATCH /v1/projects/<ref>/config/auth`) rather than the dashboard, so it is
    reproducible rather than a click somebody remembers. Preflighted the grants first,
    then proved it with a real sign-in: throwaway user created, signed in, token
    issued, user deleted. `app_role` correctly absent for a user with no profile.
  - Consolidated `.env` to one name per credential, every password percent-encoded.
  - `.env.example` and `docs/gotchas.md` updated and pushed.
- **Left:** the three GitHub secrets, and seeding. Nothing half-done.
- **Watch out:**
  - **A hook that raises breaks every sign-in**, and the config endpoint returning
    `true` tells you nothing about that. If auth ever starts failing globally, disable
    `hook_custom_access_token_enabled` first and diagnose second.
  - **Do not create org/territory/profile rows on production just to test.**
    `audit_log` is append-only by design, so those rows are permanent pollution in a
    compliance log. The throwaway auth user was safe because it never got a profile.
  - **The `.env` hazard is now real.** Before the deploy, a mistaken
    `verify:rollbacks` would have dropped nothing. It would now drop 34 tables.
    `SUPABASE_DB_URL` is pinned to localhost with a comment saying why — leave it.

---

## Chases that are not engineering tasks

Drafts for the first two are in `docs/escalations-week3.md`.

1. **PV and privacy sign-off** — outstanding since week 1, and it now blocks more than
   it did. The specific question to put in front of them: **may
   `adverse_event_reports.reported_text` contain patient information, and does an
   adverse-event report survive a consent withdrawal?** Both are currently answered by
   my default, not by anybody's decision.
2. **Contract I3 from AI/ML** — five weeks late. Now has a CI deadline of
   **30 September 2026**; the build goes red after that unless `TranscriptV1` exists.
   Still owed: the measured Hinglish word error rate on real audio, and the vendor
   decision that follows.
3. **Supabase / the DPA** — does a deleted storage object survive in S3 versioning, a
   soft-delete window, or a sub-processor's backup? Not answerable from the API. It
   decides whether the 90-day claim is literally true. Needed before the pilot.
4. **Per-territory working hours from the client** — now has a hard deadline, because
   the org-default window expires within 60 days of being configured and capture
   refuses again afterwards.

## MR-29 — 14 September 2026

**The dev-client build, and the device-clock class closed at its source.**

### Decisions taken

- **The device-clock rule is the DECIDING / RECORDING split, not "always use `serverTime`".**
  The reviewer's framing — *"the only legitimate instant is `serverTime`"* — was not
  implemented as written, because applied literally it mints a new defect: an offline
  `captured_at` stamped with the last pull's clock claims the time of the last sync, possibly
  hours earlier, on a compliance record. The repository had already drawn the correct line in
  `src/sync/outbox.ts`, where `receivedAt` was removed for asserting a SERVER fact from the
  device clock while `clientCreatedAt` stayed. Prior art beat the proposal, which is the
  standing rule working.
- **The five real device-clock sites are registered (`FE-W42`), not fixed.** All five need
  `serverTime` AND an answer to what they render when there is none — `FE-W40`'s open
  question. Fixing them first would pre-empt that decision in five places.
- **`BE-W98` — the dead-letter replay's missing figures: DEFER.** `explanation.ts:196` makes
  the action `escalate` for a dead letter whatever the SQLSTATE is, so the figures cannot
  change what anyone does next. Trigger to reverse: a manager-facing dead-letter queue.
- **`FE-W41` + `5.9` are ONE unit of work.** The cap value and the copy must land in the same
  commit or the screen contradicts the server on the day somebody starts relying on it.
- **Part C was not started.** Sized, not skipped — four packages and the store every screen
  reads. Recorded in `PROJECT-OVERVIEW.md` under "C — NOT RUN".

### Premises from the brief that the repository contradicted

Three, all checked rather than argued:

1. **JDK 25 / `JAVA_HOME`** — unset; `java` is 17.0.12; this file's own sibling
   (`frontend-status.md:100`) had recorded it resolved on 27 August.
2. **`cmake;3.31.6` required** — not under RN 0.86.2; 3.22.1 built it.
3. **`react-native-background-geolocation` blocks the gates** — it is not a dependency at all.
   Background location is unwritten, so no build unblocks it.

The reviewer states plainly that they have not read the repository and that the code
supersedes them. Acting on that is what this section is.

### Method note

Every defect this session came from the same two moves: **pressing the button** (the
microphone remedy, and the defect-12 re-confirmation), and **running a control in both
branches rather than one** (`FE-W43` — the identical import raised 2 errors in `src/` and 0
in a screen). The second is MR-28's defect 12 restated one layer down: a guard wired into one
branch of a two-branch path protects the branch nobody exercises.

## MR-30 — 14 September 2026

**`FE-W40` built on its own, as MR-29's stop intended.**

### Decisions taken

- **`FE-W40`: option D, on engineering's recommendation, with no product-owner answer.** Stated
  rather than assumed. The reason it is safe to proceed without one: **D is the only option
  whose parameter is derived rather than chosen** — the bound is the territory day boundary,
  which `territory-day.ts` already computed. A and C were live alternatives; B is refused twice
  over (MR-15 A2, and a lint failure since MR-29 A3).
- **`dayOrigin` is a new field, not a widening of `today`.** `today` keeps its exact meaning —
  the territory date from the server's clock — so every screen but `home.tsx` was untouched. An
  anchored day *is* the server's clock, merely older. This was the API decision the MR-29 stop
  existed to protect, and it is the one worth arguing with if anyone disagrees.
- **The zone is persisted with the anchor**, and a `UTC_FALLBACK` no longer overwrites a
  restored territory zone. `fetchTerritoryZone` never throws, so "declined to say" and "is UTC"
  had been the same value.
- **`BE-W92` and `BE-W99` merged**, with `BE-W92`'s own FK hypothesis refuted by measurement.
- **Part C re-confirmed rather than re-litigated.** Two entries on one decision is exactly the
  divergence A4 spent the session undoing, so the MR-29 Part D verdicts were referenced, not
  duplicated.

### Premises from the brief that the repository contradicted — second session running

Three last time, and this time the brief's own framing of A3 understated the problem: the stale
JDK claim was in **six** places, not three. The reviewer states plainly that they have not read
the repository and that the code supersedes them; the grep is what makes that workable, and it
is now a rule.

### Method note

The two strongest pieces of evidence this session were both refusals to reason:

1. **A5** enumerated the *loaded* ESLint config and then exercised three shapes in three glob
   regions. Reading the source would have found two plausible-looking blocks and no problem.
2. **A4** resolved OIDs out of the server log instead of arguing from the schema — and the
   answer contradicted a hypothesis that had stood, unchallenged and clearly labelled as
   unmeasured, for four sessions.

## MR-31 — 14 September 2026

**`FE-W42` closed, and the sentinel class catalogued.**

### Decisions taken

- **The sentinel class is two sub-forms, not one**, and the brief's framing of `UTC_FALLBACK`
  was corrected rather than repeated: the discriminant existed and no caller read it. The
  diagnostic is **"count the call sites that read it"**, not "is the absence representable".
- **The reducer's throw on a null `rejectionCode` was removed** — a deliberate, tested decision
  with no entry in this file behind it. Kept its *intent* (an unexplained failure must not be
  dressed as an explained one) and moved it to `presentRejection`: no remedy, and escalate. The
  throw abandoned the rest of the flush, left the item un-`failed` so it retried forever, and
  was unreachable because `outbox.ts` coalesced before it.
- **`buildDoctorRows`/`buildDoctorProfile` take `now: number | null`.** No default, because
  every candidate default renders an age that looks measured.
- **`overdue` keys on `lastSeenAt`, not on `daysSince`** — "never visited" is knowable with no
  clock; "seen 40 days ago" is not.
- **C1 answered: DEFER** (`BE-W98`), trigger named.
- **No mechanism proposed for `BE-W92`**, per D2, despite having a sharper measurement.

### The method note worth keeping

Two of this session's defects were in this session's own work, and the diff showed neither.

1. **Read what the function you are newly able to pass `null` to actually returns.**
   `lastSeenLabel(null)` is "never visited" — a correct function, a new caller, a false
   sentence.
2. **Mutate even the guards you are confident in.** `record.code === null || …` was inert and
   the code was still correct, so no test could fail and no review would catch it. Only the
   mutation did, and the fix was to restate it so the *type* enforces the check.

And one on evidence: when the device did not reflect a database edit, the answer was not "the
screen is wrong" — it was that the edit hit another tenant and RLS kept it out. Reading the
device's own storage settled it in one command. Guessing would have gone the other way and
"fixed" a screen that was already right.
