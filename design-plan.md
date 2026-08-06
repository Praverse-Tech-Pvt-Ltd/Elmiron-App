# Design Plan — PPS / Elmiron Platform

**For:** UI/UX designer, working with Claude
**Version:** 1.0 · 4 August 2026
**Reads with:** `elmiron-master-plan.md`, `architecture-corrected.html`
**Decisions locked:** custom mobile / library-based web · design system first, then MR app · Elmiron brand v1.0 as the brand input

---

# 0. READ THIS BEFORE OPENING FIGMA

Your brand guideline is a well-made **marketing** system. It is not yet a **product** system, and shipping it as-is would produce an app that fails accessibility and fails the specific users this product serves. Six problems, in order of severity.

## 0.1 The primary button spec is inaccessible

Your guideline says: *Primary button — background Sage `#8AAB8A`, text white.*

I measured it:

| Pair | Ratio | WCAG AA normal | AA large | AAA |
|---|---|---|---|---|
| **Sage `#8AAB8A` on white** | **2.54:1** | ❌ FAIL | ❌ FAIL | ❌ FAIL |
| **Sage `#8AAB8A` on cream** | **2.35:1** | ❌ FAIL | ❌ FAIL | ❌ FAIL |
| Sage Deep `#4A7A4A` on white | 5.03:1 | ✅ | ✅ | ❌ |
| Sage Deep `#4A7A4A` on cream | 4.66:1 | ✅ | ✅ | ❌ |
| **Sage Deep on Sage Pale** (your badge spec) | **4.33:1** | ❌ FAIL | ✅ | ❌ |
| Muted `#6B6B68` on cream | 4.95:1 | ✅ | ✅ | ❌ |
| Charcoal `#2C2C2A` on cream | 12.96:1 | ✅ | ✅ | ✅ |
| Sage Light `#B8CDB8` on charcoal | 8.30:1 | ✅ | ✅ | ✅ |

Two concrete failures:

1. **Your default button state fails and your hover state passes.** That is backwards. A user who never hovers — every mobile user — only ever sees the failing state.
2. **Your badge spec fails.** Sage Deep on Sage Pale at 4.33:1, set in 0.65rem (≈10.4px) uppercase. Small uppercase text at 4.33:1 is a real legibility problem, not a technicality.

Nothing in the palette reaches AAA (7:1) except Charcoal. Which brings us to the reason that matters.

## 0.2 Some of your patients cannot see well — because of the drug you are tracking

This is the single most important design fact in the project, and it is not in your guideline.

Pentosan polysulfate carries a documented **pigmentary maculopathy** risk. Reported prevalence rises with cumulative dose — roughly 12.7% at 500–999 g, ~30% at 1000–1500 g, ~41.7% above 1500 g. At the standard 300 mg/day, 500 g is about 4.6 years of therapy.

The reported symptoms are specifically: **prolonged dark adaptation, difficulty with night vision, difficulty reading, blurred vision, metamorphopsia** — often with **preserved visual acuity**, meaning a standard eye chart looks fine while reading a phone does not.

Now read your own type spec back:

- Body text: **DM Sans weight 300, 14–16px**
- Display: **Cormorant Garamond weight 300** — a light-stroke serif
- Secondary text: Muted `#6B6B68` at 4.95:1

Light-weight text, light-weight serifs, and mid-contrast greys are the worst possible combination for readers with degraded contrast sensitivity and dark adaptation. You would be building a diary that the patients most affected by the drug cannot read.

**This is not an accessibility checkbox. It is the core design problem of the patient app.** Solve it well and you have a genuine product differentiator. Ignore it and the retention numbers — already brutal — get worse for exactly the patients whose data matters most.

## 0.3 "for women" excludes a large share of Indian patients

Your wordmark lockup reads *Elmiron® / for women*.

The research says otherwise:

- The approved indication is **interstitial cystitis / bladder pain syndrome** — a bladder indication. The governing guideline is the **AUA** (American *Urological* Association).
- US prevalence skews ~5:1 female, but **1–4 million US men** also have it, and male cases are underdiagnosed as chronic prostatitis.
- **In India the skew is far weaker** — one 316-case Indian series reported roughly **3:2** female:male.
- In India, **urologists** prescribe this drug. Gynaecologists frequently *misdiagnose* the condition.

"for women" is a defensible *marketing* position in the US, where the brand grew out of J&J's Ortho Women's Health & Urology division. As **product** branding on a clinical tool in India, it tells roughly 40% of patients and most of the prescribing specialty that the product is not for them.

