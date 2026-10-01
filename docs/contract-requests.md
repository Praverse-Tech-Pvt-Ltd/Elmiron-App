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

## Answers — 28 September 2026 (backend, W1-C)

**Also recorded here because both tracks read this file: decision ids are now minted PER TRACK.**
Backend mints **`BE-C<n>`**, frontend mints **`FE-C<n>`**, each from its own sequence starting at 1.
`C1`–`C31` keep their names. Ruling **`BE-C3`**; the reason is that on 28 September both tracks
minted `C20` independently and nine backend rulings had to be renumbered across 15 files during a
merge (`BE-W118`). The rule is also in `CLAUDE.md`, which is the only file both tracks load before
reading any code.

---

### CR-1 — answered 2026-09-28 (backend, W1-C A3): **NO, it is not set. The date is real, not conditional.**

**Repository secrets, read with `gh secret list`** — the whole list, three entries:

```
SUPABASE_DB_URL             2026-08-14
SUPABASE_SERVICE_ROLE_KEY   2026-08-14
SUPABASE_URL                2026-08-14
```

**`BACKUP_DESTINATION` is not among them.** So `backup.yml`'s destination step takes the deferral
branch, and with `DEFERRAL_EXPIRES: '2026-10-15'` (`:85`) the job **goes red from 2026-10-16 UTC on
any run, and first on the weekly schedule on Monday 2026-10-19.** The frontend was right to report
it as conditional; the condition is now resolved and the answer is the red one.

**Two levels ruled out, and one that could not be.**

| Level | Verdict |
| --- | --- |
| **Repository** | **not set** — the list above is complete |
| **Environment** | **cannot apply.** `gh api …/environments` returns none, and `backup.yml` declares no `environment:`, so an environment secret could not be injected even if one existed |
| **Organisation** | **UNVERIFIED.** `gh secret list --org Praverse-Tech-Pvt-Ltd` → `HTTP 403: You must be an org admin`. An org secret scoped to this repository *would* satisfy the check |

**So: treat 16 October as the red date.** The only thing that could change it is an organisation
secret nobody in this session can see, and **an org admin can settle it in one command**. Raised as a
one-line operator question in `docs/blocked-on-you.md` with that date attached.

**Not fixed, and deliberately.** Setting the secret is not engineering's to do — `BE-W11` records
that the backup artefact is built and proven end to end and has **nowhere lawful to go** (register
`#33`). A destination invented by engineering would be a dump of the consent ledger, doctors' names
and adverse-event text sent somewhere nobody approved.

---

### CR-2 — answered 2026-09-28 (backend, W1-C A4): **corrected in place.**

`handoff-frontend.md:259` now strikes the date and carries a correction block. **The 30 September CI
deadline was retired on 22 September** (MR-50 B3, ruling `C7`): `transcript-v0.expiry.test.ts`
validates a Hinglish fixture instead of checking a date, so **no date remains that can fire.**

Contract I3 itself — the speech vendor — is **still open**, is now register `#19`, and was
**deferred** by `C29`. It has no deadline attached. The frontend was right that anyone following that
line would chase something that cannot arrive.

**Noted for the record:** the deadline was retired *by answering its question*, which is this
repository's rule for retiring a deadline test rather than moving its date.

---

### CR-3 — answered 2026-09-28 (backend, W1-C A1): **all five are YES for an MR. The switch is frontend-only.**

**Proven, not read.** `services/api/tests/cr3-mr-reads.spec.ts` — **10 tests, all passing** — signs
in as the fixture MR through **real GoTrue**, calls each function over **real HTTP** with that MR's
token, and parses every response through the exact exported schema. Reading the grant would have
answered neither half: `grant execute … to authenticated` is true for all five and says nothing about
what the body does with `current_app_role()`.

| Function | Behaves for an MR? | Parses? | Note |
| --- | --- | --- | --- |
| `daily_mileage` | **YES** — returns only that MR's days (`visible_user_ids()`) | **YES, with `MileageRowSchema` + `fromMileageRow`** | **The naming answer to your "or".** See below |
| `list_analyses` | **YES** — the MR's own; another MR's are absent, asserted | **YES** — `ListAnalysesPageSchema` | **No `p_reason` needed for an MR.** Only an `admin` must supply one (`22023`) |
| `read_analysis` | **YES** for their own | **YES** — `ReadAnalysisResponseSchema` | Out of scope returns **`data: null`, HTTP 200** — an absence the server chose, not an error to handle |
| `respond_to_analysis` | **YES** for their own; **refused** for another MR's, asserted two-sided | n/a — a write | |
| `list_consent_records` | **YES** — records in scope | **YES** — `ListConsentRecordsPageSchema` | |

**The one thing to get right, and it is the "or" in your question.** `daily_mileage` is the only one
of the five that is **not** a `jsonb` builder — it is
`returns table (mr_id, travel_date, check_in_count, distance_metres)`, so PostgREST serialises those
column names literally and **the wire is snake_case.** That is why MR-52 A2's camelCase sweep over
`to_jsonb(row)` shapes never touched it.

