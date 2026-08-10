# Backend Prompts — v2

**Reissued 10 August 2026.** BE-W2 below **supersedes** the version in `backend-brief.md` §5. Four things landed after that was written; all are folded in.

| # | Change | Why |
|---|---|---|
| 1 | **JWT test helper** — connect as `authenticated`, not `postgres` | Superuser bypasses RLS. The old helper would have made Gate 0 pass vacuously. |
| 2 | **`FORCE ROW LEVEL SECURITY`** on every table | Table owners bypass RLS too. Second bypass vector. |
| 3 | **Claims-fidelity test** | Hand-built claims test your assumption about the auth hook, not the hook. |
| 4 | **Extensible role model** | `patient`, `doctor`, `pv_officer` arrive with the second app. Adding a role must be additive, not a rewrite. |

Plus the corrected Gate 0 criterion from `docs/amendment-gate0-criterion.md`.

---

# PROMPT BE-W2 — The boundary

> Paste everything between the lines.

---

Read `PROJECT-OVERVIEW.md` and `docs/amendment-gate0-criterion.md` first. Follow the conventions established in BE-W1. This is week 2 of 12.

## The thing that matters most this week

**A medical representative must never read another MR's data, and a manager must never read outside their own team.** Enforce this in Postgres row-level security — not in application code, not in the UI.

Read the amendment before writing any test. The original criterion ("permission denied, not an empty result") was wrong and has been replaced. The property you are proving is **non-disclosure and non-mutation**, tested **directly against the database with the user's own JWT and no application code in the path**. `403`, `200 []` and `0 rows affected` are all acceptable outcomes. An out-of-scope row being returned or changed is not.

## Read this before writing the test helper — it is the most likely way this week fails

`inRolledBackTransaction` currently connects as `postgres`. **`postgres` is a superuser and has `BYPASSRLS`.** Every RLS assertion written against it would pass while proving nothing — the same class of failure as the BE-W1 test harness, one layer deeper.

**There are two bypass vectors, not one:**

1. **Superuser** — `BYPASSRLS`, policies never evaluated
2. **Table owner** — even a non-superuser owner bypasses RLS by default. In Supabase, `public` tables are typically owned by `postgres`.

Close both:

- **Add `alter table public.<t> force row level security;` to every table.** This subjects even the owner to policies. Trivial now, invasive later.
- **Build a proper test helper** before writing a single scope assertion.

### The helper — two paths, and you need both

**Fast path, for breadth.** Per transaction:
```sql
set local role authenticated;
set local "request.jwt.claims" = '{...}';
```
RLS evaluates against `current_user`, so `set role` genuinely subjects you to policies. Fast enough for hundreds of cases.

**Faithful path, for a smaller set.** Mint a JWT signed with the local secret and send it to PostgREST at `127.0.0.1:54321` as a Bearer token.

**Why both:** the fast path tests *your assumption* about what claims PostgREST sets. If that assumption is wrong you get a thorough suite proving a fiction. The PostgREST path over a handful of cases proves the simulation is faithful.

### The claims-fidelity test

`current_app_role()` reads from the JWT; your auth hook writes it. **Claims constructed by hand test the shape you believe the hook produces, not the shape it produces.**

Write one test that signs in a real seeded user through local GoTrue, dumps the actual claims, and asserts they match the shape every other test uses. When the hook changes in week 6, that one test fails loudly instead of the whole suite drifting into fiction.

## Build

### 1. Commercial schema

`organisations` · `territories` (extend the existing) · `doctors` · `beat_plans` · `visits` · `check_ins` · `call_reports` · `samples_and_inputs`

`doctors` holds **professional data only** — name, registration number, specialty, qualification, clinic addresses, territory, assigned MR. No prescribing volumes, no patient counts, **no patient data of any kind anywhere in this schema.**

`FORCE ROW LEVEL SECURITY` on every one.

### 2. The role model — build it to grow

Today: `mr`, `field_manager`, `admin`.

A second app is coming — `apps/patient` — bringing `patient`, `doctor` and `pv_officer`. **Adding a role must be an additive migration, not a rewrite of every policy.**

Concretely: express policies in terms of **capability predicates** — `can_read_own_visits()`, `can_read_team()`, `can_break_glass()` — rather than long `role in ('mr','field_manager')` lists that need editing every time a role appears. A new role then grants capabilities; it does not touch existing policies.

Don't over-engineer this into a permissions framework. It's a naming and indirection discipline, not a subsystem.

### 3. Consent ledger — read this section twice

`consent_records`: visit id, doctor id, capturing MR, **outcome** (`consented` | `declined` | `not_asked`), timestamp, **the version identifier of the consent text displayed**, and the language it was displayed in.

`consent_text_versions`: version id, language, full text, content hash, effective date.

Rules, each with a test:

- **Immutable.** No UPDATE policy for any role, including `admin` and `service_role`.
- **Withdrawal is a new row** referencing the original, never an edit.
- Cannot be created without a valid `consent_text_versions` reference.
- **All three outcomes are valid completions.** `declined` is not an error, carries no penalty flag, and must not be modelled as one — no nullable-because-it-failed column, no status enum grouping it with failures.

The legal basis for the entire recording feature is being able to prove, later, exactly what a specific doctor agreed to on a specific date. If you cannot reconstruct that from this table, the feature has no basis.

### 4. Row-level security

RLS **and `FORCE`** on every table. No table readable without an explicit policy.

- `mr` — doctors in own territory; own visits, check-ins, call reports, consent records
- `field_manager` — own territory subtree including reporting MRs; approves but does not author call reports
- `admin` — full access, **but every read of a consent record writes an audit row before returning data**

