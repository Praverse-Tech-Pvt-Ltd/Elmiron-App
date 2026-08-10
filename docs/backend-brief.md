# Backend — Your Brief

**MR App · 12 weeks · you are 34 of the 95 tasks**
Everything you need to start today. Read Parts 1–3, then run the prompt in Part 5.

---

# 1. WHAT YOU OWN

Monorepo · CI/CD · DevOps · Supabase (Mumbai) · auth · RBAC · audit log · consent ledger · all APIs · offline sync · geofence enforcement · audio storage and lifecycle · resumable upload · pipeline orchestration · adverse-event routing · admin · security · app-store release ops.

**You are the first mover.** Frontend and AI/ML both start against your contracts. If you slip in week 1, three people slip.

### Your two hard deadlines

| # | What | Due | If you miss it |
|---|---|---|---|
| **I1** | Typed API contract in `packages/core` | **Friday, week 1** | Frontend cannot start |
| **I2** | Mock server with realistic fixtures | **End of week 2** | Frontend is blocked for the entire project |

The mock server is not busywork. Frontend builds against it for twelve weeks. Keep it running and keep it honest.

---

# 2. THE FIVE THINGS THAT GET FLAGGED IN REVIEW

Learn these now. They are where I will push back, and each one has a specific reason.

### 2.1 Permission denied, not an empty result

An empty list means the filter lives in your application code. Application code gets refactored, and the next endpoint someone adds forgets it. **Row-level security is the enforcement layer.** Assume an attacker holds a valid MR token and is issuing raw SQL.

### 2.2 The consent ledger is immutable

A doctor's consent to be recorded is the legal basis for the entire recording feature. **Withdrawal is a new row, never an update.** Every record stores the version of the consent text that was actually shown. If you can't reconstruct exactly what a doctor agreed to on a given date, the consent is unprovable.

### 2.3 The 90-day audio purge actually runs

Configure the lifecycle rule when you build storage in week 7. **Test it with real data in week 12.** A retention policy that has never fired is not a retention policy — it's a paragraph in a document.

### 2.4 The redaction gate is enforced at the storage layer

AI/ML builds the redaction engine. **You make it impossible to bypass.** If an unredacted transcript can reach durable storage through any path — a retry, a debug endpoint, a dead-letter queue, a log line — the gate is decorative.

This one matters more than it looks. An always-on microphone in a consulting room captures patients talking about their conditions. Redaction is the only thing that makes that lawful.

### 2.5 The adverse-event clock starts at ingest

"Receipt" means the moment the recording lands on your server, not the moment a human reads it. **15 calendar days for a serious event.** Compute the SLA deadline on insert, not on triage.

---

# 3. WHAT NOT TO BUILD

You have twelve weeks and the instinct will be to get ahead. Don't.

- **No clinical schema. No patient tables. At all.** This app has zero patient data. That is a separate app with a separate database. The only clinical touchpoint is a one-way outbound AE endpoint, and that comes in week 9.
- **No speculative abstraction.** Used once, not configurable.
- **No features nobody asked for.** If it's not in `mr-work-split.md` §2 for your week, it doesn't get built.
- **No audio work in weeks 1–2.** It's week 7. Building the storage layer early against an unsettled transcript schema means building it twice.

---

# 4. YOUR FIRST TWO WEEKS

### Week 1 — foundations
Monorepo (Turborepo + pnpm) · CI on every PR · Supabase project in **Mumbai** · Supabase Auth with three roles (`mr`, `field_manager`, `admin`) · `user_profiles` linking auth users to a role and a territory · **publish `packages/core` types by Friday.**

### Week 2 — the boundary
Commercial schema · row-level security on every table · audit log via database triggers, append-only · consent ledger · **mock server** · the adversarial RLS test suite that proves Gate 0.

**Gate 0 is at the end of week 2 and I run it personally.** Details in Part 7.

---

# 5. CLAUDE CODE PROMPTS

Two prompts. Run BE-W1, get it reviewed, then run BE-W2.

Put `mr-app-plan.md` and `mr-work-split.md` in the repo before you start.

## Prompt BE-W1 — Foundations

> Paste everything between the lines.

---

You are building the backend foundation for a pharmaceutical field-force mobile app used by medical representatives in India. This is week 1 of 12. **Build only what is listed. No product features.**

Read `mr-app-plan.md` and `mr-work-split.md` §5 first.

## Context that constrains the design