**It is not a defect and the mapper already exists.** **Use `MileageRowSchema` for the wire and
`fromMileageRow(row)` to get a `MileageDay`** — which is exactly what
`apps/field/src/capture/visits.ts:102` already does through `listMileage`. **`MileageDaySchema` alone
will NOT parse the wire**, and the suite asserts that as a negative control, so if the function is
ever converted to camelCase the double-mapping becomes a red test rather than a silent bug.

**No other mismatch was found.** Four of the five already return the contract's camelCase shape
because MR-52 A2 converted them after the same class of defect was found against the console.

**So the mock switch is yours alone.** Nothing in the backend has to change for the six screens to
leave `127.0.0.1:4010`.

---

### CR-4 — answered 2026-09-28 (backend, W1-C A2): ruling **`BE-C2`** — the verdict stays, the check-in is flagged.

**The ruling, in the reviewer's words: the geofence VERDICT keeps using the centre point, because *a
verdict that silently changes meaning with fix quality is worse than one that is wrong the same way
every time.*** An accuracy-widened geofence would make "inside" mean something different for every
check-in, and no screen or report could say which. Wrong-but-consistent is auditable.

**What was built** — `20260928000200_approximate_check_in.sql`:

* **new column `check_ins.location_is_approximate`**, set by `record_check_in` at write time;
* **true when the device-reported `accuracy_metres` EXCEEDS the clinic's geofence radius** — the one
  threshold with a meaning rather than a taste: if the error radius is larger than the circle being
  tested, the fix cannot place the rep inside or outside it;
* **NULL when no accuracy was sent, or when there is no clinic** to compare against. Not `false` —
  the question has no answer, and `false` would assert a good fix;
* **NULL for every row written before the migration.** Not assessed, not "good";
* **`v_geofence` is byte-for-byte unchanged.** A test asserts a 5 m and a 5 km fix at the same point
  produce the **same verdict** and **different flags**, so a future session widening the geofence by
  accuracy reverses the ruling visibly instead of quietly.

**Nothing is refused on the flag.** A rep on an approximate-only grant — which the operator allowed
at first run (FE-D2 10) — still checks in, and the visit still starts.

**What the frontend now needs to show.** The column is served and **nothing reads it yet**;
`CheckInSchema` in `packages/core` does not declare it, so adopting it is a contract change the
frontend can request or make:

1. **Surface it on the check-in**, wherever the geofence result is already shown — "location
   approximate" beside the verdict, not instead of it. The verdict is still the server's answer.
2. **Do not present it as a failure.** The check-in succeeded and counts. The honest wording is that
   the *fix* was too coarse to confirm the location, not that the rep did anything wrong.
3. **Handle NULL as "not assessed"**, distinct from false. Older check-ins and fixes with no reported
   accuracy will be null, and rendering that as "precise" would be the same overstatement the reps'
   privacy notice was corrected for.
4. **Nothing to change on the write path.** `takeFix` already sends `accuracyMetres`
   (`apps/field/src/capture/location.ts:83`) and the server already stored it; only the reading side
   is new.

---

### CR-5 — The practice session API (AI Doctor), from backend to frontend

| | |
| --- | --- |
| Date | 2026-09-29 |
| Requester | **Backend** (W1-D / W1-E) |
| Owner asked | **Frontend** — this is an offer, not a demand |
| Needed | Nothing from you yet. This is the API as it actually is, so a screen can be built against it without asking, **and the reasons not to build one yet** |
| Status | **Open — informational** |

**Why this exists.** AI Doctor is built and proven end to end over HTTP — a real sign-in, a real
session, a turn through the deployed Edge Function, an analysis row — and **no screen can reach any
of it.** That is the same shape as six MR screens sitting on the mock, and it is solvable the same
way: by telling the other track what to call.

**Everything below is exercised by `services/api/tests/sim-gateway.spec.ts` (18 tests), which ran in
CI rather than skipping.**

---

#### The four calls

**Three are Postgres RPCs through PostgREST, exactly like every other write in the app. One is the
Edge Function.** No new transport, no new auth, no upload path.

##### 1. Start a session — `start_sim_session`

| | |
| --- | --- |
| Who | **Anyone signed in, for themselves.** There is no parameter for whose session it is: `mr_id` is `auth.uid()` |
| Call | `supabase.rpc('start_sim_session', { p_scenario_id })` |
| Request | one uuid |
| Response | **`StartSimSessionResponseSchema`** — `sessionId`, `personaId`, `personaDisplayName`, `personaStance`, `objective`, `objection`, `promptVersionId`, `startedAt` |

**Refusals**

