# PROJECT-CONTEXT — PPS / Elmiron Digital Platform

**Portable handoff file. Version 1.0 · 4 August 2026.**

This file exists so a fresh Claude, in any account, can pick this project up cold with no prior conversation. It is self-sufficient — everything expensive to rediscover is written down here.

**If you are Claude reading this for the first time: read Part 1, then Part 3, then Part 4. Those three parts contain everything that will stop you giving bad advice.**

---

# PART 0 — TL;DR

- Building a **pharma field-force + clinical platform** around pentosan polysulfate sodium (PPS), branded Elmiron, for interstitial cystitis / bladder pain syndrome.
- Six user roles: MR · MR Manager · Doctor · Patient · Marketing & Sales · Admin. Plus a Pharmacovigilance Officer role that was added during planning.
- **Team of 3 engineers + 1 reviewer.** 16-week MVP target. Markets: India and US first, EU/UK later.
- **Status: planning complete, no code written yet.** Phase 0 has not started.
- **Two decisions are blocking the build** — see Part 4.
- The human's role in this project is **reviewer**. Claude writes prompts for Claude Code, the human runs them, then Claude reviews the output and writes the next prompt.

---

# PART 1 — SETTING UP THE NEW ACCOUNT

Do these five steps in order.

### Step 1 — Create the project

Name it **Elmiron App** (or whatever you prefer — the name does not matter, the instructions do).

### Step 2 — Paste this into the project's custom instructions

```
You are the reviewer on this project, not the builder.

Your loop is: write a prompt for Claude Code → the human runs it →
they bring back the result → you review it critically → you write the
next prompt. Keep doing this until told to stop.

Rules for this project:
1. Read PROJECT-CONTEXT.md before answering anything substantive.
   It holds the research findings and decisions that took real work to
   obtain. Do not re-derive them and do not contradict them without
   saying so explicitly.
2. Never soften a compliance constraint to make a feature easier.
   The constraints in Part 3 are legal, not stylistic.
3. Every Claude Code prompt you write must end with an instruction to
   append a new section to PROJECT-OVERVIEW.md in the repo — never
   overwrite an earlier section.
4. When you review Claude Code's output, check what it actually built,
   not what it says it built. Assume the summary is optimistic.
5. Flag uncertainty. If you are not sure of a regulation, a number or
   a source, say so. Do not invent citations.
6. Be direct. Point out weak reasoning, ignored risks and inconsistency.
   Skip praise. Useful truth over comfortable agreement.
```

### Step 3 — Upload these files to the project

| File | What it is | Priority |
|---|---|---|
| `PROJECT-CONTEXT.md` | **This file.** The context bootstrap. | **Essential** |
| `elmiron-master-plan.md` | Full roadmap, 8 phases, work split, risk register | **Essential** |
| `design-plan.md` | Design system plan, screen inventory, constraints | **Essential** |
| `prompt-phase-0.md` | The first Claude Code prompts (0A + 0B) | High |
| `prompt-design-01.md` | The first three design prompts (D1–D3) | High |
| `architecture-corrected.html` | Corrected architecture diagram | Medium |
| `design-tokens-reference.html` | Token + contrast reference sheet | Medium |
| `team-emails.md` | Three emails already sent to the team | Low |

### Step 4 — Check the account-level preferences carried over

The original account had preferences that shape every answer. If the new account does not have them, paste this into its personal preferences:

```
Act as my senior advisor: direct, honest, analytical. No emotional
validation, no sugarcoating, no unnecessary compliments. Question my
reasoning, test my assumptions, name my blind spots specifically. If my
argument is weak, say where. If I am factually wrong, correct me
explicitly. Point out where I am making excuses, being inconsistent, or
ignoring risk and cost. Prioritise useful truth over what I want to hear.

Write in simple, clear English. No jargon. Use bullet points over long
paragraphs. Keep it structured and concise. Substance over praise.

On honesty: flag uncertainty rather than stating it as fact. Never invent
citations, papers, URLs or quotes. Flag any statistic you are not certain
of and tell me to verify it. Remind me when a topic may have changed since
your knowledge cutoff. If I point out you are wrong, acknowledge and
correct it — do not defend a bad answer.

Whenever I ask for a Claude Code prompt, the prompt must end with a line
that creates or updates an overview markdown file of the work done. If
prompts are linked, use a single file and append to it.
```

