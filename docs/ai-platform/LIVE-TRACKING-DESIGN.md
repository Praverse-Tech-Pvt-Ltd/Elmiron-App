# Live tracking — the design, before anything is built

**1 October 2026, W1-N Part C. Operator decision `BE-C45` (A-5):** *live tracking YES — only during
active working hours, visibly to the MR, under a SEPARATE privacy notice and consent, stopping outside
working hours. Check-in and check-out GPS continues regardless.*

**Nothing in this document is built (C5), on purpose.** A half-built background location service that
drains batteries is worse than none, and this project's rule is that what exists must be reached by
something. It needs three things engineering cannot invent: **a dependency decision (C2), an approved
notice (C4, `operator-inputs.md` Q-12), and a physical handset (C3).**

**⚠ Platform facts below are marked.** Android and Play policy change; where a statement rests on my
knowledge rather than a document read in this session it says **[verify]**, and each must be checked
against the current Android, Expo and Google Play documentation before building.

---

## C1 — the four conditions, and what ENFORCES each

| Operator's condition | Enforced by | Where | Kind |
| --- | --- | --- | --- |
| **1. Only during active working hours** | **Two independent checks — the device decides when to COLLECT, the server decides what to KEEP.** (a) The app starts and stops collection from the MR's **effective shift window**, which the server already resolves per territory with a company default (`my_shift_window()` → `resolve_shift_window()`, `BE-C50`). **The app already calls `my_shift_window()`** (`apps/field/src/today/shift-window.ts:38`) **but today reads only the timezone from it, deliberately** — its comment says the bounds belong to the server. Tracking would read the bounds too, **for scheduling only**; the server stays the authority through (b). (b) **The server refuses every point stamped outside that window** and logs the refusal as a countable `write_rejections` row (the `BE-W129` mechanism, a new entry point) — so a phone whose clock is wrong, whose stop timer was killed, or whose app is old **still cannot get an out-of-hours position stored** | (a) `apps/field` — a scheduler; (b) a new ingest RPC, server-side | a check, twice |
| **2. Visible to the MR** | (a) **Android requires it**: continuous location in the background runs as a **foreground service with a persistent notification** the user cannot dismiss while it runs **[verify — Android 14 also requires the `location` foreground-service type]**. (b) **An in-app indicator** on the home screen: *"Location sharing ON until 18:00"*, with the time from the server's window, not the device's | (a) the OS; (b) `apps/field` home screen | a screen, and an OS rule |
| **3. A SEPARATE notice and consent** | (a) **Its own notice text**, versioned and four-eyes approved like every other content type — never born approved (C4). (b) **Its own consent record per MR**, separate from the doctor-consent ledger (`consent_records` is about doctors and must not be overloaded). (c) **The ingest RPC refuses every point from an MR with no current tracking consent** — so consent is enforced where the data lands, not only on the screen that asks for it. (d) **Withdrawal stops collection on the next sync and refuses further points at once** | (a)/(b) new tables, server; (c) the ingest RPC; (d) both | a setting + a check |
| **4. Stops outside working hours** | The same two halves as condition 1. **The device stops** (a scheduled stop at the window's end, plus a check on every location callback that drops and stops if outside the window); **the server refuses** anything late regardless | `apps/field`; ingest RPC | a check, twice |
| **— Check-in / check-out GPS continues regardless** | **Unchanged.** `record_check_in` / `record_check_out` stay as they are, under the existing visit flow and its own notice. Tracking consent being absent or withdrawn **must not** affect them — tested as a two-sided case when built | existing | — |

**So who decides when tracking stops? Both, and that is the point.** The **device decides when to
collect** (it is the only thing that can turn the GPS off and save the battery); the **server decides
what is kept** (it is the only thing that cannot be wrong about the time or be killed by a battery
manager). Either alone fails: device-only trusts the phone's clock and an OEM's scheduler; server-only
drains the battery collecting points it will throw away.

### What the build would add — for scale, not for building now

* **Tables:** `tracking_notice_versions` (four-eyes, like `consent_text_versions`);
  `tracking_consents` (per MR, append-only, withdrawal as a later row); `location_points`
  (`mr_id`, `organisation_id`, `recorded_at`, `received_at`, lat/lng, accuracy) with RLS.
* **One ingest RPC** — the only write path — refusing: no consent; outside the window; future
  timestamps beyond the existing 120-second tolerance; implausible accuracy. **Every refusal a
  `write_rejections` row.**
* **One app module** — scheduler + foreground service + the indicator + the consent screen.
* **One console view** — the live map, using the Maps JavaScript API (`operator-inputs.md` Q-2).

### Decisions the notice cannot be written without — asked in Q-12

These are not engineering choices, and **the notice draft leaves them as blanks rather than inventing
them:**

1. **Who sees an MR's live position?** Their manager, the company admin, both? **This is the question
   `BE-C13` answered NO for practice scores** — a manager watching an employee's position is employee
   monitoring of the same kind, and the operator's A-5 answer did not say who views it.
2. **How long are positions kept?**
3. **How often is a position taken** (every minute? every 5?) — it trades accuracy against battery.
4. **What happens if an MR does not consent, or withdraws?** Is tracking a condition of the job? That
   is an HR and legal question, and the notice must state the answer truthfully.

---

## C2 — the dependency: options, money, permissions, Play Store. AN ASK, not a choice

**Background location is not a capability this project has.** Measured: `apps/field/package.json`
has **`expo-location` (`~57.0.14`)** — used today for foreground check-in — and **not**
`expo-task-manager`, which Expo's background location requires.

| Option | Money | Permissions it needs | Notes |
| --- | --- | --- | --- |
| **A. `expo-location` + `expo-task-manager`** (Expo's own: `startLocationUpdatesAsync` with a foreground service) | **Free** (MIT) | `ACCESS_FINE_LOCATION`; a `location`-type foreground service; **Expo's background updates request background location permission** — "Allow all the time" **[verify for SDK 57]** | One new package, from the same vendor as the rest of the app. **No motion detection**: it reports on a time/distance interval, so it spends battery while the MR is still. **The recommendation**, because it is the smallest new dependency and the operator's conditions are time-boxed |
| **B. `react-native-background-geolocation`** (Transistor Software) | **A paid licence is required for Android release builds** — the price is not quoted here because I could not verify the current figure **[verify on the vendor's site]** | Same Android permissions | Motion-detection to stop the GPS when the phone is still, so materially better battery behaviour; mature on difficult OEM handsets. **A commercial dependency with a licence to manage** |
| **C. Our own native foreground service** | Engineering time only | Same | Most control, most code, and the battery engineering B already did — **not recommended** for a 4 October date |

**What Google Play requires for BACKGROUND location** **[verify against the current Play policy page
before submitting]**:

* A **Permissions Declaration Form** in Play Console explaining why background location is needed;
* a **prominent in-app disclosure shown BEFORE the runtime permission prompt**, in the app's own words;
* usually **a short video** of the feature in use;
* the use must be a **core** feature of the app; **review can take days and can be refused.**

**A design option that may avoid most of this, to verify before choosing:** on Android, location
collected by a **foreground service that the user starts while the app is open** is treated as
"while-in-use" access, which **may not require the background-location permission or the Play
declaration at all** **[verify — and verify whether Expo's API in option A requests background
permission regardless]**. It fits the operator's conditions well: the MR starts tracking visibly at the
start of the working day, and the notification stays up until it stops. **If it holds, it is the
cheapest compliant route.**

### ⚠ A recorded finding the operator's YES runs straight into

**Found during W1-N by sweeping the tests, not by recollection.** The field app already PINS
background location as forbidden: `apps/field/src/onboarding/no-background-location.test.ts` scans
the app's source and fails on `ACCESS_BACKGROUND_LOCATION`, `requestBackgroundPermissionsAsync`,
`startLocationUpdatesAsync` and three others. The reason is recorded in
`apps/field/src/onboarding/permissions.ts:138-153`, citing `FE-W3-SPEC` (31 August):

> *"the permission triggers a Google Play declaration whose listed acceptable uses are all
> user-benefiting features, and an employee-monitoring framing is not among them."*

**Live tracking of MRs is employee monitoring by any reading.** So:

1. **The background-location route (options A as Expo implements it, and B) may not pass Play review
   at all** for this purpose — not merely be slow. **[verify against the current Play policy; this
   finding is a month old and second-hand]**
2. **The foreground-service-started-by-the-MR route below stops being an optimisation and becomes the
   design**, if it holds — because it would not request the background permission.
3. **Private distribution** (managed Google Play for the company's own devices, or an MDM) may sit
   under different review rules **[verify]** — a distribution decision, not an engineering one.
4. **Building tracking means deleting a frontend guard deliberately.** That test is the frontend
   track's ruling; reversing it needs an `FE-C` decision from that track, not a backend edit.

**The ask:** approve **option A** (one free package, `expo-task-manager`), **built foreground-only —
started by the MR, never requesting background permission** — and confirm with the frontend track
that `no-background-location.test.ts` is to be narrowed rather than deleted; or say if you prefer to
pay for **option B**. **Either way, the Play policy question above should be checked before a line
is written.**

---

## C3 — what CANNOT be verified without a physical handset, before 4 October

**An emulator runs stock Android. The handsets this product targets mostly do not.** Manufacturer
battery managers — on Xiaomi/Redmi, Oppo, Vivo, Realme, OnePlus and Samsung in particular — stop or
freeze background work in ways an emulator does not reproduce at all. Therefore, **only a real phone
of the models the MRs actually carry can tell us:**

1. **Whether tracking survives a working day** with the screen off and the phone in a pocket — or is
   killed by the battery manager after minutes.
2. **The battery cost per hour** at the chosen interval.
3. **Whether the stop at the end of the window fires** when the phone is asleep — the server half of
   condition 4 catches it if not, but a battery drained collecting refused points is still a failure.
4. **Whether the persistent notification stays visible** on that manufacturer's skin (condition 2).
5. **Accuracy indoors and in a clinic building**, and whether it degrades to network location.
6. **Behaviour across a reboot** mid-shift.
7. **What each manufacturer's "auto-start" / "battery optimisation" settings an MR must change** —
   which then becomes onboarding text.

**What the operator should know now, rather than after 4 October:** this list cannot be shortened by
writing code faster. It needs **at least one phone of each manufacturer the MRs use, carried for a
working day each.** **Please tell us which handset models the MRs carry.**

---

## C4 — the separate privacy notice

**Drafted, not shipped:** `docs/operator/live-tracking-notice-DRAFT.md`. It follows the rule every
content type follows here — **drafted, never born approved, approved by a second person** (`C24`,
`BE-C44`). It is **not** inserted into any table; when built, it enters as a draft version and needs the
four-eyes approval the schema already enforces for every other notice. **Its four blanks are the four
decisions above** — the draft does not guess them.

## C5 — not built

No table, no RPC, no package, no screen was added for live tracking in W1-N.