| SQLSTATE | When | What the screen shows |
| --- | --- | --- |
| `28000` | no session | Sign in again — `refusalForSqlState` already maps this |
| `42501` | the scenario is not yours / does not exist — **deliberately the same answer**, so it is not a cross-tenant existence oracle | *"That practice scenario is not available."* Do not say "not found"; you do not know that |
| `22023` | the scenario or its persona is **not approved** | *"This scenario is not ready yet."* It is waiting on an approver, not on the rep |
| **`45011`** | **no approved `ai_doctor` prompt version for this company** | *"Practice is not switched on for your company yet."* Not an error the rep can act on |

**`personaStance` is one of `receptive`, `sceptical`, `rushed`, `hostile`** — a closed set, safe to
switch on for an avatar or a tone indicator.

##### 2. Take a turn — the **Edge Function**, not an RPC

| | |
| --- | --- |
| Who | the rep who owns the session |
| Call | `POST {SUPABASE_URL}/functions/v1/ai-gateway` with the user's bearer token |
| Body | `{ feature: 'ai_doctor', sessionId, repText, personaBrief, personaStance, objection, history }` |
| `history` | `[{ role: 'rep' \| 'doctor', text }]`, oldest first, so the doctor remembers the conversation |
| Response | **`SimTurnResult`** — a discriminated union on `kind` |

| `kind` | Meaning | What the screen shows |
| --- | --- | --- |
| `replied` | `reply`, `objectionAddressed`, `turnCount` | the doctor's line. **`turnCount` counts BOTH turns**, so it goes up by 2 |
| `patient_specific` | the guardrail refused **before any model call** | `message`, verbatim. **Do not echo what the rep typed** — that is the point of the refusal |
| `failed` | timeout, provider error, or a reply that failed validation | `message`, verbatim. **The session stays open**; a retry is safe and costs a turn, not the practice |

**HTTP-level refusals from the same endpoint:** `401` + `{code:'28000'}` with no bearer token;
`403` + `{code:'45011'}` feature off; `429` + `{code:'45012'}` daily allowance spent —
*"You have used today's practice allowance. It resets at midnight."*

**Two properties worth relying on.** A refused turn is **not stored at all**, so patient details a
rep was stopped from sending never enter their history. And **both turns are written atomically**,
so you will never see a rep turn with no reply.

##### 3. End a session — `end_sim_session`

| | |
| --- | --- |
| Who | the owner. **An admin cannot end a rep's session** — practice is the rep's own |
| Response | **`EndSimSessionResponseSchema`** — `sessionId`, `state: 'ended'`, `endedAt`, `turnCount` |
| Idempotent | **yes.** Ending twice returns the same answer, because a phone that lost its reply will retry |
| Refusal | `42501` if it is not yours |

##### 4. The coach analysis

**Produced** by the same Edge Function with `feature: 'ai_coach'` and `{ sessionId, objective,
objection, turns }`, after the session has ended (`22023` if it has not).

**Read** as an ordinary table read of `sim_coach_analyses`, parsed with
**`SimCoachAnalysisSchema`**: `overallScore` and five `dimensionScores`
(`opening`, `product_knowledge`, `objection_handling`, `communication`, `closing`), all 0–100
integers; `strengths` and `improvements`, **at least one of each**, every finding carrying
`dimension`, `title`, `detail` and **`turnIndex`**; `summary`; and `modelProvider` / `modelName`.

**Every finding cites a turn, and the server refuses one that does not** — so you can and should
link each piece of feedback to the turn it is about. A finding citing a turn outside the session is
refused `23514`.

**One per session**, enforced by a unique constraint. There is no "latest analysis" question.

---

#### Who can see a score — read this before designing anything

**`C27`: a practice session, its turns and its coach analysis are visible to the MR who owns it and
to a company admin. To nobody else.** A **field manager sees nothing** — asserted by a test, because
`visible_user_ids()` is deliberately absent from those RLS policies.

**So: no team view, no averages, no ranking, no comparison, and no "how did I do against my
colleagues".** The row has no field that would support one, and `contract.test.ts` fails the build if
one is added by name. If a manager-facing score is ever wanted, that is register `#14` and it needs
the recorded rule amended **in writing** first.

---

#### What a screen would show TODAY, and whether to build one

**The doctor's replies are not real.** `#5` — which AI provider, and may data leave India — is open,
so the gateway runs a **stub**. Every stubbed reply is literally the text
`[PRACTICE STUB - no AI provider is configured; decision #5 is open, so no model was called]`, and
every stubbed coach analysis scores **0 on every dimension** with the same marker as its summary.

**That is deliberate.** A stub that said *"Yes, tell me more about the dosing"* would be
indistinguishable from a working feature to anyone watching, including the person who built it.

**Recommendation: build the screen against the stub, but do not put it in front of a rep or a
demo audience.** The reasoning, rather than a preference:

- **For building now:** the contract will not change when a vendor is chosen. Swapping the stub for
  a real adapter is **one file** in `supabase/functions/_shared/`, and nothing in the request or
  response shapes moves. A screen built now is a screen that works the day `#5` is answered, and the
  screen is the larger piece of work.
