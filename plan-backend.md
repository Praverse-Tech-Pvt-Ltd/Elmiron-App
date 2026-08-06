# Backend Plan — PPS / Elmiron Platform

**Role:** Backend developer · data, security, APIs, infrastructure
**Duration:** 16 weeks
**Track ID:** BE

> You own the compliance boundary. If the permission model is wrong, nothing else in this project matters. Read §2 before you write a line.

---

# 1. WHAT YOU OWN

Monorepo and CI/CD · DevOps and deployments · two Supabase regions · auth and roles · **row-level security** · audit log · consent engine · every API · offline sync protocol · adverse-event detection engine · reminder engine · integrations · backup and restore · security hardening.

**And one thing that is not optional:** the typed API contract by end of week 1, and a **running mock server by end of week 2**. Frontend builds against your mock for sixteen weeks. If it slips, the whole project slips behind it.

---

# 2. THE THING THAT MATTERS MOST

This platform has two data domains that must never mix.

- **Commercial** — MRs, managers, marketing. Doctor professional data, territories, call reports, content.
- **Clinical** — doctors, patients, safety officers. Patient identity, diagnoses, prescriptions, diary entries, adverse events.

**A commercial user must never reach clinical data through any code path.**

Enforce it in **Postgres row-level security**. Not in application code, not in the UI. Assume an attacker holds a valid MR session token and is issuing raw SQL, calling functions, querying views, and joining from commercial tables.

**Permission denied, not an empty result.** An empty list means the filter lives in your application code — and application code changes, gets refactored, and gets bypassed by the next endpoint someone adds.

Three rules that follow:

1. RLS on **every** table. No table readable without an explicit policy.
2. Revoke schema-level `USAGE` on the clinical schema from commercial roles. Second layer.
3. Admin has **no direct SELECT policy** on clinical tables. Admin reads clinical data only through a break-glass function that requires a typed reason and **writes the audit row before returning data**.

---

# 3. WEEK BY WEEK

### Phase 0 · Weeks 1–2 · Foundations
**No product features.** Build the skeleton and prove the boundary.

**Week 1** — Turborepo monorepo, pnpm workspaces, strict TypeScript, ESLint/Prettier · GitHub Actions running typecheck, lint, tests · two Supabase projects (Mumbai + US), same migrations, separate data, environment-switched · Supabase Auth with email/password and OTP · nine roles: `mr`, `field_manager`, `marketing`, `urologist`, `gynaecologist`, `patient`, `pv_officer`, `admin`, `system` · `user_profiles` linking auth users to one role and a territory · **publish `packages/core` types by Friday — frontend is waiting**

**Week 2** — commercial schema: `organisations`, `territories` (hierarchical), `doctors` (professional data only, specialty-segmented), `doctor_visits`, `beat_plans`, `content_items` · clinical schema namespace + a single placeholder `clinical.patients` table, **deliberately incomplete** · RLS policies for all nine roles · audit log written by database triggers, append-only, no UPDATE or DELETE policy for anyone including admin, every clinical **read** logged not just writes, minimum one-year retention · consent data model, immutable, withdrawal is a new row never an update · **mock server running with realistic fixtures for every endpoint**

> 🚦 **GATE 0 — end of week 2.** Automated adversarial test suite. Seed users of every role. For `mr`, `field_manager` and `marketing`, attempt to read `clinical.patients` via REST, direct SQL, a join from a commercial table, a Postgres function, and a view. **All fifteen attempts must fail with permission denied.** Plus: MR cannot read another territory's doctors · doctor cannot read a patient they do not treat · patient cannot read another patient · break-glass returns data only with a reason and writes the audit row first · `audit_log` rejects UPDATE and DELETE from every role.
>
> If any test passes when it should fail — stop and report it. Do not work around it in application code.

### Phase 1 · Weeks 3–6 · Commercial core

**W3** — doctor, territory and beat-plan APIs · geo check-in/check-out with work-hours enforcement (capture hard-stops outside the shift window)
**W4** — offline sync protocol · conflict resolution · queue semantics the frontend can show honestly
**W5** — manager APIs, approval hierarchy over the territory subtree · content storage and versioning
**W6** — API hardening, sync edge cases, load characteristics

> 🚦 **GATE 1 — end of week 6.** One territory runs a full simulated day offline and syncs clean. No lost writes, no duplicates, conflicts resolved deterministically.

### Phase 2 · Weeks 7–10 · Clinical core — your densest stretch

**⚠️ Week 7 is blocked on open decision O1** (who legally controls patient data). The consent model and the `controller` fields depend on it. If O1 is unanswered by end of week 6, escalate — do not guess.

