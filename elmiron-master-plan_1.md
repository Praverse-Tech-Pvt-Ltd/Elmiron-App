# PPS / Elmiron Digital Platform — Master Plan v1.0

**Prepared:** 4 August 2026
**Team:** 3 people + reviewer
**Target:** MVP in 16 weeks
**Status of this doc:** planning baseline. Two decisions still open (see §2).

> This is planning and regulatory research, not legal advice. Items marked ⚠️ need a qualified lawyer before you build on them.

---

# 0. READ THIS FIRST — five findings that change the brief

These came out of research on 4 Aug 2026. Each one invalidates something in the original brief. Do not skip.

### 0.1 "Elmiron" does not exist in India

Pentosan polysulfate sodium (PPS) **is** approved in India — CDSCO approval 11 May 2010 — and **is** marketed. But not as Elmiron.

| Brand | Marketer | Listed MRP |
|---|---|---|
| Comfora | Swati Spentose | ₹650 / 10 caps |
| Cystopen | Sun Pharmaceutical | ₹740.63 / 10 caps |
| For-IC | Cipla | ₹921 / 10 caps |
| Pentossan 100 | AMPS Biotech | ₹6,093.75 / 90 caps |

Elmiron is Janssen (J&J) in the US and Canada, and **bene-Arzneimittel** in the EU — not J&J. The asset is fragmented by territory.

**Action required:** confirm with the client which molecule, which brand, and which legal entity. Everything about branding, MR content, and the regulatory owner depends on this. *[High confidence on approval and brands.]*

### 0.2 This is a urology drug, not a women's health drug

- The approved indication in every market is **interstitial cystitis / bladder pain syndrome** — a bladder indication.
- The governing guideline is the **AUA** (American *Urological* Association), 2022. There is no equivalent gynaecology guideline positioning PPS.
- US prevalence skews female (~5:1), which is why J&J commercialised it through "Ortho Women's Health & Urology". That is a marketing artefact, not a clinical one.
- **In India the skew is much weaker** — one 316-case Indian series reported roughly 3:2 female:male. Indian literature also notes gynaecologists frequently *misdiagnose* IC/BPS, historically as genitourinary tuberculosis.

**Consequence for the diagram and the product:**

- **Urologists = the detailing audience.** They prescribe. Small, concentrated list — roughly one urologist per 564,000 population in India (~2,425 society members as of 2018).
- **Gynaecologists = a case-finding / referral audience.** Different content, different job. Disease awareness and a referral pathway, not product detailing.
- Building one undifferentiated "HCP module" fails both audiences.

### 0.3 India law forbids AI from counselling patients — full stop

From the Telemedicine Practice Guidelines (binding on registered medical practitioners):

> "Technology platforms based on Artificial Intelligence/Machine Learning are **not allowed to counsel the patients or prescribe any drugs** to a patient." AI may assist the RMP, but "the final prescription or counseling has to be **directly delivered by the RMP**."

This is not a disclaimer problem. It is an architecture constraint.

**It also means your original request — "AI summarises the patient diary for the patient" — cannot ship to Indian patients as-is.** Two legal options:

- **(a)** AI summaries are **HCP-facing only**. Patients see their own raw data, not AI narrative.
- **(b)** AI drafts, an RMP reviews and releases it, with an audit trail of who approved what and when.

Option (a) is what fits a 16-week MVP. Option (b) is a phase-2 feature with real workflow cost.

Independently, US FDA reaches the same place by a different route: the CDS non-device exclusion runs to **health care professionals only**. Patient-facing output fails the test outright. *[High confidence — FDA CDS final guidance, January 2026, which replaced the September 2022 version.]*

### 0.4 The patient diary is an adverse-event intake channel by law

PPS carries a documented **pigmentary maculopathy** (retinal damage) signal. The US label requires a baseline retinal exam within six months of starting and periodic exams thereafter. Prevalence by cumulative dose is significant — roughly 12.7% at 500–999 g, ~30% at 1000–1500 g, ~41.7% above 1500 g. At 300 mg/day, 500 g is about 4.6 years. Symptoms are typically night-vision difficulty and reading difficulty **with preserved visual acuity** — exactly the kind of thing a patient types into a diary rather than reports to a doctor.