**Recommendation:** keep "for women" in consumer marketing if the client insists. Do **not** carry it into the product UI. The app's lockup should be the compact one: `Elmiron® │ PENTOSAN POLYSULFATE SODIUM`.

## 0.4 Two claims in the guideline are regulatory problems

- **"India's Best Oral PPS Therapy"** — a superlative comparative claim. This is exactly the category UCPMP 2024 and Indian drug-advertising rules constrain. Get it reviewed before it appears anywhere. *[Flagging as risk, not a legal opinion.]*
- **"FDA Approved" badge in an India context** — using a foreign regulator's approval as an Indian promotional claim is a grey area worth a lawyer's five minutes.
- *"The only oral medication approved for IC/BPS"* — this one appears **accurate**. PPS is the only orally-administered drug with an approved IC indication; amitriptyline, cimetidine and hydroxyzine are used off-label. Keep it, it is your strongest honest claim.

## 0.5 There is no safety design language, and safety is mandatory here

Your voice section says: calm, not alarmist, not urgent, don't lead with pain imagery. All good instincts.

But this product **must** surface: an ophthalmic monitoring schedule, a vision-symptom check, an adverse-event report path, and a Schedule H prescription-only status. Your visual system currently has one accent colour and no semantic states at all — no error, no warning, no success, no overdue, no offline.

You need a semantic layer that reads as **calm and clear**, not as red-alert hospital software. That is a real design problem and it is worth solving deliberately rather than reaching for `#FF0000` in week six.

## 0.6 It is a website system, not an app system

Missing entirely, and needed on day one:

| Missing | Why it matters |
|---|---|
| Press / active states | *"Hover: colour transition only"* — there is no hover on a phone |
| Focus states | Keyboard and screen-reader users; also a WCAG requirement |
| Disabled states | Every form has them |
| Loading / skeleton | MRs work on bad connections |
| Empty states | Every list screen has a day one |
| Error states | Form validation, sync failure, permission denied |
| Offline states | The MR app is offline-first; this is a primary state, not an edge case |
| Border radius on touch targets | *"No border-radius — architectural and planar"* reads as precise on web and as unfinished on mobile, where radius carries tap affordance |
| Data density modes | A manager console and a patient app cannot share one spacing scale |
| Dark mode | Not optional for a user group with night-vision difficulty |

---

# 1. THE FIX — TWO-TIER TOKENS

Do not edit the brand guideline. Extend it. One source of truth, two consumers.

```
TIER 1 — BRAND TOKENS          (unchanged, marketing owns these)
  cream, sage, sage-deep, charcoal, muted, sage-pale, sage-light
  Cormorant Garamond · Italiana · DM Sans
        │
        ▼
TIER 2 — PRODUCT TOKENS        (derived, accessibility-corrected, product owns these)
  semantic roles · corrected interactive colours · state colours
  density modes · corrected type scale · dark theme
```

Rule: **product UI never references a Tier 1 token directly.** It references a semantic Tier 2 token that happens to resolve to a brand value. This is what lets marketing rebrand without breaking the app, and lets the app fix contrast without arguing with marketing.

## 1.1 Added product colours

These extend the sage family. They are not new brand colours; they are the same hue rendered dark enough to be readable.

| Product token | Hex | On cream | On white | Use |
|---|---|---|---|---|
| `interactive` | `#4A7A4A` (sage-deep) | 4.66 ✅ | 5.03 ✅ | Links, secondary actions, web UI |
| **`interactive-strong`** | **`#35593A`** | **7.36 ✅ AAA** | **7.95 ✅ AAA** | **Primary buttons, patient app, all small text** |
| `interactive-ink` | `#2F5233` | 8.18 ✅ | 8.84 ✅ | Patient app body links, maximum legibility |
| `on-dark` | `#B8CDB8` (sage-light) | — | 8.30 on charcoal ✅ AAA | Sage on dark ground |

**`#8AAB8A` (sage) is decorative only from here on.** Rules, dividers, borders, large decorative fills, illustration. Never behind text, never as a button background, never as a text colour.

## 1.2 Semantic states — proposed, needs your eye

Derived to sit inside the brand's warmth rather than fight it. Verify contrast before committing; I have not measured these.