### Step 5 — Your first message in the new project

```
Read PROJECT-CONTEXT.md. Confirm you have understood:
- the five research findings in Part 3
- the locked and open decisions in Part 4
- your role as reviewer

Then tell me what the next action is, and flag anything in the file
you think is wrong or out of date.
```

A good Claude will come back naming the two blocking decisions. If it does not, it has not read Part 4 properly.

---

# PART 2 — WHAT THIS PROJECT IS

## The product

A platform serving six roles around a prescription drug:

| Role | What they do |
|---|---|
| **MR / Business Manager** | Field sales rep. Visits doctors, details the product, logs calls. GPS-tracked during work hours. |
| **Field Manager** | Manages 8–15 MRs. Reviews routes, approves reports, tracks territory performance. |
| **Urologist** | Prescribes the drug. Manages patients. Reads AI-generated history summaries. |
| **Gynaecologist** | Different job — recognises the condition and refers. Does not prescribe. |
| **Patient** | Logs symptoms weekly, does a monthly vision check, receives reminders. |
| **Marketing & Sales** | Content library, campaign performance, approved-content management. |
| **PV Officer** | Handles adverse events against a legal clock. *Added during planning — was not in the original brief.* |
| **Admin** | Everything, but patient data only via audited break-glass. |

## The drug

**Pentosan polysulfate sodium (PPS)**, brand Elmiron. Treats interstitial cystitis / bladder pain syndrome. Approved in the US since 1996 (Janssen/J&J), in the EU since 2017 (bene-Arzneimittel — **not** J&J), and in India since May 2010.

## The working model

The human is the **reviewer**. The loop is:

```
Claude writes a Claude Code prompt
  → human runs it in Claude Code
    → human brings the result back
      → Claude reviews it critically
        → Claude writes the next prompt
```

Claude does **not** write the production code in the chat. It writes prompts and reviews output.

## The team

Three engineers plus the reviewer. Three tracks:

- **Track A — Platform & Commercial:** infra, auth, RBAC, MR app, manager console, DevOps. Heaviest track.
- **Track B — Clinical & Compliance:** consent, patient record, diary, adverse events, doctor console, compliance artifacts.
- **Track C — AI, Data & Delivery:** LLM gateway, summaries, analytics, marketing and admin consoles.

Plus one UI/UX designer working two weeks ahead of engineering.

---

# PART 3 — RESEARCH FINDINGS

**This is the most valuable part of the file.** These came from deep research on 4 August 2026 and each one cancelled or changed a feature. Do not re-derive them. Do not contradict them without saying so.

## 3.1 "Elmiron" does not exist in India

PPS **is** approved in India (CDSCO, 11 May 2010) and **is** marketed — but under different brands:

| Brand | Marketer | Listed MRP |
|---|---|---|
| Comfora | Swati Spentose | ₹650 / 10 caps |
| Cystopen | Sun Pharmaceutical | ₹740.63 / 10 caps |
| For-IC | Cipla | ₹921 / 10 caps |
| Pentossan 100 | AMPS Biotech | ₹6,093.75 / 90 caps |

Yet the client's brand guideline is titled *Elmiron® … India*. **Unresolved conflict.** Either they are launching Elmiron as a new India entry, or the guideline was written without checking. This is open decision **O2**.

Cost note: at 300 mg/day the patient takes 90 capsules a month, roughly **₹5,850–8,300 per month**. *(My arithmetic from listed MRPs — not a published figure.)* With a 5–6 month time to response, that is a ₹30,000–50,000 commitment before the patient knows if it works. **The adherence problem here is economic, not behavioural.** No app feature fixes it.

## 3.2 It is a urology drug, not a women's health drug