There is also an active US product-liability MDL (No. 2973, D.N.J.) — 1,988 cases filed, ~286 pending.

**So every free-text vision complaint in your diary is simultaneously three things:**

1. A **reportable adverse event**. India: 15 calendar days for serious, 30 for non-serious, from receipt *by anyone in the organisation*. US: 15-day alert report for serious-and-unexpected. Clock starts when the patient hits save at 2am, not when your PV officer reads it.
2. **Discoverable litigation evidence** in an active MDL.
3. A **clinical trigger** for an ophthalmology referral. If a patient logs "trouble reading at night" and nothing happens, you are in a worse position than if you had never asked.

India adds an **active screening duty**: a marketing authorisation holder must regularly screen digital media it operates for adverse events.

**Consequence:** AE detection and routing is a **Phase 2 blocking requirement**, not a nice-to-have. And it must route to a **human PV queue**, never to AI triage — AI triage of AEs would be both a device trigger and a safety failure.

### 0.5 Daily diary logging for 6 months will not happen

The evidence is brutal and consistent:

- Largest study (109,914 participants, 8 remote digital health studies): **median retention 5.5 days**. Over 50% discontinued in the first week.
- 93 real-world mental health apps: **median 30-day retention 3.3%**.
- Structured clinical ePRO does far better — 60–80% per assessment — but those are **episodic** assessments with paid site staff chasing non-responders, not daily self-logging.
- **The single biggest retention driver was clinician referral (+40 days median).** Money was second (+22 days).

Meanwhile PPS takes **5–6 months** to show maximum symptomatic benefit. So the product asks for six months of daily logging before the drug's effect is even assessable.

**Design consequences — build these in from the start:**

1. **Weekly symptom logging + a monthly structured vision check.** Not daily. The clinical need is time-to-response and new visual symptoms; neither requires daily entry. Roughly 7× less user burden.
2. **Enrolment happens in the clinic, by the treating doctor.** App-store self-signup is the 5.5-day-median path.
3. **Budget for a human in the loop.** Every source reporting good retention has a nurse, a coordinator, or money involved. An app alone does not produce adherence.

One more thing the client needs to hear: at listed Indian MRPs, 300 mg/day works out to roughly **₹5,850–₹8,300 per month**. Over a 5–6 month time-to-response that is a ₹30,000–₹50,000 commitment before the patient knows if it works. *[My arithmetic from listed MRPs — medium confidence, not a published figure.]* The adherence problem here is **economic, not behavioural**, and no app feature fixes it.

---

# 1. LOCKED DECISIONS

| # | Decision | Locked value |
|---|---|---|
| L1 | AI classification | **Non-diagnostic.** Summarise, organise, retrieve only. No dose suggestions, no AE significance calls, no risk scores, no patient ranking. |
| L2 | AI audience | **HCP-facing only in v1.** Patients see their own raw data, never AI narrative. (Driven by India TPG + FDA criterion 3.) |
| L3 | AI provider | **Abstracted** behind an internal gateway. Swappable. No provider chosen yet — but a signed zero-retention DPA is required before any real patient data flows. |
| L4 | MR tracking | **Hybrid — continuous during defined work hours only.** Hard stop outside shift. Company devices or separated work profile. |
| L5 | Platform | **Web + mobile**, delivered as two frontends over one shared core (see §5.1). Not twelve separate products. |
| L6 | Timeline | 16 weeks to pilot-ready MVP. |
| L7 | Diary cadence | **Weekly symptom log + monthly vision check.** Not daily. |
| L8 | AE routing | Always to a **human PV queue**. Never AI-triaged. |
| L9 | Enrolment | **Clinic-initiated by the treating doctor.** No app-store self-signup for the clinical side in v1. |

---

# 2. OPEN DECISIONS — these block work

