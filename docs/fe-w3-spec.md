# FE-W3 — Field capture: specification

**Written 31 August 2026. This is a specification, not a plan and not an approval.**
No FE-W3 code exists and none should be written until §4 is answered.

The reason for writing it first: what is collected, how often, and on what basis
determines the schema, the sync protocol and the retention rules. Build first and all
three get written against an assumption nobody made deliberately.

---

## 0. What the repository already commits to

The backend is **not** greenfield here. It already implements a specific model of field
capture, and that model is narrower than "tracking" — which makes the decision in §4.1
a real fork rather than a formality.

### 0.1 Contract — `packages/core`

| Schema | Shape | Notes |
| --- | --- | --- |
| `CoordinatesSchema` | `latitude`, `longitude`, `accuracyMetres` (nullable), `capturedAt` | `shared/primitives.ts`. No altitude, speed, bearing or provider. |
| `CheckInSchema` | id, visitId, mrId, coordinates, `geofenceStatus`, `distanceFromClinicMetres`, `source`, `occurredAt`, `receivedAt`, `createdAt` | `geofenceStatus` and `distanceFromClinicMetres` are **computed server-side**; the comment in the file is explicit that a client-reported distance "is an expense claim it wrote itself". |
| `CheckOutSchema` | as check-in, plus `durationSeconds` (nullable) | |
| `GeofenceStatusSchema` | `inside` / `outside` / `unavailable` | `unavailable` already exists — the contract anticipates a fix that could not be obtained. |
| `CaptureSourceSchema` | `automatic` / `manual` | "Whether the geofence fired it or the MR pressed a button. Both are recorded." |
| `SyncEntitySchema` | visit, check_in, check_out, call_report, consent_record, voice_note, recording, sample_and_input | **There is no location-fix entity.** |

### 0.2 Database — `services/api/supabase/migrations`

`public.check_ins` and `public.check_outs` (`20260811000100_commercial_schema.sql`)
carry `latitude`/`longitude` as `double precision not null`, `accuracy_metres`
nullable, `geofence_status` not null, `distance_from_clinic_metres` nullable,
`occurred_at` not null, and `received_at` — added in
`20260812000100_field_operations.sql` and stamped by the `stamp_received_at` trigger
rather than trusted from the client. `check_outs.duration_seconds` came from the same
migration.

**There is no location-fix, location-trace or breadcrumb table.** Thirty-four tables
exist; none stores a position that is not attached to a check-in or check-out.

**Mileage is derived, not tracked.** `public.daily_mileage()`
(`20260812000100_field_operations.sql:427`, revised in
`20260815000100_thresholds_and_shift_defaults.sql`) sums straight-line hops between
consecutive `check_ins` rows, partitioned by MR and local calendar day. It reads no
other source of position.

**Retention: location has none.** The purge machinery — `purge_after`, the retention
worker, `audio_purge_runs`, `audio_destruction_log`, and the intake-stops-if-retention-stalls
check in `20260816000300_resumable_upload.sql` — applies to `recordings` and
`voice_notes` only. Check-in and check-out coordinates have **no TTL, no purge column
and no deletion path**. They persist for the life of the row.

### 0.3 Mock — `services/mock`

Fixtures already assume the discrete-fix shape: each `checkIns` entry carries a single
`coordinates` object, one visit fixture carries `coordinates: null`, and the mileage
fixture is a per-day aggregate (`checkInCount: 6, distanceMetres: 41280.4`). The
sync-queue fixture carries a check-in payload of exactly
`{ visitId, latitude, longitude }`.

### 0.4 Contradictions found

**None between `packages/core`, `services/api` and `services/mock`.** Field for field
the three agree, including the server-computed fields and the nullability of
`accuracyMetres`. The apparent absence of `received_at` and `duration_seconds` from the
original `create table` is resolved by a later migration, not a divergence.

The thing worth stating plainly is not a contradiction but a gap: **every layer of this
repository describes discrete, visit-attached fixes, and nothing in it describes
continuous tracking.** If §4.1 is answered "continuous", that is new schema, a new sync
entity, a new retention rule and a new necessity argument — not a client-side feature.

---

## 1. The capture surface

