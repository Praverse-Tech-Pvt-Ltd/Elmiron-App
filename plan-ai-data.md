# AI/ML + Data Plan — PPS / Elmiron Platform

**Role:** AI/ML + Data developer · intelligence, analytics, dashboards
**Duration:** 16 weeks
**Track ID:** AI

> Read this first: the AI layer is only weeks 11–13. If your role were just "the AI", you would be idle for ten weeks and then overloaded for three. So your role is **AI/ML + Data**, and you own everything data-shaped from week one. That work is real, it is in your skill set, and it means you arrive at the AI layer already knowing the data model intimately.

---

# 1. WHAT YOU OWN

**Weeks 1–10 — data.** Data modelling (with backend) · analytics event schema · seed and test data generation · **the anonymised aggregation service and its suppression logic** · analytics pipeline · KPI computation · all dashboard data layers and charts · retention instrumentation · CLM telemetry processing.

**Weeks 9–16 — intelligence.** LLM gateway · provider abstraction · PHI guard · prompt design · retrieval index · patient history summarisation · visit prep brief · output guard · evaluation harness · red-teaming · cost monitoring.

---

# 2. FOUR RULES YOU CANNOT BREAK

Each one prevents a specific legal failure, not a style problem.

### 2.1 Never send an unmasked identifier to the model provider

The model sees `Patient 7A3` and clinical facts. Never a name, phone number, address, or any direct identifier.

Under the US FTC Health Breach Notification Rule, a "breach of security" includes **your own unauthorised disclosure** — no intruder required. An LLM API call that ships health data outside its authorised purpose is a reportable breach. This is exactly the theory behind the FTC's GoodRx and BetterHelp actions.

**The LLM gateway is the single highest-risk component in this codebase.** Treat it that way.

### 2.2 Never produce advice-shaped or prediction-shaped output

No "consider…", no "suggests worsening", no risk scores, no severity ranking, no patient prioritisation.

India's medical device guidance defines "medical purpose" to include **prediction**. A summary saying "symptoms suggest worsening" converts this feature into a regulated medical device and adds twelve to eighteen months plus a regulatory budget the project does not have.

Your output is **descriptive**. It restates what a human already entered, organised and cited.

### 2.3 Never triage an adverse event

AEs go to a human queue. Always. AI triage of an adverse event would be both a device trigger and a safety failure.

### 2.4 Never emit an aggregate covering fewer than five patients

Suppress it — render an em dash, not a number. Below five, aggregates become re-identifiable.

**And one more:** every summary ships with **traceable source citations**. That is what makes it independently reviewable by a doctor, which is precisely what keeps it a non-device under FDA's criterion 4. A summary with no traceable source fails the test.

---

# 3. WEEK BY WEEK

### Phase 0 · Weeks 1–2 · Data foundations

**W1** — data model design with backend. You are the second pair of eyes on the schema — you will be querying it for sixteen weeks. Specifically: define the **analytics event schema** (what gets emitted, when, with what shape) and review what the **audit log** must capture so it does not need retrofitting later.

**W2** — **seed and test data generator.** This is your Gate 0 deliverable. Backend's adversarial RLS test suite needs realistic fixtures: users of all nine roles, doctors across territories, patients with treating-doctor relationships, and enough volume that a suppression threshold is testable. Make it deterministic and re-runnable.

> 🚦 **GATE 0 — end of week 2.** Backend leads. Your fixtures make it possible.

### Phase 1 · Weeks 3–6 · Aggregation and analytics

**W3 — the anonymised aggregation service.** This is the **only** bridge between the commercial and clinical domains, and it is a compliance artifact as much as a piece of code.

- **One-way.** Clinical → aggregate → commercial. Never the reverse.
- **No join key back to an individual.** Not a hashed one, not a salted one. None.
- **Suppression under 5.** Any cell covering fewer than five patients renders as an em dash.
- Backend delivers **contract I3** (what crosses, in what shape) by end of week 3. Get it reviewed before you build on it.

**W4** — analytics pipeline · KPI computation
**W5** — territory KPI engine · **exception detection logic** (the manager dashboard shows what is off-plan, not what is on-plan — that logic is yours)
**W6** — manager dashboard data layer and charts

**On charts:** you own data visualisation across the whole project. Frontend builds the containers, you fill them. Read the `dataviz` guidance before the first chart — colour, form and accessibility rules matter here, and the brand palette has known contrast failures (see `design-tokens-reference.html`).