| # | Decision | Blocks | Deadline |
|---|---|---|---|
| **O1** | **Data controller model** — pharma-owned vs split vs per-market. Currently flagged by client. | Schema design, consent engine, entire clinical track | **End of Week 1.** Phase 0 cannot finish without it. |
| **O2** | **Which brand, which molecule, which legal entity** (see §0.1) | Branding, MR content, regulatory owner, which market launches first | Week 1 |
| **O3** | Urologists vs gynaecologists as the detailing audience (see §0.2) | Doctor master schema, content strategy, territory design | Week 2 |
| **O4** | "Patient interactions via API" — what system, exactly? EMR? WhatsApp? Lab results? Pharmacy refills? | Integration scope. Could be 2 weeks or 3 months of work. | Week 2 |
| **O5** | Marketing/sales data scope, and where actual sales data comes from (stockist feed? manual?) | Phase 4 entirely | Week 4 |
| **O6** | Team skill inventory | Work split validity (§7 assumes a shape) | Immediately |
| **O7** | Existing "partnering Elmiron project" — not yet accessible to review | Whether this is greenfield or a rebuild | Immediately |

**On O1:** my recommendation remains the **split model** — doctor as controller of clinical data, pharma controller of commercial data only, one-way anonymised bridge. The research strengthens this considerably:

- Successful US patient support programmes use exactly this pattern: a **third-party hub** holds identified patient data, the manufacturer receives only aggregated de-identified dashboards.
- It solves the pharmacovigilance problem, the litigation-discoverability problem, and the anti-kickback problem in one architectural move.
- The anti-kickback exposure is real: a platform that lets a manufacturer see *this named doctor prescribed to these named patients* creates an auditable record of the return on every touchpoint with that prescriber. That is the evidentiary pattern enforcement looks for. ⚠️ *No on-point case exists — this is reasoning from established OIG theory. Get US healthcare-fraud counsel before you build it.*
- In India the enforcement teeth are tax, not fines: *Apex Laboratories v. DCIT* (Supreme Court, Feb 2022) made expenditure on doctor freebies non-deductible.

---

# 3. CORRECTED ARCHITECTURE

## 3.1 What was wrong in the original diagram

| Error | Correction |
|---|---|
| Women Business Advisors → Doctor Portal | Should go to **Field Mobile App**. They are field staff, not clinicians. |
| Doctors/Gynaecologists arrow direction wrong | Doctors connect to the **Doctor surface only**, and the split should be Urologist (detailing) vs Gynaecologist (referral/awareness). |
| **No Patient channel at all** | Patients are a core role in the brief and were missing entirely. Added. |
| **No Marketing/Sales channel** | Was folded into "Management/Sales Head". Split out. |
| **No compliance boundary drawn** | The most important line in the whole system was not on the picture. Added as a hard wall. |
| "AI Knowledge Assistant" sat inside Core Platform with no audience constraint | Now explicitly HCP-facing only, behind the boundary. |
| "Doctor Prioritization & Segmentation" in the AI layer | This is a risk-scoring function. Under L1 it is **cut from v1** for patient data; permitted only on commercial (non-patient) data. |

## 3.2 The one line that matters

```
COMMERCIAL DOMAIN                    ║          CLINICAL DOMAIN
MR · Manager · Marketing · Sales     ║   Doctor · Patient · PV Officer
                                     ║
Doctor master (professional data)    ║   Patient records, diagnoses,
Territory, beat plan, calls          ║   prescriptions, diary, AEs
Content, campaigns, KPIs             ║
                                     ║
        ── zero patient PII ──       ║   ── zero commercial access ──
                                     ║
                    ▲                ║
                    │                ║
        one-way, anonymised, aggregate only
        suppression threshold: hide any cell < 5 patients
        no join key back to an individual
```

**Enforce this with database row-level security and separate schemas — not with UI permissions.** A hidden button is not a control. If an MR's session token can reach a patient row through any API path, the boundary does not exist.

## 3.3 Layers

**Channels:** MR / Business Manager · Women Business Advisor · Field Manager · Urologist · Gynaecologist · Patient · Marketing & Sales · PV Officer · Admin

**Experience:** Field Mobile App (MR, WBA) · Patient Mobile App · Doctor Web + Mobile · Manager Console · Marketing Console · Admin & PV Console

**Commercial core:** doctor master · territory & beat planning · geo check-in/out · call reporting · digital detailing + CLM telemetry · UCPMP-aware input & sample management · training & certification · KPIs

**Clinical core:** consent engine · patient record · prescription & dose log · weekly diary · monthly vision check · reminders (patient + doctor) · **AE detection → human PV queue** · ophthalmic monitoring schedule