- **For not shipping it now:** a practice screen whose doctor says the same marker every time
  teaches nothing, and a rep who tries it once will not come back when it becomes real.
- **The deciding asymmetry:** building early costs nothing if the contract holds, and the contract is
  pinned by 18 tests. **Shipping early costs the feature's credibility with the first reps who
  touch it.** So: build behind a flag that ships off, the same shape as `C21`'s recording feature.

---

#### What does NOT exist yet, and what is needed to run ONE practice session

**No persona and no scenario exist as content.** The tables are there and empty. **`C24` applies:
neither is born approved** — both enter as drafts and need a **second admin** to approve them, which
is the same four-eyes path knowledge uses.

**To run one practice session end to end, someone must create and approve:**

| # | What | Who | Note |
| --- | --- | --- | --- |
| 1 | **A second admin account** | operator | Four eyes refuses every approval with one admin. Same blocker as `C26`, still open |
| 2 | **One persona** — display name, specialty, stance, brief | an admin drafts | The display name is a **label**, never a real doctor's name. No constraint can check that; the approver enforces it |
| 3 | **Approve the persona** | the **other** admin | attestation required |
| 4 | **One scenario** — title, objective, objection, optional product + market | an admin drafts | If it names a product it **must** name a market (§47) |
| 5 | **Approve the scenario** | the **other** admin | attestation required |
| 6 | **An approved `ai_doctor` prompt version** | an admin drafts, the other approves | `outputSchemaName` must be `SimDoctorTurnOutputSchema`, or every reply fails validation |
| 7 | **An approved `ai_coach` prompt version** | same | `outputSchemaName` must be `SimCoachOutputSchema` |
| 8 | **`ai_feature_enabled:ai_doctor` and `:ai_coach` set true**, and **`ai_daily_requests_per_user` set** | operator | All three ship **off/unset**; an unlimited allowance is never the default |

**Steps 2–5 need a console screen that does not exist.** The knowledge approval screen (W1-A E3) is
the working model; a persona/scenario equivalent is the obvious next backend-console piece, and it is
**not blocked by `#5`.**

**Nothing on this list is engineering-blocked. All of it is content and two accounts.**

---

## Answers — 29 September 2026 (backend, W1-G)

> **Read this section first if you are the frontend track.** Three of the four items below are
> answers to things you have already asked, and one of them — **CR-3 — was answered on
> 28 September and you are still building against a mock because of it.**

### ⚠ CR-3 IS ANSWERED. You can leave `127.0.0.1:4010` today, with no backend change.

**It was answered on 28 September and it is in this file, above, under "Answers — 28 September".**
It is repeated here because a buried answer is an unanswered question, and because your developer
leaves after the demo.

**All five functions work for an MR, over real HTTP, with a real GoTrue token.** Proven in
`services/api/tests/cr3-mr-reads.spec.ts` — **10 tests, all passing** — not read off a grant.

| Function | An MR may call it | Parse with |
| --- | --- | --- |
| `daily_mileage` | **YES** | **`MileageRowSchema` + `fromMileageRow`** — see the warning below |
| `list_analyses` | **YES**, their own. **No `p_reason`** — only an `admin` must supply one | `ListAnalysesPageSchema` |
| `read_analysis` | **YES**, their own. Out of scope is **`data: null` with HTTP 200**, an absence rather than an error | `ReadAnalysisResponseSchema` |
| `respond_to_analysis` | **YES**, their own; refused for another MR's, asserted two-sided | — |
| `list_consent_records` | **YES**, in scope | `ListConsentRecordsPageSchema` |

**The one trap, and it is the "or" in your original question.** `daily_mileage` is the only one that
is not a `jsonb` builder — it is `returns table (mr_id, travel_date, check_in_count,
distance_metres)`, so PostgREST serialises those column names literally and **the wire is
snake_case.** **`MileageDaySchema` alone will NOT parse it.** Use `MileageRowSchema` for the wire
and `fromMileageRow(row)` to get a `MileageDay` — which is what
`apps/field/src/capture/visits.ts:102` already does through `listMileage`. The suite asserts the
failure as a negative control, so a future camelCase conversion becomes a red test rather than a
silent bug.

**Six screens can leave the mock with no backend change, and the switch is yours alone.** It is also
not optional for the demo: **`127.0.0.1` on a handset is the handset**, so a real device cannot
reach the mock at all. Every screen still pointed at `:4010` is a screen that works only in an
emulator.

---

### `BE-C4` — CR ids are colliding. Per-track prefixes, as `BE-C3` did for decisions.

**What happened.** You called the voice-note retention item **CR-5**. `CR-5` in this file is **the
practice session API**, filed by the backend on 28 September. **Two tracks are minting CR ids from
one sequence, and each reads the highest id in a file that is only correct on one branch at a time.**

**This is the same collision class as `C20`**, where both tracks minted the same decision id in
parallel and nine backend rulings had to be renumbered across 15 files during a merge. That was
fixed by per-track prefixes (`BE-C3`). **The fix was applied to decisions and not to contract
requests, which is why it has happened again.**