| Role | Direction | Use |
|---|---|---|
| `success` | The sage family — it is already the "good" colour | Sync complete, submitted, on schedule |
| `attention` | Warm amber-clay, muted not neon | Eye exam due, follow-up overdue, low sync |
| `critical` | Deep terracotta, not fire-engine red | AE flagged, permission denied, data loss risk |
| `info` | Cool slate — the one non-sage accent | Neutral system messages |
| `offline` | Charcoal at reduced opacity + an icon | Never colour alone — colour-blind users |

**Never encode meaning in colour alone.** Every state carries an icon and a text label. This is a WCAG requirement and, for this user group, a practical one.

## 1.3 Corrected typography

| | Brand guideline | Product system | Why |
|---|---|---|---|
| Display face | Cormorant 300 everywhere | Cormorant **500+**, only at **≥24px**, only on brand moments — login, empty states, onboarding, print reports | Light serifs are unreadable small and unreadable to your users |
| Body face | DM Sans **300**, 14–16px | DM Sans **400 minimum** | Weight 300 undercuts effective contrast regardless of hex value |
| Web body | 14–16px | **16px**, line-height 1.6 | |
| **Patient app body** | — | **18px minimum, weight 400, scalable to 200%** | §0.2 |
| MR app body | — | 16px, weight 500 outdoors | Sunlight readability |
| Data tables | — | DM Sans 400, **tabular numerals** (`font-variant-numeric: tabular-nums`) | Numbers must align in columns |
| Italiana | Once per composition | **Zero product use.** Marketing only. | Decorative script has no role in a clinical tool |
| Eyebrow labels | 11px, 0.2em tracking, uppercase | **12px minimum**, and never for anything the user must act on | Small uppercase is the least legible setting there is |

## 1.4 Radius and density — a defensible split

Your brand says planar, zero radius. Keep that on web, where it reads precise and looks distinctive. Soften on touch.

| | Web consoles | Mobile apps |
|---|---|---|
| Cards, panels | `0` — brand-true | `12px` |
| Buttons, inputs, touch targets | `0` | `8px` |
| Badges | `0` both | `0` both |
| Minimum target | 32px (pointer) | **44px MR · 48px patient** |

Three density modes off one spacing scale:

- **Compact** — manager, marketing, admin, PV. Dense tables, desk use.
- **Standard** — doctor console, MR app.
- **Comfortable** — patient app. Generous spacing, large targets, one primary action per screen.

---

# 2. WHO YOU ARE ACTUALLY DESIGNING FOR

Six user realities. Each one should visibly change the design.

### Patient — the hardest brief
Typically 40–65. Chronic pelvic pain, often for years, often previously misdiagnosed. May have **drug-induced night-vision and reading difficulty**. Paying ₹5,850–8,300 a month. Waiting 5–6 months to find out if it works. Frequently exhausted and demoralised by the condition.

→ 18px minimum body. AAA contrast. Real dark mode. One action per screen. Never more than three taps to log. Text scaling to 200% without breaking layout. Multi-language. No cheerfulness — this person is not on a wellness journey, they are managing a painful chronic condition and an expensive drug.

### MR / Business Manager
Outdoors, in sunlight, on a phone, often one-handed, often on 3G or nothing, watching their battery. In a clinic waiting room with 90 seconds before the doctor is free.

→ High-contrast outdoor mode. Bottom-third reachable primary actions. **Offline is a first-class state, not an error.** Sync status always visible. Check-in in one tap. Call report completable in under 60 seconds. Battery-conscious — no continuous animation.

### Field Manager
Desk, laptop, reviewing 8–15 MRs. Wants exceptions, not everything.

→ Dense tables. Exception-first dashboards — show what is off-plan, not what is on-plan. Bulk approvals. Map + timeline for route review.

### Urologist
30–90 seconds between consultations. Will abandon anything slower than reading the paper file. Sceptical of pharma-run software, with good reason — the evidence on pharma HCP portals is poor.

→ **Scannability over completeness.** The AI history summary must be readable in 15 seconds with citations one tap away. Zero onboarding. No dead-end screens. Every screen answers "what do I do with this patient, now."

### Gynaecologist
Different job entirely — recognising IC/BPS and referring, not prescribing.

→ A different surface. Disease recognition, differential, referral pathway. **Do not show them a prescribing UI.**

### PV Officer
A legal clock is running — 15 calendar days for a serious adverse event, from the moment the patient hit save.

→ Time-to-deadline is the primary visual element on the queue. Sorted by urgency, never by date received. Case completeness visible at a glance — a case is invalid without all four elements (identifiable patient, identifiable reporter, suspect drug, adverse event).

