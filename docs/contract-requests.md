# Contract requests

**Append-only.** Requests from one track to another for something the requester cannot change
themselves: a shared contract shape (`packages/core`), a backend surface (API, migrations), or a
fact only the owner can check. Never edit or delete an entry. To change its status, append a new
dated line under it.

Each entry: **date · requester · owner asked · shape or answer needed · why · status.**

**Identifier prefixes (2026-10-01, FE-D13).** Frontend's requests carry the prefix `FE-CR-`, so
they cannot be confused with a backend-raised request. CR-1 to CR-4 were renamed FE-CR-1 to
FE-CR-4 on the operator's instruction. Each heading keeps its old label as "(was CR-n)", so
references to CR-1 to CR-4 in `PROJECT-OVERVIEW.md` still resolve. Only those four heading lines
changed. No entry's body was edited.

---

### FE-CR-1 (was CR-1) — Is `BACKUP_DESTINATION` set?

| | |
| --- | --- |
| Date | 2026-09-28 |
| Requester | Frontend (FE-D1 session) |
| Owner asked | Backend (BE-W11) |
| Needed | A yes or no: does the repository secret `BACKUP_DESTINATION` exist? |
| Status | **Open** |

**Why.** `.github/workflows/backup.yml:85` sets `DEFERRAL_EXPIRES: '2026-10-15'`. The job fails when
`TODAY > DEFERRAL_EXPIRES` (`:107`), **but only if that secret is unset** (`:100-104`). Repository
secrets can't be seen from the tree, so the first red date is **conditional**: from 2026-10-16 UTC
on any run, and first on the weekly schedule on Monday 2026-10-19, *if* the secret is missing. If
it is set, the job doesn't go red on a date at all. Frontend reported it as conditional and needs
the owner's answer before calling it either way.

---

### FE-CR-2 (was CR-2) — Stale "30 September" deadline in a document frontend does not own

| | |
| --- | --- |
| Date | 2026-09-28 |
| Requester | Frontend (FE-D1 session) |
| Owner asked | Owner of `handoff-frontend.md` |
| Needed | Correct or annotate `handoff-frontend.md:259`, which still says "contract I3 (CI deadline **30 September 2026**)" |
| Status | **Open** |

**Why.** That deadline was retired on 22 September (MR-50 B3). `transcript-v0.expiry.test.ts` no
longer checks a date. Anyone following the handoff will chase a deadline that can't fire.
Frontend was told not to edit the file. The same correction for the documents frontend *does*
append to is in `PROJECT-OVERVIEW.md` → FE-D1.

---

*FE-D1 itself needed no new contract shape. The check-in queue row uses `SyncQueueItem` and
`CreateCheckInRequest` exactly as `packages/core` already defines them.*

---

### FE-CR-3 (was CR-3) — Can an MR call the five functions that would replace the mock, and do they return the contract shapes?

| | |
| --- | --- |
| Date | 2026-09-28 |
| Requester | Frontend (screen inventory, `docs/screen-inventory-2026-09-28.md` §d) |
| Owner asked | Backend |
| Needed | For each of `daily_mileage`, `list_analyses`, `read_analysis`, `respond_to_analysis`, `list_consent_records`: (1) is it granted to, and does it behave for, an **MR's** session? (2) does its return parse against the `packages/core` schema the screen already uses (`MileageRowSchema` or `MileageDaySchema`, `AnalysisSchema`, `ConsentRecordSchema`, in `packages/core/src/field/`)? A yes or no per function, plus the name of any mismatch. |
| Status | **Open** |

**Why.** Six MR screens read through the mock server (`apps/field/src/config.ts:42` defaults to
`http://127.0.0.1:4010`): report labels, day-end, mileage, coaching, analysis and reply. A real device
can't reach that address. Each operation already has a real function in migrations
(`20260815000100_thresholds_and_shift_defaults.sql` for `daily_mileage`;
`20260811000300_audit_log.sql` for the other four), so frontend is **not asking for a new endpoint**.
The frontend can't tell from the tree whether those functions were written for an MR caller or a
manager caller, or whether their output matches what the screens parse. If the answer is yes, the
switch is frontend-only. If it's no, what's needed is exactly what this entry asks for.

---

### FE-CR-4 (was CR-4) — Should an approximate location fix be treated differently at check-in?