**AI layer (HCP-facing, non-diagnostic):** retrieval over approved content · patient history summary with inline source citations · visit prep brief · translation. **Cut from v1:** patient prioritisation, next-best-action on patient data, predictive signals.

**Data:** two regional deployments (India / US), never one shared database. Audit log. Anonymised aggregation service.

---

# 4. ROLE AND PERMISSION MATRIX

`R` = read · `W` = write · `A` = aggregate/anonymised only · `—` = no access, enforced at the database

| Data | MR | Manager | Marketing | Doctor | Patient | PV Officer | Admin |
|---|---|---|---|---|---|---|---|
| Own profile | RW | RW | RW | RW | RW | RW | RW |
| Doctor master (professional) | R | R | R | R (own) | — | — | RW |
| Territory / beat plan | RW own | RW team | R | — | — | — | RW |
| MR location traces | R own | R team | — | — | — | — | R |
| Call reports | RW own | R team | A | — | — | — | R |
| Content library | R | R | RW | R | — | — | RW |
| CLM telemetry | R own | R team | R | — | — | — | R |
| **Patient identity** | **—** | **—** | **—** | R own patients | RW self | R (AE cases) | R (break-glass, logged) |
| **Diagnoses** | **—** | **—** | **—** | RW own patients | R self | R (AE cases) | R (break-glass) |
| **Prescriptions / dose** | **—** | **—** | **—** | RW own patients | R self | R (AE cases) | R (break-glass) |
| **Diary entries** | **—** | **—** | **—** | R own patients | RW self | R (AE cases) | R (break-glass) |
| **AE reports** | **—** | **—** | **—** | R own | R own | RW | R |
| AI summaries | — | — | — | R own patients | **—** | — | R |
| Aggregate clinical stats | — | A | A | A | — | A | R |
| Audit log | — | — | — | — | — | R | R |

**Two rules that must survive code review:**

1. **Admin "sees everything" is break-glass, not routine.** Every admin read of a patient record writes an audit entry with a stated reason. An admin account that can silently browse patient data is the single biggest breach and insider-risk surface in the system.
2. **Patients cannot see AI summaries** (L2). This will feel wrong to the client. It is the law in India and it fails the FDA test in the US.

---

# 5. TECHNICAL BASELINE

## 5.1 How "web and mobile for everyone" gets built by three people

Two frontends, one shared core. Not twelve products.

```
packages/
  core/          types, validation, business rules, API client   ← shared
  ui-tokens/     design tokens, theme                            ← shared
apps/
  field/         Expo (React Native) — MR app, Patient app
                 needs: offline, GPS, push, camera
  console/       Next.js — Manager, Doctor, Marketing, Admin, PV
                 needs: data tables, charts, print, bulk actions
services/
  api/           Postgres + row-level security + edge functions
  ai-gateway/    provider-abstract LLM layer with PHI guard
```

**Why not one codebase for everything:** react-native-web is poor at dense data tables, charting and print — which is 90% of what a manager or marketing console does. Next.js is poor at reliable background GPS and offline sync — which is 90% of what an MR needs. Forcing one tool to do both costs more than maintaining two frontends over a shared core.

**Doctor gets both surfaces:** full web console for consultations, plus a read-only patient-lookup view in the field app shell. That satisfies "web and mobile" without a third product.

## 5.2 Data residency

**Two separate deployments, not one multi-region database.**

- India deployment → Mumbai region. All Indian patient and MR data stays there.
- US deployment → US region. Separate database, separate keys, separate LLM endpoint.
- Shared: code, schema migrations, CI. **Not shared: data.**

This solves DPDP localisation questions, US expectations, and future EU residency in one move, and it costs almost nothing to set up on day one versus a fortune to retrofit.

## 5.3 The LLM gateway — the highest-risk component on the platform

Under the US FTC Health Breach Notification Rule, a "breach of security" includes **your own unauthorised disclosure** — no intruder required. An LLM API call that ships health data outside its authorised purpose is a reportable breach. This is exactly the theory behind the FTC's GoodRx and BetterHelp actions. *[High confidence.]*

Every LLM call must pass through one gateway that:

1. **Strips or tokenises direct identifiers** before egress. The model sees "Patient 7A3" and clinical facts, not a name, phone, or address.
2. **Enforces the audience rule** — refuses to generate for a patient-facing surface.
3. **Logs every call**: who, what data class, which provider, what came back. Retained.
4. **Attaches source citations** to every output, so an HCP can independently review the basis. (This is FDA criterion 4 — an opaque narrative with no traceable source fails it.)
5. **Runs an output guard** that blocks advice-shaped language: dose recommendations, "consider", "suggests worsening", risk labels. *Prediction* is the specific trap — India's device guidance defines medical purpose to include prediction, so "symptoms suggest worsening" converts your feature into a regulated device.
6. **Is provider-agnostic** — one interface, swappable implementation.

## 5.4 EU is a different problem — do not assume the plan travels

EU guidance (MDCG 2019-11 Rev.1, June 2025) states directly:

> "Software performing searches using Natural Language Processing **does** qualify [as a medical device] if it contributes to medical purposes."

An HCP in the loop does **not** remove qualification in the EU, unlike the US. The likely outcome for an AI summarisation feature in the EU is **Class IIa under Rule 11**, which needs a Notified Body — budget 12–24 months and real money.

**Plan accordingly:** EU is not "the same product in another region." It is either a stripped feature set or a separate regulatory project. Do not promise an EU date. *[High confidence.]*

---

# 6. SCOPE — IN AND OUT FOR V1

## In

- Auth, RBAC, audit log, consent engine
- MR: beat plan, geo check-in/out, hybrid work-hours tracking, call reporting, offline sync
- Manager: team dashboard, approvals, territory KPIs, tracking review
- Doctor: patient list, diagnosis record, prescription & dose log, AI history summary, ophthalmic monitoring schedule, reminders
- Patient: enrolment via clinic, weekly symptom log, monthly vision check, medication reminders, visit reminders, own raw data view
- PV: AE detection, human triage queue, case export
- Marketing: content library, approved-content push, CLM telemetry, campaign performance, UCPMP-aware input tracking
- Admin: user/role management, break-glass with audit, system config
- AI: HCP-facing patient history summary, visit prep brief, approved-content retrieval

## Out of v1 — say no now, not in week 12

| Cut | Why |
|---|---|
| Patient-facing AI summaries | India TPG prohibition + FDA criterion 3 (L2) |
| AI patient prioritisation / risk scoring / predictive signals | Device trigger under L1 |
| Daily diary logging | Adherence evidence says it fails (§0.5) |
| EU/UK launch | Separate regulatory project (§5.4) |
| EMR integration | Blocked on O4; unbounded scope |
| Wearables / device signals | Breaks FDA criterion 1 outright |
| Doctor login-gated content portal as a primary channel | Evidence says these fail structurally. Doctors prefer face-to-face and email; virtual rep-led engagement rates lowest of all digital channels. Reserve any portal for transactional jobs the doctor actually needs — patient enrolment, referral tracking. |
| In-app doctor↔patient clinical messaging | Any free-text clinical channel becomes a teleconsultation under India TPG and drags the doctor into a separate compliance regime. Administrative reminders only in v1. |
| Incentive/commission engine on prescription data | Anti-kickback exposure. Use territory-level aggregates. |

---

# 7. THE STRICT SEQUENCE

Eight phases. **Each has a gate. Do not start the next phase until the gate passes.** The gates are the point — they are what stop a compliance problem from being discovered in week 14.

### Phase 0 — Foundations · Weeks 1–2 · No feature code

- Monorepo, CI, environment and secret management
- Auth + RBAC skeleton
- Database schema with the commercial/clinical split and row-level security
- Audit log wired in from the first write (retrofitting audit logs is brutal)
- Consent data model
- **Gate:** an automated test suite proves an MR token and a Manager token **cannot** reach any patient row through any API path, including direct queries. Reviewer signs off. Blocked on **O1**.

### Phase 1 — Commercial core · Weeks 3–6

- Doctor master with urologist/gynaecologist segmentation
- Territory and beat planning
- Geo check-in/out + hybrid work-hours tracking + written tracking policy artifact
- Call reporting with offline sync
- Manager console: team view, approvals, KPIs
- **Gate:** one real territory runs a full simulated day offline and syncs cleanly. Tracking policy document signed off.

### Phase 2 — Clinical core · Weeks 7–10 · Highest risk phase