| # | What | Trigger | Precision | Frequency | Works backgrounded? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Visit check-in** | MR taps, or geofence entry fires it (`source` records which) | `ACCESS_FINE_LOCATION` if the geofence radius is tight; coarse is ~3 km² and cannot decide "at this clinic" | Once per visit | Tap: no, the app is open. Geofence: **only with background permission and a `location` foreground service** |
| 2 | **Visit check-out** | Same, plus geofence exit | Same | Once per visit | Same |
| 3 | **Call report submission** | MR submits a form | No location | Once per visit, possibly long after it | Not needed — queued, sent when possible |
| 4 | **Location fixes between visits** | Nothing today. Would be a timer or a displacement threshold | Undecided | Undecided | **Requires a persistent foreground service.** See §4.1 |
| 5 | **Audio** | Out of scope here — see §5 | | | |
| 6 | **Offline queue of 1–4** | Any of the above while offline | n/a | n/a | Enqueue must survive process death; the flush needs network |

Rows 1–3 and 6 are what the repository already supports. **Row 4 is the decision.**

---

## 2. What Android permits, and what it costs

Sources are linked inline. Anything not sourced is marked **unverified** and should be
treated as a claim to check, not a fact.

### 2.1 The three location permissions

- `ACCESS_COARSE_LOCATION` gives "a device location estimate ... accurate to within
  about 3 square kilometers". `ACCESS_FINE_LOCATION` gives "as accurate as possible ...
  usually within about 50 meters and is sometimes as accurate as within a few meters".
  A clinic geofence cannot be decided on coarse.
  ([Location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions))
- **The user's choice overrides the manifest.** "If the user grants the approximate
  location permission, your app only has access to approximate location, regardless of
  which location permissions your app declares." Upgrading to precise is a separate
  request. (same source)