This app serves exactly three roles: `mr`, `field_manager`, `admin`. It contains **zero patient or clinical data** — that lives in a separate application with a separate database. Do not create clinical tables, patient tables, or anything resembling them, even as placeholders.

Data residency matters: this is an Indian pharmaceutical deployment and all data stays in the Mumbai region.

## Build

### 1. Monorepo
- Turborepo, pnpm workspaces, strict TypeScript, ESLint + Prettier, shared tsconfig base
- Structure:
  - `packages/core` — shared types, Zod schemas, API client
  - `packages/ui-tokens` — design tokens (frontend will populate)
  - `apps/field` — Expo placeholder (frontend will build)
  - `apps/console` — Next.js placeholder (frontend will build)
  - `services/api` — Supabase migrations, edge functions, tests
- The existing planning markdown files move to `/docs`

### 2. CI
GitHub Actions running typecheck, lint, unit tests and (from week 2) the RLS test suite on every PR. It must fail the build, not warn.

### 3. Supabase
- One project, **`ap-south-1` (Mumbai)**
- Environment config that never hardcodes project references
- `.env.example` documenting every variable. No secrets committed.

### 4. Auth and roles
- Supabase Auth, email + password and OTP
- Three roles: `mr`, `field_manager`, `admin`
- `user_profiles` — links an auth user to exactly one role, a territory, a reporting manager, and an active flag
- A Postgres helper function returning the current user's role from their JWT
- A second helper returning the set of territory ids a given user may see (own territory for an MR; own subtree for a manager)

### 5. `packages/core` — this is contract I1, due Friday

Publish TypeScript types and Zod schemas for every entity the app will use, even where the API does not exist yet. Frontend and AI/ML both build against this.

Cover at minimum: `UserProfile`, `Role`, `Territory`, `Doctor`, `BeatPlan`, `Visit`, `CheckIn`, `CheckOut`, `CallReport`, `ConsentRecord`, `ConsentOutcome`, `VoiceNote`, `Recording`, `Transcript`, `Finding`, `Analysis`, `SyncQueueItem`.

`ConsentOutcome` is an enum with exactly three values: `consented`, `declined`, `not_asked`. **All three are valid outcomes of a completed visit.** Declining is not an error state and must not be modelled as one.

Include the API request and response shapes even for endpoints not yet implemented, so the mock server in week 2 has something to conform to.

## Rules

- No product features, no business logic beyond what is listed
- No speculative abstraction — if it is used once, do not make it configurable
- Every migration reversible and checked in
- If a requirement is ambiguous, stop and ask rather than guessing

## Required at the end

Create `PROJECT-OVERVIEW.md` at the repository root. **Every later prompt appends a new section — never overwrite an earlier one.** Structure:

```
# MR App — Project Overview

## Current state
## Architecture decisions
(each decision, why, and what it rules out)
## Phase log
### BE-W1 — Foundations (date)
- What was built
- Files and directories created
- Types published in packages/core
- Anything deliberately left out and why
- Open questions for the reviewer
## How to run
## Known gaps
```

Fill in the BE-W1 section completely. Describe what exists, not what you intended.

---

## Prompt BE-W2 — The boundary

> Run only after BE-W1 is reviewed.

---

Read `PROJECT-OVERVIEW.md` first and follow the conventions already established. This is week 2 of 12.

## The thing that matters most this week

**A medical representative must never be able to read another MR's data, and a manager must never read outside their own team.** Enforce this in Postgres row-level security, not in application code and not in the UI.

**Permission denied, not an empty result.** An empty list means the filter lives in application code, which changes. Assume an attacker holds a valid MR session token and is issuing raw SQL, calling functions, querying views, and joining from tables they legitimately can read.

## Build

### 1. Commercial schema
`organisations` · `territories` (hierarchical, self-referencing) · `doctors` (professional data only: name, registration number, specialty, qualification, clinic addresses, territory, assigned MR) · `beat_plans` · `visits` · `check_ins` (with coordinates and timestamps) · `call_reports` · `samples_and_inputs`.

**No patient data in any of these.** `doctors` holds professional information only — no prescribing volumes, no patient counts.

### 2. Consent ledger — read this carefully

`consent_records`: visit id, doctor id, capturing MR, **outcome** (`consented` | `declined` | `not_asked`), timestamp, **the version identifier of the consent text that was displayed**, and the language it was displayed in.

`consent_text_versions`: version id, language, full text, hash, effective date.

