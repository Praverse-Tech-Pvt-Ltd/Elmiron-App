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
| Mock position | **NOT `adb emu geo fix`** — it returns `OK` and delivers nothing. See the correction below. Use `adb shell appops set 2000 android:mock_location allow`, then `cmd location providers add-test-provider fused` / `set-test-provider-enabled fused true` / `set-test-provider-location fused --location <LATITUDE>,<LONGITUDE> --accuracy 12`, driven in a loop for the whole request window |
| Offline | Emulator airplane mode, or `adb shell svc wifi disable` / `svc data disable` |

The Doze and Standby commands are from the Android source above; the rest are standard
`adb`. The `adb emu geo fix` argument order — **longitude first** — is a known trap and
worth confirming on the device rather than trusting this line.

> **CORRECTED 11 September 2026 (MR-25 A3).** The line above was right to say "confirm on the
> device rather than trusting this line", and nobody did. `adb emu geo fix` **prints `OK` and
> delivers nothing** on this setup. MR-19 recorded it as a verified precondition on the strength
> of its exit code, having never completed a check-in to test it; MR-24 lost about an hour to it.
>
> `takeFix()` uses `Accuracy.Balanced`, which on Android reads the **fused** provider. During a
> real request `dumpsys location` shows `gps provider: ProviderRequest[OFF]`, `mStarted=false`,
> `Number of location reports: 0` — the GPS provider the emulator console feeds is never asked.
>
> **Verify, never assume:** `adb shell dumpsys location | grep "last location"` and check the
> `et=` elapsed time is ADVANCING. A frozen `et` means nothing is arriving. `last location=null`
> with nothing subscribed is normal.
>
> Note the argument orders are OPPOSITE: `geo fix` takes longitude first,
> `set-test-provider-location --location` takes **latitude first**.
>
> **A command that exits 0 is not a command that worked.** The wrong line is kept above, struck
> through in meaning rather than deleted, because the reason it was believed is the lesson.

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

## 4a. Answered — 2 September 2026

Recorded here rather than in a chat window, next to the questions they answer.

**1. Collection frequency and precision — DISCRETE FIXES ONLY.** A position is taken
when the MR presses check-in or check-out, and at no other time. Consequences,
accepted knowingly:

- No `ACCESS_BACKGROUND_LOCATION`, no location foreground service, no persistent
  notification, and **no Play Store background-location declaration**.
- **Mileage stays straight-line between visits and under-reports real travel.** That
  is a known, explainable property, not a defect to be fixed later by widening
  collection.
- **Phase 2's B4 cannot be built as drawn.** B4 is an arrival prompt fired by a
  geofence; a geofence needs background location. It becomes a manual arrival
  action the MR presses.
- **"2.4 km from here" and "11 min by bike" remain unbuildable** on B1, B3 and B9.
  Those need a position while the app is merely open, which this decision does not
  permit. Distance shown *at* check-in is a different thing and is server-computed.

**4 and 5. Denied or coarse-only permission — DEGRADE, and location is advisory.**
Taken from the design rather than invented: S4 states "The app fully works with
location denied", and the schema supports it — `geofence_status` has `unavailable`
as a legal value and `distance_from_clinic_metres` is nullable.

> **BLOCKED ON BACKEND.** The contract does not currently express this.
> `CreateCheckInRequestSchema.coordinates` is required and non-nullable, so a
> check-in with no fix cannot be sent at all. S4's promise is unimplementable until
> `coordinates` becomes nullable, or a `manual-no-fix` variant exists. Inventing a
> sentinel coordinate on the client is not an option: the server computes
> `distance_from_clinic_metres` from it, and a fabricated position becomes a
> distance in somebody's expense claim.