- The approved indication is a **bladder** indication in every market.
- The governing guideline is the **AUA** (American *Urological* Association), 2022. There is no equivalent gynaecology guideline.
- US prevalence skews ~5:1 female, but 1–4 million US men also have it, underdiagnosed as chronic prostatitis.
- **In India the skew is much weaker** — one 316-case Indian series reported roughly **3:2** female:male.
- Indian literature reports gynaecologists frequently **misdiagnose** IC/BPS, historically as genitourinary tuberculosis.
- India has very few urologists — roughly **one per 564,000 people** (~2,425 society members as of 2018). The detailing call list is small and concentrated.

**Consequence:** urologists are the detailing audience; gynaecologists are a case-finding and referral audience. Two modules, two jobs. The client's original architecture diagram had this wrong. The brand's *"for women"* line has the same error and should not enter the product UI.

## 3.3 AI is legally forbidden from counselling patients

India's Telemedicine Practice Guidelines state:

> "Technology platforms based on Artificial Intelligence/Machine Learning are **not allowed to counsel the patients or prescribe any drugs** to a patient." AI may assist the registered medical practitioner, but "the final prescription or counseling has to be **directly delivered by the RMP**."

US FDA reaches the same conclusion by a different route: the Clinical Decision Support non-device exclusion runs to **health care professionals only**. Patient-facing output fails the test outright.

**Consequence:** AI summaries are **HCP-facing only** in v1. Patients see their own raw data, never AI narrative. A patient-facing summary is a phase-2 feature requiring RMP review and an audit trail.

*Note: FDA's CDS final guidance was reissued in January 2026 and replaced the September 2022 version. The new one is more permissive for summarisation. Anyone citing the 2022 version is working from a superseded document.*

## 3.4 The patient diary is legally an adverse-event intake channel

PPS carries a documented **pigmentary maculopathy** (retinal damage) risk.

- Reported prevalence by cumulative dose: ~12.7% at 500–999 g, ~30% at 1000–1500 g, ~41.7% above 1500 g. At 300 mg/day, 500 g ≈ 4.6 years.
- Symptoms: prolonged dark adaptation, night-vision difficulty, **difficulty reading**, blurred vision, metamorphopsia — often with **preserved visual acuity**.
- The US label requires a baseline retinal exam within six months of starting, then periodic exams. **The required cadence differs between US and EU labels** — do not hardcode one schedule.
- There is an active US product-liability MDL (No. 2973, D.N.J.): 1,988 cases filed, ~286 pending.

**So every vision complaint in the diary is three things at once:** a reportable adverse event, discoverable litigation evidence, and a clinical referral trigger.

Reporting clocks:

| Market | Serious AE | Non-serious |
|---|---|---|
| India | 15 calendar days | 30 calendar days |
| US | 15 calendar days (serious + unexpected) | Periodic |

**"Receipt" means receipt by anyone in the organisation.** The clock starts when the patient hits save at 2am, not when a PV officer reads it. India adds an active duty to screen digital media the company operates.

**Consequence:** AE detection and routing to a **human** queue is a Phase 2 blocking gate, not a feature. AI must never triage an AE.

## 3.5 Daily diary logging will not happen

| Source | Finding |
|---|---|
| Pratap et al., npj Digital Medicine (109,914 participants, 8 studies) | **Median retention 5.5 days.** >50% quit in week one. Clinician referral was the biggest retention driver (+40 days median); money was second (+22 days). |
| Baumel et al. (93 real-world mental health apps) | Median 30-day retention **3.3%** |
| Clinical ePRO trials | 60–80% per assessment — but **episodic**, not daily, with paid staff chasing non-responders |

Meanwhile PPS takes **5–6 months** to show maximum benefit.

**Consequence:** weekly symptom log + monthly structured vision check. Clinic-initiated enrolment, not app-store signup. Budget for a human in the loop — every study showing good retention has a nurse, a coordinator, or money involved.

## 3.6 Regulatory constraint table