- `ACCESS_BACKGROUND_LOCATION` is required from **Android 10 (API 29)**. On
  **Android 11 (API 30) and higher the system dialog does not include "Allow all the
  time"** — "users must enable background location on a settings page". The app
  therefore cannot obtain background location from a prompt at all: it shows a
  rationale, then sends the user into Settings, naming the label returned by
  `getBackgroundPermissionOptionLabel()`.
  ([Background location](https://developer.android.com/develop/sensors-and-location/location/permissions/background))
- **Background inherits foreground precision:** "If the user grants your app the
  `ACCESS_BACKGROUND_LOCATION` permission but grants only approximate location access
  in the foreground, your app has only approximate location access in the background as
  well." (same source)

**Consequence for design:** background location is a two-stage, two-screen flow with a
trip through system Settings, and it can be silently degraded to ~3 km² accuracy by a
choice made on a different screen. Anything assuming a precise background fix must
treat "granted, but coarse" as a normal state.

### 2.2 Denial, and "Only this time"

- **"Only this time"** grants access for "that individual session of app usage". The
  documentation frames it by session rather than by a stated duration; the precise
  expiry conditions — process death, screen off, a timeout — are **unverified**. I did
  not find a primary source stating them exactly, and they should be measured on a
  device rather than assumed.
- **Denial** leaves the app with no fix. `geofenceStatus: 'unavailable'` already exists
  in the contract for exactly this, which is the right shape — but what the *app does*
  then is §4.4, not an engineering default.
- **Permission auto-reset for unused apps** is a real Android behaviour, but no primary
  source was retrieved in this pass: **unverified here.** It matters for a field app
  that may go unopened for weeks, and should be confirmed before anyone relies on a
  once-granted background permission staying granted.

### 2.3 Doze and App Standby

Named mechanisms, not "background tasks may be delayed"
([Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)):

- In Doze the system **suspends network access**, **ignores wake locks**, **defers
  `AlarmManager` `setExact()` and `setWindow()` alarms**, **does not run WiFi scans**,
  **does not run sync adapters**, and **does not run JobScheduler jobs** — which means
  **WorkManager too**, since it delegates to JobScheduler.
- Deferred work runs in a **maintenance window**: "the system runs all pending syncs,
  jobs, and alarms, and lets apps access the network", and those windows become **less
  frequent over time**.
- Exempt: `setAndAllowWhileIdle()` and `setExactAndAllowWhileIdle()` (**at most once
  per nine minutes per app**), `setAlarmClock()`, **high-priority FCM messages**, and any
  app with a foreground activity or **foreground service**.
- App Standby: an idle app gets network "about once a day"; plugging in releases it.

**Consequence:** a sync flush scheduled with WorkManager is not a background uploader.
It is a best-effort job that may wait hours. The queue must be designed so latency is
normal and visible — which is the position `packages/ui`'s queue screen already takes.

### 2.4 Foreground service for location

([Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types))

- From **Android 14 (API 34)**, "you must declare an appropriate service type for each
  foreground service."
- Type `location` requires the manifest permission `FOREGROUND_SERVICE_LOCATION`, **and**
  at least one of `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` granted at runtime,
  **and** location services enabled on the device.
- **"You cannot create a `location` foreground service while your app is in the
  background, unless you've been granted the `ACCESS_BACKGROUND_LOCATION` runtime
  permission."**
- A foreground service shows a persistent notification. Its exact presentation on
  Android 13+ — dismissibility, the "active apps" affordance — is **unverified here**
  and should be checked on a device before any copy is written for it.

### 2.5 Google Play obligations

([Location permissions policy](https://support.google.com/googleplay/android-developer/answer/9799150))

Requesting `ACCESS_BACKGROUND_LOCATION` triggers a **permissions declaration** in Play
Console. Required: the declaration form; **a video of 30 seconds or less** showing the
feature, the disclosure and the runtime prompt; a **prominent in-app disclosure**
"displayed in the normal usage of the app and not require the user to navigate into a
menu or settings"; and a privacy policy in-app and on the listing. "Without that
approval, app updates may be blocked and your app may be removed from Google Play."

The listed acceptable uses are user-benefiting features — family safety, fitness,
delivery tracking, weather alerts. **An employee-monitoring framing is not among
them.** Whether this app's use is approvable is a review outcome nobody here can
predict. `docs/mr-work-split.md` already records the analogous Apple problem and the
probe-early response; the same logic applies. **The Play declaration should be
submitted before the feature is finished, not after.**

### 2.6 OEM battery restrictions

The pilot handsets are most likely Xiaomi, Oppo, Vivo and Samsung, which is the worst
case for background work.

**This behaviour is not officially documented by the OEMs.** The reference is
[dontkillmyapp.com](https://dontkillmyapp.com/), a crowd-sourced catalogue; its Xiaomi
page states that these are "non-standard background process limitations" with "no APIs
and no documentation for those extensions". Everything in this subsection is therefore
**empirical, not specified**, and can change with an OEM update without notice.

Named, for Xiaomi/MIUI–HyperOS: a separate **Autostart** permission (Settings → Apps →
app → Background autostart on MIUI 14+); **battery saver** and "Ultra battery saver"
terminating background processes unless the app is set to **"No restrictions"**; a
**Protected apps** list; and a developer-settings **MIUI optimization** toggle the site
reports as breaking background tasks. Oppo/ColorOS, Vivo/FuntouchOS and Samsung/OneUI
each have equivalents; **their specifics are unverified in this pass** — only the
Xiaomi page was read, and the others should be read before onboarding copy is written.

`docs/mr-work-split.md` already budgets per-OEM onboarding screens in week 3 and calls
the resulting support cost permanent. Nothing found here contradicts that.

---

## 3. What can be tested where

### 3.1 Unit-testable — no device, no emulator

- Queue ordering, deduplication by device-generated id, idempotent re-submission.
- Retry backoff schedule and the attempt counter (`LONG_RETRY_AFTER_ATTEMPTS`, today
  display-only).
- Payload shaping: `Coordinates` → `RecordCheckInBody` (`p_latitude`, `p_longitude`, …),
  already implemented as `toRecordCheckInBody`.
- Reducer transitions, including permission state modelled as an input.
- Anything that consumes a fix. **A fix can be a fixture.**

### 3.2 Emulator-testable — with the command

| What | Command |
| --- | --- |
| Doze deferral | `adb shell dumpsys deviceidle force-idle`, then `… unforce`, then `adb shell dumpsys battery reset` |
| App Standby | `adb shell dumpsys battery unplug`; `adb shell am set-inactive <pkg> true`; `adb shell am get-inactive <pkg>` |
| Process death mid-queue | `adb shell am kill <pkg>` |
| Permission revocation | `adb shell pm revoke <pkg> android.permission.ACCESS_FINE_LOCATION` (and `ACCESS_BACKGROUND_LOCATION`) |
| Granting background without the UI | `adb shell pm grant <pkg> android.permission.ACCESS_BACKGROUND_LOCATION` — this **bypasses the Settings trip a real user must make**, so it exercises the code path and not the flow |
| Mock position | Emulator extended controls, or `adb emu geo fix <longitude> <latitude>` |
| Offline | Emulator airplane mode, or `adb shell svc wifi disable` / `svc data disable` |

The Doze and Standby commands are from the Android source above; the rest are standard
`adb`. The `adb emu geo fix` argument order — **longitude first** — is a known trap and
worth confirming on the device rather than trusting this line.

### 3.3 Physical-device-only — nothing else will do

- **Real GPS drift.** An emulator returns the coordinate it was given. It cannot produce
  the 60-metre urban-canyon fix that puts an MR outside a geofence they are standing
  inside — which is the failure that matters, because it becomes a disputed visit
  record.
- **OEM battery killers.** Undocumented by definition and vendor-specific; an AOSP
  emulator has none of them.
- **All-day battery drain** with a location foreground service running a full field day.
- **The real background-permission flow**, including the Settings trip and the label
  `getBackgroundPermissionOptionLabel()` returns on a vendor skin.
- **Whether the persistent notification is tolerable** to the person carrying the phone.

This list is why a handset is on the critical path, and it does not shorten by writing
more tests.

---

## 4. Decisions required before any code is written

> **These are policy decisions with legal consequences under India's DPDP Act and
> employment law. They are not engineering choices. They require a human decision and,
> on the collection-necessity and consent questions, qualified legal advice. No code
> should be written against an assumed answer.**

**1. Collection frequency and precision.** Fixes only at check-in and check-out, or
continuous tracking through the shift?

- *Discrete fixes only* — what the schema, the contract and `daily_mileage()` already
  implement. No foreground service, no persistent notification, and **no Play
  background-location declaration**, because `ACCESS_BACKGROUND_LOCATION` is not needed
  when the app is open and the MR taps. Mileage stays straight-line between visits and
  under-reports real travel: a known, explainable property.
- *Geofence-triggered check-in* — needs background location and a `location` foreground
  service, therefore the Play declaration and the notification, while storing no more
  data than the option above.
- *Continuous tracking* — all of the above **plus** a new table, a new `SyncEntity`, a
  new retention rule, and a necessity argument. Nothing in the repository anticipates
  it today.

**2. Retention of location data.** How long, and what deletes it? Today the answer is
"forever, nothing": `check_ins` has no `purge_after` and no purge path, while audio has
an enforced 90-day one. **Dependency, not something to fix here — the backend's
retention workflows are currently disabled** (`.ai-collab/decisions.md`, 23 August), so
even the audio path is not running. Any location retention rule inherits whatever
reliability that machinery turns out to have.

**3. What the MR is told, and when.** A runtime permission prompt is not a disclosure.
Play policy separately requires a prominent in-app disclosure during normal usage. Who
writes it, what it says about who can see the data, and whether it is shown once or
reachable at any time, are all decisions — and `docs/mr-work-split.md` already commits
to a tracking-transparency screen one tap from home.

**4. What happens when permission is denied, or granted coarse-only.** Degrade (visit
valid, `geofenceStatus: 'unavailable'`), refuse (no check-in without a fix), or escalate
(the manager is told)? A product decision with an employment-relations dimension: the
escalate option turns a phone setting into a disciplinary signal.

**5. Is location required for a visit to be valid, or advisory metadata?** If required,
a denied permission or a failed fix blocks the MR's work and the geofence radius becomes
an adjudication rule. If advisory, `distance_from_clinic_metres` is evidence a human
interprets. The schema supports either — `geofence_status` is not null, but
`unavailable` is a legal value.

**6. Does background collection stop at shift end, and what enforces it?**
`territory_shift_windows` exists server-side with per-territory timezone and grace
minutes, and Gate FE-G1 requires that "location capture visibly stops at shift end".
Client-side stopping is the client honouring a rule; server-side rejection is
enforcement. Which one is promised to the MR changes what the app must show.

---

## 5. What this specification does not cover

Named so that scope does not expand quietly:

- **Audio capture** — recording, voice notes, resumable upload, the consent gate. It has
  its own schema (`recordings`, `voice_notes`, `upload_grants`), its own retention, and
  lands in FE-W4. The only overlap is that both compete for the same background
  execution budget.
- **Adverse-event reporting paths.** `adverse_event_reports` and the fifteen-day
  statutory clock exist server-side; nothing here touches them.
- **Anything HCP-facing.** No screen described here is shown to a doctor; the consent
  handoff is a separate surface with a separate design brief.
- **The lawful basis itself.** This document states what Android permits and what the
  repository implements. It does not argue what is permissible under the DPDP Act, and
  nothing in it should be read as having done so.