**2, 3 and 6 — narrowed, not closed.** With no background collection, 6 ("does
collection stop at shift end") has nothing to stop: the app never collects unless
the MR presses a button. 3 (the Play prominent-disclosure) is partly served by the
transparency screen, which is now built and reachable from home. 2 (location
retention) remains open and inherits the backend's disabled retention workflows.

### Two further decisions, taken the same day

**§3.6's never-build line stands.** No screen displays a transcript, analysis or AI
summary. The Coaching tab renders a placeholder saying the work is blocked, and the
call report is written by the MR rather than auto-drafted. Phase 1's `CitationSpan`
and `FindingCard` remain built, tested and unused.

**Availability inference is permitted.** B9's "best time to catch him" and B3's
"best window" may be derived **from the MR's own visit history** — when they went
and how long they stayed. This is scheduling help, not prescriber profiling: C14's
boundary stands, and nothing about what a doctor prescribes or about their patients
is recorded anywhere in this app.

### Three further decisions, taken 3 September 2026 — C5 and B7

Recorded when the last two Phase 2 frames were built, for the same reason the rest
of §4a is here: each is a place where the drawn design and the repository disagree,
and the disagreement is settled in writing rather than in a comment nobody reads.

**C5's UCPMP cap meter is NOT built, and must not be faked.** C5 draws "6 of 12
packs" against the monthly cap and states that "the app won't let you go past it".
Nothing in the repository can supply that ceiling: `samples_and_inputs` has no
limit column and no check constraint, `20260811000400_rls_policies.sql` grants a
plain `insert` with no cap predicate, and no endpoint or RPC computes a month to
date. `SampleAndInputSchema`'s comment that "UCPMP caps are enforced server-side"
describes an intention, not the schema as it stands.

`SamplesScreen` therefore takes an optional `cap` and a **required** `capNote`, and
today only the note is shown: the app says plainly that it is not counting and
tells the MR to keep their own count. A meter drawn from an invented number is the
worst thing this screen could contain — an MR who believes the app is holding the
compliance line stops holding it themselves, and hears otherwise as a finding with
their name on it. The meter is written and tested behind the `cap` prop, ready for
the day something authoritative answers.

> **BLOCKED ON BACKEND.** A monthly-cap read — the limit and the MR's month to
> date, per doctor — is what turns the note back into the control C5 draws.

**C5 asks the MR for the declared value, which C5 does not draw.**
`CreateSampleAndInputRequest.declaredValueInr` is required, and there is no product
catalogue in the contract, the schema or the mock to resolve it from. The two
available options were to ask or to post a zero. A zero is a false declaration into
a table that is append-only by grant and audit-logged by trigger, and cannot be
edited afterwards; the MR is also the one person who knows what they handed over.
So the field exists, is validated (digits, at most two decimal places — not
`Number()`, which accepts `''`, `0x10` and `1e3`), and is labelled as the MR's own
declaration. This is `MileageScreen`'s refusal to invent a rupee figure applied to
a *write*, which is why it is asked for rather than merely explained.

**B7 confirms a standing fact, not an event at 18:22.** B7 draws location being
switched off at the end of the day. Under §4a's discrete-fixes decision there is
nothing to switch off: a position is read on a check-in or check-out press and
never between them. Announcing a stop the app never needed would teach the MR that
it tracks them continuously — the precise belief the transparency screen exists to
correct. `DayEndScreen` therefore says "Nothing is being recorded" in the present
tense, and there is no "Start day tomorrow" action because there is no day to
start. C11's ordering is kept exactly: the confirmation is the first card, it
renders before the network answers, and a failed load leaves it standing with the
totals absent.

Three of B7's figures are also absent, each for a reason already recorded
elsewhere: the ₹627 needs a per-kilometre rate that exists in no contract; "ran
9h 27m" is clock arithmetic `today/plan.ts` rules out, so the two server stamps are
shown instead; and "6.2 MB data used" has no source, as `settings/content.ts`
already notes for the same figures on C4.

### Phase 3 — the consent handoff, decided 3 September 2026

The handoff screen itself is built: D1, D2, D4 as the three variants, D3 as the
legal layer, D5 as what the MR gets back. What follows is every place the design
and the repository disagreed.

**All three variants ship, and `columns` is the one turned on.** `CONSENT_VARIANT`
in `src/consent/content.ts` is the whole of switching. There is no experiment
framework in this app and inventing one to hold a single value would be the wrong
order of work — but the design's instruction is to test all three and *measure the
decline rate*, so all three are built and tested rather than one being chosen and
the others discarded. **A variant that produces near-total consent is not a good
result.** It is evidence the screen is applying pressure.

**The server's notice is on the face of the screen, verbatim, in every variant.**
This is the largest departure from the drawing. The design's screens are entirely
app-authored copy; `ConsentRecord` carries `consentTextVersionId` and
`displayedLanguage`, and `ConsentTextVersion` carries a SHA-256 of its own text, so
that what was agreed to can be reconstructed. A screen that showed only app copy
and pointed the record at some other version would make the ledger attest to text
the doctor never saw. So `getActiveConsentText` is fetched per visit, its
`fullText` is rendered, and the itemised facts, the one-sentence summary and the
two consequence panels are framing *around* it.

> **UNGUARDED, AND IT NEEDS A PROCESS.** The app-authored summary states terms — the
> retention period above all — that also appear in the notice. If a customer edits
> the notice on their server, nothing in this app can detect the disagreement.
> `content.test.ts` pins every term to one constant so the app cannot contradict
> itself, and both texts are on screen together so a human can catch it. That is
> the limit of what code can do here; the rest is a content-review obligation.

**No notice, no question.** `blockedReason` in `src/consent/record.ts` is a hard
gate: with no active version there is no `consentTextVersionId`, so the screen is
not shown, the doctor is not asked, and the MR is told why. A Yes with nothing
behind it writes a row nobody can reconstruct.

**The language is chosen on the screen, from what the server has.** The design sets
the doctor's language per territory in Settings; `TerritorySchema` has no language
field and neither does anything else in the contract. The MR picks instead, from
the languages `listConsentTextVersions` reports a live notice in — which is better
than a territory default anyway, because the MR knows which language *this* doctor
reads. A retired version (`effectiveUntil` in the past) is never offered.

**Landscape is deferred, not faked.** D1 and D4 are drawn 844 × 390. `app.json`
locks the app to portrait, `expo-screen-orientation` is not a dependency, and
adding it means a native module and a build that leaves Expo Go. Each variant's
information order survives the rotation, so they are laid out down the screen.

**`#16180F` is the committed hero ink instead.** Phase 1 bans a third grey; a
second near-black is the same drift. White on `#1F211C` is 16.25:1 against the
design's quoted 17.92, and the inversion's purpose — stop looking like the app the
doctor just watched the rep use — is untouched.

**Both answers are `secondary`, not a primary and a secondary.** The accent appears
nowhere on a consent face. `OverrideControl` already established that a genuine
either/or gets two identical `secondary` controls, and §05 allows no fifth button
variant to be invented. "Give the phone back" is a muted pressable rather than
`Button variant="quiet"`, because `quiet` renders its label in the accent green.

**D6 and D7 are NOT built, and must not be until audio capture exists.** The
recording bar and the voice note are the two frames in Phase 3's "After" section
that depend on capturing audio. This app has no audio dependency at all — no
`expo-av`, no `expo-audio` — and §5 below already places audio capture, voice
notes and resumable upload in FE-W4.

> Building the indicator now would put a bar reading "Recording · he agreed at
> 11:58" on screen while the app captured nothing. On this product that is not an
> unfinished feature, it is a false statement to a doctor who has just been asked
> to trust it, and it is the single worst thing in this repository to ship early.
> `RecordingIndicator` remains built, tested and deliberately unrendered.

The consequence is visible rather than hidden: after a doctor consents, the visit
screen says in as many words that recording is not in this build and nothing is
being captured. An MR who believed otherwise would speak as though it were.

### Phase 1 — the typeface, closed 3 September 2026

**The app shipped in Roboto for three phases.** Phase 1 §03 is titled "DM Sans, 400
minimum, no exceptions"; every size, weight, line height and tracking value in the
scale was implemented, and no font file was ever loaded. There was no `expo-font`
dependency, no `fontFamily` token and no `fontFamily` on any component, so every
screen rendered in the platform face. Nothing caught it, and nothing was going to:
the platform font at the right size and weight looks like a deliberate choice, and
a test asserting `fontSize` passes either way.

Now: `@expo-google-fonts/dm-sans` supplies four faces, `app/_layout.tsx` registers
them, and `tokens.font` maps each weight to its family name. **Android does not
synthesise a weight from a family** — each weight is a separately registered family
and `fontWeight` alone gets whatever single face the system matched — so
`fontFamilyFor(weight)` is the only way a component may reach for one, and
`tokens.test.ts` asserts every role in the scale resolves to a `DMSans_` family.
Four faces and not nine: §03 bans DM Sans below 400 anywhere, and nothing in the
scale reaches 800.

The first paint waits for the faces, because letting them swap in afterwards
reflows every screen a beat late — on sign-in that moves the field the MR is
already typing into. A load *failure* does not block: the app comes up in the
platform font rather than not at all, since a missing typeface is a cosmetic
failure and refusing to start over one would make it a total failure in the field.

**`StatusGlyph` is deliberately excluded and must stay excluded.** Its four marks
are U+2713 and U+2715 rather than letters. A webfont that happens not to carry a
codepoint renders tofu, and a tofu box where a synced tick belongs is worse than a
tick in the platform's face — which is guaranteed to have them on every OEM build
this product targets. The mark never carries meaning alone (§02, and `ListItem`
requires a `detail` string beside it), so the face it renders in is cosmetic while
a missing codepoint would not be.

**The "one Cormorant moment" is NOT built, and this is a decision.** §03 reserves
Cormorant Garamond for a login splash reading "Relief at the root." That is brand
copy for a pharmaceutical mark this company may not have the right to use:
`docs/brand-identifier-decision.md` records that **ELMIRON® is a third party's
registered trademark** (IVAX Research, LLC; associated with Janssen), and commit
`f34ceef` removed it from the permanent identifiers for exactly that reason. The
display name is a freely-changeable string defaulting to a neutral one. Putting the
tagline on the first screen every user sees would reintroduce what that work took
out, so the splash waits on the trademark ruling — open item O2 — and not on
engineering.

**Three primitives are now pinned.** `IconButton`, `TextField` and `Card` had no
test of their own. All three were exercised through the screen suites, so they were
never untested — only unpinned: no test named the rule each exists to enforce, and
a change that broke the rule while keeping the screens rendering would have gone
through green. `primitives.test.tsx` asserts the rules themselves — a glyph never
appears without words, the label is a sibling and not a placeholder, the error
carries the correction, offline is a dashed edge and never a warning colour.

**And one defect found by looking at the running app:** the sync indicator rendered
its timestamp raw — "Everything sent 2026-09-03T08:57:43.905Z" on the home screen,
milliseconds and Z suffix included. Worse than ugly: the Z is UTC, so an MR in IST
was shown a time five and a half hours from the one on their own clock.
`indicatorStateFor` now formats through `clockFrom`, which slices the characters
and keeps the offset the server sent.

### Phase 4 — §3.6 partially reversed, 3 September 2026

> **THIS IS A REVERSAL OF A REGULATORY DECISION AND IT IS RECORDED HERE ON
> PURPOSE.** `frontend-plan-v2.md` §3.6 lists "any screen that displays a
> transcript, analysis or AI summary" under *never build*, and §4a above records
> that line being put to a human on 2 September 2026 and **upheld**. On 3 September
> it was put again, with Phase 4 attached, and was **reopened for the MR's own
> screens only**. A regulatory line that moves silently is worse than one that
> never moved, so the scope of the reversal is written out below rather than being
> inferred from what happens to exist in the repository.

**Reopened.** D1, D2 and D3 — the MR's coaching feed, their own analysis with its
citations, and their reply. The MR reading an analysis *of themselves*, before
anyone acts on it, is the half of the design that exists to make the system
contestable.

**Still closed at that point.** E1 and E2 — the manager's coaching queue and the
analysis review with its override — were left closed by the first reversal.

> **SECOND REVERSAL, THE SAME DAY.** E1 and E2 were put again, separately, and
> **reopened**. Both are now built, in `apps/console`. The two reversals are
> recorded as two because they were two decisions: the first covered the MR
> reading an analysis of themselves, the second covers a manager reading one about
> somebody else, and those are not the same question. Anyone auditing this should
> be able to see that the second was asked and answered on its own.

What the manager's screens are built to refuse:

- **The advisory notice is the first thing on the queue and cannot be dismissed.**
  A manager arriving there is about to read a machine's judgement of a named
  person.
- **The MR's reply status is a table column, not a detail on the next screen**, so
  a manager cannot open a finding without already knowing the MR answered it — and
  on E2 the reply itself sits between the citation and the controls, in reading
  order, never behind a disclosure.
- **Agree and Disagree are identical controls and agreeing writes nothing.** There
  is no `agree` endpoint and there should not be: agreement is the absence of an
  override, and manufacturing a row for it would turn every unreviewed finding into
  an implied endorsement the moment somebody wanted a metric out of it.
- **A reason is required to disagree.** `CreateAnalysisOverrideRequestSchema.reason`
  is `.min(1)`; an override with no reason proves a click happened, not that
  anybody thought — and this row is the evidence of human oversight.
- **The queue is a filter, not a league table.** Rows appear because a category
  recurred, sorted by MR id, which is meaningless on purpose. "Most findings first"
  would be a ranking wearing a sort order as a disguise. There is no per-MR consent
  percentage anywhere: `manager.ts` calls a consent anomaly a `data_quality`
  signal, and an MR at 100% is surfaced as a possible fraud signal rather than as
  the top of a list.

`FindingCard` and `OverrideControl` in `packages/ui` **remain unrendered** — the
console is React Native-free, so E2's override is a web form built from the shared
tokens. Those two components are still waiting for a React Native surface that
wants them.

**Never reopened, and not part of this at all: the scoring ban.** §3.6's first
bullet — no ranking, score, rank, percentile or grade, "not for MRs, not in the
console, not 'just a sort order'" — was not in question and has not moved.
`src/coaching/feed.ts` carries the ban at the top of the file, `trendFor` has no
parameter another person's number could enter through, and both the logic and the
render suites assert the absence.

**What the MR's screens show, and what they refuse to.**

- **The sampling ratio is on the feed.** "3 visits reviewed of 42" is the design's
  own addition against the brief, and its argument holds: an MR who believes every
  visit is analysed behaves like someone under total observation. The reviewed
  count is never rendered without the total beside it.
- **Every finding carries its citation, and a finding without one is not shown.**
  `FindingCitationSchema`'s array is `.min(1)`, but Zod's minimum does not reach
  the TypeScript type — so a server that broke the rule would arrive as a claim
  about the MR with nothing behind it. Dropping it is the lesser harm; rendering an
  assertion the MR cannot check is the thing the citation exists to prevent.
- **Nothing is truncated.** "Two worked, one to try — never a list of six
  failures" is an obligation on the rubric, not on the screen. A UI that hid the
  sixth would be hiding a finding the MR has a right to contest.
- **No quote can be played and no reply can be spoken.** Both need the audio
  pipeline in FE-W4. `CitationSpan.onPlay` is omitted and D3's "hold to say it
  instead" is absent, each with a sentence saying why — a dead play control would
  tell an MR a recording of them exists.
- **A refusal is shown as a refusal.** `AnalysisStatus` has `refused` as a
  first-class value and the contract calls it correct behaviour when the model
  cannot cite without speculating. It renders as the system declining to guess,
  never as an error.

### Phase 4 — the console, stood up

`apps/console` was a placeholder holding one file. It is now a Next.js app: the
compact-density scale Phase 4 asks for (`compactTypography` in `ui-tokens`, every
step chosen rather than multiplied off the phone scale), a small set of web
elements built from the shared colour, space and radius tokens, and **E3**.

**`@fieldforce/ui` is deliberately not used there.** It is React Native; rendering
it in a browser means `react-native-web` and a second rendering target to maintain
for the life of the product, for components whose brief is a phone in one hand.
Phase 4 asks for the same *tokens* at compact density, not the same components.
The tokens are the contract; the components are not.

**E3 is the only Phase 4 console screen that may exist**, and it was never blocked:
consent versions, audit and retention show no transcript, no analysis and no AI
output. One of its three panels has data behind it and two do not — there is no
audit-log path and no retention path in `API_PATHS`, so those panels name what is
missing instead of printing the design's illustrative "41 recordings purged" and
"90 days" as though a server had said them.

**DM Sans is not loaded in the console.** The field app registers four faces
through `expo-font`; the web equivalent is `next/font` and a decision about
self-hosting, and a half-applied typeface would be worse than the honest system
stack it falls back to.

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