| Constraint | Source | Confidence |
|---|---|---|
| AI cannot counsel patients | India Telemedicine Practice Guidelines | High |
| CDS non-device exclusion is HCP-only | FDA CDS final guidance, Jan 2026 | High |
| AI output needs traceable sources for HCP independent review | FDA CDS criterion 4 | High |
| "Prediction" makes software a medical device in India | CDSCO MDSW guidance | Medium-High |
| Serious AE: 15 days, from receipt by anyone | IPC PV Guidance for MAHs v2; 21 CFR 314.80 | High |
| Pharma is **not** a HIPAA covered entity — doctors need a signed **HIPAA Authorization** (45 CFR 164.508), not consent, to disclose PHI to a pharma platform | HHS | High |
| Washington My Health My Data Act — no volume threshold, private right of action, symptom diary is in scope. **MR tracking is excluded** (employment context). Absolute geofencing ban around healthcare facilities. | RCW 19.373 | High |
| FTC Health Breach Notification Rule applies; a "breach" includes **your own unauthorised disclosure** — an LLM API call leaking health data is reportable with no intruder | 16 CFR 318, amended 2024 | High |
| India DPDP: substantive obligations from ~May 2027, consent-manager rules ~Nov 2026. 72-hour breach notice to the Board. No "sensitive data" tier. | DPDP Act 2023 + Rules 2025 | High |
| UCPMP 2024 constrains pharma-doctor interaction; brand reminders capped ₹1,000; annual self-declaration. **The real teeth are tax** — *Apex Laboratories v. DCIT* (SC, 2022) made doctor freebies non-deductible. | Dept. of Pharmaceuticals | High |
| **EU is stricter than the US.** MDCG 2019-11 Rev.1 (June 2025): *"Software performing searches using NLP does qualify [as a medical device] if it contributes to medical purposes."* An HCP in the loop does **not** remove qualification. Likely **Class IIa**, needing a Notified Body — 12–24 months. | MDCG 2019-11 Rev.1 | High |
| EU AI Act Article 50 transparency is live since 2 Aug 2026 and was **not** deferred | AI Act Art. 50 | High |
| India employee GPS: no dedicated statute. DPDP s.7(i) employment exemption + proportionality. Off-hours tracking of personal devices falls outside it. | Commentary only | **Medium — no Indian case law found. Take local advice.** |
| Anti-Kickback: a platform linking named patients to named prescribers creates the evidentiary pattern enforcement looks for | Reasoning from OIG theory | **Medium — no on-point case exists. Needs US counsel.** |

## 3.7 Design and accessibility findings

The client's brand guideline (Elmiron Brand Identity v1.0, 2025) has two **measured** failures. Ratios computed to the WCAG 2.x formula, reproducible:

| Pair | Ratio | Verdict |
|---|---|---|
| Sage `#8AAB8A` on white — **their primary button spec** | **2.54:1** | Fails AA, AA-large, AAA |
| Sage on cream | 2.35:1 | Fails everything |
| Sage Deep on Sage Pale — **their badge spec**, at 10.4px | **4.33:1** | Fails AA normal text |
| Sage Deep `#4A7A4A` on white | 5.03:1 | AA only |
| Muted `#6B6B68` on cream | 4.95:1 | AA only |
| Charcoal `#2C2C2A` on cream | 12.96:1 | AAA ✓ |
| Sage Light `#B8CDB8` on charcoal | 8.30:1 | AAA ✓ |

The default button state fails and the hover state passes — backwards, since mobile has no hover.

**Corrected product tokens** (same hue, dark enough to read):

```
interactive         #4A7A4A   4.66 cream / 5.03 white   AA
interactive-strong  #35593A   7.36 cream / 7.95 white   AAA
interactive-ink     #2F5233   8.18 cream / 8.84 white   AAA
on-dark             #B8CDB8   8.30 on charcoal          AAA
```

**The critical link:** the brand specifies **Cormorant Garamond weight 300** and **DM Sans weight 300 at 14–16px**. The users of this app may have **drug-induced night-vision and reading difficulty** (see 3.4). Light-stroke serifs and thin body text are the worst possible setting for them. Patient app requires **18px minimum, weight 400 minimum, AAA contrast, real dark mode, 200% text scaling**.