| | |
| --- | --- |
| Date | 2026-09-28 |
| Requester | Frontend (FE-D3 A2; raised at the operator's ruling in FE-D4) |
| Owner asked | Backend |
| Needed | A decision, and then whatever shape it implies |
| Status | **Open** — a question, not a demand |

**The question.** The check-in stores the fix's accuracy, but the geofence verdict ignores it, so an
approximate fix is judged on its centre point, and nothing marks a check-in as approximate. Should
the verdict take accuracy into account, or should check-ins be flagged when the fix was
approximate?

**What frontend found, so the answer can be checked rather than trusted:**

- **The client sends accuracy.** `takeFix` sets `coordinates.accuracyMetres` from the fix
  (`apps/field/src/capture/location.ts:83`). It is a radius in metres. Nothing on the phone records
  "approximate" as such.
- **The server stores it.** `record_check_in` and `record_check_out` write it to
  `check_ins.accuracy_metres` and `check_outs.accuracy_metres`
  (`20260811000100_commercial_schema.sql:322, 339`; latest `record_check_in` in
  `20260911000300_check_in_starts_the_visit.sql:20, 76-81`).
- **The verdict does not read it.** `v_geofence` is decided by
  `v_distance <= coalesce(v_clinic.geofence_radius_metres, 150)` alone
  (`20260911000300_check_in_starts_the_visit.sql:70-74`).
- **Why it matters now.** Since FE-D2 10, first run treats an approximate-only grant (Android 12+)
  as granted, by operator ruling. A rep who chose approximate sends fixes that can be a few
  kilometres wide against a 150 m geofence, and the verdict cannot tell that apart from a precise
  fix.

Frontend changes nothing until this is answered.

---

### FE-CR-5 — Is a voice note's audio actually destroyed in production 90 days after it arrives?

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D13, `docs/frontend-facts-2026-10-01.md` §6) |
| Owner asked | Backend |
| Needed | A yes, a no, or "not until X". If yes, the evidence. Also: should the `voice_notes` row be kept as a tombstone, and does that change what the app may tell a rep? |
| Status | **Open**. A question, not a claim |

**The question.** The app tells a rep that voice notes are "marked for deletion 90 days after they
reach your company" (`apps/field/src/transparency/content.ts:48`). It does not say "deleted",
because frontend cannot show from the tree that deletion happens in production. Does it?

**What frontend found, so the answer can be checked rather than trusted:**

- **The code would delete the audio and keep the row.**
  - `stamp_audio_retention` sets `purge_after = received_at + 90 days`
    (`20260815000300_audio_consent_retention.sql:196-197, 206-208`).
  - `claim_expired_audio` selects expired voice notes (`20260816000300_resumable_upload.sql:800-812`).
  - `purge-expired-audio.mjs:105-107` deletes the storage object.
  - `confirm_audio_destroyed` deletes the transcripts and marks the row `destroyed` with a null
    `storage_key` (`resumable_upload.sql:933-950`). It does not delete the row.
- **The production wiring exists.**
  - All of the above is in the first 19 migrations, which production has applied (drift run
    36718280007: `"appliedVersions": 19`).
  - `retention.yml` runs on a schedule (`:46`) with `SUPABASE_DB_URL`, `SUPABASE_URL` and
    `SUPABASE_SERVICE_ROLE_KEY` set.
  - Its recent runs succeed (36827155291, 1 October 2026).
- **It has never been exercised.**
  - Every run logs `claimed 0, destroyed 0` and `"liveObjectCount": 0`.
  - `PROJECT-OVERVIEW.md:2008-2011` says the dispatch "proves the wiring, not the retention path".
  - The voice-note path (`sync_push`) is not on production (`handoff.md:162`), so the app cannot
    store a note there today.
- **The schedule fires less often than hourly.** The last three runs were 3.8 and 6.5 hours apart.

**Related copy, which frontend will not change until this is answered:**

- `apps/field/src/consent/content.ts:91,95,99,121` says recordings are "deleted".
- `apps/field/src/coaching/content.ts:32` says "transcript kept". That screen is hidden, and the
  text contradicts `resumable_upload.sql:933-943`.

---

### FE-CR-6 — Carry the AI allowance, and its reset time, to the app

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D14, the AI-limit warning) |
| Owner asked | Backend |
| Needed | Each AI flow's result (at least `mr_chat`) to carry `allowanceWarning`, `requestsUsedToday`, `dailyLimit` and the instant the allowance resets. The 429 for `45012` to carry the reset instant too |
| Status | **Open** |