---

# 3. SCREEN INVENTORY

**~64 screens plus states.** P1 must exist for the pilot. P2 ships in v1. P3 is post-MVP — design only if there is time.

### Field App — mobile, custom design · 16 screens
P1: Login/OTP · Today (beat plan, next visit, sync status) · Doctor list + search · Doctor profile · Check-in with geo confirm · Call report · Check-out summary · Shift start/end + **tracking transparency screen** · Offline & sync states
P2: Beat plan editor · Digital detailing viewer · Samples & inputs (UCPMP caps) · My performance
P3: Expense claims · Training & certification · Settings

### Patient App — mobile, custom design, AAA bar · 13 screens
P1: Enrolment via clinic code · Consent flow (multi-step, versioned) · Home/today · **Weekly symptom log** · **Monthly vision check** · Dose confirm · Reminders · **Report a problem → AE intake**
P2: My medication detail · My visits · My data (raw view) · Language & text size
P3: Help & support

### Doctor Console — web + mobile lookup · 12 screens
P1: Login · Patient list · **Patient detail: AI history summary with citations** · Diary trend view · **Vision check history + ophthalmic schedule status** · Diagnosis entry · Prescription entry · Enrol patient + capture consent
P2: Visit prep brief · Reminders/follow-ups · AE review (own patients) · Mobile quick-lookup
Separate: gynaecologist referral surface (P2, different IA)

### Manager Console — web, library-based · 7 screens
P1: Team dashboard (exception-first) · MR activity detail · Approvals queue · Route & tracking review
P2: Territory KPIs · Beat plan review · Reports & exports

### Marketing Console — web, library-based · 6 screens
P2: Content library · Upload + approval workflow · Content performance (CLM telemetry) · Input & sample tracking (UCPMP)
P3: Campaign dashboard · Aggregate clinical stats (suppressed)

### PV & Safety Console — web, library-based · 4 screens
P1: **AE queue with SLA clocks** · **AE case detail** · Case export
P2: Screening log

### Admin Console — web, library-based · 6 screens
P1: Users & roles · **Break-glass access with mandatory reason** · Audit log viewer
P2: Territory management · Consent version management · System config

---

# 4. FLOWS TO DESIGN — IN THIS ORDER

Flows before screens. These are the eight that carry all the risk.

1. **MR day** — shift start → beat → travel → check-in → detail → call report → check-out → shift end. Design the offline branch of every step.
2. **Patient enrolment + consent** — doctor initiates → patient receives code → identity → **consent, in plain language, versioned, refusable** → first log. This flow is a legal artifact as much as a UX one.
3. **Weekly symptom log** — the retention flow. Target: under 45 seconds, three taps, no typing required.
4. **Monthly vision check** — safety-critical. Structured questions only. Must detect a concerning answer and route it, while telling the patient calmly and without alarm what happens next.
5. **Adverse event** — patient reports → system flags → PV queue with clock → officer triages → case export. Design the **patient-facing acknowledgement** carefully: they must know a human will see it, without being frightened. Silence here is the worst outcome.
6. **Doctor consultation** — open patient → read cited AI summary in 15s → check vision status → record diagnosis → prescribe → set follow-up.
7. **Manager exception review** — dashboard shows anomalies → drill into MR → review route → approve or query.
8. **Admin break-glass** — admin needs patient data → **must type a reason** → warning that this is logged → data renders → audit entry visible to that admin.

---

# 5. NON-NEGOTIABLE CONSTRAINTS

These are legal or safety requirements. If a design violates one, it does not ship — regardless of how good it looks.

