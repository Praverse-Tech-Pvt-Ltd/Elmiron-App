# Work Split — Frontend · Backend · AI/ML

**Version 1.0 · 4 August 2026**
Replaces the three feature-tracks in `elmiron-master-plan.md` §8. Everything else in that plan stands.

---

# 0. THE PROBLEM WITH A STRAIGHT DISCIPLINE SPLIT

You asked for frontend / backend / AI-ML. Here is what that produces if applied literally.

| Role | Natural share of this project | When the work lands |
|---|---|---|
| **Frontend** | ~60% — 64 screens, 7 role surfaces, 2 platforms | Weeks 3–15, continuously overloaded |
| **Backend** | ~30% — schema, security, APIs, sync, infra | Weeks 1–15, steady |
| **AI/ML** | **~10%** — the AI layer is Phase 3 only | **Weeks 11–13 only. Idle weeks 1–10.** |

Two failure modes, both predictable:

1. **The AI/ML developer has nothing to do for ten weeks.** In practice they will not sit idle — they will invent work. That is how a project acquires a recommendation engine nobody asked for and a feature that turns the product into a regulated medical device.
2. **The frontend developer drowns from week 3 onward.** Sixty-four screens, two platforms, every screen needing loading, empty, error and offline states. One person cannot do this in twelve weeks while the other two have slack.

**So I have kept your three role labels and rebalanced what sits under them.** The AI/ML role becomes **AI/ML + Data** and owns everything data-shaped from week one: the aggregation service, analytics, KPI computation, dashboards and charts. That is genuine data-engineering work, it is in their skill set, and it means they arrive at the AI layer in week 11 already knowing the data model intimately.

If your AI/ML person genuinely cannot do SQL, data modelling and analytics, tell me now — the split has to change again, and the honest answer would be to hire differently or cut scope.

---

# 1. THE THREE ROLES

## 🔵 BACKEND — data, security, APIs, infrastructure

Owns the compliance boundary. This is the highest-risk role: if the permission model is wrong, nothing else matters.

**Owns:** monorepo, CI/CD, DevOps, Supabase (two regions), auth, RBAC, row-level security, audit log, consent engine, all APIs, offline sync protocol, adverse-event detection engine, reminder engine, integrations, backup and restore, security hardening.

**Also owns, and this is not optional:** the **typed API contract and a running mock server by end of week 2**. Frontend must never wait on backend. If the mock server slips, the whole schedule slips behind it.

## 🟢 FRONTEND — every screen, both platforms

Biggest bucket by volume. Needs active scope protection from the reviewer.

**Owns:** Expo/React Native app shell (MR + Patient), Next.js app shell (all consoles), shared `packages/core` and `packages/ui-tokens` consumption, every screen, offline UI and sync state, forms and validation, accessibility implementation, app store releases.

**Does not own:** dashboard charts and data visualisation — those go to AI/ML+Data, who are already computing the numbers.

## 🟣 AI/ML + DATA — intelligence, analytics, dashboards

Real work from week one. The AI layer is the last third of their job, not the whole of it.

**Owns:** data modelling (co-owned with backend), analytics event schema, **anonymised aggregation service and suppression logic**, KPI computation, all dashboard data layers and charts, CLM telemetry processing, seed and test data generation, retention instrumentation, then the **LLM gateway, PHI guard, output guard, summarisation, retrieval and the AI evaluation harness**.

---

# 2. WEEK-BY-WEEK OWNERSHIP

Design runs two weeks ahead throughout. `▓` = primary owner, `░` = supporting.

