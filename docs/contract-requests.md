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