- Consent engine: clinic-initiated enrolment, versioned consent, withdrawal handling
- Patient record, diagnosis, prescription and dose log
- Weekly diary + monthly vision check
- Reminder engine (patient + doctor), including the ophthalmic monitoring schedule
- **AE detection → human PV queue, with SLA timers**
- **Gate:** end-to-end AE test. A patient logs "trouble reading at night" → the entry is flagged within minutes → it lands in the PV queue with a running clock → a mock PV officer can export a valid case with all four required elements (identifiable patient, identifiable reporter, suspect drug, adverse event). **If this gate fails, do not proceed.** Also: consent withdrawal must not delete AE records — the legal duty to retain and report survives withdrawal.

### Phase 3 — AI layer · Weeks 11–13

- LLM gateway with PHI stripping, audience enforcement, call logging
- HCP-facing patient history summary with inline citations
- Visit prep brief
- Approved-content retrieval
- Output guard against advice-shaped and prediction-shaped language
- **Gate:** adversarial red-team. Two independent testers try to (a) make the AI give clinical advice, (b) make it surface to a patient, (c) leak an identifier to the provider, (d) produce a summary with no traceable source. All four must fail. Log review confirms no PHI in provider payloads.

### Phase 4 — Marketing, Sales, Admin · Weeks 13–15 *(overlaps Phase 3)*

- Content library, MLR-style approval workflow, approved-content push
- Digital detailing + CLM telemetry (slides shown, sequence, dwell time)
- Campaign performance dashboards
- UCPMP-aware input and sample management — value caps, auditable disclosure trail, annual self-declaration export
- Aggregate clinical stats with the suppression threshold
- Admin console, break-glass with mandatory reason
- **Gate:** a marketing user attempts to reach patient-level data by every available path and fails. Suppression threshold verified on a seeded dataset.

### Phase 5 — Hardening · Week 15

- Security review, dependency audit, penetration test
- Data Protection Impact Assessment
- Backup, restore, and breach-response runbook (India: 72-hour Board notification; US: 60-day HBNR)
- Load test
- **Gate:** clean pen test on all high findings. Restore tested from backup, not assumed.

### Phase 6 — Pilot · Week 16

- 1 territory, 2 MRs, 2 doctors, 10 patients, 1 PV officer
- Two weeks of real use before any wider rollout
- **Gate:** AE path exercised at least once with a real submission. Retention measured, not assumed.

### Phase 7 — Post-MVP backlog

RMP-reviewed patient summaries · EMR integration · additional markets · incentive engine on aggregates · EU regulatory assessment

---

# 8. WORK SPLIT — THREE TRACKS

Assumes three full-time engineers. Adjust once **O6** (skill inventory) is answered.

### Track A — Platform & Commercial
**Owns:** monorepo, CI/CD, auth, RBAC, row-level security, audit log, API core, MR field app, manager console, offline sync, GPS, DevOps, app store releases.

Weeks 1–2 Phase 0 foundations (co-owns with C) · 3–6 Phase 1 in full · 7–10 support B on API · 11–13 infra for AI gateway · 14–15 hardening lead · 16 pilot ops.

**This is the heaviest track.** Give it the strongest engineer.

### Track B — Clinical & Compliance
**Owns:** consent engine, patient record, prescription/dose model, diary, reminders, AE detection and PV queue, ophthalmic schedule, doctor console, compliance artifacts (DPIA, tracking policy, consent copy, audit design).

Weeks 1–2 consent + clinical data model, feeds A's schema · 3–6 doctor console + patient app scaffold, compliance artifacts · **7–10 Phase 2 in full — the critical path** · 11–13 support C on clinical context for AI · 14–15 DPIA and PV runbook · 16 pilot clinical support.

**Needs the most regulatory reading.** Whoever takes this must actually read §0.3, §0.4 and §4 and hold the line when someone asks to "just show patients the AI summary."

### Track C — AI, Data & Delivery
**Owns:** LLM gateway, PHI guard, output guard, summarisation, retrieval, analytics, anonymised aggregation service, marketing console, CLM telemetry, admin console, all dashboards.