| Wk | Phase | 🔵 Backend | 🟢 Frontend | 🟣 AI/ML + Data |
|---|---|---|---|---|
| **1** | P0 | ▓ Monorepo, CI, 2× Supabase regions, auth, roles | ▓ Expo + Next.js scaffolds, token pipeline | ▓ Data model design (with BE), analytics event schema |
| **2** | P0 | ▓ **RLS policies, audit log, consent model, API contract + mock server** | ▓ Shell nav, layout primitives, component wiring | ▓ Seed/test data generator, audit log design ░ |
| | | **GATE: adversarial RLS suite — MR token denied on clinical data via all 5 paths** | | |
| **3** | P1 | ▓ Doctor, territory, beat-plan APIs. Geo check-in/out. | ▓ **Field app: MR day flow, check-in/out** | ▓ **Aggregation service + suppression logic** |
| **4** | P1 | ▓ Offline sync protocol, conflict resolution | ▓ Field app: call report, detailing, offline UI | ▓ Analytics pipeline, KPI computation |
| **5** | P1 | ▓ Manager APIs, approval hierarchy, content storage | ▓ Field app finish, **tracking transparency screen** | ▓ Territory KPI engine, exception detection logic |
| **6** | P1 | ▓ API hardening, sync edge cases | ▓ **Manager console** — shell, approvals, route review | ▓ **Manager dashboard charts + data layer** |
| | | **GATE: one territory runs a full offline day and syncs clean. Tracking policy signed.** | | |
| **7** | P2 | ▓ **Clinical schema (0B), consent engine**, patient/diagnosis/prescription APIs | ▓ **Patient app: enrolment, consent flow** | ▓ Clinical aggregate layer (anonymised only) |
| **8** | P2 | ▓ Diary + vision check APIs, ophthalmic schedule engine | ▓ Patient app: home, weekly log, dose confirm | ▓ Diary trend computation, **retention instrumentation** |
| **9** | P2 | ▓ **AE detection engine + SLA timers**, reminder engine | ▓ Patient app: vision check, AE report flow | ▓ **LLM gateway scaffold**, provider abstraction, eval harness |
| **10** | P2 | ▓ AE case export, PV APIs, consent withdrawal handling | ▓ **Doctor console**: patient list, patient detail | ▓ PHI guard design, prompt design, retrieval index |
| | | **GATE: AE end-to-end. Patient logs a vision symptom → PV queue with running clock → valid case export. Withdrawal does not delete AE records.** | | |
| **11** | P3 | ▓ PHI tokenisation service, AI call audit trail ░ | ▓ Doctor console: diagnosis, prescription entry | ▓ **Patient history summary with citations** |
| **12** | P3 | ▓ Integration work (pending O4) | ▓ Doctor console: ophthalmic schedule, AISummaryCard | ▓ **Visit prep brief, output guard, content retrieval** |
| **13** | P3/P4 | ▓ Marketing APIs, UCPMP input tracking | ▓ Gynaecologist referral surface | ▓ **AI red-team round 1**, log review |
| | | **GATE: red-team. AI cannot give advice, cannot reach a patient, cannot leak an identifier, cannot produce an uncited summary. All four must fail.** | | |
| **14** | P4 | ▓ Admin APIs, break-glass, audit viewer API | ▓ **PV console, Admin console** | ▓ **Marketing console + CLM telemetry, content performance** |
| **15** | P5 | ▓ **Security hardening, pen test remediation, backup/restore** | ▓ Accessibility audit fixes, performance, polish | ▓ AI red-team round 2, cost monitoring, DPIA data-flow map ░ |
| | | **GATE: clean pen test on high findings. Restore tested from backup, not assumed.** | | |
| **16** | P6 | ▓ Pilot ops, monitoring, on-call | ▓ Pilot bug fixes | ▓ Pilot dashboards, retention measurement |
| | | **GATE: AE path exercised once with a real submission. Retention measured, not assumed.** | | |

---

# 3. INTERFACE CONTRACTS

Four contracts. Each has an owner and a date. Miss one and two people stall.

| # | Contract | Owner | Consumers | Due | What it is |
|---|---|---|---|---|---|
| **I1** | **Typed API contract** — `packages/core` types + Zod schemas | 🔵 Backend | 🟢 FE, 🟣 AI | **End W1** | Types land before endpoints. FE codes against types, not against a live server. |
| **I2** | **Mock server** returning realistic fixtures for every endpoint | 🔵 Backend | 🟢 Frontend | **End W2** | The single most important unblocking artifact in the project. FE never waits. Keep it running all 16 weeks. |
| **I3** | **Aggregation contract** — what the anonymised bridge exposes, in what shape, with the suppression rule | 🔵 BE → 🟣 AI | 🟢 FE | **End W3** | Defines exactly what crosses the commercial/clinical boundary. Review this one carefully — it is a compliance artifact. |
| **I4** | **AI gateway contract** — request/response shape, citation format, error and refusal cases | 🟣 AI | 🟢 FE, 🔵 BE | **End W9** | Defined two weeks before implementation so FE can build `AISummaryCard` against it. |

**Rule: no interface changes silently.** A breaking change to I1–I4 gets announced in writing before it lands.

---

# 4. HARD BOUNDARIES — what each role must never do

These are not style preferences. Each one prevents a specific failure.

### 🟢 Frontend must never

- **Implement permission logic in the client.** Never filter data client-side for security reasons. Assume the API returns only what the user is allowed to see. If the API returns something it shouldn't, that is a backend bug — report it, do not hide it.
- **Put patient data on any MR, manager or marketing screen.** Not in a list, chart, tooltip, export or empty state. If a screen would be more useful with patient data, that is the constraint working.
- **Render an AI summary on any patient-facing surface.** Legally prohibited in India, fails the FDA test in the US.
- Ship a component without a press state. There is no hover on a phone.

### 🔵 Backend must never