Rules that must hold:
- **Records are immutable.** No UPDATE policy for any role.
- **Withdrawal is a new row**, referencing the original, never an edit.
- A consent record cannot be created without a valid `consent_text_version` reference.
- All three outcomes are valid completions. **`declined` is not an error and carries no penalty flag anywhere in the schema.**

Write a test proving a consent record cannot be updated by any role including `admin` and `service_role`.

### 3. Row-level security

RLS on **every** table. No table readable without an explicit policy.

- `mr` — reads doctors in their own territory; reads and writes only their own visits, check-ins, call reports and consent records; reads only their own analyses
- `field_manager` — reads their own territory subtree including the territories of MRs reporting to them; approves but does not author call reports; reads their team's analyses
- `admin` — full access, **but every read of an analysis or a consent record writes an audit row before returning data**

An MR's performance analysis is sensitive employment data. Treat it with the same care as anything else in this schema.

### 4. Audit log
- `audit_log` — actor, role, action, table, row id, timestamp, request id, reason (nullable except admin access to analyses), IP
- Written by **database triggers**, not application code, so it cannot be bypassed
- **Append-only** — no UPDATE or DELETE policy for anyone, including `admin` and `service_role`
- Every read of an analysis or consent record is logged, not just writes

### 5. Mock server — contract I2, due end of week 2

A running mock server returning realistic fixtures for **every** endpoint declared in `packages/core`. Not just happy-path data:
- Populated lists, empty lists, and single-item lists
- Error responses and permission-denied responses
- Pagination
- An offline-sync scenario with queued items

Frontend builds against this for twelve weeks. A mock that only returns happy-path data is not done.

### 6. The Gate 0 test suite

Write `services/api/tests/rls.spec.ts`, running in CI. It must:

1. Seed real users of every role plus territories, doctors, visits, consent records and analyses
2. As an `mr`, attempt to read **another MR's** visits, check-ins, call reports and analyses — via the REST endpoint, a direct SQL query with their token, a join from a table they can read, a Postgres function, and a view
3. As a `field_manager`, attempt the same against an MR outside their team
4. **Assert every one of those attempts returns permission denied — not an empty result set**
5. Assert an MR cannot read doctors outside their territory
6. Assert `consent_records` rejects UPDATE from every role including `admin` and `service_role`
7. Assert `audit_log` rejects UPDATE and DELETE from every role
8. Assert admin access to an analysis writes the audit row **before** the data is returned — check the timestamps, do not assume

**If any test passes when it should fail, stop and report it. Do not work around it in application code.**

## Rules

Same as BE-W1. No features. No speculative abstraction. Reversible migrations. Ask rather than guess.

## Required at the end

**Append a `### BE-W2 — Boundary` section to `PROJECT-OVERVIEW.md`.** Do not overwrite BE-W1. List every RLS policy created and what each test proves.

---

# 6. HOW TO WORK THE LOOP

1. Run the prompt.
2. **Self-check** — run `VP-0` and `VP-BE` from `verification-prompts.md`. Both are adversarial by design: they ask Claude to prove the work is *not* done. Fix what they find.
3. Mark the task **ready for review** in the tracker. **Do not mark it Done yourself.**
4. I run `VP-R` in a fresh session with no prior context and set Done or send it back.

Two rules that make this work:

- **Never verify in the same session that built the thing.** That session has already decided the work is good.
- **Evidence, not assertion.** Every claim needs the command and its actual output pasted. "The tests pass" without the output is not evidence.

---

# 7. YOUR GATE — END OF WEEK 2

I run this personally. I will not accept a report that it passed.

I will seed users myself, then as an `mr` and a `field_manager` attempt to reach data outside their scope through five different paths. **All must return permission denied.** I will try to update a consent record as `admin`. I will try to delete an audit row as `service_role`. I will check whether the admin audit entry is written before or after the data returns.

If any of those succeeds, Gate 0 fails and week 3 does not start.

**This is not distrust.** It is the only cheap moment to find a broken permission model. In week 9 everything else is built on top of it.

---

# 8. START HERE

**Today:** run prompt **BE-W1**.
**Friday:** `packages/core` types published. Tell Frontend and AI/ML.
**Next Monday:** run **BE-W2** after review.
**End of week 2:** Gate 0.

One thing to raise with the reviewer this week: the **PV and privacy sign-off** on the adverse-event position blocks your week 7 work. It needs named people, not a team. Better chased now than in week six.