**Ruling `BE-C4`, effective now:**

| Track | Mints |
| --- | --- |
| Backend / AI platform | **`BE-CR<n>`** |
| Frontend / field app | **`FE-CR<n>`** |

Each sequence starts at 1 and is independent. **`CR-1`–`CR-5` keep their names** — they are cited in
tests, commits and both registers, and renaming them costs more than the ambiguity they carry. The
same call `BE-C3` made for `C1`–`C31`.

**Your voice-note item is therefore `FE-CR-1`, and it is answered in this session's Part A** —
short version: the retention jobs are **not** off, they have run **126 times without a failure since
7 September**, they **do** cover `voice_notes`, and production holds **zero** audio objects of any
age. The long version, with the run history and the production numbers, is in
`docs/log/backend.md` → W1-G Part A.

**Recorded in `CLAUDE.md`**, because that is the only file both tracks load before reading any code
— the same place `BE-C3` was put, for the same reason.

---

### `BE-CR-1` — off-site check-ins: what the rep is told, whether the visit starts, when a manager sees it

**What exists today, measured rather than recalled.** `check_ins.geofence_status` is a **NOT NULL**
enum `('inside','outside','unavailable')`, so a verdict is recorded for **every** check-in and always
has been. `check_ins.location_is_approximate` was added on 28 September by
`20260928000200_approximate_check_in.sql` (ruling `BE-C2`, the answer to CR-4). **No screen in
`apps/field` reads either column** — `grep` over `apps/field/src` and `apps/field/app` returns
nothing for both.

**1. Should the rep be told? YES, and clearly.**

It is a fact about **their own** check-in, recorded about them, and it can be read later by someone
who decides things about their job. **Hiding it is precisely the failure the privacy notice is
being corrected for** — see the next item, where a notice currently tells a rep the app "cannot do
this today" about things it does every day. A rep who discovers months later that "outside" was
recorded every time they stood in the car park has been misled by omission, and the fix costs one
line under the check-in confirmation.

**Say it plainly and without threat.** Not a warning, not a blocking dialog, not red:

> *Checked in — we could not confirm you were at the clinic.*

and, when the fix was coarse:

> *Checked in — your phone gave an approximate location.*

**Do not** tell the rep what it will be used for, because nobody has decided that yet, and a screen
that invents a consequence is worse than one that states a fact.

**2. Should an off-site check-in still start a visit? YES. Unconditionally.**

**The server already does**, and this is the answer to "what should the app do": nothing in
`record_check_in` refuses on `geofence_status = 'outside'`. The verdict is recorded beside the
check-in, not used as a gate.

**Refusing would strand a rep standing in front of a doctor** — because the clinic's stored
coordinates are wrong, because they are on the third floor, because the GPS is poor indoors, or
because the doctor moved rooms. The app would then be punishing a rep for the accuracy of a number
somebody else typed into a clinic record. **A check-in that is recorded and flagged is strictly more
useful than one that never happened**, and the flag survives to be looked at; a refusal leaves no
trace at all.

**3. When does a manager see it? Not in v1.**

There is no manager surface for it and there should not be one yet, for two reasons that are
independent:

* **Nothing decides what "outside" means.** 150 metres is a default radius, not a policy. Until
  somebody rules on what an off-site check-in signifies, a manager screen showing it would invite a
  conclusion the data does not support — and the first such conclusion will be about a person's pay
  or job.
* **The manager console is out of v1 entirely**, with the rest of the manager surface. This is not a
  special exclusion for geofencing.

**The data is not lost while that is decided** — it is on every check-in row from the beginning, so
the surface can be built at any time against a complete history. **Building the screen is cheap
later; recording nothing now would be unrecoverable.** That asymmetry is the whole argument.

---

### `BE-CR-2` — the privacy notice: what a rep sees TODAY is not the corrected one

**You said the "What we record" screen is now accurate. It is accurate on YOUR BRANCH, and that
branch is not merged.** Measured, not recalled:

| | `origin/main` — **what a rep sees today** | `origin/mr-46/fe-w52-notice-pending-approval` |
| --- | --- | --- |
| entries marked `state: 'active'` | **0** | **5** |
| entries marked `state: 'not-yet'` | **4** | 1 |
| merged into `main`? | — | **NO** (`git branch -r --merged origin/main` does not list it) |
| commits ahead of `main` | — | 6, last one `75dd570`, 23 September |

**There is exactly one copy of the file**, `apps/field/src/transparency/content.ts`, with a single
commit in its history on `main` (`2536862`). **PR #2's branch carries `main`'s version too**, so the
correction is not arriving through the backend branch either.

**What that means on a handset today, and it is worse than "out of date".** `not-yet` renders, from
`packages/ui/src/TransparencyScreen.tsx:72`, as:

> **"Not yet — this app cannot do this today."**