Weeks 1–2 Phase 0 schema + audit (co-owns with A) · 3–6 aggregation service + analytics foundation · 7–10 marketing console + content library · **11–13 Phase 3 in full** · 13–15 Phase 4 in full · 16 pilot dashboards.

### Dependency spine — where the team blocks each other

```
O1 decision ──▶ B: clinical schema ──▶ A: RLS policies ──▶ Phase 0 gate
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
                A: Phase 1 commercial              C: aggregation service
                          │                                   │
                          └──────▶ B: Phase 2 clinical ◀───────┘
                                          │
                                          ▼
                                  C: Phase 3 AI layer
                                          │
                                          ▼
                                  C: Phase 4 marketing
```

**Three moments where the team will stall if you are not watching:**

1. **Week 1** — O1 undecided. B cannot design the clinical schema. Everything slips.
2. **Week 7** — if A's RBAC is not genuinely enforced at the database, B builds clinical features on a broken foundation and Phase 2's gate fails late.
3. **Week 11** — if B's clinical data model is not stable, C's AI layer is built against a moving target and gets rewritten.

---

# 9. RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Client insists on patient-facing AI summaries | **High** | Illegal in India, fails FDA test | Cite India TPG AI clause + FDA criterion 3. Offer the RMP-review path as phase 2. | Reviewer |
| R2 | AE volume overwhelms manual PV triage | Medium | Regulatory breach, 15-day clock missed | Structured vision-check form reduces free text. SLA timers with escalation. Staff before launch, not after. | B |
| R3 | O1 stays undecided past Week 1 | **High** | Whole schedule slips | Hard stop. Phase 0 cannot close. Escalate day 5. | Reviewer |
| R4 | Patient retention collapses (§0.5) | **High** | Product looks like a failure | Weekly not daily. Clinic enrolment. Human follow-up budgeted. Measure at pilot, do not assume. | B |
| R5 | PHI leaks to the LLM provider | Medium | FTC-reportable breach, no intruder needed | Gateway with tokenisation. Zero-retention DPA signed before real data. Log review at Phase 3 gate. | C |
| R6 | RBAC enforced in UI only, not at the database | Medium | Boundary is fiction; the entire compliance case collapses | Phase 0 gate is an automated adversarial test, not a code read. | A |
| R7 | Wrong drug/brand/entity (§0.1) | **High** | Rework of branding, content, regulatory owner | O2 answered in Week 1 | Reviewer |
| R8 | Detailing gynaecologists who do not prescribe (§0.2) | Medium | Field effort wasted, weak business case | O3 answered in Week 2. Two audiences, two modules. | Reviewer |
| R9 | MR tracking triggers field pushback or a labour dispute | Medium | Adoption failure, legal exposure | Work-hours only, company devices, written signed policy, no off-hours capture. ⚠️ No Indian case law found on employee GPS tracking — take local employment-law advice. | A |
| R10 | Anti-kickback exposure from patient↔prescriber linkage | Medium | Serious, criminal statute | Architectural separation. Territory-level MR metrics, never patient-level. ⚠️ Needs US healthcare-fraud counsel. | Reviewer |
| R11 | 16 weeks proves optimistic for 3 people | **High** | Missed date | Cut order is fixed in advance: Phase 4 marketing → AI beyond basic summary → patient app polish. Never cut Phase 0 or the Phase 2 AE gate. | Reviewer |
| R12 | Custom build cannot compete on price | Medium | Commercial non-starter | Indian SFA benchmarks are ₹1,000–2,500 per MR per month; Veeva is roughly 8–15× that. Price against the Indian band, and win on the clinical + AI layer, not on SFA features. | Reviewer |

---

# 10. WHAT I NEED FROM YOU THIS WEEK

**Decisions:** O1 (data controller — blocking), O2 (brand/entity), O6 (team skills).
**Access:** connect the existing Elmiron project folder so I can review what exists.
**Confirm:** you accept the v1 cut list in §6, especially patient-facing AI summaries being out.

---

# 11. NEXT PROMPT FOR CLAUDE CODE

See `prompt-phase-0.md`. Do not run it until **O1** is decided — the schema depends on it.

---

*Every regulatory claim here traces to the research pack of 4 Aug 2026 and carries a confidence level there. Items marked ⚠️ are unverified or need counsel. Nothing in this document is legal advice.*
