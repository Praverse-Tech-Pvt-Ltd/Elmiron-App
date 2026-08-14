# Frontend — Context and Plan, v2

**Written 14 August 2026.** Replaces `frontend-brief.md`, which was written before Backend built anything and is now wrong in five places.

Every date in this document is a real date. Sprint labels are labels (`FE-W1`), not calendar weeks.

---

# 1. What changed, and why the old brief is wrong

Read this section even if you read nothing else. Five things moved.

| # | The old brief said | What is actually true |
|---|---|---|
| 1 | Build for Android and iOS | **Android only, permanently.** iOS is dropped. No Apple Developer account, no D-U-N-S, no App Store review risk. |
| 2 | Backend delivers APIs alongside you | **Backend is seven sprints ahead.** Schema, auth, RLS, field capture, offline sync, manager surface, consent, audio, retention and adverse-event ingest are built, tested and deployed to production. You are not waiting on anything. |
| 3 | The AI layer is part of the product | **The AI layer may be cut.** The speech vendor has never been chosen; the transcript schema is a placeholder Backend wrote with a CI deadline of 30 September. Build no screen that assumes a transcript exists. |
| 4 | Console is sprint 11 | **Console moves to FE-W6.** Backend built a manager exception feed and an org-default-shift-window flag that are, right now, invisible to every human. A mitigation nobody can see is not a mitigation. |
| 5 | Twelve sprints | **Eight.** Backend removed most of the uncertainty the original twelve absorbed. |

---

# 2. What already exists, and what you build against

## 2.1 The monorepo

| Workspace | State | Your relationship to it |
|---|---|---|
| `packages/core` | **Built.** Zod schemas, types via `z.infer`, typed API client. Contract I1. | Import from it. Never redefine a type it exports. **Announce any change** — AI/ML builds against it too. |
| `packages/ui-tokens` | Scaffold only | **Yours.** Design tokens, shared with the future patient app. |
| `packages/ui` | **Did not exist.** This table originally called it a scaffold; FE-W1 created the workspace. | **Yours.** Every component lives here, not in `apps/field`. |
| `services/mock` | **Built and running.** Contract I2, 40 tests. | Build against this for the whole project. It carries empty lists, single-item lists, error responses, permission-denied and a queued-offline scenario — not just happy paths. |
| `apps/field` | Empty scaffold | **Yours.** Expo, Android only. |
| `apps/console` | Empty scaffold | **Yours.** Next.js App Router. |
| `services/api` | **Built.** 17 migrations, 312 tests, deployed. | Read-only to you. If you think you need a schema change, ask. |

## 2.2 The things that will surprise you on day one

- **`loadAppConfig()` in `packages/core/src/shared/config.ts` throws** if any of `APP_JWT_AUDIENCE`, `APP_SITE_URL`, `APP_ADDITIONAL_REDIRECT_URLS`, `APP_DEEP_LINK_SCHEME` is missing. They are absent from `.env` today. Nothing calls it yet — **you are the first caller**, and it will throw the moment you wire config. Add them to `.env` and `.env.example` together.
- **`EXPO_PUBLIC_*` is inlined into the shipped bundle.** Publishable key only. The secret key in a client bundle is a credential leak, not a config mistake.
- **Production has no seed data and no shift windows**, so capture refuses there. That is deliberate. Develop against the local stack and the mock.
- **`docs/gotchas.md` and `.ai-collab/constraints.md` are in the repo, both tracked.** This line originally described `constraints.md` as untracked; that was reversed before FE-W1 started. Read both before debugging anything environmental — seven sprints of platform failures are already written down.

---

# 3. Constraints you inherit and cannot negotiate

These are enforced server-side. Your job is to **surface them well**, never to re-implement or work around them.

### 3.1 The server decides. You explain.

Every rule below is a trigger, a policy or a revoked grant in Postgres. If your UI prevents something the server also prevents, that is good UX. If your UI *allows* something the server prevents and you handle the error badly, that is the bug.

### 3.2 Consent

- Three outcomes: `consented`, `declined`, `not_asked`. **All three are successful completions.**
- **`declined` is not an error.** Do not render it red, do not put it behind a confirmation, do not make it harder to tap than `consented`, do not show a "are you sure?" A doctor declining is a normal Tuesday.
- The MR is required to **ask**. They are not required to obtain. A UI that pressures toward `consented` manufactures unlawful recordings at scale.
- **Consent version and language come from the server catalogue.** You display what the server gives you. There is deliberately no version parameter.
- Withdrawal is a new record, never an edit.