So a rep opening **"What this app records"** is currently told that the app **cannot** record where
they are during their shift, which doctors they saw and when, or their voice notes and reports —
**while check-in with a geofence verdict, voice notes and call reports are all built and working.**

**The screen is not merely stale. It states the opposite of the truth, in the one place the product
promises transparency.** And it is the same omission as the previous item: the corrected version is
the one that says *"whether you were inside the clinic's area"*, and `main`'s does not mention the
geofence verdict at all.

**What is actually blocking it: operator approval, not engineering.** The branch name says
`pending-approval` and `MR-46 A` is titled *"FE-W52 truthful transparency notice, PENDING OPERATOR
APPROVAL"*. The text is written. **Nobody has approved it, and while nobody approves it the untrue
version is the one shipping.**

**Recommendation, and the backend has no veto here:** approve the notice or reject it, this week and
before the demo. If the objection is to a specific line, ship the rest — **four entries that say
"this app cannot do this today" about things it does daily is not a safer position than an imperfect
correction.** Merging it also needs `main` merged into that branch first; it is six commits behind a
month of work.

---

## Answers — 30 September 2026 (backend, W1-I)

> **⚠ READ THIS LINE FIRST, AND IT IS THE THIRD TIME IT HAS BEEN WRITTEN.**
>
> **CR-3 is answered. Six screens can leave `127.0.0.1:4010` TODAY with no backend change, and a real
> device cannot reach `127.0.0.1` at all — on a handset that address is the handset.** If the switch
> does not happen before your developer moves to other projects, **it does not happen**, and the demo
> runs on an emulator or not at all. The detail is under *"Answers — 28 September"*, repeated under
> *"Answers — 29 September"*, and this is the one-line version.

Three contract requests follow, one per unbuilt screen, to the same completeness as `CR-5`. Each says
who may call it, the schema names in `packages/core`, every refusal with its SQLSTATE, and what the
screen shows. **Each ends with a ruling on whether to build it against the stub or hold it until
`#5`.**

---

### `BE-CR-3` — Product Q&A (`product_qa`)

**What it is.** A rep asks a question about a product; the answer comes **only** from approved
knowledge for their market, with citations, or it says approved information is not available.

**Who may call it.** Any authenticated user, subject to the database's own three conditions — the
feature flag, an approved prompt for their organisation, and a daily allowance. The MR's own token;
never a service key.

**How to call it.** `POST` to the Edge Function, **not** an RPC:

```
POST {SUPABASE_URL}/functions/v1/ai-gateway
Authorization: Bearer <the MR's access token>
{ "feature": "product_qa", "question": "...", "marketId": "<uuid|null>", "productId": "<uuid|null>" }
```

**`feature` may be omitted** and defaults to `product_qa`, so the W1-B contract is unchanged for
existing callers. Send it anyway — an explicit feature is one less thing to infer when reading a log.

**What comes back.** `ProductQaResult` (`packages/core/src/field/gateway/product-qa.ts`), a
discriminated union on `kind`. **Switch on `kind`; do not test for an empty answer:**

| `kind` | What it means | What the screen shows |
| --- | --- | --- |
| `answered` | `answer` plus `citations[]`, each with `documentTitle`, `versionNumber`, `heading`, `sourceReference` | The answer **with its citations visible**. A citation is not a footnote here — it is the reason the answer is allowed to exist |
| `not_available` | Nothing approved matched, or the model's reply failed validation | `KNOWLEDGE_NOT_AVAILABLE_MESSAGE`, verbatim. **Do not soften it into "I could not find anything"** — the sentence is deliberate |
| `patient_specific` | The guardrail fired | `PATIENT_SPECIFIC_REFUSAL_MESSAGE`, verbatim. Offer the approved channel, not a retry |
| `failed` | Provider timeout, provider error, or a prompt/schema mismatch | `PRODUCT_QA_FAILED_MESSAGE`. A retry is safe |

**Every refusal, with its SQLSTATE and HTTP status:**

| SQLSTATE | HTTP | Meaning | Screen |
| --- | --- | --- | --- |
| — | **401** | No bearer token | Sign in again |
| `22023` | **400** | Empty question, or an unknown `feature` | A validation message. Not a server problem |
| `45011` | **403** | `ai_feature_disabled` — flag off, **or** no approved prompt for this organisation | *"This feature is not switched on for your company."* **Not actionable by the rep** — do not offer a retry |
| `45012` | **429** | `ai_daily_requests_per_user` spent | *"You have used today's questions."* Actionable tomorrow |
| `28000` | 403 | Not authenticated at the database | Sign in again |
| `no_provider` | **503** | No AI provider configured — `#5` | See the ruling below |

Use `refusalForSqlState` from `packages/core` rather than mapping these by hand; it already returns
the `code` and an `actionable` boolean.

**C2 ruling: BUILD IT AGAINST THE STUB.** The stub answers `supported: false`, so the screen shows
`not_available` on every question — which is **the real behaviour of a company with no approved
knowledge**, and that is the state every company starts in. The screen is therefore correct today and
correct after `#5`; nothing about it changes. **Build it.**

