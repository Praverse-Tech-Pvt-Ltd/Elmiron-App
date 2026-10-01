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
