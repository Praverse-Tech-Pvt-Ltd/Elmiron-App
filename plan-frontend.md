# Frontend Plan — PPS / Elmiron Platform

**Role:** Frontend developer · every screen, both platforms
**Duration:** 16 weeks
**Track ID:** FE

> Yours is the largest bucket in this project by volume — roughly 64 screens across seven role surfaces and two platforms. Scope protection is part of your job. If someone asks for a new screen, it goes through the reviewer and the cut list, not straight into your week.

---

# 1. WHAT YOU OWN

Expo / React Native app shell (MR app + Patient app) · Next.js app shell (Manager, Doctor, Marketing, Admin, PV consoles) · consumption of `packages/core` and `packages/ui-tokens` · every screen and every state · offline UI and sync state · forms and validation · accessibility implementation · app store releases.

**What you do not own:** dashboard charts and data visualisation. Those go to AI/ML+Data, who are already computing the numbers. Hand off the container, take back the chart.

---

# 2. THREE RULES THAT OVERRIDE EVERYTHING

### 2.1 Never implement permission logic in the client

Do not filter data client-side for security reasons. Assume the API returns only what the user is allowed to see. If the API ever returns something it should not, **that is a backend bug — report it, do not hide it**. A client-side filter over a server-side leak is the most dangerous pattern in this codebase, because it looks fixed.

### 2.2 No patient data on any commercial screen

MR, manager and marketing screens contain **zero** patient identity, diagnosis, prescription or diary content. Not in a list, a chart, a tooltip, an export, or an empty state. If a screen would be more useful with patient data on it, that is the constraint working correctly.

### 2.3 AI output never reaches a patient surface

India's telemedicine rules prohibit AI/ML platforms from counselling patients. The US FDA non-device exclusion runs to health professionals only. **Do not build a patient-facing AI summary screen.** Patients see their own raw data. This is legal, not negotiable, and it will feel wrong — build it anyway.

---

# 3. WEEK BY WEEK

### Phase 0 · Weeks 1–2 · Scaffolds

**W1** — Expo scaffold with Expo Router inside the monorepo · Next.js App Router scaffold · wire the token pipeline from the designer's `design-tokens.json` into both the Tailwind config and the RN theme · consume `packages/core` types (backend publishes them Friday)
**W2** — shell navigation on both platforms · layout primitives · wire the component library from design D2 · get the mock server working end to end

**Do not build screens yet.** Design D3 (Field app) lands in week 3. Building ahead of the design means building twice.

### Phase 1 · Weeks 3–6 · Field app, then Manager console

**W3–W4 — Field app, the MR day flow.** This is the one where the user is outdoors, in sunlight, one-handed, on 3G or nothing, watching their battery, with ninety seconds in a waiting room.

- Design the whole day: shift start → beat plan → travel → arrive → geo check-in → detail → call report → check-out → next visit → shift end
- **Offline is a normal state, not an error screen.** Sync status visible on every screen. Queued items visible and countable. The user always knows what has and has not reached the server.
- Primary actions in the **bottom third** — one-handed reach.
- **High-contrast outdoor mode** — a real mode, not just dark text.
- Check-in in **one tap** from the doctor screen.
- **A call report completable in under 60 seconds.** Time it yourself. If it takes longer, cut fields and tell the reviewer.
- No continuous animation, no persistent map render — battery matters.

**W5 — Field app finish, plus the tracking transparency screen.**

That screen states plainly what location data is captured, when capture starts and stops, how long it is kept, and who can see it. Reachable in one tap from home. **Design it to be genuinely reassuring, not legally defensive** — field-force resistance to tracking is the main adoption risk for this app, and a screen that reads like a disclaimer makes it worse. Also build the **visible confirmation that tracking has stopped** at shift end.

**W6 — Manager console.** Shell, exception-first dashboard, approvals queue, route review (map + timeline). Charts come from AI/Data — you build the containers.

> 🚦 **GATE 1 — end of week 6.** One territory runs a full offline day and syncs clean.

### Phase 2 · Weeks 7–10 · Patient app, then Doctor console

**The Patient app has the highest accessibility bar in the project, for a specific reason:** the drug this platform tracks carries a documented retinal risk whose reported symptoms include prolonged dark adaptation, night-vision difficulty and **difficulty reading** — often with normal visual acuity. Some of your users cannot read well because of the drug you are helping them track.