### 3.3 Recording

- **There is no upload endpoint without consent.** Not a disabled button — no URL to call. If your code path can reach an upload without a `consented` record, you have built something that cannot work.
- Uploads are **chunked and resumable**, against a server-issued grant with two clocks: a sliding 15-minute window under an immovable 24-hour ceiling. The grant is re-validated on every chunk.
- **The upload must survive the app being killed**, not just a dropped connection. The server holds the byte count.
- A consent withdrawal mid-upload revokes the grant. The user-facing message must say the doctor withdrew, not that the file was malformed.

### 3.4 Offline and sync

- The client is offline-first and **its clock is not trusted**. Never display a client-computed duration, distance or timestamp as authoritative. Every record carries a server `received_at` alongside the client's `occurred_at`.
- `sync_push` isolates each item. One bad item does not fail the batch.
- Rejections carry a code and an **MR-readable sentence** written by Backend. Display the sentence. Do not invent your own wording — the sentences are tested, and a reworded message breaks a build deliberately.
- **`my_upload_queue()` is the MR's only proof their day's work is safe.** Treat it as a primary screen, not a debug view. This is the screen that decides whether they trust the app.
- Dead-lettered items are always reversible, always attributed. Surface the reason.

### 3.5 Capture refusals you must handle as first-class states

Capture refuses, server-side, when:

- The MR is outside their territory's shift window
- **No shift window is configured at all** — currently true on production, because the client has not supplied per-territory hours
- The retention purge has stalled (`begin_upload` refuses new audio as a backstop)
- The visit is quarantined after a database restore

Each needs a distinct, honest screen. "Something went wrong" for any of these is a support ticket you have generated yourself.

### 3.6 Never build

- **Any ranking, score, rank, percentile or grade.** Not for MRs, not in the console, not "just a sort order". Backend has tests asserting those column names do not exist. This is a regulatory line, not a preference.
- Any severity, priority or triage control on an adverse event.
- Any screen that displays a transcript, analysis or AI summary. That work is blocked and may be cancelled.

---

# 4. Decisions needed before FE-W1 starts

Three. None can be deferred past the first day.

### 4.1 Dev build path — EAS Build or local Gradle

Expo Go **will not work.** Three native modules require a development build: Transistorsoft background geolocation, `expo-audio` with background recording, and PowerSync.

- **Local Gradle** — Android Studio, JDK 17, ~10 GB. Slow first setup, free and fast after.
- **EAS Build (Expo cloud)** — no local toolchain, works anywhere. Free tier queues and caps apply. *Verify current pricing at expo.dev/pricing; I am not confident in the numbers.*

Recommendation: **local Gradle**, because native config changes are frequent on this app and cloud round-trips will dominate your week. Choose EAS if the Windows toolchain fights you — that is a real risk on this machine, per `docs/gotchas.md`.

### 4.2 The Transistorsoft licence

`react-native-background-geolocation` is, as I understand it, **free for Android debug builds and requires a paid licence for release builds**. I have not verified the current price or terms — check transistorsoft.com directly.

If true it belongs in `docs/spend-approval.md` now. Finding this in FE-W8 when you try to sign an APK is a week's delay for a purchase order.

### 4.3 A physical Android device is mandatory

An emulator cannot test background location, GPS drift, Doze mode, or process death. Budget for **at least one mid-range Android phone**, and ideally one from a Chinese OEM.

