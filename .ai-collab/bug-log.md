# Bug log

One entry per bug: found → tried → worked → verified. Only bugs whose *diagnosis* was
non-obvious go here; a typo caught by typecheck does not.

---

## BE-W7 · A foreign key made every consent withdrawal fail

- **Found:** seven BE-W6 withdrawal tests went red immediately after adding the
  adverse-event migration, all with
  `adverse_event_reports is append-only: UPDATE is not permitted by any role` — a
  table BE-W6 has never heard of.
- **Tried:**
  - Looked for an UPDATE against the table in the cascade. There isn't one.
  - Traced what the withdrawal cascade deletes: `transcripts_redacted`. Then noticed
    `adverse_event_reports.redacted_transcript_id references ... on delete set null`.
- **What worked:** `ON DELETE SET NULL` is implemented as an **UPDATE against the
  referencing table**, which the append-only trigger refuses. `ON DELETE RESTRICT`
  would be worse — it lets an adverse-event report veto a doctor's withdrawal. The
  column is now a plain `uuid` with no FK; the pointer dangles once the transcript is
  destroyed, which is the honest state of affairs.
- **Verified:** the seven tests pass, plus a new one asserting the column has **no**
  referential constraint, so nobody re-adds it.

## BE-W7 · Resumable upload was impossible, and the error pointed at the wrong policy

- **Found:** the second chunk of any upload returned
  `new row violates row-level security policy for table "objects"`, despite an UPDATE
  policy whose predicate demonstrably evaluated true.
- **Tried:**
  - Confirmed the predicate holds by running it directly as `authenticated`. It does.
  - Read the storage container log rather than the HTTP status, and found the actual
    statement: an `INSERT ... ON CONFLICT DO UPDATE ... RETURNING *`.
  - Reproduced it in psql as `authenticated`. A **plain UPDATE reported "0 rows
    affected"** — which reads as success and is why this could have shipped.
- **What worked:** Postgres applies **SELECT policies** to the conflicting row of an
  upsert. BE-W6's `audio_no_public_read` (`using (false)`) made the existing row
  invisible. Replaced with a policy scoped to the caller's own **live, open** upload,
  so a completed recording stays unreadable.
- **Verified:** three tests — own in-flight readable, own landed recording refused,
  another MR's in-flight refused. Mutation 5 opens the policy and kills two of them.

## BE-W7 · The storage-delete idempotency check had never once fired

- **Found:** the reconciliation threw
  `storage delete failed ... 400 {"statusCode":"404", ... "NoSuchKey"}` on an object
  something else had already removed.