**Why.** The app may show a usage figure or a reset time only if the server sent it. Today neither
reaches the app:

- `ai_begin_request` returns `requestsUsedToday`, `dailyLimit` and `allowanceWarning`
  (`packages/core/src/field/ai.ts:168-176` on `worktree-ai-platform-phase-a`). But `MrChatResult`
  (`packages/core/src/field/gateway/mr-chat.ts:86-90` on that branch) carries none of them, and
  the gateway returns that result unchanged
  (`services/api/supabase/functions/ai-gateway/index.ts:217-226`). This is `BE-W128` in
  `docs/COMPLETION-PLAN.md:2705` on that branch.
- **No contract carries a reset time.** The day is the India calendar day
  (`20261001000200_ai_allowance_warning.sql:138-139` on that branch). The only statement of the
  reset is a SQL `HINT`, "The allowance resets at midnight, India time." (`:144`). The gateway's
  429 body is `{ code: '45012', message: 'ai daily limit reached' }` (`index.ts:261`), which drops it.

**What frontend built meanwhile.** `AiAllowanceNotice` (`packages/ui/src/AiAllowanceNotice.tsx`).
Without a reset time from the server it says "The server has not said when it resets", and with no
usage figures it shows nothing. The only figures it has displayed so far are a sample fixture,
labelled "Sample data, not from the server."

**Suggested shape, for backend to accept or change:**
`allowance: { warning: boolean, requestsUsedToday: number, dailyLimit: number, resetsAt: string }`,
with `resetsAt` as an ISO instant, on every flow result and on the 429 body.

---

### FE-CR-7 — Land the chat request/response, refusal, placeholder and usage-warning contract in `packages/core` on `main`

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D15, the assistant screen) |
| Owner asked | Backend |
| Needed | Land the chat request/response, refusal, placeholder and usage-warning contract in `packages/core` on `main` |
| Status | **Open** |

**Why.** The assistant screen is built against the contract as it stands on
`worktree-ai-platform-phase-a`. That branch is not merged, so frontend must not import from it.
Until this lands, the app carries a local mirror of these shapes (`apps/field/src/assistant/contract.ts`)
and runs only on a labelled sample fixture behind a flag that is off by default. It does not call
the real gateway. Each item below is cited on that branch:

| Shape | Where on `worktree-ai-platform-phase-a` |
| --- | --- |
| Request: `{ feature: 'mr_chat', message, history? }`, POST to the `ai-gateway` Edge Function | `services/api/supabase/functions/ai-gateway/index.ts:58-77, 162-163, 217-226` |
| Response: `MrChatResult`, `answered` / `out_of_scope` / `patient_specific` / `failed` | `packages/core/src/field/gateway/mr-chat.ts:86-90` |
| Refusal wording, by design: product and clinical questions are redirected | `mr-chat.ts:102-106` (`MR_CHAT_OUT_OF_SCOPE_MESSAGE`); `packages/core/src/field/gateway/guardrails.ts:238` (`PATIENT_SPECIFIC_REFUSAL_MESSAGE`) |
| Feature off: HTTP 403 `{ code: '45011' }`. Limit reached: HTTP 429 `{ code: '45012' }` | `ai-gateway/index.ts:260-261` |
| No model connected: HTTP 503 `{ code: 'no_provider' }` | `ai-gateway/index.ts:189-199`; `services/api/supabase/functions/_shared/stub-provider.ts:26-28` |
| Usage: `requestsUsedToday`, `dailyLimit`, `allowanceWarning`, on `ai_begin_request` only | `packages/core/src/field/ai.ts:168-176` (see FE-CR-6) |

**Three questions to settle when it lands:**

1. **The local stub's placeholder looks like a refusal.** Against a local target, the stub answers
   `mr_chat` with `{ inScope: false }` (`stub-provider.ts:120-125`), which `answerMrChat` turns into
   `out_of_scope`, the same result a real refusal gives. The app cannot tell "no model" from "the
   assistant declined". Could the result carry an explicit marker, such as `provider: 'stub'`, so the
   app can show "not available yet" instead of a refusal?
2. **`history` is not sent.** The app sends only what the rep typed in this message. It attaches no
   doctor, patient, visit or prescribing data, and no earlier turns. Is a single-turn chat acceptable,
   or should earlier rep-typed turns be sent?
