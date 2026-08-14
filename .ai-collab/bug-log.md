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