**W7** — clinical schema in full (Prompt 0B): `patients`, `patient_doctors`, `diagnoses`, `prescriptions` (**do not hardcode "Elmiron"** — India brands differ), `diary_entries`, `vision_checks`, `ophthalmic_schedule`, `adverse_events`, `reminders` · consent engine: versioned, clinic-initiated, withdrawable · patient/diagnosis/prescription APIs
**W8** — diary and vision-check APIs · ophthalmic schedule engine, **cadence configurable per market** (US and EU labels differ, do not hardcode one)
**W9** — **adverse-event detection engine with SLA timers computed on insert** · reminder engine, administrative content only, no clinical advice text
**W10** — AE case export (all four validity elements) · PV APIs · consent withdrawal handling

**Two things that will fail a review if you get them wrong:**

- **`adverse_events` rows survive consent withdrawal.** The legal duty to retain and report is not extinguished by a patient withdrawing consent. This needs a test, not a comment.
- **The SLA clock starts at insert, not at triage.** "Receipt" means receipt by anyone in the organisation. A patient logging a symptom at 2am starts a 15-calendar-day clock for a serious event.

> 🚦 **GATE 2 — end of week 10.** End-to-end AE test. A patient logs "trouble reading at night" → flagged within minutes → lands in the PV queue with a running clock → a mock PV officer exports a valid case with all four elements. Separately: consent withdrawal does not delete or hide an AE row. **If this fails, do not proceed to Phase 3.**

### Phase 3 · Weeks 11–12 · Supporting the AI layer

**W11** — PHI tokenisation service (the model sees "Patient 7A3" and clinical facts, never a name, phone or address) · AI call audit trail: who, what data class, which provider, what came back
**W12** — integration work, scope pending decision O4

### Phase 4 · Weeks 13–14

**W13** — marketing APIs · UCPMP-aware input and sample tracking with value caps and an auditable disclosure trail
**W14** — admin APIs · break-glass with mandatory typed reason · audit log viewer API

> 🚦 **GATE 4 — end of week 14.** A marketing user attempts to reach patient-level data by every available path and fails. Suppression threshold verified on a seeded dataset.

### Phase 5 · Week 15 · Hardening — you lead this

Security review · dependency audit · penetration test and remediation · **backup and restore tested, not assumed** · breach-response runbook (India: 72-hour notification to the Data Protection Board; US: 60-day FTC Health Breach Notification Rule) · load test · DPIA data-flow support

> 🚦 **GATE 5.** Clean pen test on all high findings. A restore performed from backup, in front of someone.

### Phase 6 · Week 16 · Pilot

Pilot operations · monitoring and alerting · on-call for one territory, two MRs, two doctors, ten patients, one PV officer.

---

# 4. WHAT YOU OWE OTHERS, AND WHEN

| Contract | To | Due | Consequence of slipping |
|---|---|---|---|
| **I1 — typed API contract** (`packages/core` types + Zod schemas) | Frontend, AI/Data | **End W1** | Frontend cannot start |
| **I2 — mock server** with realistic fixtures | Frontend | **End W2** | Frontend blocked for the whole project |
| **I3 — aggregation contract** — what crosses the commercial/clinical boundary, in what shape, with the suppression rule | AI/Data | **End W3** | AI/Data cannot build the aggregation service. **This is a compliance artifact — get it reviewed.** |

**Never change I1–I3 silently.** Announce breaking changes in writing before they land.

---

# 5. WHAT YOU NEED FROM OTHERS

| From | What | When |
|---|---|---|
| Reviewer | **Decision O1** — data controller model | **Before W7.** Blocks the clinical schema. |
| Reviewer | Decision O4 — integration scope | Before W12 |
| AI/Data | Seed and test data generator | End W2 — your Gate 0 test suite needs realistic fixtures |
| AI/Data | Analytics event schema | W1, so the audit and event capture design is right first time |

---

# 6. RULES

- **No speculative abstraction.** Used once, not configurable.
- **Every migration reversible** and checked in.
- **If a requirement is ambiguous, stop and ask.** Especially the clinical schema — it is incomplete on purpose in Phase 0.
- **Never rely on the frontend to enforce access.**
- **Never let the AI layer write to a clinical field.** AI output goes to a separate summary object the doctor can dismiss.
- **Append a section to `PROJECT-OVERVIEW.md` at the end of every phase.** Never overwrite an earlier section. Describe what exists, not what you intended.

---

# 7. YOUR DEFINITION OF DONE, PER PHASE

A phase is done when the gate passes — verified by the reviewer running the test, not reading your report. Not when the code is written. Not when it works on your machine.

---

*Constraints in §2 and §3 trace to the regulatory research in `PROJECT-CONTEXT.md` Part 3, with sources and confidence levels.*
