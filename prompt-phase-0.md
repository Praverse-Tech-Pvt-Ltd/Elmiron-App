# Claude Code Prompts — Phase 0: Foundations

Phase 0 is split in two so the team is not blocked by the open data-controller decision (**O1**).

- **Prompt 0A — runnable now.** Monorepo, auth, RBAC, audit log, commercial schema, and the boundary enforcement mechanism itself.
- **Prompt 0B — blocked on O1.** The clinical schema tables that hang off the controller decision.

Run 0A first. Review it. Only then run 0B.

---

# PROMPT 0A — Platform foundations and the permission boundary

> Paste everything between the lines into Claude Code.

---

You are building the foundation for a pharmaceutical field-force and clinical platform. This is Phase 0. **Do not build any product features.** Build the skeleton that every later phase depends on, and prove the security boundary works.

## Context you must understand before writing code

This platform has two data domains that must never mix:

- **Commercial domain** — medical representatives (MRs), field managers, marketing. They work with doctor professional data, territories, call reports, content.
- **Clinical domain** — doctors, patients, pharmacovigilance officers. They work with patient identity, diagnoses, prescriptions, symptom diaries, adverse events.

**The hard rule: a commercial user must never be able to read any clinical data through any code path.** This is a legal requirement, not a preference. It must be enforced by database row-level security, not by hiding UI elements or by application-layer `if` statements. Assume an attacker has a valid MR session token and is issuing raw queries against the API.

## Stack

- Monorepo managed by Turborepo, TypeScript throughout, pnpm workspaces
- `packages/core` — shared types, Zod validation schemas, API client, business rules
- `packages/ui-tokens` — design tokens shared by both frontends
- `apps/field` — Expo / React Native (MR app and Patient app live here later)
- `apps/console` — Next.js App Router (Manager, Doctor, Marketing, Admin, PV consoles live here later)
- `services/api` — Supabase: Postgres, Auth, row-level security, Edge Functions
- Two separate Supabase projects: one in the Mumbai region, one in a US region. Same migrations, **separate data**. Set up the config to target either by environment variable. Do not build a single multi-region database.

## What to build

### 1. Monorepo and tooling
- Turborepo with the workspace layout above, both apps building and running
- Strict TypeScript, ESLint, Prettier, a shared `tsconfig` base
- GitHub Actions: typecheck, lint, unit tests, and the RLS test suite (below) on every PR
- `.env.example` documenting every variable. No secrets committed. Environment config resolves the correct regional project.

### 2. Auth and roles
Nine roles: `mr`, `field_manager`, `marketing`, `urologist`, `gynaecologist`, `patient`, `pv_officer`, `admin`, `system`.

- Supabase Auth with email + password and OTP
- A `user_profiles` table linking auth users to exactly one role and, where relevant, a territory or organisation
- A Postgres helper function returning the current user's role from their JWT
- Route protection in both apps driven by role
- Sessions expire; refresh handled

### 3. Schema — commercial domain
Build these now:

- `organisations`
- `territories` — hierarchical, self-referencing parent
- `user_profiles` — role, territory, manager relationship, active flag
- `doctors` — **professional data only**: name, registration number, specialty (`urologist` | `gynaecologist` | `other`), qualification, clinic addresses, territory, assigned MR. **This table holds no patient data and no prescribing volumes.**
- `doctor_visits` — MR call reports: doctor, MR, timestamps, check-in and check-out coordinates, notes, products discussed
- `beat_plans` — planned MR routes
- `content_items` — approved marketing content with version and approval state

### 4. Schema — clinical domain skeleton only
Create the schema namespace and **one** table so the boundary can be proven:

- Schema `clinical`, fully separated from the commercial schema
- `clinical.patients` — minimal for now: id, created_by (a doctor's user id), created_at, and a single placeholder encrypted field. **The full clinical model comes in Prompt 0B once the controller decision is made. Do not guess at it.**

### 5. Row-level security — this is the core deliverable

Enable RLS on **every** table. No table may be readable without a policy. Write policies so that:

- `mr` reads only doctors in their own territory; writes only their own visits and beat plans
- `field_manager` reads their own territory subtree, including the territories of MRs reporting to them; approves but does not author call reports
- `marketing` reads `content_items` and territory-level aggregates only; no individual call reports
- `urologist` / `gynaecologist` read only `clinical.patients` rows where they are the treating doctor
- `patient` reads only their own row
- `pv_officer` reads only rows linked to an open adverse-event case
- `admin` reads clinical data **only through a break-glass function** that requires a written reason and writes an audit entry before returning anything. No direct admin `SELECT` policy on clinical tables.
- **No policy grants `mr`, `field_manager` or `marketing` any access to any table in the `clinical` schema.** Revoke schema-level `USAGE` from those roles as a second layer.

### 6. Audit log
- `audit_log` — actor, role, action, table, row id, timestamp, request id, reason (nullable except break-glass), IP
- Written by database triggers, not by application code, so it cannot be bypassed
- Append-only: no `UPDATE` or `DELETE` policy for anyone, including admin
- Every read of clinical data is logged, not only writes
- Retention configurable, minimum one year

### 7. Consent data model
- `consents` — subject, consent type, version, granted/withdrawn timestamps, the full text hash of what was agreed, capture method, capturing user
- Consent records are **immutable**; withdrawal is a new row, never an update
- A helper function answering "does an active consent of type X exist for subject Y right now"

## The gate — you must prove this before you are done

Write an automated adversarial test suite, `services/api/tests/rls.spec.ts`, that runs in CI and:

1. Seeds real users of every role, plus doctors, territories, and one clinical patient row
2. For each of `mr`, `field_manager`, `marketing`, attempts to read `clinical.patients` via:
   - the REST endpoint
   - a direct SQL query using that user's token
   - a join from a commercial table
   - a Postgres function call
   - a view
3. **Asserts every one of those attempts fails.** Not "returns empty" — permission denied.
4. Asserts an MR cannot read another territory's doctors
5. Asserts a doctor cannot read a patient they do not treat
6. Asserts a patient cannot read another patient
7. Asserts admin break-glass returns data **only** when a reason is supplied, and that the audit row is written **before** the data is returned
8. Asserts `audit_log` rejects `UPDATE` and `DELETE` from every role

**If any of these tests pass when they should fail, stop and report it. Do not work around it in application code.**

## Rules for this task

- No product features. No dashboards, no forms, no business logic beyond what is listed.
- No speculative abstractions. If something is used once, do not make it configurable.
- If a requirement is ambiguous, stop and ask rather than guessing. Especially the clinical schema — it is deliberately incomplete.
- Match conventions consistently across the monorepo.
- Every migration is reversible and checked in.

## Final step — required

Create `PROJECT-OVERVIEW.md` at the repository root. This is a **living document that every later prompt in this project will append to** — create it now with this structure:

```
# PPS / Elmiron Platform — Project Overview

## Current state
(one paragraph: what exists and what does not)

## Architecture decisions
(each decision, why, and what it rules out)

## Phase log
### Phase 0A — Foundations (date)
- What was built
- Files and directories created
- Schema tables and RLS policies added
- Tests written and what they prove
- Anything deliberately left out and why
- Open questions for the reviewer

## How to run
## Known gaps and risks
```

Fill in the Phase 0A section fully. Later prompts will append new phase sections — never overwrite earlier ones.

---

# PROMPT 0B — Clinical schema *(do not run until decision O1 is made)*

> This prompt is written against the **split-controller model**. If the client chooses pharma-as-controller instead, the consent model and the `controller` fields change and this prompt must be rewritten. Ask me before running it.

Extend the clinical schema built in Phase 0A. Read `PROJECT-OVERVIEW.md` first and follow the conventions already established.

Add, all inside the `clinical` schema with RLS enabled and audit triggers attached:

- `patients` — expand: identifiers, demographics, enrolling doctor, enrolment date, controller reference, status
- `patient_doctors` — the many-to-many history of which doctors a patient has seen, with dates
- `diagnoses` — patient, doctor, diagnosis, date, notes
- `prescriptions` — patient, prescribing doctor, drug, **brand** (India brands differ from Elmiron — do not hardcode "Elmiron"), form, strength, dose, frequency, start date, end date, status
- `diary_entries` — patient, week-of, structured symptom fields, optional free text, submitted timestamp
- `vision_checks` — patient, month-of, structured fields only, submitted timestamp
- `ophthalmic_schedule` — patient, market, next due date, last completed, status. **The cadence differs by market — make it configurable per market, not hardcoded.**
- `adverse_events` — source entry reference, detected timestamp, seriousness, status, assigned PV officer, **SLA due timestamp computed on insert**, export state
- `reminders` — subject, type, due, sent, acknowledged. **Administrative content only — no clinical advice text.**

Constraints that must hold:

- Every table has RLS. Commercial roles have no access. Verify by extending the Phase 0A test suite, do not assume.
- `adverse_events` rows **survive consent withdrawal**. The legal duty to retain and report an adverse event is not extinguished by a patient withdrawing consent. Write a test that proves withdrawal does not delete or hide an AE row.
- `diary_entries` free-text is the adverse-event trigger surface. Add the column and an index now; detection logic comes in Phase 2.
- No table stores an AI-generated summary yet. That arrives in Phase 3, in a separate table, never in a clinical field.

Extend the adversarial test suite to cover every new table.

Then **append a `### Phase 0B` section to `PROJECT-OVERVIEW.md`** using the same structure. Do not overwrite Phase 0A.

---

# Reviewer checklist — what I will check before approving Phase 0

- [ ] Does an MR token actually get permission-denied on clinical tables, via every path in the test suite?
- [ ] Are RLS policies the enforcement mechanism, or is there application-layer filtering doing the real work?
- [ ] Is `audit_log` genuinely append-only, including for admin?
- [ ] Does break-glass write the audit row **before** returning data, or after?
- [ ] Are the two regional deployments actually separate, or is it one database with a region column?
- [ ] Is the clinical schema incomplete in the way I asked, or did it guess ahead?
- [ ] Is `PROJECT-OVERVIEW.md` accurate, or does it describe intentions rather than what exists?
- [ ] Any speculative abstraction or unrequested feature? It gets removed.