Two brand claims flagged for legal review: *"India's Best Oral PPS Therapy"* (superlative comparative claim) and the *"FDA Approved"* badge used in an Indian context. By contrast, *"the only oral medication approved for IC/BPS"* appears accurate.

---

# PART 4 — DECISIONS LOG

## Locked — do not reopen without a stated reason

| # | Decision |
|---|---|
| L1 | AI is **non-diagnostic**. Summarise, organise, retrieve only. No dose suggestions, no AE significance calls, no risk scores, no patient ranking. |
| L2 | AI is **HCP-facing only** in v1. Patients see raw data, never AI narrative. |
| L3 | LLM provider is **abstracted** behind an internal gateway. Not yet chosen. A signed zero-retention DPA is required before any real patient data flows. |
| L4 | MR tracking is **hybrid** — continuous during defined work hours only, hard stop outside shift, company devices or separated work profile. |
| L5 | **Web + mobile**, delivered as two frontends (Expo + Next.js) over one shared core. Not twelve products. |
| L6 | 16 weeks to pilot-ready MVP. |
| L7 | Diary is **weekly** symptom log + **monthly** vision check. Not daily. |
| L8 | AE routing always goes to a **human** PV queue. Never AI-triaged. |
| L9 | Enrolment is **clinic-initiated** by the treating doctor. No app-store self-signup for the clinical side in v1. |
| D1 | Design uses **two-tier tokens** — brand tier untouched, product tier derived and accessibility-corrected. |
| D2 | **Custom mobile design, library-based web** (shadcn/ui or similar for consoles). |
| D3 | Design order: **design system first, then MR app.** Design leads engineering by two weeks. |

## Open — these block work

| # | Decision | Blocks | Status |
|---|---|---|---|
| **O1** | **Data controller model** — pharma-owned vs split (doctor controls clinical) vs per-market. Client initially said pharma-owned; after seeing the US analysis they flagged it for review. | Schema, consent engine, the whole clinical track. **Phase 0B cannot run.** | **Flagged by client, awaiting update** |
| **O2** | Which brand, which molecule, which legal entity (see 3.1) | Branding, MR content, regulatory owner, launch market | Open |
| **O3** | Urologists vs gynaecologists as the detailing audience | Doctor master schema, content strategy, territory design | Open |
| **O4** | "Patient interactions via API" — what system exactly? EMR, WhatsApp, lab results, pharmacy refills? | Integration scope. Could be 2 weeks or 3 months. | Open |
| **O5** | Marketing/sales data scope, and where actual sales data comes from | Phase 4 entirely | Open |
| **O6** | Team skill inventory | Whether the three-track split is valid | Open |
| **O7** | The existing "partnering Elmiron project" in the client's projects directory — never made accessible for review | Whether this is greenfield or a rebuild | Open |

**Reviewer's standing recommendation on O1:** the split model. Doctor controls clinical data, pharma controls commercial only, one-way anonymised bridge with suppression under 5 patients. It solves the pharmacovigilance, litigation-discoverability and anti-kickback problems in one architectural move, and mirrors how successful US patient support programmes are structured (a third-party hub holds identified data; the manufacturer sees only aggregates).

---

# PART 5 — CURRENT STATE

**As of 4 August 2026: planning complete. No code written. Phase 0 has not started.**

## What exists

| Artifact | State |
|---|---|
| Master plan (16 weeks, 8 phases, work split, risk register) | Complete |
| Corrected architecture diagram | Complete |
| Phase 0 Claude Code prompts (0A runnable, 0B blocked on O1) | Complete |
| Design plan (screen inventory, constraints, 8-week sequence) | Complete |
| Token + contrast reference | Complete |
| Design prompts D1–D3 | Complete |
| Team emails (3, sent) | Complete |
| Regulatory research pack | Complete |

## What does not exist

- Any code
- `PROJECT-OVERVIEW.md` in the repo (Prompt 0A creates it)
- `DESIGN-OVERVIEW.md` in the design repo (Prompt D1 creates it)
- Design prompts D4–D7
- Claude Code prompts for Phases 1–7
- Any legal sign-off on the ⚠️ items in 3.6