---

### `BE-CR-4` — The practice session (`ai_doctor` + `ai_coach`)

**This supersedes nothing in `CR-5` — it is `CR-5`'s screen half.** `CR-5` gave the four calls;
this gives the refusals and the screen states, which is what was missing.

**Who may call it.** The **rep only**, for their own sessions. `sim_sessions_read` admits the owning
MR and an admin — **deliberately not a field manager**, which is `C27` and is the whole reason the
policy omits `visible_user_ids()`. There is no manager surface and there must not be one in v1.

**The four calls.** RPC names from `SIMULATION_RPC` (`packages/core/src/field/simulation.ts`) — read
them from the constant, never typed as strings:

| Step | Call | Response schema |
| --- | --- | --- |
| 1. Start | `SIMULATION_RPC.startSimSession` (`start_sim_session`) | `StartSimSessionResponseSchema` |
| 2. A turn | the **Edge Function**, `feature: "ai_doctor"` | the function's JSON; the turn is stored server-side |
| 3. End | `SIMULATION_RPC.endSimSession` | `EndSimSessionResponseSchema` |
| 4. Coaching | the **Edge Function**, `feature: "ai_coach"` | `RecordSimCoachAnalysisResponseSchema` |

**Every refusal:**

| SQLSTATE | HTTP | Meaning | Screen |
| --- | --- | --- | --- |
| `22023` | 400 | **The scenario is not approved**, or its persona is not approved | *"This practice scenario is not ready yet."* **Not the rep's problem to fix** — it is an admin's |
| `42501` | 403 | The scenario is not in the rep's organisation | Treat as not found. Do not name it |
| `45011` | 403 | Practice not switched on, **or no approved `ai_doctor` prompt** | *"Practice is not switched on for your company."* |
| `45012` | 429 | Allowance spent | Actionable tomorrow |
| `23514` | 400 | A turn or analysis failed a record check | A failure message; a retry is safe |
| `28000` | 403 | Not authenticated | Sign in again |

**`C27`, and it constrains the screen rather than the API.** Scores are visible to **the rep and a
company admin only**. **No team average, no ranking, no percentile, and no score on any manager
screen** — not because the API hides it, but because building it would make the API's omission
pointless.

**C2 ruling: HOLD THE CONVERSATION SCREEN UNTIL `#5`. Build the list and the history now.**

This is the one case where the demo ruling bites. Every reply from the stubbed doctor is the literal
string `[PRACTICE STUB - no AI provider is configured; decision #5 is open, so no model was called]`
and every coach score is **0**. A practice conversation whose every turn is that sentence is not a
screen anybody can use or evaluate — it is a placeholder wearing a UI. **But the session list, the
scenario picker and a past session's turn history are all real today** and do not change when `#5`
lands. Build those.

---

### `BE-CR-5` — MR Chat (`mr_chat`) — **NEW in W1-I, built today**

**What it is.** The general in-app assistant: how a process works, where a screen is, what a policy
says. **It is explicitly not a product-information tool** (`AI-SPEC` §2 A1) — a product question
belongs in `BE-CR-3`, which is constrained to approved material and cites it.

**Who may call it.** Any authenticated user, subject to **its own** flag
(`ai_feature_enabled:mr_chat`) and **its own** approved prompt. It shares nothing with `product_qa`
but the daily allowance — proven by a test that turns `product_qa` on and shows `mr_chat` still
refusing.

**How to call it.**

```
POST {SUPABASE_URL}/functions/v1/ai-gateway
Authorization: Bearer <the MR's access token>
{ "feature": "mr_chat", "message": "...", "history": [{ "role": "rep"|"assistant", "text": "..." }] }
```

**`feature` is REQUIRED here** — omitting it silently gets you `product_qa`. **`history` is yours to
trim**; the backend does not decide a context window and does not store your history.

**What comes back.** `MrChatResult` (`packages/core/src/field/gateway/mr-chat.ts`):

| `kind` | What the screen shows |
| --- | --- |
| `answered` | `answer`. **No citations exist for this feature** — do not render a citation area and do not imply sourcing |
| `out_of_scope` | `MR_CHAT_OUT_OF_SCOPE_MESSAGE`, which already names Product Q&A. **Make it a link to that screen** — this is the one refusal with an obvious next action |
| `patient_specific` | `PATIENT_SPECIFIC_REFUSAL_MESSAGE`, verbatim |
| `failed` | `MR_CHAT_FAILED_MESSAGE`. A retry is safe |

**Refusals:** `22023`→**400** (no `message`), `45011`→**403**, `45012`→**429**, `28000`→403, no
token→**401**, `no_provider`→**503**. Same mapping as `BE-CR-3`; use `refusalForSqlState`.

**Two things the screen must not do, and they are not style preferences:**