Non-negotiable for this app:
- **18px minimum body text, weight 400 minimum.** No weight-300 text anywhere.
- **WCAG AAA contrast** (7:1) for body text.
- **Text scaling to 200% without the layout breaking.** Test it.
- **Real dark mode**, not an inversion.
- **48px minimum touch targets.**
- One primary action per screen. Never more than three taps to log.

**W7** — enrolment via clinic code · consent flow (multi-step, versioned, **refusable without losing access to core care information**, withdrawable)
**W8** — home / today · **weekly symptom log** (the retention flow — target under 45 seconds, three taps, no typing required) · dose confirm
**W9** — **monthly vision check** (structured questions only, no free text) · **AE report flow** — the patient must know a human will review it, without being frightened. Silence here is the worst outcome.
**W10** — Doctor console: patient list, patient detail

> 🚦 **GATE 2 — end of week 10.** AE path end to end. Backend leads, you support.

### Phase 3 · Weeks 11–13 · Doctor console finish

The doctor has 30–90 seconds between consultations and will abandon anything slower than reading the paper file. **Scannability over completeness.** Zero onboarding. Every screen answers "what do I do with this patient, now."

**W11** — diagnosis entry · prescription entry (drug, **brand** — India brands differ from Elmiron, do not hardcode — form, strength, dose, frequency, dates)
**W12** — ophthalmic monitoring schedule status · **`AISummaryCard` integration**
**W13** — gynaecologist referral surface (different job entirely: disease recognition, differential, referral pathway — **do not show them a prescribing UI**)

**On `AISummaryCard`:** it must be structurally impossible to render without inline source citations, a link to the raw underlying data, and a visible "AI-generated summary — not medical advice, verify against source records" label. Not documented-as-required. Impossible. This is a regulatory requirement — it is what makes the AI output independently reviewable, which is what keeps it a non-device.

### Phase 4 · Week 14

PV console UI (the **SLA clock** is the primary visual element — sorted by urgency, never by date received) · Admin console UI (break-glass requires a **typed reason before data renders** — not a checkbox)

### Phase 5 · Week 15 · Hardening

Accessibility audit and fixes · performance · polish · bundle size

**Test with a real screen reader — VoiceOver and TalkBack — not just an automated checker.**

### Phase 6 · Week 16 · Pilot

Bug fixes for one territory, two MRs, two doctors, ten patients.

---

# 4. WHAT YOU NEED FROM OTHERS

| From | What | When | If it slips |
|---|---|---|---|
| Backend | **I1 — typed API contract** | End W1 | You cannot start |
| Backend | **I2 — running mock server** | **End W2** | You are blocked for the whole project. Escalate on day one of week 3. |
| Designer | `design-tokens.json` (D1) | End W1 | Token pipeline waits |
| Designer | Component library (D2) | End W2 | Screens wait |
| Designer | Field app screens (D3) | **End W2, for your W3** | Design runs two weeks ahead — hold them to it |
| AI/Data | **I4 — AI gateway contract** | End W9 | `AISummaryCard` cannot be built against a real shape |
| AI/Data | Dashboard charts | W6 onward | You build containers, they fill them |

---

# 5. STATE MATRIX — every screen, every time

A screen is not done when the happy path works.

`loading` · `empty` · `error` · **`offline`** · `permission-denied` · `success`

And every mobile component needs a **press state**. There is no hover on a phone. The brand guideline says "hover: colour transition only" — that instruction does not apply to you.

---

# 6. IF YOU FALL BEHIND

You probably will around week 7, when the Patient app and Doctor console overlap. **Do not absorb it silently.** The cut order is already agreed:

1. Marketing console → manual process for the pilot
2. Gynaecologist referral surface → phase 2
3. Admin console polish → functional but plain
4. PV console polish → functional but plain, **the SLA clock stays**
5. Field app: expenses, training, certification
6. Patient app: my-visits, help screens

**Never cut:** patient-app accessibility · the AE report flow · offline handling · the tracking transparency screen.

Flag slippage at the week-6 checkpoint, not in week twelve.

---

*Accessibility requirements in §3 trace to a documented drug safety signal, sourced in `PROJECT-CONTEXT.md` Part 3.4. Design constraints are in `design-plan.md` §5.*