### 5. Audit log

`audit_log` — actor, role, action, table, row id, timestamp, request id, reason (nullable except admin reads of consent records), IP.

- Written by **database triggers**, not application code
- **Append-only** — no UPDATE or DELETE policy for anyone, including `admin` and `service_role`
- Reads of consent records logged, not only writes

### 6. Mock server — contract I2, due end of week 2

Running mock server, realistic fixtures for **every** endpoint in `packages/core`. Not just happy path: populated lists, empty lists, single-item lists, error responses, permission-denied responses, pagination, and an offline-sync scenario with queued items.

Frontend builds against this for twelve weeks. A mock that only returns good data is not done.

### 7. Carried from the BE-W1 review

- **Write-time trigger rejecting territory cycles.** The `CYCLE` clause converts the hang into a correct answer; the trigger stops bad data existing. Both.
- **`reporting_manager_id` constraint** — referenced user must be `field_manager` or `admin`; management chain must not cycle.

### 8. Keep it integration-ready

A second app consumes `packages/core` on a different release cadence. Cheap now, expensive later:

- **Nothing MR-specific in `packages/core`.** Field-app-only types live in `apps/field`.
- **Version the API contract** from the start.
- **No single-app assumptions hardcoded** — JWT audience, redirect URLs, deep-link scheme all config.

### 9. Gate 0 suite — `services/api/tests/rls.spec.ts`

Runs in CI. Must:

1. Seed users of every role, plus territories, doctors, visits, consent records
2. **Query with each user's own JWT via the helper above — never as `postgres`**
3. As an `mr`, attempt to read another MR's visits, check-ins, call reports and consent records — via REST, direct SQL, a join from a table they legitimately can read, a Postgres function, and a view
4. As a `field_manager`, attempt the same against an MR outside their team
5. **Assert no out-of-scope row is returned and none is changed.** Assert the specific outcome per operation type, per the amendment.
6. Assert no-grant and schema-level cases return **permission denied**, not empty
7. Assert `consent_records` rejects UPDATE from every role including `admin` and `service_role`
8. Assert `audit_log` rejects UPDATE and DELETE from every role
9. Assert admin reads of a consent record write the audit row **before** returning data — compare timestamps
10. **Assert `FORCE ROW LEVEL SECURITY` is enabled on every table.** Query `pg_class.relforcerowsecurity` — do not assume the migration ran.
11. **The claims-fidelity test** (above)
12. **Search the codebase for application-layer scope filtering and assert there is none.** A route hand-filtering by user id "for safety" is a finding, not a mitigation.

If any test passes when it should fail, stop and report it. Do not work around it in application code.

## Rules

No features beyond what is listed. No speculative abstraction. Every migration reversible and checked in. If a requirement is ambiguous, stop and ask.

## Required at the end

**Append a `### BE-W2 — Boundary` section to `PROJECT-OVERVIEW.md`.** Do not overwrite earlier sections. List every RLS policy created and state what each test actually proves.

---
---

# PROMPT BE-W3 — Commercial APIs

> Run only after Gate 0 passes. Do not start if it failed.

---

Read `PROJECT-OVERVIEW.md` first. This is week 3 of 12. Gate 0 has passed; the boundary is proven.

## Build

### 1. Doctor, territory and beat-plan APIs
CRUD within RLS scope. Search and filter on doctors — an MR opening the app in a waiting room needs to find a doctor in under three seconds, so index for it.

### 2. Geofence check-in / check-out

- Check-in records doctor, coordinates, timestamp, accuracy
- Check-out records the same plus duration
- **Work-hours enforcement**: capture is rejected outside the MR's defined shift window. Enforce server-side — the client will be offline and its clock cannot be trusted.
- **Store the shift window as configuration**, not a hardcoded constant. It varies by territory.

### 3. Mileage computation
Distance between consecutive check-ins, per day, per MR. This feeds the MR's expense claim — it is one of the two features that makes the app worth having *to the person carrying the phone*, so it must be correct and visible.

Compute server-side from check-in coordinates. Do not trust a client-reported distance.

### 4. Contract I3 dependency
AI/ML publishes the transcript schema at the end of week 2. Review it and confirm the storage layer can accommodate it — you build against it in week 8. **Raise problems now, not in week 8.**

## Things that will bite

- **The client is offline-first and its clock is unreliable.** Every timestamp needs a server-side received-at alongside the client-reported occurred-at. You will need both when reconciling a day that synced six hours late.
- **Check-ins arrive out of order.** Design for it now.
- **Duplicate submissions** on retry. Idempotency keys from the start, not after the first duplicate expense claim.

## Rules

Same as always. No features beyond the list. No speculative abstraction. Reversible migrations. Ask rather than guess.

## Required at the end

**Append a `### BE-W3` section to `PROJECT-OVERVIEW.md`.**

---

# WHAT CHANGED FOR YOU, SUMMARISED

Nothing in your week 1 or 2 scope was removed. Four things were added, and one risk was closed elsewhere:

- ✅ **The Apple App Store risk is gone** — the MR app is Android-only permanently. No release-ops work for iOS, no Apple Developer account, no week-5 probe. That was risk #2 on the project.
- ➕ JWT test helper + `FORCE ROW LEVEL SECURITY` + claims-fidelity test
- ➕ Extensible role model, because a second app brings three more roles
- ➕ Four integration-readiness conventions in §8

*Constraints trace to `mr-app-plan.md` §0 and `docs/amendment-gate0-criterion.md`.*
