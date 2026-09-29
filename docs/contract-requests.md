# Contract requests

**Append-only.** Requests from one track to another for something the requester cannot change
themselves: a shared contract shape (`packages/core`), a backend surface (API, migrations), or a
fact only the owner can check. Never edit or delete an entry. To change its status, append a new
dated line under it.

Each entry: **date · requester · owner asked · shape or answer needed · why · status.**

---

### CR-1 — Is `BACKUP_DESTINATION` set?

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

### CR-2 — Stale "30 September" deadline in a document frontend does not own

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

### CR-3 — Can an MR call the five functions that would replace the mock, and do they return the contract shapes?

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

### CR-4 — Should an approximate location fix be treated differently at check-in?

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