**Why that matters more here than on most projects:** Xiaomi, Oppo, Vivo and Realme ROMs are aggressive about killing background processes, and they hold a large share of the Indian market. An MR tracking app that silently stops recording location when the phone decides to save battery is the single most likely way this product fails in the field, and it will not reproduce on a Pixel or an emulator. [Medium-high confidence — the behaviour is well documented by the community; verify against the specific handsets the client's MRs actually carry, which is a question worth asking the client now.]

---

# 5. Sprint plan

Eight sprints. Each has a gate that is a demonstration, not a checklist.

| Sprint | Build | Gate |
|---|---|---|
| **FE-W1** | Foundations. Dev build working on a real phone. `packages/ui-tokens` + `packages/ui` established with the extraction discipline enforced by lint. Login against local Supabase. `loadAppConfig()` wired. Navigation shell. | **FE-G1:** a signed-in APK on a physical Android device. |
| **FE-W2** | **Offline core, deliberately early.** Local store, sync queue, `my_upload_queue()` screen, rejection-code rendering, dead-letter surface. | **FE-G2:** airplane mode for a full simulated day, then sync, and the server accepts every item. |
| **FE-W3** | Field capture. Beat plan, doctor search (sub-3-second — an MR is standing in a corridor), check-in / check-out, background geolocation, mileage display, all four refusal states from §3.5. | **FE-G3:** background location survives app termination and 30 minutes in Doze on a real device. |
| **FE-W4** | Consent and recording. The consent screen with three equal outcomes, background audio capture, resumable chunked upload against grants. | **FE-G4:** a recording completes after the app is force-killed mid-upload and the phone changes network. |
| **FE-W5** | Call reports, samples and inputs, the MR's own day view. Read-only where the server is authoritative. | Server accepts a full day's work through the real API, not the mock. |
| **FE-W6** | **Console.** Manager exception feed, approvals, the org-default-shift-window flag made visible. Moved forward from sprint 11. | **FE-G5:** an org-default capture appears as a visible exception to a manager. |
| **FE-W7** | Empty states, error states, accessibility, copy. Field testing on the real handsets MRs carry. | Accessibility audit passes; every state in §3.5 has been seen on a real phone. |
| **FE-W8** | Pilot readiness. Release build, signing, Play Console, offline soak test, crash reporting. | A signed APK installs and runs a full day offline. |

**Excluded on purpose:** every AI-dependent screen. If the bake-off comes back good, that is FE-W9 onward. If it comes back bad, you have built nothing that gets deleted.

---

# 6. Contracts

**You need:**

| From | What | State |
|---|---|---|
| Backend | `packages/core` types (I1) | **Delivered** |
| Backend | Mock server (I2) | **Delivered** |
| Reviewer | Dev build decision, device budget, Transistorsoft licence | **Open — §4** |
| Client | Per-territory shift windows | **Open.** Affects which refusal state you see most. |
| AI/ML | Transcript schema (I3), analysis contract (I5) | **Blocked. Do not design around either.** |

**You owe:**

| Contract | To | When |
|---|---|---|
| Design tokens published in `packages/ui-tokens` | Patient app, Console | End FE-W1 |
| Component inventory in `packages/ui` | Patient app | End FE-W2 |
| A list of every server rejection you cannot render sensibly | Backend | Rolling — raise immediately, not at the end |

---

# 7. Traps, specific to this app

- **The brand's primary button spec is 2.54:1 contrast — it fails every WCAG level.** The badge spec is 4.33:1. Fix this in `packages/ui-tokens` once, not per screen. If you ship the brand values as given, every screen is inaccessible and the fix later is a full visual re-review.
- **Do not build components inside `apps/field`.** Extracting them in FE-W6 for the console is a rewrite of every screen. Enforce it with a lint rule in FE-W1, not with discipline.
- **Never render a client-computed distance or duration as fact.** Mileage is computed server-side from check-in coordinates for a reason — it feeds an expense claim.
- **Audio cached on device must not sit in a world-readable location.** Scoped storage, and cleared once the upload completes.
- **A green sync is not a landed sync.** The server returns per-item verdicts. A batch that returned 200 can contain rejected items, and the MR needs to know which.
- **Test with a bad network, not no network.** Airplane mode is the easy case. A 2G connection that half-completes a chunk is the one that breaks resumable upload.

---

# 8. The thing I have to say about resourcing

The frontend developer this plan is addressed to has not reported once since the brief was issued. Backend has reported eight times.

If nobody is in that seat, this plan is for you, and **eight sprints of frontend work does not fit alongside continuing to review backend at this rate.** The honest options are to hire, to slow backend deliberately, or to cut scope — and the cut that costs least is the AI layer, which is also the one whose viability nobody has measured.

That is a decision, not a task, and it is yours.

---

*Constraints trace to `.ai-collab/constraints.md`, `PROJECT-OVERVIEW.md` and `docs/mr-app-plan.md` §0. Where this document and those disagree, they are right — they are tracked and CI-verified; this is a snapshot.*