## Position in the sequence

```
Planning          ████████████ done
Phase 0A          ░░░░░░░░░░░░ ready to start
Phase 0B          ░░░░░░░░░░░░ blocked on O1
Design D1         ░░░░░░░░░░░░ ready to start
Phases 1–7        ░░░░░░░░░░░░ not started
```

---

# PART 6 — WHAT HAPPENS NEXT

**Immediate, in parallel:**

1. Engineering runs **Prompt 0A**. Two weeks. Gate: the adversarial RLS test suite proves an MR token gets permission-denied on clinical data through all five attack paths.
2. Designer runs **Prompt D1**. One week. Gate: `check-contrast.ts` fails the build on a bad token; every patient-app text token at 7:1 or better.
3. Reviewer chases **O1** and **O2**. Both are day-five escalations, not week-three ones.

**Then:** review 0A output → write the Phase 1 prompt. Review D1 → approve D2.

**Standing rule:** never start a phase until the previous gate passes. The gates exist to stop a compliance problem surfacing in week 14, when it costs ten times more to fix.

---

# PART 7 — HOW TO KEEP THIS FILE CURRENT

A handoff file that drifts is worse than none, because people trust it.

## When to update

| Trigger | Update |
|---|---|
| An open decision (O1–O7) gets answered | Move it to Locked. Note what it unblocked. |
| A phase gate passes | Part 5 status, Part 6 next steps |
| Claude Code delivers a phase | Part 5 "what exists" |
| New research changes a finding | Part 3, with the date and the source |
| A locked decision gets reversed | Part 4, **with the reason written down** |
| A new risk appears | Part 3 or the master plan risk register |
| End of any working session that changed something | All of the above |

**Do not update for:** conversations that produced no decision, drafts, or exploratory discussion. Churn makes the file untrustworthy.

## The update prompt — paste this at the end of a working session

```
Update PROJECT-CONTEXT.md for this session.

Rules:
- Bump the version number and the date at the top.
- Add an entry to the Change Log at the bottom: date, what changed, why.
- Move any answered open decision from Part 4 Open to Part 4 Locked,
  and note what it unblocked.
- Update Part 5 (current state) and Part 6 (what's next) to match reality,
  not intentions.
- If a locked decision was reversed, write down the reason. Never delete
  a decision silently.
- If new research changed a finding in Part 3, update it with the date
  and source, and mark clearly what the old position was.
- Do not add anything speculative. If it has not been decided, it stays
  in Open.

Then give me the updated file.
```

## Rules for whoever maintains this

1. **One file, one truth.** If this file and a chat message disagree, this file wins — or you update it immediately.
2. **Never delete a decision.** Move it, reverse it, annotate it. A decisions log with gaps is how teams relitigate the same argument three times.
3. **Findings carry their confidence level.** If you cannot source it, mark it unverified. This file's value is that it can be trusted.
4. **Part 5 describes what exists, not what is planned.** The most common failure mode of a handoff file is describing intentions as if they were reality.
5. **Re-verify the ⚠️ items before launch.** Several regulatory findings were explicitly flagged as needing counsel or as having no case law behind them. They have not been cleared.

## Two-file system in the repos

This file is the **project** context. Separately, the code and design repos each carry their own append-only log:

- `PROJECT-OVERVIEW.md` in the code repo — created by Prompt 0A, appended by every later Claude Code prompt
- `DESIGN-OVERVIEW.md` in the design repo — created by Prompt D1, appended by every later design prompt

Neither is ever overwritten. `PROJECT-CONTEXT.md` summarises; those two record.

---

# CHANGE LOG

| Date | Version | Change |
|---|---|---|
| 4 Aug 2026 | 1.0 | Initial file. Planning complete, no code. O1 and O2 blocking. |

---

*Regulatory findings trace to a research pack dated 4 August 2026 and carry confidence levels. Items marked ⚠️ are unverified or need qualified counsel. Contrast ratios are computed to the WCAG 2.x formula and are reproducible. Nothing in this file is legal advice.*