### Phase 2 · Weeks 7–10 · Clinical data, then the gateway begins

**W7** — clinical aggregate layer. **Anonymised only.** You are building the numbers a manager or marketing user can see about the patient population without ever touching a patient row.
**W8** — diary trend computation · **retention instrumentation**

> On retention: the evidence says median retention in real-world digital health apps is around **5.5 days**, and over half of users quit in week one. We are designing against that with weekly rather than daily logging and clinic-initiated enrolment. **Instrument it properly from day one** so the pilot measures retention rather than assuming it. This number decides whether the product works.

**W9** — **LLM gateway scaffold**: provider abstraction (no provider chosen yet — decision L3 says keep it swappable), request/response logging, refusal handling · **evaluation harness** so summary quality is measured, not eyeballed · publish **contract I4** (request/response shape, citation format, error and refusal cases) by end of week 9, two weeks before implementation, so frontend can build `AISummaryCard` against a real shape
**W10** — PHI guard: tokenisation and stripping before egress · prompt design · retrieval index over approved content

### Phase 3 · Weeks 11–13 · The AI layer

**W11 — patient history summary with citations.** For the doctor, who has 30–90 seconds. Readable in fifteen seconds, citations one tap away, every claim traceable to a source entry.

**W12** — visit prep brief · **output guard** · approved-content retrieval for the field team

**The output guard is the component that keeps this project non-regulated.** It blocks advice-shaped and prediction-shaped language before it leaves the gateway. Build it as a hard filter with tests, not as a prompt instruction. A prompt instruction is a request; a filter is a control.

**W13 — red-team round 1.** Adversarial testing plus a full log review confirming no PHI reached any provider payload.

> 🚦 **GATE 3 — end of week 13.** Two independent testers attempt to: (a) make the AI give clinical advice, (b) make its output reach a patient surface, (c) leak an identifier to the provider, (d) produce a summary with no traceable source. **All four must fail.** You do not run this test on your own work — the reviewer plus one other person do.

### Phase 4 · Week 14

Marketing console and **CLM telemetry processing** — which slides were shown, in what sequence, dwell time per slide, which content generated interest. Content performance analytics. This closes the marketing loop: telemetry → analytics → content revision → approved content pushed back to the field.

Plus UCPMP-aware reporting: value caps and an auditable disclosure trail.

### Phase 5 · Week 15 · Hardening

Red-team round 2 · full gateway log review · **model cost monitoring** (set a budget alarm before the pilot, not after) · DPIA data-flow map support

### Phase 6 · Week 16 · Pilot

Pilot dashboards · **retention measurement** · summary quality sampling against the evaluation harness

---

# 4. CONTRACTS

| # | Contract | Direction | Due |
|---|---|---|---|
| **I3** | Aggregation contract — what crosses the boundary, in what shape, with the suppression rule | Backend → you | **End W3** |
| **I4** | AI gateway contract — request/response, citation format, errors, refusals | **You → Frontend, Backend** | **End W9** |

You also consume **I1** (typed API contract, end W1) from backend.

---

# 5. WHAT YOU NEED FROM OTHERS

| From | What | When |
|---|---|---|
| Backend | Typed API contract (I1) | End W1 |
| Backend | Aggregation contract (I3) | End W3 |
| Backend | Clinical schema stable | End W8 — if it is still moving in W11, your AI layer gets built against a moving target and rewritten |
| Reviewer | **LLM provider decision + signed zero-retention DPA** | **Before any real patient data flows.** Consumer-tier API keys are not usable here. |
| Reviewer | Decision O5 — marketing/sales data scope | Before W14 |

---

# 6. THE TRAP TO AVOID

You have genuine slack in weeks 3–8 compared to the other two roles. The failure mode is **inventing scope** — building a recommendation engine, a risk model, a patient segmentation feature, because it is interesting and the data is right there.

Every one of those examples would convert this product into a regulated medical device.

If you have spare capacity, spend it on: the evaluation harness (built early, it improves everything downstream), test data realism, query performance, or helping frontend with chart work. **Not on new intelligence features.** Bring any idea to the reviewer before building it.

---

# 7. YOUR DEFINITION OF DONE

For the AI layer specifically: done means **Gate 3 passes when someone else tries to break it**. Not when the summaries look good to you.

---

*Legal constraints in §2 trace to the regulatory research in `PROJECT-CONTEXT.md` Part 3, with sources and confidence levels. The retention evidence in §3 is sourced there too.*