- **Tried:** read BE-W6's worker — `if (response.ok || response.status === 404)
  return;`. Correct-looking, and dead code.
- **What worked:** Supabase returns **HTTP 400 with the 404 in the body**, so the
  check never matched. It stayed invisible for a week because nothing reached it:
  `claim_expired_audio` does not re-claim a destroyed row, so the retention worker
  never asks twice. Both workers now share `scripts/storage.mjs`, which parses the
  body.
- **Verified:** a test that deletes a known-absent object over real HTTP and **pins
  the 400/`NoSuchKey` shape**, so a future Supabase version returning a real 404
  breaks the test rather than silently changing what counts as success.

## BE-W7 · A function that worked perfectly and enforced nothing

- **Found:** not by a failure. By asking, at review, whether every function written
  this week is actually **called** by something.
- **Tried:** traced `close_stale_upload_sessions()`. Nothing invoked it.
- **What worked:** a session the MR simply never returns to stays `open` — nobody
  abandons it, the clocks just run out — and `claim_expired_audio` only collects
  partials that are `abandoned` or `revoked`. Its object would have sat in the bucket
  forever, past its retention date, with nothing claiming it. The retention worker now
  calls it first on every run.
- **Verified:** a test that opens a session, uploads bytes, expires the clocks
  *without abandoning it*, and asserts the object is destroyed. Mutation 12 makes the
  sweep a no-op and kills two tests.
- **Note:** this is the same class of mistake as BE-W6's unscheduled purge. The check
  that catches it is cheap and should be routine.

## BE-W7 · A test of mine passed when it should have failed

- **Found:** mutation 3 (the sliding clock allowed past the hard ceiling) produced
  **zero** failures.
- **Tried:** read the test. It asserted the two clocks ended up *equal* — which a
  mutation that raised **both** satisfied while destroying the property entirely.
- **What worked:** the property is that the ceiling is **immovable**. Two assertions
  now: the ceiling is unchanged by a chunk, and unchanged by a resume.
- **Verified:** mutation 3 now kills a test. Second time the mutation pass has found a
  hollow test rather than a hollow guard.

## MR-53 E3 · Two decisions shared a CI step and one of them carried the other's question

- **Found:** asking "one warning or two?" of `check:decision-debt`. MR-52 D4 added `BE-W106` to the
  step beside the UCPMP cap and concatenated the two debts' warning arrays — but the CLI printed the
  **UCPMP paragraph after every warning and every failure**, because the advice lived in the loop
  rather than on the debt.
- **Why it would have bitten, with dates:** `BE-W106` is due 2026-10-31 and warns from **2026-10-10**;
  the cap is due 2026-11-06 and warns from **2026-10-16**. For fifteen days both warn. A reader would
  have been sent to ask the client what the UCPMP sample cap is in order to clear a question about
  which settings belong to which company — and from 2026-10-31 that paragraph would have arrived
  attached to a RED build, under `enforce_ucpmp_sample_cap() is inert`.
- **What worked:** the question and the consequence belong to the debt (`DEBTS`);
  `evaluateAllDecisionDebt` is pure and exported so the both-warning state is testable without a
  calendar or a database; the CLI prints one block per unanswered decision.
- **Verified:** six tests. Mutant — giving the settings debt the UCPMP question — kills exactly one
  and leaves ten green.
- **Note:** this is the same class as FIX-05's inert `ALTER DEFAULT PRIVILEGES`: something that looks
  like a control while pointing somewhere else. A second job would not have had this bug, which is
  the honest cost of MR-52 D4's (still correct) choice to use one.

## MR-53 · I committed a typecheck failure, for the third session running

- **Found:** `pnpm --filter @fieldforce/api typecheck` after the fact — `transcript-ingest.spec.ts`
  passed `role: string` where `asDatabaseRole` takes a union.
- **Why it got through:** vitest was green and I stopped reading there. It never reached CI only
  because the commit had not been pushed yet.
- **What worked:** nothing clever — running the command. The rule is not "run lint": it is run
  **typecheck, lint AND format**, and read all three outputs, before committing.

## MR-54 · My offline check proved nothing, in the direction nobody checks

- **Found:** restoring `adb reverse` and running the same `curl` check, which failed again — with
  the network demonstrably up.
- **Cause:** **`curl` is not on the Android emulator image.** `CURL_FAILED` meant "no such binary",
  not "no network". The earlier "proof" that the phone was offline was vacuous and would have read
  identically with the tunnel in place.
- **What worked:** `nc`, which exists (`/system/bin/nc`), driven two-sided — port open with the
  reverse, **connection refused** without it, open again when restored.
- **Note:** this repository's rule is "a command that exits 0 is not a command that worked". The
  inverse needs saying too: **a command that FAILS is not a command that tested anything.** A
  negative result from a tool that is absent looks exactly like a negative result from the condition
  you meant to test.

## MR-54 · A screen that never re-asks looked like a server that answered wrong

- **Found:** the visit screen said *"This phone does not have the doctor's answer for this visit"*
  for a visit whose consent row was `consented`, while online.
- **Tried:** asked the server directly as that rep — `allowed`. Turned on `log_statement=all` on the
  local database and re-triggered: **the app made no query at all**, so the screen was not asking.
  Cold-started the app: rendered correctly. Then read the effect — keyed on `[visit?.id]`, no focus
  listener.
- **What worked:** calling the RPC over HTTP **with the app's own bearer token**, lifted from the
  database log, which returned `allowed` and removed the last hypothesis that the client and the
  server disagreed about the rule.
- **Verified:** registered as `FE-W69`. The useful half is the direction that is dangerous — a stale
  screen still offering *Record this visit* after a withdrawal.
- **Note:** I nearly wrote this up as a server defect after two screenshots. The thing that settled
  it was making the app's own request by hand.

## MR-54 B3 · A green test run that had not run

- **Found:** doing B3's "report both counts". With the database UP, `pnpm test` reported
  `@fieldforce/api` as **101 passed / 712 skipped** — the numbers from the run I had just done with
  the database DOWN.
- **Cause:** `turbo` keys `@fieldforce/api:test` on file content. **Whether Postgres is listening on
  54322 is not a file**, so the cached green from a stopped stack was replayed over a running one.
- **What worked:** `npx turbo run test --filter @fieldforce/api --force` on the same tree → **813
  passed**. The tree was identical; only the cache differed.
- **What makes it worse, and it is my own change:** before B2 a stopped stack FAILED, so nobody
  could mistake it. After B2 it exits 0 — correctly — and the cache can then serve that 0 to
  somebody who believes the database tests ran. **A fix that makes a thing quieter can make a
  neighbouring hole deeper.**
- **Verified:** `services/api/turbo.json` sets `cache: false` on that task; the run now reports
  `8 cached, 9 total` with the api one executing. Registered as `BE-W113`, closed.

## MR-54 · I diagnosed a flake as load and it was database state

- **Found:** an api test failing twice in four `pnpm test` runs and never in three standalone ones.
  I registered it as intermittent "under parallel load" and named a plausible mechanism — a
  time-sensitive assertion under contention.
- **Cause, once actually measured:** nothing to do with load. `audio_purge_is_stalled()` reads the
  WHOLE of `recordings` and `voice_notes`; the false-positive test asserts that global function is
  false after adding one 4h-overdue row of its own. **One committed row more than 12 hours overdue
  anywhere fails it.** A single recording backdated 13 hours flipped the function and failed the
  test on demand; deleting it passed again.
- **Why it looked intermittent — the part worth keeping:** the retention suite commits real purges,
  so the first run on a poisoned database fails **and destroys the backlog while running**, and the
  next run is green. **Self-clearing state is indistinguishable from flakiness from outside.**
- **What worked:** poisoning the database deliberately and running the single test, rather than
  re-running the suite and watching the colour change.
- **Note on my own method:** "intermittent under load" was the nearest available story, and I wrote
  it into the register on evidence that never supported it — two failures and no measurement of the
  mechanism. The register row now says the first diagnosis was wrong, in those words. A weakness
  register that only accumulates confident guesses is worse than a short one.

## MR-54 `BE-W102` · I measured a status with the wrong identity and generalised it

- **Found:** `analysis-overrides-http.spec` failing with *expected 401 to be 403* after I made
  refusals return an envelope instead of raising.
- **Cause:** the spike that established the status called the RPC with the **anon key**, where
  PostgREST answers 401 because it has no identity to refuse. For an identified caller an in-body
  `42501` is **403**. I had one measurement and treated it as the general rule.
- **What worked:** the existing suite, which already asserted 403 from a real user.
- **Note:** the measurement was real and the conclusion was still wrong, which is the more dangerous
  shape — it had a number attached. "Measured" is not a property of a fact; it is a property of a
  fact *under stated conditions*, and I did not state them.

## MR-54 `BE-W102` · A drop-and-recreate handed anon the audit trail

- **Found:** `privilege-posture.spec` and `rls.spec` failing together on the first full run after the
  migration.
- **Cause:** `list_audit_log` needed a new parameter, which means DROP and CREATE — and **a newly
  created function carries EXECUTE to PUBLIC by default**. Granting to `authenticated` afterwards
  does not remove it. For one run, `anon` could call the function that reads the audit trail.
- **What worked:** two guards written by earlier sessions for exactly this, neither of which I was
  thinking about when I wrote the migration.
- **Verified:** the ACL is `postgres=X | authenticated=X`, identical to what it was before the drop,
  and the migration now asserts `anon` cannot execute it.
- **Note:** I recorded the ACL before the drop *in order to restore it* and still missed that the
  default grant is additive. Reading the before-state is not the same as diffing the after-state.