| # | Constraint | Source |
|---|---|---|
| C1 | **Patients never see AI-generated narrative.** Do not design a place for it. Patients see their own raw data. | India telemedicine guidelines prohibit AI counselling patients; FDA's non-device exclusion runs to HCPs only |
| C2 | Every AI output on a doctor screen carries **inline source citations**, a link to the raw underlying data, and a visible "AI-generated summary — not medical advice, verify against source records" label | FDA criterion 4 (independent review) + EU AI Act Art. 50 transparency, live since 2 Aug 2026 |
| C3 | AI never uses advice-shaped or prediction-shaped language. No "consider", no "suggests worsening", no risk scores, no patient ranking. | "Prediction" is a medical purpose under India's device guidance — it converts the feature into a regulated device |
| C4 | **AE reports route to a human queue**, always. No AI triage. Patient sees a calm confirmation that a person will review it. | Legal duty + safety |
| C5 | Reminders contain **administrative content only** — appointment times, refill timing. No clinical advice text. | Clinical advice in a message makes it a teleconsultation under India TPG |
| C6 | The MR app has a **tracking transparency screen**: what is captured, when capture starts and stops, retention period, who can see it. Reachable in one tap from home. | Adoption + India employee-privacy proportionality |
| C7 | Location capture **visibly stops** at end of shift. Show the user it stopped. | Same |
| C8 | Admin access to patient data requires a **typed reason before data renders**. Not a checkbox. | Audit requirement |
| C9 | Any aggregate showing fewer than 5 patients renders as **"—"**, never a number | Re-identification risk |
| C10 | No MR or manager screen contains any patient identity, diagnosis, prescription or diary content — including in a chart, tooltip, export or empty state | The compliance boundary |
| C11 | Patient app meets **WCAG 2.2 AAA for body text**, supports 200% text scaling without layout break, full dark mode | §0.2 |
| C12 | Consent is **refusable without losing access to core care information**, withdrawable at any time, and withdrawal is a visible, findable action | DPDP / GDPR |
| C13 | Meaning is never encoded in colour alone | WCAG 1.4.1 |

---

# 6. DESIGN SEQUENCE — 8 WEEKS, LEADING BUILD BY TWO

| Week | Design | Engineering is doing |
|---|---|---|
| **1** | Tier-2 token system. Colour with verified contrast, type scale, spacing, density modes, radius, dark theme. Semantic states. | Phase 0 foundations |
| **2** | Core components — both platforms. Buttons, inputs, selects, cards, tables, nav, modals, toasts, badges, empty/loading/error/offline states. Full state matrix. | Phase 0 |
| **3** | Field app: MR day flow, low-fi → hi-fi. All offline branches. Tracking transparency screen. | **Phase 1 starts — needs these** |
| **4** | Field app finish. Manager console: exception dashboard, approvals, route review. | Phase 1 |
| **5** | Patient app: enrolment, consent, home, weekly log. **Accessibility test with real 55+ users, including at least one with low vision.** | Phase 1 |
| **6** | Patient app: vision check, AE report, reminders. Doctor console: patient list, AI summary layout. | Phase 1 → 2 |
| **7** | Doctor console finish: diagnosis, prescription, ophthalmic schedule, enrolment. Gynaecologist referral surface. | **Phase 2 starts — needs these** |
| **8** | PV console (SLA queue). Admin (break-glass, audit). Marketing console. Full accessibility audit. Handoff pack. | Phase 2 |

**Week 5 user testing is not optional.** Everything in §0.2 is a hypothesis until someone with degraded contrast sensitivity tries to fill in the diary. Find five real users. If you cannot find patients, find anyone over 55 and test in low light with a screen brightness of 30%.

---

# 7. HANDOFF FORMAT

Devs are building React Native (Expo) and Next.js from a shared `packages/ui-tokens`. Design output must land in that format or it gets translated by hand and drifts.

**Deliver:**

1. **Tokens as JSON** — `design-tokens.json`, W3C design-token format. This is the source of truth, not a Figma file. It compiles to Tailwind config and RN theme.
2. **Component specs** — every component with its full state matrix: default, hover, press, focus, disabled, loading, error. A component without a documented press state is not done.
3. **Figma library** — components mapped 1:1 to the code component names. Same names.
4. **Flow prototypes** — the eight flows from §4, clickable, including the failure branches.
5. **Accessibility annotations** — contrast ratios stated per pair, touch target sizes, focus order, screen-reader labels for every interactive element.
6. **Density spec** — one document showing the same table in compact / standard / comfortable.
7. **Redlines only where behaviour is non-obvious.** Do not redline what the token system already answers.

---

# 8. WHAT I WILL PUSH BACK ON IN REVIEW

- Cormorant Garamond below 24px, or below weight 500, anywhere in the product
- DM Sans at weight 300 anywhere in the product
- Sage `#8AAB8A` behind any text
- Any colour pair not contrast-tested and stated
- A screen designed only in its happy state
- A patient-app screen under 18px body text
- Colour as the sole carrier of meaning
- A place where an AI summary could reach a patient
- "for women" inside the product UI
- Any mobile component without a press state

---

*Design constraints marked as legal requirements trace to the regulatory research pack of 4 Aug 2026. Contrast ratios in §0.1 and §1.1 were computed to WCAG 2.x formula and are reproducible. This is not legal advice.*