1. **Do not present it as able to answer product or clinical questions.** The backend discards an
   answer that names one of your organisation's products — so a UI that invites those questions
   produces a redirect every time and teaches reps the feature is broken.
2. **Do not store the conversation anywhere the backend cannot see.** `ai_requests` holds tokens and
   flags and **never the message or the reply**, by design. If the app keeps a transcript locally,
   that transcript is a new data store with its own retention question, and nobody has answered it.

**C2 ruling: BUILD IT AGAINST THE STUB — and this is the clearest case of the three.** The stub
answers `inScope: false`, so every message returns `out_of_scope` with the redirect to Product Q&A.
**That is a correct, useful screen today**: the redirect is real, the link is real, and a rep who
types a product question gets sent to the right place whether or not a model exists. When `#5` lands,
in-scope questions start being answered and **nothing in the screen changes**.

---

### C2 — where the line sits, and which side a pilot rep is on

**The demo ruling was that a stubbed answer must not be shown to an audience**, because a plausible
sentence teaches the room the thing works. **A screen is not an audience** — a developer building
against a stub is not being misled, they are being unblocked.

**A rep in a pilot IS an audience, and is the most consequential kind.** An audience at a demo knows
it is a demo; a rep in a pilot believes the app. So:

| | Build now against the stub? | Show to a rep in a pilot? |
| --- | --- | --- |
| `BE-CR-3` Product Q&A | **Yes** | **Yes** — `not_available` is the truthful state of a company with no approved knowledge, not a stub artefact |
| `BE-CR-4` practice conversation | **No** | **No** — every turn is the stub marker |
| `BE-CR-4` list / history / picker | **Yes** | **Yes** — real today, unchanged by `#5` |
| `BE-CR-5` MR Chat | **Yes** | **Yes, with the flag off** — see below |

**The rule that resolves all four: a screen may reach a rep when the stub's behaviour is
indistinguishable from a legitimate real state.** `not_available` and `out_of_scope` are both states
a fully working system produces every day. The stub doctor's marker sentence is not — no working
system ever says it.

**And the flag is the mechanism, not a promise.** `ai_feature_enabled:mr_chat` ships **off**. A pilot
rep can have the screen installed and see nothing until somebody switches it on, which is `#5`'s
answer arriving. **That is why building now is safe: the shipping default is off, and the code enforces
it rather than a plan to remember.**

## Answers — 1 October 2026 (backend, W1-O) — two corrections

### Retention is NOT off. It is green — and green is not the same as working

**What was said (as relayed to backend; the note itself was not found on any branch of this
repository, including `fe-d12-final`):** the retention jobs have been off since 23 August.

**Measured today, with `gh run list` against this repository:**

| Workflow | State | Current run of consecutive successes | Last failure |
| --- | --- | --- | --- |
| `Audio retention` (`retention.yml`) | **active** | **135**, since 7 Sep 14:49 UTC | 23 Aug 08:15 UTC |
| `Audio retention watchdog` (`retention-watchdog.yml`) | **active** | **134**, since 7 Sep 15:01 UTC | 23 Aug 07:47 UTC |

**So the note was true from 23 August to 7 September and has been out of date for over three weeks**
— the gap is the recorded blackout, when both workflows were `disabled_manually`
(`.ai-collab/decisions.md`, "Retention workflows: disabled, then deployed and re-enabled").

**The finding that matters more.** The watchdog's own output, run `36821347402` at 05:46 UTC today:

```
"destroyedTotal": 0,
"liveObjectCount": 0,
"overdueObjectCount": 0,
Audio retention is healthy.
```

**The database these jobs point at holds no audio at all, and has destroyed nothing, ever.** So 135
green runs prove the job **runs**, not that it **works**: it has never had anything to delete. *"The
job is green"* and *"the job works"* are different claims, and only the first has evidence. That
database is whatever the `SUPABASE_DB_URL` repository secret names — backend cannot read the value, so
calling it production is the workflow's stated target, not something verified here. **Proving the
purge needs one audio object aged past `purge_after` in a staging project**, which `BE-C25` already
records as the gap a heartbeat cannot close.

### "CR-5" for voice-note deletion — already renamed `FE-CR-1`, and why it may keep happening

**This is not a new ruling.** It is `BE-C4` (29 September, above, line ~448): contract requests are
minted per track — **`BE-CR<n>`** and **`FE-CR<n>`** — and the voice-note item is **`FE-CR-1`**. It is
recorded in **`CLAUDE.md`**, the one file both tracks load before reading any code.

**Why it may recur anyway, and this is the real finding.** `CLAUDE.md` only reaches a track that works
**in this repository**. If the frontend is now working in a separate repository — which is what the
reviewer reports, and which would explain why this note was found on no branch here — **that
repository's sessions never load this rule**, and nothing will stop a fourth collision. **The fix is
for the frontend repository's own `CLAUDE.md` to carry the same two tables**, or for the work to come
back here (`docs/log/backend.md`, W1-O Part B). Backend cannot write to a repository it has not been
given.
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