3. **The allowance and reset time** belong on the result (FE-CR-6).

---

### FE-CR-8 — What writes an analysis and its findings, and when?

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D16, the Coaching readiness audit) |
| Owner asked | Backend |
| Needed | An answer: which function or job will insert `public.analyses` rows and their findings, and is it planned for `main`? |
| Status | **Open**. A question |

**Why.** FE-D16 wired Coaching and Analysis to `list_analyses` and `read_analysis`. On `main`
today, both screens can only ever be empty or show an analysis with no findings:

- **Nothing on `main` writes `public.analyses`.** Only test fixtures insert rows
  (`services/api/tests/fixtures.ts:514-517`, `consent-audio.spec.ts:673`). `seed-day.mjs` creates
  none, and `seed-one-mr.mjs:19-25` says so on purpose.
- **Findings are hard-coded empty.** `analysis_contract_row` emits `'findings', '[]'::jsonb`
  (`20260923000100_console_reads_contract_shape.sql:92`). Its header says the engine is due "week
  10, contract I5" (`:13-16`).
- **The AI branch does not write them either.** `ai_coach` on `worktree-ai-platform-phase-a` writes
  `public.sim_coach_analyses` (`20261001000100_coach_nine_dimensions.sql:259`, and
  `packages/core/src/field/gateway/sim-doctor.ts:199-234`), which holds practice sessions, not
  analyses of real visits.

**So the AWS key alone does not make Coaching work.** A model needs a path from a consented
recording and a transcript to an `analyses` row with findings. Is that path designed, and on which
branch?

---

### FE-CR-9 — Should opening an analysis stamp `mr_viewed_at`?

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D16) |
| Owner asked | Backend |
| Needed | A yes or no. If yes, `read_analysis` stamps `mr_viewed_at` when the caller is the analysis's own MR |
| Status | **Open**. A question |

**Why.**

- **Only replying stamps it.** `respond_to_analysis` sets `mr_viewed_at = coalesce(mr_viewed_at,
  now())` (`20260811000300_audit_log.sql:487`). No other migration writes the column.
- **Reading does not.** `read_analysis` (`20260923000100…:31`) only reads.
- **The core client assumed it does** (`packages/core/src/field/client.ts:466-473`), and so did
  the frontend's own 3 September handoff (`handoff-frontend.md`, "`getAnalysis` … please
  confirm").
- **The design rests on it.** "Your manager can only see what you've already seen" (phase 4 D1)
  is a promise about this column.

Until this is answered, FE-D16 removed the screen's claims built on the column ("You read it
first", "Your manager has not opened this yet"). Nothing on screen backs them.

---

### FE-CR-10 — Queue a reply offline, and the shape `respond_to_analysis` returns

| | |
| --- | --- |
| Date | 2026-10-01 |
| Requester | Frontend (FE-D16) |
| Owner asked | Backend |
| Needed | (1) Should a reply be queued offline? If yes, it needs a sync entity, an idempotency key and a `sync_push` path. (2) Should `respond_to_analysis` return the `Analysis` contract? |
| Status | **Open**. Two questions |

**Why.**

1. **A reply cannot go through the queue today.** The sync entity list has no analysis response
   (`packages/core/src/field/sync.ts:12-21`; the database enum at
   `20260813000200_offline_sync.sql:48-57`). The latest `apply_sync_item` raises "not yet accepted
   by sync" for anything else (`20260911000400_sync_row_identity_from_payload_id.sql:59, 235`). So
   FE-D16 calls `respond_to_analysis` directly. With no signal the send fails, and the text stays on
   the screen, as the reply route's existing design says (`apps/field/app/reply/[analysisId].tsx:23-27`).
   A queued reply would also need an answer to that design's point: a half-written argument
   should not land in a manager's queue the moment signal returns.
2. **The return is a raw row.** `respond_to_analysis` returns `to_jsonb(v_row)`, snake_case, with
   no `findings` and no `transcriptId` (`20260811000300_audit_log.sql:496`). That is not
   `AnalysisSchema`, which core's REST `respondToAnalysis` parses (`client.ts:486-492`). FE-D16
   does not read the return, and does not reshape it. Should it go through `analysis_contract_row`
   like the reads?

**Also noted:** the only test of an MR calling these four functions, `cr3-mr-reads.spec.ts`, is on
`worktree-ai-platform-phase-a` only, not on `main`.