- **Rely on the frontend to enforce access.** Every rule lives in row-level security. Assume a valid token issuing raw queries.
- **Let the AI layer write to a clinical field.** AI output goes to a separate summary object the doctor can dismiss.
- **Let an adverse-event record be deleted by consent withdrawal.** The legal duty to retain and report survives withdrawal. This needs a test, not a comment.
- Return an empty list where it should return permission-denied. Empty means the filter is in application code, and application code changes.

### 🟣 AI/ML must never

- **Send an unmasked identifier to the model provider.** The model sees "Patient 7A3" and clinical facts. Under the FTC rule, an unauthorised disclosure is a reportable breach with no intruder involved.
- **Produce advice-shaped or prediction-shaped output.** No "consider", no "suggests worsening", no risk scores, no patient ranking. "Prediction" is a medical purpose under India's device guidance — it converts the feature into a regulated device.
- **Triage an adverse event.** AEs go to a human queue, always.
- **Emit an aggregate covering fewer than 5 patients.** Suppress it.
- Ship a summary without traceable source citations. That is what makes it independently reviewable, which is what keeps it a non-device.

---

# 5. WHERE THIS SPLIT WILL BREAK

| Risk | Likelihood | Watch for | Mitigation |
|---|---|---|---|
| **Frontend overload from W7** — patient app and doctor console overlap | **High** | FE behind by more than 3 days at the W6 checkpoint | Cut order is pre-agreed (§6). AI/ML takes all chart and dashboard work. Reviewer refuses new screen requests. |
| **AI/ML invents scope in W1–10** | **High** | Anything appearing that is not in the grid above | Their W1–10 work is specified and gated. Weekly check that they are on aggregation and analytics, not prototyping a recommender. |
| **Mock server slips past W2** | Medium | Any excuse involving "the real API is nearly ready" | It is not optional. FE blocked for a week costs more than the mock server costs to build. |
| **Backend becomes a bottleneck in W7–9** | Medium | Clinical schema, consent engine and AE engine all land in three weeks | This is the densest backend stretch in the project. AI/ML supports on data modelling. Consider moving reminder engine to W10. |
| **Nobody owns QA** | **High** | Bugs found at the pilot instead of at the gate | Each role tests their own. The **reviewer verifies every gate independently** — do not accept a passing report, run the test. |
| **Bus factor of 1 on every role** | High | One person off sick in W9 | Each writes docs as they go. `PROJECT-OVERVIEW.md` is appended every phase, not at the end. |
| **O1 still unanswered at W7** | **High** | It is already flagged and unresolved | Clinical schema cannot be built. Backend loses two weeks. Escalate now, not in week six. |

---

# 6. CUT ORDER — agreed in advance

When the schedule slips — and it will — cut in this order, top first. Never negotiate this in the moment.

1. Marketing console → manual process for the pilot
2. Gynaecologist referral surface → phase 2
3. Admin console polish → functional but plain
4. PV console polish → functional but plain, **the SLA clock stays**
5. Visit prep brief → history summary alone is enough for the pilot
6. Field app: expenses, training, certification
7. Patient app: my-visits, help screens

**Never cut:** Phase 0 in any form · the Phase 2 adverse-event gate · row-level security · the audit log · the AI output guard · patient-app accessibility.

Those six are the difference between a product and a liability.

---

# 7. FIRST WEEK, BY PERSON

**🔵 Backend — start Monday**
Run Prompt 0A from `prompt-phase-0.md`. Monorepo, CI, two Supabase regions, auth, roles. **Publish `packages/core` types by Friday** — frontend is waiting on them.

**🟢 Frontend — start Monday**
Expo and Next.js scaffolds inside the monorepo. Wire the token pipeline from the designer's `design-tokens.json`. Build the app shells and navigation against the types backend publishes Friday. Do not build screens yet — design D3 lands in week 3.

**🟣 AI/ML + Data — start Monday**
Work with backend on the data model, specifically the analytics event schema and what the audit log must capture. Build the seed and test data generator — the adversarial RLS test suite in the Phase 0 gate needs realistic fixtures, and that is your deliverable for week 2.

**Reviewer**
Chase O1 and O2. Both are day-five escalations. Verify the Phase 0 gate personally at end of week 2 — run the test suite, do not read the report.

---

# 8. REPO HOUSEKEEPING

Noticed in `D:\Praverse\Elmiron-App`:

- `elmiron-master-plan_1.md` is a byte-identical duplicate of `elmiron-master-plan.md`. Delete one before anyone edits the wrong copy.
- `architecture-corrected.html` and `team-emails.md` are missing from the repo.
- The repo currently holds only planning docs. Before Prompt 0A runs, decide whether code goes in this repo or a separate one. **Recommendation: same repo, with `/docs` for the planning files and the monorepo at the root.** One place to look.

---

*This split replaces §8 of the master plan. All constraints in §5 trace to the regulatory research of 4 August 2026 and are documented with sources in `PROJECT-CONTEXT.md` Part 3.*
