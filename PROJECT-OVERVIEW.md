# MR App — Project Overview

Pharmaceutical field-force app for medical representatives in India. MR app only —
the patient app is a separate project with a separate database.

**This file is append-only.** Every later prompt adds a new `###` section under
"Phase log". Nothing already written here gets overwritten.

---

## Current state

_This is the one section that describes now rather than history. The Phase log below
is append-only._

Week 7 of 12. Boundary proven (Gate 0 passed), field capture server-enforced, the
offline queue conflict-free by construction, the manager surface exception-first,
**audio that consent does not cover is structurally impossible to hold**, and the
90-day retention promise is now **enforced by something rather than promised by a
script somebody has to remember to run**.
The Gate 1 server half is built and green; the client half waits on the field app.

What exists and runs:

- A Turborepo + pnpm monorepo, **seven** workspaces, strict TypeScript, ESLint on
  `strictTypeChecked`, Prettier.
- GitHub Actions CI, two jobs, both failing the build rather than warning. The
  database job applies every migration from empty, runs the Gate 0 suite, then
  **rolls every migration back and asserts the schema is empty**. Plus two scheduled
  workflows: the retention worker, and a watchdog that fails loudly when it stops.
- **Seventeen migrations**, ending with resumable upload, post-restore reconciliation
  and adverse-event ingest.
- **34 tables**, RLS enabled and forced on every one. **41 policies**, 6 views, all
  `security_invoker`, plus three policies on `storage.objects`.
- A private `audio` bucket whose write policy requires a live upload grant — and no
  grant is issued for a visit without standing consent, for a visit quarantined by a
  restore, or at all once the retention worker has demonstrably stopped.
- **Resumable, chunked upload** that survives process death and network change, with
  consent re-read on every chunk, and partial objects destroyed by the same worker
  through the same machinery as everything else.
- A 90-day retention worker that destroys the **object as well as the row**, with a
  test that proves it over HTTP — scheduled daily, watched by a separate job, and
  backstopped by a database-side refusal to accept new audio when it stalls.
- **Post-restore reconciliation** in both directions, because a restore rewinds the
  database and not the object store. See `docs/restore-runbook.md`.
- **Adverse-event ingest**: append-only, a server-stamped fifteen-day statutory clock,
  and no column a model could write a judgement into.
- **Append-only wherever it can be**: consent ledger, audit log, call reports and
  their approvals, beat plans, check-ins and check-outs. Conflicts are eliminated
  rather than merged.
- **Server-enforced capture**: work hours per territory in the territory's own
  timezone, geofence computed from stored clinic coordinates, `received_at` stamped
  by trigger, mileage summed from stored coordinates ordered by `occurred_at`.
- The **consent ledger** and the **audit log**, both append-only against every role
  including `service_role` and the table owner — enforced by statement-level
  triggers, not by RLS, because BYPASSRLS roles never see a policy.
- `packages/core` — contract **I1** — types, Zod schemas and a typed API client.
- `services/mock` — contract **I2** — a running mock server covering every endpoint
  declared in `packages/core`, with populated / single / empty lists, real cursor
  pagination, every error code, and a full offline-sync queue.
- **373 passing tests**: 21 in `packages/core`, 40 mock-conformance tests in
  `services/mock`, 312 database tests in `services/api` — foundations, Gate 0
  adversarial, field operations, offline sync, manager surface, Gate 1,
  consent/audio/retention, resumable upload, retention operations and adverse events.
- **`docs/gotchas.md`** carries the durable machine and tooling failures. There is no
  handoff document, on purpose.
- `packages/core` is namespaced into `@elmiron/core/shared` and `@elmiron/core/field`;
  the root import still re-exports everything, so no consumer changes.

What does not exist yet: HTTP endpoints beyond what PostgREST generates from the
schema. The transcription and redaction pipeline and the analysis engine are weeks
8–10, and **contract I3 — the transcript schema they depend on — is five weeks late
and now carries a CI deadline of 30 September 2026.**

The adverse-event path is built **mechanically only**. Who receives one, through what
channel, and what happens as the deadline approaches all wait on the PV and privacy
sign-off outstanding since week 1 — see BE-W7 below for exactly what was left out.

---

## Architecture decisions

**Contract-first, schema-derived types.** `packages/core` defines Zod schemas and
derives the TypeScript types from them with `z.infer`. One source of truth.
_Rules out:_ hand-written interfaces drifting from runtime validation, and any
"the types say X but the server sends Y" class of bug.

**API is camelCase; Postgres is snake_case.** Mapping happens at the API edge.
_Rules out:_ snake_case leaking into React components, and the alternative of
naming Postgres columns in camelCase, which needs quoting everywhere.

**Role lives in the JWT, put there by a custom access token hook.**
`public.custom_access_token_hook` reads `user_profiles` at token-issue time and adds
`app_role`, `app_territory_id` and `app_is_active` claims.
_Rules out:_ a `user_profiles` lookup on every policy evaluation.
_Cost, and it is a real one:_ a role or territory change only takes effect on the
next token refresh (1 hour by default). Deactivation therefore cannot rely on the
claim alone — `visible_territory_ids` re-reads `is_active` from the table for
exactly this reason.

**`visible_territory_ids(uuid)` is SECURITY DEFINER and not granted to
`authenticated`.** It takes an arbitrary user id, so granting it would let any MR
enumerate a colleague's scope. Client-reachable code uses the no-argument wrapper
`current_user_visible_territory_ids()`.
_Rules out:_ scope enumeration through a helper that looks harmless.

**RLS is on from the first table, not retrofitted.** Both tables have RLS enabled
and neither has an INSERT, UPDATE or DELETE policy, so `authenticated` cannot write
to either. Provisioning runs through `service_role` until the admin APIs land in
week 11.

**`FORCE ROW LEVEL SECURITY` is deliberately not used on these two tables.** The
SECURITY DEFINER helpers run as the table owner; FORCE would subject them to the
same policies and they would return nothing. The append-only tables in BE-W2
(`audit_log`, `consent_records`) have the opposite requirement and are handled
separately there.

**Table privileges are revoked before they are granted.** Supabase's default
privileges hand `authenticated` and `anon` a **TRUNCATE** grant on new public
tables, and TRUNCATE ignores row-level security entirely. This was found by a test,
not by reading documentation. Every table from here on gets an explicit
`revoke all ... from anon, authenticated` before its grants.
_Rules out:_ an RLS policy set that looks airtight and is bypassable with one
statement.

**Email is not duplicated into `user_profiles`.** It lives on `auth.users` and is
read from the session. _Rules out:_ two copies to keep in sync.

**`declined` is a schema-level equal.** `ConsentOutcome` has exactly three values,
all three are valid completions of a visit, and there is no penalty, flag or score
field anywhere near a consent record. A test asserts the absence of those fields by
name.

**No composite score anywhere in `Analysis`.** A test asserts `score`, `rating`,
`rank`, `percentile` and `grade` are absent. `Finding.citations` is `.min(1)` —
an uncited finding fails validation rather than rendering.

**Rollback SQL lives in `services/api/rollbacks/`, not inside `supabase/migrations/`.**
The CLI has no down-migration step; keeping the files next to the migrations risks
the CLI applying them. They are applied by hand with psql.

### Added in BE-W2

**Immutability is a trigger, not a policy.** `postgres` and `service_role` both hold
the **BYPASSRLS** attribute. Measured: with `FORCE ROW LEVEL SECURITY` on, both still
read every row. RLS is never evaluated for them, so "no UPDATE policy" stops neither.
Statement-level `BEFORE UPDATE OR DELETE OR TRUNCATE` triggers do, and they are what
makes `consent_records` and `audit_log` append-only.
_Rules out:_ an append-only guarantee that any holder of the service key can walk
through.

**Statement-level, not row-level.** A row-level trigger never fires for an UPDATE
that matches no rows, so an out-of-scope UPDATE would report "0 rows affected" and
read as success. Statement-level fires before the scan and errors every time. There
is a test for exactly this.

**`FORCE ROW LEVEL SECURITY` on every table anyway.** BE-W1 omitted it on the
reasoning that it would break the SECURITY DEFINER helpers. That reasoning was
wrong — BYPASSRLS wins over FORCE, so the helpers are unaffected. FORCE is now on
everywhere. It buys nothing against `postgres` or `service_role`; it buys correctness
if ownership ever moves to a role without BYPASSRLS. Nothing relies on it.

**Authorization reads the role from `user_profiles`, never from the JWT claim.**
`public.effective_role()` and `public.is_admin()` are what policies call.
_Closes BE-W1 open question 3._ The claim refreshes at most hourly, so a demoted or
deactivated user would otherwise keep their powers for up to an hour.
`current_app_role()` survives as the BE-W1 deliverable and is fine for display.
Tested: flipping `is_active` collapses scope immediately, with a still-valid token.

**Reads of `analyses` and `consent_records` go through logged RPCs; there is no
SELECT grant on either table.** Postgres has no SELECT trigger, and the brief
requires every read of both to be audited — not only admin reads. So direct access is
a genuine permission denied (amendment criterion 3), and `read_analysis`,
`list_analyses`, `read_consent_record`, `list_consent_records` write the audit row
first and return data second.
_Rules out:_ "every read is logged" being true only for the paths someone remembered.
_Cost:_ those two tables lose PostgREST's generated endpoints. The amendment rejected
RPC-only reads across the board; this is the narrow case where the audit rule forces
it anyway.

**Every view is `security_invoker`.** A view runs as its owner by default, and every
view here is owned by a BYPASSRLS role — `visit_summary` without it would hand every
MR the company's entire visit history. A structural test asserts the property for
every view in `public`, so the next one cannot omit it.

**Approval is an RPC, because RLS cannot express column-level intent.** RLS says which
rows, never which columns. `public.approve_call_report` is the only path to an
approved status; field managers hold no UPDATE policy on `call_reports` at all, and
the function rejects the author even when the author is a manager.

**One primitive for scope: `public.visible_user_ids()`.** Every own-vs-team policy
calls it. _Rules out:_ twenty hand-written subtree expressions, one of which is
subtly different.

**Fixtures are committed and never torn down.** PostgREST and GoTrue run over HTTP on
their own connections and cannot see uncommitted rows, so a suite that only seeds
in-transaction can never exercise the faithful path. Teardown is impossible anyway —
`consent_records` is append-only. Each run mints fresh UUIDs and emails instead.

### Standing principle — what RLS is for, and what it is not

**RLS decides WHICH ROWS a caller may write. It never decides WHAT THE VALUES MUST
BE.**

Any write with a validity rule beyond "is this row mine" — work hours, a geofence, a
computed duration, the consent text version that was displayed, a legal state
transition — cannot be enforced by a policy. That write goes behind an RPC, and the
direct table path is **withdrawn, not merely unused**.

Leaving the direct path in place while documenting that nobody should use it is not
a control. It is a comment.

Applied so far:

| Write                | Rule a policy cannot express                                                                                                       | Enforced by                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| check-in / check-out | inside the territory's shift window; geofence computed from stored clinic coordinates; duration derived from the earliest check-in | `record_check_in`, `record_check_out` — BE-W3 |
| call report revision | a version must follow its parent, keep the same visit and author, and must not fork                                                | `revise_call_report` — BE-W4                  |
| call report decision | the author may not decide their own report, and a superseded version cannot be decided                                             | `approve_call_report` — BE-W4                 |
| every synced item    | partial success, per-item isolation, attempt counting, dead-lettering                                                              | `sync_push` — BE-W4                           |

Where a rule **is** policy-expressible it stays a policy. `visits_insert_own` was
tightened in BE-W4 to require the doctor be in the caller's territory rather than
moved behind an RPC, because "is this doctor in my scope" is exactly the kind of
thing `WITH CHECK` is for.

This generalises to consent capture in week 6 and to the patient app's diary. Any
time a write has a validity rule beyond ownership, the policy is not the control.

### Closed by the reviewer, 12 August 2026 — three requirements dropped

Recorded so they do not resurface as new proposals.

**`backend-prompts-v2.md` §2, capability-predicate role model — DROPPED.**
`patient`, `doctor` and `pv_officer` live in the **clinical database**, a separate
Supabase project. The PV officer never signs into this one; the adverse-event
endpoint pushes _out_ to them. A fourth role may never exist here at all, so
refactoring `visible_user_ids()` for it would be the speculative abstraction the
project rules forbid. Revisit only if a real fourth role appears — a regional or
national manager tier is the plausible case.

**`backend-prompts-v2.md` §8, API versioning — DROPPED.** One consumer, pre-release,
nothing deployed. Versioning a contract no client has ever consumed is ceremony. Add
it when an external consumer exists.

**`backend-prompts-v2.md` §9.12, source-code search for application-layer scope
filtering — DEFERRED to ~week 8**, when there is application code to search. The
structural check built in BE-W2 — every base table carrying `mr_id` must have a
SELECT policy referencing `visible_user_ids` — is retained and is the stronger
guarantee while no application code exists.

### Settled by the reviewer, 11 August 2026

These two closed BE-W2 open questions 2 and 4. Recorded here in full so neither
resurfaces as a new proposal in week 11.

---

**DECISION — `admin` has no write access to field activity.**

The brief's "admin gets full access" was loose wording. It means **full visibility,
subject to audit — never authorship.** `admin` cannot write `visits`, `check_ins`,
`check_outs`, `call_reports`, `consent_records` or `analyses`. It retains full read
across all of them (audited, through the logged RPCs where those apply) and full
write on master data: `organisations`, `territories`, `user_profiles`, `doctors`,
`clinic_addresses`.

_Reasoning:_ the consent ledger's only value is evidentiary. If **any** role can
author a consent record, then "could someone other than this MR have created this?"
answers **yes**, and the ledger proves nothing — which removes the legal basis for
the entire recording feature. The same logic applies to `check_ins`, which are the
evidence base for mileage and attendance, and to `analyses`, which are employment
records about a named person.

_Rules out:_ a general admin write policy on any of those six tables, at any point,
for any reason presented as convenience.

**Forward note — do not build this now.** A legitimate correction need will appear:
a check-in with wrong GPS coordinates from an OEM location glitch. The answer is an
**append-only correction row attributed to the admin who made it**, exactly the shape
of a consent withdrawal — never a general write policy, never an UPDATE. Build it
when someone actually asks for it, and build it that way.

---

**DECISION — the audit row stays in the caller's transaction. No `dblink`.**

A rolled-back transaction loses its audit row. That is accepted, not mitigated.

_Reasoning:_ through PostgREST the whole request is one transaction. If it rolls
back, PostgREST returns an error and the client receives nothing — **so there is no
disclosure without a matching audit row on any path a real user can take.**

Read-then-rollback requires a direct database session. The roles that have one,
`postgres` and `service_role`, carry BYPASSRLS and bypass the RPC entirely, so the
audit log was never the control for them in the first place. `dblink` would defend a
threat already outside the model, at the cost of a real operational dependency.

_Mitigation is operational, not technical:_ **do not grant direct production database
sessions.** Add connection-level logging if one ever must be granted. Recorded as a
known limitation rather than engineered around.

**Condition on this decision:** if the patient app ever routes **clinical** reads
through this same RPC pattern, this must be revisited. Different data, higher bar.
This app holds no health data — consent records are the doctor's personal data under
DPDP, analyses are the MR's employment data, and the applicable bar is DPDP Rule 6's
reasonable security safeguards, which this clears.

---

## Phase log

### BE-W1 — Foundations (10 August 2026)

#### What was built

**1. Monorepo**

Turborepo 2.10 + pnpm 11 workspaces, Node 24 pinned in `.nvmrc` and `engines`.
Strict TypeScript throughout — `strict`, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`,
`noPropertyAccessFromIndexSignature`. ESLint 9 flat config on
`typescript-eslint` **strictTypeChecked** with `eslint-config-prettier`.
Prettier for formatting; `docs/` is prettier-ignored so the reviewer's planning
documents are never reformatted.

The five workspaces resolve, build and typecheck. `apps/field` and `apps/console`
each import from `@elmiron/core`, which proves the contract package resolves from a
consumer before Frontend touches it.

**2. CI** — `.github/workflows/ci.yml`, two jobs, on every PR and every push to main:

- `static` — install, build, typecheck, lint, `prettier --check`, `packages/core`
  unit tests.
- `database` — brings up the local Supabase stack, which applies every migration to
  an empty database in order, then runs the `services/api` database tests. From
  BE-W2 this job also runs the adversarial RLS suite that proves Gate 0.

Both fail the build. Neither warns.

**3. Supabase**

The existing local stack moved from the repo root to `services/api/supabase`. Root
scripts run the CLI with `--workdir services/api`. The CLI is a dev dependency, not
a global install.

`config.toml` registers the custom access token hook. Auth is email + password and
email OTP (`otp_length = 6`, `otp_expiry = 3600`).

`.env.example` documents every variable including `SUPABASE_PROJECT_REF` and
`SUPABASE_REGION=ap-south-1`. No project reference is hardcoded anywhere in the
repo. No secrets are committed.

**4. Auth, roles and the two helpers**

Migration `20260810000100_roles_territories_profiles.sql`:

| Object                                        | Notes                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `public.app_role`                             | enum: `mr`, `field_manager`, `admin`                                                                         |
| `public.territories`                          | self-referencing hierarchy, `on delete restrict`, unique `code`                                              |
| `public.user_profiles`                        | one auth user → one role, one territory, one reporting manager, one active flag                              |
| `public.set_updated_at()`                     | trigger helper on both tables                                                                                |
| `public.custom_access_token_hook(jsonb)`      | adds `app_role`, `app_territory_id`, `app_is_active` to the JWT                                              |
| `public.current_app_role()`                   | **helper 1** — the caller's role, read from the JWT claim                                                    |
| `public.visible_territory_ids(uuid)`          | **helper 2** — MR: own territory. Manager: own subtree, recursive. Admin: all. Inactive or unknown: nothing. |
| `public.current_user_visible_territory_ids()` | grantable wrapper for the above                                                                              |

Two check constraints worth knowing about: an `mr` or `field_manager` cannot exist
without a territory (a scopeless user would silently see nothing and read as a bug),
and nobody can be their own reporting manager or their own parent territory.

RLS policies created:

| Policy                            | Table           | Effect                                                |
| --------------------------------- | --------------- | ----------------------------------------------------- |
| `user_profiles_select_self`       | `user_profiles` | a user reads their own row                            |
| `user_profiles_select_auth_admin` | `user_profiles` | the auth server reads profiles to mint the role claim |
| `territories_select_visible`      | `territories`   | reads restricted to the caller's visible set          |

No write policy on either table. `revoke all ... from anon, authenticated` precedes
every grant.

**5. `packages/core` — contract I1**

Published. Every entity the brief listed, plus the ones that are structurally
required by them:

`Role` · `UserProfile` · `Territory` · `Doctor` · `ClinicAddress` · `BeatPlan` ·
`BeatPlanEntry` · `Visit` · `CheckIn` · `CheckOut` · `CallReport` ·
`SampleAndInput` · `ConsentOutcome` · `ConsentTextVersion` · `ConsentRecord` ·
`VoiceNote` · `Recording` · `Transcript` · `TranscriptSegment` · `Finding` ·
`FindingCitation` · `Analysis` · `AnalysisOverride` · `SyncQueueItem`

Plus primitives (`Uuid`, `IsoDateTime`, `IsoDate`, `LanguageTag`, `Coordinates`),
the error envelope (`ApiErrorCode` including `permission_denied`, `ApiError`,
`ApiRequestError`), cursor pagination, and request/response shapes for every
endpoint through week 11 — doctors, beat plans, visits, check-in/out, call reports,
approvals, samples and inputs, consent capture and withdrawal, resumable upload
sessions, transcripts, analyses, MR responses, manager overrides, and sync
push/pull. `API_PATHS` holds the paths so the week-2 mock server and the client
cannot drift.

A typed `createApiClient` parses every response against its schema and throws
`ApiRequestError` on any non-2xx, carrying the code through so a denial surfaces as
a denial.

#### Files and directories created

```
package.json                turbo.json               tsconfig.base.json
eslint.config.mjs           .prettierrc.json         .prettierignore
.editorconfig               .gitignore (extended)    .env.example (extended)
pnpm-workspace.yaml (extended)
.github/workflows/ci.yml

packages/core/              package.json, tsconfig.json, tsconfig.build.json,
                            vitest.config.ts
  src/index.ts              src/primitives.ts        src/client.ts
  src/contract.test.ts
  src/entities/             identity.ts  field.ts  consent.ts
                            capture.ts   analysis.ts  sync.ts
  src/api/                  errors.ts  pagination.ts  endpoints.ts

packages/ui-tokens/         package.json, tsconfig.json, src/index.ts (placeholder)
apps/field/                 package.json, tsconfig.json, src/placeholder.ts
apps/console/               package.json, tsconfig.json, src/placeholder.ts

services/api/               package.json, tsconfig.json, vitest.config.ts
  supabase/config.toml      (moved from repo root; hook registered)
  supabase/migrations/20260810000100_roles_territories_profiles.sql
  rollbacks/20260810000100_roles_territories_profiles.down.sql
  tests/db.ts  tests/foundations.spec.ts

docs/                       (renamed from Docs/; content untouched)
```

#### Types published in packages/core

See the list under item 5 above. All exported from `@elmiron/core`.

**Message for Frontend and AI/ML:**

- Import from `@elmiron/core`. Do not redeclare these shapes locally.
- `Transcript`, `TranscriptSegment`, `Finding` and `FindingCitation` are
  **provisional compile targets**. The authoritative versions are AI/ML's contracts
  I3 (end week 2), I4 (end week 6) and I5 (end week 8). Both files say so in a
  header comment. Replace them; do not extend them silently.
- Backend will not change this package without announcing it in writing first.

#### Anything deliberately left out and why

| Left out                                                          | Why                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clinical or patient tables of any kind                            | This app has zero patient data. Not even a placeholder.                                                                                                                                                                                                                                         |
| Commercial schema — doctors, visits, call reports, consent tables | BE-W2. The types exist; the tables do not.                                                                                                                                                                                                                                                      |
| The full RLS policy set and the audit log                         | BE-W2.                                                                                                                                                                                                                                                                                          |
| The mock server                                                   | Contract I2, BE-W2.                                                                                                                                                                                                                                                                             |
| Any API endpoint                                                  | The shapes are declared; nothing is implemented.                                                                                                                                                                                                                                                |
| Audio storage, lifecycle, resumable upload                        | Week 7. The brief is explicit: building it against an unsettled transcript schema means building it twice.                                                                                                                                                                                      |
| A real Expo app and a real Next.js app                            | Frontend's, from week 1. `apps/field` and `apps/console` are directory placeholders with a workspace entry, a tsconfig and a `@elmiron/core` dependency — enough for CI to typecheck, nothing more. Frontend runs `create-expo-app` / `create-next-app` into them and deletes `placeholder.ts`. |
| Real design token values                                          | Frontend's. `packages/ui-tokens` exports empty objects and a type.                                                                                                                                                                                                                              |
| A trigger auto-creating `user_profiles` on signup                 | Not asked for, and it would need a default role, which is a policy decision, not a schema one. Provisioning is manual via `service_role` until the admin APIs in week 11.                                                                                                                       |
| A generated `database.types.ts`                                   | `pnpm db:types` exists. Generating it now, against two tables, would be committed noise.                                                                                                                                                                                                        |

#### Open questions for the reviewer

**1. "Permission denied, not an empty result" cannot be delivered by RLS alone. This
one needs a decision before BE-W2 starts.**

A Postgres `SELECT` under an RLS `USING` clause returns **zero rows**, not an error.
That is how RLS works. So the Gate 0 assertion — _"assert every one of those attempts
returns permission denied, not an empty result set"_ — is not satisfiable by RLS
policies on their own, on any of the five attack paths in the brief.

What is verifiable today, end to end (evidence below): a **write** as an MR returns
`403 permission denied`, not a silent no-op. A **read** outside scope returns `200 []`.

Three ways to close the read gap, and they differ a lot in cost:

- **(a)** Route every read through a `SECURITY DEFINER` function that checks scope
  and `raise exception`s with SQLSTATE `42501`. Genuine denials on every path,
  including raw SQL. Costs: no PostgREST auto-generated endpoints — every read is a
  hand-written RPC.
- **(b)** Keep RLS for the row filter, but make single-resource reads
  (`GET /visits/:id`) resolve through an edge function that distinguishes
  "does not exist" from "not yours" and returns 403. List endpoints still return
  `[]`. Cheaper, and it fails the brief's raw-SQL path.
- **(c)** Accept the empty result for reads, on the argument that the filter is in
  Postgres rather than application code — which is the actual risk §2.1 is about —
  and reserve hard denials for writes.

I have built nothing that presumes an answer. **My recommendation is (a) for
`analyses` and `consent_records`, and (c) elsewhere.** Those two tables are the
sensitive ones — an MR's analysis is employment data and consent is the legal basis
for the recording feature — and (a) is expensive enough that applying it to
`doctors` and `beat_plans` would slow the whole project for little gain. Tell me if
you want (a) everywhere; it changes the shape of most of BE-W2.

**2. Supabase project region is unverified from here.** `.mcp.json` points at project
ref `pgfdbzoapmleqtoezhoa`. The Supabase MCP returned "You do not have permission to
perform this action" for `get_project`, so I could not confirm the region
programmatically. **Please confirm in the dashboard that it is `ap-south-1`
(Mumbai).** The region cannot be changed later without a full migration, and
everything after week 1 assumes it.

**3. The role claim is stale for up to an hour after a change.** JWT expiry is 3600s.
Deactivating a user does not take effect in their claims until refresh.
`visible_territory_ids` re-reads `is_active` from the table so scope collapses
immediately, but any future policy written against `app_is_active` from the JWT
would not. Options: shorten `jwt_expiry`, or make every policy read `user_profiles`
rather than the claim. I would rather settle this before BE-W2 writes twenty
policies against one or the other.

**4. Raising it as instructed — the PV and privacy sign-off on the adverse-event
position.** It blocks week 7 and it needs two named people, not two teams.
`mr-app-plan.md` §0.4 sets out the contradiction: IPC §2.6 requires an identifiable
patient to file a valid case report, DPDP minimisation requires that you not retain
one. This is week 1; chasing it in week 6 is too late.

**5. Prompt BE-W1 said the planning documents move to `/docs`.** They were in `Docs/`
and are now in `docs/` via a two-step `git mv`. Windows is case-insensitive, so if
anyone's checkout looks odd after pulling, that rename is why.

---

### BE-W2 — Boundary (11 August 2026)

Built against `docs/amendment-gate0-criterion.md`, not the original
"permission denied, not an empty result" wording in the brief.

#### What was built

**Four migrations**, on top of BE-W1's:

| File                                   | Contents                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `20260811000100_commercial_schema.sql` | FORCE RLS retrofit, both carried tasks, 8 enums, 11 tables, `visible_user_ids()`              |
| `20260811000200_consent_ledger.sql`    | `consent_outcome`, `consent_text_versions`, `consent_records`, immutability triggers          |
| `20260811000300_audit_log.sql`         | `audit_log`, write-audit triggers on 9 tables, 4 logged-read RPCs, approval and response RPCs |
| `20260811000400_rls_policies.sql`      | The whole boundary: 31 policies, every grant and revocation, `visit_summary`                  |

Every one has a matching file in `services/api/rollbacks/`, and **CI now executes all
five rollbacks in reverse and asserts the public schema comes back empty** — closing
BE-W1 known gap 5.

**Both carried tasks from the amendment are done:**

- **Territory cycles are now unrepresentable.** `reject_territory_cycle()` walks up
  from the proposed parent on insert and on any `parent_id` update, and refuses the
  edge that would close a loop. The BE-W1 `CYCLE` clause made the read safe; this
  makes the write impossible.
- **`reporting_manager_id` is constrained.** `validate_reporting_manager()` rejects a
  manager who is an `mr`, rejects self-management, rejects a cycle in the chain, and
  refuses a chain longer than 64 hops.

#### Every RLS policy created

RLS is **enabled and forced on all 16 tables**. `analyses` and `audit_log`
deliberately have no policy and no grant for `authenticated` — direct access is a
permission denied.

| Table                   | Policy                                       | Cmd    | Effect                                                                       |
| ----------------------- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `organisations`         | `organisations_select_authenticated`         | SELECT | the employer's own name is readable                                          |
| `organisations`         | `organisations_admin_all`                    | ALL    | admin writes                                                                 |
| `territories`           | `territories_select_visible` _(BE-W1)_       | SELECT | own territory / own subtree / all                                            |
| `territories`           | `territories_admin_all`                      | ALL    | admin writes                                                                 |
| `user_profiles`         | `user_profiles_select_self` _(BE-W1)_        | SELECT | own row                                                                      |
| `user_profiles`         | `user_profiles_select_team`                  | SELECT | a manager can name the people in their scope                                 |
| `user_profiles`         | `user_profiles_select_auth_admin` _(BE-W1)_  | SELECT | GoTrue reads profiles to mint the role claim                                 |
| `user_profiles`         | `user_profiles_admin_all`                    | ALL    | admin writes                                                                 |
| `doctors`               | `doctors_select_in_territory`                | SELECT | bounded by `current_user_visible_territory_ids()`                            |
| `doctors`               | `doctors_admin_all`                          | ALL    | admin writes                                                                 |
| `clinic_addresses`      | `clinic_addresses_select_visible_doctor`     | SELECT | inherits the doctor's territory bound                                        |
| `clinic_addresses`      | `clinic_addresses_admin_all`                 | ALL    | admin writes                                                                 |
| `beat_plans`            | `beat_plans_select_own_or_team`              | SELECT | `visible_user_ids()`                                                         |
| `beat_plans`            | `beat_plans_insert_own`                      | INSERT | own `mr_id` only                                                             |
| `beat_plans`            | `beat_plans_update_own`                      | UPDATE | own `mr_id` only                                                             |
| `beat_plan_entries`     | `beat_plan_entries_select_via_plan`          | SELECT | scope inherited from the plan                                                |
| `beat_plan_entries`     | `beat_plan_entries_write_own_plan`           | ALL    | only entries on the caller's own plan                                        |
| `visits`                | `visits_select_own_or_team`                  | SELECT | `visible_user_ids()`                                                         |
| `visits`                | `visits_insert_own`                          | INSERT | own `mr_id` only                                                             |
| `visits`                | `visits_update_own`                          | UPDATE | own `mr_id` only                                                             |
| `check_ins`             | `check_ins_select_own_or_team`               | SELECT | `visible_user_ids()`                                                         |
| `check_ins`             | `check_ins_insert_own`                       | INSERT | own `mr_id` **and** own visit                                                |
| `check_outs`            | `check_outs_select_own_or_team`              | SELECT | `visible_user_ids()`                                                         |
| `check_outs`            | `check_outs_insert_own`                      | INSERT | own `mr_id` **and** own visit                                                |
| `call_reports`          | `call_reports_select_own_or_team`            | SELECT | `visible_user_ids()`                                                         |
| `call_reports`          | `call_reports_insert_own`                    | INSERT | own visit, never `approved`                                                  |
| `call_reports`          | `call_reports_update_own_not_approval`       | UPDATE | own row, and the WITH CHECK forbids `approved`                               |
| `samples_and_inputs`    | `samples_and_inputs_select_own_or_team`      | SELECT | `visible_user_ids()`                                                         |
| `samples_and_inputs`    | `samples_and_inputs_insert_own`              | INSERT | own `mr_id` and own visit                                                    |
| `consent_text_versions` | `consent_text_versions_select_authenticated` | SELECT | the device must fetch the text it displays                                   |
| `consent_records`       | `consent_records_insert_own`                 | INSERT | own capture, own visit. **No SELECT, UPDATE or DELETE policy for any role.** |
| `analyses`              | —                                            | —      | **no policy, no grant.** Reads via logged RPC only                           |
| `audit_log`             | —                                            | —      | **no policy, no grant.** Append-only by trigger                              |

The `check_ins` / `check_outs` / `call_reports` / `samples_and_inputs` INSERT policies
each carry a second clause requiring the visit to belong to the caller. Without it an
MR could attach a record to someone else's visit while still passing the `mr_id` test.

#### The Gate 0 suite — what each block proves

`services/api/tests/rls.spec.ts`, 70 tests. Every scope test goes direct to Postgres
or PostgREST with the user's own identity; no application code is in the path.

| Block                                             | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **harness fidelity** (6)                          | The plain test connection **does** bypass RLS, so `asUser()` is not decoration. `SET ROLE authenticated` genuinely subjects the session to policy (asserted as an inequality against the same query run as `postgres`). A minted JWT is accepted by PostgREST. **Real GoTrue claims deep-equal the ones the fast path builds** — if the auth hook changes shape, this one test fails instead of the suite quietly testing a fiction. Positive controls throughout, so a zero-row result cannot pass because everything is broken. |
| **mr → another mr: visits** (6)                   | All five required paths: REST, direct SQL, a join from a table the caller legitimately reads, a Postgres function, and the `visit_summary` view. Plus the view's positive control.                                                                                                                                                                                                                                                                                                                                                |
| **mr → another mr: check-ins, call reports** (7)  | REST, SQL and join for each; the approval RPC refuses an unrelated MR and refuses a manager outside their team.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **analyses** (7)                                  | Direct SELECT is **permission denied** for `mr`, `field_manager` **and** `admin` — criterion 3. REST exposes no table. `read_analysis` discloses nothing for another MR's analysis but does return the caller's own. `respond_to_analysis` refuses somebody else's.                                                                                                                                                                                                                                                               |
| **field_manager → outside their team** (7)        | Positive control inside the subtree, then REST, SQL, join, view, `list_analyses` and `read_consent_record` all outside it.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **doctors bounded by territory** (5)              | An MR reads their own territory's doctor and not the neighbouring one, over both paths, including clinic addresses; a manager sees the whole subtree and no further.                                                                                                                                                                                                                                                                                                                                                              |
| **consent_records append-only** (11)              | Two layers proved separately — `service_role` is stopped at the **grant**, and with the grant restored inside a rolled-back transaction the **trigger** still refuses it. Same for the table owner, which holds BYPASSRLS. A **zero-row UPDATE errors** rather than reporting success. Rewriting the consent text is refused. Withdrawal creates a new row and leaves the original `consented`. Withdrawing a never-granted consent is refused. No penalty, flag, score, rating, compliant or is_failure column exists.           |
| **audit_log append-only** (7)                     | UPDATE and DELETE refused at the grant layer for `service_role` and at the trigger layer for the owner; zero-row UPDATE errors; `authenticated` can neither read nor write it; and an INSERT into `visits` provably adds exactly one audit row, so the trigger — not the caller — writes it.                                                                                                                                                                                                                                      |
| **admin access is audited before disclosure** (4) | An admin read without a reason is refused. With one, the returned `readAt` is stamped after the audit insert and after the row is fetched, and `audit_log.occurred_at <= readAt` is **measured, not assumed**. An out-of-scope read still writes the row that shows someone went looking.                                                                                                                                                                                                                                         |
| **structural invariants** (7)                     | Every table has RLS enabled **and** forced. Every view is `security_invoker`. **Every base table with an `mr_id` has a SELECT policy referencing `visible_user_ids`** — criterion 4 made mechanical. No write grant on any append-only table. `anon` holds nothing at all.                                                                                                                                                                                                                                                        |
| **deactivation** (1)                              | Flipping `is_active` collapses scope immediately, with claims that still say active.                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**The suite was mutation-tested.** Four deliberate regressions were applied to the
live schema — a permissive `visits` policy, the consent trigger dropped with its grant
restored, `security_invoker` turned off on the view, and `analyses` granted to
`authenticated` — and **20 of the 88 tests failed**. Restored, all 88 pass. Evidence
below.

#### Contract I2 — the mock server

`services/mock`, zero runtime dependencies beyond `@elmiron/core`. `pnpm mock` starts
it on `:4010`.

- **Every endpoint declared in `packages/core`**, plus `GET /sync/queue` for driving
  the offline-queue UI.
- Fixtures are typed as the real entities, so **the mock cannot drift from the
  contract without failing typecheck**.
- Scenarios via `x-mock-scenario` or `?_scenario=`: `populated` (default), `single`,
  `empty`, `denied`, `unauthenticated`, `validation`, `conflict`, `rate-limited`,
  `error`.
- Real cursor pagination — a test walks the whole list one item at a time and asserts
  no repeats.
- All three consent outcomes POST to the same route and all three return 201. There
  is no error path for declining.
- The offline-sync fixture covers `queued`, `in_flight`, `conflict` and `failed`, and
  `POST /sync/push` returns a deterministic mix of accepted / duplicate / conflict /
  rejected so the client's non-happy paths get exercised.
- 27 tests parse every response against its `@elmiron/core` schema, and two of them
  drive the published `createApiClient` against the mock — including asserting that
  `permission_denied` arrives as a thrown `ApiRequestError`, never as empty data.

#### Files created or changed

```
services/api/supabase/migrations/  20260811000100_commercial_schema.sql
                                   20260811000200_consent_ledger.sql
                                   20260811000300_audit_log.sql
                                   20260811000400_rls_policies.sql
services/api/rollbacks/            one .down.sql per migration above
services/api/scripts/              verify-rollbacks.mjs
services/api/tests/                auth.ts (new)  fixtures.ts (new)
                                   rls.spec.ts (new)  db.ts (+withClient)
                                   foundations.spec.ts (updated for the new schema)
services/mock/                     package.json, tsconfig{,.build}.json,
                                   vitest.config.ts,
                                   src/fixtures.ts, src/server.ts, src/index.ts,
                                   tests/contract.spec.ts
.github/workflows/ci.yml           mock tests; Gate 0 suite; rollback verification
eslint.config.mjs                  node globals for plain-JS scripts
package.json                       `pnpm mock`
.env.example                       test-harness keys, MOCK_PORT
```

#### Deliberately left out and why

| Left out                                                       | Why                                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any HTTP API implementation                                    | Not in the BE-W2 scope. Shapes are declared, the mock serves them, the database enforces the boundary beneath them.                                                        |
| `findings` and `transcript_id` on `analyses`                   | Contract I5 is AI/ML's and is due end of week 8. `analyses` exists only because the RLS spec requires it.                                                                  |
| Admin write access to visits, call reports and consent records | Admin has full access to master data. It has no path to author field activity on an MR's behalf, which would forge a record of work that never happened. Raising it below. |
| Autonomous (out-of-transaction) audit writes                   | Needs `dblink` or `pg_background`. Recorded in the migration header rather than hidden. A rolled-back read disclosed nothing durable either.                               |
| Reading `audit_log` from the app                               | Nothing needs it this week. The admin audit console is week 11 and gets its own logged RPC.                                                                                |
| Cross-file dedup of the DB reachability check                  | Still deferred. Now that `rls.spec.ts` exists, `globalSetup` + `provide`/`inject` has real call sites — worth doing in BE-W3.                                              |

#### Open questions for the reviewer

**1. Two corrections to the amendments you sent, both measured.**

- **`postgres` is not a superuser in Supabase, but it does hold `BYPASSRLS`** — so
  vectors 1 and 2 in your note collapse into one. More importantly, **`FORCE ROW
LEVEL SECURITY` does not subject `postgres` or `service_role` to policy**, because
  BYPASSRLS wins over FORCE. Measured both ways: with FORCE on, `postgres` still
  reads every row. FORCE is applied everywhere and is worth having, but it is not
  what closes the owner-bypass vector for these roles — the **triggers** are. If the
  ledger's immutability had been left to "no UPDATE policy plus FORCE", anyone
  holding the service key could have rewritten it.
- The corollary: **`SET ROLE authenticated` does work**, exactly as you said, and the
  suite is built on it. Proven by an explicit inequality test rather than assumed.

**2. Admin cannot author field activity, and I would like that confirmed.** The brief
says `admin` — full access. I gave admin full read plus full write on master data
(organisations, territories, user profiles, doctors, clinic addresses) but **no write
policy on visits, check-ins, call reports, consent records or analyses**. An admin who
can insert a consent record on an MR's behalf can manufacture a consent that no doctor
ever gave, which is the exact artefact the ledger exists to make impossible. Say if
you want literal full access; it is one policy per table and I would rather you chose
it than inherit it.

**3. `consent_text_versions.hash` is generated, not supplied.** The column is
`generated always as (public.sha256_hex(full_text)) stored`. `sha256_hex` is marked
IMMUTABLE on the basis that the database encoding is UTF8 and pinned; `convert_to` is
only STABLE, which is why the wrapper exists. If the database encoding ever changes,
that promise breaks and so do the stored hashes. Flagging rather than burying.

**4. The audit row shares the caller's transaction.** A caller who rolls back loses
the audit row with everything else. Making it autonomous needs `dblink` or
`pg_background` — a real dependency and a real decision. My read is that it does not
matter, because a rolled-back read disclosed nothing durable, but a PV or privacy
reviewer may see it differently and it is cheaper to decide now than in week 11.

**5. Still unanswered from BE-W1, and now overdue: the PV and privacy sign-off on the
adverse-event position.** It blocks week 7 and needs two named people. Week 7 starts
in five weeks.

**6. `docs/spend-approval.md` — the Apple Developer Program.** Response was requested
by Friday 14 August. The blocker is the D-U-N-S number, not the $99. If it slips the
week-5 App Store probe slips with it.

---

### BE-W3 — Field operations (12 August 2026)

Gate 0 passed. One migration, `20260812000100_field_operations.sql`, and one new
suite, `services/api/tests/field.spec.ts`.

Everything in this phase exists because **the client cannot be trusted with any of
it**: when a capture happened, where it happened, whether it was inside working
hours, or how far the MR travelled. Each of those is either an expense claim or an
attendance record, so each is computed or validated server-side.

#### What was built

**1. `received_at` on every client-originated table** — `visits`, `check_ins`,
`check_outs`, `call_reports`, `samples_and_inputs`, `consent_records`.

`occurred_at` is what the device says; `received_at` is when the server took
delivery. A column default is not enforcement — anything that can INSERT can
override it — so a `BEFORE INSERT` trigger stamps it and discards whatever was
supplied, for every role including the table owner. There is a test that inserts
`2001-01-01` as `postgres` and asserts the stored value is current.

`clock_timestamp()`, not `now()`: `now()` is transaction start, which for a batched
offline sync is the same instant for fifty rows that arrived over four seconds. The
week-9 adverse-event SLA clock starts at ingest and will read this column.

**2. Shift windows as configuration** — `territory_shift_windows`: start, end, IANA
timezone, grace minutes, active ISO weekdays. One row per territory, **inherited
down the territory tree** by `effective_shift_window()`. A territory with no window
of its own resolves to the nearest ancestor.

If no ancestor has one either, capture is **refused with an error naming the missing
configuration** rather than falling back to a plausible default. A default here
would silently accept captures at 3am for any territory someone forgot to configure.

**3. Work-hours enforcement, server-side** — `is_within_shift()` converts
`occurred_at` into the territory's own timezone before comparing. Comparing a UTC
clock against a local window is a five-and-a-half hour error in this deployment, and
it is the kind that produces plausible-looking data rather than an obvious failure.

**4. Capture moved behind RPCs** — `record_check_in()` and `record_check_out()`.

RLS decides which rows a caller may write; it cannot decide what the values must be.
Work hours, the geofence computation and the check-out duration are none of them
expressible as a policy, so **the direct INSERT policy and grant on `check_ins` and
`check_outs` were withdrawn**. Leaving them would have left a path that skips every
check above. There is a test asserting the direct path is now permission-denied.

Both functions are **idempotent on the client-generated id**, and the idempotency
check runs _before_ the work-hours check — a retry of something accepted at 10:00
must not be refused because the phone finally got signal at 23:00. Replaying another
user's id is rejected outright.

**5. Geofence computed, never accepted** — `record_check_in` takes no geofence
argument at all. Status and distance are derived from the stored clinic coordinates
via `distance_metres()`, a plain haversine function. Deliberately not PostGIS or
`earthdistance`: two call sites do not justify a spatial extension maintained
forever.

**6. Mileage** — `daily_mileage(from, to, mr_id)`. Sum of the distance between
consecutive check-ins, per MR per day, **ordered by `occurred_at` and not by
arrival**. A day that synced backwards would otherwise produce a different expense
claim than the same day synced forwards. Bounded by `visible_user_ids()`, so an MR
sees their own and a manager sees their team's.

**7. Doctor search, indexed** — `pg_trgm` GIN indexes on `full_name` and
`specialty`, a composite `(territory_id, is_active, full_name)` for the common
filtered listing, and `search_doctors()`, which is **SECURITY INVOKER on purpose**
so the doctors RLS policy remains the scope filter and the function cannot widen it.
A test asserts the query plan uses the trigram index rather than timing a two-row
fixture table and calling it fast.

#### Contract change — Frontend and AI/ML need to know

`packages/core` changed. Announced here rather than landing silently, per
`mr-work-split.md` §4:

| Change                                                                                                | Affects                             |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `receivedAt` added to `Visit`, `CheckIn`, `CheckOut`, `CallReport`, `SampleAndInput`, `ConsentRecord` | any code constructing these objects |
| `durationSeconds` added to `CheckOut`                                                                 | nullable until a check-in arrives   |
| `TerritoryShiftWindow` and `MileageDay` are new                                                       | new screens                         |
| `GET /shift-window`, `GET /mileage` are new paths                                                     | new screens                         |

All additive. Nothing was removed or renamed. The mock server serves both new
endpoints, including the "no window configured" state as a `200` with a null window
rather than a `404` — that state is something the app must render, not a transient
failure it should retry.

#### What each new test proves

`services/api/tests/field.spec.ts`, 31 tests.

| Block                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **work hours** (7)    | Inside the window is accepted; before it opens and on a non-working day are refused. **A 05:00 UTC capture is accepted** — it is 10:30 IST, so accepting it is the proof the timezone conversion happens rather than a UTC comparison that would look correct in a test written in London. Inheritance resolves to the ancestor; an own window beats the ancestor; a territory with no window anywhere errors by name instead of defaulting. |
| **geofence** (4)      | At the clinic → `inside` under 50 m. Three kilometres away → `outside`, distance between 2 and 5 km, regardless of what the app believes. No clinic address → `unavailable`. One degree of latitude measures 111.1–111.3 km.                                                                                                                                                                                                                 |
| **received_at** (3)   | Stamped within a minute of now while `occurred_at` stays where the device put it. A supplied `2001-01-01` is discarded even from the owner. Every client-originated table has the column.                                                                                                                                                                                                                                                    |
| **idempotency** (5)   | A retry returns the original row, does not overwrite it with the retry's coordinates, and leaves exactly one row. A retry outside working hours still succeeds, because the original was inside them. Replaying another user's id, and checking in against another MR's visit, both refused. The direct INSERT path is permission-denied.                                                                                                    |
| **check-out** (2)     | Duration computed from the visit's earliest check-in. Null — not an error — when the check-out arrives before the check-in, which out-of-order sync makes normal.                                                                                                                                                                                                                                                                            |
| **mileage** (6)       | Two ~1 km legs sum correctly. **The same day seeded in reverse produces the same total**, which is the whole reason for ordering by `occurred_at`. A single check-in reports zero rather than failing. Visible to the MR, visible to their manager, empty for a manager outside the team.                                                                                                                                                    |
| **doctor search** (4) | Finds by partial name and by specialty; never returns a doctor outside the caller's territory; uses `doctors_full_name_trgm_idx` in the plan.                                                                                                                                                                                                                                                                                                |

**Mutation-tested**, same discipline as BE-W2. Five deliberate regressions applied to
the live schema — work-hours check stubbed to `true`, the `received_at` triggers
dropped, the direct-insert path reopened, mileage ordered by `received_at` instead of
`occurred_at`, and `search_doctors` switched to SECURITY DEFINER — produced **7
failures across all five**, each caught by the test written for it. Restored: 119/119.

#### Contract I3 — not published

**AI/ML has not delivered the STT vendor decision or the transcript schema.** There
is no such document in this repository: `docs/` contains no bake-off result, no
vendor decision, and no transcript schema. I am not guessing at a shape.

Per `mr-work-split.md` §4 this was due **end of week 2** and is described there as
_"the highest-consequence contract in this project"_ — backend cannot design the
pipeline without it. It is now one week late and the pipeline work starts in week 8.

The provisional `Transcript` shape in `packages/core/src/entities/capture.ts` is a
compile target for the mock server, clearly labelled as such, and must not be
mistaken for the contract. **I need the real one, or a written statement that the
bake-off failed and the AI layer is being cut** — which §0.1 of the work split says
is a legitimate and good outcome if delivered early.

#### Deliberately left out

| Left out                                     | Why                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Admin correction rows for bad GPS captures   | The reviewer's forward note says build it when someone asks, as an append-only attributed row. Nobody has asked.                |
| Expense amounts, rates, per-km reimbursement | Mileage is distance. Turning distance into money is a payroll decision nobody has made.                                         |
| A generic idempotency-key table              | The client-generated primary key already is the idempotency key. A second mechanism would be a second thing to keep consistent. |
| Beat-plan CRUD endpoints                     | Already covered by PostgREST plus the BE-W2 policies. Only the missing index was added.                                         |
| Shift-window overrides per MR, or per date   | Configuration is per territory, which is what was asked. Per-person exceptions are a policy question, not a schema one.         |
| PostGIS                                      | Two distance call sites.                                                                                                        |

#### Open questions for the reviewer

**1. Contract I3 is a week late and it blocks week 8.** See above. This is the item
most likely to cost the date after the PV sign-off.

**2. Mileage is straight-line distance, not road distance.** Sum of haversine legs
between check-ins. Road distance would need a routing provider — cost, an external
dependency, and data leaving India unless the provider has an Indian endpoint. My
read is that straight-line is the right call for a reimbursement baseline and that
the difference should be handled by the per-km rate, not by the geometry. **If
Finance expects road distance, say so now** — it is a vendor decision with a
residency question attached, not an implementation detail.

**3. Withdrawing the direct INSERT on `check_ins`/`check_outs` is a contract change
in behaviour, not shape.** Frontend must call `record_check_in` / `record_check_out`
rather than POSTing to the table. The mock server's `POST /check-ins` still works and
returns the same shape, so nothing breaks against the mock — but the real API will
refuse a direct insert. Flagging because it is the kind of difference that surfaces
in week 11 integration rather than now.

**4. Shift windows have no data yet.** The table is empty outside test fixtures, so
in a fresh environment **every capture will be refused** with "no shift window
configured". That is the designed behaviour and it is loud, but somebody has to
insert the real windows before a pilot. It needs the actual working hours per
territory from the client — worth asking for now.

**5. `search_doctors` has no pagination.** It caps at 200 rows. For a waiting-room
lookup that is right; for the manager console listing a whole territory it is not.
`GET /doctors` with cursor pagination stays the endpoint for listing. Flagging so the
two do not get conflated.

---

### BE-W4 — Offline sync (13 August 2026)

Two migrations. The first eliminates conflicts; the second handles what is left.

#### Conflicts eliminated, not resolved

Merge logic for a day that synced six hours late is hard to write and impossible to
reason about a month later. Append-only data has no conflicts — only ordering, and
ordering is already handled by `occurred_at` plus `received_at`. So the mutability
was removed rather than merged.

| Entity                                                             | Before                                                  | After                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `check_ins`, `check_outs`, `consent_records`, `samples_and_inputs` | already append-only                                     | unchanged                                                                                                      |
| `call_reports`                                                     | mutable row per visit                                   | **append-only versions**: an edit is a new row with `version = parent + 1` and `supersedes_call_report_id` set |
| call report approval                                               | an UPDATE writing `approved_by_user_id` onto the report | **`call_report_approvals`**, its own append-only table                                                         |
| `beat_plans`                                                       | mutable row per MR per day                              | **append-only versions**, so an MR working yesterday's plan keeps a valid reference                            |
| `visits`                                                           | mutable by the owning MR                                | still mutable — single-writer, see below                                                                       |

**Approval had to move.** Once the report is immutable there is no UPDATE to set
`approved` on, and putting the decision into a new _version_ of the report would make
the manager an author of it — the one thing the brief says a manager must never be.
So a decision is its own row, a reversal is a new row referencing the previous
decision, and `call_report_current` derives `effective_status` from the two.

**What genuinely remains, and how it is resolved:**

- **Stale beat plan.** The manager revises the plan while the MR is offline working
  the old one. Neither is discarded: the visit keeps its reference to the version
  actually worked, the revision exists alongside it, and the sync result carries a
  **`stale_beat_plan` warning on an accepted item**. Never a rejection — the MR did
  the work.
- **Visits.** Still mutable, deliberately: only the owning MR can write their own
  visit, so there is no second writer to conflict with. What looks like a conflict is
  ordering, and ordering is `occurred_at` for what happened and `received_at` for
  what arrived. Documented rather than merged.
- **Nothing resolves by "last write wins".** Arrival order is meaningless when a day
  can land in any sequence, so no rule anywhere depends on it.

#### The sync protocol

`sync_push(batch_id, items)` — batched, resumable, idempotent on the device-generated
item id.

- **Partial success is the normal case.** Each item is applied inside its own
  `BEGIN … EXCEPTION` block, which is its own savepoint, so a failure rolls back that
  item and nothing else. A batch of eight with three refusals commits five.
- **Per-item verdicts**, not a batch result: `accepted` / `duplicate` / `rejected` /
  `dead_lettered`, each with a machine-readable `rejectionCode` and any `warnings`.
- **A poison item cannot block the queue.** Nothing is sequential across items, and
  after five attempts an item is dead-lettered and stops being retried, keeping the
  reason it died of.

#### Rejected items are visible, never silently lost

This is the part that hurts real people if it is wrong. An MR captures eight visits,
and at 6pm three are refused because the shift window was configured wrong. They did
the work; they cannot re-do the day.

- A rejection is a **durable row in `sync_items`** with its payload intact, so the
  work can be resubmitted once the cause is fixed.
- The code is machine-readable and the distinctions matter: `outside_shift_window` is
  somebody else's misconfiguration, `outside_geofence` is about where the MR stood,
  `not_your_record` is neither. Showing an MR the wrong one is how trust in the app
  dies.
- `list_sync_rejections()` returns them, scoped by `visible_user_ids()`.
- **The override shape exists and the override does not.**
  `sync_items.supersedes_sync_item_id` is present so a manager override can be added
  later as code, not as a migration against a table with months of real data in it.
  Same shape as a consent withdrawal.

#### The rule the client needs to warn with

`my_shift_window()` returns the caller's resolved window and the territory it came
from, so Frontend can run the work-hours check client-side as **advisory** and warn at
capture instead of ambushing the MR at 6pm. The database remains the enforcement
point; the client copy is a courtesy.

An unconfigured window returns `{ window: null }` and **not an error** — "your hours
have not been set up, captures will be refused" is a state the app must render, not a
transient failure worth retrying.

#### Observability

`sync_queue_status()` answers what support will ask during the pilot: accepted,
rejected and dead-lettered counts, last successful sync, and the oldest unresolved
item. Built now, because adding it later means querying months of real data with no
index for the question.

#### What each new test proves

`services/api/tests/sync.spec.ts`, 33 tests.

| Block                            | What it proves                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **partial success** (3)          | A good/bad/good batch returns `accepted, rejected, accepted` **and both good visits exist in the database** — the failure did not roll back the successes. One result per item, in order. A poison item does not block the item behind it.                                                                                         |
| **idempotency** (2)              | A resubmitted item returns `duplicate` and applies nothing twice. A whole batch resent after a lost response returns `duplicate` for every item.                                                                                                                                                                                   |
| **dead-lettering** (2)           | Five rejections, then `dead_lettered` on the sixth, still dead on the seventh. The original rejection code survives on the dead letter.                                                                                                                                                                                            |
| **rejections are durable** (6)   | The row persists with its payload and a machine-readable code. `outside_shift_window` and `not_your_record` are distinguishable in the same batch. A malformed item is rejected _as malformed_ and the batch carries on. An unsupported entity is named as such. `list_sync_rejections` surfaces them. The override column exists. |
| **call reports append-only** (5) | UPDATE refused at the trigger layer for the owner and at the grant layer for an MR. An edit is version 2 and version 1 is untouched. A fork is refused. `call_report_current` shows only the newest.                                                                                                                               |
| **approval is separate** (5)     | A decision sets `effective_status` without touching the report. The author cannot decide their own. A superseded version cannot be decided. A reversal is a new row referencing the first. UPDATE on an approval is refused.                                                                                                       |
| **stale beat plan** (3)          | Work filed against a superseded plan is **accepted with a `stale_beat_plan` warning** — the crucial one. No warning when the plan is current. `beat_plan_current` shows only the newest.                                                                                                                                           |
| **observability** (5)            | Counts and last-successful-sync for the MR; visible to their manager; empty for a manager outside the team; an MR cannot read another MR's queue; the field cannot write `sync_items` directly.                                                                                                                                    |
| **my_shift_window** (2)          | Returns the resolved window and its source territory. Reports an unconfigured window as null rather than raising.                                                                                                                                                                                                                  |

**Mutation-tested.** Six regressions — call-report and approval triggers dropped,
`beat_plan_is_stale` stubbed to false, dead-lettering removed, `sync_items` opened to
every authenticated user, `my_shift_window` made to raise — produced **10 failures**,
including the BE-W2 structural invariant catching the policy change. Restored:
152/152.

#### Two bugs the tests found in my own migration

Both would have been invisible in a green suite:

1. **`sync_items_rejection_has_code` was a biconditional on `rejected` alone**, so a
   dead letter — which also carries a code — violated it. The dead-lettering test
   caught it on first run.
2. **A missing `id` on an item cast to NULL instead of raising**, so the malformed
   branch never fired and the resulting NOT NULL violation escaped the per-item block
   and took the whole batch down. Exactly the failure mode the per-item isolation
   exists to prevent, in the code that implements it.

#### Contract change — Frontend must be told

| Change                                                                                                                                 | Effect                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **`POST /check-ins` and `POST /check-outs` are refused**                                                                               | The mock now returns `403 permission_denied` naming the RPC, matching the real API. Call `POST /rpc/record_check_in` / `record_check_out`. |
| `CallReport` gains `version`, `supersedesCallReportId`; loses `approvedByUserId`, `approvedAt`                                         | Approval is `CallReportApproval`; render `CallReportCurrent.effectiveStatus`                                                               |
| `CallReportApproval`, `CallReportCurrent`, `ServerSyncItem`, `SyncQueueStatus`, `SyncRejectionCode` are new                            | new surfaces                                                                                                                               |
| `SyncPushRequest` gains `batchId`; `SyncPushResult` replaces `serverPayload`/`error` with `rejectionCode`/`rejectionDetail`/`warnings` | the queue UI reads these                                                                                                                   |
| `BeatPlan` gains `version`, `supersedesBeatPlanId`                                                                                     |                                                                                                                                            |
| `syncPush` path moves to `/rpc/sync_push`                                                                                              |                                                                                                                                            |
| **`packages/core` is now namespaced**: `@elmiron/core/shared` and `@elmiron/core/field`                                                | The root import still re-exports everything, so **no consumer has to change**. Use the subpaths in new code.                               |

#### Part 1c — integration readiness

- **`packages/core` split into `core/shared` and `core/field`.** `shared` is identity,
  primitives, errors, pagination and config — what a second app consumes unchanged.
  `field` is the MR domain. Same package, subpath exports, root barrel intact.
- **`packages/core/src/shared/config.ts`** loads the JWT audience, site URL,
  additional redirect URLs and deep-link scheme from the environment and validates
  them, failing loudly on a missing value rather than defaulting. Five tests,
  including one asserting the failure.

#### Deliberately left out

| Left out                                       | Why                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The manager override of a rejection            | The reviewer's instruction: leave room, do not build. The column exists; the logic does not.   |
| `sync_pull`                                    | Part 3 is about push. The pull contract is declared and mocked; nothing consumes it yet.       |
| Merge logic for visits                         | Single-writer. There is no second party to conflict with.                                      |
| A generic retry/backoff scheduler              | The client owns retry timing. The server owns the attempt count and the dead-letter threshold. |
| `env()` substitution in `supabase/config.toml` | Tried; it does not work. See open question 2.                                                  |

#### Open questions for the reviewer

**1. The dead-letter threshold is five attempts, chosen not derived.** An item that
fails five times for a _fixable_ reason — a misconfigured shift window corrected on
day three — is dead before the fix lands, and there is no un-dead path until the
override exists. Options: raise the threshold, make it per rejection code, or make
`dead_lettered` reversible when the code is one of the "somebody else's fault" set.
**My recommendation is the third.** It is cheap, but it is a policy decision about
whose fault counts.

**2. `env()` in `supabase/config.toml` silently does not resolve.** I moved
`site_url` and `additional_redirect_urls` to `env(APP_SITE_URL)` as the brief asked,
started the stack, and checked the container: GoTrue received the literal string
`env(APP_SITE_URL)`. The CLI resolves `.env` relative to `--workdir`, there is no
`--env-file` flag, and an unresolved reference is passed through rather than failing.
I reverted that half with the reasoning in the file. The app-level values — where the
rule actually bites — are externalised properly in
`packages/core/src/shared/config.ts`. Flagging because "we externalised the config"
would have been a true sentence describing a broken system.

**3. Contract I3 is now two weeks late.** Unchanged from BE-W3. Nothing in `docs/`.
The pipeline work starts in week 8.

**4. `sync_push` accepts up to 500 items in one transaction.** A full offline day is
well under that; a device dark for a week is not. Per-item savepoints make the
transaction long rather than large, but it is still one transaction. If pilot devices
routinely queue more than a few hundred items this wants chunking on the client —
worth a number from the pilot rather than a guess now.

**5. Shift-window data is still missing** and now blocks more than capture: with no
window configured, `sync_push` rejects every check-in in a batch with
`outside_shift_window`. The escalation is drafted at
[docs/escalations-week3.md](docs/escalations-week3.md) §2 — **still unsent**. It needs
a named person at the client to collect start/end times, working days and exceptions
per territory; it is a data-gathering task, not an engineering one.

---

### BE-W5 — Manager surface, approval workflow, Gate 1 server half (14 August 2026)

One migration, three new suites.

#### Reviewer questions closed

**Mileage is straight-line, and that is final.** Deterministic, auditable, free, and
with no data-residency question — road distance means a routing provider and
coordinates leaving India unless it has an Indian endpoint. The road-versus-straight
difference is _systematic_, so it belongs in the per-km rate rather than in the
measurement. If Finance wants road distance that is a vendor decision with a
residency question attached, not an implementation detail.
**One consequence for Frontend:** label it in the UI. An MR who believes it is road
distance and finds out otherwise will feel short-changed and stop trusting the
number.

**`search_doctors` keeps its cap and now reports it.** `{ items, truncated, limit }`,
with `truncated` measured by fetching one row beyond the limit rather than inferred.
A silent cap is the same failure mode as a silently skipped test: the MR sees partial
results and believes they are complete. Two tests, one for each value of the flag.

**Frontend must call `record_check_in` / `record_check_out`** — announced in BE-W3,
**acknowledged**. The mock refuses the direct POST as of BE-W4.

**Dead-letter reversibility — built, with no fault taxonomy.** A dead letter is
always reversible by a `field_manager` or `admin`, with a mandatory reason and an
append-only attributed record. There is deliberately no "somebody else's fault" code
set: at the point of rejection a wrong shift window and an MR error are
indistinguishable — both produce `outside_shift_window` — and a taxonomy that looks
clean at design time produces arguments in production about which bucket a case
belongs in. **The control is attribution and visibility, not prevention.**

Attempts are _forgiven_, never rewritten: `attempts_forgiven` records the baseline so
a reinstated item gets a fresh budget while the record that it failed six times
survives. Erasing that would make attributing the reversal pointless.

#### The manager surface — exception-first

| Function                            | Answers                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `team_activity(date)`               | who is where, who is off-plan, per MR, for a day                                                                           |
| `coverage(from, to)`                | planned beat versus actual visits, per MR per day                                                                          |
| `mr_activity_detail(mr, date)`      | one MR's day in full — the only non-exception view, because a manager shown an exception needs to look at the thing itself |
| `team_exceptions(date, staleHours)` | missed visits, no recent sync, high rejection rate, consent-rate anomaly                                                   |

**Location is drawn only from captures inside the configured shift window.** The
manager view does not surface where an MR was outside their working hours, and that
filter lives in `team_activity` rather than being left to the capture path — the
fixtures seed check-ins directly, so the test proves the filter and not the RPC.

**A missed visit is a planned doctor who was not seen**, not a count difference. An
MR who did eight unplanned visits instead of eight planned ones has missed eight.

**On consent rates.** An MR at 100% while the team sits at 40% is a **fraud signal,
not a performance win**. The exception carries `signal: 'data_quality'`, the team
median, and the sample size, and it fires on deviation in **either** direction — far
below may mean a territory of doctors who decline, which is information about the
territory. There is **no ranking of MRs against one another anywhere in this
migration**: no score, no rank, no percentile, no ordering by performance. A test
asserts the absence by name, in both the column list and the returned JSON.

#### Approval workflow

Built on the `call_report_approvals` table from BE-W4. An approval remains a decision
**about** a report and never an edit **to** one.

- `approvable_call_reports()` — submitted, current, in the caller's subtree, and
  **never the caller's own**.
- `approve_call_reports_bulk(ids[], approved, reason)` — up to 200 in one call, with
  **a verdict per report**. Same per-item discipline as `sync_push`: one bad id does
  not roll back the other thirty-nine. A manager clearing Monday morning needs to
  know _which_ failed, not that "the batch failed".
- `overdue_call_reports(threshold)` — submitted, current, undecided past a threshold.
- `effective_status` stays derived in `call_report_current`. A test asserts it is not
  a column on `call_reports`, and neither is `approved_by_user_id`.

#### Sync observability, finished

`sync_item_explained` puts the machine-readable code and the human sentence in the
same row, plus `attempts_remaining` and `was_reinstated`.
`sync_rejection_explanation()` is the mapping — `rejection_detail` is the raw
Postgres message, which is precise and no use to an MR.

Support can now answer, for any MR: what is queued, what failed, why in both
registers, when they last synced successfully, what is dead-lettered, how many
attempts remain, and whether anyone has already reinstated it.

#### Gate 1 — the server half, decoupled

Gate 1 needs the field app, which does not exist. Frontend lost three days to the
credential problem, so the gate will slip; that is arithmetic, not failure.

`services/api/tests/gate1.spec.ts` builds one MR's full day — a beat plan of four
doctors, four visits, four check-ins, four call reports, a check-out — as the queue a
device would hold at 6pm, and pushes it through `sync_push` in one batch. When
Frontend arrives, Gate 1 becomes _run this, plus the client-side checks_.

| Assertion                  | What it proves                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whole day in one batch     | 13 items accepted, and every id verified present in its own table — not merely reported accepted                                                                          |
| same batch twice           | every item `duplicate`, row counts unchanged                                                                                                                              |
| out-of-order arrival       | the day shuffled with two different deterministic seeds produces **the same mileage to six decimal places**. The number an MR is paid on cannot depend on delivery order. |
| poison item mid-batch      | rejected with `outside_shift_window`; all 13 real items still commit                                                                                                      |
| capture after shift end    | rejected **and no row written** — "refused" has to mean no row, not a row with a flag                                                                                     |
| capture before shift start | same                                                                                                                                                                      |
| scope                      | the day is visible to the MR's manager and invisible to another manager                                                                                                   |
| observability              | `sync_queue_status` reports the day accurately                                                                                                                            |

**What it does not prove**, stated in the file so nobody mistakes it for the whole
gate: that the device queues correctly while offline, that the queue survives a
process kill, and that location capture stops at shift end **on the device** rather
than merely being refused on arrival.

#### What each new test proves

`manager.spec.ts` (28) and `gate1.spec.ts` (8), plus 2 added to `field.spec.ts`.

| Block                              | What it proves                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dead-letter reinstatement** (7)  | Always reversible by a manager. Attempts forgiven, history intact (`attempt_count` still 6). A blank reason is refused. The reversal is an append-only attributed row, and UPDATE on it is refused. An MR cannot do it; a manager outside the team cannot either. Something not dead-lettered cannot be reinstated. |
| **rejections explained** (2)       | Code and human sentence in the same row, with `attempts_remaining`. A reinstated item is flagged and its budget is back to 5.                                                                                                                                                                                       |
| **team activity and coverage** (6) | A manager sees their subtree and nobody else; an MR sees only themselves. **A position captured outside the shift window is never surfaced.** Per-MR detail is refused outside scope.                                                                                                                               |
| **team exceptions** (5)            | Stale sync, high rejection rate, and consent anomaly in both directions all fire. The anomaly is labelled `data_quality`. **No score, rank, percentile, grade or rating exists in any column or any returned detail object.**                                                                                       |
| **approval workflow** (8)          | A manager is offered what they may decide and never their own report; an MR is offered nothing. Forty decided in one call. One bad id does not roll back the rest, and the good one really was decided. `effective_status` is not stored. Escalation fires and stops once decided.                                  |
| **doctor search** (2 new)          | `truncated` is false when everything fits and true when it does not, with `limit` echoed.                                                                                                                                                                                                                           |

**Mutation-tested.** Six regressions — reinstatement stripped of its reason check and
its record, search capping silently, `team_activity` ignoring the shift window,
`approvable_call_reports` offering a manager their own report, bulk approval aborting
on first failure, and the consent anomaly turned into a `rank` — produced **14
failures**. Restored: 190/190.

#### Housekeeping

- **`docs/gotchas.md` created** from the handoff's failed-attempts section: git
  credential-helper precedence, `corepack` EPERM, long paths, the `env()`
  substitution trap, analytics crash-loop, the BYPASSRLS measurements, zero-row
  triggers, `convert_to` volatility, composite-return handling, TRUNCATE defaults,
  and the skipped-versus-passed distinction. Cumulative and durable.
- **`handoff.md` deleted, not committed.** A point-in-time snapshot in git is worse
  than none, because the next person trusts it.
- **`docs/spend-approval.md` revised.** The Apple Developer Program ask is
  **withdrawn** — the app is Android-only permanently, so there is no iOS build, no
  App Store probe, and **no D-U-N-S dependency**. Google Play at $25 is now the only
  store account. The original §1 is struck through rather than deleted so anyone who
  saw the first version can see it was cancelled. Nothing on the list needs a
  decision this week.

#### Contract change — Frontend

All additive. `packages/core/field/manager.ts` is new:
`SearchDoctorsResponse`, `TeamActivityRow`, `CoverageRow`, `TeamException`
(+`TeamExceptionKind`), `BulkApprovalResponse`, `OverdueCallReport`,
`ApprovableCallReport`. `SyncItemExplained` and `SyncItemReinstatement` are added to
`field/sync.ts`. Eleven new RPC paths in `API_PATHS`.

**`search_doctors` now returns `{ items, truncated, limit }` rather than an array.**
That is the one shape change; the mock serves both states.

The mock also serves an **empty exception list** under the `empty` scenario — a good
day is a state the console must render, not a loading state that never resolves.

#### Deliberately left out

| Left out                                           | Why                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Any ranking, score or leaderboard                  | Explicitly forbidden, and it would invert the meaning of the consent signal.                      |
| A fault taxonomy on rejections                     | Reviewer's decision, and the reasoning is recorded in the migration so it is not re-proposed.     |
| Manager notification or digest delivery            | Week 11. `team_exceptions` and `overdue_call_reports` are the query half; nothing sends anything. |
| Configurable exception thresholds                  | Function arguments with defaults, not configuration infrastructure. Used once each.               |
| Coverage over arbitrary date ranges in the console | `coverage(from, to)` exists; how far back the console asks is a client decision.                  |

#### Open questions for the reviewer

**1. `team_exceptions` thresholds are chosen, not derived.** No sync in 12 hours,
rejection rate above 20% over at least 5 items, consent rate 40 percentage points
from the team median over at least 3 captures. All plausible; none measured, because
there is no pilot data yet. **These will produce either noise or silence on real
data, and there is no way to know which until week 12.** Worth revisiting with the
first week of pilot numbers rather than tuning them now.

**2. The consent-rate anomaly needs at least three captures per MR and a team median
to fire.** In a small territory — one manager, three MRs — the median is noisy enough
that the signal is close to meaningless. It works at pilot scale and probably not
below it. Flagging rather than hiding.

**3. Gate 1 will slip and that is arithmetic.** The server half is done and green.
The client half needs the field app. Nothing here unblocks Frontend further.

**4. Contract I3 is now three weeks late.** Nothing in `docs/`. Pipeline design
starts week 8. This is unchanged from BE-W3 and BE-W4 and is now the single largest
schedule risk that engineering cannot resolve.

**5. Shift-window data is still missing.** Now blocking Gate 1's realism as well as
capture: the harness seeds its own window, so a real environment without one refuses
every check-in. The escalation is drafted in `claude/escalations-week3.md` and needs
a named person at the client.

---

### BE-W6 — Consent, recording and retention (15 August 2026)

Three migrations. The week's object was to make it structurally impossible to hold
audio that consent does not cover.

#### Housekeeping from the BE-W5 review

**Thresholds are configuration.** `public.app_thresholds` — key, jsonb value, unit,
scope, territory, effective date, who set it. `team_exceptions` reads them at query
time. Seeded with the values that were hardcoded, so this changed where the numbers
live and not what the system does.

_Deviation, stated:_ the table is **append-only**, not updatable. The review said "a
guess in a row costs an UPDATE"; an UPDATE would destroy the effective date and the
record of who set the previous value, which are two of the five columns asked for.
Changing a threshold is one INSERT — the same cost — and the history survives.

**Team-size floor: 8.** Below eight MRs in the comparison group, the consent anomaly
is not emitted **at all** — not a low-confidence signal, not a nulled field.

_Why eight._ The brief says a field manager oversees 8–15 MRs, so eight is the
bottom of a real team rather than a number I liked. Below it, the median is one or
two people's behaviour: at n=3 the median _is_ the middle person, and a single
outlier moves it by a third of the range. At n=8 the median sits between the fourth
and fifth values and one anomalous MR cannot drag it. It is still a small-sample
statistic and I would not defend it as more than "the point at which the comparison
group is a group".

**Bulk approve reports truncation.** `{ results, decidedCount, notDecidedCount,
submittedCount, truncated, limit }`. Submitting 250 decides 200 and says so. Same
failure as a silent cap in search — fixed in one place in BE-W5 and not the other.

**The org default shift window, and its flag.** This reverses the BE-W3 rule that a
missing window refuses every capture. The reversal is recorded in the migration
header, not just here.

- `org_default_shift_window` lives in the same config table and is **null by
  default** — with nothing configured, behaviour is exactly as before: refuse.
- A territory window always wins.
- Every capture judged against the default carries `shift_window_source =
'org_default'`, a **stored** column written server-side. Derived at read time it
  would silently change meaning the moment someone configured a territory window
  afterwards, and the point is a durable record of what the capture was judged
  against.
- Every such capture appears in `team_exceptions` under
  `org_default_shift_window`, with a count and the earliest occurrence.

`check_outs` carries the column too. The prompt named `check_ins`; a manager seeing
flagged check-ins and unflagged check-outs is looking at half the picture, and that
asymmetry gets exploited rather than noticed.

**`TranscriptV0` published** to `packages/core/field/transcript-v0.ts`, marked in a
header block as a placeholder owned by AI/ML, dated, with the reason it exists.
Provider-agnostic: `vendor` is free-form text rather than an enum, because
enumerating vendors is the decision this is waiting on, and per-word confidence is
optional so a provider that omits it still validates. **It does not close I3.**

#### The three properties

**1. No audio without consent — absent, not disabled.**

`issue_recording_upload_grant` raises for a visit with no standing consent, so there
is no grant, no key, and nothing to call. Behind it, `recordings.consent_record_id`
is NOT NULL and a trigger checks the outcome is `consented`, the visit matches, the
row is not itself a withdrawal, and no withdrawal supersedes it.

Two checks, deliberately: **the grant is a convenience and the storage policy is the
control.** `storage.objects` accepts an INSERT into the `audio` bucket only where a
live, unconsumed grant exists for exactly that key, held by that caller. There is a
test that POSTs to storage over real HTTP with a valid MR token and no grant, and it
is refused.

Object paths are opaque and server-generated:
`recordings/{uuid}/{uuid}.opus`, enforced by a check constraint. Nothing about a
doctor, a clinic or a patient — object paths leak through logs, error messages and
support tickets. Size and duration ceilings are enforced at issuance: 25 MB and two
hours.

**2. Withdrawal destroys.** See below.

**3. Nothing survives 90 days.** `purge_after` is set by trigger from
`received_at`, which is itself stamped `clock_timestamp()`. There is a test that
inserts a recording claiming to be 200 days old with a matching `received_at`, and
asserts the trigger overwrote both — a device cannot start or shorten a compliance
clock by lying about when something happened.

#### The withdrawal cascade — the decision and the reasoning

When a withdrawal row lands for a visit with a recording, the trigger destroys the
derived artifacts **in the same transaction as the withdrawal**: redacted
transcript, then raw transcript, then analyses. The audio object is marked
`purge_state = 'claimed'`, `destruction_reason = 'withdrawal'`, `purge_after = now`,
and removed by the same worker that handles retention.

**Why the object is not deleted inline.** A storage object is not a row. SQL cannot
delete one, and a `delete from storage.objects` leaves the file behind in the
backend — Supabase actively refuses it, and is right to. So the two paths share one
claim/confirm machinery, which is also what makes them safe to interleave: whichever
reaches the object first wins and the other is a no-op. There is a test that runs
both.

**Order within the cascade.** Derived artifacts first, audio last. A failure part-way
therefore leaves the audio present and findable rather than the reverse — an
orphaned analysis whose recording is gone is harder to notice and harder to explain.

**The audit row is written in the same transaction as the destruction.** The
alternative produces destructions with no record when the second write fails. A
record with no destruction is the safer failure: it claims something was destroyed
that is still present, which a reconciliation job can find and finish. The reverse is
undetectable, and undetectable is the property that matters here.

**What the log holds.** Object kind, object id, visit id, reason, timestamps, and
counts of each derived row destroyed. The storage key is **SHA-256 hashed**, and
there is no content column of any kind — a test asserts `segments`, `text`,
`transcript`, `content` and `storage_key` are all absent from the table. The audit
trail must not become the copy that survives the deletion.

**The already-read summary.** This is the part that has no clean answer.

A manager may have read the analysis days before the withdrawal arrived. That cannot
be un-read, and pretending otherwise would be dishonest in a way that matters here.
The model is: **the record shows the content existed and was withdrawn.** Not that
it never existed, and not that it is still readable.

So `visit_recording_status` returns `withdrawn` with the withdrawal date. It does not
return the content, and it does not return `none`.

_Why not silently vanish._ It is worse. A visit that quietly reverts to "no
recording" hides the withdrawal from the only person who might otherwise notice a
pattern of them — and a pattern of withdrawals in one territory, or against one MR,
is exactly the signal somebody should see. Erasing the fact protects nobody and
costs the one thing the record was for.

**Withdrawal arriving late is the normal case**, not the edge case: offline, days
later, after the analysis has run. There is a test that ages the analysis by three
days, marks it as already viewed by the MR, and then withdraws.

#### What the purge test asserts, and what it does not

**Asserts.** It creates a real object in the `audio` bucket through the storage API,
inserts a recording row pointing at it, backdates `received_at` to 91 days, runs the
**actual worker** — the same `runPurge` the CLI runs, imported rather than
reimplemented — and then asserts, over HTTP, that the object returns 404 **and** that
the row is `destroyed` with a null key.

A test that only checks the row proves the half that was never in doubt: a row delete
does not touch an object. A test that only checks a scheduled job is registered
proves nothing at all.

It also asserts: running twice is safe and produces one destruction-log row; a crash
between claim and confirm resumes on the next run; withdrawal and retention
interleave safely; the raw transcript goes with the audio; and the health function
reports a successful run.

**Does not assert.** That the job is scheduled — there is no scheduler yet, and
`audio_purge_health()` exists precisely so a stopped purge is visible rather than
inferred. It does not assert behaviour at volume: the batch limit is 100 and nothing
has been run against 10,000 expired objects. It does not assert anything about
Supabase's own object-versioning or backup retention, which is a platform question I
cannot answer from here and which could keep a copy of a "destroyed" object.

#### The redaction gate

`transcripts_raw` and `transcripts_redacted` are separate tables. The `llm_gateway`
role exists now — three lines this week, an argument in week 8 — with `select` on
the redacted table and **no grant of any kind** on the raw one, on `recordings`, on
`voice_notes` or on `consent_records`.

The test assumes the role and queries the raw table, asserting **permission denied**
rather than an empty result. This is the case where the Gate 0 amendment's
distinction genuinely bites: here the absence of a grant _is_ the control, so an
empty result would mean the control is missing and something else happened to filter
the rows.

#### What each new test proves

`consent-audio.spec.ts`, 32 tests.

| Block                      | What it proves                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **consent capture** (6)    | All three outcomes are complete successful captures. The text version comes from the server catalogue — asserted structurally, by checking `capture_consent` has no version parameter at all. An unknown language is refused. Replay does not overwrite an outcome.                                                                         |
| **the path is absent** (8) | No grant for `declined`, `not_asked`, or no record at all. A granted key is opaque and contains no doctor, clinic or patient string. Unbounded size and duration are refused. A `recordings` row is refused with a non-consented reference, with no reference, and with a non-opaque path.                                                  |
| **storage policy** (3)     | A real HTTP POST with a valid token and no grant is refused; with a grant it succeeds; the bucket is private.                                                                                                                                                                                                                               |
| **redaction gate** (4)     | `llm_gateway` gets permission denied on raw, can read redacted, holds no privilege on four sensitive tables, and the two tables are genuinely separate.                                                                                                                                                                                     |
| **withdrawal** (7)         | Every derived artifact destroyed; the object marked immediately with `purge_after` now rather than in 90 days; the log records counts and a hashed key and has no content column; the manager sees `withdrawn` with a date; a late withdrawal after analysis works; and afterwards neither a new recording row nor a new grant is possible. |
| **retention** (6)          | The object is gone from storage as well as the row; the clock is the server's; twice is safe; a crash resumes; withdrawal and retention interleave; health is reported.                                                                                                                                                                     |

Plus 2 in `manager.spec.ts` for bulk truncation, and the reworked consent-anomaly
tests around the floor.

**Mutation-tested.** Nine regressions — consent trigger dropped, cascade emptied,
raw table granted to the gateway, storage policy opened, retention counted from the
client clock, grants issued without consent, the manager view hiding withdrawals, the
destruction log storing the key in the clear, and bulk approve capping silently —
produced **20 failures**. Restored: 229/229.

**One gap the mutation run found in my own work:** I had built bulk-approve
truncation with no test for it. Mutation 9 passed silently until I noticed nothing
went red for it. Two tests added.

#### Contract change — Frontend

Additive. `TranscriptV0`, and `my_shift_window()` now returns `source` alongside
`window`, so the app can say "these are the organisation's default hours, not your
territory's". `search_doctors` and bulk approve shapes were covered in BE-W5 and
BE-W6 respectively.

Nothing removed.

#### Anything I was asked to build that I think is wrong

**Nothing in the brief is wrong.** Two things I would flag rather than object to:

**The org-default flag is only as loud as whoever reads it.** I have made it a stored
column and a first-class exception, which is what was asked. But an exception nobody
opens is a log line with extra steps, and the console that displays these does not
exist yet — it is Frontend's week 11. Between now and then, the flag is real and
invisible. If the pilot starts before the console does, the strict rule is safer than
the flag.

**Publishing `TranscriptV0` reduces the pressure on AI/ML at exactly the wrong
moment.** It unblocks me, which is why it was right, and it also removes the most
visible symptom of a three-week-late contract. I have marked it a placeholder in the
strongest terms I can put in a file, but a placeholder that works is a placeholder
that stays. Worth a calendar reminder rather than trusting the comment.

#### Open questions for the reviewer

**1. Supabase may keep a copy of a "destroyed" object.** The purge deletes through
the storage API and I have verified the object 404s afterwards. What I cannot verify
from here is whether the platform retains it in backups, object versioning, or a
soft-delete window. For a 90-day retention promise made on privacy grounds, that is
the difference between the promise being true and being approximately true. **This
needs an answer from Supabase before the pilot**, and it is not an engineering task.

**2. `voice_notes` are purged at 90 days too, and nobody asked for that.** They are
audio, they are covered by the same reasoning, and the alternative — keeping the MR's
own voice indefinitely — seemed worse. But the voice note involves no third party and
no consent, so a different retention could be defended. Flagging because I chose it.

**3. The purge has no scheduler.** `audio_purge_health()` exists so that a stopped
purge is visible, but nothing runs the worker. It needs a cron — Supabase's
`pg_cron` calling an edge function, or an external scheduler — and that is a
deployment decision I should not make unilaterally. **Until it is scheduled, the
90-day promise is a script somebody has to remember to run.**

**4. Contract I3 is four weeks late.** `TranscriptV0` unblocks week 8's design. The
vendor decision and the measured Hinglish word error rate are still outstanding, and
those are what decide whether the AI layer ships at all.

**5. Shift-window data.** Now less urgent, because the org default exists — which is
exactly the risk the reviewer named. The flag is the mitigation; somebody still has
to collect the real hours.

---

### BE-W7 — Upload path, purge scheduling, adverse-event ingest (16 August 2026)

Five migrations. The week's object was to make the retention promise self-enforcing,
make an upload survive an Indian mobile network, and build only the part of the
adverse-event path that no sign-off can change.

#### 1. The purge is scheduled — GitHub Actions, and why not `pg_cron`

**The 90-day promise was false, not approximately true.** A worker nobody runs is not
a control, and `audio_purge_health()` reporting a stopped purge to nobody was the
same problem one level up. Both halves ship.

**Chosen: two scheduled GitHub Actions workflows.** `retention.yml` runs the existing
worker daily at 01:00 IST; `retention-watchdog.yml` checks health seven hours later,
as a **separate workflow** — a watchdog sharing a job with the thing it watches dies
with it and reports nothing.

**`pg_cron` was the recommendation and I did not take it.** Both extensions are
genuinely available — measured, not assumed: `pg_cron` 1.6.4 is in
`shared_preload_libraries` and `CREATE EXTENSION` succeeds, `pg_net` 0.20.4 is
already installed. Three reasons:

1. **`pg_net` is asynchronous.** `net.http_delete()` returns a request id; the
   response lands in `net._http_response` later. The purge protocol is claim →
   delete the object → confirm, and confirming is only sound _after_ the delete is
   known to have succeeded. A `pg_net` worker either confirms blindly — which
   destroys the single guarantee the design has — or needs a second pass reading
   responses, which is a different worker with different bugs.
2. **The Edge Function route means a second implementation** of a compliance-critical
   worker, in a second language. The existing one is already driven by the suite
   directly rather than reimplemented, and already mutation-tested.
3. **The local stack runs no edge runtime**, so an edge-function purge could not be
   exercised by the tests at all. A compliance control the suite cannot reach is
   precisely what this project has repeatedly refused to ship.

**Where the health signal actually goes: a failed GitHub Actions run**, which mails
whoever watches the repository. That is crude. It is also real and available now,
where the console that should display it is Frontend's week 11.

**The cost, stated.** A workflow lives in the repository, not next to the data. If
Actions is disabled or the repository moves, both jobs stop and the database does not
know. So there is a third layer that **cannot be switched off**:

> **`begin_upload` refuses new audio once objects are past their purge date.**
> If retention has stopped, intake stops.

That is on the write path, in the database. A stopped purge degrades into a refusal
to take in more audio rather than into a silent breach. It is deliberately expressed
as "an object that should already be gone is still here" rather than "no successful
run recently" — on a fresh database there has never been a run and nothing is
overdue, and that is healthy.

**Until the three deployment secrets exist, both workflows fail every day.** That is
the accurate report, not a bug: nothing is enforcing the retention promise until they
are set. Skipping quietly would recreate the exact gap this closes.

#### 2. Resumable upload — the grant covers the whole object

**The contradiction.** BE-W6 made the grant single-use and short-lived. A resumable
upload is long-lived by definition. The prompt was right that these cannot both hold
unless the design says which.

**The decision: one grant per object, re-validated on every resume and every chunk.**

Not a grant per chunk. A grant is permission to write **one object at one key**, and
the key is unique — a per-chunk grant would re-issue the same key repeatedly, which
makes "single-use" meaningless rather than stricter. What single-use has to mean here
is that the grant is consumed at **finalisation**, not at first byte.

So the lifetime is two clocks:

|                   |                                                                         |
| ----------------- | ----------------------------------------------------------------------- |
| `expires_at`      | Slides forward on each chunk. A stalled upload dies in fifteen minutes. |
| `hard_expires_at` | Fixed at issue, twenty-four hours. The sliding clock can never pass it. |

Without the ceiling, a device that heartbeats forever holds a permission forever.
Twenty-four hours covers the real case — record at 11am in a corridor, reach signal
at the office at 7pm — and nothing longer is defensible for audio a doctor consented
to minutes ago.

**Consent is re-read at every resume and every chunk**, and the check runs **first**,
before the session-state and clock checks. That ordering is not cosmetic: the
withdrawal cascade sets the session to `revoked`, so a state-first ordering tells the
MR "this grant is revoked" — true, useless, and it maps to `validation_failed`, whose
sentence is _"the server refused the contents of this item"_. The MR would be told
their recording was malformed when the doctor simply changed their mind. Found by a
test asserting the rejection code rather than only the refusal.

**Resume works after the app was killed, not only after a dropped socket.** The
device that has lost everything calls `begin_upload` again and gets the same session,
the same key and the server's byte count back. There is one open session per visit
per kind, enforced by a partial unique index, so that question has exactly one
answer. A resume token in local storage dies with the process; this does not.

**A partial upload is an object, not scratch.** It occupies storage, it may contain
audio, and if the visit was abandoned there is no recording row binding it to a
consent record at all. It is destroyed by the **same worker through the same
claim/confirm machinery**, and it counts toward the per-MR storage ceiling while it
exists — reserved at its declared size, because a ceiling that only counts what
already landed lets a device open two hundred sessions and walk straight through it.

Bound on how long an abandoned object survives: the 24-hour hard ceiling plus one
purge interval, so 48 hours worst case.

**A gap I found by checking that everything built this week is actually called by
something.** A session the MR never returns to stays `open` — nobody abandons it, the
clocks just run out — and the purge only claims partials that are `abandoned` or
`revoked`. `begin_upload` closes a stale session only if the same MR asks for the
same visit again, which by definition they did not. So the object would have sat in
the bucket indefinitely, past its retention date, with nothing claiming it. The
retention worker now calls `close_stale_upload_sessions()` first on every run. This
is the same class of mistake as BE-W6's unscheduled purge: a function that works, and
that nothing invokes.

#### 3. The queue — one mechanism, not two

`recording` and `voice_note` were declared in the BE-W4 sync enum and refused by
`apply_sync_item` until the storage layer existed. This is that layer, so **an upload
is now an ordinary queue item** and inherits per-item isolation, attempt counting,
dead-lettering and BE-W5's attributed reinstatement unchanged. Nothing was
re-implemented.

Two new rejection codes, both reachable in ordinary use: `consent_withdrawn` (the
doctor withdrew while the device was offline) and `upload_expired` (the finalisation
synced after the hard ceiling). Both would otherwise have landed as
`validation_failed`, which is untrue and unactionable for both.

**A third, `storage_ceiling_exceeded`, was drafted and then removed.** The ceiling is
checked in `begin_upload`, which the client calls interactively because it needs the
key before sending a byte, so that refusal reaches the caller directly and never
travels through the queue. A rejection code no code path can produce is a vocabulary
entry that looks like coverage and is not. There is now a test asserting every code
in the enum has an explanation sentence.

#### 4. Post-restore reconciliation — what it covers, and what it cannot

A restore rewinds **the database** and not **the objects**. The prompt named one
direction; there are two, and the second is worse.

| Direction              | What it means                                                                                                                                         | What the reconciliation does                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Row without object** | The database thinks it holds audio. Storage does not have it. A withdrawal may have been erased with everything else.                                 | Marks the row destroyed as `restore_reconciled`, removes derived transcripts and analyses, logs it — **and quarantines the visit**. |
| **Object without row** | An upload that completed after the restore point; the object stayed, its row went back. **Audio held with no consent record and no retention clock.** | Destroys the object and records the finding.                                                                                        |

The second is a live breach rather than a stale row, and nothing else in this system
would ever have noticed it.

**`storage.objects` cannot answer either question** — it is a table in the same
database and was rewound too. The worker walks the object store over HTTP, which is
the only witness that did not travel back.

**It does not fabricate the withdrawal.** The consent row, the destruction-log row
and `withdrawn_at` all lived in the database and all went back together; the only
surviving trace is the object's absence, and absence cannot distinguish a withdrawal
from an ordinary ninety-day purge. The ledger's entire value is that every row in it
is a real thing a real doctor really did, and an inferred row would be
indistinguishable from a genuine one forever afterwards. So the visit is
**quarantined** — no upload grant is issued, and a named person clears it with a
mandatory reason, recorded append-only. A blocked recording is recoverable; an
un-withdrawn consent is not.

**The quarantine is on the visit, not the doctor.** The doctor is the safer scope and
is recorded on the finding for that reason, so widening it is one insert. But a
missing object can also be an ordinary storage fault, and blocking every future
recording for a doctor on that evidence turns a possible compliance question into a
certain outage across their territory. That trade is stated rather than hidden.

**What it cannot do**, in `docs/restore-runbook.md` and repeated here:

- Recover a withdrawal, for the reason above.
- Tell a restore artifact from an ordinary storage fault. Everything errs toward denial.
- See an object the store has not yet made visible, if the listing is eventually
  consistent. Run it twice, an hour apart, after a recent restore.
- Say anything about **Supabase's own infrastructure** — S3 versioning, soft-delete
  windows, sub-processor retention. Not in the public docs. **A DPA question, not an
  engineering one.**

`docs/restore-runbook.md` states plainly that a PITR restore on this project is a
compliance event requiring this routine, and is dry-run by default: a tool that
destroys audio the first time somebody runs it to see what it does is not a
compliance tool.

#### 5. The org default shift window now expires

Mandatory `expiresAt` inside the config value, ceiling of 60 days from
`effective_from`, enforced by a trigger at configuration time. After expiry the
default stops applying and capture refuses again — the strict BE-W3 rule, back
automatically, with nobody needing to remember.

Measured against `effective_from` rather than `now()` deliberately: a rule expressed
against `now()` has no legal way to write an already-expired row, and therefore no
way to test the expired branch at all.

A default carrying **no** expiry — one configured before this migration — is treated
as expired rather than as permanent. The unsafe reading of missing data is the one
that keeps capture flowing.

`is_within_shift` now distinguishes "no window configured anywhere" from "the stopgap
ran out", because those need different actions from different people and an MR told
the wrong one raises the wrong ticket. `org_default_shift_window_status()` exposes the
deadline before it bites.

**Worth recording: the org-default path had no test at all before this week.** BE-W6
built it and described it; nothing exercised it. Both sides of the boundary are now
covered.

#### 6. `TranscriptV0` has a hard expiry

`packages/core/src/field/transcript-v0.expiry.test.ts` fails after **30 September
2026** unless a `TranscriptV1Schema` is exported. The failure message names contract
I3, names AI/ML as its owner, states what is still owed, and gives exactly two honest
ways to make it pass — publish V1, or move the date deliberately in a one-line diff
with somebody's name on the commit. A second test asserts `TranscriptV0Schema` still
exists, so the guard cannot pass vacuously if the placeholder is renamed away.

#### 7. `voice_notes` retention — the reasoning replaced

Kept at 90 days; the symmetry argument is gone. The comment now says what is actually
true: a voice note summarising a consultation **can name a patient the doctor
discussed** — the same DPDP exposure as the recording — and unlike the recording
**nobody consented to it at all**, because the doctor agreed to the conversation
being recorded, not to the MR's commentary about it. It is also an employee's voice
held by their employer. Anyone arguing for longer retention now has to beat a privacy
position rather than a consistency preference.

#### 8. Adverse-event ingest — the mechanical half

Built: the record and its immutability, the statutory clock, and routing to a human.

**Append-only against every role**, including `admin` and `service_role` — a
statement-level trigger plus revoked privileges, the same two independent layers as
`consent_records` and `audit_log`.

**The clock starts at ingest.** `received_at` and `statutory_due_at` are both stamped
by trigger; a test inserts a report claiming to be 200 days old with a matching
receipt and asserts the trigger overwrote both. Fifteen calendar days, computed in a
**pinned Asia/Kolkata**: calendar arithmetic on a `timestamptz` uses the session
timezone, so the same insert could otherwise produce two different deadlines on two
connections. India observes no DST, so today the pinned and session answers agree —
pinning means they cannot stop agreeing because somebody changed a server setting.

**Routing is to a human, and this is tested as an absence.** There is no severity,
priority, triage state, confidence, score, category or causality column. A test
asserts thirteen such names are absent, so the next person who wants one has to
delete a test to get it. The `llm_gateway` role holds nothing here at all.

**The clock is countable from day one.** `adverse_event_clock` and
`adverse_event_clock_summary()` exist now rather than when somebody asks, because the
thing that gets missed is a deadline nobody was counting.

#### What I was told not to build, restated

So the next reader knows the absence is deliberate:

- **Who the PV officer is.** Not modelled. The role does not exist in this database
  and the 12 August decision records that it may never.
- **The notification channel.** Nothing pushes an adverse event anywhere. Plan §1's
  one-way endpoint into the clinical PV queue is not built.
- **What happens at day thirteen**, or any escalation ladder. There is no state
  machine on an adverse event at all — no acknowledged, no assigned, no closed.
- **Any assumption about org structure.** No routing rules, no on-call, no owner.

All four wait on the PV and privacy sign-off outstanding since week 1. Guessing them
produces a compliance artifact built on an invention, which is worse than an
obviously incomplete one.

Also not built, and also deliberate: `pg_cron` scheduling (§1), a second upload
mechanism for the queue (§3), and any widening of the reconciliation quarantine to
the doctor (§4).

#### Anything I was asked to build that I believe is wrong

**Nothing in the prompt is wrong.** Four things I would flag rather than object to,
and one thing I got wrong myself.

**1. The `reported_text` column decides a question the sign-off was meant to decide.**
An MR who witnesses an adverse event must be able to describe it — a report with no
description discharges no duty — but it is the one field here that can carry patient
information, which is exactly the §2.6-versus-DPDP contradiction nobody has resolved.
I included it and flagged it, because omitting it would have decided the question
silently by making the feature useless. **This is the single most important thing for
the sign-off to rule on**, and it is now shipped rather than pending.

**2. Whether an adverse-event report survives a consent withdrawal is a legal
question I answered by default.** It does survive: a pharmacovigilance duty is a
separate legal basis from consent, and destroying a statutory record to satisfy a
privacy request is not a trade a schema should make on its own. That is the safe
default and it is still a default.

**3. The retention watchdog's destination is a mailing list, effectively.** A failed
Actions run reaches whoever has notifications on. That is a real human, and it is also
the weakest link in the chain — it will be ignored within a month of the pilot unless
the week-11 console picks it up. The database-side intake block exists because I do
not trust this layer.

**4. The 24-hour upload ceiling is a guess about Indian mobile networks.** It is
generous enough for a full working day offline and short enough that an abandoned
object is bounded. I have no field data behind it, and it is the number most likely
to need changing after the pilot. It is a constant in one function, not a threshold
row, because making it configurable before anyone has an opinion is the speculative
abstraction the project rules forbid.

**5. My own mistakes, recorded.**

- I wrote the adverse-event transcript pointer as `references transcripts_redacted
(id) on delete set null`, which made **every consent withdrawal fail** — `SET NULL`
  is an UPDATE, and the table is append-only. Seven BE-W6 withdrawal tests went red
  pointing at a table BE-W6 has never heard of. Caught by the existing suite on the
  first run, not by review.
- **A test of mine passed when it should have failed.** The hard-ceiling test
  asserted that the sliding clock and the ceiling ended up _equal_, which a mutation
  that raised both of them satisfied while destroying the property entirely. The
  ceiling being **immovable** is what matters, and nothing asserted it. Mutation 3
  found it; two assertions now do. This is the second time the harness has caught a
  gap inside my own test rather than in the code under test, and it is the reason the
  mutation pass is worth its cost.
- **`close_stale_upload_sessions()` was written, tested, and called by nothing.** An
  upload the MR never returned to would have kept its object forever. Found by
  checking that every function built this week is actually invoked — which is the
  same check that would have caught BE-W6's unscheduled purge a week earlier.

#### What each new test proves

`upload.spec.ts` 35, `retention-ops.spec.ts` 25, `adverse-events.spec.ts` 23.

| Block                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **the session** (8)       | Two clocks, with the hard ceiling immovable by either a chunk or a resume; the same key comes back after an app kill; the server's byte count is authoritative; bounds are validated before a session is resumed; one open session per visit and kind.                                                                                                                                                                                                                                                 |
| **consent in flight** (4) | A withdrawal stops a resume, stops a chunk, stops a finalisation, and revokes the session in the same transaction as the withdrawal itself.                                                                                                                                                                                                                                                                                                                                                            |
| **writing chunks** (5)    | A second write to the same object succeeds while the session is open and is refused after finalisation; an MR can read their own in-flight upload, cannot read their own landed recording, and can never read anybody else's.                                                                                                                                                                                                                                                                          |
| **finalising** (4)        | The recording is created and the grant consumed; a resend is idempotent; a size that does not fit the grant is refused; the retention clock is the server's.                                                                                                                                                                                                                                                                                                                                           |
| **partials** (4)          | An abandoned partial's OBJECT is destroyed over HTTP, logged with a hashed key as `abandoned_upload`; a revoked one is logged as `withdrawal`; a stalled session is closed; **an upload the MR simply never came back to is collected too**.                                                                                                                                                                                                                                                           |
| **ceilings** (3)          | An in-flight upload reserves against the ceiling; the ceiling refuses; **a stalled retention worker refuses new audio**.                                                                                                                                                                                                                                                                                                                                                                               |
| **the queue** (7)         | A recording round-trips through `sync_push`; a withdrawal and an expiry each get their own code and their own sentence; the queue shows state, percentage and a reason; dead-lettering and manager reinstatement work unchanged; every code in the enum has an explanation.                                                                                                                                                                                                                            |
| **scheduling** (8)        | Both workflows declare a five-field cron and run the right script; the watchdog is a separate file that does not run the purge; both fail rather than skip with no database; the verdict is quiet on a fresh system, fires on overdue objects, fires when the worker never ran, and fires _before_ anything goes overdue.                                                                                                                                                                              |
| **shift expiry** (6)      | No expiry is refused; over 60 days is refused; an expiry before it starts is refused; null still switches it off; it applies and is flagged before expiry; after expiry resolution returns nothing and capture refuses with a message naming which problem it is.                                                                                                                                                                                                                                      |
| **reconciliation** (9)    | A dry run changes nothing; a missing object re-applies the destruction as `restore_reconciled`; **no withdrawal is fabricated**; the visit is quarantined and blocks new audio; clearing needs a manager, a reason and leaves an append-only record; an orphan object is destroyed; an in-flight upload is left alone; a delete of an already-gone object is success; findings cannot be edited.                                                                                                       |
| **adverse events** (23)   | Ingest is attributed and idempotent; the pipeline path is closed to the field; the clock is the server's, is exactly fifteen days, and survives a hostile session timezone; append-only against the owner, against a zero-row update, against truncate, and with no privilege for `service_role`; thirteen judgement column names are absent; the gateway is denied rather than filtered; an MR sees their own reports and not the pipeline's detections; the transcript pointer is not a foreign key. |

**Mutation-tested.** Twelve regressions, applied one at a time to a freshly reset
database, suite run, then reverted. **All twelve were killed — 32 failures in total.**

| #   | Guard removed                                     | Tests that went red |
| --- | ------------------------------------------------- | ------------------- |
| 1   | Consent no longer re-read at resume or chunk      | 4                   |
| 2   | Withdrawal no longer revokes a session in flight  | 3                   |
| 3   | The hard ceiling can be pushed forward by a chunk | 1                   |
| 4   | The purge no longer collects partial uploads      | 3                   |
| 5   | Storage read opened to any authenticated caller   | 2                   |
| 6   | An expired org default keeps applying             | 1                   |
| 7   | The 60-day ceiling and mandatory expiry dropped   | 3                   |
| 8   | The AE statutory clock takes the device's word    | 3                   |
| 9   | `adverse_event_reports` made mutable              | 5                   |
| 10  | The reconciliation stops quarantining             | 3                   |
| 11  | A stalled purge no longer blocks intake           | 2                   |
| 12  | Stale upload sessions never closed                | 2                   |

**The first run of this battery was the point of running it.** Mutation 3 killed
**nothing** — see "my own mistakes" above. The number in that row is what it kills
now, after the test was fixed to assert the property that actually matters.

#### Contract change — Frontend

**Additive, with one correction.**

- `UploadSession` gains **`state`** and **`hardExpiresAt`**. It already existed in
  `endpoints.ts` — contract I1 declared the week-7 shape back in week 2 — and was
  extended rather than duplicated. Both fields are things a client must show an MR:
  `expiresAt` slides on every chunk, so it is a heartbeat timeout rather than a
  deadline, and a session can be revoked underneath the device when the doctor
  withdraws.
- New: `UploadKind`, `UploadSessionState`, `UploadQueueItem`, `VisitAudioQuarantine`,
  `AdverseEventSource`, `AdverseEventReport`, `AdverseEventClock`,
  `AdverseEventClockSummary`.
- **Correction in the mock, not the contract:** the `uploadSession` fixture's
  `storageKey` was `recordings/2026/08/10/66666601.opus`. The real server enforces an
  opaque server-generated path with a check constraint, and would refuse that key —
  a path that encodes anything leaks through logs and support tickets. The fixture
  now uses the real shape.

Nothing removed.

#### Open questions for the reviewer

**1. The `reported_text` question above is the blocker for week 8 onward**, not just
for this table. Every downstream stage — redaction, detection, routing — inherits
whatever is decided about what an adverse-event record may contain.

**2. Contract I3 is now five weeks late** and has a CI deadline of 30 September.
`TranscriptV0` still does not close it; the vendor decision and the measured Hinglish
word error rate are what decide whether the AI layer ships at all.

**3. The DPA question is unchanged and still not an engineering task.** Whether
Supabase retains a "destroyed" object in S3 versioning, a soft-delete window or a
sub-processor's backup is not in the public documentation. The purge and the
reconciliation both do what they claim at the API level; below that I cannot see.

**4. Nothing tells anybody a visit is quarantined.** The MR sees it through their own
queue and a manager can query it, but there is no alert. Same shape as the BE-W6
org-default flag: real, and invisible until the console exists.

**5. Volume is still untested.** The purge batch limit is 100 and the reconciliation
walks the bucket one prefix at a time — O(objects) HTTP requests. Neither has been run
against ten thousand objects, and the reconciliation is the one that would hurt.

---

### BE-W8 — Operational readiness (14 August 2026)

Not pipeline orchestration — nothing exists yet to orchestrate (no speech vendor, no
redaction engine, `TranscriptV0` is a placeholder). This week is everything that has
to be true before anyone records anything: the deployment made real, the assumptions
measured instead of trusted, and the dates in this file made to mean one thing.

#### 1. The control that was a habit, made a guard

**`verify:rollbacks` drops the entire public schema and took its target from
`SUPABASE_DB_URL` with no check.** `.ai-collab/handover.md` documented the hazard
three times, in escalating language, and every mitigation offered was a rule for a
human to follow — "never export the remote URL in a shell where this runs." A rule a
person has to remember is not a guard.

`assertLocalhostOnly()` now refuses to open a connection unless the host resolves to
`127.0.0.1`, `::1` or `localhost` — no `--force`, no environment escape hatch. Caught
one bug building it: `new URL(...).hostname` keeps the brackets on an IPv6 literal
(`[::1]`), so the naive comparison would have refused a genuinely-local IPv6 URL as
if it were remote. A test asserts the guard **allows** `[::1]`, not only that it
refuses a remote host — the allow-path is what would have shipped broken.

**`reconcile-after-restore.mjs --apply`** got the same treatment: it now refuses to
run without `--db-url` given explicitly on the command line, rather than inheriting a
possibly-stale `SUPABASE_DB_URL` from the environment. Dry runs are unaffected — they
destroy nothing, so the environment fallback is harmless there.

Both proven with a test asserting the refusal fires against a fake remote-looking
URL, and separately by running the real `verify:rollbacks` against the local stack —
all 17 (now 18) migrations reversed to an empty public schema, then the database was
reset back.

#### 2. The deployment made real

**The three GitHub secrets are set** (`SUPABASE_DB_URL` from
`SUPABASE_POOLER_SESSION_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from
`SUPABASE_SECRET_KEY`), piped directly from `.env` into `gh secret set` via stdin —
never written to a shell argument, history, or a session transcript.

**The schedule was checked, not predicted — and the check itself found a stale
claim.** `handover.md` asserted twice, in two separate sessions, that no scheduled
run had ever fired. Both assertions were already false by the time this was checked:
`gh run list --workflow="Audio retention" --json event,createdAt,conclusion` showed
the cron had been firing daily and failing (missing secrets) for two days. This is
now the standing rule for `.ai-collab/`: **any claim of the form "X has never
happened" carries the command that re-checks it, next to the claim** — see
`docs/gotchas.md`.

`Audio retention` was then dispatched by hand and went **green** — the first
successful run since the secrets landed. The subsequent scheduled watchdog run
(nominally `03:00` UTC, actually fired `04:46` UTC — GitHub Actions cron jitter, not
a bug) also went green, now that a successful purge run existed for it to find.

**Read this run correctly: it proves the wiring, not the retention path.** Credentials
resolve, the pooler is reachable, `claim_expired_audio` exists on the remote. It
proves nothing about destruction, because the database held no recordings and nothing
was past its purge date. That is not yet true end-to-end.

**Corrected, same day.** The sentence originally here said "tonight's `19:30` UTC
run is ~13 hours out" — stale reasoning written _after_ the cron had already moved to
hourly earlier in the same session, still thinking in terms of the schedule that no
longer existed. Checked directly (`gh run list --workflow=retention.yml
--json event,createdAt,conclusion`): the hourly cron never actually fired before the
workflow was disabled (see §7). The correct statement was "the next run is within the
hour," not thirteen hours, and not "already fired several times" either.

**Proven, not predicted, after §7's fix shipped and both workflows were re-enabled:**
`Audio retention` fired on its own hourly cron — `event: schedule`, not
`workflow_dispatch` — at **08:55:45 UTC, 14 August**
([run 31785943559](https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App/actions/runs/31785943559)).
Green in 22s: claimed 0, destroyed 0, failed 0 (empty database — expected).
`check-purge-health` ran in the same job immediately after and reported
`"stalled": false` from the **new backlog-based function**, so this is the whole
chain proven end to end, not just the migration verified in isolation. The watchdog's
first post-re-enable fire is the one piece still outstanding as this line was
written.

#### 3. Seeding — infrastructure only, not data

**No organisation name, territory, doctor, or consent-text copy was fabricated into
this repo**, and none was seeded onto production. `handover.md` is explicit: creating
org/territory/doctor rows on production just to test pollutes an append-only audit
log permanently. `services/api/scripts/seed-reference-data.mjs` is the tool —
idempotent by construction (deterministic per-row ids from a stable key in a
separately-supplied data file, `ON CONFLICT (id) DO NOTHING`), dry-run by default,
`--apply` requires `--db-url` explicitly — and it was tested only against the local
stack with an obviously-synthetic fixture (`OBSOLETE_TEST_FIXTURE`), never against
production, because there is no real data yet to run it with.

**Territory shift windows are untouched by the tool on purpose.** Capture must keep
refusing until the client's real per-territory hours arrive.

**The `audit_log` decision, stated plainly:** `territories`, `doctors` and
`consent_text_versions` each carry an unconditional `AFTER INSERT` trigger that fires
for every writer including `service_role` — `BYPASSRLS` skips RLS policies, not
triggers. Seeding through this script therefore writes real, permanent `audit_log`
rows, with `actor_id`/`actor_role` both null (no JWT behind a direct connection).
This is not suppressed, and cannot be without disabling the trigger — exactly the
kind of guard-that-can-be-switched-off `constraints.md` rules out. Read plainly: the
audit trail will correctly show that a system process inserted these rows.
`organisations` carries no audit trigger, so organisation inserts write nothing.

#### 4. Volume — measured, and the retention schedule was wrong

**Answers BE-W7's open question 5.** Two numbers were measured locally, not assumed:

- **Purge, 5,000-object backlog:** drained in 50 runs of ~591ms each at the existing
  batch of 100 (storage_key null, isolating DB-side claim/confirm from the network
  call). **The database was never the constraint.**
- **Storage DELETE round-trip:** avg 8ms/object (existing), 5ms/object (already-gone)
  — a local-loopback floor, not a production number, but it confirmed the same thing
  from the other side: the per-object cost is small.
- **`sync_push`:** 29ms for a realistic 48-item batch (8 visits/day × ~6 items),
  179ms for 500 items. Neither holds the transaction long enough to be a concern at
  these volumes; the real question — 100 MRs syncing concurrently against a session
  pooler — is a connection-count question, not a transaction-duration one, and is not
  this week's work.

**The finding that mattered: the daily cron was under-provisioned by roughly 16x, on
day 91, by arithmetic rather than by accident.** Against the plan's own stated pilot
size — 100 MRs × 8 visits/day, each visit producing a doctor recording and an MR
voice note — audio arrives at ~1,600 objects/day. At day 90 those start expiring at
the rate they were created. A daily cron at batch 100 drains 100/day. The database
proved it could do 5,000 rows in 30 seconds; the schedule only let it try once every
24 hours.

**`begin_upload` refusing new audio when the purge stalls is the right design** — an
availability failure beats a compliance failure — but the failure mode this exposes
is every MR in the fleet losing the ability to record, simultaneously, three months
into the pilot, discovered in production rather than provisioned for.

**Resized, not just documented:**

|                               | Before               | After                                             |
| ----------------------------- | -------------------- | ------------------------------------------------- |
| `retention.yml` cron          | daily, `30 19 * * *` | hourly, `0 * * * *`                               |
| Effective drain rate          | 100/day              | 2,400/day (1.5x headroom over ~1,600/day arrival) |
| `retention-watchdog.yml` cron | daily, `0 3 * * *`   | hourly, `15 * * * *`                              |
| `purge_max_silence_hours`     | 48                   | 3                                                 |

The threshold change is migration `20260817000100_retention_schedule_resize.sql` — a
new `app_thresholds` row, not an edit; the table is append-only. Its rollback cannot
`DELETE` the row (`reject_mutation` blocks that for every role); the row is cleaned
up only when the earlier thresholds migration's rollback drops the table entirely,
which is documented in the rollback file rather than silently assumed. **Applied to
production** and verified: `select public.threshold('purge_max_silence_hours')`
resolves `3`.

**Hourly rather than a bigger daily batch, deliberately:** a failed run costs an hour
of drain instead of a day, and the blast radius per run stays small — more forgiving
of the kind of environmental failure this project has already hit twice (the secrets
gap, the IPv6 direct-connection trap).

**Made the pattern this exposed structural, not remembered.** Tightening the
threshold turned two already-committed test fixtures
(`consent-audio.spec.ts`, backdated 1 day, safe under the old 48h bar) into a
cross-file race: any test running concurrently on the shared local database would
observe the tightened global stall check trip. Fixed with a named constant,
`OVERDUE_NOT_STALLED_MINUTES` in `services/api/tests/db.ts`, with pointers left at
the two legitimate large-backdate sites (which simulate a stalled worker
deliberately, safe only because they run inside a rolled-back transaction) so the
convention is discoverable from either direction. A gotchas entry is not a fix for
something that recurs by construction; this is.

#### 5. Backups — decided

**Do not buy PITR.** Daily backups (Pro plan default) plus `docs/restore-runbook.md`
is the right posture. A restore on this project is a documented compliance event
that can un-withdraw a consent — that is the entire reason the runbook and
`reconcile-after-restore.mjs` exist. Paying for finer-grained restore points buys
more of the exact thing the design already defends against. Recorded in
`.ai-collab/decisions.md` with the reasoning; the ~$100/month figure that prompted
the question is dated 11 August and explicitly flagged there as unverified — the
decision does not depend on the exact number.

#### 6. The calendar

Every date in this document, and in `.ai-collab/`, is now the real date. Sprint
labels (`BE-W8`) stay as labels. The project-calendar offset that `.ai-collab/`
previously carried is retired going forward — see the correction note in
`.ai-collab/handover.md` rather than silently rewriting the earlier entries.

#### Calls this prompt got wrong, or that I'd push back on

- **§1.2 as originally scoped** ("decide whether `--apply` should also require the
  target on the command line") was under-specified into "explicit, not localhost-only"
  by the reviewer mid-week; the distinction mattered because
  `reconcile-after-restore.mjs` is meant to run against production, so a localhost
  guard would have broken its actual job.
- **The retention-watchdog cadence and threshold were not asked for explicitly** —
  only `retention.yml`'s cron and "the watchdog thresholds if they assume a daily
  cadence" were named. Moved both anyway: a watchdog checking daily against an hourly
  worker would miss a stall for up to 23 hours even after the 3-hour threshold fires,
  which defeats the point of tightening the threshold at all.

#### Open questions for the reviewer

**1. `sync_push` at real concurrency (100 MRs at 6pm against a session pooler) is
unmeasured.** The single-transaction timing measured this week (179ms at 500 items)
says nothing about connection-pool exhaustion under concurrent load, which is the
actual risk at pilot scale.

**2. PV/privacy sign-off, contract I3, the DPA question and the org-default shift
window deadline are all unchanged from BE-W7** — none of this week's work touched
them, and none of them got closer to resolved.

**3. Two items accepted and deliberately deferred, not forgotten** — the
`.ai-collab/` handover/handoff split, and a runbook step or workflow for production
migrations (two hand-run `db push` calls this week, no audit trail yet). Both are
cheap and real; neither is worth another backend week ahead of FE-W1. See §7.

---

#### 7. Addendum, same day — the stall check measured the wrong property

The reviewer's follow-up on §4 found four things. Three held up; correcting the
fourth openly rather than letting it stand.

**The 3-hour stall threshold was genuinely dangerous, and is fixed.**
`audio_purge_is_stalled()` tripped on a **single object** overdue by more than the
threshold — that conflates "the worker is dead" with "the worker is alive but
briefly behind on a busy hour." With an hourly cron and a 3-hour bar, two consecutive
GitHub Actions scheduling delays of the size already observed (1h46m on a real run)
were enough to trip it, refusing new audio for **the entire fleet**. Redefined into
two separated signals:

|                                           | Meaning                                                                                     | Value        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| **Primary** (`purge_backlog_multiplier`)  | Backlog exceeds N runs' worth of claim capacity — the worker cannot keep up                 | 3            |
| **Secondary** (`purge_max_silence_hours`) | A single object's age exceeds a hard ceiling — the worker is dead even with a small backlog | 12h (was 3h) |

Proven against the real function, not a fixture: a pile of objects each overdue by
one minute trips the primary signal purely on count; a single object four hours
overdue — the exact shape ordinary scheduling jitter produces — trips neither.

**The batch limit was hardcoded — moved to config.** `purge_batch_limit` is now an
`app_thresholds` row, default 250 (was a JS constant, 100). Growing the fleet past
the pilot size is now a threshold row, not a code change and a deploy. At 250/hour
this is 6,000/day, 3.75x the pilot's stated arrival rate — survives the pilot
doubling to ~150 MRs without anyone needing to notice.

**The "13 hours out" claim was stale within the same session, self-inflicted.** Said
after the cron had already moved to hourly, still reasoning from the schedule that no
longer existed. Checked directly rather than re-asserted: the hourly cron never
actually fired before both workflows were disabled at the reviewer's request. Neither
guess was right — not 13 hours, and not "already fired several times."

**Corrected before it shipped, not after: `audio_purge_health()` was never
broken.** An earlier draft of the addendum migration claimed the function didn't
return `stalled`/`liveObjectCount` and had silently failed to report anything useful
since BE-W6. That was wrong. `20260815000300_audio_consent_retention.sql` defines the
function once without those fields — reading only that definition is where the wrong
claim came from — but `20260816000300_resumable_upload.sql` (BE-W7) **redefines it**
with both fields wired up correctly via `create or replace function`. Missed the
second definition on the first pass. Caught before committing by deliberately
resetting the local database with the new migration held out and querying the real
function output directly, rather than trusting the first read. The migration and its
rollback were rewritten to remove the incorrect section entirely before anything was
pushed.

**Now deployed and live, in three explicit steps rather than by default.** Held back
initially per instruction not to run anything until told; once the reviewer confirmed
the fix, `20260817000200_purge_backlog_stall_detection.sql` was pushed to production
and verified directly against the remote — not the CLI's success line — before
either workflow was re-enabled. Full timeline, including the ~35-minute window both
workflows were disabled and the reminder mechanism that was silent during it, is in
`.ai-collab/decisions.md` → "Retention workflows: disabled, then deployed and
re-enabled."

**`.ai-collab/` split — not done this addendum.** The reviewer's proposal (track the
durable six files as-is; strip point-in-time claims out of `handover.md` and
`handoff.md` specifically, leaving them as pointers into `PROJECT-OVERVIEW.md`) is
recorded here as the plan but not executed — it touches files this addendum was not
asked to change and deserves its own pass rather than being folded in.

**Production migration audit trail — flagged, not built.** Two hand-run
`supabase db push` calls against production this week, both outside CI. No incident
resulted, but a third one is where this becomes a real risk. Needs either a
documented runbook step with a verification query, or a workflow, before the pilot —
not scoped into this addendum, named so it doesn't get lost.

---

## How to run

Prerequisites: Node 24, pnpm 11, Docker running. Setup steps are in
`docs/backend-setup.md`.

```bash
pnpm install

# Local Supabase stack (Docker must be running)
pnpm db:start          # prints API URL, keys, Studio URL
pnpm db:status
pnpm db:reset          # drops and re-applies every migration from scratch
pnpm db:stop

# The full CI gate, locally
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm --filter @elmiron/core test    # contract guards, no database needed
pnpm --filter @elmiron/api test     # database tests, needs the stack running
```

`services/api` tests report as **skipped** — not passed — when no database is
reachable, so `pnpm test` stays useful without Docker while never manufacturing
confidence. In CI an unreachable database is a hard failure.

Note the earlier claim here, that CI "sets `SUPABASE_DB_URL` explicitly so CI never
skips", was wrong: `DB_URL` has a default and reachability is a TCP connection, not
an env var. The guard is now on `process.env.CI`, and all three paths are verified
in the BE-W1 review evidence below.

Studio: `http://127.0.0.1:54323`. Mail catcher: `http://127.0.0.1:54324`.

### Verification evidence — BE-W1, 10 August 2026

```
$ pnpm run typecheck
 Tasks:    7 successful, 7 total

$ pnpm run lint
 Tasks:    5 successful, 5 total

$ pnpm run format:check
All matched files use Prettier code style!

$ pnpm --filter @elmiron/core test
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ pnpm db:reset
Applying migration 20260810000100_roles_territories_profiles.sql...
Finished supabase db reset on branch main.

$ pnpm --filter @elmiron/api test
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

End-to-end check of the JWT hook and RLS, run against the local stack with a real
signed-in MR (throwaway script, not committed):

```
created auth user: 6d8a3034-8610-415c-a979-bc5fdafb289a
JWT claims of interest: {
  app_role: 'mr',
  app_territory_id: '90000000-0000-4000-8000-000000000001',
  app_is_active: true
}
GET  /territories   -> 200 [{"id":"90000000-...-000000000001","code":"HOOK-CHECK"}]
GET  /user_profiles -> 200 [{"id":"6d8a3034-...","role":"mr"}]
POST /territories   -> 403 {"code":"42501","message":"permission denied for table territories"}
```

The hook fires, the claims land in the token, the MR reads only what they should,
and a write attempt is denied rather than silently dropped.

### Verification evidence — BE-W2, 11 August 2026

```
$ pnpm run build            Tasks: 3 successful, 3 total
$ pnpm run typecheck        Tasks: 8 successful, 8 total
$ pnpm run lint             Tasks: 6 successful, 6 total
$ pnpm run format:check     All matched files use Prettier code style!

$ pnpm --filter @elmiron/core test        Tests  12 passed (12)
$ pnpm --filter @elmiron/mock test        Tests  27 passed (27)
$ pnpm --filter @elmiron/api  test        Tests  88 passed (88)
```

**Migrations apply from empty**, not just against an already-migrated database:

```
$ pnpm db:reset
Applying migration 20260810000100_roles_territories_profiles.sql...
Applying migration 20260811000100_commercial_schema.sql...
Applying migration 20260811000200_consent_ledger.sql...
Applying migration 20260811000300_audit_log.sql...
Applying migration 20260811000400_rls_policies.sql...
Finished supabase db reset on branch main.
```

**Every rollback executes, in reverse, and leaves nothing behind** — this is the CI
step, run locally first:

```
$ pnpm --filter @elmiron/api verify:rollbacks
applying 20260811000400_rls_policies.down.sql ... ok
applying 20260811000300_audit_log.down.sql ... ok
applying 20260811000200_consent_ledger.down.sql ... ok
applying 20260811000100_commercial_schema.down.sql ... ok
applying 20260810000100_roles_territories_profiles.down.sql ... ok
All rollbacks applied in reverse order; public schema is empty.
```

**The BYPASSRLS measurement**, which drove the immutability design:

```
              rolname       | rolsuper | rolbypassrls
        --------------------+----------+--------------
         anon               | f        | f
         authenticated      | f        | f
         postgres           | f        | t
         service_role       | f        | t
         supabase_auth_admin| f        | f

  A: as postgres, no FORCE                        -> 2 of 2 territories
  B: after SET LOCAL ROLE authenticated + claims   -> 1 of 2   <- RLS applies
  D: FORCE RLS on, read as postgres again          -> 2 of 2   <- FORCE loses to BYPASSRLS
  E: FORCE RLS on, as authenticated                -> 1 of 2
```

**The suite can fail.** Four regressions applied to the live schema — permissive
`visits` policy, consent trigger dropped and its grant restored, `security_invoker`
off on `visit_summary`, `analyses` granted to `authenticated`:

```
$ pnpm --filter @elmiron/api test     # with mutations applied
  Tests  20 failed | 68 passed (88)

$ pnpm db:reset && pnpm --filter @elmiron/api test
  Tests  88 passed (88)
```

---

## Known gaps

1. ~~**Reads outside scope return an empty list, not a denial.**~~ **Settled
   10 Aug 2026.** The reviewer accepted that the original criterion was not
   satisfiable by RLS and amended it. `403`, `200 []` and `0 rows affected` are all
   acceptable; the property is non-disclosure and non-mutation, tested
   direct-to-database with no application code in the path. The RPC-only-reads
   option was explicitly rejected as cosmetic. See
   [docs/amendment-gate0-criterion.md](docs/amendment-gate0-criterion.md) — that
   document is the criterion BE-W2 is built and reviewed against.
   Two tasks are carried into BE-W2 from the same review: a write-time trigger
   rejecting `territories` cycles, and `reporting_manager_id` role/cycle constraints.
2. ~~**The Supabase project region is unconfirmed.**~~ **Confirmed 10 Aug 2026:
   `ap-south-1`, South Asia (Mumbai)**, for project ref `pgfdbzoapmleqtoezhoa`.
   Verified in the dashboard, not from this machine — the MCP server is still
   unauthenticated. Data residency requirement satisfied.
3. ~~**The custom access token hook is configured for local only**, and the remote
   project is not linked.~~ **Partially closed 17 Aug 2026.** All **17 migrations are
   now deployed** to `pgfdbzoapmleqtoezhoa` via
   `db push --db-url <direct>`; verified on the remote afterwards rather than
   trusted: 34 tables with RLS enabled **and** forced on every one, 41 policies,
   6 views all `security_invoker`, the `llm_gateway` role present with **no** grant
   on `transcripts_raw` / `recordings` / `voice_notes` / `consent_records`, the
   private `audio` bucket with its 3 `storage.objects` policies, 9 seeded
   `app_thresholds` rows, `org_default_shift_window` null (so capture refuses), and
   no `TRUNCATE` granted to `anon` or `authenticated`.

   **The custom access token hook is now enabled too**, set through the Management
   API (`PATCH /v1/projects/<ref>/config/auth`) rather than the dashboard, so the
   change is reproducible. `hook_custom_access_token_enabled: true`,
   uri `pg-functions://postgres/public/custom_access_token_hook`.

   Verified end to end, because the config endpoint reporting `true` says nothing
   about whether GoTrue can actually execute the function — and a hook that raises
   breaks **every** sign-in. Checked first that `supabase_auth_admin` holds EXECUTE on
   the function and SELECT on `user_profiles` with a policy to match, and that
   `authenticated` does **not** hold EXECUTE. Then called the function directly on the
   remote, then created a throwaway user, signed in for real, confirmed a token was
   issued, and deleted the user. Sign-in succeeded; `app_role` was correctly absent
   for a user with no profile row.

   Scope of what this affects, stated because it is easy to overestimate: the hook
   mints the `app_role`, `app_territory_id` and `app_is_active` claims that
   `current_app_role()` reads, which is **display-only**. Authorization was never
   waiting on it — every policy resolves the role through `effective_role()` against
   `user_profiles`.

   **New consequence:** the production database now has a schema, so the `.env`
   hazard is live rather than theoretical. `SUPABASE_DB_URL` is deliberately pinned
   to localhost for exactly this reason.

4. **No `services/api/supabase/seed.sql`.** `db reset` still warns about it. The Gate 0
   fixtures are created by the test run, not by a seed file, because they need real
   GoTrue users. A seed file is only worth adding when someone wants a populated
   database without running the suite.
5. ~~**Rollback SQL is not exercised by CI.**~~ **Closed 11 Aug 2026.** All five
   rollbacks now run in reverse in CI's database job and the schema is asserted empty
   afterwards. `pnpm --filter @elmiron/api verify:rollbacks` runs it locally; it is
   destructive, so follow it with `pnpm db:reset`.
6. **No user provisioning path.** Users are created through `service_role` or Studio
   until the admin APIs land in week 11.
7. **`apps/field` and `apps/console` are empty placeholders.** They typecheck; they
   are not applications.
8. **`packages/ui-tokens` exports empty objects.** Frontend populates it.
9. **The MCP Supabase server is unauthenticated in this session**, so nothing here
   was verified against the hosted project — only against the local stack.

### Added in BE-W2

10. **Fixture data accumulates.** The Gate 0 fixtures commit and are never torn down —
    `consent_records` and `audit_log` are append-only, so a teardown would either fail
    or have to disable the guard under test. Each run mints fresh UUIDs and emails, so
    runs never collide, but a long-lived local database fills up. `pnpm db:reset`
    clears it; CI resets before every run.
11. **The audit row is not autonomous.** It shares the caller's transaction, so a
    rollback loses it. **Accepted 11 Aug 2026, not a defect** — see the decision under
    Architecture decisions. Through PostgREST a rollback returns an error and the
    client receives nothing, so no real user path discloses without an audit row.
    Read-then-rollback needs a direct session, and those roles bypass the RPC anyway.
    Mitigation is operational: do not grant direct production sessions. **Revisit if
    the patient app routes clinical reads through this pattern.**
12. **Nothing has been pushed to a deployed Supabase project.** The remote is still
    unlinked, so every measurement in this document — including the BYPASSRLS
    behaviour the immutability design rests on — is from the local stack. Worth
    re-running once the project is linked; Supabase could in principle configure role
    attributes differently in the cloud.
13. **`db.ts` reachability is still checked once per spec file, not once per run.**
    Measured in BE-W1 and unchanged. With two spec files and no database it costs one
    extra 3-second connection attempt. `globalSetup` + `provide`/`inject` is the fix
    and now has real call sites.
14. **No load or performance testing of the policies.** `visible_user_ids()` and
    `visible_territory_ids()` run a recursive CTE per policy evaluation. Both carry a
    5s `statement_timeout` and neither has been measured against a realistic territory
    tree. Worth a look before the field APIs land in week 3.

---

### FE-W1 — Foundations (14 August 2026)

First frontend sprint. `apps/field` and `packages/ui-tokens` were placeholders from
BE-W1 until this one; `packages/ui` did not exist.

#### FE-G1 — UNMET, and not dressed up

**No physical Android device was available.** The gate is "a signed-in APK on a
physical Android device" and it has not been met. No emulator run is offered in its
place.

What was proven instead, and it is less: the app **bundles**. `expo export
--platform android` produces a 3.8 MB Hermes bundle, which exercises Metro,
workspace resolution, the three `@elmiron/*` imports and the `EXPO_PUBLIC_*`
inlining. It does not exercise signing, installation, the Android runtime, or
sign-in on a device.

Also outstanding for the APK: `eas login`, which needs credentials only the
developer can enter.

#### The build path changed mid-sprint

The plan chose local Gradle. The machine has no JDK, no Android SDK and no `adb`,
so installing that toolchain _was_ the risk local Gradle was chosen to avoid. The
reviewer reversed it: **EAS Build for FE-W1**, local Gradle from around FE-W3 when
native config changes get frequent.

Free tier, verified at expo.dev/pricing on 14 August 2026: **15 Android builds a
month, low-priority queue with 90+ minute waits at peak, 1 concurrency.** Enough for
this sprint, and a reason not to stay on it once rebuilds get frequent.

#### `packages/ui-tokens` — a validator and a control, not a palette

**No brand palette was produced, deliberately.** `docs/design-plan.md` and the brand
guideline were written outside the repo and never committed, so the only brand facts
available are two contrast ratios. Inventing colours to fit them and documenting the
assumption would produce something that looks authoritative and is wrong in a way
nobody catches until the client sees it. The reviewer's instruction was explicit.

What exists instead:

| Piece                    | What it is                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contrast.ts`            | WCAG 2.2 validator — real relative luminance, the 0.03928 linearisation cut-off the criterion is written against, ratios compared unrounded                          |
| `palette.ts`             | Neutral placeholder values, marked placeholder in the constant name, in `tokens.status`, and in the file header. **The one file to replace when the brand arrives.** |
| `tokens.ts`              | Token structure. Every colour is a reference into the palette, so a brand swap touches one file                                                                      |
| `brand-specification.ts` | What the guideline specifies, with colour values left `null`                                                                                                         |

**The brand finding is a control, not a note.** `brand-specification.test.ts` runs
the recorded ratios through the validator and asserts they fail:

| Pair                         | Recorded   | AA needs | Verdict                                                                                       |
| ---------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------- |
| Primary button label on fill | **2.54:1** | 4.5:1    | Fails AA and AAA, at every text size — 2.54 is below even the 3:1 non-text floor              |
| Badge label on fill          | **4.33:1** | 4.5:1    | Fails AA for normal text. Clears the 3:1 large-text floor, which is how it gets waved through |

The colour fields being `null` is load-bearing: the test that compares a computed
ratio against the recorded one is vacuous today and activates the moment somebody
fills them in. Either the finding is confirmed against real colours, or the recorded
number was wrong and the build says so.

**Placeholder pairs, measured** — every pair with a WCAG obligation is asserted on
every test run, so a brand swap that introduces an inaccessible pair fails here
rather than reaching a screen:

```
text      17.40:1  min 4.5  PASS   primary text on background
text      15.96:1  min 4.5  PASS   primary text on surface
text       8.86:1  min 4.5  PASS   secondary text on background
text       8.12:1  min 4.5  PASS   secondary text on surface
text       6.42:1  min 4.5  PASS   primary button label on primary button fill
non-text   6.42:1  min 3    PASS   primary button fill against the page
text       6.53:1  min 4.5  PASS   critical text on background
```

38 tests. **Mutation-tested**, per the convention: linearisation removed → 8 failed;
AA threshold lowered 4.5 → 2.5 → 8 failed; a colour literal pasted into `tokens.ts`
instead of a palette reference → 3 failed. Restored: 38/38.

#### The extraction rule — strengthened past what was asked, on purpose

The ask was a lint rule that fails the build when `apps/field` **defines** a
component. What is enforced instead: **`apps/field` cannot import React Native's
visual primitives at all.** `View`, `Text`, `Pressable`, `StyleSheet`, `TextInput`,
`FlatList` and the rest are restricted imports there. Non-visual APIs — `Platform`,
`AppState`, `Linking` — stay available, and route files still work because composing
`@elmiron/ui` needs none of the restricted names.

This is the same move as _"there is no upload endpoint without consent, not a
disabled button"_: remove the capability rather than detect the symptom. A naming or
file-location rule detects a component after someone writes it; this one means the
materials are not in the building.

**Recorded here as a deliberate strengthening so it does not get "simplified" back
into a convention later.**

Proof it fails the build:

```
apps/field/src/ExtractionRuleProbe.tsx
  1:10  error  'StyleSheet' import from 'react-native' is restricted...
  1:22  error  'Text' import from 'react-native' is restricted...
  1:28  error  'View' import from 'react-native' is restricted...
✖ 3 problems (3 errors, 0 warnings)
```

Probe removed, `pnpm --filter @elmiron/field lint` exits 0.

#### A guard removed is a guard replaced — `import/no-extraneous-dependencies`

React Native's package graph is not pnpm-clean: `expo-router` imports
`@expo/metro-runtime` without declaring it, which imports `whatwg-fetch` without
declaring it, and so on. The first instinct was `nodeLinker: hoisted` across the
workspace, which works — and silently deletes the install-time guarantee that a
package cannot import what it has not declared, for `core`, `mock` and `api` too, to
accommodate one app.

**That turned out to be unnecessary.** The real cause was
`disableHierarchicalLookup` in this repo's own `metro.config.cjs`, copied from
Expo's monorepo guide, which assumes npm or yarn. Under pnpm it makes nested
dependencies unreachable. Removed, the app bundles under pnpm's **default isolated
linker with no hoisting configured at all** — `pnpm-workspace.yaml` is unchanged
from `origin/main`.

`eslint-plugin-import`'s `no-extraneous-dependencies` was added regardless. The
install-time property now also holds at lint time, in CI, for every workspace — so
it survives the next time somebody is tempted to hoist their way out of a resolution
error. Proven: an undeclared `import prettier` in `packages/core` fails lint; removed,
exit 0.

#### The four `APP_*` values

`loadAppConfig()` has existed since BE-W1 with no caller. This app is the first, and
it throws on absence rather than defaulting.

| Value                          | Set to                      | Why                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_JWT_AUDIENCE`             | `authenticated`             | What Supabase puts in `aud`. Matches `config.test.ts` and the local stack                                                                                                                                             |
| `APP_SITE_URL`                 | `http://127.0.0.1:3000`     | The console's dev origin. Mobile does not use it; it is required and must be a real URL                                                                                                                               |
| `APP_ADDITIONAL_REDIRECT_URLS` | `elmironmr://auth-callback` | The only redirect an Android app needs. The schema permits an empty list for mobile-only; a real deep link is better than an empty one because it is the value that has to be right when auth callbacks land in FE-W4 |
| `APP_DEEP_LINK_SCHEME`         | `elmironmr`                 | Matches `scheme` in `app.json` and the example in `config.test.ts`. These two must agree or the callback silently fails                                                                                               |

All four are also mirrored as `EXPO_PUBLIC_APP_*`, because Expo only inlines that
prefix. Every one is public by nature — an audience, a redirect target and a URL
scheme are readable in any APK regardless. **The publishable key is the only Supabase
key that may carry the prefix.**

#### Production credentials left the repository

`.env` held a service-role key, three remote connection strings and a Supabase
access token, and `SUPABASE_URL`, `SUPABASE_JWKS_URL` and `EXPO_PUBLIC_SUPABASE_URL`
all pointed at the deployed project — including the one the mobile app reads, while
the sprint brief says sign-in runs against the **local** stack.

Nine values moved to `~/.elmiron-prod.env`, outside the tree. The repo `.env` now
holds localhost and public constants only; a check confirms no remaining value is
anything else. Loading production is now a deliberate act, documented in the file
header and in `docs/gotchas.md`.

This replaces a denylist with the removal of a class. `.easignore` was added too —
EAS uploads the project directory, and the reasoning that made that acceptable
("`apps/field` carries no secrets") depended on a gitignore rule holding.

#### What was built in `apps/field`

Expo SDK 57, React 19.2.3, React Native 0.86.2, expo-router, Android only — no iOS
key in `app.json`, no `react-dom`, no `react-native-web`. The default template was
not used: it ships `@expo/ui`, `expo-glass-effect`, `expo-symbols` and a
`src/components` directory, three of which are iOS-flavoured and the last of which
violates the extraction rule on the first commit.

Routes: `_layout` (session provider), `index` (session-restoring redirect),
`sign-in`, `home` (role-aware), `doctors`. `src/` holds config, the Supabase client,
the API client and claim reading — no components.

**The role is read, not inferred.** `src/claims.ts` decodes `app_role`,
`app_territory_id` and `app_is_active` from the token the auth hook mints, and throws
if they are absent rather than falling back to a least-privileged view — a token
without them means the app is pointed at a project where the hook is not enabled,
which should be loud. It does not verify the signature, and says so: the server does
that, and these claims decide which rows render, not what anyone may do.

**The non-happy path is wired first.** `app/doctors.tsx` runs against the mock's
`denied` scenario, and renders a denial with its own state — never an empty list.
An empty list is what a client-side filter looks like, and the client never decides
what an MR may see.

#### Verification

All against the local stack, Docker up:

```
pnpm run build          Tasks: 3 successful
pnpm run typecheck      Tasks: 9 successful
pnpm run lint           Tasks: 7 successful
pnpm run format:check   All matched files use Prettier code style!

@elmiron/ui-tokens   38 passed (38)
@elmiron/core        21 passed (21)
@elmiron/mock        40 passed (40)
@elmiron/api        333 passed (333), 13 files    <- passed, not skipped
verify:rollbacks     all 19 reversed, public schema empty; restored with db:reset
```

The `api` number matters here specifically: this sprint changed how packages
resolve, and `api` is the workspace with the most to lose. It was run with the stack
up so the result reads _passed_ rather than _skipped_ — the distinction
`docs/gotchas.md` warns about.

#### A note for anyone bisecting this sprint

FE-W1 landed as five commits so a revert can be surgical. **`pnpm-lock.yaml` is
entirely in the first of them**, because one lockfile cannot be split across commits
that each add dependencies.

The consequence: checking out an intermediate commit and running
`pnpm install --frozen-lockfile` fails, because the lockfile there describes
dependencies the `package.json` files at that commit do not yet declare. **That is
not a broken tree.** Only the final state of the series is installable. Reverting any
single commit works normally, which is what the split was for.

#### Deliberately not built

| Left out                                                        | Why                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Any feature screen — check-in, consent, recording, call reports | FE-W2 onward                                                         |
| Anything showing a transcript, analysis or AI output            | Blocked, and may be cancelled outright                               |
| Any ranking, score, rank, percentile or grade                   | Regulatory line, not a preference                                    |
| Anything in `apps/console`                                      | FE-W6                                                                |
| Any iOS configuration                                           | Android only, permanently                                            |
| A brand palette                                                 | No committed source. See above                                       |
| `graphify-out/`                                                 | Optional derived artifact; the code and migrations are the authority |

#### What I think is wrong, or worth arguing with

**1. `apps/field/tsconfig.json` cannot extend the repo base, and that is a real
divergence.** The base sets `module: NodeNext`, which requires `.js` extensions on
relative imports; Metro does not resolve them. The app extends `expo/tsconfig.base`
and repeats every strictness flag explicitly. One flag is genuinely dropped:
`noPropertyAccessFromIndexSignature`, because Expo inlines env values by rewriting
`process.env.EXPO_PUBLIC_X` and only matches dot access — the bracket access that
rule demands yields `undefined` in a release bundle while working in development.
Dropping a strictness flag to satisfy a bundler is worth someone else's eyes.

**2. The extraction rule has one hole I could not close cheaply.** `import * as RN
from 'react-native'` is not reliably caught by `no-restricted-imports` with
`importNames`. Anyone deliberately routing around the rule can. It stops the
accident, not the intent — which is the honest description of most lint rules, but
worth stating rather than implying the boundary is airtight.

**3. `com.praversetech.elmironmr` is a guess.** The Android application id is
permanent once published to Play and I derived it from the GitHub organisation
without being told. Change it before the first upload if it is wrong; afterwards it
cannot be changed at all.

**4. The `declined`-is-not-an-error rule has no test yet.** `Banner` documents that
`critical` is never for a declined consent, and `ColorTokens` repeats it — both are
comments. The consent screen is FE-W4 and the real control belongs with it, but a
comment is not a control and should not be mistaken for one in the meantime.

---

### FE-W2 (part) — the offline queue state machine (14 August 2026)

**Advanced, not closed. FE-G2 is UNMET** — the gate is a full simulated day in
airplane mode on a real device, syncing clean afterwards, and there is no device and
no development build. Nothing below is offered as meeting it.

This exists because FE-W2 is the one sprint that could proceed while fourteen items
wait on a human. It is also, by the sprint order's own design, work that survives
either answer to contract I3 — the AI-dependent screens are FE-W9 onward precisely so
that a cut AI layer deletes nothing built before it.

#### What was built, and the boundary that made it safe to build early

Writing a queue before the persistence layer exists risks encoding assumptions that
PowerSync then contradicts — discovered in FE-W3 with the state machine wired into
four screens. So the split is:

| Built now                                                                | Deliberately not built          |
| ------------------------------------------------------------------------ | ------------------------------- |
| `sync/reducer.ts` — pure `(state, event) => state`                       | The PowerSync local store       |
| `sync/events.ts` — every transition as data                              | Anything that renders the queue |
| `sync/explanation.ts` — rejection code → what the MR is shown and can do | Any native-module code          |
| `sync/store.ts` — the **interface** PowerSync will implement             | Its implementation              |

The reducer decides every transition from the contract in
`packages/core/src/field/sync.ts` alone. A test asserts it — the reducer's source is
checked for any mention of storage, so if a transition ever needs to know where rows
live, that test fails rather than the boundary quietly eroding.

`store.ts` is an interface with no implementor, stated as such in the file. Writing
the adapter now would mean shipping code that has never been executed, which this
project has already caught twice — `close_stale_upload_sessions()` and a purge worker
nothing ran. Catching the third before it happens rather than after.

#### The three rules that are easy to get backwards

1. **`duplicate` is success.** The item id is the server's idempotency key, so
   retrying something already accepted returns `duplicate`. Rendering that as failure
   puts a red row in front of an MR whose work landed perfectly. Accepted and
   duplicate are deliberately not distinguished on screen.
2. **A failed attempt decides nothing.** No verdict means the server never saw it.
   The item returns to `queued` — never to `failed`, never dropped. A test drives
   twenty consecutive failed pushes across a simulated offline day and asserts all
   three items are still queued and countable.
3. **A rejection is not a toast.** It persists in the state until resolved or
   reinstated. A rejection the MR did not happen to be looking at is a lost day.

Two further properties worth naming: the reducer refuses a rejection that arrives
with no `rejectionCode`, rather than showing an unexplained failure; and `syncedAt`
is stamped from the server's `receivedAt`, never the device clock. The one derived
field that _is_ a device timestamp is named `oldestUnsyncedClientCreatedAt` so its
provenance cannot be mistaken at the call site.

#### The MR-readable sentence is Backend's, verbatim

`explanation.ts` passes the server's sentence through unchanged and **never
fabricates prose for a refusal**. When the server sends none, the fallback says the
app does not have the reason — which is true — rather than guessing at one. A test
asserts the fallback names no cause: not shift, geofence, territory, hours or
location. `outside_shift_window` is somebody else's misconfiguration and
`outside_geofence` is about where the MR stood; showing the wrong one to someone who
genuinely did the work is how trust in the app dies.

The one judgement that does belong to the client is what the MR can do next — retry
or escalate — and a test iterates every code in `SyncRejectionCodeSchema`, so a new
code added by Backend fails here rather than rendering an undefined action.

#### Dead letters

Reinstatement returns an item to the queue and records who did it and why. The
reducer **throws on an empty or whitespace reason**: attribution plus a mandatory
reason is the entire control, since there is deliberately no fault taxonomy behind it
— at the point of rejection a wrong shift window and an MR error are
indistinguishable. The original rejection is kept after reversal; erasing it would
erase why somebody had to intervene.

#### Verification

36 tests, `pnpm --filter @elmiron/field test`. **Mutation-tested**, per the
convention:

| Mutation                                 | Result   |
| ---------------------------------------- | -------- |
| A failed attempt marks the item `failed` | 2 failed |
| Enqueue de-duplication removed           | 1 failed |
| `syncedAt` taken from the device clock   | 1 failed |
| Reinstatement reason no longer required  | 2 failed |
| The fallback invents a cause             | 1 failed |

Restored: 36/36.

#### Known gap, flagged rather than left

**Nothing calls the reducer yet.** It is wired to a screen in FE-W3, and until then
its only caller is its test suite. That is the shape the project has twice been
burned by, so it is recorded here rather than discovered later. The distinction from
those two cases: this code _is_ executed, on every test run, and its behaviour is
asserted — what is missing is a production caller, not verification.

#### Dead-lettering is the server''s. The client only ever learns of it.

Asked directly during review, and worth stating because it is the kind of thing
someone improves later by adding a local retry limit.

**The client never dead-letters an item on its own.** `deadLettered` is set from one
place only — a server verdict whose status is `dead_lettered`. The reducer counts
attempts but compares that count to nothing; there is no local ceiling and no
threshold to tune.

The reason is that the server holds the attempt budget and the forgiveness baseline.
If the client could decide an item was dead locally, the two systems could disagree
about whether an MR''s work is recoverable — and the MR is looking at the client''s
answer. The client renders what it is told.

Two tests pin it: fifty consecutive failed attempts leave the item `queued` with
nothing dead-lettered and nothing rejected; and a verdict carrying
`attemptsRemaining: 0` still produces no dead letter unless the status itself says
`dead_lettered`, so the client cannot reinterpret a number into a verdict.

Mutation-tested — a local ceiling that dead-letters after three attempts fails 2 of 40.

#### The storage boundary is asserted on the import list, not on a substring

The first version scanned the reducer''s source for `store`, `persist`, `sqlite` and
`powersync`. That catches the obvious violation and misses an aliased import, a
callback that does IO, or a helper module persisting on the reducer''s behalf — a
substring scan standing in for an architectural property.

The assertion is now on the **import list**, which is enumerable and cannot be
aliased around: every import in `reducer.ts` must be `import type`, and the set of
sources must be exactly `@elmiron/core` and `./events`. Side-effect imports are
asserted absent separately, since `import ''./x''` has no bindings to inspect. A file
that imports nothing but types cannot do IO at all.

The substring scan is kept as a secondary check — it catches a storage-shaped local
helper that an import list would not — and is labelled as the weaker of the two.

Mutation-tested: a value import added under an alias fails 1 of 40.

#### Terminology: checks are not gates

Two different things were being called the same word, three lines apart, and that is
how a reader walks away with the wrong picture.

- **Checks** (or guards) are the script-level ones: `build`, `typecheck`, `lint`,
  `format:check`, `test`. "9/9 checks" means the turbo tasks passed.
- **Gates** are **FE-G1 … FE-G5** and their backend equivalents. They are
  demonstrations on real hardware or against real data, and no number of passing
  checks substitutes for one.

**As of FE-W2, every check passes and no frontend gate has passed.** FE-G1 (a
signed-in APK on a physical Android device) and FE-G2 (a full simulated day in
airplane mode, syncing clean) are both open. FE-W1 and FE-W2 are therefore both open
sprints, and 472 passing tests do not change that.

#### Where the working notes live

`.ai-collab/decisions.md` holds decisions not yet written up here, plus the
FE-W8-blocking items and the standing rule for the current blocked period. **This
file is the durable record; if the two disagree, this one is right.** The pointer is
here so the two do not quietly become parallel sources of truth.

#### Known residual — a function can ride in on `payload`

Written up rather than guarded, deliberately. Raised in review of FE-W2 and recorded
here before the next sprint so it is a known limit rather than a surprise.

**What the hole is.** `SyncQueueItem.payload` is
`z.record(z.string(), z.unknown())`. The import-list assertion proves `reducer.ts`
imports nothing but types, and every type in its surface — `SyncQueueItem`,
`ServerVerdict`, `SyncEvent`, `SyncItemReinstatement`, `SyncQueueState` — declares no
function members anywhere. But an import list constrains what a file _pulls in_, not
what is _handed to it_. At the type level `unknown` is not a function, so a
JSON-shape assertion over these types passes while a function could still arrive
inside `payload` at runtime. Purity would then live at the call site rather than in
the file, and the guard cannot tell the difference.

**Why no guard was added.** A type-level assertion would pass today and would still
pass with a function in `payload`, because `unknown` satisfies it — so it would read
as closing the hole while closing nothing. A runtime check walking every payload for
function values would cost work on every transition to defend against a shape the
reducer never dereferences. Both are worse than an accurate note.

**What actually closes it.** Narrowing the contract: `payload` typed as a recursive
JSON value in `packages/core` rather than `unknown`. That is Backend's file and a
contract change, so it is a request rather than something Frontend does — worth
raising if a payload ever needs to be inspected rather than carried.

**The specific change that makes this dangerous.** Today the reducer only ever
_carries_ `payload` — it is copied between states and never read into, never
destructured, never called. **The moment any code path begins invoking or
dereferencing something out of `payload`, this stops being a residual and becomes a
live arbitrary-execution path**, and the import-list guard will still be green while
it happens. If that change is ever proposed, narrow the contract first.

---

### FE-R1 — Package identifier rename (17 August 2026)

Executes the ruling in `docs/brand-identifier-decision.md`. Commit **`f34ceef`**,
53 files. Push #2 of four, run before the harness so harness tests are not written
against a namespace that changes a week later.

**Why now:** ELMIRON is a third party's registered pharmaceutical trademark, and the
package id and URL scheme become permanent and public the moment anything is
published. Nothing is published, no deep link exists in the wild, no user has the app
installed — this is the cheapest it will ever be.

#### The mapping

| Item                    | From                         | To                                                        |
| ----------------------- | ---------------------------- | --------------------------------------------------------- |
| Android `applicationId` | `com.praversetech.elmironmr` | `com.praversetech.fieldforce`                             |
| Deep link scheme        | `elmironmr`                  | `praversefieldforce`                                      |
| npm workspace scope     | `@elmiron/*` (7 packages)    | `@fieldforce/*`                                           |
| Display name            | `"Elmiron MR"`, hardcoded    | configuration, default `"Field Force"`                    |
| Expo slug               | `elmiron-field`              | `field-force` — **beyond the three specified, see below** |

#### The two choices I was asked to propose

**Deep link scheme — `praversefieldforce`.** Neutral, carries no drug or brand name,
and vendor-prefixed: custom schemes are first-come-first-served on a device, so a bare
`fieldforce` is a plausible collision with any other field-force app the MR installs.
It matches option B of the approved brief, so it introduces no new decision, and it
satisfies the scheme regex in `loadAppConfig` (`^[a-z][a-z0-9+.-]*$`).

_Considered and not chosen:_ reverse-DNS (`com.praversetech.fieldforce` as the scheme
itself), which is the lowest-collision form and current best practice. Rejected only
because it diverges from the approved brief and is more verbose in every redirect
URL. **If the reviewer prefers it, it is a one-token change and still free.**

**npm scope — `@fieldforce`.** Consistent with the package id, names the product
rather than the brand. Registry availability is irrelevant: all seven packages are
`"private": true` and are never published.

_Flagged:_ if `packages/core` is ever shared with the patient app, `@fieldforce/core`
will be slightly wrong for it — a patient app is not a field force. Not solved here,
and not worth a third name today.

#### What changed, and what deliberately did not

The sweep keyed on **three tokens, each of which is always an identifier and never
prose about the drug**: `@elmiron/` (with the slash) is always the npm scope;
`com.praversetech.elmironmr` is the package id; `elmironmr` is the scheme. Bare
"Elmiron" is the drug name and was not touched.

| Area                 | Files  | Replacements |
| -------------------- | ------ | ------------ |
| `apps/`              | 18     | 34           |
| `packages/`          | 16     | 21           |
| `services/`          | 11     | 17           |
| `.github/` workflows | 3      | 7            |
| `.env.example`       | 1      | 6            |
| `eslint.config.mjs`  | 1      | 4            |
| root `package.json`  | 1      | 2            |
| **Total**            | **51** | **91**       |

Plus `app.json`, the new `app.config.ts` and the regenerated lockfile — 53 in the
commit.

**17 documentation files still mention Elmiron, deliberately.** Naming a drug in
documentation that describes the drug is accurate use; putting a third party's mark
in a package id is not. Those change only when O2 itself resolves — which brand,
which molecule, which legal entity — and that decision has not been made.

#### Verification — this replaced CI, which has still never run

| Check                       | Result                                               |
| --------------------------- | ---------------------------------------------------- |
| `pnpm run build`            | 3/3                                                  |
| `pnpm run typecheck`        | 9/9                                                  |
| `pnpm run lint`             | 7/7                                                  |
| `pnpm format:check`         | clean                                                |
| `expo config --type public` | resolves; `name` comes from `app.config.ts`          |
| `loadAppConfig()`           | does not throw; `deepLinkScheme: praversefieldforce` |

**Test counts, before → after — identical, and `api` _passed_ rather than skipped:**

| Suite       | Before  | After   |
| ----------- | ------- | ------- |
| `ui-tokens` | 38      | 38      |
| `core`      | 21      | 21      |
| `field`     | 40      | 40      |
| `mock`      | 40      | 40      |
| `api`       | 333     | 333     |
| **Total**   | **472** | **472** |

**Zero-reference searches.** Tracked files, documentation excluded (`docs/`,
`.ai-collab/`, `*.md`, `*.html`):

```
--- token: com\.praversetech\.elmironmr     matches: 0
--- token: elmironmr                        matches: 0
--- token: @elmiron/                         matches: 0

untracked env files:  .env  0 hits    apps/field/.env  0 hits

package id : "package": "com.praversetech.fieldforce"
scheme     : "scheme": "praversefieldforce"
scopes     : @fieldforce/{api,console,core,field,mock,ui,ui-tokens}
```

The 17 remaining documentation matches are **excluded by design, not missed** — the
search reports them separately for exactly that reason.

#### Backend request — the Supabase redirect allow-list

**Requested, not changed.** `services/api` is read-only to Frontend.

`services/api/supabase/config.toml` currently has:

```toml
additional_redirect_urls = ["http://127.0.0.1:3000", "https://127.0.0.1:3000"]
```

**Exact value to add:** `praversefieldforce://auth-callback`

An important detail: **no deep-link scheme was ever in that list**, old or new. So the
rename did not break this — it surfaced a pre-existing gap. Nothing is broken today
because FE-W1 sign-in uses the password grant, which involves no redirect. It bites at
the first magic-link, OTP or OAuth flow, and the failure will look like an auth
problem rather than a configuration one. Any hosted project needs the same addition.

#### Reversal path

`git revert f34ceef` restores all 53 tracked files. **Three things it does not do:**

1. **`pnpm install` must be re-run.** The lockfile is in the commit and reverts with
   it, but `node_modules` still holds the new scope symlinks until an install relinks
   them.
2. **Two untracked `.env` files were changed and are not in the diff.** Restore by
   hand:
   - root `.env` — `APP_DEEP_LINK_SCHEME`, `APP_ADDITIONAL_REDIRECT_URLS`,
     `EXPO_PUBLIC_APP_DEEP_LINK_SCHEME`, `EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS`
     back to `elmironmr` / `elmironmr://auth-callback`
   - `apps/field/.env` — the same two `EXPO_PUBLIC_*` values
3. `app.config.ts` is a new file; the revert deletes it, which returns the display
   name to a hardcoded string in `app.json`. That is the intended consequence of a
   revert, not a leftover.

Nothing external needs undoing: no Expo project exists under either slug, nothing has
been published, and no store listing has ever claimed either package id.

#### Ambiguous cases

**One, and I decided it rather than leaving it.** Doc comments inside code that
reference the package by name — `@elmiron/core — interface contract I1` in
`packages/core/src/index.ts`, and six similar. These are prose, but the string they
contain is a package identifier, and leaving them would have made the comments
factually wrong about a package that no longer exists under that name. The
three-token rule covers them: `@elmiron/` is always the scope. Recorded here because
it is the closest thing to a §2 edge case in the whole sweep.

#### What I think is worth arguing with

**1. The Expo slug was not in the prompt's three, and I changed it anyway.**
`elmiron-field` is a public identifier appearing in EAS project URLs and carrying the
mark. Leaving it while renaming everything else would have defeated the purpose, and
no Expo project exists yet to be renamed later. But it _is_ a decision beyond the
brief, it is one line in `app.json`, and it is the reviewer's to veto.

**2. The scope rename structurally cannot be done without editing read-only
workspaces.** `services/api` and `packages/core` are read-only to Frontend, and their
`package.json` names are part of `@elmiron/*`. The instruction to do the scope in this
pass authorises it, but "the scope is mechanical and free" is true of the edit and not
of the ownership boundary. Worth Backend knowing their workspace was touched, even
though every changed line there is the substitution.

**3. Local verification replacing CI has one specific blind spot.** Everything here
was checked on Windows; CI runs on Linux. Local checks cannot catch a case-sensitivity
failure. The risk is genuinely low — this rename changed file _contents_ and no file
_paths_, so there is no new casing to get wrong — but "verification replaces CI"
should not be read as "verification equals CI." It does not.

---

### FE-R1a — Reverse-DNS scheme, and the OTP gap it exposed (17 August 2026)

Follows FE-R1. Two things: take the strictly-better scheme while it is still free,
and answer a question FE-R1 filed too quietly.

#### The scheme is now reverse-DNS

|                  | From (FE-R1)                         | To (FE-R1a)                                   |
| ---------------- | ------------------------------------ | --------------------------------------------- |
| Deep link scheme | `praversefieldforce`                 | `com.praversetech.fieldforce`                 |
| Redirect URL     | `praversefieldforce://auth-callback` | `com.praversetech.fieldforce://auth-callback` |

Guaranteed-unique rather than probably-unique, and identical to the package id, so
there is one string to remember instead of two. A scheme is irreversible in the same
way a package id is — once any link exists in the wild it cannot change — and FE-R1's
whole premise was fixing the irreversible things while they are free. Doing that 95%
and leaving a known-better option on the table contradicts the sprint's own logic.

**It was conditional on the toolchain, not on the RFC.** Dots are legal in a URI
scheme under RFC 3986, but "legal" and "the toolchain is happy" are different claims.
Verified at three levels:

| Level                                  | Result                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo config --type public`            | resolves, `scheme: com.praversetech.fieldforce`                                                                                              |
| `expo config --type introspect`        | resolves; note `intentFilters` is empty at config level — the scheme is applied during prebuild, not here                                    |
| **`expo prebuild --platform android`** | `<data android:scheme="com.praversetech.fieldforce"/>` in the generated `AndroidManifest.xml`, with matching `applicationId` and `namespace` |
| `loadAppConfig()`                      | does not throw; `new URL(...)` parses the redirect, protocol `com.praversetech.fieldforce:`                                                  |

The prebuild check is the one that mattered — the config-level checks would have
passed even if the manifest generation choked. The generated `android/` directory was
deleted afterwards; it is gitignored and no native project is committed.

**One prebuild side effect, reverted.** `expo prebuild` rewrote `apps/field`'s
`android` script from `expo start --android` to `expo run:android`. That is not part
of the rename, and with `android/` deleted it would not work. `git checkout` on that
file, verified.

#### Files FE-R1a's four-file edit missed

_(Header corrected before this section settled: FE-R1 wrote these files correctly to the
then-current scheme. It was FE-R1a's narrower edit that did not reach them.)_

`packages/core/src/shared/config.test.ts` and `config.ts` carried the scheme as a
test fixture and a doc example. FE-R1's sweep had rewritten them from `elmironmr` to
`praversefieldforce`; FE-R1a's four-file edit did not reach them, leaving an
intermediate value in the tree. Both now carry the final scheme.

**Worth naming: the fixture change incidentally strengthens the test.**
`config.test.ts` now round-trips a dotted scheme through the `^[a-z][a-z0-9+.-]*$`
validation, so the regex's acceptance of dots is asserted rather than assumed. That
was a by-product of completing the rename, not a change made for its own sake.

#### The file counts, reconciled

Three different numbers appeared in the FE-R1 report because each counted a different
set. Stated explicitly so the record is citable:

| Figure | What it counts                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **49** | Tracked code/config files containing `@elmiron` _before_ the sweep — the initial inventory                                                                        |
| **51** | Tracked files the sweep actually rewrote — 49 plus the two carrying `elmironmr` but not `@elmiron/` (`apps/field/app.json`, `packages/core/src/shared/config.ts`) |
| **91** | Token occurrences replaced across those 51 files                                                                                                                  |
| **53** | Files in commit `f34ceef` — the 51, plus `app.config.ts` (new) and `pnpm-lock.yaml` (regenerated)                                                                 |
| **4**  | Files changed by FE-R1a                                                                                                                                           |

#### The OTP question — answered: it was never built

FE-R1 reported the empty Supabase redirect allow-list as a wrinkle. It is not a
wrinkle, and the question it raised has a definite answer.

**Client-side, only four auth calls exist**, all in `apps/field/src/session.tsx` and
`api.ts`: `getSession`, `onAuthStateChange`, `signInWithPassword`, `signOut`. There
is no `signInWithOtp`, no `verifyOtp`, no `signInWithOAuth`, no `emailRedirectTo`
anywhere in `apps/field` or `packages`.

_A grep does report one match in `apps/field/dist/` — that is the built Hermes
bundle, which contains `supabase-js`'s own implementation of those methods whether or
not the app calls them. It is a false positive and worth knowing about, because it
will recur for anyone searching the tree for API usage._

**So of the two possibilities: not built.** Nothing is passing a test that asserts
something weaker than it appears to — there is no OTP test at all, in
`services/api/tests` or anywhere else.

**Where the gap actually sits.** BE-W1 enabled email + password **and** email OTP on
the platform (`otp_length = 6`, `otp_expiry = 3600`, `enable_confirmations = false`
in `config.toml`). The FE-W1 prompt asked only for "sign-in against the local
Supabase stack", which the password grant satisfies literally. So this is a gap
between **platform capability and client implementation**, not a misreported FE-W1
deliverable — but it is a gap, and it was not previously written down.

Consequences, recorded so they are not rediscovered in FE-W7:

- **OTP sign-in could not work today even if it were built**, because no deep-link
  scheme has ever been in `additional_redirect_urls`.
- Password sign-in is unaffected — it involves no redirect. Nothing is broken now.
- The failure, when it comes, will present as "auth is broken on real devices" and
  will look like a client bug. It is a server allow-list entry.

#### Backend request — updated value

Supersedes the value in FE-R1. `services/api` is read-only to Frontend, so this is a
request.

`services/api/supabase/config.toml` currently:

```toml
additional_redirect_urls = ["http://127.0.0.1:3000", "https://127.0.0.1:3000"]
```

**Add:** `com.praversetech.fieldforce://auth-callback`

Same addition needed on any hosted project. **The FE-R1 value
(`praversefieldforce://auth-callback`) is superseded and should not be added** — it
was never deployed anywhere, so nothing needs removing.

#### Verification — the full §5 gate, re-run

| Check                               | Result                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm run build`                    | 3/3                                                                               |
| `pnpm run typecheck`                | 9/9                                                                               |
| `pnpm run lint`                     | 7/7                                                                               |
| `pnpm format:check`                 | clean                                                                             |
| Tests                               | ui-tokens 38 · core 21 · field 40 · mock 40 · api **333 passed** — 472, unchanged |
| Stale tokens in code + config       | `praversefieldforce` 0 · `elmironmr` 0 · `@elmiron/` 0                            |
| Untracked `.env`, `apps/field/.env` | 0 stale hits each                                                                 |

#### Left alone, deliberately

- **`@fieldforce/core`** stays, wart and all. The packages are `private` and never
  published, so the scope is reversible at any time — irreversible things get fixed
  now, reversible ones get fixed when they bite.
- **A duplicate `APP_ADDITIONAL_REDIRECT_URLS` key in `.env.example`**, one from
  BE-W1 (`http://127.0.0.1:3000`) and one from FE-W1's appended block. The later
  entry wins in every dotenv implementation, so behaviour is defined, but it is
  confusing to read. **Noticed while sweeping and not fixed** — the no-opportunistic-
  fixes rule cuts both ways. Flagged for whoever owns `.env.example` next.

#### Reversal path

`git revert` the FE-R1a commit restores the four tracked files. Beyond it:

- root `.env` and `apps/field/.env` are untracked and carry the scheme in four and
  two places respectively — restore by hand.
- No `pnpm install` needed; FE-R1a changed no dependency or lockfile.
- Nothing external: no Expo project, no published app, no link in the wild.

---

### FE-H1 — Render test harness (17 August 2026)

Push #3 of four. Harness only — route tests and the queue screen are push #4, so that
when CI eventually runs, a red result has one candidate cause.

**This push does not close FE-G1 or FE-G2.** Both need hardware. Every check below is
local; CI has still never run on any frontend code.

#### Packages — six, not two, and why

The prompt authorised `jest-expo` and `@testing-library/react-native`. The registry
confirmed the deprecation exactly as stated:

> `@testing-library/jest-native`: **DEPRECATED** — "This package is no longer
> maintained. Please use the built-in Jest matchers available in
> @testing-library/react-native v12.4+."

`@testing-library/react-native` **14.0.1** installed, `jest-expo` **57.0.4**. No third
matcher package.

But the authorised two do not run. `peerDependenciesMeta` marks only `expo` and
`react-server-dom-webpack` optional for jest-expo, and only `jest` optional for RTL:

| Package                          | Why it is required                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `jest` 29.7                      | jest-expo is a **preset**, not a runner. Not declared anywhere in this repo before now. |
| `@react-native/jest-preset` 0.86 | jest-expo peer, not optional                                                            |
| `test-renderer` 1.2              | RTL v14 peer, not optional. Distinct from `react-test-renderer`.                        |
| `@jest/globals` 29.7             | typings for `describe`/`it`/`expect` — see below                                        |

**`test-renderer` was verified before installing**, because a generically-named v1.x
package arriving as a transitive peer is the shape of a typosquat. It is published by
`mdjastrzebski`, who is **one of the 17 maintainers of
`@testing-library/react-native`** — a direct publisher overlap, checkable from the
registry alone. RTL 14.0.1's own `peerDependencies` names it. 607k downloads/week,
~20% of RTL's 3.04M, consistent with v14-only adoption.

**`@jest/globals` rather than `@types/jest`, and the reason is structural.**
`@types/jest` declares `describe`/`it`/`expect` **globally**, so they would
type-resolve inside the `.test.ts` files vitest runs — the runner boundary would be
invisible at the type level. Explicit imports from `'@jest/globals'` and `'vitest'`
make which runner owns a file legible in its first three lines. The split enforces
itself rather than relying on a convention.

#### Two runners in one workspace

Chosen over migrating the 40 existing vitest tests: they are the most carefully
constructed in the codebase and porting them between runners risks silently weakening
an assertion in a way no count would show.

```
*.test.ts   -> vitest   logic, node, no renderer
*.test.tsx  -> jest     rendering, jest-expo preset
```

`apps/field/jest.config.cjs` and `apps/field/vitest.config.ts`. Scripts:
`test` runs both, `test:logic` and `test:render` run one each. Wired into CI as
`pnpm --filter @fieldforce/field test`, which invokes both.

**The boundary is enforced, not conventional.** `src/runner-boundary.test.ts`, 4
tests, asserts every vitest include ends `.test.ts`, every jest testMatch ends
`.test.tsx`, that vitest keeps an explicit `.test.tsx` exclusion even though the
include already implies it, and that no string can satisfy both.

#### The negative control

`src/harness.test.tsx`, committed in the passing orientation. Inverted:

```
● render harness › does not find text that was never rendered — the negative control
  Unable to find an element with text: text that is not rendered
Tests:  1 failed, 1 passed, 2 total
```

Restored: 2 passed.

**The boundary check was mutation-tested too, and the first attempt was a dud worth
recording.** Replacing vitest's include with `.test.tsx` stopped vitest matching
`runner-boundary.test.ts` at all — nothing ran, and the result read as green.
_Widening_ the include to `['src/**/*.test.ts', 'src/**/*.test.tsx']` is the correct
mutation, and fails 2 of 44:

```
vitest include "src/**/*.test.tsx" must end in .test.ts
```

#### Test counts, before → after

| Suite       | Runner | Before | After  | Delta             |
| ----------- | ------ | ------ | ------ | ----------------- |
| `field`     | vitest | 40     | **44** | +4 boundary tests |
| `field`     | jest   | —      | **2**  | +2 harness tests  |
| `ui-tokens` | vitest | 38     | 38     | —                 |
| `core`      | vitest | 21     | 21     | —                 |
| `mock`      | vitest | 40     | 40     | —                 |
| `api`       | vitest | 333    | 333    | —                 |

**Totals are no longer meaningful as a single number.** From here on, report per
runner: **476 vitest + 2 jest**.

The six added tests, each pinning a fact:

1. _sends only .test.ts to vitest_ — every vitest include ends `.test.ts`
2. _sends only .test.tsx to jest_ — every jest testMatch ends `.test.tsx`
3. _keeps vitest excluding .test.tsx_ — the redundant exclusion survives a widened include
4. _cannot match the same file in both runners_ — no string satisfies both
5. _renders a component from @fieldforce/ui_ — the whole chain: TSX transformed, workspace package transformed as source, RN tree mounted, queries read it back
6. _the negative control_ — the harness fails when an assertion is wrong

#### Verification

| Check                                                      | Result                                         |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `pnpm run build`                                           | 3/3                                            |
| `pnpm run typecheck`                                       | 9/9                                            |
| `pnpm run lint`                                            | 7/7                                            |
| `pnpm format:check`                                        | clean                                          |
| `api` with the stack up                                    | **333 passed**, 13 files — passed, not skipped |
| Harness needs a device, emulator, prebuild or native build | **No.** Node only.                             |

`apps/field/dist/` is **gitignored, not tracked** (`.gitignore:6` — `dist/`), and is
excluded from jest discovery along with `.expo/`, `android/` and `ios/`.

#### What it cost — four traps, all now in gotchas.md

1. **Jest cannot resolve a bare preset name under pnpm.** `Preset jest-expo not
found` while node's `require.resolve('jest-expo/jest-preset')` succeeds from the
   same directory. Fixed with `path.dirname(require.resolve(...))`.
2. **A UTF-8 BOM in `apps/field/package.json`** — written by an earlier
   `Set-Content -Encoding utf8`, which on PowerShell 5.1 means _with_ BOM. It had sat
   in a tracked file across several commits.
3. **RTL v14's `render` is async.** Un-awaited, it yields a thenable with no query
   methods, and `screen` throws _"`render` function has not been called"_.
4. **`transformIgnorePatterns` needed `@fieldforce` added** — `packages/ui` is
   consumed as TypeScript source.

#### What I think is worth arguing with

**1. CI has never run `ui-tokens`.** Found while wiring, not fixed here — the
no-opportunistic-fixes rule holds. It is addressed in the commit immediately
following this one, because `check-contrast` is a build-failing accessibility guard
that has been decorative in CI since it was written.

**2. Six packages is three more than a harness ought to need**, and the count is
driven by RTL v14's peer graph rather than by anything this project chose. Worth
re-examining if RTL's peers consolidate.

**3. The `screen` API works, but only after `await`.** Push #4 will write dozens of
render tests, and every one needs `await render(...)`. That is stated in the push #4
prompt rather than left to be rediscovered per test.

---

### FE-W2b - Route tests and queue screen (17 August 2026)

Push #4, the last of the sequence, and the first MR-facing surface in this project.

**FE-G1 and FE-G2 remain OPEN.** Both need a physical Android device and there is
none. Nothing below is offered as meeting either. Every number here is local; CI has
still never run on any frontend code.

#### Three commits, kept separate for diagnosability

| Commit    | Contents                                                           |
| --------- | ------------------------------------------------------------------ |
| `cca4ac5` | `packages/ui` gains the harness and its CI line in the same commit |
| `62d480f` | Route tests for the five FE-W1 files                               |
| `1e580a3` | The queue screen, its binding, and both mutation proofs            |

#### The five route files

Seventeen `it()` blocks, nineteen executed cases - `app/home.tsx` uses `it.each` over
three roles. **Both figures are stated because quoting one while the runner prints the
other is how a count stops being auditable.**

| Route             | Blocks / cases | What the tests pin                                                                                                                                                                                                                                                                                 |
| ----------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/index.tsx`   | 3 / 3          | A cold start shows a _named_ restoring state rather than guessing a destination; a restored session goes to `/home`, an absent one to `/sign-in`                                                                                                                                                   |
| `app/sign-in.tsx` | 3 / 3          | Submit disabled until both fields are filled; both inputs carry accessible labels; no failure banner before anything has been attempted                                                                                                                                                            |
| `app/home.tsx`    | 6 / 8          | Each role sees its own destination and not another's; the role is the one **read from the token**, displayed rather than inferred; all three roles keep the shared destination, because hiding a row is navigation and not permission; a signed-out session redirects instead of rendering a shell |
| `app/doctors.tsx` | 5 / 5          | A denial renders **as a denial and never as an empty list**; the server's sentence verbatim; an empty territory and a refused one are distinguishable; the loading state names what it loads; a transport failure is not reported as a permission problem                                          |
| `app/_layout.tsx` | **0**          | **Not tested - see below**                                                                                                                                                                                                                                                                         |

**`app/_layout.tsx` could not be meaningfully tested today.** It composes
`SafeAreaProvider`, `SessionProvider` and `StatusBar` around expo-router's `<Stack/>`,
which resolves routes from the filesystem at runtime. Rendering it in isolation
exercises the providers and not the composition, so the only honest assertion
available is that it did not throw - the kind this prompt forbids. It is covered
indirectly: every other route test mounts a component that reads the session context
the layout provides.

**No client-side permission logic was added or implied.** These tests pin how the
client _presents_ a server decision.

#### The queue screen

Component in `packages/ui/src/QueueScreen.tsx`; `apps/field/app/queue.tsx` is a
binding that reads state, passes it down and renders. Nothing else.

**It decides nothing.** There is no branch in the file that could promote, demote,
reorder or retire an item.

`packages/ui` cannot import the reducer - a package must not depend on an app - so
`QueueScreenProps` is declared structurally and a real `SyncQueueState` satisfies it
by shape. **The binding passing state straight through is the compile-time check that
the two agree**; if the reducer's state diverges, that line stops compiling.

| State                        | Glyph    | Label                                                                         | Backed by                                                                                                 |
| ---------------------------- | -------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| empty                        | `U+2713` | **Everything is sent** + "Nothing is waiting to leave this phone."            | `items: []`, and a fully-synced queue                                                                     |
| queued, retrying normally    | `U+21BB` | **Waiting to send**                                                           | `SyncQueueItemSchema.parse`, `attemptCount: 0`                                                            |
| queued, retrying a long time | `U+25F7` | **Still trying**                                                              | same, `attemptCount >= 3`; also produced by driving five real `attempt_failed` events through the reducer |
| rejected                     | `U+2715` | **Refused** + the server's sentence                                           | reducer fed a real `rejected` verdict                                                                     |
| dead-lettered                | `U+2298` | **Needs someone to look** + "This can be sent again once someone reviews it." | `deadLettered: true`                                                                                      |

**Inputs are parsed through `@fieldforce/core`'s Zod schemas, not taken from
`services/mock` fixtures.** Section 2 named the wrong mechanism for the right goal:
mock fixtures are server-response shapes while the screen consumes reducer state, so
they would need translating through the reducer anyway - and a drifted fixture passes
while a drifted parse throws. The `apps/field` test runs the chain end to end:
contract-parsed input, the real reducer, the screen. Nothing between them is a
fixture.

_Recorded separately, not fixed here:_ `services/mock`'s fixtures are unreachable -
`main: ./dist/index.js`, no `exports` map, and an entrypoint with a top-level
`await startMockServer()` that starts a listener on import. A real defect for whoever
needs them next.

#### The long-retry threshold

**`LONG_RETRY_AFTER_ATTEMPTS = 3`. Display only.**

Three tests assert it changes presentation and nothing else: the item is
byte-identical either side of the threshold (same status, same id); a row that crosses
it **does not move**, because position is read as priority and priority is a verdict
the server owns; and no number of attempts - 500 in the test - ever becomes a refusal.

**No duration is computed anywhere on this screen.** The only timestamp rendered is
**`RejectionRecord.receivedAt`**, the server's own clock, and only for items the
server has actually answered. A queued item has no server timestamp, so the screen
shows **no time at all** for it rather than passing off `clientCreatedAt` - the
device's clock - as though the server knew about the work. A test asserts that
absence. This also sidesteps the drifted-dev-clock trap recorded in `gotchas.md`.

#### Both mutation proofs - the count held at 15 in each

```
MUTATION 1 - the threshold issues a verdict instead of choosing words
  return item.attemptCount >= longRetryAfterAttempts ? 'refused' : 'waiting';
  -> Tests: 4 failed, 11 passed, 15 total
     renders the label "Still trying"
     changes the words and nothing about the item
     does not move a row that crosses it
     never turns a long wait into a refusal

MUTATION 2 - the client wraps its own wording around the server's sentence
  <BodyText>{`The server said: ${rejection.explanation}`}</BodyText>
  -> Tests: 1 failed, 14 passed, 15 total
     renders verbatim, with nothing wrapped around it

restored -> Tests: 15 passed, 15 total
```

Neither mutation dropped the case count, so in both the assertion ran and failed
rather than vanishing.

#### Per-runner counts

**A single total would now span two runners and five workspaces and hide which one
moved.** Reported per runner from here on.

| Workspace   | Runner | Before | After                                  |
| ----------- | ------ | ------ | -------------------------------------- |
| `field`     | vitest | 44     | 44                                     |
| `field`     | jest   | 2      | **24**                                 |
| `ui`        | vitest | -      | **4**                                  |
| `ui`        | jest   | -      | **17**                                 |
| `ui-tokens` | vitest | 38     | 38                                     |
| `core`      | vitest | 21     | 21                                     |
| `mock`      | vitest | 40     | 40                                     |
| `api`       | vitest | 333    | **333 passed** - stack up, not skipped |

Added, each pinning a fact: 4 boundary + 2 harness in `ui`; 19 route cases and 3 chain
cases in `field`; and in `ui`'s screen suite - 2 empty-state, 3 state labels, 1
dead-letter reversibility, 2 verbatim-sentence, 2 timestamp, 3 threshold, 2 glyph.

#### Accessibility - asserted versus deferred

**Asserted in the renderer:**

- Every one of the five states renders a **text label**, so meaning is never carried
  by colour or glyph alone.
- The glyph is **invisible to the accessibility tree** - proved by the query engine
  itself, since RTL skips hidden elements and the glyph cannot be found without
  `includeHiddenElements: true`, while its label can. Without this TalkBack would
  announce "clockwise open circle arrow, Waiting to send".
- Glyphs are **Basic Unicode, below U+2800 and outside the emoji blocks**, asserted by
  codepoint.
- Both sign-in inputs carry accessible labels; the loading state names what it loads.

**Deferred to device verification - not checked, and not implied to be:**

- **44px touch targets.** `minHeight: 44` is set on rows and buttons; a renderer does
  not lay out, so nothing here measures a real target.
- **16px body, weight 400 minimum.** The tokens say so and `ui-tokens` asserts the
  contrast ratios, but rendered type size is not measured here.
- **Outdoor legibility at partial brightness** - the FE-W7 sunlight audit.
- **Glyph rendering on real OEM font stacks.** Non-emoji codepoints reduce the tofu
  risk; they do not eliminate it on Xiaomi/Oppo/Vivo ROMs.
- **Whether TalkBack honours `importantForAccessibility`** in the built app, as
  opposed to the test renderer's accessibility tree.

#### The lint-rule extension - proposal only, not implemented

The current rule bans React Native visual primitives in `apps/field`, so a full
reusable screen assembled from `@fieldforce/ui` components can sit there undetected.

**Proposed:** in `apps/field/app/**`, fail when a file declares **any JSX-returning
function other than its default export**. That encodes _routes bind, screens render_
about as directly as a lint rule can - a binding has exactly one component and it is
the route.

**What it would wrongly reject:**

1. **Inline component mocks in tests.** The two route test files mock `Redirect` as a
   function returning a node. Exempting `*.test.tsx` reopens the hole in exactly the
   files that grew it last time; not exempting them means mocks move to a shared
   helper.
2. **A genuinely route-specific render helper** - a three-line branch a route extracts
   for readability - would be forced into `packages/ui` even when nothing else will
   ever consume it.

**Noise on current code: low.** All five routes have exactly one JSX-returning default
export and would pass unchanged. It fires only on the two test files.

**My read:** worth having, with mocks moved to a shared test helper rather than
exempting test files. But it is a real cost on a real pattern, and if the answer is
that no rule expresses this cleanly, enforcing it in review and recording that is
better than a rule with a carve-out big enough to hide the thing it was written to
catch.

#### CI membership

Re-audited. **Every workspace with a real test script is invoked by CI:** `core`,
`ui-tokens`, `ui`, `mock` and `field` in the static job, `api` in the database job.
`packages/ui` was the next predicted victim of the hand-maintained list and was caught
on schedule - its CI line landed in the same commit as its first tests.

#### What I think is worth arguing with

**1. `docs/design-plan.md` is still not in the repo, and I could not put it there.**
The prompt's "Read first" lists it, and it lives on the Claude side where this session
cannot reach it. I built to the numbers in the prompt itself - 16px, weight 400, 44px,
press states, icon plus label. That was sufficient here, but this is the ninth
instance of a document existing only where the reader is not, and it is the one
instruction in this prompt I could not follow.

**2. Nothing links to the queue screen.** `app/queue.tsx` is reachable by URL and by
nothing else - no navigation row points at it, because adding one was not asked for
and would be an unrequested feature. Under this project's own convention that anything
built should be called by something, that is worth a decision rather than a silent
gap.

**3. The binding renders `emptyQueue` and never changes.** That is honest - nothing
enqueues until FE-W3 and there is no store - but it means the screen a human can reach
today always shows the empty state. The five states are exercised by tests, not by the
app.

**4. `@fieldforce/core` was added as a devDependency of `packages/ui`** so its tests
could parse through the contract schemas. A workspace package rather than a new
external one, but a dependency addition nonetheless, and it is the mechanical
consequence of ruling B.

---

### Record correction (27 August 2026)

On 27 August, it was identified that the generated ndroid/ directory was untracked despite FE-R1a claiming it was gitignored. The root .gitignore has been updated and the directory is now correctly excluded. This note is appended as a durable record of the discovery.

### FE-Build-1  Native build and hoisting (27 August 2026)

The first successful native build of the Field app on Android. This phase resolved the toolchain blockers and established the path-length-compatible project layout.

#### Toolchain blockers and fixes

| Blocker | Fix |
| --- | --- |
| **JDK 25 failure** | JDK 17 installed and configured for both Gradle and Terminal JAVA_HOME. JEP 472 restricted-method errors on native modules (Screens/Worklets) resolved. |
| **Path length limits** | Switched pnpm to `hoisted` linker. `CMAKE_OBJECT_PATH_MAX` (250 chars) was being exceeded by deep `node_modules/.pnpm` nesting. |
| **Location Exception** | Ensured only `ANDROID_USER_HOME` is defined; IDE-injected `ANDROID_PREFS_ROOT` process-level variable identified and cleared. |
| **Missing SDK Platform** | API 36 platform installed to match `compileSdkVersion`. |

#### Hoisting decision

The project root path (`C:\\dev\\Elmiron-App`) combined with pnpm\u0027s default symlink-heavy layout produced object file paths of ~195 characters before reaching the module source. The CMake build for `react-native-worklets` failed because generated object paths exceeded Windows\u0027s 250-character ceiling. Hoisting flattened the tree, reducing nesting by ~4 levels and ~60 characters.

**Version mismatch resolved.** The first hoisted install drifted `react-native-worklets` from 0.11.4 to 0.12.1 due to open peer-dependency ranges. This broke the build with `error: no member named \u0027executeSync\u0027 in \u0027worklets::WorkletRuntime\u0027`. Resolved by restoring the lockfile and re-running install, pinning the hoisted layout to the documented versions.

#### Verification

- **FE-G1 State:** **emulator-passed / device-pending**. The app runs on the Pixel 10 API 37.1 emulator; sign-in and field capture await a physical device.
- **Test Fidelity:** 521 tests pass across 2 runners. Hoisting verified as safe for both Frontend (Jest/Metro) and Backend (Vitest/Node) resolution.
- **api suite:** **333 PASSED** against the local Supabase stack.

---

### Corrections to FE-Build-1 (31 August 2026)

The FE-Build-1 section above is frozen and stays as written. Four of its claims are
wrong or unverified. Each is corrected here, with the source of the error named.

**1. The Android API level.**

_Original claim:_ two different numbers for the same setting — "API 36 platform
installed to match `compileSdkVersion`" in the blocker table, and "Pixel 10 API 37.1
emulator" under Verification.

_Correction:_ **36 is right; 37.1 is wrong.** On disk:

- `apps/field/android/app/build.gradle:88,93,94` — `compileSdk`, `minSdkVersion` and
  `targetSdkVersion` are all `rootProject.ext.*`, so no literal lives in the project.
- `node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle:65` supplies
  the default the ext resolves to: `safeExtGet("compileSdkVersion", 36)`.
- The build's own merged manifest is the proof of what was actually compiled —
  `apps/field/android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml:8-9`:
  `minSdkVersion="24"`, `targetSdkVersion="36"`.
- The running emulator reports `ro.build.version.sdk=36`, release 16 — API 36,
  Android 16.

There is no API 37 anywhere. 37.1 is most likely the Android Emulator _tool_ version
read as an API level; the two are unrelated numbers.

_Note on the directory:_ `apps/field/android/` does exist on disk, ignored by
`.gitignore:45`. It was not regenerated for this check — the values above come from
build outputs already present.

_Source of error:_ the FE-Build-1 report.

**2. "Traced to `CMAKE_OBJECT_PATH_MAX`" — it was not traced.**

_Original claim:_ the path-length failure was "traced to" `CMAKE_OBJECT_PATH_MAX`
(250 chars) being exceeded by `node_modules/.pnpm` nesting.

_Correction:_ it was **hypothesised**, not traced. Nothing measured the actual object
path length before or after. The hoisting fix worked, and a fix that works is
consistent with the hypothesis without proving it — the same fix would have resolved
several other path-related failures equally well. Relabel as: hypothesis, supported
by the fix succeeding.

_Source of error:_ the reviewer.

**3. The saving from shortening the repo root was ~160 characters, not ~60.**

_Original claim:_ hoisting reduced nesting by "~4 levels and ~60 characters".

_Correction:_ the figure is **~160**. The `.pnpm` path segment appears **twice**, at
roughly 80 characters each. The conclusion is unchanged — shortening the root alone
was insufficient and hoisting was required — but the number supporting it was wrong.

_Source of error:_ the reviewer.

**4. "Pinned to the documented versions" understates what the hoisted install moved.**

_Original claim:_ the `react-native-worklets` 0.11.4 → 0.12.1 drift was "resolved by
restoring the lockfile and re-running install, pinning the hoisted layout to the
documented versions".

_Correction:_ the worklets pin held — `node_modules/react-native-worklets` is 0.11.4
on disk and the package does not appear in the lockfile drift at all. But the hoisted
install added **40 package versions** to `pnpm-lock.yaml` and removed **none**
(1145 → 1185 keys; `git diff 7bee3f4^ HEAD -- pnpm-lock.yaml`). No _direct_
dependency's own resolved version changed — `apps/field` still resolves `expo@57.0.12`
and `expo-constants@57.0.10`, which is what is installed — but a second, newer copy of
the Expo and Metro toolchains entered the tree through `jest-expo`'s peer resolution:
`expo@57.0.16`, `@expo/cli@57.0.18`, `metro@0.84.5` and 37 others. The test runner is
no longer necessarily running against the toolchain the app builds with. Nothing has
been changed in response; a version pin is a decision, not a cleanup.

_Source of error:_ the FE-Build-1 report.

---

### FE-Push-1 — first push and first CI run (31 August 2026)

**Commits ready to push: 29.** Everything from `dd9c1a4` (FE-W1 §1) to `90ede3c`
(glyph codepoint allowlist) — the entire frontend line of work, none of it ever built
or tested by any machine other than the one that wrote it.

**The push failed. CI did not run.**

```
remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904.
fatal: unable to access 'https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git/':
The requested URL returned error: 403
```

The credential helper offers the account `Devpt1904`, which has no write access to
`Praverse-Tech-Pvt-Ltd/Elmiron-App`. Commits are authored as
`Dev Patel <softwares@praversetech.com>`, so the identity writing the commits and the
identity authenticating the push are different accounts. `gh auth status` reports no
logged-in host. Resolving this is a human action and was not attempted.

**Consequence: every claim about CI remains unverified.** In particular the WCAG
contrast guard — added to `.github/workflows/ci.yml:41` as
`pnpm --filter @fieldforce/ui-tokens test` in commit `791c3c6`, precisely because it
had never executed — **still has not executed.** It is in the workflow file, and the
workflow file has never run on this branch. There is no file named `check-contrast.ts`
in the repository; the guard is `packages/ui-tokens/src/contrast.test.ts`, reached
through that workspace's `test` script.

**One failure is predictable without running CI.** `format:check` runs
`prettier --check .`, `.prettierignore` does not exclude `PROJECT-OVERVIEW.md`, and
that file is already non-conforming at `90ede3c` — before this section was added. The
`static` job will fail at that step until either the file is formatted (which would
rewrite the frozen FE-Build-1 section) or the file is added to `.prettierignore`
alongside the other reviewer-authored documents. That is a decision, not a cleanup,
so it is recorded here rather than taken.

---

### FE-Build-2c — repo hygiene and first push (31 August 2026)

**The second directory was a stale clone, not a fork.** `C:/Users/devp0/StudioProjects/Elmiron-App`
shares this repo's `origin`. Its HEAD is `b5d03a5`, which is **exactly `origin/main`** —
outcome **(b)**: the clone is at the true tip, and it also carries substantial
uncommitted work (a second, independent `apps/field` and `apps/console` built there
in a separate session, plus token and lint changes). Not divergence in history; no
commits exist there that are absent here.

The `@elmiron/*` package names in that directory are not a different project. They
are what `origin/main` still says, because the R1 rename to `@fieldforce/*` is among
the commits that have never been pushed. `git show origin/main:apps/field/package.json`
returns `"name": "@elmiron/field"`; the local file says `"@fieldforce/field"`.

**A correction to the FE-Build-2b report,** which called those two directories
"divergent frontend lines" and asked which was canonical: that was wrong. This repo
is canonical; the other is a clone of the unrenamed published state. Nothing there
needs reconciling and nothing was deleted, moved or modified.

**This checkout's `origin/main` ref was stale.** Before `git fetch` it pointed at
`d3b841f`; the real tip is `b5d03a5`. The branch is **30 ahead, 2 behind** — the two
missing commits are `1ad5aa0` and `b5d03a5`, both Backend retention records. A push
will be rejected as non-fast-forward until they are integrated. That is a rebase-or-merge
decision and was not taken here.

**The root-level `android/`.** `.gitignore` had `apps/field/android/`, which is a path
from the repo root and does not match a directory named `android/` at the root. The
stray tree was produced by an Expo prebuild/run invoked from the **repo root** instead
of `apps/field`: `android/`, its `gradlew`, `settings.gradle` and a root `app.json`
all carry the same 27 August 15:24 timestamp, and that `app.json` contains Expo's
default `"package": "com.anonymous.elmironapp"` — the name Expo generates when it
finds no app config, which is exactly what the root of this monorepo looks like to it.
`root_build.txt` records the resulting Gradle run. The directory has **not** been
deleted; it is evidence of how it was produced.

Now ignored, root-anchored with a leading slash: `/android/`, `/ios/`, `/app.json`,
plus `build_*.txt`, `current_build*.txt`, `root_build*.txt`, `metro-*.txt`,
`.gradle_home/` and `screen*.png`. Named patterns rather than `*.txt`, which would
swallow real files later. **The general rule:** a `.gitignore` entry containing a
slash is anchored to the repo root, so `apps/field/android/` never protects any other
directory of the same name.

**The append-only rule is now mechanical.** It previously existed only as prose inside
the file it protects, and a `prettier --write` reformatted a frozen table — caught by a
human, which is not a control. Two changes:

- `PROJECT-OVERVIEW.md` added to `.prettierignore`, so the formatter cannot make the
  edit.
- A step in the `static` job of `.github/workflows/ci.yml` fails the build when a
  change to this file deletes any line: `git diff --numstat <base>...HEAD` field 2,
  non-zero is a failure. It compares against `github.event.before` on a push and
  `origin/<base_ref>` on a pull request — `origin/main...HEAD` is empty once a push has
  landed and would pass vacuously, which is the failure mode the guard exists to avoid.
  The job's checkout now uses `fetch-depth: 0`.

**Negative control, because a guard that has never failed is indistinguishable from a
guard that cannot fail.** On a scratch branch, one line was deleted from the frozen
FE-Build-1 table and the same logic run:

```
Comparing main...HEAD
Deleted lines: 1
ERROR: 1 line(s) removed. PROJECT-OVERVIEW.md is append-only.
-| **Missing SDK Platform** | API 36 platform installed to match `compileSdkVersion`. |
exit=1
```

The positive control passes on the genuine append-only commit `6dc4a6d` (`Deleted
lines: 0`). The scratch branch was deleted and the frozen line verified present.

**The push failed again, on authorisation, not on content.**

```
remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904.
fatal: unable to access 'https://github.com/Praverse-Tech-Pvt-Ltd/Elmiron-App.git/':
The requested URL returned error: 403
```

Two blockers now stand between this work and CI: the credential helper offers
`Devpt1904`, which has no write access to the org repository, and the branch is two
commits behind `origin/main`. **CI has still never run on any frontend code**, the
contrast guard in `packages/ui-tokens/src/contrast.test.ts` has still never executed,
and the append-only guard added above has never executed either — it is verified only
by the local negative control recorded here.

---

### FE-Build-2d — safe-area inset and origin divergence (31 August 2026)

**The two commits on origin are Backend's, and the push is not a fast-forward.**

| | |
| --- | --- |
| `b5d03a5` | Maanav Shah <126866160+Rabbitshah@users.noreply.github.com>, Sun 23 Aug 2026 14:14 +0530 — "Record: retention workflows disabled again, 23 August". Touches `.ai-collab/decisions.md` (+23). |
| `1ad5aa0` | Maanav Shah <126866160+Rabbitshah@users.noreply.github.com>, Fri 14 Aug 2026 14:28 +0530 — "BE-W8: record the real scheduled retention run, not a manual dispatch". Touches `.ai-collab/decisions.md` (+13 −3) and `PROJECT-OVERVIEW.md` (+44 −19). |

Both are Backend record-keeping. Neither touches frontend code, `packages/`, `apps/`
or the lockfile.

`git merge-base --is-ancestor origin/main HEAD` exits **1**. The histories have
genuinely diverged: 31 local commits over a base that no longer includes origin's two.
**A merge or rebase is required**, and that is the reviewer's decision — nothing was
merged, rebased, pulled or reset here.

One thing to know before choosing: `1ad5aa0` **deletes 19 lines** from
`PROJECT-OVERVIEW.md`. Whichever way the two lines of history are reconciled, that
deletion will appear in the range the new append-only guard inspects, and the guard
will fail the build on it. The guard is right and the commit predates it; the
reconciliation needs a decision about which base the guard compares against.

**The safe-area defect is every screen, not the sign-in screen.**

`react-native-safe-area-context` is a dependency and `SafeAreaProvider` **is** mounted
in `apps/field/app/_layout.tsx`. Nothing consumed it. The `Stack` runs with
`headerShown: false`, so no navigation header reserved the status bar either.

| Route | Renders inside `Screen` | Consumed an inset before this change |
| --- | --- | --- |
| `app/index.tsx` | yes | no |
| `app/sign-in.tsx` | yes | no |
| `app/home.tsx` | yes | no |
| `app/doctors.tsx` | yes | no |
| `app/queue.tsx` | via `QueueScreen`, which renders `Screen` | no |

A repo-wide grep for `SafeAreaView`, `useSafeAreaInsets` or `edges=` returned three
hits, all of them the provider in `_layout.tsx`.

**The fix is one component: `packages/ui/src/Screen.tsx`.** Every route renders inside
it, so the inset is applied there once, added to the token padding rather than
replacing it — `space.md` is the design's margin, the inset is the device's hardware,
and neither substitutes for the other. There is no pixel literal; the numbers come
from `useSafeAreaInsets()`. A per-screen `SafeAreaView` was rejected: it leaves the
next new screen broken by default, which is exactly how this defect arrived.

The hook throws when no provider is mounted, and that is kept — a missing provider
should fail loudly rather than silently render zero insets. It does mean both jest
projects need the library's own mock, which is now installed in
`packages/ui/jest.setup.cjs` and `apps/field/jest.setup.cjs`.

**The test, and the negative control.** `packages/ui/src/Screen.test.tsx` asserts
arithmetic, not the presence of a wrapper: `padding === space.md + inset`, with a
distinct non-zero value on each edge, so an implementation that wired `insets.top`
into all four sides fails. Note that the shipped mock's insets are **all zero** unless
a context supplies otherwise — a test resting on its defaults would assert
`md + 0 === md` and pass with the fix removed — so the test supplies its own metrics
through `SafeAreaProvider`.

With the inset removed from `Screen`:

```
● Screen safe-area inset › adds the device inset to the token padding when the screen does not scroll
  Expected: 63
  Received: 16
● Screen safe-area inset › adds it to the content container when the screen scrolls
  Expected: 63
  Received: 16
Tests: 2 failed, 17 passed, 19 total
```

Restored: `Tests: 19 passed, 19 total`. `packages/ui` render tests went 17 → 19; the
vitest side is unchanged at 4; `apps/field` is unchanged at 44 + 24. No count dropped.

**What the test does not prove.** Mock insets are not device insets. It proves the
arithmetic and that the value reaches the content container; it does not prove the
number is right on a punch-hole display, in landscape, with a three-button navigation
bar, or with the gesture bar. **Deferred verification: a fresh screenshot of the
sign-in screen on the Pixel 10 emulator showing the heading clear of the status bar.**
Until that exists the defect is fixed-and-tested, not closed.

**`apps/field/expo-env.d.ts` was a generated file, and is now untracked.** Expo
rewrites it on `expo start` — it had already replaced the committed comment with its
own "This file should not be edited and should be in your git ignore". It was
committed on the theory that `pnpm typecheck` needs it on a fresh clone; that was
tested on 31 August by moving the file aside, and the field typecheck passes without
it. `git rm --cached` plus a root `.gitignore` entry. This is part of why the working
tree has never been clean.

**Two corrections to the record, both the reviewer's.**

1. _Original claim:_ repeated references, across several prompts, to
   `check-contrast.ts`. _Correction:_ **no file of that name exists.** The contrast
   guard is `packages/ui-tokens/src/contrast.test.ts`. _Source of error:_ the
   reviewer, after having written the rule that forbids referencing artefacts not
   present in the repo.
2. _Original claim:_ the contrast guard was "present in the repo but never invoked —
   decorative". _Correction:_ the mechanism was wrong. A `.test.ts` runs with its
   workspace's suite; it was never uninvoked locally. The accurate statement is that
   **CI has never executed, so no test in this repo has ever run anywhere except the
   authoring machine.** Same risk, different cause — and a different fix, since
   nothing needed wiring up, only a pipeline that runs.
   _Source of error:_ the reviewer.

**Two failures CI will hit, both pre-existing and neither fixed here.**
`packages/ui/src/QueueScreen.test.tsx:200` fails `lint` with
`@typescript-eslint/no-explicit-any` and `no-unsafe-member-access` — verified
pre-existing by stashing every change from this session and re-running. And
`apps/field/jest.config.cjs` was non-conforming for `format:check` as committed in
`1aafc5c`; it is conforming now only because this session's edit to that file ran it
through the formatter.

---

### FE-Build-2e — reconciliation with origin (31 August 2026)

**Merge, not rebase — and the reasoning matters more than the ruling.** Both backend
commits touch `PROJECT-OVERVIEW.md` and `.ai-collab/decisions.md`, which the frontend
line also touches. Replaying 32 commits through a conflicting file means resolving
substantially the same conflict up to 32 times, and every pass is a fresh chance to
drop a line from a file whose whole point is that nothing gets dropped. One merge is
one conflict, one resolution, one reviewable diff.

**In the event there were no conflicts at all.** `git merge origin/main` auto-merged
both files with the `ort` strategy: `.ai-collab/decisions.md` (+36 −3),
`PROJECT-OVERVIEW.md` (+44 −19). The two sides had edited different regions — backend
its own retention sections, frontend appending at the end — so nothing needed
adjudicating and no resolution rule had to be applied.

What the two commits contained: `b5d03a5` (Maanav Shah, 23 Aug) recorded the retention
workflows being disabled again; `1ad5aa0` (Maanav Shah, 14 Aug) corrected the claim
about the scheduled retention run and rewrote the surrounding paragraphs, which is
where the 19 deletions come from. Backend's own edit to backend's own section,
predating the append-only rule.

**Nothing frontend was lost.** `git diff backup/pre-merge-31aug HEAD --stat` shows
exactly two files changed — `.ai-collab/decisions.md` and `PROJECT-OVERVIEW.md` — and
no other path. The R1 rename `f34ceef` ("FE-R1: remove a third party's trademark from
the permanent identifiers") is still an ancestor of HEAD, and `apps/field/package.json`
still reads `@fieldforce/field`. All ten `### FE-` sections are present. Test counts
are identical either side of the merge: core 21, mock 40, ui-tokens 38, ui 4 + 19,
field 44 + 24, api 333 — **523 across six packages**, before and after.
`backup/pre-merge-31aug` is kept.

**Correction — the append-only guard was never at risk, and the error was mine.**

_Original claim (FE-Build-2d, and repeated):_ `1ad5aa0`'s 19 deletions "will land in
the range the new append-only guard inspects, and the guard will fail on it", so the
reconciliation needed a decision about the guard's base.

_Correction:_ **wrong, and demonstrated wrong.** `git diff A...B` is
`git diff $(git merge-base A B) B`; it excludes everything on A's side of the base.
After the merge, `origin/main` **is** the merge base — `git merge-base origin/main
HEAD` returns `b5d03a5`, which is `origin/main` itself — so the range contains only
commits absent from origin, and `1ad5aa0` is not among them. Run against the merged
HEAD, the guard's exact command gives:

```
$ git diff --numstat origin/main...HEAD -- PROJECT-OVERVIEW.md
1512	0	PROJECT-OVERVIEW.md
Deleted lines: 0
PASS: append-only respected.
```

1512 insertions, **zero deletions**, exit 0. Three-dot semantics already handle this
and no redesign is needed. `git log --oneline origin/main...HEAD` lists 33 commits and
`1ad5aa0` is not one of them.

_Source of error:_ Claude Code, reasoning about the range instead of running it — on
a guard whose entire justification was that a rule nobody has executed is not a
control.

**The lint failure blocking `static` is fixed.** `packages/ui/src/QueueScreen.test.tsx`
reached into the rendered tree with `(glyph as any).props['children']` to read the
status glyph. The `any` was avoidable, so it was typed rather than silenced:
`children` is `ReactTestInstance | string`, and the test now narrows, throwing a
legible error if the tree ever changes shape, instead of reading `.props` off a string
and asserting on `undefined`. It also now asserts the value is a string before
checking it against the allowlist — strictly stronger than before. Repo-wide `lint`:
**7 tasks, 7 successful.** Render suite unchanged at 19.

**`format:check` has never run in CI, and the one failure we found was found by
accident.** `apps/field/jest.config.cjs` was non-conforming as committed in `1aafc5c`
and conforms now only because an unrelated edit in FE-Build-2d ran it through
prettier — nobody looked for it. Confirmed after the fact by checking that file's
content at `90ede3c` with the repo's own prettier: non-conforming. Repo-wide
`format:check` now reports exactly one file, `services/api/scripts/seed-one-mr.mjs`,
which is **untracked** and therefore invisible to CI; it has been left alone. No
tracked file is non-conforming.

A method note, because it nearly produced a wrong answer: checking formatting in a
`git worktree` of an old commit reported only `PROJECT-OVERVIEW.md` and missed
`jest.config.cjs`. The worktree has no `node_modules`, so `npx` fetched a different
prettier. **Check historical formatting by extracting the file into the working repo,
not by running the tool in a dependency-less worktree.**

**The flake is logged, not closed.** `docs/gotchas.md` gains a "Known flakes" heading
and an entry for `apps/field` › `doctors.tsx` › "renders a denial as a denial" — one
failure, on the first run after `jest.setup.cjs` was added, four passes since, with a
stale-transform-cache hypothesis recorded as a hypothesis. The entry carries the rule
that a second occurrence is investigated as a real race and not re-run. It also
records the mistake made at the time: the failure output was not captured before the
re-run, so there is nothing to diagnose from.

---

### FE-Build-2f — untracked files closed, push-readiness recorded (31 August 2026)

**The canonical status document was not in the repository.** `docs/frontend-status.md`
opens by declaring itself canonical, and a pointer file exists specifically to redirect
readers to it — a duplicate having been reduced on the grounds that two documents
claiming the same truth diverge. It was untracked for the entire project to date, so
the one document everyone was told to read was the one document not in the repo, while
a rule requiring referenced documents to be present was in force. It is committed now.

_Original claim:_ the frontend status lives at `docs/frontend-status.md` and the
duplicate defers to it. _Correction:_ true of the content, false of the repository —
the file existed only in the working tree of one machine, and a fresh clone had the
pointer without the target. _Source of error:_ the reviewer.

**It was stale in three of the four respects checked**, and was corrected rather than
rewritten: the merge with origin was absent, the safe-area fix was absent, and the
test figure read 521 with `ui` jest at 17 (now 523 and 19). It was already accurate
that CI has never run. Four further corrections while in there: the commit count
("23+" → 34, previously flagged as unverified), JDK 25 and the path-length blocker
moved from LIVE to resolved, "the app has never been built" replaced with
`emulator-passed / device-pending`, and the emulator corrected from "Pixel 10 Pro XL /
API 37.1" to **Pixel_10, API 36 / Android 16** — the tool version having been read as
an API level. A new "Since FE-W2b" section records FE-Build-1 through 2f.

**`apps/field/.gitignore` is redundant, and is ignored rather than committed.** Its
only entry is `expo-env.d.ts`; with the file moved aside, `git check-ignore -v`
reports `.gitignore:75` — the root already covers it. Committing it would invite the
churn `expo-env.d.ts` itself caused, since Expo rewrites it on prebuild and the tree
goes dirty with nobody having edited anything.

**The `npx`-in-a-worktree trap is recorded in `docs/gotchas.md`.** A worktree has no
`node_modules`, so `npx` fetches different tooling and silently answers a different
question: it reported one non-conforming file at `90ede3c` where the correct method —
extract the historical file into the working repo and run the repo's own binary —
found two. Generalised there to anything depending on `node_modules`: prettier,
eslint, tsc, jest.

**`docs/push-readiness.md` is new**, and is deliberately a statement of exposure
rather than a status or a plan: 34 commits waiting, the oldest `dd9c1a4` from
**14 August**; every quality figure self-reported because CI has never executed;
`origin/main` still serving the pre-rename `@elmiron/*` identifiers, so a clone today
carries a third party's trademark in the package names; one blocking action owned by a
human — `repo` scope on the token, plus `workflow` scope now that
`.github/workflows/ci.yml` has changed; and two deferred verifications that need the
emulator, the safe-area screenshot and the glyph rendering check.

**This is the final local commit before the token is resolved.** Nothing remains that
does not require either the GitHub token or a device. **No feature work proceeds until
CI has run green once** — FE-W3 does not start on the strength of 523 tests that have
only ever run on the machine that wrote them.

---

### FE-Build-2g — offline backup and corrected push diagnosis (31 August 2026)

**Correction: the 403 was never a token scope problem, and the error text said so all
along.**

_Original claim,_ recorded in FE-Push-1, FE-Build-2c, 2d, 2e and 2f and carried into
`docs/push-readiness.md`: the push is blocked on a personal access token lacking
`repo` scope, with `workflow` scope needed as well.

_Correction:_ the failure is
`remote: Permission to Praverse-Tech-Pvt-Ltd/Elmiron-App.git denied to Devpt1904`,
HTTP 403 — an **authorisation failure at the account level.** `Devpt1904` has no write
access to the repository. A token carries the permissions of the account that issued
it and cannot exceed them, so no scope change reaches this. GitHub names the account
and says *denied*; it does not say that for a missing scope, which presents
differently.

The fix needs another person, and is one of: an org owner grants `Devpt1904` write
access, directly or through a team; or the push is made from an account that already
holds it — `Rabbitshah` authored **and committed** `b5d03a5` on 23 August, so that
account can write here; or, as a fallback only, a SAML SSO authorisation, which would
present as its own distinct error and does not match this one. The `workflow` scope
requirement is real but **secondary** — it applies only once a push is authorised at
all, because `.github/workflows/ci.yml` is among the modified files.

_Source of error:_ the reviewer, and Claude Code for repeating it without reading the
message closely. What caught it was writing `docs/push-readiness.md`: stating the
blocker for a stranger meant pasting the error verbatim, and the verbatim text names
an account rather than a scope. **A diagnosis nobody has to write out is a diagnosis
nobody checks.**

**Which makes the single-machine exposure the live risk, not the push.** A permissions
grant depends on another person and may take days; thirty-six commits since 14 August,
including the FE-R1 trademark rename that exists nowhere else, sit on one laptop.
`backup/pre-merge-31aug` protects against a bad merge and against nothing else.

**`C:/dev/elmiron-app-31aug2026.bundle`** — 1,043,791 bytes, one file, complete
history and all five refs, no remote and no permissions required. `git bundle verify`:
*"is okay"*, *"records a complete history"*, sha1. Test-restored by cloning it to a
scratch directory: tip `142e6bc` matching the source, 71 commits matching the source,
`f34ceef` an ancestor of HEAD (exit 0), `backup/pre-merge-31aug` carried across as a
remote-tracking ref at `f658ab2`, and `apps/field/package.json` reading
`@fieldforce/field`. The scratch clone was then deleted. `*.bundle` is gitignored — a
bundle committed into the repository it backs up is circular.

**The bundle is not yet a backup.** It is on the same disk as the repository. It
becomes one when a copy exists off this machine, and not before. That copy is a human
action and nothing here can perform it.

---

### FE-W3-SPEC — field capture specified, decisions raised (31 August 2026)

`docs/fe-w3-spec.md` exists. **No FE-W3 code was written, no dependency added, and
nothing under `apps/`, `packages/` or `services/` was touched except to read it.**

**The finding that matters: the backend is not greenfield here, and it is narrower than
"tracking".** `check_ins` and `check_outs` store one fix each;
`public.daily_mileage()` sums straight-line hops between consecutive check-ins and
reads no other source of position; there is no location-fix, trace or breadcrumb table
among the thirty-four; and `SyncEntitySchema` has no entity for one. `packages/core`,
`services/api` and `services/mock` agree field for field — **no contradictions found**.
Choosing continuous tracking is therefore new schema, a new sync entity, a new
retention rule and a necessity argument, not a client-side feature.

**The second finding: location has no retention at all.** Audio carries `purge_after`,
a retention worker, a destruction log and an intake-stops-if-retention-stalls check.
Check-in coordinates have no purge column and no deletion path. Today the honest answer
to "how long is location kept" is **forever, and nothing deletes it** — while the
retention machinery that would have to enforce any answer is itself currently disabled.

**Six decisions are raised and none is answered:** collection frequency and precision;
retention; what the MR is told and when; behaviour on denial or coarse-only grant;
whether location makes a visit valid or is advisory metadata; and whether shift-end
enforcement is client-side or server-side. They are policy with legal consequences
under the DPDP Act and employment law, they need a human decision and in places
qualified legal advice, and the specification says so at the head of that section
rather than choosing.

Android behaviour is sourced inline to Android developer documentation and Play policy.
**Four claims are marked unverified rather than stated:** the exact expiry conditions of
"only this time"; permission auto-reset for unused apps; the presentation of the
foreground-service notification on Android 13+; and the OEM specifics for Oppo, Vivo and
Samsung, since only the Xiaomi page was read. OEM behaviour is recorded as empirical and
crowd-sourced, because the vendors do not document it.

One consequence worth surfacing early: `ACCESS_BACKGROUND_LOCATION` triggers a Google
Play permissions declaration with a video and a prominent in-app disclosure, and the
policy's listed acceptable uses are all user-benefiting features. An employee-monitoring
framing is not among them. That is the same shape as the Apple probe in
`docs/mr-work-split.md`, and the same answer applies: find out early.

**No FE-W3 code is to be written until those decisions are answered and CI has run
green once.** Both conditions, not either.


---

### FE-W3 — onboarding, permissions and OEM battery setup (1 September 2026)

**Plan W3 was skipped and is now closed.** `docs/mr-work-split.md` §2 gives Week 3
Frontend as "Onboarding: permission rationale + per-OEM battery setup". Weeks 4 and part
of 5 were built instead. This closes it.

**The numbering correction, recorded because two things now carry the same name.**
Earlier prompts and the two commits below used "FE-W3" for field capture and background
geolocation:

- `db2ab2e` docs: specify FE-W3 field capture before building it
- `3b64ea1` docs: record FE-W3-SPEC — six decisions open, no code until they are answered

That was wrong. **Field capture, geofence, check-in and shift start/end are plan W5.**
Plan W3 is this sprint. `docs/fe-w3-spec.md` and the `FE-W3-SPEC` entry above are
therefore *W5* specifications under a W3 filename, and neither has been renamed here —
renaming a committed spec mid-flight is worse than a recorded correction. **The gate in
that entry — "no FE-W3 code until those decisions are answered and CI has run green
once" — belongs to the W5 work and is untouched.** Nothing in this sprint requests a
position, reads a fix, or crosses into it.

#### Detection, and the Realme/Oppo trap

`apps/field/src/onboarding/oem.ts` maps `{ manufacturer, brand, model }` to one of five
families. The input is a plain object, not a native module: `Platform.constants` is read
once in `device.ts` and passed in, so the mapping — the part with the bugs in it — is
testable under vitest with no device.

**Brand is matched before manufacturer, and that ordering is the whole point.** Realme
was spun out of Oppo and Realme handsets have historically reported `manufacturer=OPPO`
while reporting `brand=realme`. Reading manufacturer first is a passing-looking
implementation that walks a Realme user through ColorOS's three-settings-in-three-places
flow when Realme UI puts two settings on one screen — nothing on their phone matches
what the app tells them to tap. **Negative control run:** deleting the `realme` brand row
so the lookup falls through to `manufacturer=OPPO` fails with
`expected 'oppo' to be 'realme'`, and the row was restored.

Two smaller decisions, both asserted: matching is on **exact tokens, never substrings**,
because a false positive ("vivobook") is strictly worse than `unknown`; and the lookups
are `Map`s rather than object literals, because the key comes off the device and
`brand: "constructor"` resolves through `Object.prototype` to a function that is not
`undefined`. `unknown` is a first-class outcome with its own screen — it is the majority
of the world, every Pixel and every emulator.

#### The unresolvable-intent rule

`startActivity` with a component that does not resolve throws
`ActivityNotFoundException`. Not a rejected promise — a crash, on the settings screen of
the onboarding flow, on first run, on exactly the device population the feature exists
for. `apps/field/src/onboarding/intents.ts` holds **one table, one place**, and
`launch.ts` enforces four rules: probe before offering; render usefully with zero working
intents; wrap the launch regardless; never throw. `launchSettings` has no throwing path
and returns `'opened' | 'unresolvable' | 'failed'` — there is deliberately no `'error'`
member, because a settings screen that will not open is the ordinary condition here.

**Read from `IntentModule.kt` in the installed React Native rather than from the docs**,
because the three APIs are not interchangeable:

- `sendIntent(action)` builds `Intent(action)`, calls `resolveActivity` first and
  **rejects** rather than throwing.
- `openSettings()` builds `ACTION_APPLICATION_DETAILS_SETTINGS` **with the `package:`
  data URI** and catches into a rejection. `sendIntent` can set extras but not data, so
  that action sent as a bare action would resolve, launch and land nowhere — a
  working-looking button that does nothing, which is worse than no button.
- `openURL`/`canOpenURL` build `Intent(ACTION_VIEW, Uri.parse(url))` and never parse a
  component out of an `intent://` URL.

**So React Native cannot target a vendor component at all**, and `expo-intent-launcher` —
a native module, therefore a dev-client rebuild — is not a dependency. The four
component-targeted vendor intents are declared in the table, marked inexpressible, and
their buttons never render. **The designed fallback is not hypothetical: it is the
shipping default on every device.** Widening `SUPPORTED_TARGET_KINDS` is the only change
needed when the module lands; no screen changes with it.

One narrowing is recorded rather than hidden: React Native exposes no `resolveActivity`
for a bare action, so `probe` returns true for the two expressible kinds and the real
check is the one `sendIntent` performs natively immediately before launching. The check
still precedes any activity start; what is lost is only hiding the button in advance, and
rule 2 is what makes that acceptable.

#### The screens

A5-A8 are one component (`packages/ui/src/OemBatteryScreen.tsx`) with four sets of copy
in `oem-content.ts`, plus a generic screen for `unknown`. Steps carry a Done state, which
is **not persisted**: these are settings on the phone, the app cannot read back whether
the MR changed them, and a tick surviving a restart would be the app asserting something
it does not know.

**The 20-second videos do not exist.** The control renders **disabled, labelled
"20-second video — not recorded yet"**, rather than being omitted — omitting it would
leave no trace that a designed element is missing. No third-party link: putting these
steps on YouTube would send an MR's device identity to Google on first run of an app
whose premise is careful handling of what it collects.

A3 names all four notification types and states a numeric cap. A4 defers the microphone
to the first real visit and **keeps the MR's own voice note separate from recording the
doctor** — asserted as two distinct rendered nodes, so a rewrite that merges them into
one friendly sentence about "recording" fails. S4 gives two actions as two
`PrimaryButton`s, equal in the markup and not only in the copy.

**Background location is not requested, declared or prepared for.** Android will not
grant it in the same prompt as foreground location, and `FE-W3-SPEC` raises the Play
declaration as an open decision. `REQUESTS_BACKGROUND_LOCATION = false` is asserted.

**S4's ₹600 and 14 minutes are the design's estimates and the screen says so on screen.**
Nothing here measured them: no MR has been timed and the mock service is fixtures.

#### Denial blocks nothing, asserted as a property

`permissions.ts` states the three S4 rules as functions rather than prose, and
`permissions.test.ts` checks them across **all 27 permission combinations**:
`reachableRoutes(denied)` equals `reachableRoutes(granted)`; `persistentBannerFor` is
always `null`; `shouldPromptForLocation` is false for `app-launch`, `screen-focus` and
`elapsed-time` across 500 simulated launches and true only for
`explicit-user-request`. There is no attempt counter and no backoff — those are designs
for asking repeatedly. Manual check-in is returned in every state.

These read as tautologies. They are tautologies a future `if (location === 'denied')`
would break, which is the point.

#### Boundary

No geofence, check-in/out or shift start/end (plan W5). No consent handoff (plan W6, and
it needs the doctor test first). No recording UI (plan W7). No dependency added.

#### Tests

| Package | Before | After |
| --- | --- | --- |
| `@fieldforce/field` vitest | 44 | 115 |
| `@fieldforce/field` jest | 24 | 48 |
| `@fieldforce/ui` vitest / jest | 4 / 19 | 4 / 19 |
| `@fieldforce/core` vitest | 21 | 21 |
| **Total** | **112** | **207** |

`pnpm typecheck`, `pnpm lint` and the format check pass. `prettier --check` still reports
`services/api/scripts/seed-one-mr.mjs`, which is untracked and predates this work.

`expo export --platform android` was also run, and the Hermes bundle contains the copy
from all four new screens. That is more than the tests prove: it shows the new routes
resolve under **Metro**, whose resolution differs from both TypeScript's and jest's — the
onboarding modules were first written with NodeNext `.js` import specifiers, which
typechecked and would have failed to bundle. One environment note: the `expo` shim in
`apps/field/node_modules/.bin` points at a path that does not exist under this repo's
`nodeLinker: hoisted`, so `pnpm run export` fails with `Cannot find module`. Invoking
`node node_modules/expo/bin/cli` from the repo root works. Pre-existing, not from this
sprint.

#### Run on the emulator

The debug build was run against Metro on a Pixel emulator (`com.praversetech.fieldforce`,
Android 16) and the flow was exercised by hand.

**Intent resolution, queried directly from the package manager rather than inferred:**

| Intent | Resolves |
| --- | --- |
| `IGNORE_BATTERY_OPTIMIZATION_SETTINGS` | yes — `Settings$AppBatteryUsageActivity` |
| `APPLICATION_DETAILS_SETTINGS` + `package:` data | yes — `applications.InstalledAppDetails` |
| `com.miui.securitycenter/...AutoStartManagementActivity` | no activity found |
| `com.coloros.safecenter/...StartupAppListActivity` | no activity found |
| `com.vivo.permissionmanager/...BgStartUpManagerActivity` | no activity found |

**Two of two expressible intents resolve; three of three vendor components do not** —
which is the expected shape on a Pixel and is exactly what the design predicts.

The emulator detects as `unknown` and got the generic screen, with both steps, both
"What you'll see" lines, both Done toggles and both shortcuts. Pressing them:

- step 1 opened **App battery usage**;
- step 2 opened **this app's own App info page**, with its battery entry on it.

**That second result is the justification for the `app-settings` kind existing.** Sent as
a bare action through `sendIntent`, `APPLICATION_DETAILS_SETTINGS` has no `package:` data
and does not reach that page — the button would have looked like it worked and gone
nowhere. It was written as its own kind on the strength of reading `IntentModule.kt`, and
the device confirms the reading.

The app returned intact from both launches, the Done toggle flipped to "Done", and
**logcat shows no `ReactNativeJS` warning or error at all.** The LogBox toast visible in
the screenshots is Metro failing to serve `LogBoxImages` — a `react-native@0.86.3` /
`0.86.2` skew under pnpm, present before this work and unrelated to it.

S4 was rendered on the device too: two buttons of identical weight, and the estimate
disclaimer under the ₹600 line.

#### Not verified without a physical device

The emulator is AOSP. It has none of the four vendor ROMs on it, so it cannot answer the
questions this feature exists to answer. The following are **unverified**, and the first
three are the feature's whole subject:

1. **That any vendor component intent resolves on any real handset.** Every one is
   crowd-sourced; none has been opened on a Xiaomi, Oppo, Vivo or Realme.
2. **That `Platform.constants.Brand`/`Manufacturer` carry the values assumed** — in
   particular that a current Realme still reports `manufacturer=OPPO`. The mapping is
   tested; the fingerprints it is tested against are not observed from hardware.
3. **That the numbered steps match what the current MIUI, ColorOS, Funtouch and Realme UI
   actually show**, including the "What you'll see" wording, which is the line whose
   entire job is matching the vendor's screen.
4. **That `Linking.openSettings()` and the battery-optimisation action reach a useful
   page on each of the four skins.** Both work on the AOSP emulator (above); the skins
   reorganise these pages and that is not evidence about them.
5. **That the app survives the OEM killers at all** — the premise of the sprint, testable
   only by leaving a build in a pocket for an hour on each of the four.
6. Android 11+ package-visibility behaviour without a `<queries>` declaration.

#### Copy that is not sourced

`docs/design/` **is not in this repository** — the four Phase documents were never
committed — so this was built from the written extract in the prompt, and the gaps are
flagged in code rather than filled in:

- **A8's numbered steps are not in the extract.** Its two step titles are derived from
  the extract's own words ("two settings, same screen", and Realme UI's ColorOS lineage
  whose settings A6 names), and A8 carries **no "What you'll see" line** because that text
  would be fabricated. `A8_STEP_DETAIL_IS_UNSOURCED` and a test hold the gap open.
- **A3's four notification names are derived from features in this codebase**, not
  transcribed from Phase 2, and **the cap number is not sourced at all** —
  `NAMES_ARE_DERIVED`, `DAILY_CAP_IS_UNSOURCED`. Both must be checked against Phase 2
  before this screen ships.
- A1, A2 and S1-S3 were **not built**. The extract does not describe them and inventing
  screens is worse than leaving the sprint visibly partial.

---

### PLAN-01 — completion plan produced (7 September 2026)

Produced under §9 of the reviewer's Completion Brief v2. **No implementation.** Nothing
pushed. Output is `docs/COMPLETION-PLAN.md` plus this section.

**What was verified, with evidence**

- **The frontend branch is merged and the push is not blocked.** `git push --dry-run` →
  `Everything up-to-date`; both `a60423a` and `32cb85e` are ancestors of `main`.
  **CI has run four times on `main` today and all four passed**, including run
  `34095377527` on the commit carrying all four design phases. **B2 is closed.**
- **The suite is 1,086 tests across seven workspaces and two runners**, measured per
  workspace with `--force`: core 21, ui-tokens 54, ui 4 + 221, field 320 + 72, console 10,
  api 344, mock 40.
- **The app captures audio.** `expo-audio@~57.0.4`; `useAudioRecorder` in
  `apps/field/app/visit/[id].tsx` and `app/voice-note/[visitId].tsx`. The upload endpoint
  is declared and **no client reaches it** — `voice-note/[visitId].tsx:141`.
- **No write path reaches Supabase.** `grep` for `supabase.from`/`.insert(`/`.upsert(`/
  `.update(` across `apps/field` returns nothing. Authentication is the only real
  round-trip. **G-WRITE is open.**
- **The mock persists nothing** — proven by POSTing a probe string, failing to read it
  back (`No mock route for GET /analyses/abc/overrides`), and finding it in no later
  response.
- **`GET /analyses/:id/overrides`, the audit-log read path and the retention read path are
  all absent**, confirming the three S2 endpoint claims.
- **G-CRON is not met.** The most recent *scheduled* run of either retention workflow is
  23 August 2026 and it failed. Re-enabled 7 September; nothing has fired since.
  Re-check: `gh run list --workflow=retention.yml --json event,createdAt,conclusion`.

**What was corrected**

- **34 tables, not 40.** Live query: 34 tables, RLS enabled **and forced** on all 34,
  41 policies, 6 views — `34 + 6 = 40`. The handoffs conflated tables with views. This
  section of `PROJECT-OVERVIEW.md` was already right.
- **The 1,049-across-six test table is stale**; the 1,086-across-seven figure is correct.
  The seventh workspace is `@fieldforce/console`.
- **§3.6 is closed, not open.** `docs/fe-w3-spec.md:557-580` records a **second** reversal
  on 3 September reopening E1 and E2, both of which are built in `apps/console`. But
  `apps/console/src/app/admin/page.tsx:154-160` still renders **"The manager console is
  not here — §3.6 forbids that"**, and `docs/frontend-status.md:34,43` still lists them as
  held. A user-facing screen currently states a constraint that no longer applies.
- **There is no root `app.json`.** The stale `com.anonymous.elmironapp` exists only in
  prose (`docs/frontend-handoff-2026-09-07.md:94,186`, `docs/frontend-status.md:276`, and
  line 3820 of this file). `apps/field/app.json` correctly declares
  `com.praversetech.fieldforce`. The brief's S0 code task is a no-op.
- **The brief's checkout guard fails open.** It requires the toplevel to be
  `C:/dev/Elmiron-App`. This machine is `C:/Users/Admin/StudioProjects/Elmiron-App` — a
  third path, verified legitimate by namespace (`@fieldforce/*`), remote, and the presence
  of `f34ceef`. The guard should test namespace and remote, not path.

**What remains UNVERIFIED**

- **Every production claim.** `list_projects` on the connected Supabase account returns
  only `HealthMate Mennie` and `praverse-ems`; the Elmiron-App project is not in it.
  `~/.elmiron-prod.env` does not exist here, there is no repo-root `.env`, and
  `services/api/supabase/.temp/project-ref` is absent. `ACTIVE_HEALTHY`, the 19 deployed
  migrations, the absence of reference data (B11) and the free-plan pause (B14) are all
  taken from documents and were **not** confirmed from this machine.
- The local database's 29 organisations / 101 territories / 38 doctors are **test-fixture
  residue from the 344-test `api` suite**, not reference data, and are not evidence
  against B11.
- The full G-RLS adversarial matrix was not re-run in this session; the 344 `api` tests
  passed against a live local stack.

**One environment finding.** Under `turbo run test` with the emulator, Docker and Metro
running, `@fieldforce/ui` and `@fieldforce/field` produced four `Exceeded timeout of
5000 ms` failures. Run sequentially per workspace on the same commit, all 1,086 pass. A
green suite on this machine is conditional on machine load; CI is the arbiter.

See **`docs/COMPLETION-PLAN.md`** for the task list (IDs continue from `BE-W8` / `FE-W9`),
the dependency graph, the critical path to G-PILOT, the cut list, twelve risks, and the
refused-task list.

---

### FIX-01 — consent capture race, investigation (7 September 2026)

Read-only investigation of the CI failure on run `34106670307`,
`consent-audio.spec.ts > consent capture > "records consented as a complete, successful
capture"`, 343 of 344 passing. **No fix was written. No test, isolation level or migration
was changed.** The job was not re-run.

Checkout guard passed on substance rather than path: namespace `@fieldforce/*`, remote
`Praverse-Tech-Pvt-Ltd/Elmiron-App`, `f34ceef` an ancestor of `HEAD`.

**Verdict first: this is not a test-only race. It is a latent consent-integrity defect, and
the test has been asserting the defect as though it were the requirement.**

#### The volatility diagnosis — confirmed

`\df+` on the live database:

| Function | Language | Volatility | Security |
| --- | --- | --- | --- |
| `public.capture_consent` | plpgsql | **volatile** | definer |
| `public.active_consent_text` | sql | **stable** | definer |

Under `READ COMMITTED` a `STABLE` function uses the statement snapshot while a `VOLATILE`
one takes a fresh snapshot per invocation, so the test's single-statement mitigation narrows
the window and cannot close it. That much of the earlier diagnosis holds. **It is also not
the important part.**

#### A2 — `capture_consent` re-derives. It does not accept what the client displayed.

Signature, from the live database:

```
capture_consent(p_id uuid, p_visit_id uuid, p_outcome consent_outcome,
                p_language text, p_not_asked_reason text, p_captured_at timestamptz)
```

**There is no consent-text-id parameter.** The body resolves it server-side and stores what
it resolved:

```sql
v_text := public.active_consent_text(p_language);
...
insert into public.consent_records (..., consent_text_version_id, displayed_language, ...)
values (..., v_text.id, v_text.language, ...)
```

`active_consent_text` is `order by v.effective_from desc limit 1` over rows currently in
force — **whatever is newest right now**, not what was on the screen.

#### A3 — the version displayed can differ from the version recorded

1. The client reads the notice versions and displays one — call it **v1**. The doctor reads
   v1 and agrees.
2. A newer version **v2** becomes active (`effective_from <= now()`).
3. The client calls `capture_consent(..., 'en-IN', ...)`.
4. Inside, `active_consent_text('en-IN')` returns **v2**.
5. The row stores `consent_text_version_id = v2`.

**The newer one gets stored.** The record attests that the doctor agreed to a document they
never saw. `consent_records` has no UPDATE policy and is append-only by trigger, so the
false attestation is permanent by design.

#### A4 — the client is not at fault. It sends the right thing and the server discards it.

- `packages/core/src/field/consent.ts:47` — "The exact text version displayed on screen.
  **Not the current version.**" on `consentTextVersionId: UuidSchema`
- `packages/core/src/field/consent.ts:12` — "A record always references the exact
  `consentTextVersionId` that was displayed … Without that pair you cannot reconstruct what
  the doctor actually agreed to."
- `packages/core/src/field/endpoints.ts:222,232` — `consentTextVersionId` is required on the
  create-consent request.
- `apps/field/src/consent/record.ts:110` — `consentTextVersionId: draft.version.id`
- `apps/field/src/consent/record.ts:14` — "a consent record must be able to prove what was
  on the screen."

**The contract states the requirement in words, and the client honours it. The database
function has no parameter to receive it.** Contract I1 and the schema disagree, and the
schema wins at runtime.

#### A5 — nothing rejects a stale version

`\d public.consent_records`: seven check constraints, none about the text version. The only
constraint on `consent_text_version_id` is `consent_records_consent_text_version_id_fkey` —
referential integrity, requiring the version to **exist**, not to be the one displayed or
still in force. One trigger, `consent_records_audit`, which writes the audit row. **It
silently accepts.**

`capture_consent` raises only when there is *no* active text at all
(`'no active consent text for language %'`). A stale-but-valid version is never detected,
because it is never transmitted.

#### A6 — the pattern is common; the defect is not

38 VOLATILE-writer / STABLE-resolver pairs exist across the schema. Most re-resolve
**authorisation or server-observed fact** — `effective_role`, `visible_user_ids`,
`is_within_shift`, `visit_is_quarantined`, `audio_purge_is_stalled`, `current_client_ip` —
and for those, re-deriving at write time is **correct**: you want the current permission,
not a stale client assertion.

The defect shape is narrower: *re-resolving a value the client displayed and storing it as
evidence of what was displayed.* The closest analogue, `record_check_in` →
`resolve_shift_window`, stores `v_window.source`, but that is a server-observed fact about
the check-in, and nobody is asked to agree to a shift window.

**On this evidence the defect is unique to `capture_consent`.** The expectation that the
pattern rarely appears once holds for the *pattern*, not for the *bug*.

#### A7 — which of the two is true

**(i) The production path can record the wrong consent version.** The function is deployed,
`SECURITY DEFINER`, and granted `EXECUTE` to `authenticated`.

**With one material qualifier that changes the urgency and not the diagnosis:** no client
currently reaches it. As recorded in `PLAN-01`, no write path in `apps/field` touches
Supabase at all — the app writes to `services/mock`, which persists nothing. **The defect is
real and latent, not active.** It becomes live the moment the real write path lands
(`FE-W15` / `FE-W16` in `docs/COMPLETION-PLAN.md`), which is the next build work planned.

**The test is the second finding, and it is worth as much as the first.** It asserts

```js
expect(result.rows[0]?.consent_text_version_id).toBe(result.rows[0]?.active_id);
```

— that the stored version equals the *currently active* one, which is precisely what
`consent.ts:47` says must **not** be guaranteed. The suite encodes the defect as the
requirement, and its inline comment defends it: "the version comes from the server's
catalogue rather than from the caller." Fixing the test's isolation level would have made
the failure disappear and cemented the behaviour. That is why no fix was written here.

**Recommended shape, for review and not implemented:** `capture_consent` takes the displayed
`p_consent_text_version_id`, stores that, and **raises** if it is no longer in force — so a
stale notice becomes a refusal the MR can see and re-ask, never a silent substitution. That
is a migration, a contract change and a client change, and it needs its own prompt.

#### Part B — record corrections made in this session

- **BE-W9** — `docs/gotchas.md`, appended (145 insertions, 0 deletions): the broken
  `pnpm --filter … exec expo start` under `nodeLinker: hoisted` and its working invocation;
  `adb reverse` dying with the emulator; stopping node processes before `pnpm install`; the
  CMake 3.22.1 long-path failure and the 3.31.6 pin that every `expo prebuild` erases; the
  OOM-killed first native build; `| tail` masking a non-zero exit; `pnpm 11` forwarding `--`
  literally; and the parallel-turbo timeout flake.
- **BE-W10** — corrections appended to `handoff.md` (62 insertions) and
  `.ai-collab/decisions.md` (35 insertions), both as new dated sections leaving the earlier
  claims in place: **"40 public tables" is 34 tables + 6 views** (`information_schema.tables`
  counts views unless filtered to `BASE TABLE`), and **there is no root `app.json`** — the
  stale `com.anonymous.elmironapp` survives only in four prose references.
- **BE-W12** — the path-based checkout guard is replaced by a namespace + remote + `f34ceef`
  check, recorded in `docs/gotchas.md` as a runnable command. Verified both ways: **exit 0**
  in this tree, **exit 1** in a worktree at `f34ceef^`, a real historical `@elmiron/*` tree.
  The worktree was removed afterwards.

**UNVERIFIED.** Production was not inspected: the Elmiron-App project is absent from the
Supabase account connected to this machine, `~/.elmiron-prod.env` does not exist here, and
there is no linked project-ref. Every finding above comes from the local stack running the
same 19 migrations, and from the committed source.

---

### FIX-02 — consent capture records the displayed version (7 September 2026)

> **A TEST WAS DELETED IN THIS CHANGE, AND IT WAS FAILING WHEN IT WAS DELETED.**
>
> `consent-audio.spec.ts > consent capture > "records %s as a complete, successful
> capture"` asserted that the stored `consent_text_version_id` equalled whatever
> `active_consent_text` returned at write time, and its comment defended that as the
> property under test: *"the version comes from the server's catalogue rather than from
> the caller."*
>
> **That is the defect, not the requirement.** `packages/core/src/field/consent.ts:47`
> states the requirement in words — *"The exact text version displayed on screen. **Not
> the current version.**"* The assertion contradicted the contract, and its intermittent
> failure was the schema telling the truth. It was replaced by tests that assert the
> contract's property instead. It was **not** removed to make CI green — the mutation
> proof below shows the replacements fail without the fix.

#### A1 — is `active_consent_text` bounded to the present? **Yes. Hypothesis refuted.**

```sql
where v.language = p_language
  and v.effective_from <= now()
  and (v.effective_until is null or v.effective_until > now())
```

A row dated next month is **not** active, and a retired row is excluded. There is no
second defect here. Asked and answered rather than assumed.

#### A2 — is the ordering deterministic on ties? **No, and it is now.**

`order by effective_from desc limit 1` had no tie-break. Every fixture run seeds its own
`en-IN` notice at `now()`, so rows genuinely compete at the same instant and the winner
was arbitrary — the mechanism behind the "one run in ten" flake.

`created_at` does not settle it either: `now()` is the **transaction** timestamp, so two
rows inserted in one transaction tie on both columns. The new ordering is
`effective_from desc, created_at desc, id desc`. **`id` is the primary key**, so it is
unique and not null, and appending it guarantees a total order and therefore a repeatable
answer.

Recorded honestly: `id desc` is deterministic but arbitrary as a *business* rule. Two
notices genuinely in force for one language at the same instant is undefined data, and
the durable fix is a constraint forbidding it. **That is left for the reviewer.**

#### A3 — is there a server handler between the endpoint and the function? **No. None has ever been written.**

There is no `services/api/supabase/functions/` directory. `capture_consent` is referenced
by exactly four places: its definition (`20260815000300_audio_consent_retention.sql:46`),
its grant (line 861), its rollback, and the test file. Nothing in `packages/core`,
`apps/field` or `services/mock` calls it — the mock serves the endpoint from its own
fixtures, which is why the client's `consentTextVersionId` has never actually been
dropped in practice. **The contract-to-schema gap has never been exercised**, and the fix
is correspondingly smaller: there was no handler to update.

#### The fix — `20260907000100_consent_records_displayed_version.sql`

`capture_consent` takes `p_consent_text_version_id uuid` and stores it. If that version is
not the currently active one for the language, it **raises** — the MR is told the notice
changed and must re-read it and ask again. Never a silent substitution, and never a
fallback to the active version.

**The old function is dropped, not replaced.** Adding a parameter creates an *overload*,
not a replacement; leaving the six-argument version in place would have left
`authenticated` holding `EXECUTE` on the defective path, and the fix would have been
reachable around. Verified: exactly one `capture_consent` now exists, and a test asserts
that count so the overload cannot come back.

**A new SQLSTATE, `45001`, deliberately outside the four standard codes used elsewhere in
these migrations.** The stale-notice refusal is the only failure in this function with a
remedy the MR can carry out, so the client has to be able to tell it apart from every
other refusal. Matching on message text would be the alternative, and message text is not
a contract.

**`displayed_language` still comes from the resolved row**, which is provably the language
of the stored document because the version was checked against that language first.

#### The mutation proof — and the weakness it exposed in the new tests

**Mutation 1, the whole migration reverted.** `40 tests, 5 failed`. The count did **not**
drop, so the mutation was not a no-op.

**It also showed that three of the new tests do not prove the fix.** Two of the three
`it.each` cases *passed* under the reverted migration. The reason is structural and worth
recording: each test seeds a private language with exactly one notice, so re-deriving the
active version and recording the supplied parameter return the **same value**. For a
capture that succeeds, the defective and the fixed implementations are observationally
identical.

**So the fix's entire observable content is the refusal.** The discriminating tests are
the ones that assert it, and the `it.each` is a regression guard on storage and shape, not
a proof. Saying otherwise would overstate what the suite establishes.

**Mutation 2, targeted.** The staleness check alone was removed, keeping the new signature
— so the failure could not be attributed to the signature change. `40 tests, 2 failed`:
the superseded-notice refusal and the non-existent-version rejection. Count unchanged.
**Those two tests prove the check itself.**

Both mutations were reverted with `pnpm db:reset` and the restoration verified by querying
the live function body, not by assuming the reset worked.

#### A contradiction in the brief, resolved and flagged

The prompt asked for both *"a capture supplying version V stores V, even when a newer
version W is active"* and *"a capture supplying a stale version raises"*. **These are
mutually exclusive** — if W is newer then V is stale. Resolved in favour of the refusal,
which the same prompt requires as B2, and the no-silent-substitution property is proved
the stronger way instead: after the refusal, **no `consent_records` row exists at all**,
checked as the table owner so that row-level security cannot make an empty result look
like proof.

#### Counts

- `@fieldforce/api`: **349 passed, 14 files** (was 344). Four tests removed, nine added.
- `consent-audio.spec.ts` alone: **40 passed**, three consecutive runs.
- `verify:rollbacks`: *"All rollbacks applied in reverse order; public schema is empty."*
  **20 migrations, 20 rollback files.**
- `typecheck` and `lint` clean on `@fieldforce/api`.

#### A test race the fix converted from silent to loud

The first version of the new tests read the active `en-IN` version in one statement and
captured against it in the next. Under `READ COMMITTED` another spec can commit a newer
notice between the two — and the fixed function then **correctly refuses**. The old
defect's race did not disappear; it changed from a silent wrong write into a visible
refusal, which is the entire point, but it made the test intermittent.

The new tests each seed **their own language** rather than competing on the shared `en-IN`
catalogue. The property under test is unchanged and the contention is gone.

#### D1 — detecting the class automatically (scoped, not built)

A CI check that walks every `*RequestSchema` in `packages/core`, and for each required
field asks whether any database function parameter or table column could receive it.
Fails the build when one cannot.

- **Catches:** a contract field the schema has nowhere to put — exactly the
  `consentTextVersionId` case, at the commit that introduces it.
- **Misses:** shape mismatches where both sides exist but disagree in meaning
  (`coordinates` as one object versus `p_latitude`/`p_longitude` as two scalars);
  renamed-but-equivalent fields; and a parameter that exists and is then ignored inside
  the function body. It proves a field *can* be consumed, never that it *is*.
- **Cost:** roughly half a day. It needs the live schema, so it belongs in the existing
  database CI job rather than the lint job.

#### D2 — run by hand, and it found a second instance

Nine candidates, of which most are false positives from a deliberately over-inclusive
heuristic — `coordinates` is received as `p_latitude`/`p_longitude`, and `response` and
`items` do exist as `p_response` and `p_items` but were missed by the parser.

**One survives inspection, and it is the same class of defect:**

> **`CompleteUploadRequestSchema.checksum`.** The contract requires
> `checksum: z.string().length(64)` — *"SHA-256 of the complete file, hex encoded"* — and
> `complete_upload(p_grant_id, p_object_id, p_duration_seconds, p_size_bytes,
> p_recorded_at, p_bitrate_kbps)` has **no checksum parameter**. No column in any table
> stores a file checksum either. **The integrity check the contract promises does not
> exist**, on the resumable upload path for audio, where a truncated or corrupted upload
> is exactly what it would catch.

Not fixed here — it is a new task, not part of this session.

#### B5 — existing rows

**70 `consent_records` rows exist locally**, all test-fixture residue, and `pnpm db:reset`
clears them. **Production is UNVERIFIED** — the Elmiron-App project is absent from the
Supabase account connected to this machine and `~/.elmiron-prod.env` does not exist here.

**No backfill was attempted and none should be.** What a doctor was shown cannot be
recovered from a row that recorded something else. Any row written by the old path has a
`consent_text_version_id` that is *probably* right — it is wrong only where the notice
changed between display and capture — and there is no way to tell which. **This is a
records decision, not an engineering one.** The options are to accept them as-is, to
annotate them as written under the old path, or to re-consent. That is the reviewer's.

#### B6 — callers of the old signature

Four references, all updated: the definition and its grant, the rollback, and
`consent-audio.spec.ts`. No seed script, no mock and no application code called it. **No
default was added for the new parameter** — a default would have quietly restored the old
behaviour for every existing caller, which is the failure this fix exists to remove.

---

### FIX-03 — mock/database drift audit (7 September 2026)

#### Part A — pushed, and CI is green

Eight commits pushed, `ea4fdad..bf96918`. **CI run `34111696975`: success, 2m43s**, both
jobs — `typecheck · lint · format · unit tests` (2m4s, ID 101709191813) and
`migrations · Gate 0 RLS suite · rollbacks` (2m39s, ID 101709191976). The `api` suite is
**349 passing**. `main` is green.

#### B1 — the architecture question. Answer: **(i)**, and it was decided deliberately.

**No middle tier is missing.** The intended path is client → PostgREST/RPC with row-level
security, and Edge Functions were **considered and rejected**, twice, with reasons on the
record:

- `PROJECT-OVERVIEW.md:1575` — *"The Edge Function route means a second implementation of a
  compliance-critical worker, in a second language"*, plus *"the local stack runs no edge
  runtime, so an edge-function purge could not be exercised by the tests at all."*
- `PROJECT-OVERVIEW.md:485` — the same route rejected for reads, in favour of routing every
  read through a `SECURITY DEFINER` function.
- `PROJECT-OVERVIEW.md:70` — *"What does not exist yet: HTTP endpoints beyond what PostgREST
  generates from the schema."*

Edge Functions survive in the plans only for the future AI pipeline (`mr-app-plan.md:368`)
and as a rejected option for the retention scheduler. **S3's estimate does not rest on a
missing tier.**

#### B2 — the audit

44 declared paths; `services/mock` defines **52 routes over 43 of them**.

| Pass | ALIGNED | DIVERGENT | NO-BACKEND |
| --- | --- | --- | --- |
| Automated (naive table-name heuristic) | 29 | 8 | 7 |
| **After manual resolution** | **30** | **13** | **1** |

Five of the automated NO-BACKENDs turned out to have a database surface the *contract does
not name*, which is a divergence rather than an absence. `/me` resolves fine. Only
`/sync/pull` has genuinely nothing behind it.

**The shape of the problem, and why nobody saw it.** `services/mock` imports `API_PATHS`
from the contract, so it implements the **contract's** shape faithfully — which is why 52
routes cover 43 of 44 paths and the mock's 40 conformance tests pass. The mock is right
about the contract. **The contract is wrong about the database.** It declares REST-shaped
paths while the database, following the recorded decision above, serves those surfaces
through hand-written RPCs. Seven functions granted to `authenticated` —
`list_consent_records`, `read_consent_record`, `list_analyses`, `read_analysis`,
`daily_mileage`, `begin_upload`, `complete_upload` — appear **zero** times in
`packages/core/src/field/endpoints.ts`.

This is the `capture_consent` defect generalised: contract and schema were each internally
coherent and were never checked against each other.

#### The five that matter most

1. **`POST /analyses/:id/overrides` has no backend at all.** No `analysis_overrides` table
   exists (`select tablename … like '%analys%'` returns only `analyses`), and no function
   has `override` in its name. The mock returns **201 with a fabricated row** —
   `id`, `findingId`, `overriddenByUserId` from fixtures — and `apps/console`'s analysis
   review renders it. **This is the product displaying something no server has ever said**,
   which is the one thing it says it never does. It is also the row `fe-w3-spec.md` calls
   "the evidence of human oversight".
2. **`/consent-records` and `/consent-records/withdrawals`** —
   `has_table_privilege('authenticated','public.consent_records','SELECT')` is **false**.
   The real surface is `list_consent_records` / `read_consent_record`, neither named in the
   contract. Consent path, so category 1.
3. **`POST /sync/pull` — no `sync_pull` function exists.** `sync_push` exists and is
   granted; the pull half of offline sync has no server side at all. This is upstream of
   `FE-W18` and therefore of **FE-G2**.
4. **`/analyses`, `/analyses/:id`, `/analyses/:id/response`** — `analyses` is not
   selectable by `authenticated`; `list_analyses`, `read_analysis` and
   `respond_to_analysis` are the real surface and are unnamed in the contract.
5. **`/uploads/:id` and `/uploads/completion`** — no relation resolves `uploads`. The real
   surface is `begin_upload` / `resume_upload` / `complete_upload` /
   `record_upload_progress` / `abandon_upload` / `my_upload_queue`. **Blocks BE-W16**, the
   audio upload path.

Also found: **`GET /sync/queue` exists only in the mock** — not in `API_PATHS`, and no
caller in `apps/field` or `packages/core`. Dead surface.

#### C — `runPurge` concurrency. Verdict: **test-only. Production is not exposed.**

The hypothesis was that the worker assumes single-instance execution on a path that
permanently deletes audio. **It does not.** `claim_expired_audio` claims every row with
`for update skip locked`, sets `purge_state = 'claimed'` and `claimed_by_run_id`, and
re-claims anything whose `claimed_at` is older than a 15-minute lease. Two instances
partition the work; they cannot claim the same row.

Production cannot run two anyway. `retention.yml` sets
`concurrency: group: audio-retention, cancel-in-progress: false`, so a slow run **queues**
the next rather than overlapping, and `retention-watchdog.yml` runs `check:purge-health` —
**not** the purge worker — under its own separate group.

The intermittent suite failure is two **spec files** sharing one global worker.
`abandoned` comes from `close_stale_upload_sessions()`, a plain
`update … where state = 'open' … returning` counted by the caller: whichever spec's purge
runs first closes the sessions, and the second counts zero. Row locks serialise it, so
there is no corruption — only a split count. Recorded in `docs/gotchas.md`; no production
task raised.

#### Tasks

Thirteen new tasks in **`docs/COMPLETION-PLAN.md` §10 — "Drift tasks — added by FIX-03"**,
`BE-W47`–`BE-W59` and `FE-W21`, ranked by the consequence order above. Includes the two
items FIX-02 left open — the missing upload `checksum` and the same-instant consent
constraint — and `FE-W21`, which records that **no client code maps SQLSTATE at all today**
(`grep -rn "sqlstate\|45001\|errcode" apps/field/src apps/console/src packages/core/src`
returns nothing), so the FIX-02 refusal would currently reach an MR as a generic failure.

**Nothing in Part B, C or D was fixed.** The audit was read-only by instruction.

---

### FIX-04 — orphan function audit and synthetic seed (7 September 2026)

#### Part A — pushed, CI green

`bf96918..69f6957`. **Run `34113543946`: success, 2m44s**, both jobs.

#### Part B — the seven orphan functions

**All seven are `SECURITY DEFINER`**, so RLS does not apply inside them and each
function's own filtering is the entire access control. That much of the hypothesis is
confirmed.

`EXECUTE` is held by `authenticated` **and by `PUBLIC`** — `has_function_privilege('anon',
…, 'EXECUTE')` is `true` for all seven. That is Postgres's default for functions rather
than anything specific to these, but it means the anon path had to be tested, not assumed.

**A correction to the premise.** `app_role` has exactly **three** values — `mr`,
`field_manager`, `admin`. There is no `marketing`, `urologist`, `gynaecologist`, `patient`
or `pv_officer`, because S6 and S7 are blocked on the data-controller model. A 7 × 8 matrix
cannot be built. What exists is 7 × 4, plus the case that actually matters today: **an MR
reaching another organisation's data.**

##### B4 — the matrix, measured

Seeded a consent record and an analysis owned by MR1, then called each function as each
identity. `mr2_other_org` is a second MR in a different organisation and territory tree.

| function | anon | mr1 (owner) | mr2 (other org) | field_manager | admin (+reason) |
| --- | --- | --- | --- | --- | --- |
| `list_consent_records` | REFUSED 28000 | DATA (1 row) | **EMPTY []** | **EMPTY []** | DATA (1 row) |
| `read_consent_record` | REFUSED 28000 | DATA | **EMPTY null** | **EMPTY null** | DATA |
| `list_analyses` | REFUSED 28000 | DATA (2 rows) | **EMPTY []** | **EMPTY []** | DATA (2 rows) |
| `read_analysis` | REFUSED 28000 | DATA | **EMPTY null** | **EMPTY null** | DATA |
| `daily_mileage` | **0 rows** | 1 row | 0 rows | 0 rows | 0 rows |
| `begin_upload` | REFUSED 28000 | GRANTED | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 |
| `complete_upload` | REFUSED 28000 | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 |

##### B5 — verdict: **clean. No cell disclosed data to a caller who should not have it.**

Stated plainly because a clean result is the useful outcome here. Every consent and
analysis read returned the caller's own data, an empty result, or a refusal. No
cross-organisation disclosure. `begin_upload` refuses a visit that is not yours with
`42501`. `admin` reads are gated on a typed reason (`22023` without one) and every one of
the four audited functions **writes its `audit_log` row before it selects**, which is the
break-glass ordering the brief asks for.

**On the EMPTY cells, which look like the finding and are not.** The prompt expected a
refusal rather than an empty result. That question was **settled by the reviewer on
10 August 2026** and the settlement is recorded at `PROJECT-OVERVIEW.md:2386`: *"`403`,
`200 []` and `0 rows affected` are all acceptable; the property is non-disclosure and
non-mutation … The RPC-only-reads option was explicitly rejected as cosmetic."* These four
RPCs exist for a different reason, recorded at line 170: **the audit rule.** Every read of
`consent_records` and `analyses` must be logged, Postgres has no SELECT trigger, so the
tables carry no SELECT grant and the reads go through logged functions. Direct table access
**is** `permission denied` — amendment criterion 3.

**`daily_mileage` measured separately**, because it was the one function that did not
refuse anon. It has no `auth.uid()` check at all; it relies entirely on
`c.mr_id in (select public.visible_user_ids())`. Measured:

```
visible_user_ids() as anon  -> 0 rows
daily_mileage as anon       -> 0 rows
daily_mileage as owning MR  -> 1 rows
```

**No disclosure.** It refuses by emptiness rather than by raising, which is acceptable
under the amended criterion — but it is the only one of the seven whose safety rests
entirely on a helper returning empty, with no second control behind it. Worth knowing if
`visible_user_ids()` is ever refactored.

##### Coverage, and the one real gap

Six of the seven are already exercised by the suite — `read_consent_record`,
`list_analyses` and `read_analysis` by `rls.spec.ts`, the adversarial Gate 0 suite itself.
So the claim that the matrix had never been run against them is **false for six of seven**.

**`list_consent_records` has no test anywhere** — `grep -rl list_consent_records
services/api/tests/*.spec.ts` returns nothing. It is the only one of the seven with zero
coverage, on the consent path. Registered as a task, not fixed.

**Re-check command**, because a "has never fired" claim rots fastest:

```sh
docker exec supabase_db_Elmiron-App psql -U postgres -d postgres -f /tmp/matrix.sql
```

(the matrix script is reproducible from this section; it seeds, calls each function as each
identity inside one transaction, and rolls back).

#### Part C — BE-W17, the synthetic seed generator. Built.

`services/api/scripts/seed-synthetic.mjs`, wired as
`pnpm --filter @fieldforce/api seed:synthetic`.

```
pnpm --filter @fieldforce/api seed:synthetic --mrs 100 --history 1y
```

**Measured, 100 MRs and a year, in 13 seconds:**

| table | rows |
| --- | --- |
| organisations | 1 |
| territories | 25 (three levels: national → 4 regions → 20 areas) |
| territory_shift_windows | 4 (on regions, so areas resolve by walking up) |
| user_profiles | 105 |
| doctors | 100 |
| visits | **208,800** |
| check_ins | **208,800** |
| beat_plans | 26,100 |

Eight visits per MR per weekday, which is the shape BE-W8 sized retention for. Generated
set-wise with `generate_series` rather than row by row; a round trip per row would have
taken hours.

**Three guards, because this script is dangerous by nature:**

1. **Localhost only, enforced in code, no `--force`** — the same pattern and the same
   reasoning as `verify:rollbacks`. Refused against
   `db.abcdefgh.supabase.co` before opening a connection.
2. **It refuses to run twice.** A second run reports that a `SYNTHETIC` organisation
   already exists and stops, rather than doubling the dataset and quietly invalidating any
   measurement taken against it.
3. **Everything it creates is named `SYNTHETIC`.** The file header states in its first
   line that this is **not** `seed-reference-data.mjs` and would be actively harmful in a
   real database — an MR would see doctors who do not exist.

**The accounts cannot sign in**, by design: `auth.users` rows are inserted directly with
no password hash. `seed:mr` remains the way to make a user you can actually sign in as.
Stated in the header so nobody discovers it at a sign-in screen.

**Only three roles are seeded**, and the header says why: `app_role` has three values.
Seeding the nine a pilot will need is not possible, and faking it would produce a fixture
that lies about what the schema can express.

**Verification, all run:** the small case (5 MRs / 30 days → 105 visits) and the full case
above; a second run refuses; a remote URL refuses; `verify:rollbacks` still reports *"All
rollbacks applied in reverse order; public schema is empty"*; and the api suite is
**349 passed, 14 files** with the 208,800-row dataset in place — so nothing in the suite
depended on an empty database. Lint and prettier clean.

**No performance measurement was taken.** Building the fixture and measuring against it are
separate tasks and separate reviews.

#### Part D — `sync_pull` scoped

**D1.** `sync_push(p_batch_id uuid, p_items jsonb)` exists and is granted. **Nothing named
`sync_pull` exists** — no function, no view, no table, and no reference in any of the 20
migrations. The public functions matching `sync%` are exactly `sync_push`,
`sync_queue_status` and `sync_rejection_explanation`.

**D2 — and the half nobody mentioned.** The contract is fully specified:

```ts
SyncPullRequest  { since: IsoDateTime | null, entities: SyncEntity[] | null }
SyncPullResponse { changes: [{ entity, entityId, deleted: boolean,
                               payload: object | null, updatedAt }],
                   serverTime, hasMore }
```

So the intended design is a **watermark** (`since`), not a cursor, with deletes as
**tombstones** (`deleted: true`). The mock returns the fixture queue with `deleted` always
`false`, `hasMore` always `false`, and a **hard-coded `serverTime`** — so the frontend has
never seen a delete, a second page, or a moving clock.

**And `apps/field` has no pull consumer at all.** `apps/field/src/sync/` is entirely
outbox and push — `outbox.ts`, `flusher.tsx`, `reducer.ts`, `indicator.ts`. `grep` for
`syncPull`, `since` or `hasMore` across it returns nothing. **Sync is half-built on both
sides**, not just the server's.

**D3 — what must be decided before anyone writes it**

1. **`hasMore` cannot be honoured by a watermark alone.** With many rows sharing an
   `updatedAt`, a page boundary inside that group is unresolvable — the next `since` either
   repeats rows or skips them. Needs a composite cursor `(updated_at, id)`. **This is a
   contract change, not an implementation detail.**
2. **The watermark gap.** If the client stores `serverTime` as the next `since`, rows
   committed during the pull but stamped earlier are missed **permanently**. Needs an
   overlap window, or `updated_at` taken from commit order rather than transaction time.
3. **What a delete means.** Retention destroying audio, a consent-withdrawal cascade, and a
   row leaving the caller's scope are three different events. The contract has one boolean.
4. **Scope departure specifically.** When a territory is reassigned, does the row arrive as
   `deleted: true`, or just stop appearing? If it stops appearing, the handset keeps data
   the MR may no longer see. If it arrives as a delete, the client cannot tell a retention
   destruction from a reassignment.
5. **Auditing.** `PROJECT-OVERVIEW.md:170` requires every read of `consent_records` and
   `analyses` to be logged. If a pull carries either, it writes audit rows **per pull, per
   MR, per day**. That is a volume decision before it is a code one.

**D4 — revised estimates.** S5 was `FE-W18` 4 + `FE-W19` 3 + `FE-W20` 1 = **8 half-days**.

| Work | Half-days |
| --- | --- |
| `sync_pull` server function — scoping, tombstones, audit, RLS filtering | 8 |
| Contract change for the cursor (D3.1) and the watermark gap (D3.2) | 2 |
| Client pull consumer — does not exist today | 5 |
| `FE-W18` conflict resolution — unchanged, but now gated on all of the above | 4 |
| `FE-W19` offline day on a handset | 3 |
| `FE-W20` handset install | 1 |
| **Total** | **23** |

**S5 roughly triples**, and pull is not optional polish: the app promises the MR a
notification "when tomorrow's visits are ready, and when a manager changes them", and
without pull it can never learn that either happened.

Thirteen FIX-03 tasks plus these are in `docs/COMPLETION-PLAN.md` §10.

---

### FIX-05 — the oversight record (7 September 2026)

**The coaching screens in `apps/console` were NOT wired to this backend, and the "manager
console is not here" card was NOT removed.** Both were explicitly out of scope. A later
reader must not take this section as evidence that the console is now backed by real data:
it still renders `services/mock` fixtures. Removing the card is gated behind wiring the
console, which is a separate task and a separate review.

**Part A.** `69f6957..8180a67` pushed. **CI run `34116030264`: success, 2m16s**, both jobs.

#### Part B — `analysis_overrides`, the artefact §3.6 was reversed on

Migration `20260907000200_analysis_overrides.sql`. A table, an append-only trigger, two
`SECURITY DEFINER` functions, and no policies — matching `analyses`, so direct table access
is a genuine `permission denied` rather than an empty result.

**`finding_id` carries no foreign key, and that is deliberate.** There is no findings table
in this schema; the analysis engine that would produce findings is weeks 8-10 and may be
cut. Inventing a table to satisfy one column would be worse than an unconstrained uuid, and
the contract has always declared `findingId` nullable.

##### B2 — append-only, proved against every role

| role | UPDATE | DELETE | TRUNCATE |
| --- | --- | --- | --- |
| `postgres` (table owner) | REFUSED 23001 | REFUSED 23001 | REFUSED 23001 |
| `service_role` | REFUSED 42501 | REFUSED 42501 | REFUSED 23001 |
| `authenticated` | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 |
| `anon` | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 |

**After every attempt the row still said what it said** — `reason` unchanged. `23001` is
`restrict_violation` from the statement-level `reject_mutation` trigger, which is why the
owner and `service_role` are refused too: they hold BYPASSRLS and would never see a policy.
A policy here would have protected the row from everybody except the two roles most able to
rewrite history.

##### B3 — the RLS matrix

| actor | `create_analysis_override` | `list_analysis_overrides` | raw `SELECT` on the table |
| --- | --- | --- | --- |
| `anon` | REFUSED 42501 | REFUSED 42501 | REFUSED 42501 |
| the MR the analysis is about | REFUSED 42501 | **OK** | REFUSED 42501 |
| manager, inside the subtree | **CREATED** | OK | REFUSED 42501 |
| manager, another region | **REFUSED 42501** | **REFUSED 42501** | REFUSED 42501 |
| admin (with a reason) | CREATED | OK | REFUSED 42501 |

**The out-of-subtree cases are refusals, not empty results.** That is a deliberate
departure from `read_analysis`, which returns `null` for an invisible row — settled as
acceptable on 10 August because no client consumes those RPCs. This one has a client, and a
UI cannot render a denial as a denial if the server returns nothing.

**An MR may read overrides about themselves and may not write one.** Being able to see what
a manager recorded about you is the half of the design that makes the system contestable; a
finding the subject can erase is not oversight of the subject.

**B5 honoured.** No `agree` or `acknowledge` path was added, and a test asserts no function
in the schema matches `%agree%`, `%acknowledge%` or `%endorse%`. `fe-w3-spec.md` records
why: agreement is the absence of an override, and a row for it *"would turn every
unreviewed finding into an implied endorsement the moment somebody wanted a metric out of
it."*

##### B4 — the read path

`ListAnalysisOverridesResponseSchema` added to `packages/core`, shaped from
`public.list_analysis_overrides` rather than invented — `{ data, readAt, auditLogId }`. The
mock now serves **GET** as well as POST in that shape, and its POST echoes the request's
`findingId` instead of a fixture's. Round trip against the running mock:

```
POST /analyses/abc/overrides {"reason":"proof of round trip","findingId":null}
  -> 201 {... "findingId":null, "reason":"proof of round trip" ...}
GET  /analyses/abc/overrides
  -> {"data":[{...}], "readAt":"...", "auditLogId":1}
```

Before FIX-05 that GET returned `No mock route for GET /analyses/abc/overrides`.

#### Part C — grant hygiene, a second control

Migration `20260907000300_revoke_public_execute.sql`.

**Before: 65 of 86 functions in `public` were reachable by `anon`. After: 0.** The other 21
had already been revoked one at a time as they were written — the purge worker's internals,
the trigger functions, `custom_access_token_hook`, `visible_territory_ids`. **The practice
existed and was applied unevenly.** This applies it to the rest, and sets
`alter default privileges … revoke execute on functions from public` so the next migration
inherits the posture rather than having to remember.

The seven audited in FIX-04, before and after:

| function | `anon` EXECUTE before | after | `authenticated` after |
| --- | --- | --- | --- |
| `list_consent_records` | **true** | false | true |
| `read_consent_record` | **true** | false | true |
| `list_analyses` | **true** | false | true |
| `read_analysis` | **true** | false | true |
| `daily_mileage` | **true** | false | true |
| `begin_upload` | **true** | false | true |
| `complete_upload` | **true** | false | true |

**Nothing changed about who can do what.** Every function `authenticated` could call
before, it can call after — the grant is explicit rather than inherited. What changed is
that `anon` is now refused *by the grant*, before the body runs, instead of only by the
`auth.uid()` check inside it. The api suite passed unchanged immediately after the revoke,
so nothing depended on the `PUBLIC` grant.

**C3.** `daily_mileage` was the weakest cell in the FIX-04 matrix — the only function that
did not refuse `anon`, returning zero rows because `visible_user_ids()` was empty. It now
has two controls, and both are pinned by tests: one asserts `anon` gets `42501`, another
asserts `has_function_privilege('anon', …)` is `false`, so a future change to
`visible_user_ids()` cannot silently reopen it.

#### Part D — the two riders

**D1 — `BE-W60`.** `list_consent_records` had no test anywhere. Five now cover it: anon
refused, another manager's subtree discloses nothing, a positive control, an admin without
a reason refused `22023`, and the audit row written **before** the data returns.
**Mutation-tested:** replacing the scope filter with `where (true)` failed exactly the
subtree test, 96 tests still collected, so the mutation was not a no-op.

**D2 — `BE-W19`.** The deep-link redirect is in `config.toml`. Verified:

```
$ docker exec supabase_auth_Elmiron-App printenv GOTRUE_URI_ALLOW_LIST
http://127.0.0.1:3000,https://127.0.0.1:3000,com.praversetech.fieldforce://auth-callback
```

**The same entry is needed on any hosted project** and this file does not provide it —
there it belongs in Authentication → URL Configuration → Redirect URLs. Inert today because
the app uses the password grant; it bites the first time OTP, magic link or OAuth is
enabled, and presents as a callback that vanishes rather than as a configuration error.

#### Counts

- `@fieldforce/api`: **375 passed, 14 files** (was 349; 26 added).
- One failure under parallel `vitest`: the **known** `upload.spec.ts` cross-spec purge race
  recorded in `docs/gotchas.md`. `--no-file-parallelism` → **375 passed**, which is the
  re-check that entry prescribes. Not new, not related.
- `verify:rollbacks`: *"All rollbacks applied in reverse order; public schema is empty."*
  **22 migrations, 22 rollback files.**
- `turbo run typecheck lint`: **16 successful, 16 total**. `format:check` clean apart from
  `apps/console/next-env.d.ts`, the gitignored CRLF artefact CI never sees.

---

### FIX-06 — the first real write (7 September 2026)

**The console coaching screens were NOT wired and the "manager console is not here" card
was NOT removed.** Both are held pending the scope decision. Nothing in this section
changes what `apps/console` renders.

**Part A.** `8180a67..8129210` pushed. **CI run `34117692053`: success, 2m28s**, both jobs.

#### Part B — FE-W15. A write that is still there afterwards.

Until today the only real round trip in this product was authentication. A check-in now
goes to Supabase.

**Exactly what is real on the check-in path, and what is not:**

| call | goes to | status |
| --- | --- | --- |
| `record_check_in` | **Supabase RPC** | **real, persists** |
| `record_check_out` | **Supabase RPC** | **real, persists** |
| everything else on the screen — visits, doctors, beat plan, samples, mileage, consent | `services/mock` | **fixtures. Persist nothing** |

**The screen is half converted and must not be described as converted.** Consent is
blocked on the offline design decision from FIX-02 §3; the rest are separate reviews.

**Three things found by doing it rather than planning it:**

1. **The contract's `ApiClient` cannot reach Supabase.** It sends `authorization` and no
   `apikey`; Supabase's gateway refuses that with `401` before PostgREST is reached —
   measured. `apps/field` therefore calls through `supabase-js`, which already holds both
   the key and the live session, rather than growing a second copy of the auth plumbing.
2. **No response mapper existed.** `toRecordCheckInBody` has mapped the *request* since
   BE-W3, but PostgREST returns snake_case with flat `latitude`/`longitude` where the
   contract nests `coordinates`, plus a `shift_window_source` the entity has no field for.
   Nothing had ever mapped a response because no client had ever received one.
   `fromCheckInRow` / `fromCheckOutRow` now do, and they **parse rather than cast**.
3. **`Coordinates.capturedAt` has no column.** It maps from `occurred_at`, which *is* when
   the device took the fix.

**B3 — the proof.** Row read back from the database by id after an HTTP round trip, and
**`received_at` is the server's clock**: the handset claimed a fixed date and the server
stamped now, so the two differ by a measured non-zero interval. A device that lies about
its clock cannot move `received_at`.

**B4 — mutation proof.** The insert was removed from `record_check_in`. **3 of 6 failed —
exactly the three persistence assertions — with the case count unchanged at 6.** The three
refusal tests correctly stayed green, since a refusal does not depend on an insert.

**B5 — the refusal path.** With the check-in outside the 09:00–19:00 window:

```
POST /rest/v1/rpc/record_check_in  ->  400
{"code":"45003","message":"check-in at 2026-09-07 16:30:00+00 is outside the
 configured shift window for territory ..."}
```

**And it wrote nothing** — asserted, because a refusal that leaves a row behind is worse
than one that fails loudly. A visit belonging to another MR is refused `42501`.

**B6.** No shift-window, geofence or permission logic was added to the client. The rule
lives in `record_check_in`, which resolves the window from the *doctor's* territory.

#### Part C — the error contract

Every deliberate SQLSTATE the schema raises, counted across all migrations:

| SQLSTATE | raises | mapped to |
| --- | ---: | --- |
| `22023` | 64 | `invalid_request` — **deliberately generic** |
| `42501` | 43 | `not_permitted` |
| `28000` | 31 | `not_authenticated` |
| `23514` (`check_violation`) | 16 | `invalid_for_this_record` |
| `23503` (`foreign_key_violation`) | 4 | `references_missing_record` |
| `0A000` | 2 | `not_supported` |
| `23001` (`restrict_violation`) | 2 | `append_only` |
| `23505` (`unique_violation`) | 1 | `already_exists` |
| `45001` | 1 | `consent_notice_superseded` |
| **`45002`** | new | `shift_window_not_configured` |
| **`45003`** | new | `outside_shift_window` |

**C2 could not be done with the codes that existed.** The shift-window refusals both
raised `22023`, which is raised **64 times** for unrelated reasons — mapping it to "your
shift window is wrong" would be a guess dressed as a fact, and matching the message
instead would make English the contract. So they were given their own codes, `45002` and
`45003`, in the range `45001` established in FIX-02. Migration
`20260907000400_shift_refusal_codes.sql` is the three live function bodies with only the
errcode substituted.

**C4 — the rule that matters most.** An unmapped SQLSTATE returns `unrecognised` and the
UI says so. A wrong explanation sends the MR to do the wrong thing and they have no way to
tell it was wrong.

**C5 — mutation proof.** `45003` was removed from the mapping table: **1 failed, exactly
that case, 332 still collected.**

Each refusal also carries `actionable` — whether the person holding the phone can do
something now (re-read the notice, wait for the shift) or whether it needs somebody else.

#### Part D — the architecture, and a control that was not one

**D1.** Recorded in `.ai-collab/architecture.md` → "The access model, as implemented".
The short version, with counts from the applied schema:

- 35 tables, 41 policies, **9 tables with RLS forced and zero policies** — including
  `analyses`, `consent_records` and `analysis_overrides`.
- **88 functions.** Access to those nine happens only through `SECURITY DEFINER`
  functions whose bodies hold the scope logic and write the audit row first.
- **So the authorisation surface is 88 function bodies, not 41 policies.** A reviewer who
  reads `pg_policies` and stops has read the smaller half.
- This differs from `plan-backend.md` §2's *"Enforce it in Postgres row-level security.
  Not in application code"*. It was chosen twice with reasons on the record
  (`PROJECT-OVERVIEW.md:483` and `:170` — Postgres has no SELECT trigger, so a policy
  cannot satisfy "every read of these two tables is audited" and a function can). The note
  argues for neither; it records what is true so the next review reads the right artefact.

**D2 — and this is the finding of Part D. FIX-05's default privilege is inert.**

FIX-05 Part C added
`alter default privileges in schema public revoke execute on functions from public` so
future migrations would inherit the posture. **They do not.**

```
pg_default_acl, schema public, objtype f
  -> owner: supabase_admin
  -> {postgres=X/supabase_admin, anon=X/supabase_admin, authenticated=X/..., service_role=X/...}
```

The default ACL for new functions in `public` belongs to **`supabase_admin`**, and it
grants `anon` **explicitly** rather than through `PUBLIC` — so revoking `PUBLIC` leaves it
untouched. Migrations run as `postgres` (`select current_user` during one returns it), and
`alter default privileges for role supabase_admin …` is refused outright:
`permission denied to change default privileges (42501)`.

**Proved, not reasoned:** a throwaway function created inside a transaction returned
`has_function_privilege('anon', …, 'EXECUTE') = true` both before and after an attempted
fix. So the 65-of-86 finding would have recurred with the next migration.

**A migration cannot fix this, so the control is a test instead.** `rls.spec.ts` now fails
the build if *any* function in `public` is `anon`-executable, plus a positive control that
creates a function with the defaults and asserts it *is* — so a green result cannot mean
the query is broken. A second migration attempting
`revoke execute on functions from anon` was written, proved ineffective, and **deleted
rather than committed as decoration**.

#### Counts

- `@fieldforce/api`: **383 passed, 15 files** (was 375; +8 — six write-path, two grant
  posture). Run with `--no-file-parallelism`, per the `upload.spec.ts` race in
  `docs/gotchas.md`.
- `@fieldforce/field`: **332 vitest** (was 320; +12) **+ 72 jest**, all passing.
- `verify:rollbacks`: *"All rollbacks applied in reverse order; public schema is empty."*
  **23 migrations, 23 rollback files.**
- `turbo run typecheck lint`: **16 successful, 16 total**. `format:check` clean apart from
  `apps/console/next-env.d.ts`, the gitignored CRLF artefact CI never sees.

---

### FIX-07 — visits and mileage, and the first performance measurement (7 September 2026)

**Consent and samples were NOT converted. The console was NOT wired and the "manager
console is not here" card was NOT removed.** Consent waits on the offline-capture
decision; samples wait because nothing server-side counts UCPMP caps, and the samples
screen keeps its copy telling the MR the app is not counting — untouched and unsoftened.

#### Part A — CI went red, and it was mine

**Run `34121392694`: failure.** Not the known `upload.spec.ts` race. `write-path.spec.ts`
failed to **collect**: `1 failed | 14 passed` file-wise with **377 tests passed and none
failed**, which is the shape of a missing import rather than a broken assertion.

**Cause.** The `migrations` job runs `pnpm --filter @fieldforce/api test` **directly, not
through turbo**, so nothing builds workspace dependencies for it. That was invisible until
FIX-06 made `write-path.spec.ts` the first database test to import `@fieldforce/core`,
whose `dist/` does not exist in that job. Fixed by adding a build step to the job.

Worth naming as a class: **a job that runs one workspace's script directly gets no
dependency graph.** The other job runs `pnpm run build` first and would never have shown
this.

#### Part B — visits and mileage

**Real vs fixture, updated from FIX-06:**

| call | goes to | status |
| --- | --- | --- |
| `record_check_in` / `record_check_out` | Supabase RPC | **real** |
| **create visit / update visit** | **Supabase table + RLS** | **real** |
| **mileage** | **`daily_mileage` RPC** | **real** |
| consent | `services/mock` | fixture — blocked on a design decision |
| samples | `services/mock` | fixture — blocked on UCPMP enforcement |
| doctors, beat plans, visit *lists*, analyses | `services/mock` | fixtures |

**B2 — response-shape divergences found.** Four, and one is a defect rather than a mapping
gap:

1. **`CreateVisitRequest` could never have satisfied the insert policy.** It has never
   declared `mrId`; `visits_insert_own` requires `mr_id = auth.uid()`; the column had no
   default. **A visit create as the contract describes it would have failed against any
   real server.** Nobody found it because no client had ever posted one.
   **This is a schema change made to meet the contract, and it is stated as such:**
   migration `20260907000600` defaults `mr_id` to `auth.uid()`. The default is stronger
   than having the client send its own uid — a client that can send the field can send
   somebody else's, and the policy would refuse it, but the identity would be travelling
   over the wire for no reason. The policy still evaluates `mr_id = auth.uid()` after the
   default applies.
2. **PostgREST answers a table insert with an ARRAY**, even for one row.
   `supabase-js` `.single()` unwraps it; anything reading the raw response must not assume
   an object.
3. **`GET /mileage` has no backend**, as FIX-03 recorded (`BE-W52`). The real surface is
   `daily_mileage(p_from, p_to, p_mr_id)`, returning snake_case rows.
   `fromMileageRow` maps them.
4. **`CreateVisitBody` had to be a type alias, not an interface.** TypeScript gives type
   aliases an implicit index signature and interfaces none, so only the alias is assignable
   to the `Record<string, unknown>` a client's `insert()` takes.

**B3 — no new SQLSTATE was minted, and that is the finding, not an omission.** Every
refusal on these two paths is an RLS policy outcome: `42501` for a doctor outside the MR's
territory, already mapped to `not_permitted`. There is no deliberate `raise` anywhere on
the visit-create, visit-update or mileage paths — `grep` for `raise exception` mentioning
visits returns only `'visit % is not yours'` inside *other* RPCs. Minting a code for a
refusal nobody raises would be decoration.

**B4 — three mutations, three results.** Each removed the write and left the case count
unchanged:

| mutation | result |
| --- | --- |
| visit **create** — `BEFORE INSERT` trigger returning `NULL` | **4 failed / 13**, count unchanged |
| visit **update** — `BEFORE UPDATE` trigger returning `NULL` | **1 failed / 13**, exactly the update test |
| **mileage** — `daily_mileage` filter replaced with `where false` | **1 failed / 13**, exactly the positive control |

**The first one needs its result explained rather than smoothed over.** Four failed, not
three: the out-of-territory *refusal* test failed alongside the three persistence tests.
That is structural, not a flaw in the test. On a **table** write the refusal **is** the
insert being policy-checked, so removing the insert removes the refusal too. On an **RPC**
write — FIX-06's check-in — the refusal is raised before any insert, which is why that
mutation left its refusal tests green. Two different write shapes, two different mutation
signatures, and the difference is worth knowing before reading the next one.

A first attempt at that mutation was **void and was redone**: an unscoped trigger also
blocked fixture seeding, so `beforeAll` threw and all 13 tests *skipped*. Skipped is worse
than dropped — nothing was proved. Scoping it to `auth.uid() is not null` left setup
working and the client writes blocked.

#### Part C — BE-W38. RLS read performance, measured for the first time.

**These are LOCAL numbers**, from the Docker stack on a Windows developer machine. They
are **not production behaviour** and are not presented as such. They are also **server
execution only** — no network round trip — whereas the three-second requirement is about a
waiting room, i.e. end to end.

Seeded with `BE-W17` at the pilot shape: 100 MRs, a year of history, **208,800 visits and
check-ins**. Measured **as an MR**, with the JWT claims set and `set role authenticated` —
not as `postgres`, not as `service_role`, because the RLS and territory-visibility path is
the entire question.

| query | plan | execution |
| --- | --- | ---: |
| **doctor search** (`search_doctors`) | Function Scan | **3.42 ms** |
| visit list, 50 rows | Seq Scan on `visits`, 2,088 visible of 208,800 | 11.32 ms |
| Today — the next planned visit | Seq Scan | 10.06 ms |
| **`current_user_visible_territory_ids()`** | Function Scan | **0.17 ms** |

**C3 — is doctor search under three seconds? Yes, by three orders of magnitude.** 3.42 ms
against a 3,000 ms budget.

**The recursive-CTE fear is refuted.** `visible_territory_ids` was the named suspect —
"the shape that turns 40 ms into 4 s". Measured at pilot volume it is **0.17 ms**. It is
not the problem, and per C5 nothing about it was changed.

**One caveat that limits what this proves, stated because it is easy to miss.** Each
synthetic MR sees **5 doctors** — RLS filters the 100-doctor table to their area — so the
doctor search was measured against a thin result set. The `visits` numbers (2,088 visible
of 208,800, full sequential scan) are the meaningful volume result. If a real MR's beat is
50–200 doctors, the search should be re-measured against a fixture with that density;
`seed-synthetic.mjs` currently generates five per area.

**C4 — no tuning was done, deliberately.** The instruction was to index what the plans show
*dominating*. Nothing dominates: the slowest query is 11 ms against a 3,000 ms budget. The
`Seq Scan on visits` is the only shape that would degrade with volume — an index on
`visits(mr_id)` would convert it — but tuning an 11 ms query to prove a before/after would
produce a number that flatters the work and muddies the baseline. **Registered as an
observation, not a change.**

#### Part D

**D1 — the nine tables with RLS forced and zero policies.** All nine are deliberate; none
looks like an oversight.

| table | why it has no policy |
| --- | --- |
| `analyses` | RPC-only reads, because every read must be audited and Postgres has no SELECT trigger |
| `analysis_overrides` | same, FIX-05 |
| `audit_log` | append-only; no client read path exists at all (FIX-03 found it ABSENT) |
| `audio_destruction_log` | retention worker's own record |
| `audio_purge_runs` | purge bookkeeping, worker-only |
| `restore_reconciliation_runs` | operator artefact, `docs/restore-runbook.md` |
| `restore_reconciliation_findings` | same |
| `transcripts_raw` | the redaction boundary — must never be client-readable |
| `transcripts_redacted` | AI layer, nothing consumes it yet |

**Two things the count hides, both worth more than the list:**

- **`consent_records` is not in the nine and behaves as if it were.** It has exactly one
  policy — `consent_records_insert_own`, an INSERT policy — and **no SELECT policy and no
  SELECT grant**. So ten tables are unreadable directly, not nine. "Has policies" and "is
  readable" are independent, and a review that counts policies will miss this.
- **The redaction gate holds.** `llm_gateway` can read `transcripts_redacted` (`true`) and
  **cannot** read `transcripts_raw` (`false`).

**D2** — three conventions appended to `.ai-collab/constraints.md`: *test the mechanism,
not the state* (the inert `ALTER DEFAULT PRIVILEGES` as the worked example); *audit the
response shape as each endpoint converts*; and *a count that changes is recorded as the
command that produces it* (40 → 34 → 35), with the query to re-derive it.

#### Counts

- `@fieldforce/api`: **390 passed, 15 files** (was 383; +7). `--no-file-parallelism`.
- `@fieldforce/field`: **341 vitest** (was 332; +9) **+ 72 jest**.
- `verify:rollbacks`: schema empty. **24 migrations, 24 rollback files.**
- `turbo run typecheck lint`: **16 successful, 16 total**.

---

### FIX-08 — CI dependency graph, and doctor search at real density (7 September 2026)

> **This section corrects FIX-07's doctor-search claim.** FIX-07 reported doctor search at
> **3.42 ms** and called the three-second requirement met "by three orders of magnitude".
> That number was measured against **five visible doctors** and should not have been
> presented as a result. **It is replaced by 77 ms at 176 doctors, below.** FIX-07's *visit*
> numbers — 11.32 ms for 2,088 visible of 208,800 — stand unchanged and are still the
> volume case.

#### Part B — CI through the dependency graph, and the latent cases

**B1. Turbo was the better fix and FIX-07's build step is gone.** `turbo.json` already
declares `test: { dependsOn: ["^build"] }` — the mechanism existed and the job was
bypassing it. Every test invocation now runs `pnpm turbo run test --filter …`. Verified
locally: `turbo run test --filter @fieldforce/mock` reports **2 tasks**, the build and the
test.

`--force` on the api job only, for a stated reason: that suite talks to a real database and
a turbo cache hit would replay a previous pass without running anything, defeating the
guarantee the job's own comment claims — that `db.ts` hard-fails on an unreachable database
so a green run means the tests executed. A cached green is precisely the "control that
cannot be exercised" this repo wrote a rule about two sessions ago.

**B2. Every job that invokes a workspace script directly**, and what each needs:

| where | invocation | state |
| --- | --- | --- |
| `ci.yml:64,68,73,75,80` | 5 unit-test jobs | **Were latent** — not broken, because `pnpm run build` runs first at line 60, but each depended on that ordering. **Moved to turbo.** |
| `ci.yml:122` | `@fieldforce/api test` | The one that broke. **Moved to turbo with `--force`.** |
| `ci.yml:133` | `verify:rollbacks` | A script, not a turbo task. Runs after the tests in the same job; documented in place |
| **`retention.yml:103`** | **`purge:audio`** | **Production, hourly, no build step** |
| **`retention.yml:112`** | **`check:purge-health`** | **Production, no build step** |
| **`retention-watchdog.yml:73`** | **`check:purge-health`** | **Production, no build step** |

**The three production ones are the real finding.** Turbo cannot help — they run plain
scripts, not turbo tasks — and neither workflow has a build step. If any of those scripts
ever imports `@fieldforce/core`, **the retention worker stops deleting audio, hourly, in
production, silently.** This project has already had that failure in another guise: the
workflows sat `disabled_manually` from 23 August and nobody noticed until the database
auto-paused for want of traffic.

They are safe today **by convention** — `seed-one-mr.mjs` records that the scripts stay
"plain `.mjs`, `pg`, and `fetch`" — and nothing enforced it. `scripts-convention.spec.ts`
now does, and it is mutation-proved: adding an `@fieldforce/core` import to
`check-purge-health.mjs` fails the test and names the file.

**B3. CI run `34125236407`: success, 2m58s.** `migrations · Gate 0 RLS suite · rollbacks`
2m19s; `typecheck · lint · format · unit tests` 2m6s.

#### Part C — doctor search, re-measured

**C1 — density, and why 176.** Derived rather than picked: the retention design sizes for
**100 MRs x 8 visits/day x 22 working days**, so an MR makes ~176 calls a month. At roughly
one call per doctor per month, one MR's searchable list is **~176 doctors**. The seed now
generates that per territory (`--doctors-per-territory`, default 176), giving **3,520
doctors** across 20 areas instead of 100.

**C2 — the hierarchy, and the finding that reframes the whole CTE question.**

| | |
| --- | --- |
| depth | **3** — 1 national, 4 regions, 20 areas |
| territories | 25 |
| doctors per area / total | **176 / 3,520** |
| territories an **MR** walks | **1** |
| territories a **field_manager** walks | **6** |
| territories an **admin** walks | 25 |

**`visible_territory_ids` does not recurse for an MR at all.** The body is:

```sql
if v_role = 'mr' then
  return query select v_territory;   -- one row, no recursion
  return;
end if;
```

The recursive CTE is the **`field_manager` branch only**; `admin` returns every territory
without recursing either. So **measuring the recursive CTE as an MR is impossible by
construction** — FIX-07's 0.17 ms measured a single-row return and was never evidence about
the CTE. Both my framing and the brief's had this wrong.

**C3/C4 — the untuned numbers.** Measured as each role, with claims set and
`set role authenticated`:

| as | query | visible rows | execution |
| --- | --- | ---: | ---: |
| **MR** | `search_doctors('Doctor', ..., 50)` | 176 doctors | **77.02 ms** |
| **MR** | `search_doctors('SYNTHETIC', ..., 200)` | 176 doctors | 74.21 ms |
| **MR** | `current_user_visible_territory_ids()` | 1 territory | 0.08 ms |
| **field_manager** | `current_user_visible_territory_ids()` — **the CTE actually running** | 6 territories | **0.21 ms** |
| **field_manager** | `search_doctors('Doctor', ..., 200)` | 880 doctors | 60.66 ms |

**Is doctor search under three seconds of server execution? Yes — 77 ms against 3,000 ms.**
Now against a real result set: 176 visible doctors, 50 items returned, 6,810 shared buffer
hits.

**C5 — what that number does and does not cover.** It is **local**, from the Docker stack on
a Windows developer machine, and it is **server execution only**. It excludes the network,
PostgREST, the connection pooler and the client render. The three-second requirement is a
person waiting in a room, so **server execution is one component of that budget and is not
the budget**; on an Indian mobile network the network term will dominate 77 ms. These are
**not production numbers** and must not be quoted as such.

**C6 — no tuning, and per C7 nothing about `visible_territory_ids` was changed.** 77 ms
against 3,000 ms leaves no term dominating, and premature indexing costs write throughput on
a table taking 208,800 rows.

Two observations registered rather than acted on: **6,810 buffer hits for 3,520 doctors** is
high, and `search_doctors` evaluates its `matched` CTE **twice** — once for `items` and once
for `truncated` — which would be the first thing to look at if density rises. And the
hierarchy is only three levels deep, so the manager's 0.21 ms is a shallow-tree figure; a
deeper org chart would need re-measuring.

#### Part D

**D1 — mileage was converted, to the `daily_mileage` RPC.** Both FIX-07 statements were true
and the wording made them look contradictory. `GET /mileage`, the path the *contract*
declares, has no backend — no `mileage` table or view exists (FIX-03, `BE-W52`).
`daily_mileage(p_from, p_to, p_mr_id)` is the real surface, it is what `listMileage` calls,
and it is what the B4 mutation targeted.

| call | goes to | status |
| --- | --- | --- |
| `record_check_in` / `record_check_out` | Supabase RPC | **real** |
| create visit / update visit | Supabase table + RLS | **real** |
| mileage | **Supabase RPC `daily_mileage`** — *not* the contract's `GET /mileage` | **real** |
| consent | `services/mock` | fixture — blocked on the offline decision |
| samples | `services/mock` | fixture — blocked on UCPMP enforcement |
| doctors, beat plans, visit *lists*, analyses | `services/mock` | fixtures |

**D2 — the two mutations, side by side.**

| mutation | what it removes | result |
| --- | --- | --- |
| `BEFORE INSERT` trigger returning `NULL` | the write | **4 of 13 failed** — three persistence *and* the refusal |
| `visits_insert_own` to `with check (true)` | the refusal | **1 of 13 failed** — only the refusal; persistence green |

Neither proves the path alone. The first shows the write is real; the second shows the
refusal is. Recorded in `.ai-collab/constraints.md` with the second rule from **D3**: a
table-write refusal can only ever be RLS `42501`, so an MR gets one message for every policy
failure, where an RPC can raise a specific actionable code. Not a defect here — a trade-off
to choose knowingly before more paths become direct table writes.

#### Counts

- `@fieldforce/api`: **391 passed, 16 files** (was 390; +1 convention guard).
- `verify:rollbacks`: schema empty. 24 migrations, 24 rollback files.
- `turbo run typecheck lint`: **16 successful, 16 total**.

---

### FIX-09 — UCPMP caps, doctor search at scale, and the sync_pull ADR (7 September 2026)

**Stated first, because the prompt asked for it: the samples write path was NOT converted
to Supabase, and the samples screen's message was NOT removed.** The screen still tells the
MR the app is not counting, and that is still true — the ceiling is deliberately unset (B2).
The console coaching screens were not wired and no card was removed.

#### CI and counts

`f526e0a` — run **`34132076584`, success, 2m59s**, both jobs.

| package | tests | files |
| --- | ---: | ---: |
| `@fieldforce/api` | **391 passed** | 16 |
| `@fieldforce/field` | 341 passed | 23 |
| `@fieldforce/ui-tokens` | 54 passed | 3 |
| `@fieldforce/mock` | 40 passed | 1 |
| `@fieldforce/core` | 21 passed | 3 |
| `@fieldforce/ui` | 4 passed | 1 |

None skipped — every summary line reads `N passed (N)` with no skip term.

After Part B, locally: **`@fieldforce/api` 398 passed, 16 files** (was 391; +7 cap tests).
`verify:rollbacks`: *"All rollbacks applied in reverse order; public schema is empty"* —
**25 migrations, 25 rollback files**. `turbo run typecheck lint`: **16 successful, 16 total**.
`format:check` clean apart from the gitignored `apps/console/next-env.d.ts` CRLF artefact
already recorded in `docs/gotchas.md`.

#### B1 — the comment that lied

`packages/core/src/field/entities.ts:178` said, since BE-W1:

> `/** UCPMP caps are enforced server-side; this is the declared value in INR. */`

Nothing enforced them. `samples_and_inputs` had no limit column, no check constraint, no
month-to-date computation, and `20260811000400_rls_policies.sql` granted a plain insert with
no cap predicate. `docs/fe-w3-spec.md` §C5 had already said so — the comment *"describes an
intention, not the schema as it stands"* — and the comment outlived the correction. Replaced
with a block that says what BE-W21 built and that the ceiling is unset.

#### B2 — the cap parameters, and what is UNVERIFIED

**`20260907000700_ucpmp_sample_caps.sql` builds the mechanism and leaves the ceiling `null`,
on the `org_default_shift_window` precedent.**

| parameter | value | source |
| --- | --- | --- |
| `ucpmp_sample_cap_quantity` | **`null` — UNSET on purpose** | **UNVERIFIED. Nothing in this repository states the UCPMP ceiling.** Needs a human with the code in front of them |
| dimension | per doctor, per item, per **calendar** month | **UNVERIFIED.** The narrowest defensible reading of UCPMP's limit on samples supplied to a medical practitioner. Per MR, per product family, or per quarter are all arguable |
| period boundary | `date_trunc('month', occurred_at)`, server-side | Implementation choice, recorded |
| a **value** ceiling | **deliberately out of scope** | UCPMP 2024 expresses one ceiling as a percentage of the company's domestic sales for the year — a company-level annual figure this application does not hold and must not guess |

**Why not pick a number.** §C5 of `fe-w3-spec.md` refuses to draw the cap meter from an
invented ceiling, and the reasoning is stronger for a constraint than for a meter: a meter
drawn from an invented number misleads, but a constraint built on one *looks enforced*,
produces refusals an MR cannot argue with, and is wrong in a direction nobody can see. With
the threshold null the trigger takes its `return new` branch and a sample write behaves
exactly as it does today — accepted, uncounted, and the screen still says so. The moment
somebody with authority sets the row, the database enforces it and the meter has something
true to draw.

The migration also adds `sample_cap_status(p_doctor_id, p_item_name, p_at)`, which is the
read `fe-w3-spec.md` §C5 recorded as **"BLOCKED ON BACKEND"**. It returns `cap: null` when
unconfigured, so the screen keeps its note rather than drawing a ceiling from a null.

#### B3 — the refusal

**SQLSTATE `45004`**, in the project-defined range `45001`–`45003` established by FIX-02 and
FIX-06. Not `22023`, which the migrations raise 64 times for unrelated reasons and which
therefore carries no information. `detail` carries the cap, the amount already given, this
entry's quantity and the period start, because *"you have exceeded the cap"* without those
four numbers is not something an MR can act on. `hint` says to stop and speak to a manager.

A **trigger**, not a check constraint: the rule is a sum over a month for one doctor and
item, and a check constraint sees only the row in front of it. A trigger also fires for
`service_role` and the table owner, which a policy would not.

#### B4 — both mutations

| # | mutation | result | count |
| --- | --- | --- | ---: |
| 1 | `create or replace ... enforce_ucpmp_sample_cap() ... begin return new; end` — the guard removed | **2 failed / 18 passed**, then after strengthening **3 failed / 17 passed** | 20, unchanged |
| 2 | a `before insert` trigger returning `null` for `PROBE-ITEM` and `A-DIFFERENT-ITEM` only — the write removed | **6 failed / 14 passed** | 20, unchanged |

Neither mutation dropped the case count, so neither was a no-op.

**Mutation 1 caught a test that was not testing anything.** *"never trims the quantity to
fit — it refuses the whole entry"* passed **under the mutation**, because it asserted the
row's absence and the surrounding `rollback to savepoint` discarded the row whether the
trigger refused or not. Rewritten to assert on the refusal itself — the SQLSTATE and the
`detail` string — after which the mutation fails it. A test a savepoint would have passed
for you is the same class of defect as a suite that skips: green, and proving nothing.

Mutation 2 is scoped to the two probe item names. An unscoped `return null` blocked fixture
seeding, and every cap test then **skipped** rather than failed — the void-proof shape this
project has now hit twice.

#### C1–C2 — doctor search, measured against the axis that grows

FIX-08 measured 77 ms at **176 visible** doctors out of **3,520 in the table** and treated
the visible count as the variable. It is not: RLS filters `doctors` at the table level, so
the scan reads the whole table and filters afterwards. `--areas-per-region` was added to
`seed-synthetic.mjs` to grow the table while holding the visible count at 176, which is the
only way to move that axis alone.

`search_doctors('Doctor', null, 50)` as an MR, `explain (analyze, buffers)`, server
execution only:

| total doctors | areas/region | visible to the MR | shared buffer hits | execution |
| ---: | ---: | ---: | ---: | ---: |
| 3,520 | 5 | 176 | 6,892 | **74.985 ms** |
| 30,272 | 43 | 176 | 61,326 | **664.133 ms** |
| 99,968 | 142 | 176 | 203,102 | **2,081.963 ms** |

**The curve is linear.** Buffers per doctor: 1.96, 2.03, 2.03 — flat. Milliseconds per
thousand doctors: 21.3, 21.9, 20.8 — flat. A 28× table gives a 27.8× time. Nothing about the
plan degrades; there is simply nothing bounding the work.

**The plan is a `Seq Scan on doctors` with the `ILIKE` on `full_name` dominating.** The
trigram GIN indexes have existed since `20260812000100_field_operations.sql:490-495`, added
under a comment promising *"an MR standing in a waiting room needs a doctor in under three
seconds"* — and **they are dead**. The live predicate is
`p_query is null or btrim(p_query) = '' or d.full_name ilike '%'||p_query||'%' or …`, and a
disjunction whose first branch is `p_query is null` is not sargable: the planner cannot use
an index for a condition that may be satisfied without consulting the column. Confirmed by
attempting to create `doctors_full_name_trgm_idx` at the largest scale — **`ERROR: relation
"doctors_full_name_trgm_idx" already exists`** — and the next run still seq-scanned, at
2,089.780 ms over 201,537 buffers.

#### C3 — the double CTE cost nothing, and my FIX-08 claim was wrong

`search_doctors` references its `matched` CTE twice — once to build `items`, once for
`truncated`. FIX-08 asserted that this doubles the scan. **Measured at 99,968 doctors, it
does not:**

| what was measured | time |
| --- | ---: |
| one scan of the predicate | **2,107.126 ms** |
| two scans of the same predicate | **4,153.549 ms** |
| `search_doctors` itself | **2,081.963 ms** |

`search_doctors` runs at one scan, not two. Postgres **materialises a CTE that is referenced
more than once**, so `matched` is evaluated once and read twice. The double reference costs
nothing measurable and is **not registered**. C3 asked whether it is material; it is not, and
the earlier claim is corrected here rather than quietly dropped.

#### C4 — the verdict, untuned numbers first

**Untuned: 75 ms at 3,520 doctors, 664 ms at 30,272, 2,082 ms at 99,968.**

**Server execution passes 3,000 ms at roughly 144,000 doctors** — linear extrapolation from
20.8 ms per thousand, which the flat per-row costs justify.

**This is server execution only.** It excludes the network, PostgREST's JSON serialisation,
the connection pooler, the handset's parse and the render. The three-second promise in
`20260812000100_field_operations.sql:486` is an end-to-end promise made to an MR standing in
a waiting room, so the real budget is exhausted well before 144,000 — at 100,000 doctors,
2,082 ms of server time leaves under a second for everything else on a mobile network, which
is not enough.

**The verdict: not a defect at the pilot's size, a certain one at a national field force's.**
At the modelled pilot — 100 MRs, ~3,520 doctors — 75 ms is comfortable and tuning it would be
premature. At 30,000, 664 ms is noticeable but survivable. At 100,000 it is a broken promise.
Nothing about the query changes at those sizes; only the table does.

#### C5 — not tuned, and why

**C3 forbids restructuring the function in this session, and the fix is a restructuring, not
an index.** The indexes already exist. Adding another cannot help while the predicate stays
non-sargable — the planner will keep choosing the sequential scan, and a second dead index
would look like a fix in the migration list while changing nothing. Registered as **BE-W64**
in `docs/COMPLETION-PLAN.md` §10 with the predicate the plan shows dominating, the shape of
the correction, and the measurement to repeat afterwards.

#### C6 — six is the fixture, not a maximum

**Every `field_manager` in this hierarchy sees exactly six territories: min 6, max 6, mean
6.00 across all four managers.** It is not "the one that happened to be tested" and it is not
a ceiling either — it is `1 + --areas-per-region`, a property of the seed knob. Measured on
the live database:

| role | users | min | max | mean |
| --- | ---: | ---: | ---: | ---: |
| `admin` | 1 | 25 | 25 | 25.00 |
| `field_manager` | 4 | **6** | **6** | 6.00 |
| `mr` | 100 | 1 | 1 | 1.00 |

The tree is three deep — one national root with 4 children, 4 regions with 5 children each,
20 leaf areas with none — and managers sit at the region level, so the fan-out is uniform by
construction. **The deepest and widest actor is the `admin` at the root, at 25 territories**,
and no manager in this fixture is deeper than any other. At the C2 scales the same arithmetic
gives a manager 44 and 143 territories respectively, since `--areas-per-region` was 43 and
142 — derived from the seed's shape, not separately measured.

`visible_territory_ids` remains cheap regardless: FIX-08 measured 0.166 ms for an MR, where
the "recursive CTE" carries no recursion at all because a leaf territory has no children.

#### D — the sync_pull ADR

`docs/adr-sync-pull.md`. **A decision record, not an implementation — no code was written**,
and none should be until §5's five questions have a human answer.

Two findings stand on their own even if the design is rejected. **`hasMore` cannot be
honoured by a bare watermark**: rows sharing an `updated_at` put a page boundary inside a
group the `since` timestamp cannot address, so the next page either repeats rows or skips
them, and the contract has no cursor field to carry the position. **A row committed during a
pull but stamped before it is missed permanently**: under `READ COMMITTED` a transaction that
began before the pull can commit after it, at an `updated_at` the client has already advanced
past — and `serverTime`, which looks like the safe next watermark, is exactly the trap.

`services/mock` implements the pull with `deleted` always `false`, `hasMore` always `false`
and a **hard-coded `serverTime`**, so the frontend has been built against a pull that has
never produced a delete, a second page, or a moving clock.

**The estimate moves 23 → 29 half-days** (FIX-04 → FIX-09), because §2.3 deletes and §2.5
scope-loss turned out to be two pieces of work rather than one line. An updates-only pull is
recommended as the first shippable increment — 8 of the 29 — **but only if the app says what
it cannot do**, because an MR watching their list update will reasonably conclude it is
current, and a stale doctor on a beat plan is a wasted visit rather than a cosmetic bug.

Three of the five open questions are not engineering questions: whether a **consent**
tombstone conflicts with the withdrawal promise (legal); what an MR keeps on their handset
when they lose a territory (privacy, with a product answer); and whether consent and analyses
belong in a pull at all, given every such read must write an audit row per pull, per MR,
per day.

#### What FIX-09 did not do

- **The samples write path was not converted.** `apps/field` still writes samples to
  `services/mock`. B5 said not to, and the ordering matters: converting the write before a
  ceiling exists would move the apology from the screen into a database that silently accepts
  everything.
- **The samples screen's message was not removed or softened.** It still says the app is not
  counting, which is still true.
- **The console coaching screens were not wired and no card was removed.**
- **`search_doctors` was not restructured and no index was added.** Registered as BE-W64.
- **No dependency was added.**

#### Registered in `docs/COMPLETION-PLAN.md` §10

**BE-W64** — the doctor search predicate is not sargable and the trigram indexes are dead.

---

---

### FIX-10 — the index that never fired (7 September 2026)

**Not done, and stated first: samples were not converted, the samples screen's message
was not removed or softened, the console coaching screens were not wired, no card was
removed, and no dependency was added.**

#### CI and counts

FIX-09's four commits pushed as `f526e0a..700df2f`. Run **`34133501523`, success**, both
jobs: *typecheck · lint · format · unit tests* and *migrations · Gate 0 RLS suite ·
rollbacks*.

| package | at 700df2f | after FIX-10, locally |
| --- | ---: | ---: |
| `@fieldforce/api` | 398 passed / 16 files | **425 passed / 17 files** |
| `@fieldforce/field` | 341 passed / 23 files | unchanged |
| `@fieldforce/ui-tokens` | 54 / 3 | unchanged |
| `@fieldforce/mock` | 40 / 1 | unchanged |
| `@fieldforce/core` | 21 / 3 | unchanged |
| `@fieldforce/ui` | 4 / 1 | unchanged |

**+27**: 14 equivalence cases, 2 guards against those cases being vacuous, 2 new guards on
the rewrite, 9 on the cap deadline. No skips — every summary line reads `N passed (N)`.
`verify:rollbacks`: *"All rollbacks applied in reverse order; public schema is empty"* —
**27 migrations, 27 rollback files**. `turbo run typecheck lint`: **16 successful, 16 total**.

---

#### B1 — the cause was not what FIX-09 said it was

FIX-09 recorded that `doctors_full_name_trgm_idx` never fired because
`p_query is null or … ilike` is not sargable. **That is wrong, and the correction is the
finding.** Measured on the live database at 99,968 rows:

| context | predicate | plan | time |
| --- | --- | --- | ---: |
| `postgres` | the exact null-OR disjunction, ILIKE via a parameter | **Bitmap Index Scan** on `doctors_full_name_trgm_idx` | 0.055 ms |
| `authenticated` | a bare ILIKE, **no null-OR at all** | **Seq Scan**, 201,488 buffers | 2,205.952 ms |
| `authenticated` | `full_name = '…'`, same column, same role | **Bitmap Index Scan** on the same index | 0.396 ms |

The disjunction is not the difference. The difference is between rows two and three, and
it is one property:

```
select proname, proleakproof from pg_proc where proname in ('texteq','texticlike');
 texteq     | t
 texticlike | f
```

`public.doctors` has RLS enabled **and forced**. Postgres will not evaluate a
non-leakproof qual before a security qual, because an operator that can raise or time
differently would leak the contents of rows the policy is hiding. So the ILIKE is demoted
to a post-filter and **cannot become an index condition while the scope comes from RLS**.
That is a correctness rule, not a planner preference: no index and no rewrite of the
predicate could have changed it. The index was unusable by construction from the day it
was created.

**The null-OR is still a real trap, just a latent one.** Under a custom plan Postgres
folds `$1 is null` and keeps the index; under a generic plan — which a cached plan becomes
after five executions — it cannot:

```
set plan_cache_mode = force_generic_plan;
-- with the null branch:      Seq Scan, Rows Removed by Filter: 99968
-- with the null branch gone: Bitmap Index Scan on doctors_full_name_trgm_idx
```

A query that is fast five times and slow for ever after is the worst shape a performance
defect can take, because the first person to measure it sees the fast number. Split anyway.

**And a third cause, found by the first attempt failing.** `security definer` with the two
policies transcribed verbatim — `territory_id in (…) or is_admin()` — **still produced a
Seq Scan at 2,310 ms**. A disjunction with one non-indexable branch forces a scan of
everything, and `is_admin()` does not depend on the row. The scope is now resolved to a
`uuid[]` before the query runs, so the row predicate is a plain
`territory_id = any(v_scope)`. `territory_id` is `not null` on this table, so enumerating
every territory for an admin is exactly equivalent to the admin policy rather than merely
close to it.

#### B2 — the plan, at 99,968 doctors

The claim is the plan, not the number. Same fixture, same role, same query; only the body
differs.

**Old body (`security invoker`, RLS is the scope), selective query:**

```
 Seq Scan on doctors d  (cost=7.77..28811.12 rows=7 width=217)
   Filter: (is_active AND ((ANY (territory_id = (hashed SubPlan 3).col1)) OR is_admin())
            AND ((full_name ~~* '%…%') OR (specialty ~~* '%…%') OR (registration_number = '…')))
   Rows Removed by Filter: 99968
   Buffers: shared hit=201476
 Execution Time: 2265.220 ms
```

**New body, wide scope (admin, 573 territories), same query:**

```
 Bitmap Heap Scan on doctors d  (actual time=4.176..4.212 rows=11 loops=1)
   Recheck Cond: ((full_name ~~* '%…%') OR (specialty ~~* '%…%') OR (registration_number = '…'))
   ->  BitmapOr
         ->  Bitmap Index Scan on doctors_full_name_trgm_idx        (rows=11)
         ->  Bitmap Index Scan on doctors_specialty_trgm_idx        (rows=0)
         ->  Bitmap Index Scan on doctors_registration_number_idx   (rows=0)
 Execution Time: 4.331 ms
```

**New body, narrow scope (an MR, one territory), same query:**

```
 Bitmap Heap Scan on doctors d  (actual time=0.819..0.819 rows=0 loops=1)
   Recheck Cond: (territory_id = ANY ('{c44809e4-…}'::uuid[]))
   Filter: (is_active AND ((full_name ~~* '%…%') OR …))
   ->  Bitmap Index Scan on doctors_territory_id_idx  (rows=176)
 Execution Time: 0.852 ms
```

and the empty-query listing branch, same MR:

```
 Index Only Scan using doctors_territory_active_name_idx on doctors d  (rows=176)
   Index Cond: ((territory_id = ANY ('{…}')) AND (is_active = true))
   Heap Fetches: 0
   Buffers: shared hit=6
 Execution Time: 0.157 ms
```

Seq Scan gone in every case.

#### B3 — the curve, old beside new

`search_doctors` as an MR, 176 visible at every scale, server execution only.

| total doctors | query | **OLD** | buffers | **NEW** | buffers |
| ---: | --- | ---: | ---: | ---: | ---: |
| 3,520 | `'Doctor'` | 72.574 ms | 6,923 | **2.137 ms** | 228 |
| 3,520 | selective | 73.361 ms | 6,810 | **0.426 ms** | 74 |
| 3,520 | null (listing) | 75.146 ms | 6,810 | **0.598 ms** | 72 |
| 30,272 | `'Doctor'` | 632.599 ms | 61,332 | **2.259 ms** | 341 |
| 30,272 | selective | 633.244 ms | 61,219 | **0.541 ms** | 187 |
| 30,272 | null (listing) | 636.425 ms | 61,219 | **0.646 ms** | 185 |
| 99,968 | `'Doctor'` | 2,190.503 ms | 203,373 | **2.600 ms** | 357 |
| 99,968 | selective | 2,151.731 ms | 201,486 | **0.612 ms** | 185 |
| 99,968 | null (listing) | 2,194.394 ms | 201,399 | **0.557 ms** | 183 |

**Old: linear in total doctors.** 72 → 633 → 2,190 ms over a 28× table; buffers 6.9k → 61k
→ 203k, tracking table size exactly.

**New: flat.** 2.137 → 2.259 → 2.600 ms over the same 28×; buffers 228 → 341 → 357. The
residual growth is the planner's own bookkeeping, not the scan. **The curve is no longer
linear in total table size — it is constant in it, and linear in what the caller can see**,
which is the shape it should always have had. 843× at the largest scale.

**A correction to FIX-09's fixture, which nobody has flagged yet.** Every synthetic doctor
is named `SYNTHETIC Doctor SYN-…`, so the query `'Doctor'` matches **all 99,968 rows**.
FIX-09's three-scale curve therefore measured "return the first 50 rows of a query that
matches everything", not "find a doctor". No index can help a predicate that is true for
every row, so on the old body the numbers were right but were measuring the wrong thing.
The B3 table keeps `'Doctor'` for comparability with FIX-09 and adds a genuinely selective
query beside it.

#### B4 — which index, named

Both, and it depends on the caller's scope, which is correct rather than a compromise:

| caller | index the plan names |
| --- | --- |
| admin, 573 territories, name search | **`doctors_full_name_trgm_idx`**, in a `BitmapOr` with `doctors_specialty_trgm_idx` and `doctors_registration_number_idx` |
| MR, one territory, name search | `doctors_territory_id_idx`, then the ILIKE as a filter over 176 rows |
| MR, empty query | `doctors_territory_active_name_idx`, **Index Only Scan**, `Heap Fetches: 0` |

For an MR the trigram index is *not* the one used, and should not be: 176 rows reached
through the territory index and filtered is cheaper than a trigram lookup across 99,968.
The planner is now free to make that choice, which is the whole change. It was not free
before — every caller got the sequential scan.

#### B5 — equivalence, checked rather than asserted

14 cases, each running the **old body verbatim under a second name in the same
transaction** and comparing the whole jsonb payload: null, empty string, whitespace-only,
a single character (below the trigram extraction threshold), a substring, a bare accent,
an accent inside a name, a case difference, a specialty rather than a name, an exact
registration number, a query matching nothing, and three limit boundaries (truncation,
below the floor, above the ceiling). **All 14 identical.**

Two guards so the comparison cannot be vacuous: one asserts the legacy body actually
returns the fixture doctor, and one asserts the accent fixtures are found — including that
`'Renée'` matches `dr renée fixture` and **does not** match `DR RENEE FIXTURE`, because
ILIKE is case-insensitive and not accent-insensitive and the rewrite must not have quietly
acquired `unaccent` on the way past.

The equivalence also proves the two scoping mechanisms agree: the legacy body is
`security invoker` and scoped by the RLS policies, the new one by its own predicate.

#### B6 — indexes with zero scans, and which of those means anything

After the full suite plus the perf runs: **37 of 109 indexes in `public` have
`idx_scan = 0`.** Raw, that number says nothing. Sorted:

| group | count | what it means |
| --- | ---: | --- |
| Primary keys and unique constraints | **13** | Not dead. They enforce on every insert; being scanned is not their job |
| Small-table effect | ~12 | `territories` (573 rows), `user_profiles` (105), `territory_shift_windows`, `consent_text_versions`, `upload_grants`. A sequential scan of a page is correct and the planner is right |
| Surfaces that do not exist yet | ~5 | `audit_log_action_idx`, `audit_log_actor_idx` (2.5 MB together) exist for a console audit view; the console is deliberately unwired. `restore_findings_*` belong to a CLI run on empty data |
| Reverse-lookup indexes for queries nobody writes yet | ~4 | `clinic_addresses_doctor_id_idx`, `samples_and_inputs_visit_id_idx`, `voice_notes_visit_idx`, `check_outs_visit_id_idx`. A foreign key is enforced through the *referenced* key, so these do nothing until a query needs them |
| **The BE-W64 pair** | **2** | `doctors_full_name_trgm_idx` (2,616 kB) and `doctors_specialty_trgm_idx` (136 kB) — see below |

**Nothing else in the schema has the leakproof problem, and that is checked rather than
assumed.** `grep -rn "ilike" services/api/supabase/migrations/*.sql` returns eleven hits;
nine are `v_message ilike '%…%'` inside exception handlers, matching a text *variable* with
no table and no index involved. The only ILIKE that touches a column anywhere in this
schema is `search_doctors`, in the two versions of it and now the third.

**The one that is still worth a decision.** After the fix, `doctors_full_name_trgm_idx` is
reachable but is used only on the wide-scope path. In this workload — which is what a
pilot looks like, MRs with one territory each — it recorded **zero scans**, while
`doctors_territory_active_name_idx` recorded **33,635**. It is not dead any more, but it is
2.6 MB and write amplification on every doctor insert, maintained for the admin search
path. Whether that is worth keeping is a judgement for the reviewer; it was not removed.

**UNVERIFIED, and this is the honest limit of B6.** At fixture and synthetic scale the
small-table effect is indistinguishable from genuine deadness for most of the 37. Settling
it needs `pg_stat_user_indexes` from a database carrying real traffic, and production is
unreachable from this machine. What can be said without production is exactly what is
above: the constraint-backed ones are fine, the ILIKE audit is complete, and the trigram
pair's status is measured rather than guessed.

#### C — the cap decision now has a deadline

**C1, the choice: a dated threshold plus a CI step, not an expiry that starts refusing.**

`org_default_shift_window` — the precedent BE-W21 followed — expires a **permissive value**
back to a strict default, and its own header explains why: *"if the client never sends the
real working hours, the system tells them by failing, which is the only message anyone
reliably reads."* The cap cannot borrow that shape directly, because here the permissive
state is the **absence** of a value. The only structural analogue would be to start
refusing sample writes on a date, which punishes an MR for a decision nobody asked them to
make — on a path that still writes to `services/mock` and would land on real MRs the day it
is converted.

So the deadline binds the people who own the decision:

| rejected | why |
| --- | --- |
| refuse sample writes after the date | punishes the wrong party, and lands the day the write path is converted |
| a startup warning | a log line nobody reads is what this project already calls a flag that is *"real and invisible"* |
| a calendar-dependent unit test | would break `pnpm test` for a developer who owns none of this, and then it gets skipped |
| pick a default cap | explicitly forbidden, and the exact failure `20260907000700` was written to avoid |

**What was built.** `ucpmp_sample_cap_decision_due` = `2026-11-06`, sixty days out — the
same ceiling `validate_app_threshold()` already imposes on the shift window, borrowed
rather than invented. `public.ucpmp_cap_decision_status()` reports
`{capConfigured, dueAt, overdue, daysRemaining, question}`.
`check:decision-debt` turns that into a CI step in the migrations job.

**C2 is satisfied by where it lives, not by weakening it.** Local development is untouched
and the test suite never depends on the date: `decision-debt.spec.ts` exercises the
deadline by writing a **backdated row**, the technique `20260816000200` records for its own
expiry — *"a backdated row with a backdated expiry is a legitimate correction to the record
AND the only honest way to exercise the far side of the boundary."* Only CI is
calendar-sensitive.

**It fails closed.** A missing or null deadline reads as **overdue**, not as "no deadline",
so the alarm cannot be silenced by removing the row that carries it. That is the FIX-05
`ALTER DEFAULT PRIVILEGES` failure — a control that looked like one and enforced nothing —
written into an assertion.

**Deferring is possible and meant to be.** `app_thresholds` carries a statement-level
`reject_mutation` trigger, so the row cannot be edited or deleted (asserted: SQLSTATE
`23001`). A later deadline is a new row with a reason in its note — dated, attributable,
and on the record.

**Proved end to end, not only in unit tests.** With a backdated row:

```
$ pnpm --filter @fieldforce/api check:decision-debt
A DECISION IS OVERDUE:
  - the UCPMP sample cap is still unconfigured and its decision deadline
    (2026-01-01T00:00:00+00:00) has passed.
…
Do NOT invent a value to clear this. Either set the real one, or file a
migration moving ucpmp_sample_cap_decision_due with the reason in its note.
EXIT CODE: 1
```

and as the schema ships: `overdue: false`, `daysRemaining: 60`, exit 0.

**C4, both mutations, count unchanged at 9 each:**

| mutation | result |
| --- | --- |
| `ucpmp_cap_decision_status()` replaced with one that always returns `overdue: false` | **5 failed / 4 passed** — every database assertion, including the fail-closed one |
| the script's overdue branch made unreachable (`if (false)`) | **6 failed / 3 passed** — the five above plus the pure evaluator's own case |

Neither dropped the case count, so neither was a no-op.

---

#### D1 — the five questions the ADR flags as needing a human, verbatim

Quoted from `docs/adr-sync-pull.md` §5, with one line each on what changes depending on
the answer. Nothing below needs the ADR read to be answered.

> **1. The tombstone window (§2.3). How long may a record of a deleted thing be kept, and
> does a consent tombstone conflict with the withdrawal promise? Legal, not technical.**

*What changes:* a longer window means a handset can be offline longer before it needs a
full re-sync; a shorter one means more full re-syncs. If a **consent** tombstone is not
allowed at all, consent cannot be in the pull, and a withdrawal will never reach a handset
that is offline when it happens.

> **2. What an MR keeps when they lose a territory (§2.5). Privacy question with a product
> answer.**

*What changes:* whether an MR who is reassigned keeps the old territory's doctor list,
visits and beat plan on their phone indefinitely, or is told those records are gone — and
if told, whether the app says "deleted" (false, and for a consent record dangerously so)
or "no longer yours".

> **3. Whether an updates-only pull may ship (§4), given it must tell the user it cannot
> see deletions.**

*What changes:* 8 half-days of work either ships in the next increment or waits for
another 7. If it ships, the app must say plainly that it cannot see removals, because an
MR watching their list update will reasonably conclude it is current.

> **4. Whether consent and analyses belong in the pull at all. Every such read writes an
> audit row — per pull, per MR, per day. That is a volume and a compliance decision before
> it is a schema one.**

*What changes:* 100 MRs pulling every 15 minutes is roughly 3,000 audit rows a day per
entity type. Including them makes the pull the largest writer of audit rows in the system;
excluding them means consent state on a handset can only ever be what that handset itself
recorded.

> **5. The offline consent question from FIX-02 §3 is upstream of all of this. If consent
> capture cannot be queued offline, a pull that carries consent records is solving a
> problem the product does not have yet.**

*What changes:* this one gates questions 1 and 4. Answer it first; if consent is never
captured offline, most of the consent-in-sync design disappears rather than being decided.

#### D2 — the six design questions, recommendation in two lines each

| § | question | recommendation |
| --- | --- | --- |
| **2.1** | watermark, composite cursor, or a sequence column? | **A composite `(updated_at, id)` cursor, opaque to the client.** It closes the paging hole with no schema change and `id` is already unique so the order is total; a sequence column is strictly more correct and costs a column, an index and a trigger on every synced table |
| **2.2** | how not to lose a row committed mid-pull? | **Serve the pull from one `repeatable read` snapshot** and return its boundary as the cursor. Exact rather than probabilistic; **an overlap window is explicitly rejected** — it is a guess that silently loses data when the guess is wrong |
| **2.3** | how are deletes represented? | **Tombstones with their own retention**, the window set from the same threshold machinery as everything else. Plain tombstones conflict with the 90-day destruction promise; plain absence leaves a client unable to tell "deleted" from "unchanged" |
| **2.4** | RLS scoping, or a `SECURITY DEFINER` RPC? | **RPC.** Not really a choice: nine tables have RLS forced with **zero policies** and cannot be read any other way, and reads of `consent_records` and `analyses` must write an audit row that no SELECT trigger exists to write |
| **2.5** | what happens when a row leaves the caller's scope? | **A distinct `reason` on the change — `deleted` \| `out_of_scope`.** Silence leaves a former territory's doctors on the handset for ever; calling it `deleted` tells the MR something false, and for a consent record dangerously so |
| **2.6** | RPC or table read? | **RPC.** A table read can only ever refuse with RLS `42501`, so every failure reaches the MR as one message, where an RPC can distinguish *cursor expired, re-sync* — an instruction the client can act on — from *cursor unrecognised* and *user deactivated* |

`packages/core` consequences, from ADR §3: `since` becomes an opaque `cursor`, the response
gains `nextCursor`, `serverTime` stops being the thing the client stores, `deleted: boolean`
becomes `reason`, and the FIX-06 error contract gains at least two refusal codes.

#### D3 — the 29 half-days, and what could ship alone

| piece | half-days | ships alone? |
| --- | ---: | --- |
| Contract changes (§3) | 2 | No — everything depends on it |
| `sync_pull` RPC: cursor, snapshot, RLS scoping, audit | 8 | **Yes** — an updates-only pull |
| Tombstones + their retention + a full-resync path | 5 | No |
| `out_of_scope` handling | 2 | **Yes**, after tombstones |
| Client pull consumer in `apps/field/src/sync/` | 5 | No |
| `FE-W18` conflict resolution | 4 | No |
| `FE-W19` offline day on a handset (FE-G2) | 3 | No |
| **Total** | **29** | |

**Is an updates-only pull worth shipping, or worse than nothing?** **Worth shipping, and
recommended as the first increment — conditionally.** It delivers the product promise that
is broken today: an MR learns that a manager changed tomorrow's visits. It cannot tell a
handset that anything was removed, so a deleted or reassigned record persists on the device
until a full re-sync.

**It is worse than nothing if it ships silently.** An MR who sees their list updating will
reasonably conclude it is current, and a stale doctor on a beat plan is a wasted visit
rather than a cosmetic bug. The condition is not a nicety: the app has to say what the pull
cannot see. That makes question 3 above a real decision rather than a formality.

The estimate moved **23 → 29** because §2.3 and §2.5 turned out to be two pieces of work
rather than one line. That is the third growth on inspection, and the denominator has still
not stabilised.

---

#### E1 — G-PERF, stated as it actually stands

**G-PERF is met for SERVER EXECUTION at the scales measured, and OPEN as written.**

Server execution, `search_doctors` as an MR, after BE-W64: **2.137 ms at 3,520 doctors,
2.259 ms at 30,272, 2.600 ms at 99,968** — flat in table size where it was linear, and
three orders of magnitude inside the three-second budget.

**That is not the requirement.** The requirement is *a doctor found in under three seconds
in a waiting room*, which is end to end. Server execution excludes the network, PostgREST's
serialisation, the connection pooler, the handset's parse and the render — and on an Indian
mobile network those are the larger terms, not the rounding error.

**End-to-end has never been measured at any scale.** Not before BE-W64 and not after.
Measuring it needs a physical handset on a real network, which is **blocker B3**, open for
three weeks. Until then the gate is met for the component this repository can measure and
unmet for the requirement as written, and describing it as met would be how the first
waiting room becomes the test.

What BE-W64 does change: the server term is no longer the one that will break it, at any
table size this product is likely to see. Before, 99,968 doctors alone exhausted two-thirds
of the budget with nothing else counted.

#### E2 — added to the escalation list

**The UCPMP sample cap**, alongside per-territory shift hours:

> What is the UCPMP sample cap, on what dimension (per doctor / per MR / per product
> family; per month or per quarter), and **who at the client owns that number?**

Deadline **6 November 2026**, after which CI fails. Until it is answered,
`enforce_ucpmp_sample_cap()` is inert, samples are accepted uncounted, and the samples
screen keeps saying so — which remains the truthful state and is why the message was not
removed.

The unsent list now reads: O1 · O8 · LLM provider + DPA · audio + drug list · reference
data · shift hours · **UCPMP cap** · PV sign-off · Supabase storage-deletion DPA.

#### What FIX-10 did not do

- **The samples write path was not converted**, and **the samples screen's message was not
  removed or softened.**
- **The console coaching screens were not wired and no card was removed.**
- **No dependency was added.**
- **`doctors_full_name_trgm_idx` was not dropped**, though B6 measures it as unused on the
  MR path. That is a decision, not a cleanup.

---

---

### FIX-11 — sync_pull phase 1 (7–8 September 2026)

**Not done, and stated first: the console was not wired, no card was removed, consent and
samples were not converted, the samples screen's message was not removed, `apps/field` was
NOT wired to the new pull, and no dependency was added.**

#### CI and counts

FIX-10's three commits pushed as `700df2f..8853b3d`. **That run failed, on my own error**,
and the failure is recorded here rather than smoothed over.

**Run `34150819478`: `migrations · Gate 0 RLS suite · rollbacks` failed** with:

```
error: function public.ucpmp_cap_decision_status() does not exist
  code: '42883'
```

FIX-10 put the new `check:decision-debt` step **after** `verify:rollbacks`, which rolls
every migration back and leaves the public schema empty. The function it reads was gone by
the time it read it. **The control behaved correctly** — it failed *closed* on an answer it
could not read, which is exactly what it was built to do — and the ordering was wrong.
Anything that reads the schema has to run before the step that destroys it. Moved, with the
reason written into `ci.yml` beside it.

**Run `34151349872` for `59255eb`: success**, both jobs, and the decision step ran and
reported *"UCPMP sample cap decision is outstanding, 60 day(s) to the deadline."*

| package | at 59255eb (CI) | after FIX-11, locally |
| --- | ---: | ---: |
| `@fieldforce/api` | **431 passed / 17 files** | **443 passed / 18 files** |
| `@fieldforce/field` | 341 / 23 | unchanged |
| `@fieldforce/ui-tokens` | 54 / 3 | unchanged |
| `@fieldforce/mock` | 40 / 1 | unchanged |
| `@fieldforce/core` | 21 / 3 | unchanged |
| `@fieldforce/ui` | 4 / 1 | unchanged |

No skips — every summary line reads `N passed (N)`. `verify:rollbacks`: *"All rollbacks
applied in reverse order; public schema is empty"* — **29 migrations, 29 rollback files**.
`turbo run typecheck lint`: **16 successful, 16 total**.

#### A2 — G-CRON is confirmed, for the first time

Both retention workflows were re-enabled on 7 September after a failure streak whose last
scheduled runs were 22–23 August. **Both have now had a scheduled run succeed.**

| workflow | run | created | event | conclusion |
| --- | --- | --- | --- | --- |
| `retention.yml` | **34135046578** | 2026-09-07T14:49:25Z | `schedule` | **success** |
| `retention-watchdog.yml` | **34136136779** | 2026-09-07T15:01:48Z | `schedule` | **success** |

Every other run in both listings is `"conclusion":"failure"` and dated 22–23 August. So the
answer to *"has a run with `event: schedule` succeeded since the re-enable"* is **yes**, and
the re-enable took.

**How the two possible answers were told apart, since the question asked.** "Not enough
time has passed" and "the re-enable did not take" look identical from a green CI badge, and
are distinguished by the `event` field: a `workflow_dispatch` run proves a human pressed a
button, and only a `schedule` run proves the cron fired. Both rows above are `schedule`.
The run log settles the rest — it is not merely that the job started:

```
purge 38e1d02f-…: closed 0 stale session(s), claimed 0, destroyed 0, failed 0
{ "stalled": false, "destroyedTotal": 0, … }
Audio retention is healthy.
```

It reached the production database, did its work, and found nothing to purge. **That also
retires, in passing, the worry that the database had auto-paused again** — an unreachable
database would have failed the step, which is how the August outage was eventually noticed.

#### B1 — the rule, written where conventions live

`.ai-collab/constraints.md`, as a rule rather than a war story:

> **Postgres will not evaluate a non-leakproof qual before a security qual. On a table with
> RLS policies, a predicate whose operator is not `LEAKPROOF` is therefore demoted to a
> post-filter and can never become an index condition for any non-superuser. It
> sequentially scans, at every scale, forever, and nothing in the plan says why.**

with the check to run before assuming an index will help, the three measured plans from
FIX-10, the instruction to `explain` **as the real role** (the effect vanishes for
`BYPASSRLS`, which `postgres` holds here), and both secondary traps: a disjunction with one
non-indexable branch, and the null branch as a generic-plan trap. The reusable half is also
in `docs/gotchas.md` from FIX-10.

#### B2 — the blast radius, and it is one function

**`ILIKE` is not the only non-leakproof operator.** Enumerated from the catalogue rather
than remembered — 22 of them take `text` on the left:

```
!~  !~*  !~~  !~~*  %  %>  %>>  <%  <->  <->>  <->>>  <<%  <<->  <<<->  @@  ||  ~  ~*  ~~  ~~*
```

so `LIKE`, `ILIKE`, all four regex forms, `SIMILAR TO` (which compiles to `~`), every
`pg_trgm` similarity and distance operator, and full-text `@@`. Plus every function anybody
writes, since user-defined functions are not leakproof unless declared so.

**Every occurrence in the migrations, and what each one is:**

| where | occurrence | on a growing path? |
| --- | --- | --- |
| `20260812000100:528-529` | `search_doctors` v1, `d.full_name ilike` / `d.specialty ilike` | **Superseded.** Dead text in an old migration; the live body is BE-W64's |
| `20260814000100:372-373` | `search_doctors` v2, same two | **Superseded**, same reason |
| `20260907000800:156-157` | `search_doctors` v3 — the live one | **Fixed by BE-W64.** `security definer`, scope resolved to a `uuid[]` first |
| `20260813000200:395`, `20260814000100:230`, `20260816000300:1334-1336` | `v_message ilike '%shift window%'` and four siblings | **No.** A `text` *variable* inside an exception mapper. No table, no column, no index |
| `20260816000400:376` | `p_storage_key like 'voice-notes/%'` | **No.** A function parameter, not a column |
| `20260907000300:34` | `array_to_string(p.proacl, ',') like '%authenticated=X%'` | **No.** `pg_proc`, a catalogue with no RLS, in a migration that ran once |
| `20260816000500:46` | "purged at ninety days like a recording" | **No.** Prose inside a `comment on` |

Regex, `SIMILAR TO` and trigram distance: **zero occurrences anywhere in the migrations**,
confirmed by grep for `~`, `~*`, `!~`, `<->`, `<%`, `%>`, `<<%` and `@@`.

**And the structural answer, which is stronger than the grep.** The rule can only cost
anything where an index exists that the predicate might have used. There are exactly **two
GIN or expression indexes in the entire `public` schema**, both on `doctors`, both the ones
BE-W64 addressed:

```
 doctors | doctors_full_name_trgm_idx | gin | … (full_name gin_trgm_ops)   | rls: t | forced: t
 doctors | doctors_specialty_trgm_idx | gin | … (specialty gin_trgm_ops)   | rls: t | forced: t
```

Every other index in the schema is a plain btree reachable through leakproof operators. So
the blast radius is one function, it has been fixed, and the next person to add a text index
to an RLS table is the one the rule in `constraints.md` is written for.

#### B3 — the 38 zero-scan indexes, classified rather than approximated

FIX-10 said "13 + ~12 + ~5", which left about seven unexplained. Re-measured after a full
suite and the perf runs, and this time each index is joined to its table's own statistics
so a zero can be interpreted instead of guessed at. **38 of 109** (one more than FIX-10:
`doctors_territory_id_idx`, which lost to the composite at this scale).

| group | count | why the zero means what it means |
| --- | ---: | --- |
| Backs a primary key or unique constraint | **13** | Enforces on every insert. Being scanned is not its job |
| Table has no live rows at census | **3** | `sync_batches`, `sync_items`, `voice_notes` — written and rolled back by the suite |
| Table under 1,000 rows | **12** | A sequential scan of a page or two is the correct plan. `territories` (80), `user_profiles` (169), `consent_records` (44), `upload_grants` (10) and friends |
| **Table of 1,000+ rows, heavily queried, this index still unused** | **10** | The only interesting group — see below |

The last 10 are the reviewer's "seven", and they are interesting precisely because their
tables were *not* idle: `doctors` recorded **52,523** index scans, `user_profiles` 45,035,
`visits` 20,006. A zero here means another index won, not that nothing looked.

| index | table rows | disposition |
| --- | ---: | --- |
| `doctors_territory_id_idx` | 3,541 | **Redundant.** Strict prefix of `doctors_territory_active_name_idx` — BE-W67 |
| `beat_plans_mr_id_idx` | 2,110 | **Redundant.** Strict prefix of `beat_plans_one_per_mr_per_day_version` — BE-W67 |
| `doctors_full_name_trgm_idx` | 3,541 | BE-W64's, admin-path only. Already DECIDE-3 |
| `doctors_specialty_trgm_idx` | 3,541 | Same |
| `doctors_registration_number_idx` | 3,541 | Reachable only through the `BitmapOr` in `search_doctors`, which fires at wide scope. Measured firing in FIX-10 §B2 |
| `doctors_assigned_mr_id_idx` | 3,541 | Nothing filters on `assigned_mr_id`. Scope is by territory, not by assignment |
| `audit_log_action_idx` | 20,777 | 1,264 kB for a console audit view that is not built |
| `audit_log_actor_idx` | 20,777 | 1,288 kB, same |
| `visits_doctor_id_idx` | 16,842 | A per-doctor visit history is a screen that does not exist |
| `beat_plans_territory_date_idx` | 2,110 | A manager's territory-wide plan view, likewise |

`beat_plan_entries_beat_plan_id_idx` is a third strict prefix (of
`beat_plan_entries_unique_doctor`) and did not appear above only because its table is empty
at census. All three redundancies were found mechanically rather than by eye:

```sql
where a.amname = 'btree' and b.amname = 'btree'
  and not a.partial and not b.partial and not a.indisunique
  and b.indkey::text like a.indkey::text || ' %'
```

**UNVERIFIED, and this is the honest limit.** The last five — the audit, visit and beat-plan
indexes — are indistinguishable from dead until a database with real traffic is measured,
because "no screen uses this yet" and "no screen will ever use this" look the same in
`pg_stat_user_indexes`. Production is unreachable from the working machine.

#### B4 — accent-insensitive search, registered

`'Renée'` does not find `DR RENEE FIXTURE`, and `'Renee'` does not find `Dr Renée Fixture`.
That is asserted in `field.spec.ts` today **as a guard**, because preserving old behaviour
was the point of the FIX-10 equivalence suite and ILIKE is case-insensitive but not
accent-insensitive.

As an equivalence assertion it is correct. As product behaviour it is a defect: for Indian
transliterated names and any European surname, an MR who types the name they were given
does not find the doctor. `unaccent` beside the trigram index is the standard answer.
**Registered as BE-W66, not fixed** — it needs a new extension, and the rule is to ask.

---

#### C1 — the two holes, and how each is closed

**Hole 1, paging across a tie: a composite `(updated_at, id)` ordering key in an opaque
cursor.** `id` is a primary key, so no two rows can tie and the order is total; the resume
comparison `(updated_at, id) > (last_updated_at, last_id)` is exact rather than
approximate. The cursor is opaque by contract because its shape has to change when
tombstones arrive, and a client that parses it will depend on the shape.

**Hole 2, the row committed mid-pull: transaction snapshots, not a timestamp.** This is
the one that loses data silently and surfaces months later as *"a visit that never synced"*,
so the reasoning is written out in the migration header and repeated here.

`updated_at` is stamped with `now()`, which is **transaction start** time. A transaction
that begins at 10:00:00 and commits at 10:00:05 writes rows stamped 10:00:00. A pull at
10:00:02 cannot see them, and if it advances a watermark to 10:00:02, the next pull asks
for changes after 10:00:02 and **those rows are never returned again.** No care with the
timestamp fixes it, because the timestamp is written before the visibility it stands in for.

| option | verdict |
| --- | --- |
| Overlap window — re-request the last N seconds | **Rejected.** N is a guess, and when the guess is wrong the loss is silent |
| Monotonic sequence column | **Rejected, and the ADR was wrong about it.** ADR §2.1(c) says "commit order and sequence order agree". They do not: `nextval()` is evaluated when the row is written, not when it commits, so a long transaction takes a low number and commits after a short one that took a higher one. The identical defect, at the cost of a column, an index and a trigger on every synced table |
| **Transaction snapshot** | **Chosen** |

The cursor carries two snapshots — `since`, from the end of the previous sweep, and `upto`,
taken once at the start of this one — and a row is returned when

```sql
pg_visible_in_snapshot(xmin, upto) and not pg_visible_in_snapshot(xmin, since)
```

A transaction still in flight when `since` was taken is by definition not visible in it, so
whenever it commits, the row it wrote qualifies. **Nothing can be missed, regardless of how
long a writing transaction runs**, because visibility is what is tested rather than a value
written inside it. Every `UPDATE` writes a new row version with a new `xmin`, so "changed
since" and "not visible then, visible now" are the same question.

**Two snapshots rather than one** because a sweep spans pages: `upto` is frozen for the
whole sweep, so a row committed between page 1 and page 3 cannot appear on page 3 with a
lower `(updated_at, id)` than page 1 already passed. It is picked up by the next sweep,
whose `since` is this sweep's `upto`.

The cost is **duplicates, never omissions** — a row written across a sweep boundary can
arrive twice, so a consumer must upsert, which it must anyway.

**KNOWN BOUND, UNVERIFIED beyond arithmetic.** `xmin` is a 32-bit `xid` and the cast to
`xid8` cannot recover the epoch, so the comparison is meaningful only while the database
has not wrapped 2^32 transactions since the cursor was issued. Years at this write volume,
and the remedy already exists (`45005`, start again) — but **nothing detects the
condition**. Registered as BE-W68 rather than hidden.

**A property worth stating, found by a test failing.** A pull cannot see rows written by the
caller's own uncommitted transaction — they are not committed, and the snapshot says so.
In production every pull is its own transaction and never wrote anything, so the case does
not arise; in tests it means a fixture has to really commit, which is why
`sync-pull.spec.ts` uses a second connection rather than the usual rolled-back one.

#### C2 / C3 / C4 — what was built

`public.sync_pull(p_cursor text, p_entities text[], p_limit integer) returns jsonb`,
migration `20260907001100_sync_pull_phase1.sql`, rollback checked in.

- **Inserts and updates only.** No deletes, no leave-scope. Entities: `visit`, `beat_plan`,
  `doctor`.
- **C3, the incompleteness is a FIELD.** Every response carries a required `completeness`
  object: `reflects: ['insert','update']`, `omits: ['delete','out_of_scope']`,
  `entities`, `omittedEntities`, and a `note` that says a removed or reassigned record will
  keep appearing until a full re-sync and that this must not be presented as a current
  view. A client that parses a response cannot avoid receiving it and does not have to
  version-sniff to know the pull is partial.
- **C4, an RPC.** FIX-08's finding stands: a table read can only ever refuse with RLS
  `42501`, where an RPC can raise something a client can act on. `45005` — *"sync cursor is
  not recognised"* — carries the instruction *start again with a null cursor*, which is a
  full re-sync rather than a retry. `45006`, *cursor expired*, was deliberately **not**
  minted: it becomes meaningful when tombstones acquire a retention window, and a code that
  can never be raised is the same class of thing as an index that can never be used.
- **`security invoker`, deliberately the opposite of BE-W64**, and worth stating so the two
  do not look inconsistent. `search_doctors` needed an index on a non-leakproof predicate,
  which RLS forbids. `sync_pull` filters on a snapshot function over an already-scoped row
  set — the indexable part *is* the scope — so RLS costs nothing here, and letting the
  policies do the scoping avoids transcribing three tables' policies into one body where a
  transcription error is a cross-territory leak.
- **The moment consent or analyses enter this pull it must become `security definer`**,
  because every read of those must write an audit row first and Postgres has no SELECT
  trigger. That is the engineering consequence of §5 question 4, and it is why they are not
  here.

#### C5 — what changed in `packages/core`, and why

The contract as written could not be implemented correctly.

| was | is | why |
| --- | --- | --- |
| `since: IsoDateTime` | `cursor: string` (opaque) | A timestamp cannot address a position inside a tie, and it is the hole-2 trap |
| — | `limit: number` | The server clamps 1–500; the client could not previously ask |
| `deleted: boolean` | `reason: 'upserted' \| 'deleted' \| 'out_of_scope'` | One boolean was standing for three events — destroyed, consent-withdrawn, and no longer yours. Telling an MR a consent record was *deleted* when it was reassigned is false in a direction that matters |
| — | `nextCursor: string` (required) | `hasMore` alone is unactionable |
| — | `completeness` (required) | C3 |
| `entity: SyncEntity` | `entity: SyncPullEntity` | **A new enum, not a widening of the old one.** `SyncEntitySchema` is the outbox's list — things a handset creates. Adding `beat_plan` and `doctor` to it would widen the *write* surface to buy a name for a read |
| `serverTime` | unchanged, and re-documented | It looks like a watermark and is exactly the trap. The docstring now says so |

`services/mock` was reshaped to match, because leaving it emitting the old shape would have
recreated the drift FIX-03 spent a session auditing — `contract.spec.ts` asserts the mock
against `SyncPullResponseSchema` and would have caught it. Its old handler mapped
`fx.syncQueue`, **the outbox**, into pull results, so the frontend has been building against
a pull that echoed back what the device had just sent, with `deleted` always false,
`hasMore` always false and a hard-coded clock. Only visits survive that mapping.

**The response shape is UNEXERCISED.** No real client has received one — C8 forbade wiring
`apps/field` in this session, and the mock is a fixture. Every FIX-06 finding about
response-side drift was found the moment a real client first received a real response, and
that has not happened here yet.

#### C6 — the tests

`services/api/tests/sync-pull.spec.ts`, **12 passed**.

| what | result |
| --- | --- |
| Unauthenticated caller | refused `28000` |
| A cursor the server did not issue | refused **`45005`**, not a generic error |
| A cursor from an unknown version | refused `45005` |
| **Pagination across a tie** — 7 doctors sharing one `updated_at`, page size 2 | every row exactly once: none skipped, none repeated, and the boundary lands inside the tie three times over (asserted, so the test cannot pass by not paging) |
| **A row committed mid-pull** | returned by the next pull, and its own `updated_at` asserted to be *older* than the moment the cursor was issued — the exact condition under which a watermark loses it |
| A completed sweep, pulled again | returns nothing, so snapshot cursors do not turn every pull into a full re-send |
| Incompleteness present on the **first** page | yes |
| Incompleteness present on the **last** page | yes — the page a client is most likely to read as "done, therefore complete" |
| Only `upserted` is ever emitted in phase 1 | yes |
| **Out-of-subtree**: an MR from another region | an **ABSENCE, not a refusal**, and stated as such — `visits_select_own_or_team` is a SELECT policy and a policy filters rather than raising, so the caller cannot distinguish "no changes" from "not yours". Acceptable here because a pull has no action to offer for someone else's rows; recorded rather than left ambiguous |
| A doctor outside the territory | never appears |
| The entity filter | honoured |

#### C7 — three mutations, count unchanged at 12 each

| mutation | what it removes | result |
| --- | --- | --- |
| **A.** the snapshot test replaced by a timestamp watermark — the design the ADR rejected, with everything else untouched | loss-freedom | **1 failed / 11 passed** — exactly *"a row committed DURING a pull arrives on the next pull"*, and nothing else |
| **B.** `completeness` renamed out of the response | the statement of incompleteness | **3 failed / 9 passed** — both C3 assertions and the completed-sweep test |
| **C.** the `id` tiebreak dropped, leaving `updated_at` alone | deterministic paging | **1 failed / 11 passed** — exactly the tie test |

None dropped the case count, so none was a no-op. Mutation A is the important one: it is
the naive implementation, and the suite tells the two apart on the single behaviour that
distinguishes them.

#### Where phase 1 stopped, and on which question

Nothing in Part C stopped early. Phase 1 was scoped in advance to the part that does not
depend on a human answer, and it reached the end of that scope:

- **deletes** stop at ADR §5 question 1 — the tombstone window, and whether a consent
  tombstone conflicts with the withdrawal promise. Legal.
- **leave-scope** stops at question 2 — what an MR keeps when they lose a territory.
  Privacy, with a product answer.
- **consent and analyses in the pull** stop at question 4 — an audit row per pull, per MR,
  per day — and question 5 is upstream of it.

Those three are why `completeness.omits` is not empty, and why it is a field.

---

#### D1 — the deadline warns before it fires

`ucpmp_sample_cap_decision_due` still fails CI on **6 November 2026**. From **16 October** —
21 days, the last third of the 60-day window — `check:decision-debt` prints a GitHub Actions
`::warning::` and **exits 0**.

`warn` and `overdue` are **mutually exclusive in the database**, not in the script. A
warning still true on the day the build goes red teaches a reader to treat the red as a
warning too, and that is how a control stops working without anybody switching it off.

Proved both ways rather than asserted. With a deadline ten days out:

```
::warning title=Decision due::the UCPMP sample cap decision is due on 2026-09-17… -- 10 day(s) left.
A DECISION IS COMING DUE: … This is not failing the build yet. It will.
EXIT: 0
```

and with a backdated one, exit 1. Six new tests: four against the database — inside the
window, outside it, overdue, and cap configured — and two pure, including a negative so a
function that warns *always* cannot pass.

#### D2 — the five questions that need a human, verbatim

Quoted from `docs/adr-sync-pull.md` §5. Requested in FIX-10 and FIX-11 and reproduced here
so they can be routed without opening the file. Each carries one line on what changes.

> **1. The tombstone window (§2.3). How long may a record of a deleted thing be kept, and
> does a consent tombstone conflict with the withdrawal promise? Legal, not technical.**

*What changes:* a longer window lets a handset stay offline longer before it needs a full
re-sync; a shorter one means more full re-syncs. If a **consent** tombstone is not permitted
at all, consent cannot be in the pull, and a withdrawal will never reach a handset that was
offline when it happened.

> **2. What an MR keeps when they lose a territory (§2.5). Privacy question with a product
> answer.**

*What changes:* whether a reassigned MR keeps the old territory's doctor list, visits and
beat plan on their phone indefinitely, or is told those records are gone — and if told,
whether the app says "deleted" (false, and for a consent record dangerously so) or "no
longer yours".

> **3. Whether an updates-only pull may ship (§4), given it must tell the user it cannot
> see deletions.**

*What changes:* the 8 half-days built in this session either reach an MR in the next
increment or wait for the other 21. If it ships, the app must say plainly that it cannot see
removals — the server half now says so in a field, and nothing yet displays it.

> **4. Whether consent and analyses belong in the pull at all. Every such read writes an
> audit row — per pull, per MR, per day. That is a volume and a compliance decision before
> it is a schema one.**

*What changes:* 100 MRs pulling every 15 minutes is roughly 3,000 audit rows a day per
entity type, which would make the pull the largest writer of audit rows in the system.
Excluding them means consent state on a handset can only ever be what that handset itself
recorded. It also decides whether `sync_pull` stays `security invoker`: an audited read
requires `security definer`.

> **5. The offline consent question from FIX-02 §3 is upstream of all of this. If consent
> capture cannot be queued offline, a pull that carries consent records is solving a problem
> the product does not have yet.**

*What changes:* this gates 1 and 4. Answer it first; if consent is never captured offline,
most of the consent-in-sync design disappears rather than being decided.

#### What FIX-11 did not do

- **`apps/field` was not wired to the pull.** Server side and contract only, per C8. The
  response shape is therefore **unexercised by any real client**, which is the state in
  which FIX-06 found every response-side drift instance it found.
- **The console was not wired, no card was removed, consent and samples were not converted,
  and the samples screen's message was not removed.**
- **No dependency was added.** `unaccent` (BE-W66) needs one and was registered rather than
  installed.
- **No index was dropped.** The three prefix redundancies are BE-W67.

---

---

### FIX-12 — offline consent, and the August failures (8 September 2026)

**Not done, and stated first: the client consent write path was NOT converted, the client
was not wired to `sync_pull`, the console was not wired, no card was removed, samples were
not converted, the samples screen's message was not removed, and no dependency was added.**

#### CI and counts

FIX-11's two commits pushed as `52b55e9..0ba7e6d`. Run **`34153100125`: success**, both
jobs — `typecheck · lint · format · unit tests` and `migrations · Gate 0 RLS suite ·
rollbacks`. api **443 passed / 18 files** on that run.

| package | at 0ba7e6d (CI) | after FIX-12, locally |
| --- | ---: | ---: |
| `@fieldforce/api` | 443 / 18 | **459 passed / 18 files** |
| `@fieldforce/field` | 341 / 23 | unchanged |
| `@fieldforce/ui-tokens` | 54 / 3 | unchanged |
| `@fieldforce/mock` | 40 / 1 | unchanged |
| `@fieldforce/core` | 21 / 3 | unchanged |
| `@fieldforce/ui` | 4 / 1 | unchanged |

**+16**: 5 cursor bounds, 9 offline consent, 2 CI-ordering guards. No skips — every summary
line reads `N passed (N)`. `verify:rollbacks`: *"All rollbacks applied in reverse order;
public schema is empty"* — **31 migrations, 31 rollback files**. `turbo run typecheck lint`:
**16 successful, 16 total**.

---

#### A2 — what actually happened on 21–23 August

**Nothing in this repository failed. Nothing in this repository ran.**

`gh run view --log-failed` returns `log not found` for every failure in the window, which
is the first clue: there is no log because there was no run. The run listing shows exactly
one transition and no flapping:

```
runs in 20-24 Aug: 100
  ('Audio retention',          'schedule', 'failure') -> 33
  ('Audio retention',          'schedule', 'success') -> 17
  ('Audio retention watchdog', 'schedule', 'failure') -> 32
  ('Audio retention watchdog', 'schedule', 'success') -> 17
  ('CI',                       'push',     'failure') ->  1

TRANSITION success -> failure at 2026-08-21T22:11:01Z   (run 32531877892)
runs after the transition: 65
any success after it: 0
workflows affected: ['Audio retention', 'Audio retention watchdog', 'CI']
```

The job objects settle it:

```
last success  21 Aug 21:12 -> runner_id 1000000703, runner_name 'GitHub Actions 1000000703', steps: 12, 23s
first failure 21 Aug 22:11 -> runner_id 0,          runner_name '',                          steps:  0,  3s
23 Aug CI push, both jobs  -> runner_id 0,          runner_name '',                          steps:  0,  2s
```

**No runner was assigned and no step ever executed** — and the same is true of CI on a
push, so it was never a retention problem. A job created but never dispatched, with
`conclusion: failure` rather than `startup_failure` (so the workflow parsed and the job
existed), across every workflow in the repository, is the shape GitHub produces when a
hosted runner cannot be allocated. The ordinary cause is Actions minutes or a spending
limit exhausted at the account level.

**UNVERIFIED: the specific account-level cause**, which is on a billing page this machine
cannot read. **Verified:** it was infrastructure-level and repository-wide, not workflow-
or code-level.

**Is it still present? No.** The 7 September scheduled runs got real runners and ran every
step (`purge …: destroyed 0, failed 0` · `"stalled": false` · `Audio retention is
healthy.`). **UNVERIFIED: what changed** — nothing in the repository explains it, and a
billing-cycle reset between 21 August and 7 September is consistent with the evidence
without being evidence.

**What to watch for:** the signature is `runner_id: 0`, zero steps, a few seconds, and it
appears on CI at the same time as on retention. That is the quickest way to tell an
account-level outage from a code failure, and it is now written into `handoff.md`.

#### A3 — the handoff correction

New dated section appended to `handoff.md`; the existing §5 text is untouched, per the
section-freezing rule. It replaces *"this was not a response to a failure, and no reason
was given."*

**The reviewer's proposed sequence is right about the order and wrong about the middle.**
They were not disabled *rather than fixed*: nothing in this repository could have fixed
them, because nothing in this repository was executing. Disabling a workflow that fails
every hour without running a line is a reasonable response to noise. **The consequence
stands exactly**: no runs → no traffic → the free-tier project auto-paused → unnoticed for
two weeks. And "no reason was given" is explained if not excused — there was a reason, it
was 34 hours of red builds, and nobody wrote it down.

#### A4 — nothing else runs after `verify:rollbacks`, and now a test says so

**The finding: only `Stop Supabase` follows it**, which carries `if: always()`, touches
containers rather than the schema, and must run even when an earlier step failed. Neither
retention workflow has a destructive schema step, so the class does not arise there.

**The class deserved a control rather than a comment.** This was the second CI defect in
three sessions where a correct check sat in the wrong place in a mutating environment —
FIX-08's was the dependency graph, FIX-10's was schema state — and the dangerous version is
not the one that failed. A step that reads an empty schema and **passes** (a count that is
legitimately zero, a "nothing to do") proves nothing and reports green.

Two assertions in `scripts-convention.spec.ts`: the ordering itself, so a step added at the
bottom of the job fails here rather than in six months, and the specific instance that has
already gone wrong once. **Mutation:** moving the decision step back after
`verify:rollbacks` fails **2 of 3**, count unchanged.

---

#### B1 — frozen rows: the hazard is real, the bound is a proof

`pg_visible_in_snapshot` is a pure function of its two arguments and never consults the
heap, and measured on this Postgres 17 the everyday paths do not rewrite `xmin`:

```
insert                -> xmin 1293
vacuum freeze         -> xmin 1293    (freezing sets HEAP_XMIN_FROZEN hint bits)
vacuum full (rewrite) -> xmin 1293
```

**The hazard is real anyway.** There are paths where a genuinely frozen tuple reads as
`xmin = 2`, and `FrozenTransactionId` is visible in **every** snapshot — so such a row reads
as "already seen in `since`" and is dropped **silently**: a well-formed, incomplete answer
with no way for the client to tell. Verifying that case directly needs 50,000,000
transactions to elapse and is **UNVERIFIED here**.

**The bound does not depend on which way that goes.** A row still owed to a client changed
*after* the cursor was issued, so `age(row.xmin) < age(cursor.xmin)`; a tuple cannot be
frozen until `age(xmin) >= vacuum_freeze_min_age`. Below that, nothing owed can have been
frozen. Past **half of `vacuum_freeze_min_age`** — read from the server's own setting so it
cannot drift from what it is derived from — the cursor is refused with **SQLSTATE 45006**
and the client is told to re-sync. `completeness.maxCursorAgeTransactions` reports the
limit before it bites.

`45006` was reserved in FIX-11 and deliberately not minted until it could be raised. It is
distinct from `45005` because the two read the same to a machine and not to a person:
45005 means the cursor is wrong, 45006 means it was right and is now too old — the
difference between a bug and a handset in a drawer.

Tested through the real code path by lowering `vacuum_freeze_min_age`, which is `USERSET`
— on a committed connection, because a cursor cannot age inside the transaction that issued
it. Plus the negative, so a function that refuses *every* cursor cannot pass.

#### B2 — cursor size is bounded by `max_connections`

The cursor carries two `pg_snapshot`s as text, `xmin:xmax:xip_list`. Only `xip_list` grows,
one xid per in-flight transaction, which cannot exceed `max_connections` (100 here):

```
per snapshot <= 2*10 digits + 2 colons + max_connections * 11 bytes  ~= 1,122 B
whole cursor <= two of those + a uuid + a timestamp + JSON keys      ~= 2,400 B
```

**Cap 8,192 bytes, checked before anything parses it, and refused rather than truncated.**
Truncation is the dangerous option, not the safe one: `xmin:xmax:` with a shortened
`xip_list` is still a syntactically valid snapshot describing a *different* set of
in-flight transactions, so it would parse and answer a different question.

#### B3 — wraparound: assumption stated, no work

`xmin` is a 32-bit `xid` and the cast to `xid8` cannot recover the epoch. At 100 MRs
writing a few thousand rows a day, 2^32 transactions is years away, and **the freeze bound
fires first in every realistic ordering** — `age()` is itself wraparound-aware, so a cursor
old enough to matter is refused as expired long before its raw value becomes ambiguous.
BE-W68 stands.

#### B4 — all three are in `docs/adr-sync-pull.md` §7

Beside the mechanism, with a fourth entry: a pull cannot see rows written by the caller's
own uncommitted transaction. Correct — they are not committed — and it is why
`sync-pull.spec.ts` stages fixtures on a second connection.

---

#### C — consent capture works offline, on a bounded and auditable trust

**The defect being removed.** FIX-01 found that `capture_consent` recorded a consent
version the doctor never saw. FIX-02 fixed it by requiring the displayed version and
refusing it unless it was the version active `now()` — at the moment the write landed on
the *server*. Right for the defect in front of it, and it made offline capture impossible:

```
09:40  an MR captures consent in a clinic with no signal
14:00  the notice is superseded by somebody in an office
18:00  the handset syncs
       -> 45001, "the notice changed since it was displayed"
```

The notice did not change since it was **displayed**. It changed since it was **received**.
A content update on a Tuesday afternoon would refuse a whole day of field work with the
doctors already gone, and the MR's prescribed remedy — re-read the notice and ask again —
would be impossible to carry out.

**The trust model, stated rather than implied.** You cannot cryptographically establish
when a doctor read something on a device you do not control. A server-issued token was
considered and does not work: it would be issued when the app *fetched* the notice, not
when the doctor *read* it, so an app carrying a notice cached twenty days ago would present
a token whose issue time predates the supersession anyway — more machinery, the same trust
boundary. This design bounds the trust and makes it auditable instead of pretending to
eliminate it.

**C1.** `capture_consent` now validates against **`p_captured_at`**, not `now()`. The
mechanism is a new `active_consent_text_at(language, at)`, and `active_consent_text(l)` is
**redefined to call it with `now()`**, so there is one rule and not two that can drift.

**C2 — three bounds, three SQLSTATEs, because the MR's remedy differs in each:**

| bound | code | what the MR is told |
| --- | --- | --- |
| `captured_at` may not be in the future | **45007** | the device clock is ahead; fix it and sync — **do not re-ask the doctor** |
| `received_at - captured_at <= consent_max_sync_lag_hours` | **45008** | sync sooner; this capture arrived too late to accept on the device's word |
| the version must have been the active one **at `captured_at`** | **45001** | re-read the current notice and ask again — and now this is a remedy that can actually be carried out |

A client that cannot tell these apart tells the MR the wrong thing. Telling somebody to
repeat a consent conversation because their phone thinks it is Thursday is both useless and
slightly insulting.

**C3 — both timestamps, and the gap, on the row.** `captured_at` (the handset's claim) and
`received_at` (the server clock, defaulted to `clock_timestamp()`, with **no parameter a
caller could supply** — asserted) were already stored. Added:

```sql
alter table public.consent_records
  add column capture_lag interval
  generated always as (received_at - captured_at) stored;
```

Stored rather than computed on read, because a bounded trust that is only auditable if
somebody remembers to write the right expression is not auditable. *"Which MR's captures
consistently arrive hours late"* is now a query. `captured_at <= now()` and
`received_at = clock_timestamp() >= now()` together mean `capture_lag` can never be
negative — asserted.

**C4 — the maximum lag is configurable, defaulted, and UNVERIFIED.**
`consent_max_sync_lag_hours = 72`, in `app_thresholds`.

**Deliberately not null, unlike `ucpmp_sample_cap_quantity`.** Null there meant "accepted,
uncounted, and the app says so". Null here would mean **unbounded trust in a device clock**,
which is the thing being bounded — so the permissive branch is not available and there has
to be a number.

Why 72: FE-G2 promises a full offline day, and the failure mode of a value that is too
**small** is destroying legitimate field work with the doctors already gone — the exact
failure this migration exists to remove. 72 hours covers a weekend plus a day, so the
promised case can never be refused by this bound. The failure mode of too **large** is a
wider window in which a wrong device clock is accepted, which is visible in `capture_lag`
rather than silent. **How long a consent may sit on a handset before it stops being
acceptable is a compliance decision, not an engineering one.** Added to the escalation list.

**C5 — no consent test was deleted, and that claim is checked rather than asserted.**

The FIX-02 suite passes **unchanged**: `consent-audio.spec.ts` was 40 passed before this
migration and 40 of the 49 after it are the same cases.

They can pass, because **this is not a change of rule**. FIX-02's rule was "the supplied
version must be the active one"; this is the same rule asked about a different instant.
When a capture happens now, the two are the same question, and FIX-02's assertions — that a
version superseded *before* the capture is refused, that a version that does not exist is
refused, that a capture with no version at all is refused — are all still true and all
still enforced.

**This is the second time a consent test has been in question in this project, so it is
stated plainly rather than left to inference: nothing was removed, weakened, or
re-scoped.** What was added is the case FIX-02 could not express — a notice superseded
*after* the doctor was asked and *before* the handset could sync — plus its mirror, that an
app still cannot claim the doctor read a notice which did not exist yet.

**9 new tests:** the offline acceptance, both refusal directions, the three bounds each with
a positive control, the threshold being read from `app_thresholds` rather than hard-coded,
`capture_lag` matching `received_at - captured_at` and never negative, and `received_at`
having no caller-supplied parameter.

**C6 — mutations. Count unchanged at 49 each.**

| mutation | what it removes | result |
| --- | --- | --- |
| a scoped `BEFORE INSERT` trigger returning `NULL` on `consent_records` | **the write** | **7 failed / 42 passed** — every persistence assertion, FIX-02's three "records X against the version the client displayed" and the idempotency case included, plus all three FIX-12 acceptance cases |
| validate against `now()` again instead of `captured_at` | **the C1 change** | **2 failed / 47 passed** — exactly the offline acceptance and its mirror. This is the FIX-02 behaviour, and the suite tells the two apart on precisely the cases that distinguish them |
| the `45008` lag bound made unreachable | **a refusal** | **2 failed / 47 passed** — the lag refusal and the configurability test; every persistence case stayed green |

Neither side alone proves the path: the first shows the write is real, the others show the
refusals are. None dropped the case count, so none was a no-op.

**C7 — the client consent write path was NOT converted.** Server and contract only.

#### The error contract, and a gap it had

`packages/core/src/shared/refusals.ts` gains `45004`–`45008`.

**`45004` was minted in FIX-09 and never reached the contract.** A server-side code with no
client-side mapping renders as `unrecognised`, which is honest and useless: the MR is told
the app does not know why, when the server said something specific and actionable. The
lesson is that minting a SQLSTATE is half the work, and it is recorded next to the table.

Actionability is set per code rather than by default: `45004` is **not** actionable (the
remedy is somebody else's decision), while `45005`, `45006`, `45007` and `45008` all are —
and each is a different action.

#### D — the reviewer's answers, recorded

`docs/adr-sync-pull.md` §6, dated, superseding §5's *status* and not its text:

- **Q1 tombstones — payload-free**: an id, a type and a reason class is not a record *of*
  the deleted thing, so the retention conflict does not arise. Conservative under either
  legal answer, so phase 2 need not wait for one. Supersedes §2.3(a).
- **Q2 leave-scope — the app must never say "deleted."** False, and for a consent record
  dangerously so. "No longer yours." Settles §2.5 in favour of a distinct `reason` and
  rules out option (a). A reassigned MR losing the old list is a **privacy requirement**;
  how gracefully is a product choice, **still open**.
- **Q3 updates-only pull — ships on the server, does not reach an MR** until a client
  surface displays the incompleteness field. The server says it is incomplete; nothing
  renders that yet.
- **Q4 consent and analyses — both out.** Analyses are moot under both live scope options.
  Consent's audit cost is ~3,000 rows/day/entity and its value is reinstall-only, which
  belongs in an explicit one-time restore that audits once. This is also what keeps
  `sync_pull` `security invoker`.
- **Q5 offline consent — shape (b) with bounds**, implemented above. **It accepts a bounded
  client-clock trust deliberately, and that acceptance needs client ratification.**

#### What FIX-12 did not do

- **The client consent write path was not converted**, and no client was wired to
  `sync_pull`. Both are separate reviews.
- **The console was not wired, no card was removed, samples were not converted, and the
  samples screen's message was not removed.**
- **No dependency was added.**
- **The 72-hour maximum sync lag is a default, not an answer.** It is live, so unlike the
  UCPMP cap the control is not inert — the risk here is a wrong value rather than an absent
  one, which is why it carries no deadline mechanism and does carry an escalation.

---

---

### FIX-13 — the minutes, the contract gap, and tombstones (8 September 2026)

**Not done, and stated first: no client was wired to anything, the console was not wired,
no card was removed, samples were not converted, the samples screen's message was not
removed, and no dependency was added.** `pg_cron` was scoped, not installed.

#### CI and counts

FIX-12's three commits pushed as `9995cbc..d42fd58`. Run **`34155565813`: success**, both
jobs. api **459 passed / 18 files** on that run.

| package | at d42fd58 (CI) | after FIX-13, locally |
| --- | ---: | ---: |
| `@fieldforce/api` | 459 / 18 | **474 passed / 19 files** |
| `@fieldforce/mock` | 40 / 1 | 40 / 1 |
| `@fieldforce/field` | 341 / 23 | unchanged |
| `@fieldforce/ui-tokens` | 54 / 3 | unchanged |
| `@fieldforce/core` | 21 / 3 | unchanged |
| `@fieldforce/ui` | 4 / 1 | unchanged |

**+15**: 4 error-contract, 9 phase-2 sync, 2 rewritten completeness assertions that became
three. No skips — every summary line reads `N passed (N)`. `verify:rollbacks`: *"All
rollbacks applied in reverse order; public schema is empty"* — **32 migrations, 32 rollback
files**. `turbo run typecheck lint`: **16 successful, 16 total**.

---

#### A2 — the minutes hypothesis is refuted. This repository is public.

**The premise of the whole calculation is false, and it is one query:**

```
$ gh api repos/Praverse-Tech-Pvt-Ltd/Elmiron-App --jq '{private, visibility}'
{"private": false, "visibility": "public"}

$ gh api repos/.../events --jq '[.[] | select(.type=="PublicEvent") | .created_at]'
["2026-08-06T06:18:53Z"]        # identical to created_at
```

**The repository has been public since the instant it was created**, fifteen days before
the outage and eight days before the retention workflows were first enabled. GitHub Actions
on standard hosted runners is free and unmetered for public repositories; the monthly
allowance applies to **private** repositories only. **So Actions minutes cannot have caused
the August outage, and cannot cause the next one.**

**The cadence was also misread.** `retention-watchdog.yml` is `cron: '15 * * * *'`, which is
*hourly at minute 15* — a 15-minute **offset** from `retention.yml`'s `'0 * * * *'`, not a
15-minute cadence. The comment in the file says "on a 15-minute offset so it checks after"
the purge. So it is ~730 runs a month, not ~2,880.

**The measured burn, for completeness, from 441 runs in August:**

| workflow | runs | wall clock | billable minutes |
| --- | ---: | ---: | ---: |
| Audio retention | 211 | 77.2 min | 211 |
| Audio retention watchdog | 205 | 67.3 min | 205 |
| CI | 25 | 67.3 min | 156 |
| **Total** | **441** | | **572** |

Billable rounds each **job** up to a whole minute — CI has two jobs, the others one — and
every scheduled run rounds to exactly 1. August is understated because the workflows were
disabled from the 23rd; **projected to a full month at the configured hourly crons that is
730 + 730 = 1,460 minutes for the schedules, plus roughly 150–300 for CI: about
1,600–1,800 a month.**

**Against a hypothetical private-repo Free allowance of 2,000 minutes, that is under it —
and against this repository's actual allowance it is irrelevant, because a public repository
has none.** UNVERIFIED: the 2,000/3,000 figures were not confirmed; the org billing endpoint
returned `410 This endpoint has been moved` and its replacement needs `admin:org`, which
this token does not have. It does not matter for the conclusion.

**So what did cause it? Still UNVERIFIED, and now with a shorter list.** The remaining
candidates are Actions disabled at the org level, an account restriction, or a platform
incident — all of which need the org audit log, which returns `404` to this token. What is
now excluded is the explanation everyone reached for.

**The prediction is also withdrawn.** There is no billing-cycle boundary for this repository
to trip over on 1 October.

#### A3 — `pg_cron` scoped, and it is not "the same SQL on a different clock"

**Verdict: it cannot replace `retention.yml` without a second implementation, which is the
thing this project rejected twice. It can do something smaller and genuinely useful.**

The purge is **not pure SQL.** Its shape is claim → delete → confirm, and the middle step is
an HTTP `DELETE` to the Supabase Storage API:

```
purge-expired-audio.mjs:3   import { deleteStorageObject } from './storage.mjs';
storage.mjs:48              const response = await fetch(`${config.apiUrl}/storage/v1/object/...`)
```

A row in `storage.objects` is not the object; deleting the row leaves the file behind. So
`pg_cron` alone cannot run this at all.

`pg_cron` **is available** on this stack (1.6.4, not installed) and `pg_net` **is already
installed** (0.20.4), so `pg_cron` + `pg_net` could technically do it. That is where it
stops being attractive:

- **`pg_net` is asynchronous.** It queues a request and writes the result to
  `net._http_response` later. The current worker confirms a row only after a successful
  delete and records a failure otherwise; with `pg_net` that handshake needs a *second*
  scheduled job to reap responses and then call `confirm_audio_destroyed` or
  `record_audio_purge_failure`. **That is a second implementation of the error handling, in
  plpgsql, alongside the existing one in JavaScript.**
- **The subtle branch would have to be rewritten too.** Supabase Storage returns HTTP **400**
  with `{"statusCode":"404", …}` in the *body* when an object is already gone.
  `storage.mjs` exists because BE-W6 got that wrong and the bug went unnoticed *because the
  branch was never reached*. Re-implementing it in SQL is exactly the risk this project has
  spent ten sessions removing.
- **The JavaScript path does not go away regardless.** `reconcile-after-restore.mjs` also
  calls `deleteStorageObject`.

So on the reviewer's own test — *no second implementation and no second language* — this
fails it. **It differs from the rejected Edge Functions proposal only in where the second
implementation would live, not in whether there would be one.**

**What `pg_cron` could do, and it is worth its own task.** The SQL-only half —
`close_stale_upload_sessions()`, plus a periodic `audio_purge_health()` read — needs no HTTP
at all. Scheduling those inside the database would generate steady database traffic, which
is the thing whose absence let the free-tier project auto-pause in August (**B14**). That is
a small, separable change that closes a real problem without touching the purge.

**UNVERIFIED, and it decides whether that is worth doing:** whether Supabase counts internal
`pg_cron` activity as the traffic that prevents a free-tier pause. The pause is documented
against project *inactivity* without defining whether internal jobs qualify. **Registered as
BE-W69 rather than assumed**, and installing `pg_cron` is a dependency — asking first.

#### A4 — the diagnostic is in `docs/gotchas.md`

The signature, the two `gh api` queries that identify it, a healthy job beside a failed one
for comparison, and the public-repo check that rules out the billing explanation before
anybody spends a session on it. Including the trap: **`gh run view --log-failed` returning
`log not found` is confirmation, not an obstacle** — there is no log because there was no
run, and reading it as "the logs expired" sends you looking for a code defect that does not
exist.

---

#### B — the 45xxx gap, closed by a derived control

`services/api/tests/error-contract.spec.ts`. **The list is derived from the live database,
not maintained**, which is the difference between a control and a second thing to forget.

```sql
select distinct m[1] as token
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral regexp_matches(p.prosrc, 'errcode\s*=\s*''([A-Za-z0-9_]+)''', 'g') m
 where n.nspname = 'public';
```

**Two things a naive derivation gets wrong, and writing it found both.**

**1. `errcode` takes condition NAMES as well as codes.** The query above returns sixteen
tokens: twelve five-character codes and four names —

```
0A000 22023 28000 42501 45001 45002 45003 45004 45005 45006 45007 45008
check_violation  foreign_key_violation  restrict_violation  unique_violation
```

`reject_mutation`, the append-only enforcement on nine tables, raises
`errcode = 'restrict_violation'`, **not** `'23001'`. A regex for `'[0-9A-Z]{5}'` misses it
and every other named condition — and would then have reported `23001` as a contract entry
nothing raises, sending the next reader to delete a mapping that is load-bearing. The names
are resolved **by raising them and catching the SQLSTATE**, because Postgres publishes no
catalogue of the mapping and any table written into the test would be the hand-maintained
list it exists to avoid.

**2. Scanning the migration FILES is not scanning the database.** A code raised in a
superseded `create or replace` body still appears in the files and is raised by nothing.
`pg_proc` holds what is live — the same rule this project already applies to function
bodies.

**B3 — both mutations, count unchanged at 4 each:**

| mutation | result |
| --- | --- |
| `'45008'` removed from `BY_SQLSTATE` | **B1 fails**: `expected [ '45008' ] to deeply equal []` |
| `'45099'` added to `BY_SQLSTATE`, raised by nothing | **B2 fails**: `expected [ '45099' ] to deeply equal []` |

Each failed its own assertion and only its own.

**B4 — nothing beyond `45004`.** The sixteen resolved SQLSTATEs and the sixteen contract
entries match exactly in both directions. `45004` itself was already fixed in FIX-12; had
this control existed in FIX-09 it would have caught it the same day.

`BY_SQLSTATE` is now exported from `packages/core` so the test compares against the module
rather than a regex over its text, and cannot drift from it.

---

#### C — sync_pull phase 2: tombstones and leave-scope

**C6 first, because it is the one place phase 2 could create a compliance problem.**

**How a tombstone is stopped from telling a caller that a record they were never permitted
to see has been deleted.**

A tombstone is an existence claim: *"doctor 7f3a… was deleted"* tells a reader that doctor
7f3a… existed. **It cannot be filtered at read time, because the row is gone** — there is
nothing left for a policy to evaluate. Two independent protections, and the first does the
real work:

1. **The scope is captured at the moment of the event, and RLS admits the tombstone only to
   a caller for whom that FORMER scope was visible.** `sync_events` stores exactly one of
   `former_mr_id` (who owned the visit or beat plan) or `former_territory_id` (which
   territory the doctor was in) — enforced by a check constraint, because a row with
   neither is invisible to everyone and a row with both is ambiguous about which policy
   admits it. The policy is `former_mr_id in (select visible_user_ids())` or
   `former_territory_id in (select current_user_visible_territory_ids())`. **A caller who
   could never see the record can never match its tombstone**, and that is a policy on a
   stored value rather than an argument about ordering.

2. **No tombstone is emitted on a full re-sync at all.** A pull with a null cursor is a
   client rebuilding from nothing; it holds no stale rows to correct, so a tombstone could
   only tell it about records it never had.

**Payload-free does not mean scope-free, and that is the design rather than a compromise.**
The scope keys are the only thing a tombstone carries beyond the id, the type and the
reason — no name, no date, no outcome, no text. What a visit tombstone retains is that an MR
once had a visit with that id, which is the minimum needed to tell **that MR, and only that
MR**, to drop it.

Also: **there is no INSERT, UPDATE or DELETE policy on `sync_events`.** Rows arrive through
a `SECURITY DEFINER` trigger and leave through a `SECURITY DEFINER` purge, so a client can
neither forge a tombstone for somebody else's record nor suppress its own. Asserted: both
attempts refuse with `42501`.

**C1 — one table, one stream.** Deletes and leave-scope are the same shape — *"this id is no
longer yours, and here is why"* — and are merged into the same `(updated_at, id)` order as
rows. They inherit phase 1's snapshot visibility for free: the event is written by an
`AFTER` trigger in the same transaction as the change, so its `xmin` is that transaction's
and it becomes visible exactly when the change commits.

**C2 — `out_of_scope` is its own reason class.** Emitted when the *scope key* changes —
`doctors.territory_id`, or `visits.mr_id` / `beat_plans.mr_id`. The old owner receives
`out_of_scope`; the **new owner receives the same record as an ordinary `upserted`** through
the row path, because its `xmin` changed. Both halves are asserted.

**C3 — the completeness field shrinks, and that is asserted.**

| pull | `reflects` | `omits` |
| --- | --- | --- |
| incremental | `insert, update, delete, out_of_scope` | `[]` |
| full re-sync | `insert, update` | `delete, out_of_scope` |

The full re-sync still declares the omission **because it is still true** — it carries no
tombstones by design — and its `note` says the honest thing instead: everything you are
entitled to see is in the stream, so anything absent from it is gone; replace rather than
merge. A completeness field that does not move as capability grows becomes a lie in the
other direction, and a client still warning about missing deletes after they arrive is as
wrong as one that never warned.

**C4 — the lifetime is the FIX-12 cursor bound, expressed the same way.**
`age(event.xmin) >= vacuum_freeze_min_age / 2`. In transactions, not days, so the two
cannot drift apart and nothing has to convert between them. The pull filters expired events
*and* `purge_expired_sync_events()` deletes them, so the guarantee holds between purge runs.
Safe rather than merely convenient: an event older than the oldest acceptable cursor has
already reached every client entitled to it, because any client whose cursor is younger has
seen it and any client whose cursor is older is refused with `45006`.

**C5 — nine tests, all passing.**

| what | result |
| --- | --- |
| a delete arrives after the update that preceded it, `payload: null` | yes |
| a tombstone sorts after an earlier update of a different record | yes — index ordering asserted |
| a full re-sync carries no tombstones | yes |
| a reassigned record arrives as `out_of_scope`, **never** `deleted`, and the row still exists | yes |
| the new owner sees it as an ordinary `upserted` with a payload | yes |
| **C6: an MR in another territory is never told the record existed** | absent from the pull **and** invisible in `sync_events` itself, with a positive control proving the event does exist and the former owner can see it |
| no client can write or suppress an event | `42501` on both |
| an event past the maximum cursor age is not served | yes, and the stale cursor is refused `45006` |
| the purge deletes exactly the expired ones | `0` before, `>0` after, row gone |

**Two rewritten assertions, stated rather than quietly changed.** The phase-1 tests
*"carries the incompleteness as a FIELD"* and *"a completed sweep does not return the same
row again"* asserted `omits` contains `delete`. **That was true and phase 2 makes it false**
— which is the change C3 asked to be asserted, not a weakening. They now assert what did not
change: the field is present, required and machine-readable in every response, and
`reflects` and `omits` never overlap. The phase-dependent content is asserted by the two new
C3 tests, one per direction.

**Two defects caught by existing Gate 0 guards while building this**, and worth recording
because both are the project's characteristic shape:
`rls.spec.ts`'s *"leaves anon with nothing at all"* and `foundations.spec.ts`'s *"grants
TRUNCATE on nothing in public"* both failed on the new table. Supabase's default privileges
hand `anon`, `authenticated` and `service_role` a full grant on every new table in `public`
and no migration can change that default — **the same class as FIX-05's 65 anon-executable
functions, wearing tables.** Fixed with the revokes every other table in this schema carries.

**C7 — both mutations, count unchanged at 28 each:**

| mutation | what it removes | result |
| --- | --- | --- |
| `emit_sync_event()` neutered to return without inserting | **the write** | **6 failed / 22 passed** — every tombstone, leave-scope, disclosure and expiry case |
| the RLS policy replaced with `using (true)` | **the scope refusal** | **2 failed / 26 passed** — the C6 disclosure case, and the new-owner case, which fails because with no scoping the southern MR receives an `out_of_scope` event for a doctor they have just *gained* |

Neither alone proves the path: the first shows the events are real, the second shows the
scoping is. The second mutation is the important one — it is the compliance failure, and the
suite fails on exactly it.

**C8 — no client was wired.** Server and contract only.

**`packages/core` needed no change**, which is worth noting rather than glossing:
`SyncChangeReasonSchema` already declared `deleted` and `out_of_scope`, and
`SyncCompletenessSchema`'s enums already admitted them. The phase-1 contract was written for
a server that did not exist yet and turned out to fit the one that does. `services/mock` was
moved to phase 2 in step, including one payload-free tombstone, so the fixture does not
teach a client to warn about a gap that has closed.

#### The project's own finding about itself

Five sessions have now found the same shape, and it is worth stating as a prediction rather
than a list:

| found in | what was believed, written down, and never exercised |
| --- | --- |
| FIX-02 | `capture_consent` recorded the version the doctor was shown |
| FIX-05/06 | `ALTER DEFAULT PRIVILEGES` protected future migrations |
| FIX-09/10 | the trigram index served doctor search |
| FIX-09 | `45004` reached the MR as an actionable refusal |
| FIX-12 | the August failures were a retention problem |
| FIX-13 | the outage was Actions minutes on a private repository |

**The characteristic defect of this codebase is not bad code. It is unexercised code that
looks exercised**, and the only detector that has ever worked is trying to use it — which is
also why the four hollow tests were all found by mutation rather than by review.

**That predicts where the next one is: anything not yet called by a real client.** Which,
today, is every response shape in the contract — `sync_pull` phases 1 and 2 included, since
C8 forbade wiring one.

#### What FIX-13 did not do

- **No client was wired to anything.** The phase-2 response shape is unexercised by any real
  consumer, which by the paragraph above is where the next finding will be.
- **`pg_cron` was scoped, not installed.** It is a dependency, and the rule is to ask.
- **No index was dropped** (BE-W67), **no accent search was added** (BE-W66), the console
  was not wired, no card was removed, samples were not converted, and the samples screen's
  message was not removed.

---

---

### FIX-14 — the first client against a real response (8 September 2026)

**Not done, and stated first: the consent client path was NOT converted, the console was
not wired, no card was removed, samples were not converted, the samples screen's message
was not removed, `pg_cron` was NOT added, and no dependency was added.**

#### CI and counts, split by workspace and runner

FIX-13's two commits pushed as `aea2fdc..5e14cf0`. Run **`34157491347`: success**, both
jobs.

| workspace | runner | before | after FIX-14 |
| --- | --- | ---: | ---: |
| `@fieldforce/api` | vitest, live database | 474 / 19 files | **490 passed / 21 files** |
| `@fieldforce/field` | vitest, logic | 341 / 23 files | **355 passed / 24 files** |
| `@fieldforce/field` | **jest, jest-expo render** | 72 / 12 suites | **72 passed / 12 suites** |
| `@fieldforce/ui-tokens` | vitest | 54 / 3 | 54 / 3 |
| `@fieldforce/mock` | vitest | 40 / 1 | 40 / 1 |
| `@fieldforce/core` | vitest | 21 / 3 | 21 / 3 |
| `@fieldforce/ui` | vitest | 4 / 1 | 4 / 1 |

**api +16**: 6 privilege posture, 10 round-trip contract. **field +14**: the pull consumer.
No skips — every summary line reads `N passed (N)`. `verify:rollbacks`: schema empty,
**33 migrations, 33 rollback files**. `turbo run typecheck lint`: **16 successful, 16
total**.

#### A2 — BE-W69 declined, and B14 is a cost decision

`pg_cron` is **not** added. The reviewer's reasoning is recorded rather than summarised
because it is the general principle, not a verdict on one extension:

> The keep-warm idea is a workaround for not paying for Supabase. A pilot handling real
> consent records cannot run on a tier that switches itself off when the crons go quiet,
> and that has already happened once. Adding a scheduler and a dependency to avoid ~$25 a
> month is the wrong trade, and it puts a second cron in a second place for a reason that
> is really a budget line.

**B14 moves from the engineering backlog to the operator's cost line.** There is no task
here to schedule, no extension to install, and no design to review — there is an invoice to
approve. The auto-pause has already cost this project two weeks of unnoticed silence, which
is the number that should be set against the monthly one.

#### A3 — the ADR correction

`docs/adr-sync-pull.md` §8. Q1's answer said a tombstone holds *"nothing personal in it"*.
Implementation needed one thing more: **the scope the record HAD**, exactly one of
`former_mr_id` or `former_territory_id`. It has to — a tombstone is an existence claim and
cannot be filtered at read time, so without the stored former scope either every tombstone
reaches everybody or none reaches anybody.

So **payload-free means no payload about the deleted thing** — no name, date, outcome or
text — and what remains is an id, a type, a reason class, and an **employee** identifier
already present on every row in `visits`, `beat_plans` and the audit log. Justified, and
narrower than the phrase Q1 used. §8 states where it would start to matter: a *consent*
tombstone would be a claim about a withdrawal event, which is what Q1 was asking about.
Q4 keeps consent out of the pull, so it does not arise — and the paragraph exists so that
nobody carries Q1's wording across if Q4 is ever revisited.

---

#### B — one guard, and a seventh instance

**B4: yes, it found something neither previous guard covered.** Three sequences:

```
audit_log_id_seq                       | {postgres=rwU/postgres,anon=w/postgres,...}
audio_destruction_log_id_seq           | {...,anon=w/postgres,...}
restore_reconciliation_findings_id_seq | {...,anon=w/postgres,...}
```

They are the only three sequences in `public` — every other table keys on a uuid; these use
`generated always as identity`. `foundations.spec.ts` and `rls.spec.ts` read
`information_schema.role_table_grants`, which lists tables and views and **not** sequences;
the FIX-06 guard reads `pg_proc`. A sequence is in neither place, so the grant has been
there since the migration that created each one.

**What `w` on a sequence permits** is `nextval()`, `setval()` and `currval()` — so `anon`
could reset the identity counter of the **audit log**, and rewinding it produces
duplicate-key failures on every subsequent audit write. That is a denial of service against
the one table this product uses to prove what happened.

**UNVERIFIED: whether there is a reachable path to exploit it.** PostgREST does not expose
`setval` and no function in `public` calls it, so as far as this repository can see the
grant is unreachable in practice. Revoked anyway, in `20260908000400`: reachability changes
the day somebody adds a function, and the grant would already be in place.

**The guard itself was wrong first, in the same direction as the defect it catches.** It
was written against the ACL columns — `relacl`, `proacl`, `typacl`, `nspacl` — and a
freshly created function has `proacl = null`, meaning *the defaults apply*.
`aclexplode(null)` yields nothing, so the guard reported a clean posture for exactly the
object class FIX-05 found 65 of. **The positive control caught it**, which is what a
positive control is for, and it is rewritten onto `has_*_privilege`, which evaluates
explicit grants, `PUBLIC` inheritance and defaults alike.

**B2, the allowlist**: one entry, `schema public → USAGE`, with its reason — PostgREST
resolves every request through `anon` before the JWT is applied, so revoking it replaces
every refusal with a 404 and breaks sign-in. An entry without a reason is a **review**
failure, not a build failure: a test that demanded prose would only produce prose. What the
build does check is that no allowlist entry has gone stale, because a licence nobody is
using teaches the next reader to treat the whole list as approximate.

**B3, both mutations:**

| mutation | result |
| --- | --- |
| `grant update on sequence public.audit_log_id_seq to anon` | **B1 fails**: `expected [ 'sequence\|audit_log_id_seq\|UPDATE' ] to deeply equal []` |
| the `fn` union removed from the derivation | **2 fail**: the function positive control *and* the coverage control — `expected [ 'schema', 'sequence', 'table' ] to include 'function'` |

The older guards are left in place. Deleting a working control to celebrate a broader one
is how the broader one ends up being the only thing standing when it has a gap of its own —
which this one already demonstrated it can have.

---

#### C — the first client to receive a real response

**How it was exercised, since an empty divergence list from a mocked round trip would not
be a test.** `services/api/tests/sync-pull-contract.spec.ts` calls `sync_pull` with a real
signed JWT, over HTTP, through **Kong and PostgREST** — the faithful path, not the direct
Postgres connection the rest of the api suite uses, because PostgREST is exactly the layer
where a shape divergence hides. It parses the result with the contract's own
`SyncPullResponseSchema`, runs each payload through the row mappers, and pins the payload
key sets. **The fixtures in `apps/field/src/sync/pull.test.ts` are the rows that round trip
returned**, copied verbatim, and the key-set assertion is what stops them going stale in a
workspace that has no database.

#### C4 — every divergence, with its verdict

| # | divergence | verdict | disposition |
| --- | --- | --- | --- |
| 1 | **Every payload key is `snake_case`.** `mr_id`, `full_name`, `plan_date` — the contract is camelCase throughout | **Both right, about different things.** The contract describes the app; `to_jsonb(row)` describes the table | Mapper. `fromVisitRow` already existed from FIX-07; `fromDoctorRow` and `fromBeatPlanRow` added. **No migration changed** |
| 2 | **`DoctorSchema` requires `clinicAddresses`**, which is not a column and cannot be in a payload | **Contract right about a doctor screen; pull right that it carries rows** | `DoctorRecordSchema = DoctorSchema.omit({ clinicAddresses })`. A consumer needing the aggregate reads the children separately. Joining them in would cross a second table's RLS and change what the payload means |
| 3 | **`BeatPlanSchema` requires `entries`**, likewise | Same | `BeatPlanRecordSchema`. Also avoids re-sending a whole entry list on every beat-plan change |
| 4 | **`organisation_id` arrives and the contract never declared it** | **Database right** — it is a real column | Parsed and dropped by the mapper. The general problem is registered as **BE-W71**: `to_jsonb(row)` is an implicit `select *`, so **any column added to a synced table reaches every handset the day it is created**, without anyone deciding it should |
| 5 | `serverTime` and every timestamp arrive as `+00:00` with **microsecond** precision — `2026-09-07T20:02:29.754702+00:00` | **Both right.** `IsoDateTimeSchema` accepts it | None. Asserted rather than assumed, because a client that formats by string slicing would break on six fractional digits |
| 6 | The **cursor survives a PostgREST round trip** — it is JSON-in-a-string containing colons, braces and quotes | **Both right** | None, and asserted: the second call sends the first call's `nextCursor` and gets `omits: []` back |
| 7 | A refusal arrives as **`{"code":"45005", …}` with a 4xx**, not a generic 500 | **Both right** | None, and asserted — the client's whole error path depends on `code` surviving PostgREST |

**Not an empty list, and not a long one either.** The two that matter are #2 and #3:
**the contract's entity schemas cannot be satisfied by a pull payload at all**, and no
amount of casing work would have revealed that. `sync-pull-contract.spec.ts` asserts the
*failure* — `DoctorSchema.safeParse(fromDoctorRow(payload)).success === false` — so that if
somebody later makes the pull join the children in, the test fails and they have to say why.

**Nothing was changed in a migration to match the contract.** Items 2 and 3 were resolved by
naming the row shapes, which is the pattern `VisitRowSchema` established in FIX-07.

#### C1/C2 — the consumer, and the notice

`apps/field/src/sync/pull.ts` and `pull-cursor.ts`, against the real Supabase RPC.

**The cursor** is stored as an opaque string, **keyed per user**. A shared handset that
switched MRs and kept the cursor would hand the second MR a sweep starting from the first
MR's position, and every row between the two would never arrive — the silent-loss failure
the whole snapshot design exists to prevent, reintroduced on the client side. Losing the
cursor is safe and expensive, not unsafe: it means a full re-sync.

**C2, and the silence is the feature.** `noticeFor` returns `null` when
`completeness.omits` is empty, and a notice only when the server actually declares an
omission — which today means a full re-sync:

> **Your list has been rebuilt.** This was a full refresh, so anything that was removed
> since you last synced has simply gone rather than being marked as removed. Everything
> below is what the server has for you right now.

No SQLSTATE, no field name, no "omits" — asserted, because a notice written in the
server's vocabulary is not a notice. And a notice that appeared on every pull would train
people to dismiss it, and then it would not be there on the pull where it mattered.

#### C3 — "no longer yours", never "deleted"

`removalWording('out_of_scope')` cannot contain the word, and the test asserts the absence
rather than the presence. The `reason` survives mapping, so a screen switches on it instead
of inferring it. Both reasons remove the row from the local store — a record that is no
longer yours must not stay on the handset any more than a deleted one, which is the privacy
half of ADR §6 Q2.

#### C5 — `45006` has a client path

A too-old cursor is not a failure to show anybody. `pullOnce` reads the refusal through the
FIX-06 error contract, and on `sync_cursor_expired` **or** `sync_cursor_unrecognised` clears
the stored cursor and re-pulls from scratch, returning `resynced: true`. The full re-sync
then declares its omission, so the user is told what happened in the same breath.

Surfacing it would have been the shift-window defect in a new place: a specific, actionable
server answer rendered as "something went wrong". A refusal that is **not** about the cursor
— `42501`, say — is surfaced and **not** retried, and that is asserted too: retrying an
honest refusal turns one answer into two requests and the same answer.

#### C6 — results

| what | result |
| --- | --- |
| the cursor persists and is sent on the next pull | yes — asserted on the second RPC call's arguments |
| cursors are kept apart per user | yes — a second user's first pull sends `null` |
| a tombstone removes the local row | yes |
| an `out_of_scope` event removes it, with different wording | yes |
| the word "deleted" never appears for `out_of_scope` | asserted as an absence |
| a too-old cursor triggers a full re-sync | yes, `resynced: true`, two RPC calls |
| an unrecognised cursor recovers the same way | yes |
| a non-cursor refusal is surfaced, not retried | yes, one call |
| the completeness field speaks on a full re-sync | yes, in words |
| ...and is silent when it omits nothing | yes |
| the response is parsed, not cast | asserted — a malformed body rejects |
| `organisation_id` does not reach the app | asserted |
| an upsert with no payload throws rather than inventing a record | asserted |

#### apps/field — real versus fixture, updated

| path | goes to | status |
| --- | --- | --- |
| `record_check_in` / `record_check_out` | Supabase RPC | **real** |
| create visit / update visit | Supabase table + RLS | **real** |
| mileage (`daily_mileage`) | Supabase RPC | **real** |
| **`sync_pull` — pull consumer** | **Supabase RPC** | **real, and the first path whose RESPONSE has been exercised end to end** |
| `sync_push` outbox | Supabase RPC | real (BE-W5) |
| consent | `services/mock` | fixture — server side ready since FIX-12, client conversion is its own review |
| samples | `services/mock` | fixture — blocked on the UCPMP cap value |
| doctors, beat plans, visit *lists*, analyses | `services/mock` | fixtures |

**No screen consumes the pull yet.** `pull.ts` is a state machine and a mapper; wiring it
into `today/` is the next increment and was out of scope here. So the *response shape* is
now exercised, and the *rendering* of it is not.

#### On the prediction

The record said the next defect would be in unexercised code that looks exercised, and
named every response shape in the contract as the place. **It was right, and less
dramatically than expected:** two of the contract's entity schemas cannot be satisfied by
the payload that carries them, which nobody would have found by reading either side. The
casing divergence was already half-solved by FIX-07's mapper, which is what happens when a
previous session did the same exercise on a different path.

The seventh instance of the Supabase-default-privileges root cause was found the same way —
by writing a query that looks at everything rather than at the object classes somebody
remembered.

#### What FIX-14 did not do

- **The consent client path was not converted.** One client conversion, one review.
- **No screen was wired to the pull.**
- **`pg_cron` was not added**, and BE-W69 is declined rather than deferred.
- The console was not wired, no card was removed, samples were not converted, and the
  samples screen's message was not removed.

---

---

### MR-01 — offline-first writes, client surfaces, and G-RLS-C (8 September 2026)

**STOPPED AFTER PART A.** Parts B–H were not started. The reasons are in *Where this
stopped* at the end of this section, and the first of them is that **Part A's answer changes
what Part B is.**

**Not done, and stated first: no screen was converted, the console was not wired, no card
was removed, consent and samples were not converted, the samples screen's message was not
removed, and no dependency was added.**

#### A1 — CI and counts, split by workspace and runner

FIX-14's two commits pushed as `7446bdc..1aee73e`. **That run, `34189551176`, FAILED** —
`prettier --check .` on `apps/field/src/sync/pull.test.ts`. My error: FIX-14 formatted
`pull.ts` and `pull-cursor.ts` and not the test beside them, the api job passed, and the
failure was in the workspace I was not watching. Fixed in `49917e2`.

| workspace | runner | count |
| --- | --- | ---: |
| `@fieldforce/api` | vitest, live database | **495 passed / 22 files** |
| `@fieldforce/field` | vitest, logic | **359 passed / 25 files** |
| `@fieldforce/field` | jest, jest-expo render | **72 passed / 12 suites** |
| `@fieldforce/ui-tokens` | vitest | 54 passed / 3 |
| `@fieldforce/mock` | vitest | 40 passed / 1 |
| `@fieldforce/core` | vitest | 21 passed / 3 |
| `@fieldforce/ui` | vitest | 4 passed / 1 |

**api +5** (audit atomicity), **field +4** (the offline branch). No skips — every summary
line reads `N passed (N)`. `verify:rollbacks`: schema empty, **33 migrations, 33 rollback
files**. `turbo run typecheck lint`: 16 successful, 16 total. `format:check` clean apart
from the gitignored `apps/console/next-env.d.ts`.

---

#### A2 — **NEITHER.**

The question offered two answers, outbox or direct. The true answer is a third one, and it
is worse than either:

> **The converted writes go through the OUTBOX — to the MOCK. The Supabase modules FIX-06
> and FIX-07 built are called by nothing but their own tests.**

**The call path, every hop:**

| # | where | what |
| --- | --- | --- |
| 1 | `apps/field/app/visit/[id].tsx:219-221` | `sendOrQueue(() => stage === 'before' ? client.createCheckIn(body) : client.createCheckOut(body), checkInQueueItem(body))` |
| 2 | `apps/field/src/api.ts:30` | `client` is `createClientForScenario()` → `createApiClient({ baseUrl: apiBaseUrl, … })` |
| 3 | `apps/field/src/config.ts:39` | `apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4010'` |
| 4 | `apps/field/.env:19` | `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4010` — **`services/mock`** |
| 5 | `apps/field/src/sync/outbox.ts:154-173` | `sendOrQueue`: a transport failure enqueues; an `ApiRequestError` is treated as answered and dropped |

**And the other side.** `grep` for every reference to the Supabase write modules across
`apps/field`:

```
apps/field/src/capture/check-in.ts:58   export const recordCheckIn   <- defined
apps/field/src/capture/check-in.test.ts <- the ONLY caller
apps/field/src/capture/visits.ts        createVisit / updateVisit / listMileage
apps/field/src/capture/visits.test.ts   <- the ONLY caller
```

**No screen imports either module.** `createVisit` and `updateVisit` are not called from a
screen at all — not even through the mock: `visit/[id].tsx` and `day-end.tsx` only *read*
visits (`client.listVisits()`), and `mileage.tsx` only reads (`client.listMileage`).

**Every write from a screen, exhaustively — there are three:**

| screen | line | through | to |
| --- | --- | --- | --- |
| `app/visit/[id].tsx` | 219 | `sendOrQueue` | mock |
| `app/consent/[visitId].tsx` | 160 | `sendOrQueue` | mock |
| `app/samples/[visitId].tsx` | 135 | `sendOrQueue` | mock |

**A correction to my own record.** FIX-14's real-versus-fixture table listed check-in,
visit and mileage as **"real"**. That was true of the modules and **false at the screen**,
and the table did not make the distinction. The modules are real, tested and orphaned. Any
reader of that table would conclude the app writes to Supabase, and it does not.

**This is the ninth appearance of the characteristic defect**, and the largest: two full
sessions of conversion work that is correct, tested, and reaches no user.

**What it means for Part B.** The premise — *"if those writes go direct rather than through
the outbox, the app works online and fails offline"* — does not hold. There is no
offline-first regression to repair: the outbox property is intact on the path screens
actually use. Part B is therefore not a repair. It is **the conversion itself**, and it is
the same conversion as Parts D and E, on three write paths rather than one. That is a
different and larger piece of work than the prompt scoped, and saying so before starting it
is the point of asking A2 first.

#### A3 — an unreachable server **QUEUES**

Empirical, not read: `apps/field/src/sync/offline-write.test.ts` drives the **real**
`ApiClient` over the **real** `fetch` at `http://127.0.0.1:49517`, where nothing listens —
which is what a handset with no signal produces at this layer.

**Result: `{ kind: 'queued' }`.** The item is on disk with `id` intact (the idempotency key
the server dedupes on), `entityId` the visit, `status: 'queued'`, `syncedAt: null`. Nothing
throws to the screen, nothing claims success, nothing is lost.

**Why that branch was worth running rather than reading.** `sendOrQueue` treats an
`ApiRequestError` as *the server answered, so it has the work* and **deliberately drops the
item** — queueing a refusal would re-send something already refused on every flush, for
ever. Correct for a refusal, catastrophic for a connection error misclassified as one: an
MR in a basement clinic would see a message and lose the visit. Which way a dead socket
classifies is not visible in either file, and had never been exercised.

With a positive control, because two assertions about queueing would also pass against a
`sendOrQueue` that queues unconditionally — which would look identical offline and lose
every refusal.

**What it does not prove, stated in the file so nobody reads more into it:** no screen, no
Android, no radio. **B4's device proof is still owed.** This proves the branch that decides
whether that device proof can possibly pass.

#### A4 — an **OUTAGE**, not an audit bypass

`write_audit_row()` is an `AFTER … FOR EACH ROW` trigger performing a plain `insert` in the
caller's transaction, **not deferrable**, with **no exception handler**. All three
properties asserted from `pg_trigger` rather than read.

**The proof.** A `BEFORE INSERT` trigger on `audit_log` raising `58030` — the narrowest
sabotage available, failing exactly the insert the audit performs and leaving every other
path alone. Then `update public.doctors set specialty = 'Sabotage'`:

```
rejects.toMatchObject({ code: '58030' })      <- the write is refused
select specialty from public.doctors …        <- 'Urology', not 'Sabotage'
```

The business row does not survive. **A failed audit stops the work; it does not let the
work through unrecorded.** With a positive control: unbroken, the same update succeeds
*and* the `audit_log` count for that row increases — without which the test above would
pass against a schema where the update was refused for some unrelated reason and no audit
row was ever attempted.

**A sub-finding, at its own severity.** The first version of that test asserted *"no
exception handler anywhere on the audit path"* and **failed, correctly**.
`current_request_id()` and `current_client_ip()` both catch `when others`. Both read the
PostgREST header bag to populate a **column**, and both run *before* the insert rather than
around it, so a malformed header bag degrades `request_id` to null and `ip_address` to the
connection address **and the row is still written**.

That is a **metadata degradation, not a bypass** — a deliberate trade, commented in the
function as *"a malformed header bag must not break an audited read"*. The assertion is now
the precise one, and the trade is asserted to stay bounded: neither helper can touch
`actor_id`, `action`, `table_name` or `row_id`, so no swallow can produce an audit row that
misidentifies who did what to which record.

---

#### Where this stopped, and why

**Stopped after Part A.** Parts B, C, D, E, F, G and H were not started.

**1. Part B cannot be completed in any session on this machine.** B4 is the proof the part
is built around — *"disable connectivity, perform a check-in, a visit update and a mileage
entry, restart the app, restore connectivity, and show all three arriving exactly once"*.
That is a physical-handset procedure. **No physical device has ever run this app**, and
buying one is the first item on the human list, dated *today*. A3 does as much of it as a
workstation can and says so; the rest is not compressible, only fakeable.

**2. Part A changed what Part B is.** It is a conversion of three write paths, not a repair
of a regression, and it is the same conversion as Parts D and E. Starting it under the old
framing would have produced work scoped to the wrong problem.

**3. The remaining parts are each a session.** C is four screens; D and E are client
conversions with their own refusal matrices; F is three drift items including a schema
change; G is a full four-role, five-path isolation matrix at 100-MR volume, which is the
gate the commercial compliance story rests on and has never been run whole; H is a restore
drill against a scratch target plus a documentation restructure. Compressing any of them to
fit is the thing the stop rule exists to prevent.

**What the next session should do first**, in the order the dependencies actually run:

1. **Decide Part B's real scope** now that A2 has answered it: converting check-in, consent
   and samples from the mock to Supabase *through the existing outbox*, which is B, D and E
   as one piece of work rather than three.
2. **Part G** is independent of all of that and is the highest-value item that needs no
   device — the isolation matrix can be run today against the synthetic seed.
3. **Part B4 and everything device-shaped** waits on the handset.

**One thing to carry forward.** The orphaned modules are not wasted: `recordCheckIn`,
`createVisit` and `listMileage` are tested against a real database and are what the
conversion will wire in. What is missing is only the last hop, and the lesson is the one
this record already states — *check that anything you build is actually called by
something* — now with a ninth instance and the largest one yet.

---

---

### MR-02 — screens talk to the real server (8 September 2026)

**STOPPED AFTER PART A.** Parts B–F were not started, and the reason is the same shape as
last session's: **Part A found that Part B's scope list is wrong in two directions.**
Details in *Where this stopped*.

**Not done: no screen was converted, the console was not wired, no card was removed, the
samples screen's message was not removed, and no dependency was added.**

#### A1 — CI and counts

The MR-01 record commit pushed as `a8d623c..5a358eb`. Run **`34192264457`: success**, both
jobs.

| workspace | runner | count |
| --- | --- | ---: |
| `@fieldforce/api` | vitest, live database | **500 passed / 23 files** |
| `@fieldforce/field` | vitest, logic | 359 passed / 25 files |
| `@fieldforce/field` | jest, jest-expo render | 72 passed / 12 suites |
| `@fieldforce/ui-tokens` | vitest | 54 passed / 3 |
| `@fieldforce/mock` | vitest | 40 passed / 1 |
| `@fieldforce/core` | vitest | 21 passed / 3 |
| `@fieldforce/ui` | vitest | 4 passed / 1 |

**api +5** (audit metadata). No skips. `verify:rollbacks`: schema empty, 33/33.
`turbo run typecheck lint`: 16 successful, 16 total.

---

#### A2 — and first, a correction to MR-01's own A2

**MR-01 said "exactly three writes from screens". That was wrong. There are six**, and my
grep missed three of them because it searched for `sendOrQueue` call sites rather than for
mutating calls. Searching for the mutations directly:

```
$ grep -rnoE "\.(create|update|delete)[A-Za-z]+\(" apps/field/app --include=*.tsx
app/visit/[id].tsx       :220  .createCheckIn(  /  .createCheckOut(
app/visit/[id].tsx       :171  .createRecording(
app/consent/[visitId].tsx:161  .createConsentRecord(
app/samples/[visitId].tsx:136  .createSampleAndInput(
app/report/[visitId].tsx :57   .createCallReport(
app/voice-note/[visitId].tsx:124 .createVoiceNote(
```

| write | through the outbox? |
| --- | --- |
| check-in / check-out | **yes** — `sendOrQueue`, `visit/[id].tsx:219` |
| consent | **yes** — `consent/[visitId].tsx:160` |
| samples | **yes** — `samples/[visitId].tsx:135` |
| **call report** | **NO** — a bare `createClientForScenario().createCallReport(...)` |
| **recording** | **NO** |
| **voice note** | **NO** |

**So "offline-first is intact" is not true as stated.** It holds on three paths and fails on
three. The call-report screen's own catch block says the quiet part: *"Your words are still
on this screen — try again when you have signal."* The MR is asked to retype a visit summary
because the app did not keep it. Recording and voice note are audio and out of scope for this
batch by §1 — the finding is registered regardless, because it is the same defect.

**Where visits come from.** No screen creates or updates one. Every screen reference is
`client.listVisits()` — twelve of them, all reads. The server side is more interesting:

- **`sync_push` already inserts visits** — `20260813000200_offline_sync.sql:181` — and
  `apply_sync_item` accepts `visit`, `check_in`, `check_out`, `call_report`,
  `consent_record`, `sample_and_input`, `recording`. **Seven entities, one RPC, through the
  outbox by design.**
- **Nothing anywhere updates `visits.status`.** `grep "update public.visits"` across all 33
  migrations returns nothing, and `record_check_in` does not touch it. The lifecycle
  `planned → in_progress → completed` is never advanced by the system; the fixtures set it
  directly.

**The verdict, both halves:**

| question | verdict |
| --- | --- |
| **Call reporting** | **WIRING gap.** The screen exists — 105 lines, summary, objections, next step, a send button, a real `createCallReport`. An MR *can* record what happened on a visit. It needs converting and queueing, not building |
| **Unplanned visit creation** | **FUNCTIONAL gap.** `VisitSchema` says `beatPlanId` is *"null for an unplanned visit — unplanned visits are legitimate"*, `sync_push` accepts a `visit` entity, and `createVisit` exists in `packages/core` and in `capture/visits.ts`. **There is no affordance anywhere in the app to create one**, and no `visitQueueItem` in the outbox. An MR who sees a doctor not on today's beat plan cannot record the visit at all |
| **Visit status transitions** | **FUNCTIONAL gap, server-side.** Nothing advances `visits.status`, so a completed visit is only "completed" if something set it that way outside the app |

**And a defect found on the way.** `flushOutbox` stamps an accepted item with
`receivedAt: nowIso()` (`outbox.ts:220`), where `nowIso()` is `new Date().toISOString()` —
**the device clock** — and the comment beside it says *"this is the server's clock by
definition"*. `reducer.ts:86` then writes that into `syncedAt`, and `sync/events.ts:23`
documents `receivedAt` as *"the server's clock… the only timestamp allowed to mark an"*
item as landed. `QueueScreen.tsx:275` renders the string **"Server recorded this at …"**.

That is exactly what B7 forbids: a client clock rendered as though the server knew. It is
**reachable today on the accepted path**; the rendered string is on the rejection branch,
which is currently **unreachable** because `flushOutbox` is the only dispatcher of
`verdict_received` and always sends `rejectionCode: null`. A tenth instance of the
characteristic defect, this one in the UI.

#### A3 — the anti-forensics question: **spoofing, not nulling**

Over real HTTP through Kong and PostgREST, because the header bag only exists on that path;
the same test on the direct-Postgres connection would answer a different question and answer
it reassuringly.

| probe | result |
| --- | --- |
| no special headers | `actor_id` correct, `ip_address` non-null — the positive control |
| `x-forwarded-for: not-an-ip-address-at-all` | **address NOT blanked.** The failed `::inet` cast is caught and `inet_client_addr()` is used, which is *stronger* evidence than the header |
| **`x-forwarded-for: 203.0.113.9`** | **recorded verbatim as `203.0.113.9`** |
| **`x-request-id: forged-…`** | **recorded verbatim** |
| both spoofed at once | `actor_id`, `action`, `table_name` all still correct |

**So the question as posed has a reassuring answer and the real vector is the other one.** A
caller cannot *null* their metadata; they can *choose* it. `current_client_ip()` takes
`split_part(…, ',', 1)` — the **first** entry, which is the one the client supplies, because
a proxy appends rather than prepends.

**Severity: low, and bounded — which is what makes it a task rather than an alarm.**
`actor_id` comes from `auth.uid()` off the verified JWT, `action` from `tg_op`,
`table_name` from `tg_table_name`. No header reaches any of them. **WHO and WHAT are sound;
WHERE FROM and WHICH SESSION are caller assertions recorded as if they were observations.**
For a product whose audit log is a compliance artefact, that distinction should be visible in
the schema rather than only in a test. Registered as **BE-W72**, not fixed.

#### A4 — `format:check` already covers every workspace. The gap was mine.

```
$ prettier --check .          # from the repo root, not per-workspace, not via turbo
apps/field      111 ts/tsx files, 0 different
apps/console     21               1 different   <- next-env.d.ts, gitignored
packages/core    44               0
packages/ui      67               0
packages/ui-tokens 14             0
services/api     28               0
services/mock     8               0
```

All seven workspaces, 293 TypeScript files, one root invocation. **The tool would have
caught FIX-14's failure. I did not run it.** In FIX-14 I ran
`npx prettier --check PROJECT-OVERVIEW.md docs/COMPLETION-PLAN.md docs/adr-sync-pull.md` —
three files — and then reported *"format clean apart from the known gitignored artefact"*, a
repo-wide claim from a three-file check.

So there is no coverage gap to close and no guard to add. The correction is to the habit: a
repo-wide claim needs the repo-wide command, and `format:check` is a root script rather than
a turbo task, which makes a narrower prettier invocation easy to run and easy to mistake for
it.

---

#### Where this stopped, and what it changes

**Stopped after Part A.** Parts B, C, D, E and F were not started.

**Part B's scope list is wrong in two directions, and that is the finding.**

*It names one path that does not exist:*
**mileage.** There is no mileage write anywhere in the app. `mileage.tsx:41` calls
`client.listMileage(...)` and `day-end.tsx:68` reads it too. Mileage is derived server-side
by `daily_mileage()` from check-in coordinates. There is nothing to convert.

*It omits three that do exist and are worse off than the ones it names:*
**call report, recording and voice note** write directly, with no outbox at all. Converting
the three queued paths while leaving three unqueued ones would produce an app that is
offline-first on the writes somebody happened to list.

**And A2 changes B2's answer before B2 is attempted.** B2 asks for *"one conversion pattern,
not five"*. There already is one: **`sync_push`**. It accepts all seven entities, it is the
outbox's natural partner, `SyncEntitySchema` already enumerates exactly those entities, and
`packages/core/src/field/client.ts:454` already exposes `syncPush`. The current
`flushOutbox` does **not** use it — it sends items one at a time through `sendFor(client,
item)` as individual REST calls. So the conversion is plausibly *"point `flushOutbox` at
`sync_push`"* rather than five per-entity adapters, which is a materially different and
smaller piece of work than the prompt scopes — and it needs its own review before being
built, not a decision taken mid-flight.

**Part C is also affected.** C5 asks for a two-column module-versus-screen table. Building
that table honestly requires the A2 inventory above, which now includes three unqueued
writes the previous table did not mention at all.

**What the next session should do, in order:**

1. **Decide the conversion target** — `sync_push` for all entities, or per-entity RPCs. A2
   makes the case for the first; it is a design decision, not an implementation detail.
2. **Convert all six screen writes**, not five, and not the five named.
3. **Part E (G-RLS-C)** is independent of every one of these, needs no device, and has never
   been run whole. It is the highest-value item that nothing above blocks.
4. **`visits.status` and unplanned visits** are a functional gap and a separate review, per
   B1's own stop condition.

**One correction to carry:** MR-01's A2 answer was incomplete, and I reported it as
exhaustive. The list of screen writes is six, not three, and the three I missed are the
three that are not offline-safe.

---

---

### MR-03 — six writes, one path (8 September 2026)

**STOPPED AFTER PART A, and this time with a recommendation NOT to proceed as written.**
Part A found that routing the six writes through `sync_push` today would **remove consent
validation from the consent path**. Doing Part B as specified would make the compliance
posture worse than the mock it replaces. Details in A2.

**Not done: no screen was converted, no write path was changed, the console was not wired,
no card was removed, the samples screen's message was not removed, and no dependency was
added.**

#### A1 — CI and counts

MR-02's two record commits pushed as `5a358eb..e6195b3`. Run **`34197164480`: success**,
both jobs.

| workspace | runner | count |
| --- | --- | ---: |
| `@fieldforce/api` | vitest, live database | **508 passed / 24 files** |
| `@fieldforce/field` | vitest, logic | 359 passed / 25 files |
| `@fieldforce/field` | jest, jest-expo render | 72 passed / 12 suites |
| `@fieldforce/ui-tokens` | vitest | 54 passed / 3 |
| `@fieldforce/mock` | vitest | 40 passed / 1 |
| `@fieldforce/core` | vitest | 21 passed / 3 |
| `@fieldforce/ui` | vitest | 4 passed / 1 |

**api +8** (sync_push enforcement). No skips. `verify:rollbacks`: schema empty, 33/33.
`turbo run typecheck lint`: 16 successful, 16 total.

---

#### A2 — the conversion target: **`sync_push`, but not until two things are fixed**

**Does it return per-item verdicts? Yes.** Each item gets
`{id, status, rejectionCode, rejectionDetail, warnings}`, `status ∈ {accepted, rejected,
duplicate, dead_lettered}`, and **a batch does not collapse** — asserted: one item fails
beside one that succeeds. That is the right shape, and it is why `sync_push` is still the
right target.

**Does the verdict carry the SQLSTATE? No.** `rejectionCode` is a
`public.sync_rejection_code` enum with ten members:

```
outside_shift_window, outside_geofence, not_your_record, missing_reference,
validation_failed, unsupported_entity, malformed_item, internal_error,
consent_withdrawn, upload_expired
```

and the `case` that produces it maps `42501`, `0A000`, `23503`, `23502`, `23514`, `23505`,
`22023`, `22P02` — **and no `450xx` code at all.** So:

| refusal | what an MR would be told through `sync_push` |
| --- | --- |
| `45001` the notice changed — re-read and ask again | `internal_error` |
| `45004` UCPMP cap, with month-to-date | `internal_error` |
| `45007` your device clock is wrong | `internal_error` |
| `45008` sync sooner | `internal_error` |

`outside_shift_window` survives only by `ILIKE '%shift window%'` on the message text —
matched on the string that `45002` and `45003` were minted in FIX-06 to replace.

**And then the finding that decides the session.** `apply_sync_item` does not route every
entity through its RPC. From the live function body, not the migration:

| entity | what `apply_sync_item` does | enforcement on the offline path |
| --- | --- | --- |
| `visit` | direct INSERT | RLS only |
| `check_in` | `perform record_check_in(…)` | **full** — geofence, shift window, server clock |
| `check_out` | `perform record_check_out(…)` | **full** |
| `call_report` | `revise_call_report(…)` or direct INSERT | partial |
| **`consent_record`** | **direct INSERT** | **none — `capture_consent` is not called** |
| `sample_and_input` | direct INSERT | the UCPMP trigger still fires; it is a table trigger |
| `recording` | `perform complete_upload(…)` | **full** |

**So every bound FIX-12 built is absent on the offline path** — the version active *at*
`captured_at` (45001), no future capture (45007), the maximum sync lag (45008). The one path
where `captured_at` and `received_at` differ at all is the one path that validates neither.

**Proved rather than read, in one fixture, both directions:**

```
capture_consent, notice superseded before the capture  ->  rejects, code 45001
sync_push,       the identical capture                 ->  status "accepted"
                 and consent_records stores the SUPERSEDED version as displayed
sync_push,       captured_at one day in the FUTURE     ->  status "accepted"
```

**Recommendation: `sync_push`, after two additive fixes, and not before.**

1. **Route `consent_record` through `capture_consent`**, as `check_in` already routes through
   `record_check_in`. This is the fix that must land first: **converting the consent screen to
   `sync_push` today would strip validation the mock path does not have either — but the
   server-side enforcement exists and would simply stop being reached.**
2. **Carry the raw SQLSTATE in the per-item verdict**, beside `rejectionCode` rather than
   instead of it. Additive, so no enum change and no `alter type … add value` inside a
   migration transaction; `sync_rejection_code` stays the coarse category, and the client
   already has a complete SQLSTATE→refusal map that `error-contract.spec.ts` guards in both
   directions. Extending the enum instead would mean re-deriving in two places what the error
   contract already derives in one.

Why still `sync_push` rather than six adapters: one code path instead of six; the three
unqueued writes become queued **by construction** rather than by being individually
remembered; batching; and the per-item verdict shape is already right. The two fixes are
smaller than the six adapters and they fix a live defect rather than routing around it.

#### A3 — the done counter reads a field nothing writes

`apps/field/src/today/plan.ts:89`:

```ts
done: counted.filter((visit) => visit.status === 'completed').length,
```

with the comment on line 38 reading *"Visits the server has marked completed."* **The server
has never marked one.** `visits.status` defaults to `'planned'`, is `NOT NULL`, and
`grep "update public.visits"` across all 33 migrations returns nothing.

**What the screen has actually been displaying:** the number of visits the **mock fixture**
hard-codes as `'completed'` — `services/mock/src/fixtures.ts` contains three. Against
Supabase the counter reads **0, permanently**, because every visit inserted by `sync_push` or
anything else keeps the default.

**This blocks Part C directly.** The moment Today reads from the pull instead of the mock,
the done counter goes to zero and stays there. It is a third piece of code that looks
exercised and is not — this one visible on the screen an MR uses most.

**Recommendation: write the status, do not remove the column.** The counter reads it, §5's
Tier 1 missed-visit nudge needs it, and coverage-versus-beat-plan is a manager feature built
on it. Deriving "done" from check-outs instead would substitute a different fact — a
check-out is a departure, a completed visit is a business state — and would leave
`VisitStatusSchema`'s four states with no producer at all. The natural place is
`record_check_in` → `'in_progress'` and `record_check_out` → `'completed'`: both already
exist, both are the enforced RPCs, and `apply_sync_item` already routes through them, so the
offline path would get it for free. **Registered as BE-W73, not built** — the prompt says
establish which it is, not build it.

#### What "recording" and "voice note" actually write

Audio capture is built — `expo-audio` is wired into both screens and produces a real
recording — but **no audio bytes ever leave the device.** `createRecording` and
`createVoiceNote` post **metadata rows only**: duration, bitrate, a consent reference and a
`sizeBytes` the screen cannot measure. The comment in `visit/[id].tsx` says so plainly —
*"Real bytes arrive with the upload, which is BE-W7 and has no client here"* — and passes
`sizeBytes: 1` because the contract needs a positive integer.

So "recording writes exist" must not be read as "recording exists". The row is an intent to
upload; the upload path (`complete_upload`, the resumable grant machinery, BE-W7) has no
client. Recorded here because two of the three unqueued writes are these, and their severity
depends on knowing that what is being lost offline is a metadata row rather than a
consultation.

---

#### Where this stopped, and why it is a recommendation rather than a pause

**Stopped after Part A.** Parts B, C, D and E were not started, except E2 and E3 which
follow directly from A and are done.

**Part B should not be executed as written.** B1 routes all six writes through the target A2
chose. If that target is `sync_push` — and it should be — then doing it today moves the
consent write onto a path that **does not call `capture_consent`**, and the FIX-12 bounds
stop being reached. The mock path does not enforce them either, so nothing regresses on the
day; what regresses is the plan, because the server-side enforcement would exist, be tested,
and be bypassed. That is the shape this project has now found eleven times, and it would be
the first one introduced deliberately.

**Order for the next session:**

1. **Route `consent_record` through `capture_consent` in `apply_sync_item`**, and carry the
   SQLSTATE in the per-item verdict. Both are server-side, both are small, and both are
   prerequisites rather than improvements.
2. **Then** Part B's conversion, all six writes, with B5's device-clock fix in the same
   session because Part B is what makes that branch reachable.
3. **Part D (G-RLS-C)** is independent of all of the above, needs no device, and has never
   been run whole. If the next session has room for only one thing, this is the one nothing
   blocks.
4. `visits.status` (BE-W73) before Part C, or Part C ships a counter that reads zero.

**Two corrections carried into this record**, per E1, are in the section below.

---

### E1 — two corrections, dated 8 September 2026

Both replace claims that appear in earlier sections of this file and in the reviewer's state
tables. **The earlier sections are left exactly as written**, per the section-freezing rule;
this is what supersedes them.

**Correction 1 — "offline-first is intact" is false.** It appears in MR-02's state table as a
*corrected* fact, written one session after correcting a different fact.

The truth: **three of six screen write paths queue; three do not.** Check-in/check-out,
consent and samples go through `sendOrQueue`. Call report, recording and voice note are bare
`createClientForScenario().create…()` calls with no outbox, no queue and no retry. The
call-report screen's own error copy is the evidence — *"Your words are still on this screen —
try again when you have signal"* — which asks an MR to retype a visit summary the app
declined to keep.

**How the wrong claim was reached**, because the method is the reusable part: MR-01 searched
`grep -rn "sendOrQueue"` to find which writes go through the outbox. A search for a mechanism
returns users of the mechanism and never bypassers. Written up in `docs/gotchas.md` beside
the FIX-10 index test, which is the same mistake with a different tool.

**Correction 2 — G-WRITE was UNMET, not "part met", from FIX-07 until now.** From FIX-07
onward this record and the reviewer's state tables described check-in, visits and mileage as
**"real"**. They were real **in the module** and **mock-bound at the screen**:
`recordCheckIn`, `createVisit`, `updateVisit` and `listMileage` are referenced by their own
test files and by nothing else, and `createVisit`/`updateVisit` are not called from a screen
at all — not even through the mock.

**No write from a screen has ever reached Supabase.** The gate stands where it stood in July.
FIX-14's real-versus-fixture table is the specific artefact that hid it, because it had one
column where it needed two: a module that talks to Supabase while the screen talks to the
mock reads as "real" in a one-column table. Any future version of that table carries **module**
and **screen** separately.

**A third claim, corrected here rather than left to be found:** MR-02's Part B listed mileage
as one of five writes to convert. **Mileage has no write anywhere.** `mileage.tsx:41` and
`day-end.tsx:68` both read, and the figures are derived server-side by `daily_mileage()` from
check-in coordinates. There is nothing to convert and nothing should be added.

---

### MR-04 — prerequisites and the conversion (8 September 2026)

**B1 and B2 landed. B3 stopped by its own instruction — a distinction IS needed. Parts C,
D and E were not started.** Where and why is at the end.

**Not done: no screen was converted, no client write path changed, the console was not
wired, no card was removed, the samples screen's message was not removed, and no dependency
was added.**

#### A1 — CI and counts

MR-03's two record commits pushed as `e6195b3..ef2da9b`. Run **`34197164480`: success**,
both jobs.

| workspace | runner | before | after MR-04 |
| --- | --- | ---: | ---: |
| `@fieldforce/api` | vitest, live database | 508 / 24 | **512 passed / 24 files** |
| `@fieldforce/field` | vitest, logic | 359 / 25 | 359 passed / 25 |
| `@fieldforce/field` | jest, jest-expo render | 72 / 12 | 72 passed / 12 |
| `@fieldforce/mock` | vitest | 40 / 1 | 40 passed / 1 |
| `@fieldforce/ui-tokens` | vitest | 54 / 3 | 54 / 3 |
| `@fieldforce/core` | vitest | 21 / 3 | 21 / 3 |
| `@fieldforce/ui` | vitest | 4 / 1 | 4 / 1 |

No skips. `verify:rollbacks`: schema empty, **35 migrations, 35 rollback files**.
`turbo run typecheck lint`: 16 successful, 16 total, `--force`.

---

#### A2 — phantom uploads: **there are none, and there cannot be, for two reasons**

The premise was that the database holds completed audio uploads with no object behind them.
It does not, and the reasons are worth having because both are load-bearing elsewhere.

**Count, on a freshly reset database:**

```
recordings    | 0
upload_grants | 0
voice_notes   | 0
```

**Reason 1: the app has never written to Supabase at all.** G-WRITE is unmet — every screen
write goes to `services/mock` at `:4010`. `createRecording`'s `sizeBytes: 1` lands in the
mock's in-memory fixture store and has never reached Postgres.

**Reason 2, and this is the durable one: `sync_push` would REFUSE the screen's payload.**
`apply_sync_item`'s recording branch opens with

```sql
if nullif(p_payload ->> 'uploadGrantId', '') is null then
  raise exception 'a % item must carry its uploadGrantId', p_entity using errcode = '22023';
```

and `complete_upload` then requires a grant that exists and belongs to the caller (`42501`
otherwise) with `p_size_bytes > 0 and <= v_grant.max_bytes`. **`CreateRecordingRequestSchema`
has no `uploadGrantId` field at all.** So the REST contract for a recording describes a
shape the sync path cannot apply, and the guard already exists.

**Does the purge walk them?** It cannot, because they cannot exist. `claim_expired_audio`
selects from `recordings`, `voice_notes` and `upload_grants` where `purge_state <>
'destroyed'`, returning `storage_key` — and a `recordings` row can only be created by
`complete_upload`, which needs a real grant with a real key.

**The 404-in-body branch is reached by the legitimate case, not a phantom one.** A grant
issued whose bytes were never uploaded becomes an `upload_partial` claim — which is exactly
what `close_stale_upload_sessions()` produces and what `storage.mjs` was rewritten for in
BE-W7 after BE-W6 got it wrong. That branch is reachable by design; it is not fed by
anything the app is doing.

**Severity: none as a defect; one as a scope finding.** Recording and voice note **cannot be
converted to `sync_push` at all** until the upload session has a client (BE-W7 has none).
The payload is missing the one field the server requires, and that field can only come from
an upload grant. Registered as **FE-W29**. This changes Part C: two of the six writes are
not convertible this quarter.

---

#### B1 — BE-W74: consent through `capture_consent`. **Done.**

`apply_sync_item` routed `check_in` → `record_check_in`, `check_out` → `record_check_out`
and `recording` → `complete_upload`, and `consent_record` → a **direct INSERT**. Every
FIX-02 and FIX-12 bound was absent on the offline path — the one path where they exist to
matter, since offline capture is the entire reason FIX-12 validates against `captured_at`
rather than `now()`.

**Both directions, one fixture, before and after:**

| | before | after |
| --- | --- | --- |
| notice superseded before the capture, via `capture_consent` | rejects `45001` | rejects `45001` |
| **the identical capture via `sync_push`** | **"accepted"**, superseded version stored as displayed | **"rejected"**, and **no row written** |
| **`captured_at` one day in the future via `sync_push`** | **"accepted"** | **"rejected"** |
| a valid capture from two hours ago, synced now | — | **accepted**, `captured_at` preserved to the millisecond, `capture_lag` positive |

Two improvements fall out rather than being designed: `doctor_id` now comes from the visit
and `displayed_language` from the version actually active at `captured_at`, so **a client
can no longer assert either**.

**A withdrawal still inserts directly, deliberately.** `capture_consent` takes neither
`supersedes_consent_record_id` nor `is_withdrawal`, and the table's constraints plus
`validate_consent_withdrawal` guard that shape and fire on a direct insert. Growing
`capture_consent` two parameters it has no other use for would make the common path carry
the rare one.

**Two-sided mutation, count unchanged at 9:**

| mutation | result |
| --- | --- |
| the routing removed — **the rollback file is the mutation** | **3 failed / 6** — both refusals and the structural assertion |
| the write removed, scoped to the fixture languages | **1 failed / 8** — exactly the persistence case |

**Two tests were inverted rather than deleted**, and the inversion is recorded in the test
comment: *"This test asserted the opposite until BE-W74, and the inversion is the fix."*

#### B2 — BE-W75: the verdict carries the SQLSTATE, and the `ILIKE` is gone. **Done.**

`sqlState` is added **beside** `rejectionCode`; the ten-member enum is untouched. Three
reasons in order of weight: the client already has a complete SQLSTATE→refusal map that
`error-contract.spec.ts` fails the build over **in both directions**, so extending the enum
would derive the same meaning twice with only one copy guarded; `alter type … add value` has
its own hazards inside a migration transaction; and `sync_rejection_code` is a useful
**coarse category** that stays exactly that.

So `rejectionCode` still reads `internal_error` for a `45001` and **`sqlState` reads
`45001`** — asserted end to end:

```
sync_push -> { status: 'rejected', sqlState: '45001' }
refusalForSqlState('45001') -> { code: 'consent_notice_superseded', actionable: true }
```

with the positive control that an **accepted** item carries `sqlState: null`, so absence
means success — without which the first assertion would pass against a field that is always
populated.

**The `ILIKE '%shift window%'` fallback is deleted**, replaced by
`v_sqlstate in ('45002', '45003')`. It was string-matching the message those two codes were
minted in FIX-06 to replace — minted precisely because `22023` is raised 64 times for
unrelated reasons and message text is not a contract.

**The other two `ILIKE` branches stay, and the reason is now in the code.**
`consent_withdrawn` and `upload_expired` have no SQLSTATE of their own: both are ordinary
`42501` and `22023` conditions that already mean something else here, and each has its own
test, so a reworded message breaks a build rather than degrading an explanation.

**A sharp edge found while writing the fixture, worth carrying.** `capture_consent` compares
`captured_at > now()`, and `now()` is **transaction start** time. A timestamp taken after
the transaction opened is therefore "in the future" and trips `45007` before the notice
check is reached. Harmless in production, where a request is its own short transaction; it
cost one wrong test result here, and the first pass proved `sqlState` works for the wrong
branch. Recorded in the test.

`SyncPushResultSchema` gained the field, and **the mock's conformance test caught the change
immediately**, which is what it is for.

#### B3 — BE-W73: **a distinction IS needed. Stopped, per the instruction.**

The prompt says to decide before implementing, and to stop if a distinction is needed
because changing it after data exists means rewriting history. It is needed.

**What check-out actually records** — every column of `check_outs`:

```
id · visit_id · mr_id · latitude · longitude · accuracy_metres
geofence_status · distance_from_clinic_metres · source · occurred_at · created_at
```

**Position and time. Nothing about whether the call happened.** A check-out is a departure.

**What the screen says.** `TodayScreen.tsx:166-167` renders the figure `2 of 3` under the
label **"visits done"**, and line 144 reads **"That's the day done"**. So "done" means, to
the person holding the phone, *the visit happened*.

**Therefore `check_out → completed` would make the app tell an MR their day went to plan
when a doctor was unavailable** — and would tell coverage-versus-beat-plan, and §5's Tier 1
missed-visit nudge, that a call took place that did not.

**The product already makes this distinction elsewhere.** `consent_outcome` carries
`not_asked` with a **required** reason — `consent_records_not_asked_has_reason` is a check
constraint. "Attended, nothing happened" is a state this product already models; it is just
not modelled on `visits`.

**The question for the product owner, in one line:** *does "2 of 3 visits done" count a
visit where the MR arrived and the doctor was unavailable?* If yes, `check_out → completed`
is right and B3 is ten minutes' work. If no, `visit_status` needs a fourth value, and
**that decision cannot be deferred** — `visit_status` is an enum, adding a member later is
`alter type … add value`, and every row already written as `completed` would be permanently
ambiguous between *met* and *attended*.

Registered against BE-W73. **Nothing was written to `visits.status`**, so no history exists
to rewrite yet.

---

#### Where this stopped

**B1 and B2 landed with migrations, rollbacks, tests, two-sided mutation and contract and
mock updates in step. B3 stopped on its own condition. Parts C, D and E were not started.**

**Part C cannot be done as written**, and A2 is why: **recording and voice note are not
convertible.** `apply_sync_item` requires an `uploadGrantId` that
`CreateRecordingRequestSchema` does not have and that only an upload grant can supply, and
the upload path has no client (BE-W7). So C1's "all six" is four — check-in, check-out,
consent, samples, plus the call report — with two that need the upload client first.

**C8 answers itself given that.** `sizeBytes: 1` should not be made nullable: the write
cannot succeed against the real server anyway, so relaxing the schema would only make a
fabricated row valid. **Do not write the row yet** — which is what FE-W29 says.

**Part D depends on B3.** D1 requires the done counter to move, and nothing writes the
status it reads until the product question above is answered.

**Part E is independent of every one of those**, needs no device, and has never been run
whole. It remains the thing to reach for.

**Order for the next session:**

1. **Part E (G-RLS-C)** — nothing blocks it, and it is the gate the commercial compliance
   story rests on.
2. **The B3 product question**, which is one sentence to a human and ten minutes of work
   after.
3. **Part C for the four convertible writes**, with C5's device-clock fix in the same
   session because C is what makes that branch reachable.
4. **FE-W29 / BE-W7** — the upload client — before recording and voice note can be converted
   at all.

---

---

### MR-05 — G-RLS-C, the clock tolerance, and four writes (8 September 2026)

**Parts A, B and C are done. Part D — the conversion — was not started, and Part E was
not reached.** Where and why is at the end.

**G-RLS-C FAILS on the organisation boundary.** Reported, not fixed, per A5. It is the most
serious finding of the twenty-odd sessions in this record, and it is first below.

#### A1 — CI and counts

MR-04's three commits pushed as `ef2da9b..ff0429b`. Run **`34211758329`: success**, both
jobs.

| workspace | runner | before | after MR-05 |
| --- | --- | ---: | ---: |
| `@fieldforce/api` | vitest, live database | 512 / 24 | **531 passed / 26 files** |
| `@fieldforce/field` | vitest, logic | 359 / 25 | 359 / 25 |
| `@fieldforce/field` | jest, jest-expo render | 72 / 12 | 72 / 12 |
| `@fieldforce/mock` | vitest | 40 / 1 | 40 / 1 |
| `@fieldforce/ui-tokens` · `@fieldforce/core` · `@fieldforce/ui` | vitest | 54 / 21 / 4 | unchanged |

**api +19**: 4 the matrix, 12 the withdrawal bounds, 3 the tolerance. No skips.
`verify:rollbacks`: schema empty, **36 migrations, 36 rollback files**.
`turbo run typecheck lint`: 16 successful, 16 total, `--force`.

---

#### A4 — the full G-RLS-C matrix. **Forty cells, and five of them are a defect.**

Seeded at pilot volume: `seed:synthetic --mrs 100 --history 1y` — 3,520 doctors, 208,800
visits, 105 profiles, a three-level tree — **plus** `seedFixtures()`. The two seeds are two
organisations, which is what made a cross-tenant test possible at all.

```
another ORG      | anon           | postgrest | REFUSAL
another ORG      | anon           | raw sql   | REFUSAL
another ORG      | anon           | join      | REFUSAL
another ORG      | anon           | function  | REFUSAL
another ORG      | anon           | view      | REFUSAL
another ORG      | mr             | postgrest | ABSENCE
another ORG      | mr             | raw sql   | ABSENCE
another ORG      | mr             | join      | ABSENCE
another ORG      | mr             | function  | ABSENCE
another ORG      | mr             | view      | ABSENCE
another ORG      | field_manager  | postgrest | ABSENCE
another ORG      | field_manager  | raw sql   | ABSENCE
another ORG      | field_manager  | join      | ABSENCE
another ORG      | field_manager  | function  | ABSENCE
another ORG      | field_manager  | view      | ABSENCE
another ORG      | admin          | postgrest | DATA      <-- DEFECT
another ORG      | admin          | raw sql   | DATA      <-- DEFECT
another ORG      | admin          | join      | DATA      <-- DEFECT
another ORG      | admin          | function  | DATA      <-- DEFECT
another ORG      | admin          | view      | DATA      <-- DEFECT
another SUBTREE  | anon           | postgrest | REFUSAL
another SUBTREE  | anon           | raw sql   | REFUSAL
another SUBTREE  | anon           | join      | REFUSAL
another SUBTREE  | anon           | function  | REFUSAL
another SUBTREE  | anon           | view      | REFUSAL
another SUBTREE  | mr             | postgrest | ABSENCE
another SUBTREE  | mr             | raw sql   | ABSENCE
another SUBTREE  | mr             | join      | ABSENCE
another SUBTREE  | mr             | function  | ABSENCE
another SUBTREE  | mr             | view      | ABSENCE
another SUBTREE  | field_manager  | postgrest | ABSENCE
another SUBTREE  | field_manager  | raw sql   | ABSENCE
another SUBTREE  | field_manager  | join      | ABSENCE
another SUBTREE  | field_manager  | function  | ABSENCE
another SUBTREE  | field_manager  | view      | ABSENCE
another SUBTREE  | admin          | postgrest | DATA      <-- by design
another SUBTREE  | admin          | raw sql   | DATA      <-- by design
another SUBTREE  | admin          | join      | DATA      <-- by design
another SUBTREE  | admin          | function  | DATA      <-- by design
another SUBTREE  | admin          | view      | DATA      <-- by design
```

**`anon` is refused everywhere. `mr` and `field_manager` are absent everywhere — twenty
cells, both boundaries, all five paths.** That half of the gate is genuinely met and had
never been demonstrated.

**A5 — the defect. An administrator of one pharmaceutical company can read another
company's data, through every path.** The cause is structural, not a missing predicate:

```sql
-- is_admin()
select coalesce(public.effective_role() = 'admin', false);
-- effective_role() reads user_profiles.role. There is no organisation in it.

select count(*) from pg_policy
 where pg_get_expr(polqual, polrelid) like '%organisation_id%';
 -> 0
```

**Not one policy in the schema mentions `organisation_id`.** The column exists on the
tables and has never been an access-control dimension. Six policies grant on `is_admin()`,
and every one of them is organisation-blind. **Registered as BE-W76. Not fixed**, per A5.

Cross-**subtree** admin access is excluded as by design: an admin is scoped to an
organisation, not to a territory. That is the only DATA that should be there.

**Why this had never been found.** Before this session **no test in the repository created
a second organisation**. `seedFixtures()` builds one org with a tree inside it, so every
isolation test ever written checked a subtree boundary. The gate was claimed on twenty
cells' worth of evidence and the other twenty had no fixture to run against.

**One cell was wrong before it was right, and the correction is the method.** The function
path first called `search_doctors(null, null, 200)` and looked for the target in the page —
which reported ABSENCE whenever the target sorted past row 200 of 3,520. **The limit hiding
the answer, not the scope refusing it.** It now searches by the target's own name. Exactly
the "a search shaped like the answer you expect" trap recorded in `gotchas.md` two sessions
ago, met again in the act of testing for it.

**A6 — the command that re-runs it:**

```bash
pnpm --filter @fieldforce/api seed:synthetic --mrs 100 --history 1y
pnpm --filter @fieldforce/api test -- g-rls-c
```

The suite **asserts the five defect cells are still failing**, so the quarantine cannot rot
into a comment about something fixed years ago — deleting those five lines is the acceptance
test for BE-W76's fix.

**G-RLS-X — the commercial/clinical boundary — is ABSENT, not passing.** There is no
clinical schema and there are no clinical roles; S6 and S7 are cut under the default scope
option. A gate with nothing to separate has not been met.

---

#### B — the `45007` tolerance

**The reviewer is right that it was not harmless.** There was no tolerance at all, and the
client supplies `captured_at` from the **device** clock, so an online capture sent
immediately arrives milliseconds old — and a handset a few seconds fast was told *"the
device clock is ahead of the server"* for the most ordinary capture the product has. On
exactly the handsets whose power managers stop the background sync that keeps a clock right.

**`consent_future_tolerance_seconds` = 120, UNVERIFIED**, in `app_thresholds` beside
`consent_max_sync_lag_hours`, registered like the UCPMP cap. **Zero restores the FIX-12
behaviour exactly**, so the mechanism can be switched off without being removed.

**Forward only. Backdating is untouched** and still governed by the sync lag — the two
directions have different adversaries. And forward-dating buys nothing anyway: the notice
check uses the same `captured_at`, so moving it forward makes a superseded version look
worse rather than better.

**B3 — `capture_lag` already stores the skew, and it now signs correctly.** It is
`received_at - captured_at`, so a tolerated capture from a fast phone stores a **negative**
lag — the observed skew, in the row, where a genuinely bad clock is a query rather than an
MR complaint. **FIX-12 asserted `capture_lag` could never be negative**; that was true while
the bound was absolute, and the assertion is narrowed rather than deleted, with its comment
saying why.

**B4:** two seconds ahead is accepted; ten minutes is refused `45007`; the skew is negative
in the row. The refusal test asserts the hint **says "do not re-ask"** rather than that it
never says "re-ask" — the sentence rules the wrong remedy out explicitly, which is stronger
than the phrase being absent. A first pass banned the substring and failed on the sentence
doing the work.

#### C — the withdrawal path. **Two of three already sound; one is not.**

| | verdict |
| --- | --- |
| **C1 — can a withdrawal be backdated?** | **YES, arbitrarily, in both directions.** `validate_consent_withdrawal` checks the original's existence, its outcome, its doctor and that it is not itself a withdrawal — and **never looks at `captured_at`**. The column is `NOT NULL` with no default and no check constraint. A withdrawal five years before the consent it supersedes and one a year in the future are both accepted, asserted. The same future instant is refused `45007` on a **capture**, which is the contrast that makes it a gap rather than a design. **BE-W77** |
| **C2 — can a client forge one for a doctor it does not hold?** | **NO.** The trigger compares `new.doctor_id` against the superseded record's, so a withdrawal cannot be aimed elsewhere — the bound BE-W74 had to add by hand on the capture side already existed here. A withdrawal naming a record that does not exist is refused |
| **C3 — is it append-only?** | **YES, including the case a policy would have missed.** `consent_records_reject_mutation` is **statement-level**, so UPDATE and DELETE are refused for `authenticated`, `anon`, `service_role` **and `postgres`**, the last with `23001`. A policy would have protected the row from everyone except the two roles most able to rewrite history |

**C1 matters because of what a withdrawal is.** It is the record that decides whether
everything processed between the original consent and the withdrawal was lawful. A capture
is now bounded three ways; the record that governs lawfulness is bounded not at all.

---

#### Where this stopped

**Parts A, B and C are complete. Part D — the four-write conversion — was not started, and
Part E was not reached.**

**Why:** Part A produced a compliance-boundary defect that A5 says to stop and report on,
and Parts B and C each produced a registered finding. The conversion is a full session on
its own — four write paths, the device-clock fix, the consent and samples refusal matrices,
and an emulator offline proof — and starting it on the remaining budget would have meant
compressing it.

**Nothing in D is blocked by A, B or C**, so the next session can begin with it directly.

**Order for the next session:**

1. **BE-W76 needs a decision before it needs code.** Is an "admin" a tenant administrator
   or a platform operator? The schema currently implements the second and the product
   describes the first. That is one sentence to a human, and the fix differs completely
   depending on the answer.
2. **Part D**, the four-write conversion, with the device-clock fix in the same session
   because D is what makes that branch reachable.
3. **Part E** only if the operator has confirmed the visit-status recommendation; otherwise
   the reads stay unconverted, because the done counter reads a field nothing writes.
4. **BE-W77**, the withdrawal timestamp bound — small, and it belongs with whoever answers
   the `consent_future_tolerance_seconds` question, since both are the same kind of decision.

---

---

### MR-06 — the tenant boundary (8 September 2026)

**Parts A, B, C and D are done. Part E — the conversion — was not started**, per its own
instruction: B, C and D used the session and nothing in E is blocked by any of them.

**G-RLS-C now PASSES.** Forty deny cells and fifteen positive controls, no quarantine.
**G-RLS-X remains ABSENT rather than passing** — there is no clinical schema and no
clinical role, and a gate with nothing to separate has not been met.

**Three new findings, one of them at least as serious as BE-W76.** BE-W79 is first below
because D3 says not to bury it in a list.

#### A1 — the push, and a correction

MR-05's four commits pushed as `ff0429b..fd5d3aa`. Run **`34215855380`: FAILURE.**

**MR-05's A1 was wrong and this is the correction.** It reported run `34211758329` as
green — that run was `ff0429b`, the MR-04 head. **The four MR-05 commits had never been
through CI at all.** When they were, they failed.

The cause is the theme of this whole prompt. `g-rls-c.spec.ts` drew its cross-org target
from `seed:synthetic`, **which CI does not run** — so the suite aborted with
`seed:synthetic has not been run — the cross-ORG half of this matrix cannot execute`.
That refusal was the right design and it worked: the suite said loudly that it could not
test the thing it existed to test, rather than skipping quietly. But it means the
cross-ORG half of MR-05's matrix had executed on exactly one laptop and nowhere else.

Fixed by making the second organisation a **fixture** rather than a seed, which is Part
D's lesson applied to Part A's blocker.

**Local counts after the whole session:**

| workspace | runner | before | after MR-06 |
| --- | --- | ---: | ---: |
| `@fieldforce/api` | vitest, live database | 531 / 26 | **538 passed / 26 files** |
| `@fieldforce/field` | vitest, logic | 359 / 25 | 359 / 25 |
| `@fieldforce/field` | jest, jest-expo render | 72 / 12 | 72 / 12 |
| `@fieldforce/mock` | vitest | 40 / 1 | 40 / 1 |
| `@fieldforce/ui-tokens` · `@fieldforce/core` · `@fieldforce/ui` | vitest | 54 / 21 / 4 | unchanged |

No skips, run three times. `verify:rollbacks`: schema empty, **39 migrations, 39
rollbacks**. `turbo run typecheck lint --force`: 16 of 16.

**The Part B, C and D commits are NOT pushed**, per the standing rule. So CI is red at
`fd5d3aa` and the fix is in six unpushed commits — which is the honest state and needs a
decision, because Part A cannot go green without Part B.

---

#### BE-W79 — **a tenant can break every other tenant's consent capture**

Found by the D1 sweep, proven against the live database, **not fixed.** It is as serious
as BE-W76 and needs less than BE-W76 did: no admin, no privilege, no cross-tenant access.

`consent_text_versions` has **no `organisation_id`**, and the resolver ignores tenancy
entirely:

```sql
active_consent_text_at(p_language, p_at) ->
  select v.* from public.consent_text_versions v
   where v.language = p_language and v.effective_from <= p_at ...
   order by v.effective_from desc limit 1
```

So the "currently active notice for `en-IN`" is **the newest one anybody published**.
`capture_consent` compares the version the MR displayed against that, and raises `45001`
if they differ. Proven end to end:

```
>>> BEFORE: active for probe-lang        -> A v1   (tenant A's own notice)
>>> A captures against its own notice    -> accepted
--- tenant B inserts a notice in the SAME language, touching nothing of A's ---
>>> AFTER: active for probe-lang         -> B v1   (tenant B's notice)
>>> A captures against its own notice    -> ERROR: the consent notice changed since it
                                            was displayed; re-read the current notice
                                            and ask again
```

**Tenant B publishing a consent notice stops tenant A capturing consent.** Consent is the
gate on recording, and recording is the product. It is a cross-tenant denial of service
performed by an ordinary tenant doing an ordinary thing, and the MR is told to re-ask a
doctor who already answered.

The disclosure half is smaller and still wrong: `consent_text_versions_select_authenticated`
is `using (true)`, so every company reads every other company's legal drafting.

**The fix is the same shape as BE-W76** — a tenant column, and the resolver scoped to
`current_user_organisation_id()`. It is not done here because MR-06 asked for the
organisation boundary on the commercial tables and this is the consent ledger, with a
migration over an append-only table and a client contract behind it.

---

#### B1 — the blast radius, before anything changed

**45 policies, 0 mentioning `organisation_id`.** The six granting on `is_admin()` were
`clinic_addresses`, `doctors`, `organisations`, `territories`,
`territory_shift_windows`, `user_profiles` — all `for all to authenticated`, all
`using (is_admin())` with no scope in them.

But the six were the small half. **`visible_user_ids()` is called by eighteen
`SECURITY DEFINER` functions** — `team_activity`, `coverage`, `mr_activity_detail`,
`approvable_call_reports`, `approve_call_report`, `list_consent_records`,
`read_consent_record`, `daily_mileage`, `team_exceptions`, `list_analyses`,
`list_analysis_overrides`, `read_analysis`, `create_analysis_override`,
`overdue_call_reports`, `my_upload_queue`, `sync_queue_status`, `list_sync_rejections`,
`reinstate_sync_item` — and by roughly thirty policies as `mr_id in (select
visible_user_ids())`. Its admin branch was one line:

```sql
if v_role = 'admin' then
  return query select p.id from public.user_profiles p;   -- every user, every tenant
```

**Does the console break when admin is scoped? It cannot: the console makes no data calls
at all.** `apps/console/src` contains no `fetch`, no Supabase client, no RPC. Every
coaching screen is unwired. That is the honest answer to B1's question, and it is not
reassurance — it means the console has never exercised any of this.

#### B2 — where the scoping went, and why

**Not in `is_admin()`.** That answers "is this caller an administrator", a question about
role. Folding a tenant test in makes one predicate answer two questions and the next
reader cannot tell which a call site meant.

**In the two scoping functions, for everything that already delegates to them.** Thirty
policies and eighteen functions closed by changing two `if v_role = 'admin'` branches. A
predicate per policy would have been a hand-maintained list of forty-eight things, and
this repo's rule is that such a list will eventually be left off. Deriving from the two
functions everything already calls *is* deriving from the catalog.

**In the policies directly, for the six that bypass those functions**, because no change
to a scoping function can reach `using (is_admin())`.

**Both placements are load-bearing, on different paths** — B6 proved it and it was not
what I expected. See below.

**The prerequisite nobody had noticed: `user_profiles` had no organisation column.** Only
`doctors` and `territories` carried one; a user's sole link to a tenant was
`territory_id -> territories.organisation_id`; and
`user_profiles_field_roles_require_territory` is `CHECK (role = 'admin' OR territory_id
IS NOT NULL)` — **the schema explicitly exempts an admin from having a territory**, and
`seedFixtures()` duly created one with `territory_id = null`. So an administrator had no
data path to a tenant at all, and no predicate could have been written however carefully.
**BE-W76 was a migration, not a policy edit.**

The column is NOT NULL and **derived by trigger** rather than supplied: a user in a
territory belongs to that territory's organisation and to no other, so a caller that
could pass a value could pass a wrong one, and a user labelled org X standing in a
territory of org Y is a tenancy hole wearing the fix as a disguise. The only actor a
human must decide for is the admin, whose organisation was genuinely undefined.

**Two holes closed at the same time, because a boundary that can be stepped over is a
boundary that looks fixed and is not:**

- **`territories.parent_id` had no same-organisation constraint.** A territory in org A
  could be parented to one in org B, and `visible_territory_ids()` walks `parent_id` — so
  a manager's scope could leave their tenant through the tree, with every policy behaving
  correctly.
- **`doctors.organisation_id` could disagree with its territory's.** Both NOT NULL,
  nothing tying them together. A doctor labelled org A sitting in a territory of org B is
  readable by org B through `doctors_select_in_territory` no matter what the org-based
  admin predicate says — the org column would have been decorative on exactly the table
  the matrix probes.

**And `organisations_select_authenticated` was `using (true)`**: every authenticated user
could enumerate every client on the platform. The client list is the most commercially
sensitive thing a multi-tenant vendor holds, and `true` is not a scope. Now scoped to the
caller's own tenant.

**`search_doctors` stops transcribing the policy by hand.** Its body carried
`if public.is_admin() then select array_agg(t.id) from public.territories t` with the
comment *"for an admin the equivalent scope is every territory"* — a true statement about
the old policy and a false one about the new. That is exactly the failure the `function`
cell exists to catch. The branch is **deleted, not corrected**: one expression of the
rule, in `visible_territory_ids()`, so there is nothing left to fall out of step.

#### B3 — the mechanism, and an honest note about the metric

```
select count(*) from pg_policy
 where coalesce(pg_get_expr(polqual,polrelid),'')
    || coalesce(pg_get_expr(polwithcheck,polrelid),'') like '%organisation_id%';
   before: 0        after: 7        (of 45 policies, unchanged in number)
```

Covered by an explicit predicate: `organisations` (twice — `organisations_admin_all` and
the new `organisations_select_own`), `doctors`, `territories`, `user_profiles`,
`clinic_addresses` (through its doctor), `territory_shift_windows` (through its
territory).

**The other ~30 policies are NOT covered by this count and are covered in fact**, which is
why the count is a poor metric on its own. They read `mr_id in (select
visible_user_ids())`, and that function is now tenant-scoped — so `visits`, `check_ins`,
`check_outs`, `call_reports`, `samples_and_inputs`, `recordings`, `voice_notes`,
`beat_plans`, `consent_records`, `analyses`, the four `sync_*` tables and both
`visit_audio_quarantine*` tables are all scoped without the string appearing anywhere in
their definitions. **Counting the string would have understated the fix and would
overstate the next one.** The behaviour is what the matrix measures.

**Deliberately not covered, with reasons:**

- `app_thresholds` and `consent_text_versions` — `using (true)` for `authenticated`.
  Thresholds are operational configuration. Consent text is **BE-W79 above** and is a
  real defect, not an accepted omission.
- `user_profiles_select_auth_admin` — `using (true)`, but granted only to
  `supabase_auth_admin`, which is GoTrue's own internal role and not reachable by any
  client. Scoping it would break sign-in.
- `objects` (the three `audio_*` policies) — scoped by `has_live_upload_grant(name)`, and
  a grant belongs to an MR who belongs to a tenant. Reached through the grant, not the
  tenant column.
- `adverse_event_reports_select_own` and `upload_grants_select_own` — scoped to
  `auth.uid()`, which is one user and therefore one tenant.

#### B5 — the full matrix. **Fifty-five cells, and G-RLS-C passes.**

```
another ORG      | anon               | postgrest | REFUSAL
another ORG      | anon               | raw sql   | REFUSAL
another ORG      | anon               | join      | REFUSAL
another ORG      | anon               | function  | REFUSAL
another ORG      | anon               | view      | REFUSAL
another ORG      | mr                 | postgrest | ABSENCE
another ORG      | mr                 | raw sql   | ABSENCE
another ORG      | mr                 | join      | ABSENCE
another ORG      | mr                 | function  | ABSENCE
another ORG      | mr                 | view      | ABSENCE
another ORG      | field_manager      | postgrest | ABSENCE
another ORG      | field_manager      | raw sql   | ABSENCE
another ORG      | field_manager      | join      | ABSENCE
another ORG      | field_manager      | function  | ABSENCE
another ORG      | field_manager      | view      | ABSENCE
another ORG      | admin              | postgrest | ABSENCE   <-- was DATA
another ORG      | admin              | raw sql   | ABSENCE   <-- was DATA
another ORG      | admin              | join      | ABSENCE   <-- was DATA
another ORG      | admin              | function  | ABSENCE   <-- was DATA
another ORG      | admin              | view      | ABSENCE   <-- was DATA
another ORG      | CONTROL their mr   | postgrest | DATA
another ORG      | CONTROL their mr   | raw sql   | DATA
another ORG      | CONTROL their mr   | join      | DATA
another ORG      | CONTROL their mr   | function  | DATA
another ORG      | CONTROL their mr   | view      | DATA
another ORG      | CONTROL their admin| postgrest | DATA
another ORG      | CONTROL their admin| raw sql   | DATA
another ORG      | CONTROL their admin| join      | DATA
another ORG      | CONTROL their admin| function  | DATA
another ORG      | CONTROL their admin| view      | DATA
another SUBTREE  | anon               | postgrest | REFUSAL
another SUBTREE  | anon               | raw sql   | REFUSAL
another SUBTREE  | anon               | join      | REFUSAL
another SUBTREE  | anon               | function  | REFUSAL
another SUBTREE  | anon               | view      | REFUSAL
another SUBTREE  | mr                 | postgrest | ABSENCE
another SUBTREE  | mr                 | raw sql   | ABSENCE
another SUBTREE  | mr                 | join      | ABSENCE
another SUBTREE  | mr                 | function  | ABSENCE
another SUBTREE  | mr                 | view      | ABSENCE
another SUBTREE  | field_manager      | postgrest | ABSENCE
another SUBTREE  | field_manager      | raw sql   | ABSENCE
another SUBTREE  | field_manager      | join      | ABSENCE
another SUBTREE  | field_manager      | function  | ABSENCE
another SUBTREE  | field_manager      | view      | ABSENCE
another SUBTREE  | admin              | postgrest | DATA      <-- by design
another SUBTREE  | admin              | raw sql   | DATA      <-- by design
another SUBTREE  | admin              | join      | DATA      <-- by design
another SUBTREE  | admin              | function  | DATA      <-- by design
another SUBTREE  | admin              | view      | DATA      <-- by design
another SUBTREE  | CONTROL their mr   | postgrest | DATA
another SUBTREE  | CONTROL their mr   | raw sql   | DATA
another SUBTREE  | CONTROL their mr   | join      | DATA
another SUBTREE  | CONTROL their mr   | function  | DATA
another SUBTREE  | CONTROL their mr   | view      | DATA
```

**The fifteen CONTROL rows are the difference between this matrix and MR-05's.** Each
boundary names the identities entitled to the row, and every path runs as them and must
return DATA. An ABSENCE counts only because the identical query a few rows down came back
with the row — otherwise a limit, a filter, a typo or an empty fixture is
indistinguishable from a refusal. `CONTROL their admin` is the sharpest of them: without
it, *"an admin cannot see the rival doctor"* cannot be told apart from *"no admin can see
any doctor"*.

The five by-design cells are **asserted present**, not merely tolerated, for the same
reason in the other direction.

**The quarantine is deleted, not relaxed.** MR-05 listed the five defect cells by name and
asserted them still failing; there is no list now, so a regression fails here rather than
being excused.

#### B6 — the two mutations, and what they showed that I did not expect

| mutation | result |
| --- | --- |
| **the organisation predicate removed** — the `000900` rollback file IS the mutation | **5 named cells return DATA**, suite red on `another ORG / admin / {postgrest, raw sql, join, function, view}`. Cases still 5, assertions failing |
| **`current_user_organisation_id()` forced to null** | **nothing changed.** Every control still DATA, matrix still green |
| **`visible_territory_ids()` admin branch emptied** | **the positive control fires**: `CONTROL their admin / function` -> ABSENCE, suite red on the control assertion |

**The middle row is the finding.** Nulling the helper the six new policies call broke
nothing, because `doctors` also has `doctors_select_in_territory`, which reaches the same
rows through `current_user_visible_territory_ids()` — and permissive policies are OR'd.
So for *reads on doctors* the policy predicate is not what carries the weight.

Emptying the scoping function instead broke exactly one cell: the `function` path, because
`search_doctors` is `SECURITY DEFINER` and RLS does not apply to it at all — only its own
body's scope does.

**The two placements are complementary rather than redundant, and neither alone is
sufficient.** That is the empirical answer to B2's question, and it is better evidence than
the argument I made for the design beforehand.

#### B7

**G-RLS-X remains ABSENT, not passing.** No clinical schema, no clinical roles; S6 and S7
are cut under the default scope option.

**The clinical tables inherit this pattern when they exist:** a tenant column on the row, a
single helper expressing the caller's tenant, and the scope resolved inside
`visible_*_ids()` rather than restated per policy. BE-W79 is the first proof the pattern
generalises — `consent_text_versions` needs exactly the same three things.

---

#### C — BE-W77, and a bigger hole found underneath it

**Three bounds, in the trigger:** `45007` forward beyond
`consent_future_tolerance_seconds`; `45008` older than `consent_max_sync_lag_hours`;
`23514` earlier than the consent it supersedes. Thresholds reused — two numbers for one
question is two numbers to keep in step, and they would drift.

**C2: the SQLSTATEs are reused, not minted**, because the remedy is what a code is for and
the remedy is identical — a clock that is ahead is fixed the same way whether it stamped a
consent or a withdrawal. `packages/core` maps both already and `error-contract.spec.ts`
guards that map in both directions; `45009`/`45010` would have added two entries whose
explanations were word for word the two that exist. **The messages differ where the
situation differs:** re-asking a doctor to withdraw is worse than re-asking for consent,
because it says the withdrawal did not register to the one person who has already
exercised the right.

The third bound gets `23514` and has no threshold, because there is no value of it that
could be right. The sync lag does not cover it: an hour-old consent withdrawn *"two hours
ago"* is well inside 72 hours and still describes a withdrawal that happened before there
was anything to withdraw.

**C3 — two-sided mutation, 18 cases both times, no no-op:**

| mutation | result |
| --- | --- |
| the bounds removed (the rollback file) | **3 failed / 15 passed** — exactly the three refusals |
| every withdrawal refused | **12 failed / 6 passed** — the positive controls, and every C3 append-only case, which each have to write a withdrawal first |

**C4 confirmed:** the doctor stays pinned to the superseded record, and the withdrawal row
stays append-only for `authenticated`, `anon`, `service_role` **and `postgres`** with
`23001`, after the change.

#### **BE-W78 — the bounds live in a function callers can skip**

Found while deciding where to put the withdrawal bound, and it decided it. `authenticated`
holds a **direct `INSERT` grant on `public.consent_records`**, and
`consent_records_insert_own` permits the row — so a client can insert a consent record
over PostgREST **without calling `capture_consent` at all**, and `45001`, `45007` and
`45008` are skipped with it. Proven as an ordinary MR:

```
insert into public.consent_records (..., captured_at)
values (..., now() + interval '1 year');   -- INSERT 0 1
```

A consent dated a year in the future, accepted, on the ordinary path the app is being
converted to use. **BE-W74 routed the sync path through `capture_consent`; the REST path
was never routed anywhere.** Registered, not fixed — the remedies are to move the bounds
into a trigger or revoke the INSERT grant so `capture_consent` is the only door, and
either has its own blast radius.

So the **withdrawal is now bounded strictly better than the capture it supersedes**, which
is the right way round for the record that governs lawfulness.

**A first draft of the C1c test asserted `45007` for an authenticated caller and was
wrong.** That role is refused `42501` first, because `validate_consent_withdrawal` is
**not** `SECURITY DEFINER` and its read of `consent_records` needs a SELECT grant the role
does not hold. Recorded rather than relied upon: a guard that holds because of where a
`SELECT` happens to sit is a guard that moves the day somebody adds `security definer` to
make the validator work for a new caller.

---

#### D — the single-fixture sweep

**D1, derived rather than listed.** One `seedFixtures()` call against a freshly reset
database, then `pg_stat_user_tables`:

```
beat_plans = 1              check_ins = 2            clinic_addresses = 3
check_outs = 1              consent_records = 2      doctors = 3
consent_text_versions = 1   analyses = 2             visits = 3
samples_and_inputs = 1      call_reports = 2         territories = 6
                            organisations = 2        user_profiles = 8
                            territory_shift_windows = 2
```

**The criterion is not literally "one row" — it is one row on the owning side of the
boundary.** `check_ins` has two rows belonging to two different MRs, so the boundary is
instantiated. `samples_and_inputs` has one row, one owner, and no query that could ever
come back with the wrong one.

**D2 / D3, ranked by consequence:**

| # | entity | what an isolation test WOULD check | enforced? | severity |
| --- | --- | --- | --- | --- |
| 1 | **`consent_text_versions`** | that another tenant's notice is neither readable nor **selectable as the active one** | **NO. No tenant column at all, and `active_consent_text_at` ignores tenancy** | **BE-W79. As serious as BE-W76** |
| 2 | `samples_and_inputs` | that another MR's samples are invisible, and that the UCPMP cap aggregates within a tenant | Partly. The policy is `mr_id in (select visible_user_ids())` and is now tenant-scoped; the cap aggregates by `doctor_id`, and a doctor is in exactly one tenant, so **the cap is sound** | **BE-W80**, low. A gap in coverage, not in the schema |
| 3 | `check_outs` | that another MR's check-out is invisible | Yes, same policy shape as `check_ins`, which has two rows and is tested | **BE-W81**, low. An asymmetry: check-in is testable and check-out is not |
| 4 | `beat_plans` | that another MR's beat plan is invisible | Yes, same policy shape as `visits`, which is tested | **BE-W82**, low |

**Only #1 is a defect.** #2–#4 are places where a real control exists and nothing exercises
it on that particular table — the mechanism is proven elsewhere, so they are coverage debt
and are registered as such rather than fixed. **#1 is not coverage debt: there is nothing
to cover.**

**D3's instruction is why BE-W79 is at the top of this record rather than in this table.**

**D4** — two entries appended to `docs/gotchas.md`: *a boundary with one instance in the
fixtures is untested by construction*, with the organisation boundary worked through and
the derivation query; and *an ABSENCE in an isolation test needs a positive control*, with
`search_doctors(null, null, 200)` at row 200 of 3,520 worked through, plus the direction
that is easier to forget — the by-design cells need asserting present, or an over-broad fix
looks exactly like a working one.

---

#### Two races the rival organisation exposed, both pre-existing

Neither introduced by MR-06; both latent, and a second organisation made them likely
enough to see.

**Connection exhaustion.** `seedFixtures()` created its auth users in a `Promise.all` —
six until the rival tenant made it eight — and vitest runs a dozen suites in parallel with
no concurrency cap. Eighty-odd concurrent `POST /admin/users` exhausted Postgres
(`max_connections` is 100); GoTrue could not get a connection and returned a 500 that
surfaced as **"Database error creating new user"**, failing **eight suites** at their
`beforeAll` with an error naming none of this. Creating the users sequentially cuts the
peak by a factor of eight and costs a few hundred milliseconds per suite. Raising
`max_connections` would have hidden the burst; capping vitest's concurrency would have
slowed every suite to fix one.

**A global count in a parallel suite.** `seed-reference-data`'s dry-run test bracketed the
call with `select count(*) from public.organisations` and asserted the two were equal — a
race it kept winning while `seedFixtures()` committed one organisation per call, and
started losing at two. It now asserts the row *this* dry run would have written is absent
before and after, which cannot be perturbed by another suite and is a strictly stronger
claim than a count that happened to stay level.

---

#### Where this stopped

**Part E — the four-write conversion — was not started.** Part E's own instruction says to
stop if B, C and D have used the session, and they have: a schema migration with a
derivation trigger, two integrity triggers, six rewritten policies, three rewritten
functions, a rewritten matrix with fifteen controls, three withdrawal bounds, four
mutations, the sweep, and two pre-existing races that had to be fixed before anything
could be measured.

**Nothing in E is blocked by A, B, C or D**, so the next session begins with it directly.

**Order for the next session:**

1. **Push.** Six commits are local and CI is red at `fd5d3aa` for a cause fixed in them.
   Part A cannot go green without Part B, which is the one decision this record needs
   taken before anything else.
2. **BE-W79** — the consent notice boundary. It needs no product decision: the fix is the
   pattern BE-W76 just established, and until it lands one client can stop another
   capturing consent.
3. **Part E**, the four-write conversion, with the `flushOutbox:220` /
   `QueueScreen.tsx:275` device-clock fix in the same session because E is what makes that
   branch reachable.
4. **BE-W78** — the REST path that skips `capture_consent`. It belongs with whoever decides
   whether the INSERT grant is revoked or the bounds move to a trigger.
5. **Part E's visit-status half** only if the operator has confirmed the `not_met`
   recommendation; otherwise the reads stay unconverted, because the done counter reads a
   field nothing writes.


---

### MR-07 — closing the bypasses (8 September 2026)

**Parts A, B, C, D and E are done. Part F — the conversion — was not started**, per its
own instruction: B, C and D used the session.

**Both bypasses are closed.** BE-W78 made every consent bound optional; BE-W79 turned out
to be a disclosure rather than only a denial of service. The tenant boundary is now
`RESTRICTIVE` and cannot be widened by anything added later.

#### A1–A3 — the push, with the SHA this time

Six commits pushed as `fd5d3aa..9bf7e7f`.

**CI run `34221153239`, commit `9bf7e7f99117cb9534bae4a40362906b93149495`, SUCCESS —
and that SHA is the HEAD those six commits produced.** Both jobs green.

The SHA is beside the run id because MR-05 reported a green run that belonged to an
earlier head, and four commits went through no CI at all as a result. Worth noting how
easily it recurs: while checking this, the run list showed a **success on `fd5d3aa`** —
which is `34219478450`, the *Audio retention watchdog* on a schedule, not CI. The only CI
run on `fd5d3aa` is `34215855380`, and it failed. A run id proves a run happened; it does
not say which workflow, or on what.

**A3 — the matrix runs IN CI, not only locally.** From `34221153239`'s log, on the
runner:

```
another ORG      | anon               | postgrest | REFUSAL
...
another ORG      | admin              | postgrest | ABSENCE
another ORG      | admin              | raw sql   | ABSENCE
another ORG      | admin              | join      | ABSENCE
another ORG      | admin              | function  | ABSENCE
another ORG      | admin              | view      | ABSENCE
another ORG      | CONTROL their admin | postgrest | DATA
...
 ✓ tests/g-rls-c.spec.ts (5 tests) 2396ms
```

All 55 cells, all five cross-ORG admin cells ABSENCE, all fifteen controls DATA.

**Counts, split by workspace and runner, all re-run locally after MR-07:**

| workspace | runner | before | after MR-07 |
| --- | --- | ---: | ---: |
| `@fieldforce/api` | vitest, live database | 538 / 26 | **551 passed / 28 files** |
| `@fieldforce/field` | vitest, logic | 359 / 25 | 359 / 25 |
| `@fieldforce/field` | jest, jest-expo | 72 / 12 | 72 / 12 |
| `@fieldforce/ui` | vitest | 4 / 1 | 4 / 1 |
| `@fieldforce/ui` | **jest, jest-expo** | **221 / 20** | **221 / 20** |
| `@fieldforce/ui-tokens` | vitest | 54 / 3 | 54 / 3 |
| `@fieldforce/core` | vitest | 21 / 3 | 21 / 3 |
| `@fieldforce/mock` | vitest | 40 / 1 | 40 / 1 |

**A correction to MR-06's counts.** `@fieldforce/ui` has TWO runners, `vitest run && jest`,
and MR-06 reported only the vitest four. The 221 jest cases ran — CI's log has them — but
the summary line jest prints (`Tests:`) does not match the pattern that was being read
(`  Tests `), so they were absent from the record rather than from the run. A reporting
gap, not a test gap, and it is the second time this session that reading an artefact
carelessly produced a confident wrong number.

No skips. `verify:rollbacks`: schema empty, **42 migrations, 42 rollbacks**.
`turbo run typecheck lint --force`: 16 of 16. `format:check` clean apart from the known
gitignored `apps/console/next-env.d.ts`.

---

#### B — BE-W78. **The consent bounds stop being optional.**

FIX-02 established consent integrity, FIX-12 added three offline bounds, BE-W74 routed
the sync path through them — and all of it was skippable, because `authenticated` held a
direct `INSERT` grant on `consent_records` and every bound lives in a function body.

**B3, the replayed attack.** The exact MR-06 insert, a consent dated a year in the future
as an ordinary MR over REST:

| | before | after |
| --- | --- | --- |
| as `authenticated`, over REST | **`INSERT 0 1`** | **`42501`**, refused by the grant before the row is considered |
| as `postgres` — `BYPASSRLS`, every grant, and what every fixture and SECURITY DEFINER function runs as | `INSERT 0 1` | **`45007`**, refused by the row |
| the remedy | — | hint says *"do not re-ask the doctor"* explicitly |
| an ordinary capture through `capture_consent` | works | **still works** — the positive control |

**Both halves, because either alone leaves a door.** The revoke closes today's door and
says nothing to the next migration that re-grants INSERT for a good reason, to a future
`service_role` path, or to anything with `BYPASSRLS`. The trigger holds the rule and would
have left a writable table whose policy says an MR may insert consent records directly —
an invitation the next reader would reasonably accept. So: revoke, **drop
`consent_records_insert_own`**, and put the three bounds in a `BEFORE INSERT` trigger. The
policy is dropped rather than left inert because with no policy and RLS FORCED, a restored
grant still writes nothing.

Same thresholds, same SQLSTATEs, same resolver — not a second set. Two definitions of a
valid capture would drift, and the drift would appear as a row accepted by one door and
refused by the other.

**Two fixtures turned out to be fabricated data, which is how the trigger was felt.**
`seedFixtures()` created its notice with `effective_from` defaulting to `now()` while
stamping consent records two hours earlier — asserting a doctor was shown a notice two
hours before it existed. Sixteen suites failed at once. `manager.spec` seeded consents at
the literal `'2026-08-12T11:00:00+05:30'`, 27 days back and nearly ten times
`consent_max_sync_lag_hours`. Both are the `sizeBytes: 1` shape: a value that satisfied
every constraint and described something that had not happened.

#### B4 — **every table where `authenticated` writes past a SECURITY DEFINER path**

Derived from the catalog, not listed. `authenticated` holds direct write grants on twelve
tables:

```
beat_plan_entries  DELETE,INSERT,UPDATE     organisations           DELETE,INSERT,UPDATE
beat_plans         INSERT,UPDATE            samples_and_inputs      INSERT
call_reports       INSERT                   territories             DELETE,INSERT,UPDATE
clinic_addresses   DELETE,INSERT,UPDATE     territory_shift_windows DELETE,INSERT,UPDATE
consent_records    INSERT                   user_profiles           DELETE,INSERT,UPDATE
doctors            DELETE,INSERT,UPDATE     visits                  INSERT,UPDATE
```

Of those, **four have a `SECURITY DEFINER` function as the intended path**:

| table | intended path | is the bypass live? |
| --- | --- | --- |
| **`consent_records`** | `capture_consent`, `apply_sync_item` | **WAS. The bounds were in the function. Fixed here** |
| `samples_and_inputs` | `apply_sync_item` | **No** — the UCPMP cap is `samples_and_inputs_ucpmp_cap`, a TRIGGER, so `45004` fires on a direct insert too |
| `call_reports` | `revise_call_report`, `apply_sync_item` | **No** — supersession is `call_reports_validate_version`, a TRIGGER |
| `visits` | `apply_sync_item` | **Partly.** No validation trigger at all; `visits_insert_own` and `visits_update_own` constrain ownership and territory, and nothing else. Registered as **BE-W84** |

The other eight are the reference tables an admin legitimately edits directly, with no
function path to bypass — and since MR-06 they are tenant-scoped, and since Part D
restrictively so.

**The conclusion is the pattern, not the list.** Three of the four already had their
guard in a trigger and were never bypassable. `consent_records` was the one place a guard
was put in a function instead, and that is exactly the distinction this repo wrote down
after FIX-05: *a guard which is not a trigger, a policy or a revoked grant is not a
guard.*

#### B5 — mutations

| mutation | result |
| --- | --- |
| the grant restored | the outer-lock test fails — **and the trigger still refuses**, which is the defence in depth working |
| the trigger dropped | the inner-lock and remedy tests fail |
| **both removed** | all three fail; the original BE-W78 attack succeeds again |

---

#### C — BE-W79. **C1's verdict: DISCLOSURE, not only denial of service.**

Confirmed three ways against the live database, as an ordinary MR of tenant A, with
tenant B holding a later notice in the same language:

```
>>> C1(a) THE LIST
 A v1 | TENANT A NOTICE
 B v1 | TENANT B CONFIDENTIAL NOTICE          <-- tenant A reads tenant B's text, in full

>>> C1(b) THE RESOLVER — active_consent_text(), the call behind the consent screen
 b0000000-... | B v1 | TENANT B CONFIDENTIAL NOTICE   <-- returned to TENANT A's MR

>>> C1(c) THE CAPTURE against tenant B's notice
 (a0000000-...,...)                            <-- SUCCEEDED
>>> the consent record that was written
 notice_stored: B v1 | TENANT B CONFIDENTIAL NOTICE
```

**So the app would have displayed another company's legal document to a doctor, and the
capture against it would have been accepted** — leaving tenant A holding a consent record
attesting a doctor agreed to a document tenant A never wrote, and tenant B named in a
consent it never issued.

Which branch fires is an accident of ordering. If the client shows the globally-active
notice it is (c), a corrupt consent record; if it shows its own it is the MR-06 denial of
service, `45001` on every capture. **The DoS half fails closed and is the better of the
two**, and it fails closed because of FIX-02 — the re-deriving version this replaced would
have stored tenant B's notice as what tenant A's doctor saw, silently.

**And it needs no privilege at all.** BE-W76 needed an admin. This needs an ordinary
tenant publishing an ordinary notice.

**C2 — the fix is the BE-W76 pattern, third time of asking.** A tenant column on
`consent_text_versions`, `active_consent_text_at` given a required `organisation_id`, and
`active_consent_text(language)` resolving the caller's tenant itself so there is no
parameter to abuse. The two-argument resolver is **replaced, not kept beside the new one**:
an overload that still answers "the active notice across everybody" is the defect with a
longer name.

**The tenant is derived from the ROW wherever a row exists.** `validate_consent_capture`
runs for `postgres` as well as `authenticated` and has no `auth.uid()` to consult, so it
resolves through `new.doctor_id`. That is also the honest question — the notice that
matters belongs to the company whose doctor was asked, not to whoever is connected.

**C3 — existing rows.** On every environment this repository can reach,
`consent_text_versions` is populated only by the fixtures and by `seed:reference`, which
refuses to invent content; there is no production deployment. **The count is zero and the
backfill is a no-op.** Where it is not zero, the migration resolves it against a single
organisation or **stops with an exception naming the rows** — attributing one company's
consent notice to another is the defect performed by the fix, so that decision is left to
a human. **No owner is guessed.**

**And the unique constraint was cross-tenant too.** `UNIQUE (version_label, language)`
meant tenant B could not publish a notice labelled `v1` in `en-IN` because tenant A
already had one — a quieter coupling on the same table that would have surfaced as an
inexplicable `23505` on a customer's first day. Now `UNIQUE (organisation_id,
version_label, language)`.

**C4/C5 — the proof and the mutations.** The fixture that demonstrated the defect is
replayed and the "after" line is now indistinguishable from the "before" line. Every
assertion carries its mirror, because *"tenant B's notice has no effect on tenant A"* is
also what a database that resolves no notice at all produces.

| mutation | result |
| --- | --- |
| the resolver unscoped again | the capture and consent-screen tests fail; **the LIST test still passes** |
| the policy widened back to `using (true)` | **only** the LIST test fails |

Two mechanisms, two mutations, neither covering for the other — the same complementary
finding as MR-06 B6.

---

#### D — the tenant boundary is RESTRICTIVE

**D1: I agree, and the mechanism is exact.** Postgres evaluates a row as
`(OR of every permissive) AND (AND of every restrictive)`, so a permissive policy can only
ever ADD access. MR-06's tenant predicates are permissive, so any future permissive policy
on the same table widens past them — and G-RLS-C would stay green, because it covers the
tables that exist today. The failure would arrive with a change that looked unrelated.

It also survives the failure mode MR-06 B6 *actually demonstrated*: one placement silently
covering for another. **A restrictive policy cannot be covered for.** It is the one
construction in this schema where "somebody else's policy already allows it" is not a
possible sentence.

**In scope: the seven tables that carry a tenant or reach one in a single hop** —
`organisations`, `doctors`, `territories`, `user_profiles`, `consent_text_versions`
directly; `clinic_addresses` through its doctor, `territory_shift_windows` through its
territory. Indexed equality on a column already present.

**Out of scope, registered as BE-W83 rather than guessed: the ~30 tables scoped through
`visible_user_ids()`.** They carry no tenant column, so a restrictive policy must reach one
through a correlated subquery per row, on top of the subquery the permissive policy already
runs. Whether the planner collapses those or doubles them is a measurement against the
208,800-visit synthetic seed. This repo has already been bitten once by a predicate that
looked free and turned out to disable an index; the honest move is to close the half that
is exactly and cheaply expressible and put a number on the other half first.

**Two details that would otherwise have broken things.** `to authenticated`, never
`public` — naming `public` would bind `supabase_auth_admin`, and
`user_profiles_select_auth_admin` is how GoTrue reads a profile during sign-in for a role
with no organisation of its own. And `current_user_organisation_id()` reads
`user_profiles`, one of the restricted tables: it is `SECURITY DEFINER` owned by
`postgres`, which has `BYPASSRLS`, so it does not re-enter the policy calling it. Were it
ever made `SECURITY INVOKER` this would recurse rather than deny, so the dependency is
written into the migration.

**D2 — the proof pair, and a defect I wrote on the way to it.**

| | result |
| --- | --- |
| an over-broad `using (true)` permissive policy added | **cross-tenant row still refused**, own-tenant row still returned |
| the restrictive policy dropped, same over-broad policy | **cross-tenant row returned immediately** |

**The pair runs on a mirror table, and that is a divergence worth stating.** The first
version added `create policy ... on public.doctors using (true)` inside a rolled-back
transaction. It passed alone and **deadlocked in a full run** — `create policy` takes
ACCESS EXCLUSIVE and a dozen suites read `doctors` concurrently. `deadlock detected`, in
the file whose whole purpose is to prove a safety property. A test that makes the rest of
the suite flaky is not a control; it is a second defect, and the same family as
`audit-atomicity` sabotaging a shared trigger.

So the behavioural pair builds a table mirroring the migration exactly — tenant column,
RLS enabled and FORCED, one permissive policy, one restrictive policy copied verbatim —
inside its own transaction. **That proves the semantics, not the deployment**, so the
deployment half is a catalog test asserting the seven real tables carry restrictive
policies, derived rather than listed, and the real tables' behaviour remains the forty deny
cells of `g-rls-c.spec.ts`.

**D4 — what the patient track inherits.** The pattern is now three things and it has held
three times: a tenant column on the row, one helper expressing the caller's tenant, and the
scope resolved where the lookup happens rather than restated per call site — plus a
restrictive policy so it cannot be widened. `consent_text_versions` inherited it this
session. The clinical tables get it from the start, and the restrictive half matters most
there: a widening mistake on a commercial table is a competitor reading a doctor list, and
on a clinical table it is something else.

---

#### E — the races

**E1, FIXED, because the fix was smaller than the registration.** Every spec's
`beforeAll` seeds eight auth users through GoTrue; with no cap vitest runs one worker per
core and they all seed at once, so GoTrue cannot get a connection out of `max_connections
= 100` and returns a 500 that surfaces as **"Database error creating new user"** — an
error naming neither connections nor concurrency. MR-06 serialised the eight creations
inside one fixture; that held until MR-07 added two spec files, **which is the shape of the
problem**: the burst scales with the number of SUITES, so the cap belongs in the config.
`maxWorkers: 6`. Reproduce by removing that line and running the api suite on a machine
with more than six cores.

**E2** was fixed in MR-06 — the global `count(*)` in `seed-reference-data`'s dry-run test —
and is recorded there.

**E3, new this session and closed: `audit-atomicity`'s deadlock.** It installs a sabotage
trigger on `audit_log`, which every parallel suite writes to. Taking ACCESS EXCLUSIVE
first, before anything else in the transaction, made the lock ordering consistent and cut
the failure rate from about **one run in three to one in five**. The remainder is a genuine
two-transaction cycle no ordering inside one transaction can prevent, so it retries —
which is what Postgres documents `40P01` as calling for. **Bounded to four attempts and
scoped to that test, not to `inRolledBackTransaction`**, because a deadlock anywhere else
in this suite is a finding rather than noise, and a blanket retry is how a real
lock-ordering bug hides for a year. Six consecutive full runs clean afterwards.

**E4, registered, not diagnosed.** `seed-one-mr`'s *"mints a fresh address every run"*
failed once in six full runs and passes in isolation three times. It creates two users
concurrently, so it is the same family as E1. **I did not capture its error and will not
claim a mechanism I did not observe.**

---

#### Where this stopped

**Part F — the four-write conversion — was not started**, which is Part F's own
instruction when B, C and D have used the session. They have: two migrations with a
trigger and a resolver replacement, a schema change to an append-only table, seven
restrictive policies, five new or rewritten spec files, seven mutations, and three
concurrency races that had to be closed before anything could be measured twice.

**Nothing in F is blocked by A, B, C, D or E.**

**Order for the next session:**

1. **Push.** Five commits are local; `9bf7e7f` is green and is what main is on.
2. **Part F**, the four-write conversion, with the `flushOutbox:220` /
   `QueueScreen.tsx:275` device-clock fix in the same session because F is what makes that
   branch reachable.
3. **BE-W84** — `visits` has no validation trigger and a direct INSERT/UPDATE grant. It is
   the last of the four B4 tables whose guard is not in a trigger, and F writes to it.
4. **BE-W83** — restrictive policies for the `visible_user_ids()` tables, once the subquery
   cost is measured against the synthetic seed.
5. **Part F's visit-status half** only if the operator has confirmed the `not_met`
   recommendation.


---

### MR-08 — guarding visits, and the conversion (8 September 2026)

**Parts A, B and D are done. Part C — the conversion — is NOT done**, and two defects it
would have carried into `sync_push` were found and fixed instead. Where and why is at the
end.

#### A1 — the push, with the SHA and the workflow name

Six commits pushed as `9bf7e7f..5c143a2`.

**CI run `34225979343` · workflow `CI` · event `push` · commit
`5c143a21e7c526b22c64360b3d3edb65460dd432`, SUCCESS**, both jobs — and that SHA is the
HEAD those six commits produced.

The workflow name is checked because the trap has already caught this session once: the
run list still shows a *success* on `fd5d3aa`, which is `34219478450`, the **Audio
retention watchdog** on a schedule. The only CI run on that commit failed.

#### A2 — **the counter, and the two things it found on its first run**

`scripts/test-counts.mjs` reads each workspace's own `test` script to learn which runners
it declares, runs each with its JSON reporter, and **exits 1 if a configured runner
reports zero cases, or any skips.** It found:

1. **`@fieldforce/console` has ten passing tests** and had appeared in no session's counts.
2. **Worse: `ci.yml` has no step for it at all**, so those ten had never run in CI.
   Seven workspaces have a `test` script. CI ran six.

`ci.yml`'s own comments name this failure twice — `ui-tokens` was *"decorative in CI from
the day it was written"* because the step did not exist, and `ui` was added *"in the same
commit, because a workspace that gains a suite and not a CI line is how ui-tokens stayed
decorative."* **The rule was known, written down, and applied by hand.**
`ci-covers-every-suite.spec.ts` now derives it from the workspaces, and is mutation-proven:
removing the console step fails the test naming `@fieldforce/console` exactly.

**Counts, per workspace AND per runner, from the tool rather than from reading:**

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   363    25
@fieldforce/ui         jest     221    20        @fieldforce/field     jest      72    12
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/api       vitest   565    30
@fieldforce/mock       vitest    40     1        TOTAL                         1350
```

No skips. `verify:rollbacks`: schema empty, **43 migrations, 43 rollbacks**.
`turbo run typecheck lint --force`: 16 of 16.

Two details in the tool worth keeping. The runners are invoked as `node <entry>` rather
than via `npx` or `node_modules/.bin`, because on Windows those are `.cmd` shims that
`execFileSync` refuses without `shell: true` — and `shell: true` concatenates arguments
instead of escaping them. And the file count comes from `testResults.length`, not
`numTotalTestSuites`, which counts `describe` blocks in vitest and files in jest: reading
it reported api as 139 "files" against 30 real ones. **A column whose meaning changes per
row is the same defect, one column over.**

---

#### B — BE-W84. `visits` gets a validation trigger

**The probe first: five incoherent visits, five accepted.** A cross-tenant doctor, another
doctor's clinic address, another MR's beat plan, a `started_at` a year in the future and a
`completed_at` a year in the future all inserted without complaint.

**B1 — the rules, and why each was accepted or rejected**

| candidate | verdict | reason |
| --- | --- | --- |
| **the doctor is visible to the acting MR** | **ACCEPTED** | `visits_insert_own` already requires exactly this over REST. `apply_sync_item` is `SECURITY DEFINER`, so RLS does not apply, and its visit branch takes `doctorId` straight from the payload. **The offline path was weaker than the online one for a rule the product had already stated.** Resolved through `visible_territory_ids(new.mr_id)` — the row's MR, not the session's — so it holds for `postgres` and for a fixture |
| **organisation coherence** | **ACCEPTED** | Stated separately even though the rule above now implies it, since MR-06 made `visible_territory_ids` org-scoped. A cross-tenant visit deserves to be told it crossed a tenant, not that it picked the wrong territory. Two rules, two remedies |
| **`started_at` / `completed_at` not in the future** | **ACCEPTED** | A visit that started tomorrow is incoherent and `received_at` is server-stamped, so the comparison is available |
| **`scheduled_for` not in the future** | **REJECTED** | A beat plan schedules visits ahead. A bound here would break beat planning, and the acceptance is **asserted**, not assumed — a suite that only proves refusals would not have noticed |
| **a sync-lag bound like `consent_max_sync_lag_hours`** | **REJECTED** | **The remedy differs, and the remedy is what a bound is for.** A consent too old to accept can be taken again; a visit too old to accept is work that already happened, and refusing it erases the only record of the call. `team_exceptions` already emits `no_recent_sync` for a stale sync. Bounding it here would delete data to report a problem that is already reported |
| **`mr_id` server-derived** | **REJECTED — already true** | Column default `auth.uid()` (migration `20260907000600`), `visits_insert_own` requires `mr_id = auth.uid()`, `apply_sync_item` assigns `v_uid`, and `CreateVisitRequestSchema` has never declared the field. A fourth copy would be noise, and a trigger cannot know who a `postgres` caller "should" be — what it can check is coherence |
| **status transitions** | **BLOCKED** | On the `not_met` question. Writing transition rules against a three-value enum that is about to gain a fourth would encode the wrong answer in a trigger. **BE-W73, still one sentence to a human** |
| **`clinic_address_id` belongs to the doctor** | **ACCEPTED — found while probing** | `record_check_in` measures the geofence from it, so the wrong address measures the wrong building. The probe put a Delhi clinic on a Pune visit |
| **`beat_plan_id` belongs to the MR** | **ACCEPTED — found while probing** | `apply_sync_item` checks the plan for staleness and never checks whose it is |

**The SQLSTATE follows the remedy, not the layer that noticed.** Tenant and territory
raise `42501` → `not_permitted`, and that was not a free choice: `write-path.spec.ts`
asserts a client sees `not_permitted` for a doctor outside its territory, and **a BEFORE
trigger fires ahead of the policy's WITH CHECK**. The first draft raised `23514` and
silently changed what an MR is told about a situation that had not changed. Clinic address
and beat plan are shape, so `23514`. The clock rules reuse `45007` with a visit-shaped
hint, because *"do not re-ask the doctor"* is meaningless here.

**B3 — the refusals, each proved twice**

| rule | as `postgres` (BYPASSRLS, every grant) | over REST as an ordinary MR |
| --- | --- | --- |
| cross-tenant doctor | `42501` | — |
| doctor outside the territory | `42501` | `not_permitted`, unchanged |
| another doctor's clinic address | `23514` | — |
| another MR's beat plan | `23514` | — |
| `started_at` in the future | `45007`, hint names the visit and not the doctor | — |
| `completed_at` in the future | `45007` | — |
| an UPDATE repointing a valid visit | `42501` | — |
| **a coherent visit** | **accepted** | — |
| **`scheduled_for` + 3 days** | **accepted** | — |

**B4 — what the fixtures encoded.** `manager.spec`'s consent-divergence seeder booked
`nagpurMr` against the **Pune** doctor. `visits_insert_own` has always refused that over
REST; the fixture writes as `postgres`, so nothing checked it. **Third fabricated fixture
this project has found in two sessions**, after a doctor shown a notice two hours before
it existed and consents seeded 27 days old. A sweep now asserts no committed fixture holds
an incoherent visit.

**B5 — three mutations**

| mutation | result |
| --- | --- |
| the trigger dropped (the rollback file) | **8 of 12 fail.** The four survivors include the REST test — the policy still covers that path, which is the complementary-placement point again |
| the trigger refuses every visit | **the whole suite cannot start**: `seedFixtures()` itself fails, 12 skipped, nothing green |
| **the REJECTED candidate adopted** — bound `scheduled_for` too | 6 fail, including the assertion that a future `scheduled_for` is accepted |

**Also fixed: `asOwner`, twice, both my own.** It had no savepoint, so a write that was
*supposed* to fail aborted the transaction and the role restore then failed with `25P02` —
**eight assertions reported that instead of the code they were testing.** The savepoint
then broke eight upload tests with `25P01`, because the helper is also called from
`withClient` in autocommit, where a failed statement aborts nothing and no savepoint is
needed or legal.

---

#### C — **not converted.** Two defects found and fixed instead

The survey came first, and it found two live defects in the outbox — both of which would
have been carried straight into `sync_push` had the conversion gone ahead on top of them.

**1. A queued CHECK-OUT was replayed as a CHECK-IN.**

`visit/[id].tsx` queued both stages with `checkInQueueItem`, which hardcodes
`entity: 'check_in'`. `flushOutbox`'s `sendFor` had **no `check_out` branch at all**, so
a check-out taken with no signal was written to disk as a check-in and replayed through
`client.createCheckIn`.

**An MR who loses signal at the clinic door has their departure recorded as an arrival** —
a real geo-and-time record, against the right visit, describing the wrong event, with
nothing anywhere reporting a problem. `CreateCheckOutRequestSchema` **is**
`CreateCheckInRequestSchema`, so no shape check could have caught it, and `check_out` has
been in `SyncEntitySchema` since the enum was written, with no caller.

It is precisely the corruption `sampleQueueItem`'s own comment warns about two functions
below — *"a second entity makes that assumption a silent corruption — a handover replayed
through `record_check_in` — rather than merely a simplification."* **Check-out was already
the second entity when that warning was written.**

**2. C5 — the device clock behind the words "Server recorded this at".**

`flushOutbox` stamped `receivedAt: nowIso()` under the comment *"the server answered, so
this is the server's clock by definition"*. It is the **device's** clock at the moment the
response was parsed, on a handset whose clock `capture_consent` refuses to trust past a
two-minute tolerance. `QueueScreen.tsx:275` rendered it as *"Server recorded this at …"*.

`events.ts` says, in the docstring above the field, that `receivedAt` *"is the only
timestamp allowed to mark an item as landed; the device clock is not trusted for anything
with a compliance meaning"*. **The rule was written down, in the file that declares the
field, and the one call site that populated it ignored it.**

Every created entity carries `received_at`, stamped by the column default
`clock_timestamp()`, so the server's value was in the response the whole time. The field is
now **nullable** through `ServerVerdict`, `RejectionRecord` and `QueueScreenRejection`:
carry the server's value or carry none, and render nothing when there is none. Both states
are tested, and both mutations confirmed — removing the `check_out` branch fails the
departure test; restoring `nowIso()` fails both clock tests.

**What is NOT done, and it is most of Part C.** C1 (four writes through `sync_push`), C2
(deleting the mock write path), C3 (the call-report copy), C4 (exactly-once), C6 (consent
specifics), C7 (samples specifics), C8 (the offline proof), C9 (divergences) and C10 (the
two-column table) are untouched. **No screen was converted, no mock path was removed, no
copy was changed, and there is no emulator proof.**

**C8 additionally needs something this environment does not have running.** An AVD
(`Pixel_10`) exists and `adb` is installed, but no device is booted and the app is a dev
client — so the proof needs a Gradle native build, an emulator boot, and the emulator
reaching Supabase on `10.0.2.2`. That is a session's work before the first check-in is
tapped. **The handset proof remains owed, and is now six weeks outstanding.**

---

#### D — two small things

**D1** — two entries appended to `docs/gotchas.md`: *a consistency check between two values
from the same unscoped source proves consistency, not correctness*, with FIX-02 worked
through (it established provenance **in time** and said nothing about provenance **in
tenancy**, and both sides of its comparison came from the same cross-tenant resolver); and
*test fixtures are where impossible states get normalised*, with all three worked examples
and the reason fixtures are where it happens — they write as `postgres`, which holds every
grant and `BYPASSRLS`, so the policies that state these rules for a client say nothing to
them.

**D2, both answers verified in the code rather than asserted:**

1. **Yes — the retry is at the caller, outside the aborted transaction.**
   `retryOnDeadlock(() => inRolledBackTransaction(...))` wraps the whole call, and
   `inRolledBackTransaction` opens its **own connection** and its own `begin` per attempt.
   The losing attempt's transaction is rolled back and its connection closed in that
   function's `finally` before the retry decides anything.
2. **No duplicate audit row is possible: the whole transaction replays, and none of them
   commit.** `inRolledBackTransaction` always `rollback`s in `finally` — it has no commit
   path — so nothing from any attempt reaches `audit_log`. `seedFixtures()`, which *does*
   commit, is called on the line above the retry and therefore runs exactly once however
   many attempts follow.

---

#### Where this stopped

**Before Part C's conversion**, after the survey that preceded it turned up two live
defects worth more than a compressed conversion would have been.

The reason is the standing stop rule rather than a budget: C1 through C10 is four write
paths re-plumbed onto `sync_push`, a mock path deleted, copy changed, an exactly-once
proof, two per-entity refusal matrices, a divergence audit and an emulator run that needs a
native build first. **Doing it in the room left would have produced exactly the kind of
half-converted write path this project keeps finding**, and it would have been built on an
outbox that recorded departures as arrivals.

**Both defects fixed are prerequisites for the conversion rather than substitutes for it.**
The check-out entity had to be right before four writes were routed through one queue, and
the clock had to be right before a screen showed a server timestamp it had not been given.

**Order for the next session:**

1. **Push.** Five commits local; `5c143a2` is green and is what main is on.
2. **Part C in full**, starting from C1 — the outbox now has the correct entity per row and
   an honest clock, which is the base it needed.
3. **C8 first, not last**, since it is the part that needs an environment: boot the AVD and
   get a dev client onto it before writing any conversion code, so the proof is not
   discovered to be impossible at the end.
4. **BE-W73** — the `not_met` decision, which still blocks both the read conversion and the
   status half of BE-W84.
5. **BE-W83** — restrictive policies for the `visible_user_ids()` tables, once the subquery
   cost is measured.


---

### MR-09 — the misroute class, and the conversion (8 September 2026)

**Parts A, B, C and E are done. Part D — the conversion — was NOT started**, and the
survey found a hard dependency that makes it impossible to do a write at a time. That is
the most useful thing in this section and it is at the end.

#### A1 — the push

Four commits pushed as `0c0f902..fb87e73`.

**CI run `34246789699` · workflow `CI` · event `push` · commit
`0c0f902765ef063d6d4208415ae85284199a2613`, SUCCESS**, both jobs — and that SHA is the
HEAD those four commits produced.

The scheduled-workflow trap is still live: the run list shows *successes* on `5c143a2` from
**Audio retention watchdog** and **Audio retention**, both `schedule`. Checking the
workflow name and the event is now part of the claim, not a courtesy.

#### Counts, per workspace AND per runner, from `scripts/test-counts.mjs`

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   367    25
@fieldforce/ui         jest     221    20        @fieldforce/field     jest      72    12
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/api       vitest   565    30
@fieldforce/mock       vitest    40     1        TOTAL                         1354
```

No skips. **43 migrations, 43 rollbacks**, schema empty. `turbo run typecheck lint
--force`: 16 of 16.

---

#### B — the misroute class, not the one instance

**B1 — the author is caught at compile time.** `sendFor` is now a `switch` over the entity
kind with a `never` default. Proven by adding a ninth entity to `SyncEntitySchema`:

```
src/sync/outbox.ts(388,9): error TS2322:
  Type '"mileage_scratch"' is not assignable to type 'never'.
```

Removed again afterwards. Adding an entity without a branch can no longer compile.

**B3 — the entity audit, which the compiler now enforces and the record should carry:**

| entity | branch | what happens |
| --- | --- | --- |
| `check_in` | ✅ | `createCheckIn` |
| `check_out` | ✅ | `createCheckOut` — **added MR-08 after the misroute** |
| `consent_record` | ✅ | `createConsentRecord` |
| `sample_and_input` | ✅ | `createSampleAndInput` |
| `visit` | ❌ `not_convertible` | written straight to the table, no RPC in the way (FIX-07) |
| `call_report` | ❌ `not_convertible` | written directly and **not queued at all**; Part D converts it |
| `recording` | ❌ `not_convertible` | needs an `uploadGrantId` only an upload session can mint (FE-W29) |
| `voice_note` | ❌ `not_convertible` | the same |

Four of eight are sendable, and the other four are now **listed explicitly** rather than
falling off the end of an `if` chain — so converting one is a change to that line and not a
change to nothing.

**B4 — a second defect in the same dispatch, and its corruption shape.** `batch_started`
marks every selected row `in_flight`. The old code then did `if (send === null) continue`,
recording **no verdict at all** — and every later flush selects only `queued`.

**What the data would have looked like:** the row sits on the device marked as if in
transit, forever. Never retried, never dead-lettered, never counted as failed. The queue
screen shows it as in-flight, which reads as *"on its way"*. **Nothing would have reported
it** — the MR is told their work is being sent, and it never will be. The comment claimed
the row was *"left where it is rather than dropped"*; it was left where nothing would ever
look again. It now records `attempt_failed`, which returns it to `queued` with a visible
reason and eventually dead-letters it to a person.

That defect was unreachable while all four queueing entities had branches. It becomes
reachable the moment a fifth entity is queued — which is precisely what Part D does.

**B2 — the payload is caught at replay time, and it is not redundant with B1.** They catch
different actors: the `never` default catches an **author**, at compile time, and can say
nothing about a row already on disk; the discriminant catches a **row** whose `entity` says
one event and whose body is the other. That is what the buggy build wrote, and because
`CreateCheckOutRequestSchema` **is** `CreateCheckInRequestSchema`, every shape check in the
system agreed the row was fine. **Two distinct events with one shape are indistinguishable
to a type system by construction; only a value can separate them.**

The discriminant is device-local — stored payload only, never on the wire, no contract
schema touched. A payload with **no** discriminant is refused rather than trusted, because
it can only come from a build older than this one, which is exactly the build that wrote
departures labelled as arrivals. Nothing has shipped, so this strands nothing real.

**The field is `__queueEntity`, and the name is itself a finding.** The first attempt called
it `kind` and silently overwrote `CreateSampleAndInputRequest.kind` — a business field whose
values are `'sample' | 'input'`. Every queued handover would have gone out declaring a kind
that is not in the enum. It fails closed rather than open, but it is the same family as the
defect being fixed: **a device-local marker written into a namespace the contract already
owns.**

**B5 — four tests and two mutations.** Removing the discriminant check fails the two B2
tests; restoring the `continue` fails all three. The positive control asserts a correctly
labelled row still sends, with a body carrying no device-local marker.

---

#### C — **the environment came up.** Signed in, on the Today screen

| step | result |
| --- | --- |
| **C1** JDK 17 | `C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`. No `java` on PATH at all, so `JAVA_HOME` is set per-command |
| **C2** stack | ten Supabase containers healthy, Kong `200`. MR seeded: `seed-ed761153-mr@example.test`, sign-in verified against GoTrue by the seed script itself |
| **C3** emulator | `Pixel_10` booted in ~30s. **A debug APK from 7 September already existed**, so no Gradle build was needed. `adb reverse` for 8081, 54321 **and** 4010 |
| **C4** Metro | port 8081 was held by a stale `node` (PID 10180) from an earlier session; killed and restarted. `cd apps/field && node ../../node_modules/expo/bin/cli start --dev-client` |
| **C5** sign-in | **reached the Today screen.** Screenshots captured at each step |

**And the Today screen is the evidence for Part D.** It shows *"Dr Rohini Kulkarni,
Sahyadri Clinic, Pune"* and *"2 of 3 visits done"* for an MR seeded four minutes earlier
with no data at all:

```
Supabase:  user_profiles=1  doctors=0  visits=0  clinic_addresses=0
the app:   visit 66666666-6666-4666-8666-666666666601
           mr    22222222-2222-4222-8222-222222222202   <- mock fixture ids
```

**Auth goes to real Supabase; every read and write goes to the mock at `:4010`.** That
split is now demonstrated on a device rather than asserted from the source.

---

#### D — not started, and the survey says it cannot be done a write at a time

Two findings, and the second is the blocker.

**1. Two of the four writes already have a complete Supabase path that nothing calls.**
`apps/field/src/capture/check-in.ts` exports `recordCheckIn` and `recordCheckOut`: they call
`rpc('record_check_in')` / `rpc('record_check_out')` through the live client, map failures
with `refusalForSqlState(error.code)`, and parse the result rather than casting it. They are
finished, correct, and **called from no screen** — `visit/[id].tsx` calls
`createClientForScenario().createCheckIn(body)`, which is the mock.

The characteristic defect again, thirteenth appearance: **code that looks exercised and is
not.** `capture/visits.ts` has the same shape for `daily_mileage`.

**Samples, consent and call report have no Supabase writer at all.** The only `rpc(` calls
in `capture/` are the three above.

**2. THE BLOCKER: a write cannot be converted before the read it depends on.**

`record_check_in` takes a `visit_id` and its first act is *"the visit is yours"* —
`select * from visits where id = p_visit_id and mr_id = v_uid`, else `42501`. The visit id
the screen is holding is `66666666-…-601`, a **mock fixture id that exists nowhere in the
database**. So converting check-in alone does not produce a partially-converted app; it
produces an app whose first check-in fails `visit … is not yours`, every time.

The same applies to all four: consent needs a real `visit_id` and a real `doctor_id`,
samples need both, a call report needs a real visit. **The write conversion requires the
read conversion**, and the read conversion requires real reference data for the signed-in MR
— which `seed:mr` does not create (it produced `doctors=0`) and which `seed:reference`
deliberately refuses to invent.

**So Part D is not four independent conversions but one dependent chain**, and the first
link is a seed that does not exist yet. That is a session's work before the first screen
changes, and it is why nothing was converted here rather than something being half
converted.

**Nothing in D was started. No screen was changed, no mock path removed, no copy changed,
and there is no D7 proof.** The environment that proof needs is now up and stays up.

---

#### E — one gotcha

Appended: **a new guard must not change the code returned for a situation that has not
changed**, with BE-W84's first draft worked through — it raised `23514` where the REST
contract had always returned `42501`, because **a `BEFORE` trigger fires ahead of the
policy's `WITH CHECK`** and therefore pre-empts existing refusals and takes over their
codes. The general form: *a guard added in front of an existing one inherits its cases and
must inherit its answers.*

---

#### Where this stopped

**After Part C, before Part D**, on the evidence above rather than on budget.

The reviewer's instruction was to bring the environment up first so the session would not
end without its proof. It did the opposite of what was expected and that is the useful
outcome: **the environment came up, and having it up is what revealed that the conversion
cannot start.** The Today screen showing mock fixture ids for an MR with no data is a fact
that no amount of source reading had produced in eight sessions.

**Order for the next session:**

1. **Push.** Three commits local; `0c0f902` is green and is what main is on.
2. **A seed that gives the signed-in MR a real day** — organisation, territory, doctors,
   clinic addresses, a beat plan and today's visits, in Supabase. Everything else waits on
   it, and `seed:reference` will not invent the content.
3. **Convert the READS first** — Today, doctor list, visit detail — so the ids on the screen
   are ids the database has.
4. **Then Part D's four writes**, starting with check-in/check-out, which need wiring rather
   than writing.
5. **D7 on the emulator**, naming check-out explicitly, since it is the event that was being
   corrupted.

The environment is left running: emulator booted, ports reversed, Metro serving, signed in.


---

### MR-10 — the seed, and the conversion (8 September 2026)

**Parts A, B and C are done. Part D — the conversion — was NOT started**, and the reason is
a second blocker that only became visible once the first was removed. It is precise, it is
server-side, and it is at the end.

#### A1 — the push

Two commits pushed as `87f3712..ed3d5fc` (the record commit follows).

**CI run `34255135572` · workflow `CI` · event `push` · commit
`87f37125fd04a08d0d66b90378db0ca8cf65ced4`, SUCCESS**, both jobs — and that SHA is the HEAD
those two commits produced.

#### A2 — the environment

**Came up, and had survived from MR-09:** emulator `emulator-5554` still booted, Metro still
serving, ten Supabase containers healthy, all three `adb reverse` ports still mapped. The
public schema was empty — `verify:rollbacks` had left it that way at the end of MR-09 — so
migrations were re-applied before anything else.

#### Counts, per workspace AND per runner

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   370    25
@fieldforce/ui         jest     221    20        @fieldforce/api       vitest   570    31
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/mock      vitest    40     1
                                                 TOTAL                         1362
```

No skips. **43 migrations, 43 rollbacks**, schema empty. `turbo run typecheck lint
--force`: 16 of 16.

---

#### B — `seed:day`. The missing link, built

```
pnpm --filter @fieldforce/api seed:day
pnpm --filter @fieldforce/api seed:day -- --another    # a SECOND tenant, on purpose
```

**A new script, not an extension of `seed:mr`**, and the reason is what each is for.
`seed:mr` has one job and one output — a credential — and `seed-one-mr.spec.ts` asserts
that shape. Growing it into a territory tree, doctors, clinic addresses, visits, a notice
and two more roles would couple a credential helper to a demo dataset and make every test
of the former depend on the latter. This is closer in kind to `seed-synthetic.mjs`: a
dataset, obviously synthetic, safe to delete. It reuses `seed:mr`'s `createAuthUser`,
because minting an identity by hand gets the password hashing and confirmation state wrong
in ways that only surface as an unexplained *"Invalid login credentials"*.

**Three things the obvious list misses, derived from what the screens and the server
actually read:**

- **Clinic addresses.** `Doctor.clinicAddresses` is required by the contract, the doctors
  list renders `clinicAddresses[0].city`, `visit/[id].tsx` matches `visit.clinicAddressId`
  against them, and `record_check_in` measures the geofence from one.
- **Beat plan entries.** `BeatPlan` requires `entries`; a plan without them fails to parse.
- **A consent notice for this organisation.** BE-W79 made notices tenant-scoped, so an MR
  whose organisation has none **cannot capture consent at all** — `capture_consent` raises
  `22023`. Without it the seed would unblock four screens and leave the fifth broken in a
  way that reads as a new defect. `effective_from` is a month back, because a notice
  effective *now* is not active for a capture stamped a moment earlier.

Plus a **shift window covering the current time**, or `record_check_in` refuses `45003`
before anything behind it is testable. And **deliberately no UCPMP cap**: the samples screen
shows *"the app is not counting"* while the cap is null and that message is under test —
setting one here would hide it and quietly change what the screen proves.

**B3 — a second run refuses**, naming the existing demo organisation and offering
`db:reset` or `--another`. It is not idempotent and cannot be: each run mints fresh
identities and there is no "the demo MR" to converge on, so the choice was between
accumulating silently and saying so. **The check runs before any identity is minted** — the
first version connected after `createAuthUser`, so a refused run left three orphan auth
users behind, and a refusal that costs something is not a clean refusal. Verified:
`auth.users` is 6 before a refused run and 6 after.

**B4 — verification, server-side**

```
doctors=3  visits=3 (today, 2 completed + 1 planned)  clinic_addresses=3
beat_plan_entries=3   territory_shift_windows=1   consent_text_versions=1

sync_pull, called AS THE SEEDED MR through RLS:
  beat_plan | 1
  doctor    | 3
  visit     | 3
```

Row counts prove the inserts ran. **`sync_pull` proves the server will serve them to the
person who signed in**, which is the part that matters and the part the tests assert.

**What B4 could NOT show, and it is Part D's blocker rather than the seed's failure:** the
Today screen still renders mock fixture ids, because no screen reads from Supabase yet. The
seed removed the *data* blocker; the *path* blocker is below.

---

#### C — the scheduled-code sweep

**C1 — every branch that cannot currently execute, what schedules it, and what an MR would
see if it ran:**

| branch | why unreachable | scheduled by | what the MR would see |
| --- | --- | --- | --- |
| **`rejected` / `dead_lettered` verdicts** — and with them `RejectionRecord`, the queue screen's whole rejection block, `deadLettered`, `attemptsRemaining`, the server-clock line | `flushOutbox`'s `catch` recorded `attempt_failed` for **everything**, so a refusal went back to `queued`. Nothing in the app ever emitted a rejection | **D4, the writes** — refusals start arriving during flushes | A consent refused `45001` sitting in the queue as *"waiting to send"*, retried on every flush **for ever**, never explained, while they believe it is on its way. **FIXED THIS SESSION** |
| a row nothing can send stranded `in_flight` | `batch_started` marks it in flight, the dispatch `continue`d without a verdict, later flushes select only `queued` | D4 queues a fifth entity | *"on its way"*, for ever. **Fixed MR-09 B4** |
| `duplicate` verdict | handled by the reducer, emitted by nothing — only `sync_push` produces it | **D6, exactly-once** | a replayed item counted as a fresh send. Benign today (the reducer treats it as `accepted`), registered |
| **the entire `sync/pull.ts` module** — `applyPull`, `removalWording`, the completeness notice | **no screen calls `pull()`** | **D1, the reads** | — |
| `out_of_scope` removal wording | inside `pull()` | D1 | *"deleted"* for a record that still exists. The module already guards it; nothing exercises the guard |
| `reinstated` | no client path at all; needs a manager action | not scheduled | — |
| `not_convertible` in `sendFor` | no unconvertible entity is queued | D4 queues a call report | now visible and dead-lettered, per MR-09 B1 |

**C2/C3 — the one Part D would have scheduled, fixed.** `sendOrQueue` has always told a
refusal from a silence: an `ApiRequestError` means the server answered, so the item is not
queued, *"because queueing it would mean re-sending something already refused, on every
flush, forever."* **`flushOutbox` did not draw that line.**

It now dead-letters a refused row — `dead_lettered` rather than `rejected`, because a queued
row replays byte-identical, so the same `occurredAt` is outside the same shift window on
every attempt and a refusal of it is permanent by construction. That is the definition of
*needs a person, not another retry*.

The `ApiErrorCode → SyncRejectionCode` mapping is coarse **on purpose and says so**: one is
a transport category, the other a queue category, and neither is the SQLSTATE contract that
carries the actual remedy — BE-W75 put `sqlState` on the verdict for exactly this reason.
`internal_error` is the honest default rather than a guess that reads as precision.

Mutation: removing the refusal branch fails the dead-letter test; the silence test and the
positive control hold it from the other side.

**C4** — the gotcha, with four worked examples in six sessions and the three questions that
find them: which `switch` arms have no **producer** (all four were fully *handled* and never
*emitted*), which modules are exported and called by nothing, and which reducer states no
caller ever constructs.

---

#### D — not started. The second blocker, and it is server-side

The seed removed the data blocker. Bringing the app up against it exposed the next one, and
it is small, precise and not a client change.

**`sync_pull` returns three entities and no clinic addresses.** Measured, as the seeded MR:

```
distinct entity from sync_pull -> beat_plan, doctor, visit
doctor payload contains clinic addresses? -> f
```

And every read screen renders them:

```
doctors/list.ts:50    doctor.clinicAddresses[0]?.city
doctors/profile.ts:62 doctor.clinicAddresses[0]
today/plan.ts:64      doctor.clinicAddresses.find(c => c.id === clinicAddressId)
today/route.ts:58-59  the same, for the route card
```

`pull.ts` already records the shape of the problem in its own docstring — *"Rows, not
aggregates. `Doctor` requires `clinicAddresses` and `BeatPlan` requires `entries`, and
neither is a column, so neither aggregate can be built from a pull."* It states the
difficulty and does not resolve it, and nothing has ever called the module, so nothing has
ever had to.

**So the chain is one link longer than it looked:**

1. a seed that gives a signable MR a day — **done this session**;
2. **`sync_pull` must carry clinic addresses** — a migration, a rollback, a client mapper
   and their tests. Two designs, and the choice is not obvious: a fourth `clinic_address`
   entity (changes `PullChange`, the mapper and the store, and models the row honestly), or
   nesting the addresses in the doctor payload (no client type changes, but makes one pull
   entity an aggregate and breaks the *"rows, not aggregates"* rule the module is built on);
3. wire `pull()` into a store and move the screens onto records;
4. then the writes.

**Nothing in D was started. No screen changed, no mock path removed, no copy changed, and
there is no D9 proof.** Starting step 3 without step 2 would produce doctors that fail to
parse, which is the same class of half-conversion MR-09 declined to ship.

**D2 — the done counter has not run and is still waiting.** `visits.status` is written by
nothing on the client, and the `not_met` recommendation is now **five sessions** unanswered.
The seed writes two `completed` visits and one `planned`, so the counter would read *2 of 3*
honestly the moment the reads are converted — the data is there; the decision about what
"done" means when a doctor was unavailable is not.

---

#### Where this stopped

**After Part C, before Part D**, on the evidence above.

The pattern is now two sessions old and worth naming: **each session removes one blocker and
the removal makes the next one visible.** MR-09 brought the environment up and found there
was no data; MR-10 built the data and found the read path cannot carry it. Neither was
findable by reading source, and both took one measurement once the thing in front of it
existed.

**Order for the next session:**

1. **Push.** Three commits local; `87f3712` is green and is what main is on.
2. **Clinic addresses through `sync_pull`** — decide between the fourth entity and the
   nested payload, in the record, before writing either.
3. **Wire `pull()`**, move the read screens onto records, and delete nothing until they
   render.
4. **Then the writes**, starting with check-in/check-out, which need wiring rather than
   writing (`recordCheckIn`/`recordCheckOut` are finished and called by nothing).
5. **BE-W73** — the `not_met` decision, five sessions waiting.

Environment left running: emulator booted, ports reversed, Metro serving, and the database
holding one freshly seeded demo day.


---

### MR-11 — the aggregate, not_met, and the conversion (8 September 2026)

**Parts A and B are done, and C5 — the decision record — is done. C1–C4, D and E were not
started.** Where and why is at the end.

#### A1 — the push, and **CI IS RED**

Three commits pushed as `87f3712..5e2892c`.

**CI run `34258625706` · workflow `CI` · event `push` · commit
`5e2892c4e67f24052dea181f94170693afeff03c` — FAILURE.** That SHA was the HEAD those three
commits produced. The first job passed; `migrations · Gate 0 RLS suite · rollbacks` failed:

```
FAIL tests/audit-metadata.spec.ts     Error: admin create user failed (500):
FAIL tests/sync-pull-contract.spec.ts   "Database error creating new user"
Tests  555 passed | 15 skipped (570)
```

**That is E1's connection exhaustion, and I reopened it in MR-10.** `seed-day.spec.ts`
called `seedDay()` three times — once per test, for independence — and each call mints
**three** GoTrue identities. Nine concurrent `POST /admin/users` on top of everything else
the run is doing. It never failed locally; CI has less headroom, and `maxWorkers: 6` is not
even binding on a four-core runner.

**The MR-10 record had already named the shape** — *"the burst scales with the number of
SUITES"* — and the next suite added was that one. Naming a pattern is not the same as
remembering it, which is the honest finding here.

Fixed by seeding once in `beforeAll` and sharing the tenant: nine identities become three,
and the four assertions are about one dataset rather than four unrelated ones. Three
consecutive clean local runs afterwards, and the full suite green three times.

**The fix is local and unpushed**, along with Part B, because the standing rule is not to
push past Part A without review. **Main is red and the repair is on this machine** — which
is the state MR-07 §1 judged worse than either alternative. Pushing is the reviewer's call
and the recommendation is to take it.

#### A2 — the environment, as a precondition

**Came up, and everything survived from MR-10**: emulator booted, Metro serving, ten
Supabase containers healthy, all three `adb reverse` ports mapped. The public schema was
empty again (`verify:rollbacks` leaves it so), re-applied and re-seeded.

**Signed in as `demo-6ca14559-mr@example.test` and reached the Today screen**, through the
onboarding flow after clearing app state. It renders *"Dr Rohini Kulkarni, Sahyadri Clinic,
Pune"* — the mock — while the seeded day holds Asha Deshpande, Vikram Rao and Meera Iyer.
**The blocker, on screen**, which is where Part D begins.

#### Counts, per workspace AND per runner

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   375    25
@fieldforce/ui         jest     221    20        @fieldforce/api       vitest   575    32
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/mock      vitest    40     1
                                                 TOTAL                         1372
```

No skips. **44 migrations, 44 rollbacks**, schema empty. `turbo run typecheck lint
--force`: 16 of 16.

---

#### B — BE-W87. Clinic addresses in the pull

**B1 — a separate entity, and the three reasons were checked against the code rather than
taken on trust.**

1. **The cursor is `(updated_at, id)` over an `xmin` snapshot.** A nested payload only syncs
   a clinic edit if the DOCTOR's `updated_at` moves when a child row changes — a
   trigger-maintained coupling that, if ever missed, means the edit never syncs and
   **nothing reports it**. The client would hold a stale address and believe it current.
2. **`sync_pull` is SECURITY INVOKER, so RLS does the scoping** — verified, and it is why
   the doctor arm carries no predicate at all. A separate arm inherits
   `clinic_addresses_select_visible_doctor` for free. A nested aggregate would need the
   scope hand-written inside it, which is the policy transcription MR-06 deleted from
   `search_doctors` after it fell out of step.
3. **Tombstones already work per entity.** Inside a nested payload a removed address is
   *"the array got shorter"*, which is not a deletion signal.

**B3 — the geofence, and the answer was to verify before deciding.** `record_check_in`
already records `geofence_status = 'unavailable'` when a visit has no clinic address —
**not refused, and not invented**: `unavailable` is one of exactly three values the enum
permits. The decision is to keep it. Refusing would mean an MR standing in front of a
doctor cannot record that they were there because of a sync-ordering accident on their own
phone; waiting would be an unbounded spinner at a clinic door on a handset whose power
manager may kill the sync. A check-in with no geofence is a smaller loss than a visit never
recorded, and `geofence_status` makes the loss visible to a manager.

**B4 — partial state has a name.** `doctorWithAddresses()` reports `addressesPending` rather
than an empty address presented as fact, with a positive control that the flag clears, and
an unknown doctor returning `null` rather than *"a doctor with no addresses"* — two
different facts a screen must be able to tell apart.

**Verified end to end:**

```
sync_pull as the seeded MR:  beat_plan 1 | clinic_address 3 | doctor 3 | visit 3
completeness.entities:       ["visit","beat_plan","doctor","clinic_address"]
```

**B5/B6 — five server tests, five client tests, four mutations.** Removing the clinic arm
fails all five server tests; dropping the tombstone trigger fails exactly the removal test;
removing the client's `clinic_address` case fails three client tests including the explicit
misroute one.

#### Four things the work found on its way

- **`sync_events.entity` is `text` with a CHECK constraint.** The type permitted a new value
  and the constraint did not. Caught by the tombstone test writing a real deletion rather
  than asserting the trigger exists.
- **`emit_sync_event` dispatches on `tg_table_name` through an if/else whose ELSE reads
  `old.mr_id`.** `clinic_addresses` has `doctor_id`, so a trigger added without a branch
  would raise — loud rather than silent, but the same shape as the `sendFor` chain.
- **`applyChanges` in `pull.ts` ended in a bare `else` that wrote to `beat_plan`.** A fourth
  entity would have stored **every clinic address as a beat plan** — the same misroute as
  the check-out replayed as a check-in. Now a `switch` with a `never` default, and a test
  that names it.
- **`packages/core`'s `SyncPullEntitySchema` had three members**, and
  `sync-pull-contract.spec.ts` failed within a minute of the migration landing. That test
  doing its job is the reason the contract did not silently diverge.

#### A divergence, with a verdict

**`ClinicAddress.coordinates` maps to `null`. Verdict: the CONTRACT is wrong.**
`CoordinatesSchema` requires `accuracyMetres` and `capturedAt` — it models *a GPS fix
somebody took*. A clinic's latitude and longitude are a **geofence centre**, which nobody
captured, at no moment, with no accuracy. Filling those in would be fabrication of the
`sizeBytes: 1` kind. Nothing is lost: **the client never reads a clinic's coordinates** —
the geofence is computed server-side inside `record_check_in`. The fix is a geofence-centre
type distinct from a captured fix; registered rather than done here, because it touches the
mock and the UI.

#### Two method failures, both caught by their own tests

- **The first version of the migration rewrote `sync_pull` by hand** and dropped the
  `from page p` its aggregate selects over, failing on the first call with `missing
  FROM-clause entry for table "p"`. This is a `create or replace` chain, and this repo's
  rule for those is to read the LIVE definition — **which applies to writing one as much as
  to auditing one.** Rebuilt by patching `pg_get_functiondef` with two targeted edits.
- **The first version of the tests declared `truncated` and `cursor`**, which `sync_pull`
  does not return. Both came back `undefined`, so the drain stopped after one page and every
  "cursor" passed to a second pull was null — making it a **full re-sync, which by design
  carries no tombstones**. The deletion test then failed for a reason that had nothing to do
  with deletions. A shape assumed rather than read;
  `select jsonb_object_keys(public.sync_pull(null))` answers it in one line.

---

#### C5 — the `not_met` decision, recorded

Appended to `.ai-collab/decisions.md` (which **is** tracked, as of BE-W8) as a **reviewer
decision taken on the operator's behalf, dated, and reversible until real data exists**.

`visit_status` gains `not_met` with a required reason, mirroring
`consent_outcome.not_asked` — a shape the schema already models and already enforces with
`consent_records_not_asked_has_reason`. Recorded with the terms it was taken on: the copy
must claim **attendance** rather than success, and `not_met` is attributed to the territory
or the doctor and **never scored against the MR**, because a metric that punishes an honest
outcome manufactures dishonest ones.

**Recorded, deliberately, without being implemented.** A decision taken in the operator's
absence should be visible as a decision rather than absorbed into a diff — and the window
in which it is reversible closes on the day the first real visit is recorded, not before.

---

#### Where this stopped

**After Part B and C5.** C1–C4, D and E were not started.

Part B turned out to be four changes rather than one — a migration, a constraint, a
contract enum and a client store — because each layer had its own list of entities and each
list had to grow. Three of the four were found by something failing rather than by reading:
the CHECK constraint by a tombstone test, the contract enum by the conformance test, and the
`beat_plan` fallback by TypeScript. That is the system working, and it is also why the part
was not small.

**C1–C4 is the next session's first task and is fully unblocked** — the decision is taken
and recorded, and the enum change is a two-migration sequence (`alter type … add value`
cannot be used in the same transaction that adds a constraint referring to it). Starting it
here would have meant adding the enum member without the copy change, which is precisely the
harm C3 exists to prevent: an app that says *"That's the day done"* to an MR who found three
doctors unavailable.

**Order for the next session:**

1. **Push, first.** Three commits local, and **main is red at `5e2892c`** for a cause
   repaired in one of them.
2. **C1–C4**, in one session: the enum, the required reason, `record_check_out` writing the
   status, the copy, and the assertion that no metric scores `not_met` against the MR.
3. **D**, the reads — `pull()` is still called by no screen, and the store now has the shape
   the screens need, including `doctorWithAddresses`.
4. **E**, the writes and the emulator proof, naming check-out and the rejection case.

Environment left running: emulator booted, ports reversed, Metro serving, database holding
one freshly seeded demo day.


---

### MR-12 — every dispatch site, and the conversion (9 September 2026)

**Parts A, B, C and D are done. Parts E and F were not started.** Where and why is at the
end.

The checkout guard passed first: `git rev-parse --git-dir`, `@fieldforce/core` in
`packages/core/package.json`, remote `Praverse-Tech-Pvt-Ltd/Elmiron-App`, `f34ceef` an
ancestor of HEAD — **exit 0**, toplevel `C:/Users/Admin/StudioProjects/Elmiron-App`.

#### A1 — the push, and CI took three attempts to go green

MR-11's three commits pushed as `5e2892c..2f12a4b`. **CI run `34326262244` · workflow `CI` ·
event `push` · commit `2f12a4b…` — FAILURE**, and *not* for MR-11's cause. The identity fix
worked; `"Database error creating new user"` is gone. It exposed the defect underneath:

```
error: a visit cannot have started in the future     code 45007
detail: started_at 2026-09-09 09:30:00+00 is more than 120 seconds
        after the server clock 2026-09-09 07:56:43+00
seedDay  scripts/seed-day.mjs:331
```

**`seedDay` built its day at a fixed LOCAL wall-clock hour** — `todayAt(9, 30)` — for
`started_at` and `completed_at`, both of which `validate_visit` bounds against the server
clock. In the IST afternoon 09:30 is behind you and the seed passes. On a UTC runner at
07:56 it is 94 minutes ahead.

**The comment directly above the rows already stated the requirement**: *"`completed_at` is
in the past for both finished visits, which the new `visits_validate` trigger requires."*
It was written above the code that broke it.

Both columns now derive from `now`. `scheduled_for` keeps its wall-clock hour, which the
trigger permits by design — *"a beat plan schedules visits ahead of time, so a future value
there is the feature rather than a defect."*

**The assertion is deliberately not "in the past" alone**, because `todayAt(9, 30)`
satisfies that every afternoon — which is exactly why the defect survived. It pins the
offsets, so the old shape fails at almost any hour. Positive control **at 13:30 IST, an
hour where the CI failure does not reproduce**: `expected 240.61 to be less than 160`.

Then run `34326888642` failed on the **next** step:

```
check constraint "sync_events_entity_check" of relation "sync_events" is violated by some row
applying 20260908001500_sync_pull_clinic_addresses.down.sql
```

MR-11's own rollback narrowed the constraint behind a deliberate no-op —
`delete ... where entity = 'clinic_address' and false` — so it would FAIL while any
clinic_address tombstone existed. The reasoning was sound and the placement was not:
`ci.yml` runs `verify:rollbacks` **last**, after the whole api suite, against the database
that suite just wrote to, and says so in a comment calling the ordering load-bearing. The
refusal was conditional on nothing.

**CI GREEN: run `34327705574` · workflow `CI` · event `push` · commit
`d632c79f5f9c236d13859d8981ae751b0f58617f`.** That SHA was HEAD at the moment of the push
that produced it.

#### A2 — the environment

**It was DOWN**, though MR-11 left it up: Docker not running, no emulator, no adb ports.
Brought up — Docker 29.3.1, JDK 17, ten containers, all migrations applied, `seed:day` run,
the emulator booted. **Sign-in and the Today screen were not re-confirmed this session** —
that is E2's work and E was not started.

---

#### B — every dispatch site. The sweep found FIVE, not three, and TWO were unguarded

**B1 — how the enumeration was done, so it was not shaped like its expected answer.**
Searched by dispatch SHAPE rather than by the three names already known:

1. every `switch (` in non-test TS/TSX → `outbox.ts:422`, `pull.ts:123`, `pull.ts:251`,
   `reducer.ts:124`
2. SQL `if`/`elsif`/`case` on `entity` or `tg_table_name` → `emit_sync_event`,
   `apply_sync_item`
3. every file mentioning an entity string literal, counted per file
4. `Record<…Entity>` lookup tables, and `.entity ===` if/else chains

Searches 3 and 4 exist because a `switch` grep cannot see a dispatcher written as a lookup
table or an if/else chain. Search 4 later found one such table in the UI — `BeatPlanScreen`'s
`STATUS` map — which Part D had to extend.

**B2/B5 — the fourth dispatcher, and the record had it filed as SAFE.**
`emit_sync_event`'s two `else` arms both read

```sql
case tg_table_name when 'visits' then 'visit' else 'beat_plan' end
```

MR-11 called this loud — *"its ELSE reads `old.mr_id`, so a trigger added without a branch
would raise."* **That holds only for a table with no `mr_id`. Seventeen public tables have
one**, including `call_reports`, `check_ins`, `check_outs`, `samples_and_inputs`,
`recordings` and `voice_notes` — every plausible next candidate.

Demonstrated on a scratch table **before** the fix:

```
delete from public.scratch_call_thing where id = '1111…';
entity    | entity_id                            | reason
beat_plan | 11111111-1111-1111-1111-111111111111 | deleted
```

No error. `sync_events_entity_check` permits `beat_plan`, so the constraint does not catch
it. **What the corruption would have looked like:** the client's `applyChanges` receives
`{entity:'beat_plan', reason:'deleted', id:<a call report's id>}` and deletes an id no beat
plan has. The real deletion is never applied, the handset keeps a record the server
destroyed, and **nothing anywhere reports it**, because every layer did exactly what it was
told.

**B3 — `apply_sync_item` was already guarded.** Its `case p_entity` ends in
`else raise … using errcode = '0A000'` — verified against the **live** definition, not the
migration files, and pinned by a test so a future `create or replace` in that seven-file
chain cannot drop it. SQL's equivalent of a `never` default is an `else` that raises.

**The fifth, and two that were only half-guarded.** `mapChange` (`pull.ts:123`) sits forty
lines above the dispatcher MR-11 fixed and had no guard; `syncQueueReducer`
(`reducer.ts:124`) likewise. Both **did** fail the build on a new member — as
`TS2366: Function lacks ending return statement`. That names the wrong problem, invites a
trailing `return` that removes the guard permanently, and evaporates silently if the return
type is ever widened to include null.

**B4 — positive controls, all two-sided:**

| Guard | Refuses | Still admits |
| --- | --- | --- |
| `sync_entity_for_table` | scratch table → raises `0A000` | all four real tables resolve |
| the same, mutated | guard removed from the live DB → **3 of 5 specs fail**, the key one with *"promise resolved `Result{ command: 'DELETE' }` instead of rejecting"* | restored → 5/5 |
| `mapChange` / `syncQueueReducer` | scratch members → `Type '"scratch_entity"' is not assignable to type 'never'` | removed → typecheck 3/3 |

---

#### C — the identity burst removed rather than capped

`maxWorkers: 6` was a constant tuned to the suite count, and the finding it fixes says the
burst scales **with** the suite count. It was reopened three times: MR-06 serialised inside
the fixture and two new suites reopened it; MR-07 added the cap; MR-10 added a suite; MR-11
found CI red again.

**C1 — the mechanism is a lock, not a number.** `createAuthUser` takes a Postgres advisory
lock around `POST /admin/users`, so at most **one** identity creation is in flight across
every worker process, regardless of how many suites, workers or cores exist. The lock lives
in the database being protected, so it holds **across processes** — the property a worker
cap cannot have, and the reason the cap had to be re-chosen every time the suite count
moved. **There is no number left to re-tune.**

**`maxWorkers: 6` is deleted.** Its removal is the proof: the comment it carried said
*"Reproduce the failure by removing this line and running the api suite on a machine with
more than six cores."*

**C2 — the proof, under exactly that condition. 20 cores, no cap: 34 files, 585 passed,
three consecutive runs.**

A per-file identity budget backs it up. **It found a second instance of the pattern MR-11
fixed by hand**: `audit-atomicity.spec.ts` called `seedFixtures()` once per test — two full
worlds, sixteen identities, in a file with two tests. Nobody knew it was there. It failed on
the budget's first run and is now one world shared in `beforeAll`.

**C3 — `gotchas.md`: "a written lesson is not a control"**, with six worked examples, two of
them found this session, and the three tests of whether you have a guard rather than prose:
*can it fail; does it name the right problem; does it have a positive control?*

---

#### D — `not_met`, WITH the copy

**D1.** `visit_status` gains `not_met`; `visits` gains `not_met_reason` with the **pair** of
constraints `consent_records` already has for `not_asked` — required when it applies,
forbidden otherwise. Two migrations, because `alter type … add value` cannot be used in the
transaction that adds a constraint referring to it.

**D2.** `record_check_out` writes the outcome. **Nothing wrote `visits.status` before this**
— verified, not assumed: no function in `public` contained `update public.visits`, so a
checked-out visit stayed `planned` for ever. This partly closes **BE-W73**;
`planned → in_progress` is still advanced by nothing.

`apply_sync_item` carries `notMetReason` too. It called `record_check_out` with seven
arguments and the eighth has a default, so **nothing broke** — a queued not-met check-out
simply arrived as `completed` with the reason dropped. Part B's class exactly: a write that
succeeds as the wrong thing, invisible because the row does arrive.

**D3 — the copy as written:**

| Was | Is |
| --- | --- |
| `2 of 3` · "visits done" | `3 of 3` · **"visits attended"** |
| "That's the day done" | **"That's everyone on the plan"** |
| "Everything on the plan is complete." | **"You went to every visit on the plan."** / "… One doctor was not available." / "… 3 doctors were not available." |
| day-end "all of them done" | **"you went to all of them"**, plus *"That is recorded against those visits, not against you."* |
| beat-plan row | **"doctor not available"**, tone neutral |

**The counter changed as much as the words.** `done` counted only `completed`, so an MR who
attended three clinics and found three doctors in theatre read **"0 of 3" under a
congratulation**. Attendance is `done + notMet`, and `notMet` stays separate so the screen
can say how many doctors were not there. `finished` is now
`done + notMet === counted.length`.

**D4** is enforced structurally: no `not_met_by`, no fault column, no attribution to a
person anywhere in the shape — asserted by a test, plus that no manager-facing view pairs
`not_met` with fail/miss/penal/blame.

**Four exhaustive switches broke on the new member and each was handled rather than
defaulted.** `StopState` gains `not_met` rather than folding it into `done`, which would
have been the copy defect in map form.

#### Divergences, with verdicts

| Divergence | Verdict |
| --- | --- |
| `visits.not_met_reason` reached the client fixtures the day its column existed | **The contract was behind.** `to_jsonb(row)` is an implicit `select *`. Caught by `sync-pull-contract.spec.ts`, which exists for this. Added to `VisitRowSchema`, `VisitSchema` and the mapper |
| `ClinicAddress.coordinates` (MR-11) | **The CONTRACT is wrong**, unchanged this session. Mapped to null rather than fabricated. `BE-W88` open |
| `record_check_out`'s old 7-argument signature | Dropped; the new one revoked from `public, anon` then granted to `authenticated`. Two existing guards caught it left executable |

#### Four things this work found on its way

- **A guard test that could pass while the guard was absent.** The `emit_sync_event` spec
  seeded from `select … from user_profiles where role = 'mr' limit 1`; on a database no
  other suite had seeded, that inserts no row, fires no trigger, and **passes**. It failed
  exactly once, alongside another spec, which is the only reason it was noticed.
- **`pnpm run lint` was never run this session** until CI failed on it. Typecheck, tests and
  prettier were all green. MR-01's lesson, repeated: the failure was in the check nobody was
  watching.
- **Two rollback files were broken and both were found by executing them** — MR-11's
  clinic-address refusal, and this session's own `not_met` down file, which ran two
  `pg_get_functiondef` outputs together without a separating semicolon.
- **`TZ` is honoured for `UTC` and silently ignored for named zones** by Node on this
  Windows machine — `America/Denver` and `Pacific/Honolulu` both returned IST.

#### Counts, per workspace AND per runner

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   378    25
@fieldforce/ui         jest     226    20        @fieldforce/field     jest      72    12
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/api       vitest   597    34
@fieldforce/mock       vitest    40     1        TOTAL                         1402
```

No skips. **47 migrations, 47 rollbacks**, schema empty after `verify:rollbacks`.
`turbo run lint typecheck --force`: 16 of 16.

#### Where this stopped

**After Part D.** Parts E and F were not started.

**E is the read conversion and F is the write conversion**, and neither had begun when the
MR-13 handover prompt arrived and took priority. `pullOnce` still has no caller — verified,
not assumed — and every screen still reads through `createClientForScenario()` to the mock
on `127.0.0.1:4010`.

**The one-line proof that ends Part E is unchanged and unmet:** the Today screen must render
**Asha Deshpande** from Supabase, not **Dr Rohini Kulkarni** from the mock.

Parts A–D took the session because three of the four turned out to be more than one change:
A was three separate CI failures in sequence, B found five dispatchers where the prompt
named three, and D touched a contract, two migrations, four switches, two screens, a lookup
table and twelve test files. Every one of those extra changes was found by something failing
rather than by reading, which is the system working and is also why the parts were not
small.

---

### MR-13 — handover (9 September 2026)

**Done.** Everything is pushed, nothing is local, and the handover is written from the
repository rather than from any previous handover.

The checkout guard passed first — namespace `@fieldforce/core`, remote
`Praverse-Tech-Pvt-Ltd/Elmiron-App`, `f34ceef` an ancestor of HEAD. **Exit 0.**

#### A correction to the brief, stated first

**MR-13 §2 describes `PROMPT-MR-12.md` as unrun. That was true when the brief was written
and was not true by the time it arrived.** MR-12 Parts A, B, C and D were completed and
pushed in the same session; the handover says so in those words, and Parts **E and F** — the
read conversion and the write conversion with the emulator proof — are the work that
remains. The MR-12 section immediately above this one is the record.

#### A1/A2/A3 — pushed, and CI took five runs to settle

Every local commit is pushed. The failures are worth listing because each was a different
cause and only the first was known:

| Run | SHA | Result |
| --- | --- | --- |
| `34326262244` | `2f12a4b` | **FAIL** — `45007`, the seed's wall-clock hour (MR-12 A1) |
| `34326888642` | `6ced440` | **FAIL** — `sync_events_entity_check` violated by the clinic-address rollback |
| `34327705574` | `d632c79` | **SUCCESS** |
| `34329771057` | `17c4119` | **FAIL** — `pnpm run lint`, never run this session |
| `34330426185` | `b874ae4` | **SUCCESS** |

**Last green on the CODE: CI run `34330426185` · workflow `CI` · event `push` · commit
`b874ae45e21bd8ab79ccf979ef0c70d00b3da4a5` — SUCCESS.** That is the commit after which no
source, migration, test or configuration file changed.

**The commits that follow it are documentation only** — this section, the MR-12 section, the
handover, the transcribed decisions and one `gotchas.md` entry. Each was pushed and its own
CI run confirmed green, and the final SHA is HEAD with a clean tree and an empty
`git log @{u}..HEAD`.

A run id cannot be recorded inside the commit that produces it, so the last one is reported
in the session output rather than here. Stating that plainly is better than a number written
before the run it names — which is the shape of claim this whole document exists to avoid.

The `lint` failure is the one worth keeping. Typecheck, tests and prettier were all green
and run repeatedly; `lint` was never run at all until CI ran it. That is MR-01's finding
verbatim — *the failure was in the workspace I was not watching* — and it is the fourth
time a check that was not part of somebody's loop has been the one that failed.

#### A4 — the final numbers, from the tool

```
@fieldforce/core       vitest    21     3        @fieldforce/console   vitest    10     1
@fieldforce/ui         vitest     4     1        @fieldforce/field     vitest   378    25
@fieldforce/ui         jest     226    20        @fieldforce/field     jest      72    12
@fieldforce/ui-tokens  vitest    54     3        @fieldforce/api       vitest   597    34
@fieldforce/mock       vitest    40     1        TOTAL                         1402
```

Seven workspaces, nine runner-workspace pairs (`@fieldforce/ui` and `@fieldforce/field`
each run two). **No skips** — every summary line reads `N passed (N)`.

**47 migrations, 47 rollbacks.** `verify:rollbacks`: *"All rollbacks applied in reverse
order; public schema is empty."* `turbo run lint typecheck --force`: **16 of 16**.
`prettier --check .`: clean apart from the gitignored `apps/console/next-env.d.ts`.

#### B — `docs/HANDOVER-2026-09-08.md`

Written from the tree. Every unverifiable claim is marked **UNVERIFIED** with the thing that
would settle it, and it points at `PROJECT-OVERVIEW.md` and `docs/gotchas.md` rather than
duplicating them — both are append-only and both outrank it. It says of itself that it will
go stale.

**The load-bearing part is §3, the two-column table.** A module can talk to Supabase, be
fully tested, and be called by no screen while the screen beside it talks to the mock. One
column reads as "done" for both halves, and that is how eight sessions concluded this app
writes to Supabase when it does not. **All twelve screens still on fixtures are named.**

Also carried: the known-bad checkout at `C:\Users\devp0\StudioProjects\Elmiron-App` and the
namespace/remote/`f34ceef` test that distinguishes it from a legitimate clone at a new path;
the run instructions **verified by running them today**; the nine gates with the command
that re-checks each; the standing rules; the characteristic defect at fourteen-plus
instances; and what is not in the repository and must be obtained.

#### C1–C6 — transcribed, because they existed only in the review conversation

Into `.ai-collab/decisions.md`, each marked a **REVIEWER** decision:

- **C1 — `admin` is a TENANT administrator, not a platform operator.** Platform access is a
  separate audited break-glass path, out of MR v1. Recorded where the next person will find
  it **before** they relax the `RESTRICTIVE` tenant boundary to widen `admin`, which is the
  tempting wrong change.
- **C2 — `not_met`.** Confirmed present, and its Status corrected: it read *"Decided, NOT YET
  IMPLEMENTED"* and named the wrong part. **Superseded in place rather than edited**, per
  the append-only rule — implemented in MR-12 Part D, commit `ff76f13`, still reversible.
- **C3 — audio is OUT of MR v1, and not for engineering reasons.** Scope §2.4 creates a
  legal AE screening duty; §8.6 requires a named PV/DPDP signatory before the recording
  feature ships, and there is no such person. **Tier 1 automations 1, 4, 5 and 6 all sit
  downstream of the transcript and go with it.**
- **C4 — coaching is OUT of MR v1.** §3.6 unrecorded, and no analyses exist to display.
- **C5 — `BE-W69` / `pg_cron` DECLINED.** Keeping a database awake by poking it treats a
  billing decision as an engineering problem and leaves a cron job whose real purpose is
  invisible to whoever finds it next. The honest fix is paying for the plan.
- **C6 — the eleven human items with owners**, in `docs/blocked-on-you.md`. Including that
  the handset must be a **Xiaomi, Oppo, Vivo or Realme and NOT a Pixel** — those four ROMs
  are the OEM battery killers the app has to survive and a Pixel proves nothing — and that
  the **UCPMP cap has a build-failing deadline of 6 November already wired**, warning from
  16 October.

#### D — the next task

`PROMPT-MR-12.md` **Parts E and F**, recorded in the handover §9 so nobody re-derives it.

> **The one-line proof that ends the read conversion: the Today screen must render Asha
> Deshpande from Supabase, not Dr Rohini Kulkarni from the mock.**

**Where the project is, in three sentences** (handover §10): the backend is substantially
complete and genuinely well-guarded — 47 migrations, RLS forced everywhere, enforcement in
triggers and policies rather than application code, ~1,400 tests that caught several real
defects today. The app is a finished-looking front end that **talks entirely to a mock
server**, so `G-WRITE` is unmet and the largest gap between this repository and a pilot is
wiring, not building. Nothing on the critical path is blocked on engineering: what has not
moved in six weeks is a phone, a $25/month subscription, a licence decision and eight
emails.

#### E — leave nothing behind

- **E1.** Everything pushed.
- **E2.** A fresh bundle of all refs, `git bundle verify`-ed. **It is on the same disk as the
  repository and must be copied off by a human** — see the note in the handover's UNVERIFIED
  table, which is the only reason `G-CI` is *partly* met rather than met.
- **E3.** `git status -sb` clean, `git log @{u}..HEAD` empty.
- **E4 — things known to be true that did not make it into a tracked file: NONE.**

  Two candidates came up during the session and both were written down rather than left
  here. The `TZ` behaviour — Node on this Windows machine honours `TZ=UTC` and **silently
  ignores named zones**, so a test that sets `TZ=America/Denver` and asserts on local time
  passes for the wrong reason — is now a `docs/gotchas.md` entry, because it is a durable
  machine failure and not a fact about this session. The state of the emulator (booted;
  **sign-in and the Today screen not re-confirmed**, because that is E2's work in MR-12 and
  MR-12 E was not started) is recorded in the MR-12 section above.

#### One thing this session did to itself

The `gotchas.md` entry written in MR-12 C3 — *a written lesson is not a control* — applied
to this session's own output twice within the hour:

- The `not_met` rollback ran two `pg_get_functiondef` outputs together with no separating
  semicolon and **would not parse**. Found by `verify:rollbacks` executing it. *A rollback
  file that has never been executed is a claim, not a rollback* — written in the same
  session that then wrote one.
- The `emit_sync_event` guard test seeded its scratch row from `select … from user_profiles
  where role = 'mr' limit 1`. On a database no other suite had seeded, that inserts no row,
  fires no trigger, and **the test passes without exercising the guard.** It failed exactly
  once, alongside another spec, which is the only reason it was noticed. *A guard with no
  positive control is not a guard* — and neither is one whose control can silently skip.

Both are in the record because the pattern is the finding, not the two defects.

---

### MR-14 — the chain finished (10 September 2026)

**Parts A and B. Part C (writes) and Part D (the emulator proof) were NOT started, so
`G-WRITE` is still NOT MET.** The read half of the conversion is done and proved on a real
server; the write half is untouched. See *Where this stopped* at the end.

Session ran across 9–10 September. Base `0103278`, checkout guard exit 0 (namespace
`@fieldforce/core`, remote `Praverse-Tech-Pvt-Ltd/Elmiron-App`, `f34ceef` an ancestor of
HEAD — never verified by path). The pull was a clean fast-forward of 101 commits.

#### A1 — the environment, and a machine failure that is not in `gotchas.md`

**This is not the machine the MR-13 handover describes.** That one is
`C:\Users\Admin\StudioProjects\Elmiron-App` with JDK 17 installed. This one had no JDK at
all, no CMake in the SDK, no `apps/field/android/`, and **no `apps/field/.env`** — which
matters more than it sounds, because `src/config.ts` calls `loadAppConfig` at module load
and throws on a missing value, so the app could not reach its first screen.

**The blocker cost the first session entirely: every Supabase host port was inside a
Windows reserved range.**

```
pnpm db:start
LegacyContainerStartError: exposing port TCP 0.0.0.0:54322
bind: An attempt was made to access a socket in a way forbidden by its access permissions

netsh interface ipv4 show excludedportrange protocol=tcp
     54224       54323      <- 54321 (API), 54322 (Postgres), 54323 (Studio)
     54324       54423      <- 54324 (Mailpit)
```

The message reads like a port conflict and is not one: `netstat` showed **nothing
listening**. WinNAT/HNS had dynamically reserved the whole block. Two things made it worse
than it needed to be:

- **`db:start` reported success while publishing no ports at all.** The first symptom was a
  healthy-looking stack whose `docker ps` showed `5432/tcp` rather than
  `0.0.0.0:54322->5432/tcp`, and a `seed:day` failing with `ECONNREFUSED`. A stack that is
  up and unreachable looks exactly like a stack that is up.
- **Stopping Docker is necessary and not sufficient**, because `hns` re-grabs the range.
  An elevated `netsh int ipv4 add excludedportrange ... store=persistent` is the durable
  fix; the tell that it worked is an asterisk (*administered*) beside the range.

**A reboot cleared it** and the stack then bound the ports before HNS could retake them.
Recorded here because the error text points at permissions and the cause is a reservation,
and because the failure mode — a database that starts, reports its URLs, and is not
reachable — will not announce itself.

Expo Go was used rather than a dev client, by decision: no JDK 17 and no CMake on this
machine, and `gotchas.md` records that the CMake pin costs a day and is lost on every
`expo prebuild`. The handover §2.5 is right that Expo Go works with the current dependency
set. `expo start --android` installed it; the bundle is 1,710 modules.

#### A2 — `pnpm run ci:local`, derived from `ci.yml` rather than duplicated

The last session took five CI runs, one of them failing on `pnpm run lint` — a step never
run locally while typecheck, tests and prettier were green throughout. There was no single
local command covering CI's list.

`scripts/ci-local.mjs` parses `.github/workflows/ci.yml` at run time and executes
`jobs.static.steps[].run` in order; `--with-db` adds the `database` job, `--list` prints the
plan. **Derived, not duplicated** — a hand-kept parallel list has already failed three times
in this repository (`@fieldforce/console` had ten passing cases and no CI line for several
sessions; `ui-tokens` was *"decorative in CI from the day it was written"*; `@fieldforce/ui`'s
221 jest cases were read as 4). It reads the workflow as text, following
`ci-covers-every-suite.spec.ts`, and **adds no dependency**: `yaml` and `js-yaml` exist here
only transitively, so importing one would mean depending on another package's dependency
under `node-linker=hoisted`.

Two positive controls on the derivation itself, because a reader that quietly stopped
understanding `ci.yml` would report that an empty step list all passed — the exact failure
shape the command exists to prevent: fewer than five runnable steps in a job is an error,
and the static job must contain `pnpm run lint` **by name**.

**Proved, not asserted.** With an injected `import { View } from 'react-native'` in
`apps/field` — valid TypeScript, prettier-clean, an eslint error under the
component-extraction guard:

```
[3/12] build       Tasks: 4 successful, 4 total
[4/12] typecheck   Tasks: 9 successful, 9 total
[5/12] lint        flusher.tsx 3:20 error 'View' import from 'react-native' is restricted
FAILED - static . pnpm run lint (exit 1)
```

The first probe was wrong and is worth recording: an `import type` to `import` change is
caught by `tsc` too, because `verbatimModuleSyntax` is on. It was not lint-only, and the
eslint config had to be read rather than guessed at.

**It found a defect on its first run.** `apps/console/next-env.d.ts` is generated by
`next build`, git-ignored, and written CRLF on Windows, while `.prettierrc.json` sets
`endOfLine: "lf"` — so `format:check` could not pass on Windows *after* `build`, while CI on
Linux passed. Nobody had hit it because nobody had run the two in CI's order locally.

#### B — the read conversion

`sync/pull.ts` had been complete, tested and **reached by nothing** for several sessions.
`src/sync/pulled-store.tsx` is the caller it never had (FE-W36). Today, the doctor list and
the doctor profile now read from the store it maintains; `createClientForScenario()` is gone
from all three.

**B3 — the proof.** On the emulator, against `seed:day`, signed in as
`demo-8952e16a-mr@example.test`:

```
Today
Started 06:28
Your list has been rebuilt        <- the completeness notice, on a REAL full re-sync
Next visit  Dr Meera Iyer (DEMO)  Main clinic, Pune  Scheduled 07:30
Today  2 of 3 visits attended

Doctors
Dr Meera Iyer (DEMO)      Urology . Pune . never visited   Overdue
Dr Asha Deshpande (DEMO)  Urology . Pune . today
Dr Vikram Rao (DEMO)      Nephrology . Pune . today
3 doctors in your territory.
```

matching `select ... from public.visits` exactly. The day before, the same screen read
*"Dr Rohini Kulkarni, Sahyadri Clinic, Pune"* from the mock at `:4010`.

**The brief's one-liner needs one correction.** It says Today must render *Asha Deshpande*.
`seed:day` gives Asha a **completed** visit and Meera Iyer the only **planned** one, so the
Next-visit card correctly names Meera; Asha appears in the day's count and on the doctor
list. The seeded names also carry a `(DEMO)` suffix, which `seed-day.mjs` adds on purpose.
The proof is that the screens render this MR's real Supabase day — not that one particular
name lands in one particular card.

**B4 — "not arrived yet" is not "there is none".** `clinicFor()` returned null for both and
the screen rendered both as a missing line. A doctor and their addresses are independent
rows in one cursor-ordered stream, so the window is real. `NextVisit.clinicPending` and
`TodayScreen`'s *"Address still syncing"* make it sayable.

**B5 — a real defect, found by running it.** See the next section.

**B6 — the silence is asserted as well as the message**, in the provider and at the screen.
Both halves were then seen on live data: the notice appeared on the first full re-sync and
was **absent** on the cursored delta that followed.

**B7 — the cursor.** `pullOnce` already handled 45006/45005. What was missing was anything
that would notice if it stopped: deleting `cursors.clear()` passed all twenty cases, because
every one let the retry succeed and a successful pull writes a fresh cursor over the dead
one. The new case drives 45006 on **both** attempts and asserts the cursor is null
afterwards. Without it, a handset that hit an expired cursor at the moment it lost signal
would send the same dead cursor on every launch, for ever, silently.

**B8 — exercised on the real server, not only at the screen.** `update public.doctors set
territory_id = <other territory>` made `doctors_sync_events` write
`reason: out_of_scope, former_territory_id: <the MR's>`. On the next foreground the app
rendered:

> **One of your records moved**
> This is no longer yours. It has moved to another territory.

and the doctor left the list (*"2 doctors in your territory"*). The word "deleted" does not
appear. ADR §6 Q2, end to end, for the first time.

#### B5 — "Today" counted every visit the MR had ever been sent

**Nothing in this app filtered visits by date, and with the mock nothing had to:** the
fixture was a single day, so every visit the client held was today's by construction. The
pull is not. `sync_pull` carries no date filter — read from the live function definition,
not the migration — and the local store accumulates.

Measured on the emulator on 10 September against a store seeded on the 9th:

```
Today
Next visit  Dr Meera Iyer (DEMO)  Main clinic, Pune  Scheduled 07:30
Today  2 of 3 visits attended
```

Every one of those visits was scheduled **2026-09-09**. The MR had nothing at all that day,
and the app was offering to send them to a clinic for a visit that had already happened.
This is the second day of the store's life; it is what a pilot MR would have seen on their
second morning.

The date is compared **as the server wrote it** — `scheduledFor` carries the territory's
offset, not the handset's, the same reason `clockFrom` slices characters instead of parsing
a `Date`. `deviceDay()` builds the local date from local parts rather than
`toISOString().slice(0,10)`, which returns *yesterday* for anyone east of Greenwich in the
early morning. A visit with neither `scheduledFor` nor `startedAt` is **not** claimed for
today: asserting that an undated visit belongs to this day would present an absence as a
fact, which is the rule B4 applies to a clinic address.

After the fix, the same store and the same MR read **"Nothing planned for today · 0 of 0"**,
which is true.

#### B9 — divergences, with verdicts

| # | Divergence | Verdict | What was done |
| --- | --- | --- | --- |
| 1 | The pull sends **rows, not aggregates**: `DoctorRecord` = `Doctor` minus `clinicAddresses`, which arrive as their own entity | **Database right** | Joined on the client in `src/sync/selectors.ts`. No schema change |
| 2 | `sync_pull` emits `visit`, `doctor`, `beat_plan`, `clinic_address` and has **no `beat_plan_entry`**, so `BeatPlanRecord` omits `entries` — while `public.beat_plan_entries` HAS rows | **Contract right — register (proposed BE-W89)** | Nothing faked. See below |
| 3 | `consent_record` is in `sync_pull`'s own `omittedEntities` — a declared phase-2 scope | **Contract right — no action** | Profile built with no consents; `consentLabel(null)` renders **nothing**, never "not asked" |
| 4 | Neither `sync_pull` nor `summariseDay` scoped visits to a day | **Client right to fix** | B5 above |

**Divergence 2 is the one that changed the deliverable.** Two screens could not be converted
honestly, and were not:

- **`app/beat-plan.tsx` stays on the mock.** Converting it would render an empty route as
  fact.
- **The "On plan" chip is removed from the doctor list.** It filters by today's approved
  plan, so with no entries it would have matched nothing and shown **no doctors** — the
  client presenting its own gap as a fact about the day, which is the same failure as
  rendering a denial as an empty list. A test asserts its absence, so adding the entity is a
  change to that test rather than a chip quietly reappearing with nothing behind it.

#### What the existing tests caught

The first draft of the provider gave it a single `refusal` field, so an unreachable server
and a `42501` produced the same words. `doctors-route.test.tsx` has guarded that since FE-W1
under *"separates a transport failure from a denial"*, and it failed. `PullFailure` is a
discriminated union because of that test. **Telling an MR they lack access when their wifi
dropped is how trust in the app dies** — and the test, not the author, is what stopped it.

#### Guards, all mutation-tested two-sided

| Mutation | Caught by |
| --- | --- |
| remove `persistence.save` | *writes what it pulled to disk* |
| keep the cursor when records cannot be restored | *clears the cursor* |
| ignore the restored store | *restores those records* |
| always say "syncing" | *no clinic line when there is none* |
| never say "syncing" | *says the address is still syncing* |
| drop notices on the floor | the notice and `out_of_scope` cases |
| remove the date filter | 3 cases, incl. *does not offer yesterday's visit* |
| date filter drops everything | **13 cases** — the positive control |
| `deviceDay` via `toISOString` | *reads the device's own date* |
| `cursors.clear()` removed | *FORGETS the expired cursor* (added this session) |

#### P1 — the records and the cursor now move together

The cursor was already persisted and the records were not. A restart therefore loaded a
valid cursor over an empty store, `sync_pull` correctly returned only the changes since —
nothing, on a quiet morning — and the MR got a blank day with no error. The server was
right, the client was right, and the day was gone. Records are now written after **every
page**, parsed rather than cast on the way back, and a store that cannot be restored
**clears the cursor** so the next pull is a full sweep.

#### Real versus fixture — TWO columns

| Capability | Module | Screen | Reads/writes |
| --- | --- | --- | --- |
| Today | — | **REAL** — `app/(tabs)/home.tsx` via `usePulledStore()` | **Supabase** (read) |
| Doctor list | — | **REAL** — `app/(tabs)/doctors.tsx` | **Supabase** (read) |
| Doctor profile | — | **REAL** — `app/doctor/[id].tsx` | **Supabase** (read) |
| The pull | **Real and complete** | **CALLED** — `src/sync/pulled-store.tsx` at the root | **Supabase** |
| Beat plan | — | **MOCK** — blocked on B9 #2, not on effort | mock |
| Check-in | **Real** — `src/capture/check-in.ts` | **MOCK** — `app/visit/[id].tsx` | Outbox to **mock** |
| Check-out | **Real** — same module | **MOCK** — same screen | Outbox to **mock** |
| Consent | **Real** — `capture_consent`, all three bounds | **MOCK** — `app/consent/[visitId].tsx` | Outbox to **mock** |
| Samples | **Real** — UCPMP cap by trigger | **MOCK** — `app/samples/[visitId].tsx` | Outbox to **mock** |
| Call report | **Real** — `revise_call_report` | **MOCK, and not queued** — bare `createClientForScenario()` | **Direct to mock** |
| Day end | — | **MOCK** — `app/day-end.tsx` | mock |
| Coaching / analysis | — | **MOCK** — out of v1 (C4) | mock |
| Recording / voice note | Blocked — needs an `uploadGrantId` | Not converted | — |

**Every screen still on fixtures:** `app/(tabs)/coaching.tsx`, `app/analysis/[id].tsx`,
`app/beat-plan.tsx`, `app/day-end.tsx`, `app/mileage.tsx`, `app/reply/[analysisId].tsx`,
`app/visit/[id].tsx`, `app/consent/[visitId].tsx`, `app/samples/[visitId].tsx`,
`app/report/[visitId].tsx`, `app/voice-note/[visitId].tsx`.

#### Counts — by workspace AND runner

`pnpm run ci:local`, all 12 steps, zero skips:

| Workspace | Runner | Files | Cases |
| --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 3 | 21 |
| `@fieldforce/ui-tokens` | vitest | 3 | 54 |
| `@fieldforce/ui` | vitest | 1 | 4 |
| `@fieldforce/ui` | jest | 20 | **231** |
| `@fieldforce/mock` | vitest | 1 | 40 |
| `@fieldforce/field` | vitest | 25 files | — |
| `@fieldforce/field` | jest | 13 | **82** |
| `@fieldforce/console` | vitest | 1 | 10 |
| `@fieldforce/api` | vitest | — | **NOT RUN — the database job. Not green: not run** |

#### Open, unexplained, NOT chased

`ci:local` produced two different sets of failures on two consecutive runs with no code
change (`@fieldforce/ui` 2 failed, then `@fieldforce/field` 6 failed), then went green; both
workspaces pass 100% standalone. A separate, deterministic failure later in the session
turned out to be a stale test fixture and is fixed — **the two are not the same thing, and
the first is still unexplained.** It is a risk to every count this project reports.

#### G-WRITE

**NOT MET.** Unchanged by this session, and it does not move until Part C. Every screen
write still goes to `127.0.0.1:4010`; `grep -rn "createClientForScenario" apps/field/app`
still returns the five write screens. What changed is the READ half.

#### Where this stopped

At the end of Part B, by agreement, before Part C. Carried forward:

- **Part C** — the write conversion. **P3 is a precondition for C5 and C6**:
  `outbox.ts:rejectionCodeFor` collapses every `450xx` to `internal_error` and
  `explanation.ts` reads only `code`, so `45001`, `45004`, `45007` and `45008` cannot reach
  the MR with their own remedy until `sqlState` is carried through the reducer to the
  screen. `refusalForSqlState` already does the mapping and is guarded in both directions by
  `error-contract.spec.ts`; this is why BE-W75 added the field.
- **Part D** — the emulator proof of the five writes, naming check-out explicitly.
- **BE-W89** — `beat_plan_entry` in `sync_pull`, which unblocks the beat-plan screen and the
  "On plan" chip.
- **CI has not run on this work.** The four commits are local and unpushed, because the
  brief gates a push past Part A on review. No CI run id can be recorded here yet, and
  `@fieldforce/api` — the whole Gate 0 RLS suite and the rollback verification — has not been
  run this session.

#### MR-14 — correction: CI has now run

The section above says *"CI has not run on this work"* and *"no CI run id can be recorded
here yet"*, because the commits were still local pending review. That was true when it was
written. The push has since happened and this closes it. Appended rather than edited, per
the append-only rule.

| | |
| --- | --- |
| **Run id** | `34460511926` |
| **Workflow** | `CI` |
| **Event** | `push` |
| **Head SHA** | `a9f4c2cabe03175ac801be75331bc2cc9af08720` |
| **Is that SHA HEAD?** | **Yes** — `git rev-parse HEAD` matches |
| **Conclusion** | `success` |

Both jobs, not one:

```
typecheck . lint . format . unit tests          success
migrations . Gate 0 RLS suite . rollbacks       success
```

**This closes the ninth workspace-runner pair.** The counts table above marks
`@fieldforce/api` as *NOT RUN — not green: not run*, which was honest at the time: a local
run of `pnpm turbo run test --filter @fieldforce/api --force` was started against the local
stack and produced no output after ten minutes, so it was stopped rather than reported. The
`database` job in run `34460511926` ran that same suite on Ubuntu against a fresh stack and
passed, along with `check:decision-debt` and `verify:rollbacks`.

So the position is: eight pairs verified locally by `pnpm run ci:local`, and the ninth
verified by CI on the pushed SHA. Nothing in this session's counts rests on a suite that was
skipped or assumed.

---

### MR-19 — the emulator session (10 September 2026)

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16, Expo Go — not a dev client. See *What this
cannot prove* below.

**Partial. Part A done, one write proved end to end, and a blocker found that stops the
rest.** `G-WRITE` is **NOT MET** — see the verdict at the end, which is now a statement about
a specific defect rather than about missing evidence.

#### A1 — CI

| | |
| --- | --- |
| Run | `34468188701` · workflow `CI` · event `push` |
| SHA | `bb85ab3adc507e459c4f47b6a7773ba106b13557` — **was HEAD at push** |
| Conclusion | `success` — `typecheck · lint · format · unit tests` AND `migrations · Gate 0 RLS suite · rollbacks` |

#### A2 — the environment, and two preconditions nobody had written down

Up on the first attempt: Docker 29.5.3, Supabase HTTP 200, Metro, mock, emulator, all four
`adb reverse` ports. `db:reset` then `seed:day` for one known tenant — the database had
accumulated four demo organisations, because `seed-day.spec.ts` passes `another: true` and the
guard that refuses a second run does not apply to it.

**Two things the app needs that no document mentions**, both found by the check-in doing
nothing at all:

1. **`ACCESS_FINE_LOCATION` must be granted to Expo Go.** `advance()` calls `takeFix()` first
   and returns on a denial. Granted with `adb shell pm grant host.exp.exponent`.
2. **A GPS fix must be set**, `adb emu geo fix 73.8567 18.5204` — longitude first. Without it
   the emulator reports Mountain View, which is outside every seeded geofence.

Also: **the stylus handwriting tutorial intercepts `adb shell input text`** on Android 16 and
swallows it into its own field. `settings put secure stylus_handwriting_enabled 0`.

#### THE BLOCKER — three of four write screens cannot write against real data

**The check-in button did nothing. No error, no message, no busy state, nothing on the wire.**

`app/visit/[id].tsx:196` opens with `if (visit === null || busy) return;`. `visit` is set by
`load()`, which calls **`createClientForScenario()`** — the mock — and looks for
`visits.items.find((candidate) => candidate.id === id)`. The `id` is the route parameter, which
now comes from **Supabase** via the converted Today screen. The mock holds its own fixture
visits with different ids, so `found === null`, so `visit === null`, so the handler returns on
its first line.

Confirmed across all four write screens — every one reads from the mock and keys off the route
id:

| Screen | Reads via | Look-up | Write reachable? |
| --- | --- | --- | --- |
| `app/visit/[id].tsx` | `createClientForScenario()` :61 | `id === route id` :70 | **NO** — `advance()` returns |
| `app/samples/[visitId].tsx` | `createClientForScenario()` :46 | same :48 | **NO** |
| `app/consent/[visitId].tsx` | `createClientForScenario()` :72 | same :83 | **NO** |
| `app/report/[visitId].tsx` | `createClientForScenario()` :38 | same :42 | **YES** — the body takes `visitId` from the ROUTE, not from the loaded visit |

**This is the two-halves defect in its purest form yet.** MR-18 converted the writes and every
unit test passed; the push client is correct; and no MR could check in, hand over a sample or
capture consent. The write was converted and **the read it depends on was not** — and it fails
*silently*, which is worse than an error.

It is also the reason `G-WRITE` is a gate about the APP. A module test could never have caught
this, and neither could a green suite.

#### WHAT WAS PROVED — the first screen write in this project to reach Supabase

The call-report screen writes with a `visitId` taken from the route rather than from the
mock-loaded visit, so its write survives the blocker. Deep-linked to
`exp://127.0.0.1:8081/--/report/<a real Supabase visit id>`, typed a summary, pressed Send:

```
sync_batches                                        1
sync_items      call_report | accepted | no rejection
call_reports    MR19-proof-dosing | draft | manual | received_at 11:06:21
```

and on screen:

> **Report sent** — Your manager sees this next time they open your visits.

**The `sent` branch, correctly** — MR-18 B3's three-way copy resolving to the only one that
claims the server has it, because the server actually did.

**Value checks, not provenance checks** — the MR-14 B3 lesson applied:

| | |
| --- | --- |
| Summary byte-identical to what was typed | `summary = 'MR19-proof-dosing'` → **t** |
| `received_at` in the territory's zone | **16:36:21 IST**, device clock 4:36 PM — exact |
| Status | `draft`, which is what `apply_sync_item` writes for a report with no `supersedesCallReportId` |

That last line is worth keeping: MR-16 B4 recorded `call_reports.status` as *always
`submitted`, `draft` never exercised*. **This is the first `draft` row this repository has ever
produced**, and it arrived from a screen. It also confirms MR-18 B3's reasoning — the copy
makes no claim about status, only about whether the server has it, which is exactly why it is
safe while `draft` remains untested.

#### C5 — the read screens, values checked against the server

Today, against a three-day seed, with the server holding `today (IST) = 2026-09-10`:

| Rendered | Server holds | |
| --- | --- | --- |
| Next visit **Dr Asha Deshpande (DEMO)** | Asha, planned, today | correct |
| **Scheduled 13:00** | `13:00` IST = `07:30` UTC | correct — the MR-14 defect rendered `07:30` |
| **2 of 3** visits attended | 3 visits today, 2 completed | correct |
| **Started 13:52** | `minutesAgo(150)` from the seed at 16:22 | correct |
| Yesterday's Asha 11:00 · tomorrow's Vikram 10:00 | both present in the store | **both correctly excluded** |

The completeness notice appeared on the first full re-sync and was **absent** on the following
delta — B6's silence, on live data.

#### What this cannot prove — EXPO GO

Geofenced check-in and background location (`react-native-background-geolocation`), and audio
(`expo-audio`, already a dependency and working only because nothing invokes it) are native
modules. **Expo Go cannot load them.** `FE-G1` and `FE-G2` cannot close on this setup whatever
else is demonstrated here — they need a dev-client build, which needs JDK 17, `cmake;3.31.6`
and the long-path trap `gotchas.md` prices at a day. The prebuild is now on the critical path
to the device gates rather than beside it.

#### Real versus fixture — TWO columns

| Capability | Module | Screen | Reads / writes |
| --- | --- | --- | --- |
| Today | — | **REAL** — `usePulledStore()` | Supabase (read) |
| Doctor list | — | **REAL** | Supabase (read) |
| Doctor profile | — | **REAL** | Supabase (read) |
| The pull | **Real** | **CALLED** at the root | Supabase |
| Call report | **Real** — `push-client.ts` | **REAL WRITE, MOCK READ** — write proved to Supabase; the doctor name is blank because the read finds nothing | **Supabase (write)** / mock (read) |
| Check-in | **Real** — converted | **BLOCKED** — write converted, unreachable: mock read gates it | — |
| Check-out | **Real** — converted | **BLOCKED** — same | — |
| Consent | **Real** — converted | **BLOCKED** — same | — |
| Samples | **Real** — converted | **BLOCKED** — same | — |
| Beat plan | — | **MOCK** — `BE-W89`, and the "On plan" chip is REMOVED, not absent-by-design | mock |
| Day end · coaching · analysis · mileage · reply | — | **MOCK** | mock |
| Recording / voice note | Blocked — needs an `uploadGrantId` (FE-W29) | Not converted | — |

**Screens still on fixtures for READS:** `app/(tabs)/coaching.tsx`, `app/analysis/[id].tsx`,
`app/beat-plan.tsx`, `app/day-end.tsx`, `app/mileage.tsx`, `app/reply/[analysisId].tsx`,
`app/visit/[id].tsx`, `app/consent/[visitId].tsx`, `app/samples/[visitId].tsx`,
`app/report/[visitId].tsx`, `app/voice-note/[visitId].tsx`.

#### G-WRITE — NOT MET

Stated plainly rather than qualified. The **mechanism** is proved: a screen write reached
Supabase through `sync_push`, was accepted, and rendered the correct copy with correct values.
The **gate** is not met, because four of the five writes cannot be performed at all from a
screen holding real data — their reads are still on the mock and the handlers return before
reaching the client.

The remaining work is now specific rather than open-ended: **convert the reads on
`app/visit/[id].tsx`, `app/samples/[visitId].tsx` and `app/consent/[visitId].tsx` to the pulled
store**, the way Today and the doctor screens were converted, and then run C1's five-write
offline proof.

#### Where this stopped

After the single-write proof and the blocker, before Part C's failure matrix. Not started:

- **C1** — the five-write offline baseline. Blocked by the above for four of the five.
- **C2** — the whole drop-point matrix, including the `am force-stop` kill while `in_flight`.
- **B1–B4** — 45007/45008/45001 on screen, the Allow/Decline emphasis tokens, the UCPMP
  cap-message pair, and 45004 with its numbers. All need a reachable consent and samples
  screen.
- **A3** — the three `gotchas.md` entries from the MR-19 brief.

---

### MR-24 — verification

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16 (SDK 36), Expo Go — not a dev client.
Everything below was done on that setup and nothing here closes a DEVICE gate. FE-G1
(geofenced check-in) and FE-G2 (background location) still cannot close on it: those are
native modules Expo Go cannot load, and the location behind every check-in proved here was
**injected** through Android's test provider, not sensed.

#### A1 — CI

| | |
| --- | --- |
| Run | `34475564284` · workflow `CI` · event `push` |
| SHA | `e410c3dad90193e45c21eec02eec150a28496b61` — **was HEAD at push** |
| Conclusion | `success` — both jobs: `typecheck · lint · format · unit tests`, and `migrations · Gate 0 RLS suite · rollbacks` |

#### A2 — the fiduciary gap, registered as COMPLIANCE

`BE-W93` and `blocked-on-you` **5.13**. Registered, deliberately not implemented. The consent
face tells a doctor *"your rep's employer is the Data Fiduciary for this recording"* — true,
and it identifies nobody. Not weak copy: the identity is not in the system. The JWT carries
`app_role`, `app_territory_id`, `app_is_active`, `email`; `user_profiles` has an
`organisationId` and no organisation NAME; `API_PATHS` has no organisations path. So
`consent/[visitId].tsx:70` hard-codes `organisation = null` and `:158` hard-codes
`firstName = 'your rep'`. Filed as COMPLIANCE because `consent_records` is append-only: every
consent captured before the name exists keeps the anonymous notice as its permanent evidence.
It is the one open item that gets **worse** while it stays open rather than merely staying open.

Also removed the header comment on that route still claiming name and organisation "come from
the token" — MR-23 disproved it ten lines below and the comment survived the session that
falsified it.

#### A3 — who picks the active consent version

**The RPC does.** `fetchActiveNotice(language)` calls `active_consent_text`, which calls
`active_consent_text_at(language, now(), org)`, whose `order by effective_from desc` decides.
The client holds the whole list and deliberately does not choose — that is the FIX-12 defect,
where the record would attest to whichever version the client's list happened to hold.
`capture_consent` re-resolves at `captured_at` and refuses `45001` on disagreement.

Two qualifications, both verified rather than recalled. The **client** picks the LANGUAGE
(`offerableVersions`, arbitrary by admission — 5.12), so it chooses which question is asked
while the server chooses which version answers it. And `displayed_language` is written from
`v_active_then.language`, the version the SERVER resolved, ignoring the client's parameter —
the insert carries the comment *"so a mismatched language cannot be recorded as if it had been
displayed."*

#### B1 — values checked against the server, twice, on two different days

The seed's day rolled from 10 to 11 September mid-session, so the same code was checked against
two different server states. That is stronger than one check.

**10 September.** Today: next visit **Dr Asha Deshpande (DEMO)** (the only `planned` visit that
day); **Scheduled 13:00** against `scheduled_for 13:00 IST` = `07:30Z` — the MR-14 defect
rendered `07:30`; **2 of 3** against 3 visits with 2 `completed`; **Started 13:52** against the
earliest `started_at` (Meera's was 14:52); **Main clinic, Pune** against `12 FC Road, Pune`;
yesterday's and tomorrow's visits both correctly excluded.

**11 September.** Next visit **Dr Vikram Rao (DEMO)**, **Scheduled 10:00**, **0 of 1**, and
**no "Started" line at all** — nothing started that day. The four visits from other days all
excluded. The day boundary moved with the territory, not the device.

Doctors list: **3 doctors**, specialties exact, and the derived "last seen" strings correct —
Asha **yesterday** (her last COMPLETED visit was 09-09; she also had a `planned` one that day,
correctly not counted as seen), Meera and Vikram **today**. No "On plan" chip, as MR-14 B9
removed it rather than let it filter an empty set.

Doctor profile: **Urology · Main clinic, Pune**; *Since your last visit* **yesterday**; *Your
last visits* **9 Sep ✓ 45 min** against `13:52 → 14:37` — exactly 45 minutes. No consent line
at all, which is `BE-W90` behaving as registered: `consentLabel(null)` renders nothing rather
than claiming "not asked".

#### B2 — the displayed version IS what the server recorded

| On screen | Client sent | Server recorded |
| --- | --- | --- |
| `DEMO v1 55ad7cc2` | `consentTextVersionId: e9ff36da…` | `consent_text_version_id = e9ff36da…` |
| `English` | `displayedLanguage: "en-IN"` | `displayed_language = en-IN` (server-derived) |
| `09ce2467` | — | `hash = 09ce2467…` |
| — | `capturedAt: …T05:50:58.897Z` | `captured_at = 05:50:58.897` — **to the millisecond** |

`capture_lag = 216 ms`.

#### B3 — the language default, now actually falsifiable

`seed-day.mjs` seeds **one** language, so on the device the default was deterministic by
accident — the same single-value dimension MR-16 named. A `hi-IN` notice was inserted into the
local database effective **09-09**, making it NEWER than `en-IN` (08-11). The two candidate
rules then disagree: sort-by-language-code gives `en-IN`, sort-by-newest gives `hi-IN`.

The screen defaulted to **English**. The documented rule held, against a dimension that can now
fail. **`seed-day.mjs` still seeds one language** and should not.

#### B4 — Allow and Decline carry equal weight

Measured off the rendered screen, not read off the source:

| Button | Bounds | Size |
| --- | --- | --- |
| "No, don't record" | `[58,1821][1022,1958]` | **964 × 137** |
| "Yes, that's fine" | `[58,2010][1022,2147]` | **964 × 137** |

Identical geometry, and **decline renders first**. Both are `variant="secondary"` in
`ConsentScreen.tsx`. "Give the phone back" is a `Pressable` in the muted tone — not an answer,
and correctly not styled as one.

#### B6 — SEVEN defects, each hidden behind the one in front of it

Not one. Each became visible only when the one before it was fixed, and **not one was findable
by a test as written**. Full evidence in the commits; the shape is what matters.

| # | Where | What | Verdict |
| --- | --- | --- | --- |
| 1 | server | `is_within_shift` added grace to a Postgres `time`, which **wraps**: `23:59 + 30min = 00:29`. The predicate became `>= 03:30 AND <= 00:29` — satisfiable by **no time of day**. Every check-in and check-out refused, all day. `seed-day.mjs` seeds exactly `23:59/30` | **fixed** — `20260911000100` |
| 2 | client | `sendOrQueue` classified refusals by `ApiRequestError`; the writes throw `SyncPushRefusal`. Refusals were shown as *"Saved on this phone… when you have signal"* **and re-queued** — what that function's own comment forbids | **fixed** |
| 3 | server | `apply_sync_item` read coordinates FLAT; the contract nests them. Check-in had **never** worked from a real client body | **fixed** — `20260911000200` |
| 4 | server | `record_check_in` never touched `visits`. `in_progress` and `started_at` were written by nothing — and `stageOf()` returns `'during'` only for `in_progress`, so **check-out was unreachable from the app** | **fixed** — `20260911000300` |
| 5 | client | The visit screen rendered `Checked in 05:45` for an `11:15:34 IST` check-in — the MR-14 five-and-a-half-hour defect, in a screen converted *after* MR-14 documented the trap | **fixed** |
| 6 | client | The samples screen dates a visit by `visits.received_at` — when the ROW ARRIVED. It headed a visit scheduled 11 Sep as **"· 10 Sep"** | **registered** |
| 7 | server | **A doctor's withdrawal of consent was silently discarded.** The doctor declined; the server said `accepted`; `consent_records` still held one row saying `consented` | **fixed** — `20260911000400` |

Defect 7 is the one to read twice. `push-client.ts` sends `entityId: body.visitId` and says
why — *"so everything waiting on one visit groups together ON THE QUEUE SCREEN"*, a display
key. `apply_sync_item` used it as each record's **primary key**, and `capture_consent` opens
with `where c.id = p_id; if found then return v_existing`. Every clinical row for a visit
shared the visit's id, so per visit there could be one consent record, one call report, one
samples row — while `is_withdrawal`, `supersedes_consent_record_id`,
`supersedes_call_report_id` and the samples screen's "Add another item" all exist for the
opposite.

**What made three of them possible.** `gate1.spec.ts` — the suite whose header says it runs
"the same path a real device uses" — hand-built five flat, id-less payload literals to match
`apply_sync_item`. The test and the function agreed with each other and neither agreed with
the product. Corrected across five spec files; `gotchas.md` carries the rule.

**Two corrections to things earlier sessions called correct.** Today's "Started HH:MM" was
verified by MR-19 and by MR-24's own B1 against SEEDED `started_at`; until defect 4 was fixed
that line was unreachable through real use. And MR-19's gotcha that `adb emu geo fix` sets a
usable fix was never validated end to end — it returns `OK` while delivering nothing.

#### C1 — the five writes, from real screens, against live Supabase

One visit (`fca2d102`, Dr Vikram Rao), one sitting, each accepted **exactly once**:

```
check_in         accepted   11:15:35 IST
consent_record   accepted   11:20:59
sample_and_input accepted   11:24:40
check_out        accepted   11:25:31      <- as check_out, NOT check_in
call_report      accepted   11:29:09
```

`visits`: `planned -> in_progress (started 11:15:34.894) -> completed (11:25:31)`.

Check-out is named explicitly because MR-14 D1 asked for it: it is the event that was once
replayed as a check-in, and it arrived as `check_out` with its own row —
`18.5204/73.8567, accuracy_metres 12, geofence inside, source manual, 11:25:31.155 IST`.

Values, not provenance:

| Entered | Server row |
| --- | --- |
| `Elmiron 100mg MR24`, Sample — product, 2 packs, ₹250 | `item_name` byte-identical, `kind sample`, `quantity 2`, `declared_value_inr 250.00` |
| samples tap at `05:54:39.959Z` | `occurred_at 11:24:39.864 IST` (= `05:54:39.864Z`) |
| report: summary / objection / next step | `MR24 dosing discussed with Dr Rao` / `Asked about price` / `Send leaflet Monday`, status `draft` |
| consent tap at `05:50:58.993Z` | `captured_at 05:50:58.897` — **millisecond-exact through the push** |

#### C4 — refusals reaching the MR, observed

**45003 `outside_shift_window`**, on the queue screen, with the server's own detail and the
remedy from `explanation.ts`:

> **Refused — check_in** · *"check-in at 2026-09-11 05:25:13.186+00 is outside the configured
> shift window for territory f4306092…"* · **"This was recorded outside your territory's
> working hours. If the hours are wrong, your manager can change them."**

**UCPMP, the unconfigured side**, rendered on the samples screen while
`ucpmp_sample_cap_quantity` is null:

> *"This app does not count your samples against the UCPMP cap — nothing in it has been given
> your limit or your month to date. Keep your own count, and check with your manager before you
> go near it."*

**The configured side (45004 with real numbers) was NOT exercised.** The cap is null, and
`blocked-on-you` **5.9** says not to invent a value. Setting a local one to fire the guard would
have proved the guard and said nothing about the product, so it is named as not done rather
than dressed up.

#### D1 — G-WRITE: **NOT MET**

Stated plainly. The **mechanism** is now proved in a way it never has been: all five writes
performed from real screens against live Supabase, accepted exactly once, values correct to the
millisecond, with a refusal reaching the MR carrying its own remedy. Before this session **no
write had ever been performed from a converted screen**, and three of the five were impossible.

It is not met, because the gate is about the app in use, and:

- **C2 was not run** — the offline → restart → reconnect cycle. Every write above was made
  online. The exactly-once claim rests on `sync_items` and on one accepted verdict per entity,
  not on a queue that was cut off and reconnected.
- `captured_at` was proved millisecond-exact **through the push**, not **through the queue**,
  which is what C3 actually asks.
- 45007, 45008, 45001 and 45004 were not driven from the screens.
- Defect 6 is unfixed and `report/[visitId].tsx` is still on the mock for reads.
- FE-G1 and FE-G2 remain unfakeable on Expo Go.

The remaining work is specific rather than open-ended, which it was not at the start of this
session.

#### D3 — real versus fixture

| Capability | Module | Screen | Reads / writes |
| --- | --- | --- | --- |
| Today | — | **REAL** — `usePulledStore()` | Supabase (read) |
| Doctor list · doctor profile | — | **REAL** | Supabase (read) |
| The pull | **Real** | **CALLED** at the root | Supabase |
| Check-in | **Real** | **REAL WRITE, REAL READ** | **Supabase** |
| Check-out | **Real** | **REAL WRITE, REAL READ** | **Supabase** |
| Consent | **Real** | **REAL WRITE, REAL READ** | **Supabase** |
| Samples | **Real** | **REAL WRITE, REAL READ** | **Supabase** |
| Call report | **Real** | **REAL WRITE, MOCK READ** — `report/[visitId].tsx:38` still `createClientForScenario()`; the doctor name renders as an empty `"This visit · "` | **Supabase (write)** / mock (read) |
| Recording | — | `visit/[id].tsx:181` still writes `createRecording` to the mock; blocked anyway by FE-W29 and Expo Go | mock |
| Beat plan | — | **MOCK** — `BE-W89` | mock |
| Day end · coaching · analysis · mileage · reply | — | **MOCK** | mock |

Screens still on fixtures for READS: `app/(tabs)/coaching.tsx`, `app/analysis/[id].tsx`,
`app/beat-plan.tsx`, `app/day-end.tsx`, `app/mileage.tsx`, `app/reply/[analysisId].tsx`,
`app/report/[visitId].tsx`, `app/voice-note/[visitId].tsx`.

#### Counts — by workspace AND runner, zero skips

core vitest 21/3 · ui vitest 4/1 · ui jest 233/20 · ui-tokens vitest 54/3 · console vitest 10/1
· field vitest 433/29 · field jest 84/13 · api vitest 613/38 · mock vitest 40/1. **Total 1492.**
No runner reporting zero, no skips. typecheck 9/9, lint 7/7. Every new guard is
mutation-tested two-sided and carries a positive control.

#### Registered, not implemented

`BE-W93` + 5.13 (the fiduciary identity), `BE-W94` (does an out-of-geofence check-in start the
visit — the new `update` deliberately does not consult the geofence, mirroring
`record_check_out`), `BE-W95` + 5.14 (a second consent answer is recorded but does not
SUPERSEDE the first, and nothing marks which is current), and defect 6 (the samples screen
dates a visit by `received_at`).

---

### Gate 1 — its evidence was VOID FOR THE WRITE PATH (11 September 2026)

**A gate correction, not a fixed bug.** The bug is fixed and recorded in MR-24. This section
exists because *"the Gate 1 server half is built and green"* appears in this file (line 21,
14 August 2026) and in the handover, and it did not mean what a reader would take it to mean.
Nothing above is edited; this supersedes it.

#### What the suite claimed

`services/api/tests/gate1.spec.ts` opens:

> This is the server half, decoupled so that when Frontend arrives the gate is a matter of
> RUNNING it rather than building it. Everything below simulates one MR's day entirely
> through the sync path — **the same path a real device uses** — and asserts the properties
> the gate is actually about.

#### What it did

It built its sync items by hand. Five payload literals, none produced by the client's own body
builder, all shaped to satisfy `apply_sync_item`:

```ts
payload: { visitId, latitude: stop.lat, longitude: stop.lon, occurredAt: visitStart }
```

The body the app sends, per `CreateCheckInRequestSchema` in `packages/core` — unchanged since
the schema was written, and what both the REST endpoint and the mock at `:4010` accept — is:

```ts
{ id, visitId, source, occurredAt,
  coordinates: { latitude, longitude, accuracyMetres, capturedAt } }
```

Flat versus nested, and no `id`. **The test and the function agreed with each other and neither
agreed with the product.**

#### What that means for the gate

Gate 1 is *"one territory runs a full simulated day offline and syncs clean: no lost writes, no
duplicates, location capture visibly stops at shift end."* The suite asserted all three against
a payload shape no client has ever sent. So:

- **"No lost writes" was never tested for the real body.** The first real check-in body ever
  sent to this server, on 11 September 2026, was refused: `null value in column "latitude" of
  relation "check_ins" violates not-null constraint`. Check-in and check-out had never worked
  end to end from a real client, through every green run of this suite.
- **"No duplicates" was tested against a shape that could not exhibit the duplicate defect.**
  With no `id` in the payload, row identity fell back to `entityId` — which the client sets to
  the VISIT as a queue-grouping key — so every clinical row for a visit collapsed onto one
  primary key. A doctor's withdrawal of consent was silently discarded and reported as accepted.
- **"Location capture stops at shift end" was tested only on the refusing side**, and the
  accepting side was broken in a way the fixtures could not show: `is_within_shift` added grace
  to a Postgres `time`, which wraps, so a window ending `23:59` with 30 minutes' grace refused
  every capture all day. Every fixture window ended at `19:00` or `10:00`; neither wraps.

The suite's own passes were real. **What they were evidence OF was narrower than the sentence
in the header**, and the gap was exactly the client.

#### Status

**Gate 1's server-half evidence is void for the write path** for every run before
`c515922` (11 September 2026). It is re-established from that commit forward: the payload
literals in `gate1.spec.ts`, `sync.spec.ts`, `manager.spec.ts`, `sync-push-enforcement.spec.ts`
and `visit-not-met.spec.ts` now carry the body's own `id` and nested `coordinates`, and MR-25
Part B binds them to the contract type so a shape change fails at compile time rather than in
production.

The read path, the RLS assertions, the partial-success behaviour and the ordering properties in
that suite are unaffected — those never depended on the write body's shape.

#### The rule this produced

A test that claims device parity must obtain its payload from the real producer, or be typed
against the contract that defines it. Constructing one that happens to satisfy the code under
test proves the two agree with each other and nothing about the product. Recorded in
`docs/gotchas.md`, 11 September 2026 — *"a test that builds its own payload is testing itself"*.

---

### MR-25 — the named gaps

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16 (SDK 36). Every location in every capture
below was **injected** through Android's test provider, not sensed.

#### A1 — pushed, and the first push FAILED

Two runs, and the failing one matters more.

| | First push | After the fix |
| --- | --- | --- |
| Run | `34570735843` | `34571354980` |
| Workflow · event | `CI` · `push` | `CI` · `push` |
| SHA | `35830a5abe0c785f528aad8328316d68270af204` | `ae5bbece5393bd8082582547412da6478249e48b` — **was HEAD** |
| Conclusion | **`failure`** — `migrations · Gate 0 RLS suite · rollbacks` | `success`, both jobs |

**All four MR-24 migrations shipped with no rollback file.** The convention is enforced in CI
and I did not check it, because `verify:rollbacks` empties the schema so I had never run it
locally — my local green was a different check from the one CI runs. That is *"a command that
exits 0 is not a command that worked"* pointed at me: nothing I ran could have told me.

Each rollback restores the definition captured with `pg_get_functiondef` **immediately before**
its migration, obtained by holding the four migrations aside, running `db:reset`, and dumping
the three functions from the resulting schema — not reconstructed from the migration files
believed to have written them (gotchas rule 10). Ordering matters for the two that touch
`apply_sync_item`: rollbacks apply in reverse, so `000400`'s runs first and leaves the function
at its post-`000200` state, and `000400`'s file therefore carries `000200`'s body rather than
the original. Each states what rolling it back MEANS — `000100` reinstates a total capture
outage, `000400` reinstates the silent discard of a doctor's withdrawal of consent.

It was **ten** commits, not nine. `5abe5a2` was also unpushed; my `git log -9` at the end of
MR-24 cut it off and I reported the wrong count.

#### A2 — Gate 1's evidence, recorded as VOID FOR THE WRITE PATH

In its own dated section above this one, because *"the Gate 1 server half is built and green"*
sits at line 21 of this file and could not be edited. Each of the gate's three claims is
addressed separately: "no lost writes" was never tested for the real body; "no duplicates" was
tested against a shape that could not exhibit the duplicate defect; "capture stops at shift
end" was tested only on the refusing side. The read path, RLS, partial-success and ordering
properties in that suite are unaffected — they never depended on the write body's shape.
Evidence re-established from `c515922` forward.

#### A3 — the `adb emu geo fix` entry, corrected where it is read

`docs/fe-w3-spec.md` still told a reader to use it. Its own next line said *"worth confirming
on the device rather than trusting this line"*, and nobody did. The wrong line is kept with the
correction beside it. What works is `appops set 2000 android:mock_location allow` followed by
test-provider injection — and note the argument orders are **opposite**: `geo fix` takes
longitude first, `set-test-provider-location --location` takes latitude first.

#### A4 — BE-W95 linked to defect 7

The split is now stated in the register: the **ID GENERATION** half is fixed and proved on the
device; what a second answer MEANS is the open product question. Closing defect 7 without it
leaves a consent ledger holding contradictory answers and naming neither as current.

#### B — the payload-parity sweep

**B1, searched by shape.** Three searches: the prose claim (*"the same path a real device
uses"* and equivalents), every spec building a `payload:` literal, and every spec calling
`sync_push` or `apply_sync_item`. The union, filtered to the five write entities, is twelve
files.

**B2 — the split is structural, not cosmetic.**

| Suite | Body built | Bound to the contract? |
| --- | --- | --- |
| `apps/field/src/sync/{outbox,push-client,reducer,indicator}.test.ts`, `routes/queue-route.test.tsx`, `packages/ui/src/QueueScreen.test.tsx` | literal annotated `CreateCheckInRequest` etc. | **YES** — never at risk |
| `services/api/tests/{gate1,sync,manager,sync-push-enforcement,visit-not-met,sync-row-identity}.spec.ts` | literal → `JSON.stringify` → `jsonb` | **NO** — `type Item = Record<string, unknown>` |

The field side was never exposed; the type catches drift. **Every API-side suite was
structurally unable to detect a contract change**, which is what let defect 3 live.

**B3.** New `services/api/tests/sync-bodies.ts`: every body annotated with its contract type
**and** parsed through its schema — the annotation catches drift at compile time, the parse
catches it at run time where the type is erased crossing into `jsonb`. The client's builders
live in `apps/field` and a server test importing them would invert the dependency, so these
bind to the SCHEMA, which is the shared artefact. **That limit is stated in the file rather
than glossed: this proves the body matches the CONTRACT, not that the client produces it.**

**B4 — the class is closed, proved three ways.** Renaming
`CreateCheckInRequest.coordinates` to `position`:

- **compile:** `error TS2353: 'coordinates' does not exist in type '{ …position… }'`
- **runtime:** `gate1.spec.ts` **8 failed (8)**, `Invalid input: expected object, received undefined`
- **contrast:** the OLD hand-built `Record<string, unknown>` literal **compiles clean** under
  the same change — the half that shows the fix matters

**Two findings from the sweep itself.** My own search missed `write-path.spec.ts`, which calls
the RPCs with named `p_latitude` parameters and matched neither pattern; it was found by
grepping residual `latitude:` afterwards. *A shape search is only as good as the shapes you
think of.* And that suite is a STALENESS case rather than a drift case: its header claims *"the
whole chain over HTTP"*, and since MR-18 no screen takes the REST `record_check_in` path —
`recordCheckIn`/`recordCheckOut` in `apps/field/src/capture/check-in.ts` have **zero callers**.
Registered rather than deleted; the RPC-level coverage still matters because `apply_sync_item`
calls the same functions.

#### C1 — the time-rendering guard

Scoped to `apps/field/app/**` and it bans the offset-naive **helpers**, not just raw slices.
That is the whole design: defect 5 was not a slice in a screen, it was a screen calling
`clockFrom`. A rule banning `.slice(11, 16)` would have missed it.

Positive control, on `app/visit/[id].tsx`:

| Mutation | Caught by |
| --- | --- |
| `import { clockFrom }` — defect 5 verbatim | `no-restricted-imports` |
| `visit.startedAt.slice(11, 16)` — inlined bypass | `no-restricted-syntax` |
| `new Date(…).toLocaleTimeString()` — device locale | `no-restricted-syntax` |
| the correct `clockIn(iso, zone)` | **clean** |

It fired on nine existing sites, and **two were real, on converted screens**:
`app/samples/[visitId].tsx` (MR-24's defect 6 — two bugs in one expression: `received_at` is
when the ROW ARRIVED, and the slice read the UTC day) and `app/doctor/[id].tsx`, on real data
since MR-14, whose "9 Sep" MR-24's own B1 verified and which was right only by luck — 08:22Z is
the same day in IST and 19:00Z is not. New `dayMonthIn(iso, zone)` beside `dayIn`/`clockIn`,
built on the same `partsIn` so the three cannot disagree; deliberately **not** Intl's
`month: 'short'`, which renders "Sept" while every screen shows "Sep". The six screens still on
the mock keep the helper behind an explicit disable reading **DELETE THIS WHEN THIS SCREEN IS
CONVERTED** — the entitlement was a sentence in a doc comment, which is exactly what failed.

#### C2 — wrapping arithmetic: no other instance exists

Swept the LIVE catalogue, not the migration files. Ten functions use `make_interval`; nine
operate on `timestamptz` or `interval`, confirmed by querying `information_schema` for the
column types rather than by reading the names. **Exactly two columns in the whole public schema
are of a wrapping type** — `territory_shift_windows.shift_start` and `shift_end` — and exactly
one function does arithmetic on them: `is_within_shift`, already fixed.

Added the fixture the dimension needs: a window ending `23:59` with 30 minutes' grace, on
`rival` so no capture test changes, plus a `dimension-coverage.spec.ts` case holding it open.

**The control caught my own test.** The first version queried `territory_shift_windows`
unscoped and PASSED when the wrapping window was mutated away — `seedFixtures` mints fresh ids
every run and tears nothing down, so a window from an earlier run satisfied it. Green and
proving nothing, in a test written for the file whose entire job is catching that. Now scoped
to this run's territory ids, with a precondition assertion that the three rows were found at
all, so a bad id list cannot masquerade as a missing dimension.

#### C3 — the error boundary, enumerated

MR-13 found a refusal treated as a silence; MR-24 defect 2 found a refusal treated as a
transport failure. Two fixes, two spot-checks, and the boundary was still only tested at the
two points that had already failed. Now **seven** types, with the handling of each asserted:
`SyncPushRefusal` rejected, `SyncPushRefusal` dead-lettered, `ApiRequestError`, a transport
`Error`, an `Error` for *"sync_push answered but said nothing about THIS item"*, a `ZodError`
from the response parse (**nobody has got this wrong yet, which is why it is there**), and a
non-`Error` throw. Plus an exhaustiveness case driven off `ServerSyncStatusSchema.options`.

Mutation-verified: treating a `ZodError` as a refusal fails that case; adding a fifth verdict
status fails the exhaustiveness case with *"decide whether the new status is an answer or a
silence"*.

#### D1 — THE OFFLINE CYCLE COULD NOT BE RUN, and why is the finding

**Only 2 of the 5 writes can be performed with no signal, and one of those by accident.**

| Write | Offline | Why |
| --- | --- | --- |
| check-in | **YES** | queues correctly |
| call report | **YES** | *only because it still READS the mock at `:4010`* |
| consent | **NO** | *"Could not load this visit. The app could not reach the server."* |
| samples | **NO** | same |
| check-out | **NO** | **unreachable** — `stageOf()` returns `'during'` only for `in_progress`, which only `record_check_in` writes, SERVER-side |

So the app's offline story stops after the first write, and **FE-G2 — 8h offline, ≥20 queued
writes — cannot be reached, because those writes cannot be made.** Registered as `FE-W38` and
`5.15` rather than fixed: every one of these screens is reading server-confirmed state before
acting, which is this product's founding rule working exactly as designed and producing an app
that cannot work offline. Both resolutions cost something real, and engineering should not pick.

**What did run, with the precondition asserted rather than assumed.** `sync_items` was EMPTY
for the whole offline period, so the offline state was genuine. (Note `adb reverse` runs over
the adb transport, so disabling wifi does **not** cut the app off — the Supabase ports were
removed.) Both queued writes then survived a full app restart and arrived **exactly once, each
as the correct entity type**:

```
check_in     accepted   occurred_at 07:27:42.019Z   lat 18.5204  accuracy 12  inside  manual
call_report  accepted   "MR25 offline report for Asha"   status draft
```

#### D2 — `captured_at` through the QUEUE, not through the push

The check-in was captured offline at **`07:27:42.019Z`** and flushed **seventeen minutes
later** at `07:44:51.171Z` with `occurred_at` unchanged **to the millisecond**.
`visits.started_at` follows it (`12:57:42.019 IST`). `sync_items.client_created_at` is stamped
at flush — a different field with a different meaning, noted rather than conflated.

The consent half of D2 as written could not be run: consent cannot be captured offline at all.

#### D3 — NOT RUN

45007, 45008, 45001 and 45004 were not driven from screens. 45004 additionally needs a cap
value and `blocked-on-you` **5.9** says not to invent one.

#### D4 — FE-G1 and FE-G2 cannot close on Expo Go

Geofenced check-in and background location (`react-native-background-geolocation`) and audio
(`expo-audio`) are native modules Expo Go cannot load. No amount of emulator work closes those
two gates; they need a dev-client build, which needs JDK 17, `cmake;3.31.6` and the long-path
trap `gotchas.md` prices at a day. FE-G2 is now blocked twice over — by the build AND by
`FE-W38`.

#### D5 — G-WRITE: **NOT MET**

D1 could not be completed and D3 did not run. Stated plainly rather than qualified.

#### Two more defects, found by the cycle

| # | What | Status |
| --- | --- | --- |
| 8 | A report saved with no signal was headed **"Report sent"**. `CallReportScreen` hardcoded the title under a caller-supplied detail, so the queued branch could only change half the banner. MR-18 B3 rewrote this screen's copy for exactly this reason, fixed the detail, and nobody re-read the title | **fixed**, 4 cases, mutation-verified |
| 9 | After the offline restart, Today read **"The server refused this sync ()"**. `pullOnce` returned `refused` for every error, and `refusalForSqlState(undefined)` answers `sqlState: ''` — the absence of a code printed as if it were one. MR-24's defect 2 mirrored onto the read path. `PullFailure`'s `unreachable` variant had been rendered correctly by the screens since MR-14 and emitted by nothing | **fixed**, 3 cases, mutation-verified two-sided |

#### Counts — by workspace AND runner, zero skips

core vitest 21/3 · ui vitest 4/1 · ui jest 237/21 · ui-tokens vitest 54/3 · console vitest 10/1
· field vitest 448/29 · field jest 84/13 · api vitest 614/38 · mock vitest 40/1. **Total 1512.**
No runner reporting zero, no skips. typecheck 9/9, lint 7/7, format clean, `verify:rollbacks`
green and run.

#### Where this stopped

After D2, before D3. Not done: 45007/45008/45001/45004 from screens; the full five-write
offline cycle, which `FE-W38` blocks; and `write-path.spec.ts`'s stale parity claim, registered
not fixed.

---

### MR-26 — the offline writes

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16 (SDK 36). Every location below was
**injected** through Android's test provider, verified delivering rather than trusted on its
exit code.

#### A1 — CI

| | |
| --- | --- |
| Run | `34577168896` · workflow `CI` · event `push` |
| SHA | `0c131b11080923102afa01be59f40b43b894ea30` — **is HEAD** |
| Conclusion | `success` — both jobs |

#### A4 — `ci:local` omits the database job DELIBERATELY, and the tool was not the hole

`--with-db` runs it, and that path includes **"Verify every migration can be rolled back"** —
the step MR-25's push failed on. So the command that would have caught four rollback-less
migrations already existed. **Running the default and reading its green as "CI will pass" was
the hole.**

The omission has to stay: the database job needs Docker and `verify:rollbacks` empties the
public schema. What changed is where the warning lives. It was printed with the PLAN, twelve
steps of output earlier, and had scrolled away by the time the green line appeared — *a
warning nobody is looking at when they form the belief is not a warning*. It now prints beside
the word "passed", on stderr, naming the STEPS rather than the job, because "the database job"
is abstract and "Verify every migration can be rolled back" is the one that failed.

**Three controls, and the first was not enough.** A count check passed while every label
printed `undefined` — it asserted the list was non-empty, not that it said anything. Now:
count ≥ 3, every label a non-empty string, and the rollback step present by name; all lifted
above the `--list` early return so the fast path exercises them. Mutation-verified — blanking
the labels and renaming the step in `ci.yml` each fail with their own message, and `--with-db`
stays correctly silent.

#### A2 / A3 — two record corrections

**`FE-W38` re-filed as ENGINEERING.** It was filed Client/Operator on a framing that does not
survive inspection, and the framing was mine. *"Never display what the server has not
confirmed"* is a rule about **asserting facts**. It is not a rule about **gating actions on a
live round trip**. The pulled store exists so the client can hold server-confirmed state and
act on it offline. A screen that refuses to act because it cannot reach the server *right now*
is not obeying the honesty rule — it is missing the store. The one genuinely open question is
split out as **`FE-W39`**: what an MR SEES when acting on unconfirmed state.

**`BE-W93` raised to the top of `blocked-on-you`**, with its cost curve attached:
`consent_records` is append-only, so every consent captured before the fiduciary name exists is
**permanently defective and cannot be amended by design**. The property that protects the
ledger prevents repair. Every other item on that list waits; this one compounds.

#### B1 — the consent notice joins the pull

- `consent_text_versions` gains `updated_at` + `set_updated_at`. `created_at` would not do:
  the table is immutable except for `effective_until`, so the one permitted UPDATE is
  **retirement** — exactly the change a client must learn about, and exactly the one a
  `created_at` cursor would never send.
- The new `sync_pull` arm carries **no predicate**, like the doctor and clinic_address arms,
  because `sync_pull` is SECURITY INVOKER and BE-W79's RESTRICTIVE policy scopes it. Verified
  as `authenticated`: **1 notice returned — this tenant's — not the 31** that exist across all
  accumulated test organisations.
- **MR-12 Q4 is not reopened.** `consent_record` stays in `c_omitted` for the reason it gave.
  A text VERSION is two rows a tenant; a RECORD is ~3,000 audit rows a day for reinstall-only
  value.
- **FIX-02 is untouched.** `activeNoticeFor` mirrors `active_consent_text_at` exactly,
  tiebreakers included — `effective_from desc, created_at desc, id desc`. `offerableVersions`
  sorts on `effectiveFrom` alone, which is enough for a display order and **not** enough to
  agree with the server when two notices share an `effective_from`; a disagreement there does
  not fail in a test, it fails as a 45001 refusal in front of a doctor. `capture_consent` still
  re-resolves at `captured_at`. The arbiter has not moved — only the round trip has gone.

The existing `sync-pull-contract.spec.ts` caught the enum being left behind within seconds,
exactly as its own comment claims it would: six cases red, then green.

#### B3 — diagnosed before fixing, and it was not a live read

The samples screen has read from the pulled store since MR-21 and makes no network call. The
*"Could not load this visit"* banner was keyed on **`pullFailure` alone**, so a failure in a
**separate, concurrent** operation — the background pull — blocked a screen holding everything
it needed. With the visit in hand the data is STALE, not absent, and refusing to act asserted
something false in the other direction.

**One diagnosis, three screens.** The same defect was in consent and in Today. Consent
additionally had the genuine live read, which is B1 — so the answer to "does one fix cover
both" is *partly*, and the difference is stated rather than smoothed. `not_permitted` stays
unconditional everywhere: that is a server DECISION about access, not a silence, and an MR who
has lost a visit must be told even over a cached copy.

#### B2 / B5 — check-out, and the copy that keeps it honest

`witnessedStage` applies MR-02's constraint — *re-derive facts the server owns, record facts
the client witnessed*. A queued check-in is not a guess: this device watched itself write a
durable row. Check-out wins over check-in; a server-closed visit is never re-opened from the
queue; a queued row for another visit changes nothing.

The honesty rule is satisfied **in the copy**, not bent. `STAGE_WORDS_PENDING` says
**"Checked in — waiting to send"**, never "You are checked in" — different SENTENCES rather
than a badge, because a badge is easy to miss and the claim lives in the sentence.
Mutation-tested both ways: borrowing the confirmed words fails two cases, hedging everything
fails two others.

#### B4 — THE FULL CYCLE, and it runs

Offline by removing the Supabase ports, not by disabling wifi — `adb reverse` runs over the
adb transport, so wifi alone cuts nothing.

**Precondition, asserted not assumed:** `sync_items` for the target visit was EMPTY throughout
the offline window and the visit was still `planned`.

All five writes performed from their screens with no signal — the thing that was impossible at
the start of this session:

```
check_in         08:38:44.523Z   "Checked in — waiting to send"
consent_record   08:39:43.814Z   declined, en-IN, notice served from the pull
sample_and_input 08:41:26.366Z   Elmiron 100mg MR26offline, qty 2, ₹300
check_out        08:42:09.977Z   "Visit finished — waiting to send"
call_report      08:43:54Z       "Report saved"
```

App force-stopped and relaunched **still offline**; all five survived. Reconnected; all five
arrived within two seconds, **exactly once, each as the correct entity type** — `check_out` as
`check_out`, the event MR-08 found replayed as an arrival.

| Write | captured (UTC) | received (UTC) | held in the queue |
| --- | --- | --- | --- |
| `check_in` | 08:38:44.523 | 08:49:47.812 | **11m 03s** |
| `consent_record` | 08:39:43.814 | 08:49:47.968 | **10m 04s** |
| `sample_and_input` | 08:41:26.366 | 08:49:48.296 | **8m 22s** |
| `check_out` | 08:42:09.977 | 08:49:48.296 | **7m 38s** |

**That gap is the D2 proof**: restamping at flush would make `occurred_at` equal
`received_at`, and it does not. The server records `capture_lag = 00:10:04.154399` on the
consent row. Visit lifecycle `planned → in_progress (14:08:44.523 IST) → completed
(14:12:09.977 IST)`.

**Four accepted, one refused — correctly.** `call_reports_one_per_visit_version` rejected the
report because this visit already had one, from MR-25, which the **append-only rule would not
let me delete** earlier in this session. The constraint working, and the refusal reached the
MR: the queue screen shows *"Refused — call_report"*.

#### Two more copy defects, both the shape MR-25's defect 8 had

| # | What | Status |
| --- | --- | --- |
| 10 | Checking out with no signal said **"This check-in cannot be sent yet"** — the title hardcoded while the detail came from the caller, so the check-out branch could only change half the message. Fixed mid-cycle and re-observed on the device as "This check-out cannot be sent yet" | **fixed** |
| — | Today's banner hid a hydrated day behind a failed refresh — the third instance of B3 | **fixed** |

**A correction to my own fix.** I first claimed the Today change also fixed the COLD START
case. It does not, and must not: `today` comes from the pull's `serverTime`, is not persisted,
and MR-15 A2 forbids taking the day from the handset. With no server clock the app genuinely
does not know what day it is, and the banner correctly still fires. Registered as **`FE-W40`**
rather than papered over.

#### C — the read boundary, enumerated

MR-25 C3 enumerated seven error types on the WRITE boundary. Defect 9 was the same class on
the READ boundary, found separately by running the app — **the write-side enumeration did not
generalise on its own**, which is the argument for doing this one explicitly.

Eight cases: a mapped SQLSTATE; an **unmapped** SQLSTATE (still a verdict — a decision the app
cannot interpret is a decision); the three spellings of absent — **missing, `null`, and empty
string**, because the screen interpolates all three into the same empty parentheses; a response
the contract cannot parse; an upsert with a null payload; and the positive control that a good
response still returns `pulled`. Plus an exhaustiveness case over the outcome kinds.

Mutation-verified: making every error a refusal (defect 9 restored) fails **5**; making every
error a silence fails **6**.

> The unmapped-SQLSTATE case failed on first run because `23505` **is** mapped — to
> `already_exists`. The assertion caught the test author, which is the point of writing it as
> an assertion rather than an assumption. It now uses `53300`.

#### D1 — DELETED the dead half, KEPT and corrected the live one

`recordCheckIn` / `recordCheckOut` in `apps/field/src/capture/check-in.ts` had **zero
callers** — **deleted**, with their six tests. A module with no callers is not a client half.

`write-path.spec.ts` is **kept**, and its header corrected. The stale part was the CLAIM —
*"the whole chain over HTTP"*, when since MR-18 no screen takes that route. What it tests is
not dead: `record_check_in` is what `apply_sync_item` calls; `daily_mileage` is called by the
app today; and its RLS refusals are the tenant boundary asserted over HTTP with a real token
through Kong, which nothing else does. The header now says what it does prove and, explicitly,
what it does not — so nobody infers the old claim again.

#### E — NOT RUN

45007, 45008, 45001 and 45004 were not driven from screens. 45004 additionally needs a cap
value; `blocked-on-you` **5.9** says not to invent one, and whether a test-only threshold is
admissible was not settled.

#### The state of the two gates, plainly

**`G-WRITE`: NOT MET.** All five writes now work from real screens both online (MR-24) and
offline (B4 above), exactly once, with timestamps preserved through the queue and refusals
reaching the MR. What is missing is **E**: 45007, 45008, 45001 and 45004 driven from screens,
each rendering its own remedy and never another's. That is the whole of the remaining list.

**`FE-G2`: NOT MET, and now blocked by ONE thing rather than two.** `FE-W38` is closed — an MR
with no signal can perform all five writes, and they survive a restart and arrive exactly once.
The gate itself is *8 hours offline, ≥20 queued writes, then sync*; today's cycle was five
writes over eleven minutes. It still needs a **dev-client build** for the native modules
(`react-native-background-geolocation`, `expo-audio`), which Expo Go cannot load — and
`FE-W40` means an MR who restarts offline sees no day, which an 8-hour test would hit.

#### Counts — by workspace AND runner, zero skips

core vitest 21/3 · ui vitest 4/1 · ui jest 243/21 · ui-tokens vitest 54/3 · console vitest 10/1
· field vitest 458/28 · field jest 85/13 · api vitest 614/38 · mock vitest 40/1. typecheck 9/9,
lint 7/7, format clean.

#### Where this stopped

After Part F, before Part E. Not done: the four refusals from screens. `FE-W39` (what an MR
sees when acting on unconfirmed state) and `FE-W40` (a cold start with no signal) are
registered as decisions, not as work.

---

### MR-27 — the transmitted selection

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16 (SDK 36). Every location was **injected**
through Android's test provider, verified delivering rather than trusted on its exit code.

#### A1 — CI, and the first push failed again

| | First push | After the fix |
| --- | --- | --- |
| Run | `34584093446` — **`failure`** | `34584921359` — `success` |
| SHA | `3ad7c67` | `e2dd4739f2e3446b1b057b84d6c6b38b69c2c10e` — **is HEAD** |

**Not `BE-W92`.** The same rollback failure as MR-25, for MR-26's two migrations — *one session
after I built the control meant to prevent it.* MR-26 A4 made `ci:local` print loudly what it
was skipping, and it worked: I read that warning in MR-26 Part A, added two migrations in Part
B, and pushed. **The warning prints at the END OF A RUN, and the moment that matters is when
somebody ADDS A MIGRATION.** A control that is correct, runs, and is read can still fire at the
wrong time.

The fix moves the half that needs no database: `verify-rollbacks.mjs --files-only` checks the
pairing and stops, and that step now runs in the STATIC job — which means it also runs in the
default `pnpm ci:local`, because `ci-local.mjs` derives its steps from `ci.yml` rather than
duplicating them. Twelve steps became thirteen with no change to `ci-local`. Mutation-verified:
removing a rollback exits 1 and names the file; breaking the reader exits 1 with *"read only 0
migration(s) … fix the reader rather than trusting this run"*.

#### B1 — the selection is transmitted, and the recommendation needed one correction

MR-26 B1 had the client mirror this schema's ordering. Mirroring all three keys was necessary —
the first version sorted on one and would have disagreed with the server on any tie — but it
left **two copies of one rule**, which is what MR-23 refused to create when it declined a
client-side tenant filter. And a disagreement between them does not fail in a test; it fails as
a **`45001` refusal, at capture, with a doctor waiting.**

**A RANK, NOT AN `is_active` FLAG — and this is a correction to the recommendation.**
Transmitting "which one is active" is subtly wrong, because activeness is **time-dependent**
and a pull is a **snapshot**. A notice that becomes active tomorrow because the clock passed
`effective_from` does not change, so its `updated_at` does not move, so it is never re-emitted
— a client holding a transmitted flag would keep offering yesterday's notice with nothing to
correct it. On that axis the client's own evaluation is MORE correct.

The ORDERING carries no clock and is the half the client got wrong. So the split follows what
each side can know: **the server transmits precedence, the client applies the effective
window.**

New view `consent_text_version_precedence` holds the `order by`; `active_consent_text_at` is
rewritten to use it; `sync_pull` joins it and ships `precedence`. **The ordering now exists
exactly once in the schema.** `security_invoker = true` is not optional — without it the view
runs as its owner and BE-W79's RESTRICTIVE boundary would not apply to the pull's join.

Two things found by RUNNING it rather than reading it: the view needed an explicit grant
(*"permission denied for view consent_text_version_precedence"* — it would have failed for
every real client while passing as `postgres`), and Supabase's **default privileges** had
silently handed `anon` three privileges on the new relation. The posture suites caught the
second. Grants are now `authenticated | SELECT` and nothing else.

#### B2 — the consequence, which is the point of the change

**A `45001` now means one thing:** the notice genuinely changed between the pull and the
capture, which is FIX-12 working exactly as designed. While the ordering was mirrored it could
have meant that, or that the two sorts disagreed — and nobody, including the MR holding the
phone, could tell which.

#### B3 — the drift guard, where the risk actually remains

The client can no longer diverge; the view and the RPC still can. `consent-precedence.spec.ts`
asserts they agree with a **tie on each key in turn**. Mutation: re-inlining a one-key
`order by` into the RPC fails **both** tie cases and leaves the no-tie case green — which is
precisely why the original defect was invisible.

#### B4 — proved end to end, on a tie

Constructed so a client re-deriving the order could not have got it right: a second `en-IN`
notice with the SAME `effective_from` and a LATER `created_at`, so the rows differ only on the
server's second key.

```
server ranks   MR27 TIEBREAK WINNER  precedence 1   created 10:32:42
               DEMO v1 902961eb      precedence 2   created 09:32:42
               ...identical effective_from

screen shows   "Notice MR27 TIEBREAK WINNER · English · 88e12937"
recorded       version_label MR27 TIEBREAK WINNER, precedence 1, hash 88e12937
verdict        accepted — NO 45001
```

Two independent paths agreed — the pull's transmitted rank and `capture_consent` re-resolving
through `active_consent_text_at` — because they now read the same view.

#### C1 — the three refusals, and the screen that showed none of them

Driving the first one found **defect 11**: `consent/[visitId].tsx` did
`await sendOrQueue(...)`, **discarded the outcome**, and navigated back whatever the server
said. A doctor answered, `capture_consent` refused it, the app went quiet, and **no record
existed** — with nothing on the queue screen either, because since MR-24 a refusal is not
queued.

`sendOrQueue`'s refused outcome now carries `sqlState`, and `explanation.ts` gains
`remedyForSqlState`, so a screen refused in the moment gets the same MR-facing sentence the
queue screen gets.

Each driven from a screen, against the live server, **each with its own remedy**:

| | forced by | what the MR sees |
| --- | --- | --- |
| **45001** | a newer notice published while the device held a stale store | *"The consent wording changed while you were with the doctor. Open consent again, read the current notice aloud, and ask once more."* |
| **45008** | lag ceiling set to 0 (test-only, reverted) | *"This consent was captured too long ago to be accepted now. Connect and sync sooner after a visit — your manager can tell you the limit for your territory."* |
| **45007** | future tolerance set to −3600 (test-only, reverted) | *"This phone's clock is ahead of the server, so the consent looks like it happened in the future. Turn on automatic date and time in Settings, then send again."* |

The device clock could **not** be moved (`cannot set date: Operation not permitted` — no root
on a production build), so the thresholds were moved instead. `app_thresholds` is append-only,
so every change and every revert is a new row carrying its own note. All three values verified
back afterwards: cap `null`, tolerance `120`, lag `72`.

#### C2 — 45004 fires, and its numbers do not reach the MR

It **can** be driven with a test-only cap, and was: a cap of 1, a sample of 2, refused from the
screen. That does not touch **5.9** — a cap set to prove a refusal is not a product decision —
and the row was reverted with a note saying the ceiling remains unknown.

But this is a finding, not a pass. The refusal renders as *"this would put MR27 UCPMP c over
the UCPMP cap for `83aa5660-470b-4c82-aa90-000b5347cb1c` this month"* — a raw doctor UUID and
**no figures**. The figures exist: `enforce_ucpmp_sample_cap` raises with
`detail = format('cap %s, already given %s, this entry %s, period starting %s', …)`, which
would read *"cap 1, already given 0, this entry 2, period starting 2026-09-01"*. `sync_push`
captures only the exception MESSAGE, so DETAIL and HINT never leave the database. Registered as
**`BE-W97`**, with **`FE-W41`** for the cap note that becomes false the day 5.9 is answered.

#### C3 — cited rather than repeated

`call_reports_one_per_visit_version` reached an MR with its own remedy during MR-26 B4,
unplanned: a real constraint refused a real write from a real screen because the visit already
had a report, and the queue screen showed *"Refused — call_report"*. That is evidence for the
same path and is not re-run here.

#### C4 — `G-WRITE`: **NOT MET**

45001, 45007 and 45008 are done. **45004 is not**: it fires and reaches the MR, and it arrives
without the cap, the month-to-date or the period it was written to carry. The brief's own test
is *"45004 with the cap, month-to-date and period as real numbers"*, and that is not satisfied
by a sentence containing a UUID and no numbers. `BE-W97` is the whole of what remains.

#### D1 — `BE-W92` measured: 0 in 9, and one instrument ruled out

| | |
| --- | --- |
| 3 × full suite, CONCURRENT | 0 deadlocks. **All three failed on something else** — `grants TRUNCATE on nothing in public` seeing rows from a parallel run. Concurrency against one database manufactures cross-run interference rather than reproducing this |
| 5 × full suite, SEQUENTIAL | 0 deadlocks. **619/619 every time** |
| Relation names | **None captured — it did not fire** |

**No mechanism is proposed, per D2.** The log names no relations because there was no deadlock
to log. What this run does establish is narrower and still useful: **concurrency is the wrong
instrument**, and the one MR-26 occurrence remains a single unreproduced event on this machine.
`BE-W92`'s verification order is unchanged and still wants the relation names first.

The four earlier runs that failed did so on the `anon` grant regression described in B1, not on
a deadlock — so the denominator is 9 runs in which a deadlock could have appeared and did not.

#### E1 — `FE-W40`, the staleness decision

Four options, written for a decision and not implemented. **A** render nothing (today's
behaviour — asserts nothing, and is useless exactly when it is opened). **B** fall back to the
device clock (**not recommended**: it is the MR-15 A2 defect behind a condition, and it fails
silently on the phones whose clocks are wrong). **C** the reviewer's lean — persist the last
`serverTime` and render the day with a visible age. **D** as C, with a staleness bound.

The argument against **C**, since it is the one most likely to be adopted unexamined: it is
still the device clock one step removed, because deciding whether the stored day is *today*
needs elapsed time; **and crossing midnight is the common case** — a rep who synced at 18:20
and opens at 07:40 is shown YESTERDAY'S day, correctly labelled and actionably wrong. A label
is not a control, and this project has found true-and-unread copy in every session.

**Engineering recommends D, with the bound at the territory day boundary** — render the
persisted day while the anchor falls on the same territory date, fall back to A once it does
not. It needs no new number: `dayIn(anchor, zone)` versus `dayIn(anchor + elapsed, zone)`,
which `territory-day.ts` already computes. And the thing to write down rather than discover:
**with no server clock, some device-clock dependence is the price of rendering anything at
all.** D buys the least.

#### Counts — by workspace AND runner, zero skips

core vitest 21/3 · ui vitest 4/1 · ui jest 243/21 · ui-tokens vitest 54/3 · console vitest 10/1
· field vitest 458/28 · field jest 87/13 · api vitest 619/39 · mock vitest 40/1. **Total 1536.**
typecheck 9/9, lint 7/7, format clean, `verify:rollbacks` green with all three new files
executing.

#### Where this stopped

After E1, with F1 recorded. `G-WRITE` is one item from met and that item is `BE-W97`. **`FE-G2`
is blocked by the dev-client build and nothing else** — JDK 17, CMake, prebuild, deferred since
MR-14 and now the only thing on the critical path to both device gates.

---

### MR-28 — the last G-WRITE item

**EMULATOR, EXPO GO.** Pixel_10 AVD, Android 16 (SDK 36), signed in as
`demo-167f417d-mr@example.test` — **identified from the sign-in this session performed**, not
inferred from `auth.sessions`, which is how MR-25 queried the wrong MR.

#### A1 — CI

| | First push | After the fix |
| --- | --- | --- |
| Run | `34591537963` — **`failure`** | `34591892548` — `success` |
| SHA | `2966045` | `5c1259830cf79c5b96792f187b2b5dce34fef255` — **was HEAD** |

Two causes, one real. `samples-route.test.tsx` threw *`Right-hand side of 'instanceof' is not
an object`* — the `push-client` mock omitted `SyncPushRefusal`, which is **MR-24's defect 2
committed into a test**, and the fix is `jest.requireActual` so the class stays real. The
other was a one-off `seedFixtures` 500 (*"Database error creating new user"*) that did not
recur; left as a single unexplained occurrence rather than explained.

**A correction to MR-27's record.** I reported field jest as **87 passing**. It was **86
passing and 1 failing** — `test-counts.mjs` counts tests DISCOVERED, not tests PASSED, and I
read its number as the second. That is standing rule 1 broken by the tool built to satisfy it.

#### A2 — which clock the activation window uses: **it was the HANDSET's**

`consent/[visitId].tsx` applied `effectiveFrom`/`effectiveUntil` against
`new Date().toISOString()`, twice. That is the defect MR-15 A2 exists to prevent, one screen
along: a phone running fast displays a notice that is **not yet active**, the doctor answers
it, and `capture_consent` re-resolves at the SERVER's clock and refuses — `45001`, after the
conversation, with nothing the rep can do. A notice scheduled for Monday is the ordinary case.

**It is now `serverTime` from the last pull.** `pulled-store.tsx` exposes it, set from the
same `outcome.serverTime` that already produces `today`, so the day boundary and the consent
window read **one** clock rather than two.

**As that value ages** — a failed pull does NOT clear it, deliberately, and the two directions
are not symmetric:

| | what happens | why it is acceptable |
| --- | --- | --- |
| A notice becomes active after the last pull | stays **withheld** until a pull succeeds | the safe direction: nothing false is shown |
| A notice is retired after the last pull | still offered | `capture_consent` re-resolves and refuses `45001` **with its own remedy** — bounded, not silent |

Clearing it on failure would blank the consent screen on every transient error, which is the
defect MR-26 B3 removed from three screens. **With no server clock at all** — a cold start
that has never completed a pull — the screen declines to decide the window and says the notice
could not be loaded. Falling back to the handset there is `FE-W40` option **B**, refused for
the reason recorded with it.

Five cases, mutation-verified two-sided. **The first version of the WITHHOLDS case passed
against the defect**, because both clocks were behind a hardcoded `2099` date; its
`effectiveFrom` is now computed from the device's own now, so the two clocks disagree whatever
day the suite runs on.

#### B — `BE-W97`: the figures reach the MR, and it was a CLASS

`sync_push` called `get stacked diagnostics` for `RETURNED_SQLSTATE` and `MESSAGE_TEXT` and
nothing else. **Fifteen** `raise ... using detail = format(...)` sites exist across these
migrations — 45001's *"displayed %s, active at %s was %s"*, 45007's *"captured_at %s is after
the server clock %s"*, 45008's *"captured %s ago, the maximum is %s hours"* — every one
written to tell somebody a number, every one dying in that handler. Special-casing 45004 would
have left fourteen and put a second copy of the cap rule in the transport.

**Verbatim, never parsed.** `sqlDetail` and `sqlHint` are rendered as the raise site wrote
them; deciding is `sqlState`'s job, guarded both ways by `error-contract.spec.ts`. The
tempting alternative — emit the figures as JSON so the client composes its own sentence — is
refused in the migration header: all fifteen sites use prose `format()`, so JSON would be a
convention of one, and a client parsing server prose is what FIX-06 minted 45002/45003 to
remove.

**The second half, in its own migration so the two can be told apart:** the 45004 sentence
names the doctor instead of their UUID. The lookup runs only in the branch that refuses, so
the unconfigured-cap path — every territory today — takes no extra query.

**Driven from the samples screen, against the live server.** Global cap of 1 (test-only, note
attached), Elmiron, 2 packs, ₹300. What the MR read:

```
This would go past the UCPMP limit for this doctor this month.
Do not hand anything else over — speak to your manager first.

Figures from the server: cap 1, already given 0, this entry 2,
period starting 2026-09-01.
```

The server's own sentence, read back from `sync_items`:
*"this would put Elmiron over the UCPMP cap for **Dr Asha Deshpande (DEMO)** this month"* — no
UUID. `samples_and_inputs` held **0 rows**: refused, not written.

**Cap reverted and verified back to null** (append-only, so the revert is a new row with its
own note), then **the positive control**: the same line resubmitted was **accepted** and the
row written. Without that, "it refused" could have been any other reason.

Mutation, three ways against the live database, each failing exactly its own case: dropping
`PG_EXCEPTION_DETAIL` fails the two figures cases and leaves the naming case green; removing
the per-item reset fails only the cross-item leak case; applying `20260911000900`'s rollback
fails only the naming case — which exercised that rollback file for free.

**What still does not reach the MR, recorded rather than papered over:** a dead-letter replay.
`sync_items` stores the message and no SQLSTATE, so that path already answered
`sqlState: null` and now answers `sqlDetail: null` for the same reason. It is the **sixth**
attempt at an item whose first five each carried the figures; closing it means two new columns
nobody asked for.

**`FE-W41`, seen rather than argued.** In the same screenshot as the refusal, the cap note
still reads *"This app does not count your samples against the UCPMP cap — nothing in it has
been given your limit or your month to date."* The server had just told the MR their limit,
their month to date and their period, three lines above. The note becomes false the day 5.9 is
answered, and this is what that looks like.

#### Defect 12 — found by pressing the button, not by reading the code

I pressed **"I am here — check in"**. The server accepted it — `visits.status` → `in_progress`
at `11:33:39Z`, one `accepted` `check_in` in `sync_items`. The screen stayed on **"Not
started"** with the same button under my thumb. So I pressed again, and the server recorded a
**second** accepted `check_in`.

The guard already existed and its own comment says it: *"an MR who presses 'I am here' with no
signal and sees 'Not started' will press it again."* It was wired into the **QUEUED** branch
only. `witnessedStage(visit, queued)` is the store's visit plus the outbox, and a **SENT**
write is on neither — so `refreshQueue()` re-read a queue the write never entered. **The guard
held whenever the server was unreachable and failed whenever it answered**, which is the
common case.

Only the server can say what stage a visit is in (MR-02), so the fix asks it: the sent branch
calls the pulled store's `refresh()`. `no-unnecessary-condition` then failed on
`if (sendResult.kind === 'queued')`, because the other two now return above it — the
exhaustiveness check working, not a nuisance.

#### C — the discarded-outcome sweep

**Four shapes, not one:** a bare `await x()` statement, `void <async call>`, a `.then(` with no
`.catch`, and `sendOrQueue` without its result. Most bare awaits return void and discard
nothing; the uncaught `.then` chains are where the defects were.

| | what it cost | |
| --- | --- | --- |
| **`session.tsx`** | `getSession()` reads AsyncStorage; on a rejection `setReady(true)` never ran and **the app sat on its splash forever**. Not a silent tap — a handset that will not start | **fixed**: treated as signed out, which is safe and true |
| **`queue.tsx` "Try again now"** | the flush itself can reject; no row moved and nothing was said, on the screen somebody opens when they already suspect something is wrong | **fixed**: `QueueScreen` gains `retryFailure` |
| **`takeFix`** | `requestForegroundPermissionsAsync` sat OUTSIDE the try, so `takeFix` could reject, and onboarding's `void takeFix().then(...)` had no catch — "Turn location on" did nothing | **fixed at the ROOT** |
| **`me.tsx` sign out** | `void signOut();` — shared handsets, and "I pressed sign out" is how a phone changes hands | **fixed** |
| **`transparency.tsx` Continue** | a failed AsyncStorage write trapped the MR on the LAST screen of first run | **fixed**: navigation happens either way |

**Registered, not fixed:** the mount-time reads (`loadQueueState` ×3, `hasCompletedFirstRun`
×2, `batteryStepsDone`, `offerableIntents`) and `void saveBatteryStepsDone(next)`, a tick that
may not survive a restart with nothing said.

**Two apparent hits are NOT defects, and the reason was verified rather than read.**
`launchSettings` genuinely cannot reject — it catches `ActivityNotFoundException` by design —
and `visit/[id].tsx`'s recorder chain does have a `.catch`. The second was my shape search's
false positive, from splitting on the wrong closing brace: **a shape search is only as good as
the shapes you think of, and only as good as the parser you fake.**

#### D — `BE-W92` instrumented, and not forced

`log_lock_waits` is on. It names the relation a session waited on — the first thing that
item's verification order asks for and the one thing the single MR-26 deadlock did not leave
behind. It also catches waits that **resolve**, which is the point: a deadlock seen once is a
race lost once, and the same contention is being won silently the rest of the time.

**It was written as a migration and the migration failed:** `permission denied to set
parameter "log_lock_waits"` — a `SUSET` parameter, and the `postgres` role every migration
runs as is not a superuser. It is now a script connecting as `supabase_admin`, wired into
`db:start`, `db:reset` and CI's database job **before** the suites, because `ALTER DATABASE`
applies to sessions opened afterwards.

`deadlock_timeout` is left at its default and `lock-wait-logging.spec.ts` asserts it still is.
Lowering it would fire sooner and read as progress while changing the thing being measured —
MR-27 D1's concurrency mistake one layer down. **No mechanism is proposed and none should be
read in.**

#### E — three rules, in `docs/gotchas.md`

1. **When a fix removes where something was shown, check where it is shown now.** Two
   instances this session, both one branch of a pair fixed and the pair not re-read.
2. **A time-derived property cannot ride a change feed.** `sync_pull` is a cursor over
   `updated_at`; a row travels when it changes. *Active*, *expired*, *due*, *current* are
   computations, not fields. Ordering, identity, text and ownership travel.
3. **A control that runs at session start cannot guard later work.** A control is defined by
   *when it can fire*. If the gap between the action and the next run is "the rest of the
   session", it is documentation.

#### `G-WRITE`: **MET**

All five writes work from real screens, online and offline, exactly once, with timestamps
preserved through the queue. The four refusals each reach the MR with their own remedy and
never another's — 45001, 45007 and 45008 in MR-27 C1, **45004 here with the cap, the
month-to-date, this entry and the period as real numbers, and the doctor by name.** That was
the whole of what remained and it is the brief's own test.

**Two things are true beside it and neither reopens the gate.** A dead-letter REPLAY carries
no figures (sixth attempt; recorded above). And `FE-W41` — the cap note contradicts the server
the moment a cap exists — is a copy defect that becomes live when **5.9** is answered, not a
write path that fails.

**`FE-G2`: NOT MET, blocked by the dev-client build and nothing else.** JDK 17, CMake,
prebuild — deferred since MR-14, still the only thing on the critical path to both device
gates. `FE-W40` still means an MR who cold-starts offline sees no day, which an 8-hour test
would hit.

#### Counts — by workspace AND runner, zero skips

core vitest 21/3 · ui vitest 4/1 · ui jest 243/21 · ui-tokens vitest 54/3 · console vitest
10/1 · field vitest 470/29 · field jest 103/17 · api vitest 626/41 · mock vitest 40/1.
**Total 1571.** typecheck 9/9, lint 7/7, format clean, 56/56 migrations paired.

### MR-29 — the dev-client build

**A REAL ANDROID BUILD, on the Pixel_10 AVD.** Not Expo Go: `com.praversetech.fieldforce`,
a 79 MB debug APK built from `apps/field/android/` by Gradle, installed and driven.

#### A1 — CI

| | |
| --- | --- |
| Run | `34598547854` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `f7a684c569f73a4062039d8af3ac736be015942a` |

**The SHA equals HEAD.** `git rev-parse HEAD` returned the same
`f7a684c569f73a4062039d8af3ac736be015942a`. Six held commits pushed as
`5c12598..f7a684c`; both jobs green — `migrations · Gate 0 RLS suite · rollbacks` and
`typecheck · lint · format · unit tests`. Green first time, so there is no cause to report.

#### A2 — the instrument is on, and it caught something on its first run

`pnpm ci:local --with-db` runs **`[16/20] database · Log lock waits, so a deadlock names its
relations`**, and `tests/lock-wait-logging.spec.ts` passed (2 tests). `db:start` reports
`log_lock_waits=on ... deadlock_timeout 1000ms (default), unchanged`.

**And a real deadlock fired during that very run.** `tenant-boundary-restrictive.spec.ts`
failed on `create policy ... on public.mr07_d2_mirror_<hex>` inside `inRolledBackTransaction`.
The instrument did exactly the job `BE-W92` was written for: it named both relations and both
blocking processes, and `pg_class` resolved them.

It then happened **again** on a later run of an unchanged tree, and **the relations were
different**:

| run | relations named | the other session |
| --- | --- | --- |
| 1 | `auth.users` (16458), `auth.identities` (17258) | `INSERT INTO identities` — the harness creating a GoTrue user |
| 2 | `storage.objects` (17019), `storage.buckets` (17009) | — |

**Two failures in three local runs, and the third passed 626/626.** CI is green on the same
SHA. So it is load-dependent rather than deterministic, and **CI will meet it eventually**.

**That the pair CHANGES is the finding.** It is not one contended pair to be ordered away — it
is DDL, which takes an `AccessExclusiveLock`, running inside a test transaction alongside
whatever Supabase's own services are touching at that moment. A fix that ordered `auth.users`
against `auth.identities` would have cured run 1 and left run 2 exactly as it was. Registered
as **`BE-W99`** with no mechanism proposed, `deadlock_timeout` still untouched, and a
verification that asks for a failure RATE rather than one green run — because a single green
run is precisely what made this look like a one-off the first time.

#### A3 — the device-clock class is closed, and a guard was found switched off

The class has appeared three times: MR-14 **rendered** the device clock as a server time,
MR-15 A2 **computed** the territory day boundary from it, MR-28 A2 **resolved** the consent
activation window with it. MR-25's C1 rule bans offset-naive **formatting** in screens — the
render, not the source — which is why the third walked past it.

The new rule bans the source: zero-argument `new Date()` and `Date.now()` across
`apps/field`. `new Date(iso)` is parsing and is untouched.

**The reviewer's framing is too strong and is not what was built.** "The only legitimate
instant is `serverTime`", applied literally, mints a new defect: an offline capture stamped
with the last pull's clock would claim the time of the **last sync**, possibly hours earlier,
on a compliance record. The repository had already drawn the correct line, in
`src/sync/outbox.ts` — `receivedAt` was `nowIso()` under the comment *"the server answered, so
this is the server's clock by definition"* and was **removed**, because `QueueScreen` rendered
it as *"Server recorded this at ..."*. `clientCreatedAt` in the same file **stayed**. So the
rule implemented is the **deciding / recording split**:

- A **decision** — which day is it, is this notice active, how old is this, which month do I
  request — may never come from the handset.
- A **record of when this device acted** may only come from the handset, because offline is
  the case it exists for, and the server bounds it: `45007` refuses a `captured_at` ahead of
  the server clock, `45008` one too far behind.
- An **elapsed duration** measured between two device reads is the third legitimate case.

**Every site the rule fires on — eleven, with a verdict on each:**

| # | Site | Verdict |
| --- | --- | --- |
| 1 | `app/day-end.tsx:67` — `todayIso(new Date())` | **REAL — the worst.** MR-15 A2 verbatim, and not merely rendered: it is the `fromDate`/`toDate` the screen **asks the server for**, so a phone drifted across the 18:30Z IST midnight pulls the wrong day's mileage and counts the wrong day's visits |
| 2 | `app/mileage.tsx:47` — `monthWindow(new Date())` | **REAL.** Decides which MONTH is requested; on the first or last day of a month a drifted phone shows a claim total that is not the MR's for this period |
| 3 | `app/(tabs)/coaching.tsx:119` — `recentMonths(new Date())` | **REAL.** Picks which months the objection-handling trend covers |
| 4 | `app/(tabs)/doctors.tsx:74` — `Date.now()` | **REAL.** Feeds `daysBetween(lastSeenAt, now)` — the "6 weeks ago" ages, dated against the handset |
| 5 | `app/doctor/[id].tsx:41` — `Date.now()` | **REAL.** Same ages, same fix |
| 6 | `app/consent/[visitId].tsx:225` — `capturedAt` | **ALLOW.** A record. The WINDOW takes `serverTime` (MR-28 A2); this is when the doctor answered, and `serverTime` here would be a new defect |
| 7 | `app/samples/[visitId].tsx:156` — `occurredAt` | **ALLOW.** A record — when the samples were handed over |
| 8 | `app/voice-note/[visitId].tsx:136` — `recordedAt` | **ALLOW.** A record |
| 9 | `app/visit/[id].tsx:158` — `recordingStartedAt` | **ALLOW.** A record. Checked rather than assumed: it is **not** the elapsed case — the DURATION comes from `recorderState.durationMillis`, which the recorder measures monotonically and which never touches this clock |
| 10 | `app/transparency.tsx:58` — `markFirstRunComplete(...)` | **ALLOW.** Verified write-only: `hasCompletedFirstRun` tests the key for `!== null` and nothing anywhere reads the timestamp back |
| 11 | `src/sync/outbox.ts:98` — `nowIso()` → `clientCreatedAt` ×4 | **ALLOW, and the prior art.** "When THIS DEVICE created this row", which nothing else can answer — a queued row has no server clock by definition |

The five real ones are **registered as `FE-W42` and disabled with that id, not half-fixed**.
All five need `serverTime` *and* an answer to what they show when there is none — which is
`FE-W40`'s open question. Fixing them before that decision would pre-empt it in five places.
Tests are exempted in their own config block, and named: a fixture that must make the two
clocks **disagree** has to reach the device clock to do it, which is how MR-28 A2's
withholding case was made to fail against the defect instead of passing against it.

**And the rule could not be added safely, because adding it exposed `FE-W43`.** ESLint flat
config does **not merge** `no-restricted-syntax` or `no-restricted-imports` across blocks — a
later block whose `files` match **replaces** the earlier value. MR-25 C1's `apps/field/app/**`
block set both, so it had silently switched off the component-extraction rule — **both halves**
— for every screen, which is the tree it was written to police.

**Verified, not reasoned:** the identical `import * as RN from 'react-native'` raised **two
errors** in `src/sync/outbox.ts` and **none** in `app/mileage.tsx`. That is MR-28's defect 12
one layer down — a guard wired into one branch protects the branch nobody exercises. Both
lists are now hoisted to module scope and spread into both blocks. No existing violation was
hiding behind it, so closing it cost nothing; it would not have stayed true for long.

Positive controls: the namespace import in a screen went **0 errors → 3**; a `new Date()` and
a `Date.now()` both fail; and `new Date(iso)` on the next line does **not**, which is the
negative control for the parsing carve-out.

#### A4 — the correction to defect 12, stated plainly

**MR-28's defect 12 was NOT an exactly-once failure, and the record must say so.** The second
press generated a **genuinely new request id**, and `sync_items.id` did exactly what it
promises — two different ids are two different writes, which is the contract working, not
failing. The idempotency key was never involved and is not suspect.

The defect was **that the screen did not reflect the first acceptance**: the server had
accepted the check-in, `witnessedStage` read the store plus the outbox, a SENT write is on
neither, and the screen still said "Not started" under the MR's thumb. A reader who takes it
for an exactly-once failure will go looking in `sync_items` and the request-id path and find
nothing wrong there, because nothing is wrong there.

#### B1 — what was actually installed, and two stale premises corrected

**The reviewer's premise is out of date, and the repository's own docs contradict it.** The
brief says the terminal `JAVA_HOME` is JDK 25 and that `gotchas.md` records a newer JDK failing
at CMake. Measured here:

| | Found |
| --- | --- |
| `JAVA_HOME` | **unset**, in both Bash and PowerShell |
| `java` on PATH | **17.0.12** — the version Gradle needs — at `C:\Program Files\Common Files\Oracle\Java\javapath\java.exe` |
| JDK homes | `C:\Program Files\Java\jdk-17`; Android Studio's JBR is 21.0.10 |
| Android SDK | build-tools 36.0.0, platforms android-36.1, platform-tools, emulator, system-images android-36.1 + android-37.1 |
| `cmake`, `ndk`, `cmdline-tools` | **all absent** at the start |
| `LongPathsEnabled` | already `1` |

`docs/frontend-status.md:100` and `:111` record the JDK 25 → 17 problem as **"Resolved,
27 August"**, and `:123` records that a **first native build already succeeded** on this
machine. The lines the brief quotes — `frontend-status.md:287`, `:344` and
`frontend-handoff-2026-09-07.md:70` — are stale **within the same file**.

**Nothing was installed by me, so nothing needed asking.** AGP auto-provisioned
`cmake;3.22.1` and `ndk;27.1.12297006` during the first Gradle run.

**And `gotchas.md`'s CMake entry is stale for this React Native.** Line 1269 says the SDK's
CMake 3.22.1 **cannot** build this app — its bundled `ninja` is capped at `MAX_PATH` — and
prescribes `sdkmanager "cmake;3.31.6"` plus a `build.gradle` pin. **That did not reproduce.**
Every `configureCMakeDebug` / `buildCMakeDebug` task passed on 3.22.1 under RN 0.86.2, which
ships prebuilt native artifacts. Tested rather than obeyed, and worth knowing before somebody
spends an afternoon installing 3.31.6 and re-applying a pin that prebuild erases.

**A second correction, and it is larger than a build detail.**
`react-native-background-geolocation` is **not a dependency of this app**. Location is
`expo-location` alone, it has **no config-plugin entry** in `app.json`, there is no
`expo-task-manager`, and the generated manifest contains **no `ACCESS_BACKGROUND_LOCATION` and
no `FOREGROUND_SERVICE_LOCATION`**. Background location is not built, so it is not something a
dev client unblocks — it is unwritten code. `expo-dev-client` is likewise not a dependency, and
was not needed: `assembleDebug` produces a debug build that loads our own native modules and
talks to Metro, which is the whole of what the gates require.

#### B2 — prebuild and build

`expo prebuild --platform android --no-install` run **from `apps/field`**. Package id is
`com.praversetech.fieldforce` in both `namespace` and `applicationId`; **no
`com.anonymous.elmironapp` anywhere**; `git status` clean afterwards, and `package.json` was
reported `no changes`, so the script-rewrite gotcha did not bite this time. The manifest
carries `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` and `android:scheme="com.praversetech.fieldforce"`.

**The build failed first, and the cause was not what the docs predicted.**
`:app:packageDebug` died with `java.lang.OutOfMemoryError: Java heap space` — Gradle's JVM
heap, not the system memory the OOM gotcha describes. `gradle.properties` sets
`org.gradle.jvmargs=-Xmx2048m` while packaging **four** ABIs. Line 30 of that same file
documents the intended override, so the fix needed **no file edit at all**:

```
./gradlew.bat assembleDebug --no-daemon --max-workers=3 -PreactNativeArchitectures=x86_64
```

`BUILD SUCCESSFUL in 45s`. A command-line flag rather than an edit matters here, because
`apps/field/android/` is gitignored and regenerated — an edit would have to be re-applied after
every prebuild, which is the same trap the CMake pin entry describes.

**The APK is x86_64 only.** That is right for the emulator and **wrong for a handset**: FE-G1
will need a rebuild without that flag, and that rebuild is the one that must survive packaging
four ABIs, so the heap will have to be raised then.

#### B3 — the native modules LOAD, proved by exercising them

**The APK is the new one, checked rather than assumed.** Built 13:55:28, installed 13:59:01
the same day, and `firstInstallTime == lastUpdateTime` — a fresh install, not an update over a
stale package.

**Not a manifest read.** Three kinds of evidence, in increasing strength:

1. **`.so` files loaded from our own APK.** `nativeloader` logged `libhermesvm.so`,
   `libhermestooling.so`, `libworklets.so`, `libexpo-modules-core.so` and `librnscreens.so`,
   each from `base.apk!/lib/x86_64/`, followed by
   `ReactNativeJS: Running "main" with {"fabric":true}`.
2. **`expo-location` exercised.** Pressing check-in raised the real Android runtime permission
   dialog for `Field Force`, and the granted fix reached the server as
   `latitude 18.5204, longitude 73.8567, geofence_status inside`.
3. **`expo-audio` exercised — the module Expo Go cannot load.** A 6-second hold on
   "Hold to record" produced, from Android's audio HAL:
   `MediaRecorderService`, `AudioFlinger`, `AudioRecord: createRecord_l(17): Server adjusted
   notificationFrames from 1024 to 704 for frameCount 2112`, and
   `acquireAudioSessionId() ... for session 153` against **our app's pid**. The session opened
   at 14:08:39 and closed at 14:08:45 — six seconds, matching the hold — and the screen showed
   **00:05** with "Save this note" enabled.

A record session allocated and released by the audio HAL for this process is a native module
running, not a manifest entry.

#### B4 — sign-in, Today, and one write end to end

Signed in as `demo-ac528cfe-mr@example.test` on a freshly reset and seeded day (3 doctors,
5 visits across three days, 3 of them today), through first-run onboarding, to **Today**:
*"2 of 3 visits attended"*, next visit *Dr Asha Deshpande (DEMO), Main clinic, Pune*,
*"Everything sent"*.

**The write.** One press of "I am here — check in" on the planned visit:

```
check_ins   99e71095-fb51-4126-abb6-78130e6bdda3
visit       14c42b1a-ecc0-4499-8ffc-1cd7ffc66798
lat/lng     18.5204 / 73.8567      geofence_status  inside
occurred_at 2026-09-14 08:35:39.762+00
visits.status  planned -> in_progress
```

**MR-28's defect 12 is confirmed fixed on a real build, which is where it was found.** One
press, and the screen changed to *"You are checked in — Checked in 14:05"*. No second press was
needed, and 14:05 IST is the server's `08:35:39Z` — so MR-25 C1's clock fix is right here too.

**Two honest refusals on the way, both correct.** The first press said *"This check-in cannot
be sent yet — the phone could not find your position in time"* rather than inventing a
position; the one-shot test-provider fix had gone stale. And `fused` must be **added** as a
test provider before it can be set — `set-test-provider-location` alone answers *"fused
provider is not a test provider"*, which the environment steps do not mention:

```
adb shell cmd location providers add-test-provider fused
adb shell cmd location providers set-test-provider-enabled fused true
adb shell cmd location providers set-test-provider-location fused --location 18.5204,73.8567
```

Latitude first, and the fix must be re-pushed while the screen is asking.

**And pressing the button found a defect, which is how every defect this month was found.**
With the mock server at `:4010` down, the voice-note screen said:

> **Could not open the microphone**
> fetch failed: java.io.IOException: unexpected end of stream on http://127.0.0.1:4010/...

The microphone was fine. The mount effect was **one** `async` block under **one** `.catch`
titled "Could not open the microphone", and that block did two unrelated things: it opened the
microphone, and it fetched the visit and doctor over the network. Neither half depended on the
other, which is exactly why they could be merged without anyone noticing — and the MR is handed
a remedy for the wrong failure, told to turn on a microphone that is already on while the
server is down. **That is the rule `G-WRITE` closed on the refusal path, one screen along:
every failure reaches the MR with its own remedy and never another's.**

Split into two blocks with two catches; the network half now says *"Could not load this
visit"*. `voice-note-route.test.tsx` is **new** — this screen had no route test at all — with
both directions, because a fix that merely renamed the single title would satisfy one case and
fail the other. Mutation-verified two-sided: restoring the microphone title on the network
catch fails the network case and leaves the positive control green, so the mutation is targeted
rather than a blanket break.

#### B5 — what the emulator can and cannot settle

**Now attemptable, and attempted this session:** a real APK of this app running outside Expo
Go; our own native modules loading and running; the microphone actually opening; the runtime
permission dialogs; sign-in, Today, and a real write reaching Postgres from a built app.

**Still not settleable on an emulator, and a dev client does not change it:**

- **`FE-G1` (`FE-W20`) and `FE-G2` (`FE-W19`) are DEVICE gates by definition.** FE-G1's own
  verification says *"`adb devices` shows a non-emulator serial"*; FE-G2 is an 8-hour offline
  day with ≥20 queued writes on a physical device. No emulator satisfies either, however the
  app is built. What changed is that they can now be **attempted** rather than being blocked on
  a build that did not exist.
- **The per-OEM battery behaviour cannot be emulated at all.** The AVD is a Pixel image running
  near-AOSP power management. What the pilot will actually meet is Xiaomi's MIUI, Oppo's and
  Realme's ColorOS and Vivo's Funtouch — each with its own aggressive process-killer, its own
  autostart whitelist buried somewhere different, and its own habit of killing a foreground
  service that AOSP keeps alive. The onboarding screen *"Stop Android putting this app to
  sleep"* exists for exactly those ROMs and **its instructions cannot be verified on this
  emulator** — it renders and its buttons work, and whether the settings screens it opens
  exist, are named that, or do what the copy claims is unknown until a real handset is in hand.
  `blocked-on-you` 1.5 asks for a Xiaomi, Oppo, Vivo or Realme rather than a Pixel for this
  reason, and it is **seven weeks** open.
- **Background location is not merely untested, it is not built** — see B1. Whatever the
  battery ROMs do to it cannot be measured until there is something to measure.
- **A release build.** This is a debug APK, unsigned for distribution, x86_64 only. Keystore
  custody, the package id and the Transistorsoft licence (`blocked-on-you` 2.1–2.4) are all
  still unanswered, and none of them is an engineering task.

#### C — NOT RUN, and the reason is a size, not a reluctance

`FE-W40` option D is fully specified, including what happens past the bound, and this session
did **not** implement it. Sized concretely before stopping, it is:

- a new pure module resolving an anchor against the territory day boundary —
  `dayIn(anchor, zone)` versus `dayIn(anchor + elapsed, zone)`;
- a persisted anchor (`serverTime`, the device instant it arrived, the zone) that must be
  cleared together with the store, or a cold start renders a day over records that were
  dropped;
- new state on `pulled-store.tsx`, which **every screen reads**;
- a new label on `TodayScreen` in `packages/ui`, because no existing prop carries "as of";
- and the straddling-`18:30Z` two-sided matrix the decision document specifies.

That spans four packages and changes the store every screen depends on. Part B was the
session's stated headline and it landed end to end; beginning a store-wide change on the tail
of it is how the wrong API gets frozen into the thing everything reads. **Stopped honestly at
the boundary rather than finishing it badly**, which is the brief's own rule.

`FE-W42`'s five sites stay blocked behind it, and that is now a visible, registered dependency
rather than an unwritten one.

#### D — two verdicts, decided rather than done

**D1 — the dead-letter replay's missing figures: DEFER, with a named trigger. (`BE-W98`)**
`sync_items` holds `rejection_code` and `rejection_detail` and nothing else, so the sixth
attempt answers `sqlState: null` and `sqlDetail: null` while each of its first five carried the
numbers. The decisive fact is in `explanation.ts:196`:
`action: record.deadLettered || !RETRYABLE.has(record.code) ? 'escalate' : 'retry'` — **for a
dead letter the action is `escalate` whatever the SQLSTATE is.** Figures exist to tell somebody
what to do next; on this path what to do next is already fixed. Beside that, `rejection_detail`
still holds the server's own sentence, which after MR-28 B names the doctor — only the numeric
DETAIL line is absent — and two columns on `sync_items` is a migration against a table that
grows once per sync attempt. **The trigger that reverses this: a manager-facing dead-letter
queue**, where the cap and the month-to-date would change a decision rather than an
explanation. Build the columns with that surface, not before it.

**D2 — `FE-W41` and `5.9` are ONE unit of work.** Recorded as a single item, because splitting
them is exactly how one half ships. The cap note is true **only** while
`ucpmp_sample_cap_quantity` is null; the day 5.9 is answered is the day the sentence becomes
false, and it sits three lines above a refusal quoting the very numbers it denies having.
Shipping the cap without the copy puts a false statement on a compliance screen on the day
somebody starts relying on it; shipping the copy without the cap replaces a true sentence with
numbers that do not exist. **The migration that sets the cap and the change that rewrites the
note are one commit**, and whoever answers 5.9 owns both. `5.9` still build-fails CI on
**6 November**, warning from **16 October**.

#### Counts — by workspace AND runner, read from each runner's own line

Never from `test-counts.mjs`, which counts tests DISCOVERED rather than PASSED.

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed (3 files) |
| `@fieldforce/ui-tokens` | vitest | 54 passed (3 files) |
| `@fieldforce/ui` | vitest | 4 passed (1 file) |
| `@fieldforce/ui` | jest | 243 passed, 243 total (21 suites) |
| `@fieldforce/console` | vitest | 10 passed (1 file) |
| `@fieldforce/mock` | vitest | 40 passed (1 file) |
| `@fieldforce/field` | vitest | 470 passed (29 files) |
| `@fieldforce/field` | jest | **105 passed, 105 total (18 suites)** — was 103 in 17; `voice-note-route.test.tsx` is the new suite |
| `@fieldforce/api` | vitest | 625 passed, **1 failed** (626, 41 files) — the `BE-W99` deadlock, and 626/626 on a clean re-run |

**1,572 passing, zero skipped, one intermittent failure that is registered rather than
hidden.** Typecheck, lint and `format:check` all exit 0 across the monorepo.

#### Where this session stopped

**After Part D, with Part C deliberately not started.** Parts A and B are complete; D's two
verdicts are recorded. C is sized above and is a session of its own.

Three things a reader should carry forward that were not true before:

1. **`FE-G1` and `FE-G2` are now blocked on the handset alone from this side.** The build that
   blocked them exists, runs, loads its native modules and performs a real write. The handset
   is seven weeks outstanding and is not ours to fix.
2. **A rebuild for a real handset is not the same command.** The APK proved here is x86_64
   only; dropping `-PreactNativeArchitectures` restores four ABIs and brings back the
   `packageDebug` heap failure, which will need `org.gradle.jvmargs` raised.
3. **Background location is unwritten, not untested.** Anyone planning FE-G1 around
   `react-native-background-geolocation` should know it is not a dependency of this app.

### MR-30 — FE-W40

**A cold start with no signal now shows the MR their day, labelled with the instant the server
gave it — and shows nothing, with its own reason, once that instant belongs to a previous
territory day.** Both sides driven on the dev-client build, not only in tests.

#### A1 — CI

| | |
| --- | --- |
| Run | `34826160203` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `246f216adc3107cfae84ecfef34c2c403ac06b99` |

**The SHA equals HEAD.** `git rev-parse HEAD` returned the same
`246f216adc3107cfae84ecfef34c2c403ac06b99`. Three held commits pushed as `f7a684c..246f216`;
both jobs green. The `BE-W99` deadlock did not fire in this run, which matters for the rate
recorded under A4.

#### A2 — the blocked list was wrong about WHY two items blocked

`react-native-background-geolocation` **is not a dependency of this app and never has been.**
Location is `expo-location` alone; no config-plugin entry in `app.json`; no
`expo-task-manager`; and the prebuild-generated manifest carries **no
`ACCESS_BACKGROUND_LOCATION` and no `FOREGROUND_SERVICE_LOCATION`**. Background location is
**unwritten code, not untested code.**

| Item | Said | Correct |
| --- | --- | --- |
| **2.4** Transistorsoft release licence, *"Before FE-W8, but check now"* | implied it gates shipping code that exists | **It never blocked existing code.** It blocks a **build-versus-buy decision for work nobody has started** |
| **5.3** *"Transistorsoft licence, or a decision to ship foreground-only check-in"*, blocking *"geofenced check-in, the PRIMARY check-in mechanism"* | implied geofenced check-in is blocked | **Geofenced check-in already works, foreground, with no licence.** MR-29 B4 drove one: `check_ins` `99e71095`, `18.5204 / 73.8567`, **`geofence_status inside`**, `visits.status planned → in_progress`. The licence would buy **passive, background** check-in — a different, unstarted feature |

**The consequence, which is the useful half, and it is now the first thing in
`blocked-on-you.md`'s correction section:**

> **`FE-G1` and `FE-G2` are blocked by the handset ALONE.** Neither needs background location.
> FE-G1 asks only that `adb devices` shows a non-emulator serial; FE-G2 is an offline day then
> sync accepted. The dev-client build that stood in front of both exists and works. **Nothing
> else is between this app and both device gates except a phone.** Seven weeks outstanding.

Item **1.5** is upgraded to cover both gates rather than FE-G1 alone. Item **5.1**'s *"the
handset **and** a dev-client build"* is narrowed to the handset.

#### A3 — the stale-fact sweep, and it was six places rather than three

The brief named `frontend-status.md:287` and `:344`. The sweep found more:

| Location | Claim | Measured 14 September 2026 |
| --- | --- | --- |
| `frontend-status.md:287`, `:344` | *"the terminal `JAVA_HOME` is JDK 25"* | **`JAVA_HOME` is unset** |
| `gotchas.md:1204-1205` | *"the machine here has JDK 25 as the only JDK — Android Studio's JBR is 25 too"* | **No JDK 25 exists on this machine at all.** The only JDK under `C:\\Program Files\\Java` is `jdk-17` (`17.0.12`). The JBR is **21.0.10** |
| `frontend-handoff-2026-09-07.md:70` | *"this machine's terminal `JAVA_HOME` is JDK 25, which fails at CMake"* | as above; `java` on PATH is **17.0.12** |
| `HANDOVER-2026-09-08.md:83-84` | *"Microsoft OpenJDK 17 at `C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot\\` and `JAVA_HOME` is set to it"* | **That path does not exist**, and `JAVA_HOME` is unset. The build works anyway, because 17 is the `java` on PATH |
| `PROJECT-OVERVIEW.md:10087` | the same absent path, plus *"no `java` on PATH at all"* | superseded here; that file is append-only |

**And `frontend-status.md:100` and `:111` had recorded it RESOLVED on 27 August** — before four
of those five were written. One fact, six places, five stale, and the correction that existed
was invisible to anyone who did not happen to read that line first. A reviewer working
faithfully from the documents inherited the stale version and put it in a brief.

**So the rule, now in `gotchas.md`: when you correct a fact, grep for every other mention of
it.** A correction that names one line leaves the rest standing with equal authority, and an
append-only record gives the reader no way to tell which is current. The cost is one `grep -rn`.
The cost of skipping it is a session begun on a false premise, which is what happened.

`gotchas.md:1269`'s *"the SDK's CMake 3.22.1 cannot build this app"* is **corrected, not
deleted** — it did not reproduce under RN 0.86.2, and it was measured and true when written.
Each correction is a dated section naming the lines it replaces.

#### A4 — `BE-W92` and `BE-W99` reconciled, and the measurement refutes the hypothesis

They were never two defects: same suite, same `describe`, same test — *"and with the RESTRICTIVE
policy removed, the same policy widens immediately"* — in every occurrence since MR-26. One
entry now supersedes both by name.

**The measured rate, which is what `BE-W92` was registered waiting for:**

| when | conditions | deadlocks / runs |
| --- | --- | --- |
| MR-27 D1 | 9 × api suite, before the instrument | **0 / 9** |
| MR-29 A2 | api suite alone, clean re-run | **0 / 1** |
| MR-30 A4 | 6 × api suite alone | **1 / 6** |
| MR-29 A2 | **whole monorepo** — `ci:local --with-db`, then `pnpm test` | **2 / 2** |
| MR-29 A1, MR-30 A1 | CI | **0 / 2** |

**api suite alone: 1 in 16. Whole monorepo running: 2 in 2.** The loaded denominator is two and
nothing is concluded from it — but it is the next thing to measure rather than a curiosity.

**The relation names, from the server log as the entry demanded rather than inferred.** Three
local samples, resolved through `pg_class`:

- sample 1 — `auth.users` (16458), `auth.identities` (17258); the other session's statement was
  `INSERT INTO "identities" ...`
- sample 2 — `storage.objects` (17019), `storage.buckets` (17009)
- sample 3 — `auth.users` (16458), `auth.identities` (17258) again

**This refutes the hypothesis the entry was carrying.** `BE-W92` reasoned from the schema that
the mirror's `organisation_id ... references public.organisations` had moved the contention onto
`public.organisations`. **`public.organisations` is OID 17887 and appears in none of the three
samples.** The entry had said, in its own words, that it was *"reasoning from the schema, not a
measurement, and the last two diagnoses of this repo's flakes from plausible reasoning were
wrong."* It was wrong again, and the MR-28 instrument is what showed it.

**A correction to MR-29's own wording.** MR-29 recorded *"different relations each time"*. Three
samples say that is too strong: **two** distinct pairs, not three, with `auth.users` /
`auth.identities` in two of three. The honest statement is *two contended pairs observed, both
Supabase's own service tables, neither of them the FK that was theorised.*

**The hypothesis that now has measurement under it — and is still a hypothesis.** The blocked
session's running statement is `create policy`, which takes an `AccessExclusiveLock`; the
blocking session is inserting a GoTrue user. Postgres names the statement a backend is
*currently running*, not the one that took the lock it holds, and `inRolledBackTransaction` wraps
`seedFixtures`/`asUser`, which touch `auth.users` earlier in the same transaction. The shape is
**DDL inside a long test transaction against concurrent writers to Supabase's service tables**,
which predicts load-dependence and matches the rates. It argues for **serialising the DDL
tests** rather than ordering two named relations — ordering `auth.users` against
`auth.identities` would not have touched sample 2. **Not implemented**; `deadlock_timeout`
remains at its default and `lock-wait-logging.spec.ts` still asserts it.

#### A5 — the flat-config hazard, swept beyond its instance

Enumerated from the **loaded** config rather than read off the source (the command is in
`gotchas.md`). **Only two rules in the repository are set in more than one block** —
`no-restricted-syntax` (three blocks) and `no-restricted-imports` (two) — and both are the ones
MR-29 A3 touched. **Six other option-valued rules are each set in exactly one block**, so no
shadowing is possible for them:
`@typescript-eslint/ban-ts-comment`, `restrict-plus-operands`, `restrict-template-expressions`,
`return-await`, `no-unused-vars`, `import/no-extraneous-dependencies`.

**Verified by exercising, not by reading** — the same three shapes in three glob regions:

| region (winning block) | `import * as RN` | `Date.now()` | `toLocaleTimeString` |
| --- | --- | --- | --- |
| `src/` non-test | **fires** (both rules) | **fires** | — (C1 is screens-only, by design) |
| `app/` screen | **fires** (both rules) | **fires** | **fires** |
| `*.test.ts` | **fires** (both rules) | — (intended exemption) | — |

Each overlapping block intends to replace what it shadows and carries forward what it should.
**One latent hazard, recorded rather than closed:** the test-exemption glob
`apps/field/**/*.test.*` also matches `apps/field/app/**/*.test.*` and comes last. There are no
test files under `apps/field/app/` today, so nothing is shadowed; if one is ever added it will
silently lose MR-25 C1's offset-naive formatting guards.

#### B — `FE-W40`, built

**B1 — proceeding on engineering's recommendation, and why.** No product-owner answer exists;
`blocked-on-you.md:117` registered the question and nothing has answered it. **Option D is the
only one of the four whose parameter is *derived* rather than chosen** — the bound is the
territory day boundary, which `territory-day.ts` already computed — so there is no number to
wait for, which is precisely what makes it safe to proceed on. Option **B** is refused: the
device clock is MR-15 A2's defect behind a condition, named and refused in the decision
document, and since MR-29 A3 a lint failure as well. Option **C** is refused for the reason its
own entry gives: last sync 18:20, app opened 07:40, and the MR is shown yesterday's list —
correctly labelled and still the wrong list.

**B2 — the shape, designed before it was written, because `pulled-store.tsx` is read by every
screen.**

```
DayAnchor { serverTime, receivedAt, timeZone, zoneSource }      persisted, per user
resolveAnchoredDay(anchor, deviceNow) -> current | expired | null   pure
PulledStoreState.dayOrigin: live | anchored{asOf} | expired{asOf} | none
TodayScreen.dayAsOfLabel?: string | null
```

**`today` keeps exactly the meaning it had** — the territory date, from the server's clock — and
that is why `dayOrigin` is a separate field rather than a widening of its type. An anchored day
*is* the server's clock, merely an older reading of it. **Every screen but `home.tsx` reads
`today` and needed no change**; `dayOrigin` is read by `app/(tabs)/home.tsx` and nothing else.
The invariant, asserted: **`today` is non-null if and only if `dayOrigin` is `live` or
`anchored`.**

**The zone is persisted with the anchor, and that is not incidental.** The zone comes from the
server too, so a cold start cannot re-fetch it; reckoning the boundary in UTC instead is a
5h30m error for IST.

**And that nearly shipped as a defect.** `fetchTerritoryZone` **never throws** — offline it
answers `UTC_FALLBACK`, which means *"the server declined to say"*, not *"the territory is
UTC"*. On the exact path this feature exists for, that fallback would have landed on top of the
restored `Asia/Kolkata` and rendered every clock on the screen — including the new "as of"
label — **5h30m wrong. The MR-14 defect inside the fix for `FE-W40`.** A live territory answer
still wins; a fallback no longer does, and a test asserts it.

**B3 — the anchor clears with the store, in the same step.** `persistence.clear` drops both
keys, so the two cannot be separated by a caller who forgets, and `loadPulledStore` calls it
when the records cannot be restored. An anchor outliving its records would render a real DATE
over an empty store — *"0 of 0 visits attended"* presented as the MR's plan, a false statement
assembled from two true ones, and the cursor-ahead-of-records failure in a new place. Asserted
on the content: after a failed restore, `persistence.loadAnchor(USER)` is `null`.

**B4 — the straddling pair, and both sides on the device.** One anchor instant, `17:45:00Z` —
45 minutes before IST midnight — with only the elapsed time differing:

| elapsed | projected | IST | territory day | verdict |
| --- | --- | --- | --- | --- |
| 30 min | `18:15Z` | 23:45 on the 14th | `2026-09-14` | **current** |
| 60 min | `18:45Z` | 00:15 on the 15th | `2026-09-15` | **expired** |

Fifteen minutes short of the boundary and fifteen past it. A pair at 09:00Z and 22:00Z would
pass against an implementation that compared raw UTC dates and never read the zone — the test
asserts that too, as a control for the control: in UTC those same two instants are the **same**
day.

Verified at three levels — pure (`day-anchor.test.ts`, 8 cases), store
(`pulled-store.test.tsx`, 5) and screen (`home-route.test.tsx`, 4) — **and then on the dev
client, both sides:**

| | on the Pixel_10 dev client |
| --- | --- |
| **anchored** | *"Today / **Your day as of 15:02 — not confirmed since** / Started 11:28"*, with the full day beneath it — next visit, "2 of 3 visits attended" |
| **expired** | *"**Could not load your day** / Your last sync was **13 Sep at 23:15**, which was a different day. This app shows a day only once the server has confirmed it."* — and **nothing** rendered |
| **live** | no label at all, which is the positive control: an unconditional label would be noise on every ordinary day |

`23:15` is `17:45Z` read in IST, so the persisted zone is doing its job on the device and not
only in a test. The expired case was driven by **rewriting the on-device anchor through
`run-as`** rather than by waiting for midnight — `adb root` is refused on a production emulator
image, so `date` is unavailable. The technique is in `gotchas.md`.

**B5 — nothing asserts a fact the server did not give.** The age is the honesty. The expired
case explains **itself** rather than borrowing *"the app could not reach the server"*, which is
true and useless to an MR holding a phone full of their own visits.

**B6 — five mutations, each failing EXACTLY one case and leaving the rest green:**

| mutation | fails |
| --- | --- |
| drop the persisted zone, reckon in UTC | 2 of 8 (the expired half of the straddle, and the zone case) |
| unclamp elapsed | 1 of 8 (the backwards-clock case) |
| drop the anchor clear in `loadPulledStore` | 1 of 17 (B3) |
| drop the zone preservation | 1 of 17 |
| ignore the bound — always render the anchored day | 1 of 17 (the expired case) |

Positive controls throughout: a pull that **succeeds** still takes the day from the server and
rewrites the anchor; a **live** day shows no label; an ordinary unreachable server still gets
the generic message, so the expired branch cannot be satisfied by deleting the generic one.

**One find while wiring it.** `home-route.test.tsx`'s store double omitted `today` entirely, so
`today === null` was **false** and `summariseDay` ran on `undefined`. The looseness was
load-bearing — an explicit `null` broke a test that had been green for sessions. The double is
now faithful.

#### C — the two triage verdicts, re-confirmed rather than re-litigated

Unchanged from MR-29 Part D, and deliberately **not** duplicated as new entries: two entries on
one decision is the `BE-W92`/`BE-W99` divergence this session spent A4 undoing.

**C1 — the dead-letter replay's missing figures: DEFER, trigger named (`BE-W98`).**
`explanation.ts:196` makes the action `escalate` for a dead letter **whatever the SQLSTATE is**,
so the figures cannot change what anyone does next. `rejection_detail` still carries the
server's own sentence, which after MR-28 B names the doctor. Revisit when a **manager-facing**
dead-letter queue exists — the first reader for whom the numbers change a decision rather than
an explanation.

**C2 — `FE-W41` and `5.9` are ONE unit of work.** The cap note is true only while
`ucpmp_sample_cap_quantity` is null; the day 5.9 is answered is the day it becomes false, three
lines above a refusal quoting the numbers it denies having. **The migration that sets the cap
and the change that rewrites the note are one commit.** `5.9` build-fails CI on **6 November**,
warning from **16 October**.

#### Counts — by workspace AND runner, from each runner's own line

Never from `test-counts.mjs`, which counts tests DISCOVERED rather than PASSED.

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed (3 files) |
| `@fieldforce/ui-tokens` | vitest | 54 passed (3 files) |
| `@fieldforce/ui` | vitest | 4 passed (1 file) |
| `@fieldforce/ui` | jest | 243 passed, 243 total (21 suites) |
| `@fieldforce/console` | vitest | 10 passed (1 file) |
| `@fieldforce/mock` | vitest | 40 passed (1 file) |
| `@fieldforce/field` | vitest | **478 passed (30 files)** — was 470 in 29; `day-anchor.test.ts` is new |
| `@fieldforce/field` | jest | **114 passed, 114 total (18 suites)** — was 105; +5 `pulled-store`, +4 `home-route` |
| `@fieldforce/api` | vitest | **626 passed (41 files)** — no deadlock in this run |

**1,590 passing, zero skipped, zero failing.** `typecheck`, `lint` and `format:check` all exit 0
across the monorepo.

#### Where this session stopped

**At the end, with every part complete** — A1–A5, B1–B6, C1–C2. Nothing was deferred.

What a reader should carry forward:

1. **`FE-G1` and `FE-G2` are blocked by the handset alone**, and that sentence is now in
   `blocked-on-you.md` where a buyer will read it. Seven weeks.
2. **`FE-W42` is unblocked.** Its five screens were waiting on the answer `FE-W40` now
   implements; the pattern to copy is `home.tsx`, and the `eslint-disable`s carrying that id are
   the worklist.
3. **`BE-W92`'s next measurement is the loaded one.** api-alone bought one sample in sixteen
   runs; the whole-monorepo condition is where it reproduces, and its denominator is two.
4. **A correction is not done until every other mention of the fact is corrected too.** Five
   stale copies of one fact sent a reviewer into a session on a false premise, and the
   correction had existed since 27 August.

### MR-31 — FE-W42 and the sentinel class

**Every screen in this app now takes *now* from the server.** The five `FE-W42` sites are
converted and the `eslint-disable`s carrying that id are gone. Two of the defects recorded
below were found inside this session's own changes — one by reading what a function returns,
one by mutating what had just been written.

#### A1 — CI

| | |
| --- | --- |
| Run | `34829719365` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `d76ca200c3c30509f2801881e9f9ba3c7141a9f5` |

**The SHA equals HEAD.** `git rev-parse HEAD` returned the same
`d76ca200c3c30509f2801881e9f9ba3c7141a9f5`. Three held commits pushed as `246f216..d76ca20`;
both jobs green.

#### A2 — `C1`'s verdict, stated plainly: **DEFER**

The last report said C1 was complete and did not say which way it went. It is **`BE-W98`,
defer, with a named trigger.**

The reason is one line of code: `explanation.ts:196` reads
`action: record.deadLettered || !RETRYABLE.has(record.code) ? 'escalate' : 'retry'`. **For a
dead letter the action is `escalate` whatever the SQLSTATE is** — attempts are exhausted, a
person is required, and no figure changes that. Figures exist to tell somebody what to do
next; on this path what to do next is already fixed. Beside that, `rejection_detail` still
carries the server's own sentence, which after MR-28 B names the doctor rather than a UUID, so
only the numeric DETAIL line is absent — and two columns on `sync_items` is a migration
against a table that grows once per sync attempt.

**The trigger that reverses it:** a manager-facing dead-letter queue. A manager deciding
whether to override a UCPMP refusal needs the cap, the month-to-date and the period as
numbers, and is the first reader for whom they change a decision rather than an explanation.

#### B1/B2 — the sentinel sweep, and a correction to the brief

Searched by **shape**, not by name: `catch` blocks returning a value; `??`/`||` coalescing to
a domain literal; hardcoded literals in request bodies; default parameters; exported
`*_FALLBACK`/`DEFAULT` constants. Each hit was asked one question — **at the call site, can an
absence be distinguished from an answer?**

**The brief's framing of `UTC_FALLBACK` is wrong, and the truth is worse.** It says *"nothing
in its type says it means unknown."* `TerritoryZone.source` is `'territory' | 'fallback_utc'`,
and the type's own comment reads *"A caller must be able to tell an answer from a fallback."*
**The room existed. Nothing read it** — `zone.source` was consumed in **zero** places across
the whole app until MR-30 added one. So the class has two sub-forms:

- **(a) no room in the type** — `sqlState: ''`, `sizeBytes: 1`. Add room.
- **(b) room exists, discriminant present, no caller opens it** — `UTC_FALLBACK`. **Worse**,
  because the type review passes and the comment promises the property. The test is not *"is
  the absence representable"* but **"count the call sites that read the discriminant."** Zero
  means it is documentation.

| site | verdict |
| --- | --- |
| `sync/pulled-store-persistence.ts` — `timeZone` accepted as any non-empty string | **REAL, FIXED.** See below — it wedged sync |
| `sync/outbox.ts:451` — `rejectionCode ?? 'internal_error'` | **REAL, FIXED.** `internal_error` is in `RETRYABLE`, so an uncategorised refusal told the MR to **retry** |
| `sync/async-storage-store.ts` — `emptyQueue` on a corrupt read | **REAL, registered `FE-W44`.** Renders *"Everything sent"* over a queue the app cannot read — the strongest of the registered set |
| `sync/pulled-store.tsx` — `useState(UTC_FALLBACK)` | **REAL, registered `FE-W45`.** Records restore before the zone is fetched, so clocks can render 5h30m wrong and then correct |
| `visit/[id].tsx:225`, `voice-note/[visitId].tsx:157` — `sizeBytes: 1` | **REAL, registered `FE-W46`.** MR-24's instance, unchanged, now in two places; the answer is `BE-W7` |
| `home.tsx:229` — `role ?? 'mr'` | **Registered `FE-W47`.** Navigation only; the server denies what the role may not do, and line 228 says "unknown role" |
| `capture/location.ts` — `{ kind: 'fix' } \\| { kind: 'unavailable', reason }` | **NOT the shape — it is the PATTERN.** No caller can read a position without deciding what to do about not having one |
| `capture/samples.ts:25` — `quantity: 1` | **Not the shape.** A form default the MR edits, documented as *"nobody leaves zero"* |
| `consent/[visitId].tsx:350` — `notice?.fullText ?? ''` | **Not the shape.** Guarded by `blockedReason`; the empty string is never presented as a notice |
| `today/territory-day.ts` — `parts['hour'] ?? '00'` | **Not reachable.** `Intl` throws on a bad zone rather than omitting parts, so the fallback cannot fire for a zone that constructs |

#### B3 — the two that were fixed, and why they mattered

**1. An unusable persisted `timeZone` wedged sync, disguised as a network failure.**
`deserialiseAnchor` — code this session's predecessor wrote — required `timeZone` to be a
non-empty string, which `"garbage"` satisfies. `Intl.DateTimeFormat` **throws**
`RangeError: Invalid time zone specified` on a bad zone, so the first `dayIn` inside
`resolveAnchoredDay` threw during hydration, **inside the sync effect's `try`**, and was
reported as `{ kind: 'unreachable' }`.

**The cost was not a wrong clock.** Hydration threw *before the pull ran*, so nothing rewrote
the bad anchor, so every subsequent launch did the same thing: **sync permanently wedged, and
the MR told the app could not reach the server.** Checking a value's shape is not checking that
this app can use it.

**2. `rejectionCode ?? 'internal_error'` told the MR to retry a refusal the app could not
explain.** The wire contract is already `SyncRejectionCodeSchema.nullable()`, so the absence
was representable and the client was filling it in — and the filler was not inert, because
`internal_error` is in `RETRYABLE`. The comment three lines above says the point of MR-17's
threading was to stop codes collapsing onto `internal_error`.

**And typecheck passing did not reveal that the reducer then THREW on it.** That throw was a
deliberate, tested decision — *"refuses a refusal with no code rather than showing an
unexplained failure"* — with no entry in `decisions.md` behind it. The sentiment was right and
the response was wrong three ways: it **abandoned every later item in the flush**; it left the
item **un-`failed`**, so it retried forever against a server that had refused it; and it was
**unreachable**, because `outbox.ts` coalesced before it. A control that cannot fire is
documentation. The intent is kept where it belongs — `presentRejection` gives an uncategorised
refusal no remedy and `escalate`.

**A mutation caught a dead guard I had just written.** The first version of that fix read
`record.code === null || !RETRYABLE.has(record.code)`, and deleting the null clause **still
passed**: `RETRYABLE.has(null)` is already `false`. `territory-day.ts` names that exact shape
as *"the defect this repository already has fourteen instances of"*. Restated positively —
`record.code !== null && !record.deadLettered && RETRYABLE.has(record.code)` — the null check
is required by the **type**, so deleting it now fails the build rather than passing quietly.

#### B4 — one `gotchas.md` entry, three worked examples

Added, with both sub-forms, the three instances (`sqlState: ''`, `sizeBytes: 1`,
`UTC_FALLBACK`), the usable-versus-well-shaped lesson, and one more observation: **a
third-party helper that never throws is a sentinel factory.** `fetchTerritoryZone` cannot fail;
it moves the decision from the function to every caller, silently.

#### C — `FE-W42`, all five screens

**They were wrong twice over, not once.** Each built its window with `new Date()` and then read
it with **local getters** — `getFullYear()`, `getMonth()`, `getDate()` — so the handset supplied
the instant *and* the calendar. For an IST territory that is a 5h30m offset applied to a date.

| screen | was | now |
| --- | --- | --- |
| `app/day-end.tsx` | `todayIso(new Date())` | `today` from the store; with none, asks for nothing |
| `app/mileage.tsx` | `monthWindow(new Date())` | `monthWindowIn(serverTime, zone)` |
| `app/(tabs)/coaching.tsx` | `recentMonths(new Date())` | `recentMonthsIn(serverTime, zone, 3)` |
| `app/(tabs)/doctors.tsx` | `Date.now()` | `Date.parse(serverTime)`, nullable |
| `app/doctor/[id].tsx` | `Date.now()` | `Date.parse(serverTime)`, nullable |

`src/today/server-window.ts` is new and pure — `monthIn`, `monthWindowIn`, `recentMonthsIn` —
and none of them reads a clock. The instant is always passed in and is always the server's.

**C3 found a defect inside the conversion, which is the shape the prompt warned about.**
`lastSeenLabel(null)` reads *"never visited"*. With a nullable server clock a **visited** doctor
also produces `daysSince === null`, so routing both through it would have told an MR that a
doctor they saw last week had never been seen — false in the direction that wastes a visit.
There are **three** states, and the third renders the **date**: a fact the server gave, needing
no clock at all, and more useful than the age it replaces.

**And a mutation found a second, untested for four sessions.** Reverting `overdue` to
`daysSince === null || …` left every test green while badging **every doctor Overdue** whenever
the server clock was unknown. Overdue drives the badge *and* the filter, so it changes which
doctors an MR drives to. "Never visited" is knowable with no clock, which is why the rule now
keys on `lastSeenAt`; "seen 40 days ago" is not.

#### C2 — values chosen to EXPOSE, and the sample that did not

The unit pair straddles the **last midnight of a month**, where the day and month boundaries
move together:

| instant | IST | territory month | UTC month |
| --- | --- | --- | --- |
| `2026-09-30T18:25:00Z` | 23:55 on the 30th | `2026-09` | `2026-09` |
| `2026-09-30T18:35:00Z` | 00:05 on the 1st | **`2026-10`** | `2026-09` |

Five minutes either side, and UTC cannot separate them — asserted as a control for the control.
Plus a leap-February for month **length**, and a year boundary where `monthNumber - n` goes to
zero.

**Field by field against Postgres, on the dev client:**

| doctor | server `completed_at` | rendered | Overdue? |
| --- | --- | --- | --- |
| Asha Deshpande (DEMO) | `2026-09-13 07:44:40Z` | **yesterday** | no |
| Meera Iyer (DEMO) | `2026-09-14 08:39:40Z` | **today** | no |
| Vikram Rao (DEMO) | `2026-09-14 07:44:40Z` | **today** | no |

Server now was `2026-09-14 10:12Z`. All three correct, none badged.

**And the first device sample did not discriminate — which is the reviewer's own point about
"9 Sep" being right by luck.** `07:44Z` is 13 September in UTC *and* in IST, so the profile's
"13 Sep" proved nothing about the zone. One visit was therefore moved to **`18:45Z` on the
13th — 00:15 IST on the 14th** — and the profile rendered **"14 Sep"**, the territory's date,
not "13 Sep". Both data edits were reverted and verified back to their seeded values.

**A first attempt at that check edited a different tenant's row**, and the screen did not move.
Reading the **device's own AsyncStorage** showed it held only this MR's five visits and the
modified id was not among them — RLS had kept it out. That is what separated *"the app is
wrong"* from *"the app never saw it"*, and guessing would have gone the other way.

#### C4 — real versus fixture, with the column this table was missing

**Three of these screens now read their CLOCK from the real store while their DATA is still the
mock.** A two-column table cannot say that, and `PROJECT-OVERVIEW.md:8466` already records that
a table with one column too few is what hid a defect once.

| Capability | Screen | DATA source | CLOCK source |
| --- | --- | --- | --- |
| Today | `app/(tabs)/home.tsx` | **REAL** — Supabase | **REAL** — `serverTime` / `dayOrigin` |
| Doctor list | `app/(tabs)/doctors.tsx` | **REAL** — Supabase | **REAL** — `serverTime`, nullable |
| Doctor profile | `app/doctor/[id].tsx` | **REAL** — Supabase | **REAL** — `serverTime`, nullable |
| Day end | `app/day-end.tsx` | mock (`:4010`) | **REAL** — `today` |
| Mileage | `app/mileage.tsx` | mock (`:4010`) | **REAL** — `serverTime` + `zone` |
| Coaching | `app/(tabs)/coaching.tsx` | mock (`:4010`) | **REAL** — `serverTime` + `zone` |
| Check-in · check-out · consent · samples | their screens | **REAL WRITE, REAL READ** | **REAL** |
| Beat plan · analysis · reply · report · voice note | their screens | mock | — (no clock decision) |

**No screen in `apps/field` now takes the current instant from the handset.** The only device-
clock reads left are the two allowlisted elapsed measurements in `pulled-store.tsx` and the
`captured_at`/`occurred_at`/`recorded_at` records the server bounds.

#### C5 — mutations, each failing exactly one case

| mutation | fails |
| --- | --- |
| day-end: remove the no-day guard, substitute a date | 1 of 6 |
| doctors: collapse the three label states back to two | 1 of 9 |
| `server-window`: reckon the month in UTC | 4 of 8 |
| `list.ts`: let an unknown age claim Overdue | **0 of 9 — the gap**, then 1 of 9 once the missing test existed |

Positive controls throughout: with a day, day-end still fetches; a truly never-visited doctor
still says so **and is still badged Overdue**; a known retryable code still says retry.

#### D — the `BE-W92` asymmetry, measured, with no mechanism proposed

The obvious reading of 1-in-16 alone against 2-in-2 loaded — *another workspace is hitting the
same database* — is **wrong**.

| question | answer |
| --- | --- |
| Which workspaces touch the local Postgres? | **`services/api` and no other.** Nothing else references `54322`, `postgresql://`, `DATABASE_URL` or `SUPABASE_DB`; the only other matches are generated Android build artefacts |
| Any running concurrently with `api`? | **None that touch the database.** turbo's default concurrency is 10, but none of those tasks opens a connection |
| Then what writes concurrently? | **Supabase's own ten containers**, two of which own every relation the three samples named: `supabase_auth` owns `auth.users` and `auth.identities`; `supabase_storage` owns `storage.objects` and `storage.buckets` |
| How many writers does `api` itself field? | `vitest.config.ts` sets `minWorkers: 1` and **no `maxWorkers`** — the pool is sized from the CPU count, **20 here** |

**What this rules out is the useful part.** The contention is not cross-workspace. It is inside
one suite: up to twenty workers running DDL inside `inRolledBackTransaction`, against a Postgres
that ten Supabase services also write to — and `seedFixtures` creates GoTrue users **over
HTTP**, so sample 1's `INSERT INTO identities` came from `supabase_auth`'s own backend, not from
a test's connection. A monorepo run adds no database client; it adds machine load.

**No mechanism is proposed and none should be read in.** The next measurement is unchanged: run
the whole monorepo suite N ≥ 10 times and count. `maxWorkers` is worth measuring alongside it,
because it varies the number of concurrent writers directly — **measured, before anything is
set.**

#### Counts — by workspace AND runner, from each runner's own line

Never from `test-counts.mjs`, which counts tests DISCOVERED rather than PASSED.

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed (3 files) |
| `@fieldforce/ui-tokens` | vitest | 54 passed (3 files) |
| `@fieldforce/ui` | vitest | 4 passed (1 file) |
| `@fieldforce/ui` | jest | 243 passed, 243 total (21 suites) |
| `@fieldforce/console` | vitest | 10 passed (1 file) |
| `@fieldforce/mock` | vitest | 40 passed (1 file) |
| `@fieldforce/field` | vitest | **489 passed (31 files)** — was 478; `server-window.test.ts` is new |
| `@fieldforce/field` | jest | **122 passed, 122 total (18 suites)** — was 114 |
| `@fieldforce/api` | vitest | **626 passed (41 files)** — no deadlock in this run |

**1,609 passing, zero skipped, zero failing.** `typecheck`, `lint` and `format:check` all exit 0
across the monorepo.

#### Where this session stopped

**At the end, with every part complete** — A1–A2, B1–B4, C1–C5, D1–D2.

Three things a reader should carry forward:

1. **No screen takes *now* from the handset any more.** `FE-W42` is closed; the sites that
   remain are the allowlisted elapsed measurements and the device-observation records the
   server bounds.
2. **Two of this session's defects were in this session's own work**, and neither was found by
   reading the diff: one by asking what `lastSeenLabel(null)` returns, one by mutation. The
   dead-guard case is the sharper lesson — the code was *correct* and the guard was inert, so
   only mutation could tell.
3. **`BE-W92`'s contention is inside one suite, not across workspaces.** That closes off the
   cross-workspace explanation and leaves worker count and Supabase's own services as what is
   left to measure — measure, not theorise: the FK candidate was refuted by the log.

### MR-32 — the restore drill

**The recovery runbook had never been executed. Three of its four commands were broken and
all three exited 0.** Every previous first execution of a written procedure in this project
has found the procedure wrong; this one found it wrong in a way that would have been invisible
during the incident it exists for.

#### A1 — CI

| | |
| --- | --- |
| Run | `34833470369` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `025aba76bf37d039c95c63fac0dd0872310294d6` |

**The SHA equals HEAD.** `git rev-parse HEAD` returned the same
`025aba76bf37d039c95c63fac0dd0872310294d6`. Three held commits pushed as `d76ca20..025aba7`.

#### A2 — the calendar half of the clock class

MR-29's rule bans acquiring *now* from the handset. That is the **source**.
`getMonth()`, `getDate()`, `getDay()`, `getHours()` are the **interpretation**, and they
answer in the device's timezone even when the instant they are called on came from the server.
That is how five screens were wrong a second way — MR-31 C fixed them by hand and no rule
prevented a sixth.

**Verified by exercising, not by reading.** `parsed.getMonth()`, `parsed.toDateString()` and
`new Date(2026, 8, 30)` **all passed lint in both trees**. MR-25 C1's getter selector never
fired because it requires the receiver to be a `new Date()` literal — `new Date().getHours()`
is caught, `parsed.getMonth()` is not.

**Every site the extended rule fires on: zero.** MR-31 C removed the last of them, so this is
a regression guard rather than a cleanup. Confirmed across four shapes:

| shape | in `src/` | in a screen | in a test |
| --- | --- | --- | --- |
| local component getters, any receiver | **fires** | **fires** | **fires** |
| `toDateString` / `toLocale*String` | **fires** | **fires** | **fires** |
| `new Date(y, m, d)` | **fires** | **fires** | **fires** |
| `getUTCMonth()`, `new Date(iso)` | silent | silent | silent |

The last row is the negative control: `getUTC*` is zone-independent and
`src/today/server-window.ts` depends on it, and single-argument `new Date` is parsing rather
than calendar-reading. The positive control is **0 → 4 errors** in each of the three regions.

Tests are covered deliberately: a fixture that reads a date in the device's calendar asserts
against whatever zone CI happens to run in, which is how a test passes on one machine and
fails on another.

#### A3 — `BE-W92` measured again, and the asymmetry does not survive

Two batches of eight runs of the api suite alone, same tree, same database, same session:

| condition | deadlocks / runs |
| --- | --- |
| machine **idle** | **3 / 8 — 37.5%** |
| machine **loaded**, nine busy workers as turbo's ten tasks load it | **1 / 8 — 12.5%** |

**Load made it LESS frequent, which is the opposite of the prediction.** And 37.5% idle is
nothing like the 1-in-16 this entry has carried since MR-30.

**What actually failed is the denominators.** The "1-in-16 versus 2-in-2" asymmetry that two
sessions reasoned from was never established: 2-in-2 is *two samples*, and the 1-in-16 spans
different days against a database that has since accumulated 2,603 visits and 5,033 auth
users. Today's idle rate is six times the figure the entry records. Neither remaining
explanation survives — not another workspace (refuted MR-31 D1), not concurrency against the
platform writers (refuted here, in the wrong direction).

**The honest conclusion is about method, not about Postgres:** three sessions drew
comparisons from samples too small to support one. No mechanism is proposed;
`deadlock_timeout` is untouched. The next thing worth doing is establishing whether the rate
is stable at all — the same batch twice on the same day — before any further comparison.

#### A4 — hydration as a third boundary, enumerated

MR-25 C3 and MR-26 C1 enumerated the write and read boundaries. `deserialiseAnchor` threw at
neither: it threw during **hydration**, before the pull, and a local corruption was reported
as a network failure.

**Every value read from disk before the first network answer:**

| value | validated by | consumer | can it throw? |
| --- | --- | --- | --- |
| pull cursor | none — an opaque server token | sent to `sync_pull` | no; an unrecognised cursor is answered with a forced re-sync |
| store records | **Zod**, whole load refused on any bad row | `dayIn` / `clockIn`, selectors | **no** — see below |
| **day anchor** | **hand-written `deserialiseAnchor`** | `resolveAnchoredDay` → `dayIn` → `Intl` | **it did** — fixed MR-31 B3 |
| queue items | Zod `safeParse` per item | reducer, screens | no |
| first-run marker | presence only; the value is never read | routing | no |
| battery steps | hand-filtered to strings | onboarding ticks | no |
| auth session | `supabase-js` | session context | MR-28 C fixed a missing `.catch`; was a permanent splash |

**The records are safe, and that was measured rather than assumed.** `IsoDateTimeSchema` is
`z.iso.datetime({ offset: true })`, and probing it with six candidates showed it **rejects**
impossible months, impossible days, out-of-range offsets and out-of-range years — and
everything it **accepts** renders through `Intl` without throwing.

**So the finding is a single sentence: the day anchor was the one persisted value validated
by hand instead of by a schema, and it is the one that broke.** And the second half matters as
much — *a `catch` around the READ does not protect the CONSUMER.* `deserialiseAnchor`'s own
try/catch was intact; the throw happened afterwards, in `dayIn`.

#### B — the restore drill

**B1/B2 — what the runbook said, and what happened.**

| Step | Runbook said | What actually happened |
| --- | --- | --- |
| 2 | *"Restore."* | **No mechanism exists.** PITR was deliberately not purchased; there is no `db:dump`, no backup script, no off-machine copy. `BE-W11` is open. **Step 2 is the gap** |
| 3 dry run | `pnpm --filter @elmiron/api reconcile:restore` | *"No projects matched the filters"*, **exit 0**. The workspace is `@fieldforce/api` |
| 3 apply | `… reconcile:restore -- --apply --note "…"` | Same silent exit 0. With the name fixed, **two further breaks**: `pnpm 11` forwards `--` literally, so the script received `"--" "--apply"`; and `--db-url` was missing, which `BE-W8` made mandatory — that guard fired, exit 1, correctly |
| 4 | the quarantine SQL | **Worked.** Four quarantined visits with their findings |
| 5 | `pnpm --filter @elmiron/api check:purge-health` | *"No projects matched the filters"*, **exit 0** |

**Three of four commands were a silent no-op.** During a compliance incident, an operator
following this document exactly would have run the dry run, seen no error and no findings, and
concluded there was nothing to reconcile. The one command that would have refused correctly
could only be reached by first fixing the package name.

**The commands were corrected in place rather than appended to.** A runbook is a procedure,
not a record: an operator under pressure runs the first command they see, and MR-30's own rule
is that a correction leaving the original standing with equal authority fails. The divergence
log is appended beneath, so what was wrong is still on the record.

**B3 — verified by querying the restored database.**

| Check | Source | Restored |
| --- | --- | --- |
| Migrations applied | 56 | **56** |
| Public tables | 37 | **37** |
| Tables with RLS enabled | 36 | **36** |
| Policies on `public` | 48 | **48** |
| `public.visits` | 2,603 | **2,603** |
| `public.doctors` | 1,926 | **1,926** |
| `public.app_thresholds` | 17 | **17** |
| `purge_batch_limit` / `purge_backlog_multiplier` / `purge_max_silence_hours` | 250 / 3 / 12 | **250 / 3 / 12** |
| A marker row seeded **before** the dump | 1 | **1, with its timestamp** |
| `auth.users` / `auth.identities` | 5,033 / 5,033 | **5,033 / 5,033** |
| `storage.objects` / `storage.buckets` | 128 / 1 | **128 / 1** |

**Why the queries and not the exit code, demonstrated rather than asserted.** The first
attempt failed in exactly the way the runbook now warns about: Git Bash rewrote the container
path `/tmp/drill.sql` into a Windows path, `pg_dump` wrote nothing, `create database`
**succeeded**, the restore log contained **zero `ERROR` lines** — and only *"migrations:
source 56, restored 0"* revealed that nothing had been restored at all.

**And the last row is the runbook's own thesis, demonstrated.** `storage.objects` restored 128
rows. Those are *metadata*. The objects themselves never moved, because they are not in the
database. A restored `storage.objects` asserts that 128 objects exist; whether they do is
unknowable from the database — which is what the top of that file argues and what this now
shows.

**B4 — duration. Dump plus restore: 3 seconds**, for a 16.4 MB database. Whole drill including
seeding, verification and teardown: **9 seconds**. **That number does not extrapolate.** Local
socket, no network transfer, no platform snapshot to locate, no support ticket. Its only
honest use is as a floor.

**B5 — what the drill does NOT prove.**

- It was a **scratch target in the local cluster**. Production credentials are not on this
  machine, and `assertLocalhostOnly()` exists to keep them from being used from here.
- **Nothing about the platform's restore.** Whether a Supabase restore takes minutes or hours,
  whether it needs a support ticket, and what it does to roles, extensions and
  `supabase_admin`-owned settings is untested, because there is nothing to test against.
- **Nothing about the object store**, which is the entire reason the runbook exists.
- **The reconciliation was not run end to end** — its guards were exercised and its SQL was
  exercised, but `--apply` against a real divergence remains unexecuted.
- **`check:purge-health` had never actually run.** The broken filter made every invocation a
  no-op, so its post-restore behaviour is still unverified. It works now: *"Audio retention is
  healthy"*, with real figures.

#### C — `BE-W40`, and which option was honest

**A check cannot produce the audit trail, and saying it could would be the defect this project
keeps finding.** `supabase_migrations.schema_migrations` has `version`, `name` and
`statements` — **no timestamp and no actor**. Who applied a migration and when is recorded
nowhere and cannot be recovered. CI has no path that deploys migrations; every job in `ci.yml`
runs against `127.0.0.1:54322`, so the only route to production is a person typing the command.

**So both halves, with the weaker one named.**

- **The check.** `check:migration-drift` plus `.github/workflows/migration-drift.yml`, daily
  and on every migration push, comparing the versions production has applied against the files
  on `main`, failing in **both** directions — applied-with-no-file (something reached
  production off `main`) and file-never-applied (the quiet one, invisible until a query hits a
  missing column). **A detector, not a preventer:** it cannot stop a hand-run push, it makes
  one impossible to hide for longer than a day. Preventing one means taking credentials away
  from people, which is an access decision.
- **The step**, in `docs/restore-runbook.md`: drift-check before, push from a clean `main`,
  drift-check after, then **write down** the SHA, the versions, the date and who ran it. That
  human note *is* the audit trail, and it is weaker for a reason that cannot be engineered away
  from here.

**C2 — both directions, with a clean baseline before and after:**

| | exit | says |
| --- | --- | --- |
| baseline | 0 | 56 migrations, no drift |
| a file never applied | **1** | names `20990101000000` |
| a version applied with no file | **1** | names `20990202000000` |
| baseline again | 0 | no drift |

Plus six unit tests on the pure comparator, including that it reports **both** directions at
once — an operator who fixes only the half they were shown runs the check again and is
surprised.

**Its production leg is UNVERIFIED and the workflow says so.** The first production run will
be the workflow's own, and the runbook tells the reader to distinguish an unreachable target
from a real divergence before assuming drift.

#### D — the working-notes split, and one fact stale in three places

**D1 and D3 contradict each other** — *strip point-in-time claims* against *appends only,
never rewrite*. The repository settles it, not a preference:

- `.gitignore:22-26` records the BE-W8 decision that `handoff.md` and `.ai-collab/` are
  tracked and *"expected to be updated regularly, not treated as a point-in-time snapshot."*
- The section-freezing rule in `.ai-collab/decisions.md` is scoped, in its own words, to
  *"a `###` section in `PROJECT-OVERVIEW.md`"*. It does not govern these two files;
  `handoff.md` had invoked it by analogy.

So append-only governs the durable record — untouched — and these are the working notes.
`handoff.md` 627 → 151 lines, `handover.md` 441 → 100. **Nothing deleted:** every per-session
narrative is in this file at 269–387 lines each, and both now carry an index saying where each
era went.

**Both files had already failed in the way D1 describes.** `handoff.md` carried *"STATUS AS OF
11 SEPTEMBER — read this first"* at line 353 of 627, with three later sessions appended
**beneath** it and contradicting it: the dev-client build it called deferred was built, the
gates it said were blocked on two things are blocked on one, and the dependency it named does
not exist. `handover.md`'s "Current state" was 17 August — *seventeen migrations, the three
GitHub secrets are not set*. There are 56, and BE-W8 set them.

**D2 — the grep rule found one fact stale in three places:**

| Location | Said |
| --- | --- |
| `.ai-collab/handover.md:5` | *"Untracked, and that is the only reason this file is allowed to exist"* |
| `CLAUDE.md:35` | *"the same rule that keeps `handoff.md` and `.ai-collab/` out of git"* |
| `.gitignore:36` | *"the same staleness argument that keeps `handoff.md` out of git above"* |

All three describe a decision BE-W8 reversed. **The third is the sharpest: `.gitignore:22-26`
states the reversal and `:36` refers back to "above" for the rule those very lines say no
longer holds — the contradiction is ten lines apart in the same file.** And the `CLAUDE.md`
copy is loaded into every session's context, which makes it the highest-leverage stale fact
found so far: it is how a false premise reaches a session before any code is read. All three
corrected in place, with the table recorded in `handover.md`.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed (3 files) |
| `@fieldforce/ui-tokens` | vitest | 54 passed (3 files) |
| `@fieldforce/ui` | vitest | 4 passed (1 file) |
| `@fieldforce/ui` | jest | 243 passed, 243 total (21 suites) |
| `@fieldforce/console` | vitest | 10 passed (1 file) |
| `@fieldforce/mock` | vitest | 40 passed (1 file) |
| `@fieldforce/field` | vitest | 489 passed (31 files) |
| `@fieldforce/field` | jest | 122 passed, 122 total (18 suites) |
| `@fieldforce/api` | vitest | **632 passed (42 files)** — was 626; `migration-drift.spec.ts` is new |

**1,615 passing, zero skipped, zero failing.** No deadlock in this run. `typecheck`, `lint` and
`format:check` all exit 0.

#### Where this session stopped

**At the end, with every part complete** — A1–A4, B1–B5, C1–C2, D1–D3.

Four things a reader should carry forward:

1. **The recovery posture is one gap, and it is step 2.** The reconciliation works and is now
   exercised. There is nothing to restore *from*. `BE-W11` is no longer one item on a list; it
   is the whole of what stands between this project and a recovery posture.
2. **Three commands exited 0 while doing nothing**, in the document written for the worst day
   this project could have. The exit-code rule was already written down; it had not been
   applied to the runbook itself.
3. **`BE-W92`'s numbers were never stable enough to compare.** Three sessions drew conclusions
   from two-sample and sixteen-sample denominators that today's measurement contradicts by a
   factor of six. The correction is to the method, not to Postgres.
4. **One fact was stale in three places, and one copy was in `CLAUDE.md`.** The grep rule from
   MR-30 keeps earning its place, and the highest-leverage place to apply it is the file that
   is loaded before anything else is read.


### MR-33 — the restore mechanism

**Two things were found by running something rather than reading it, and both were found by
tooling this project shipped in the previous session and labelled "unverified".**

#### A1 — CI, and the check that verified itself by failing

| | |
| --- | --- |
| Run | `34837060776` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `4e8ba6193417d7d7d5f39b55ab0d9a53947f0b5f` |

**The SHA equals HEAD.** Four MR-32 commits pushed as `025aba7..4e8ba61`.

**The same push triggered `BE-W40`'s first production run, and it failed — correctly.** MR-32
shipped that workflow recording its production leg as unverified, and told the reader to
distinguish an unreachable target from a real divergence before assuming drift. It was a real
divergence:

| | |
| --- | --- |
| Migration files on `main` | **56** |
| Applied to production | **19** |
| Applied with no file here | **none** — nothing was ever pushed off-`main` |
| **Never applied** | **37**, everything dated `20260907` and later |

**Production has not been deployed since BE-W8, 14 August.** The credential works and the
project is reachable — the check connected to `aws-0-ap-south-1.pooler.supabase.com` and read
the 19 versions — so this is neither a paused project nor a bad secret.

**What is missing is not incidental:** `tenant_boundary_restrictive`, `organisation_scoping`,
both privilege revocations, the consent capture bounds, the UCPMP cap machinery with its
6 November deadline, the entire `sync_pull`/`sync_push` layer, and MR-28's defect-12 fix. The
September security hardening is not on production, and neither is the offline sync layer the
app now depends on.

Nothing is broken *today* because nothing is pointed at production. **The app as it now exists
cannot run against it.** Escalated as `blocked-on-you` **6.1**; it needs an operator
`supabase db push`, and the drift workflow fails daily until it is done. That is the point.

#### A2 — the PITR decision, and it is worse than one missing premise

The recorded decision reads: *"do not buy Point-in-Time Recovery. **Daily backups (included in
the Pro plan) plus `docs/restore-runbook.md`** is the right posture."*

| Premise | State |
| --- | --- |
| *"Daily backups (included in the Pro plan)"* | **The paid plan is item 5.2 and is unresolved.** Whether any automatic backup exists on the current plan is a dashboard fact, not knowable from here, and has **never been confirmed in the record** |
| *"plus `docs/restore-runbook.md`"* | **MR-32 executed it.** Step 2 was the single word *"Restore."* |

**Both premises are absent, not one.** The reasoning — that finer restore points buy more of
the thing the design already defends against — was never the problem. The alternative it was
weighed against was never built. Re-opened as two questions: confirm the plan and what it
backs up, *then* weigh PITR against the cost of the alternative, which Part B makes concrete.

#### A3 — what `CLAUDE.md` moved out, and why that file is special

`CLAUDE.md` is loaded into every session's context **before any code is read**. A stale claim
there is a stale prior in every session that will ever run, and it arrives with more authority
than anything read afterwards.

**The test applied: does the claim hold for all time, or is the command that checks it printed
beside it?** What failed and moved to `docs/graphify-notes.md`:

| Moved | Why it failed the test |
| --- | --- |
| *"1,221 nodes, 1,545 edges"* | a count of one build |
| *"159 named communities"* | the same |
| the four measured graph weaknesses, with `312 tests`, `#14 and #15`, `456 nodes (37%)` | measurements of one snapshot |

**And one claim was already wrong**: *"all **34** migrations contribute nothing"* without the
`[sql]` extra. **There are 56.** A stale count had been reaching every session unchallenged in
the one file read before anything can contradict it. The fix in that sentence was not a new
number — it was replacing the number with `ls services/api/supabase/migrations/*.sql | wc -l`.

Kept: the index-not-authority rule, the freshness check (its command is beside it), the
`[sql]` trap, and the two graphify CLI traps. Rule added to `gotchas.md` as **the MR-30 grep
rule's worst case** — `CLAUDE.md` is the mention that outranks all the others and is least
likely to be in the grep, because it reads as instructions rather than as documentation.

#### B — `BE-W11`: the mechanism, and the decision it is waiting on

**B1, and the decision changed because it was measured.** The obvious choice was
`supabase db dump` — already a workspace dependency, the project's own CLI, no new tooling.
Against the local stack it produces a **340 KB schema dump with zero `auth.` and zero
`storage.` tables**, and a **16 MB `--data-only` dump with zero rows of `auth.users`**. It is
scoped to `public`.

**A database restored from it holds the consent ledger and has nobody who can sign in**, with
`storage.objects` empty — the metadata the step-3 reconciliation walks. The obvious tool
produces something that looks like a backup and is not one, which is the whole reason B4
proves an artefact by restoring it rather than by producing it. So: raw `pg_dump` of the whole
database, which MR-32 had already shown carries auth and storage.

**B2.** Plain SQL, not `--format=custom`: restorable by `psql`, readable by anything,
checkable with `sha256sum`. A backup whose only reader is the tool that wrote it is a backup
you find out about on the day you need it. The manifest carries the digest, the size, and
counts taken from the **source** in the same run.

**B4 — proven by restoring into a scratch database and querying it:**

| Check | Source | Restored |
| --- | --- | --- |
| Migrations | 56 | **56** |
| Public tables | 36 | **36** |
| Tables with RLS | 36 | **36** |
| Policies | 48 | **48** |
| `consent_records` | 1,910 | **1,910** |
| `visits` | 2,823 | **2,823** |
| `doctors` | 2,088 | **2,088** |
| `app_thresholds` | 17 | **17** |
| `auth.users` | 5,447 | **5,447** |

**Two failure controls, independent, with a clean baseline either side:** a truncated artefact
caught by the **hash**; an intact artefact with one wrong count passing the hash and caught
**only by the query**. The second is the one that proves the query check is load-bearing
rather than decorative — which is MR-32's lesson, where `CREATE DATABASE` succeeded, the log
had zero `ERROR` lines, and only a count revealed nothing had been restored.

**B5 — produce 1s, verify 4s, for a 17.6 MB artefact.** A **floor**, not an estimate: a local
socket, no network transfer, no platform snapshot to locate, no support ticket.

**B3 — the artefact has nowhere lawful to go, and the workflow says so by failing.** A dump of
this database is a package of personal data: `doctors.full_name`, `user_profiles`,
`transcripts_redacted`, 5,447 `auth.users`, and `adverse_event_reports.reported_text`, whose
lawful contents are **open question 4.1**. Where it may land is a data-processing decision
with a DPA dimension, not an engineering one.

So `.github/workflows/backup.yml` checks for a destination **before producing anything** — a
run with no destination leaves no artefact anywhere — and is scheduled daily and red on
purpose, per the `retention.yml` precedent. Four options with their costs are in
`blocked-on-you` **6.3**.

**One thing already true:** the **repository** is off-machine, on GitHub, current. What has no
off-machine copy is the **data**, and the data is the part that cannot be copied without this
decision.

Two guards worth naming: `backup:database` refuses a non-local target that was not given on
the command line, because producing that file must never happen because an environment
variable was left set; and `backup:verify` refuses to restore over an existing database,
because a verifier that can overwrite what it verifies is a delete command with a reassuring
name. `backups/` is gitignored — the default `--out` is `./backups`, and committing one would
put the consent ledger in git history permanently.

**B7 — what remains unverified against production.** The drill was a scratch target in the
local cluster; production credentials are not on this machine and `assertLocalhostOnly()`
exists to keep them off it. Untested: whether a Supabase platform restore takes minutes or
hours, whether it needs a support ticket, what it does to roles, extensions and
`supabase_admin`-owned settings — and **anything about the object store**, which is the reason
the runbook exists. `storage.objects` restores its *rows*; the objects never move.

#### C — what would close `BE-W40`'s weaker half, stated accurately

**The obvious phrasing is wrong.** It is *not* "this needs production credentials in CI".
**CI already has one**: A1 watched the drift check authenticate to the pooler and read the
applied versions. Three other things are missing:

1. **A deploy workflow.** Buildable today, and small.
2. **Whether that credential may APPLY migrations, which is untested.** It is proven to
   `select`. DDL is a different privilege, and `ci.yml:135` already records a `db push`
   failing with *"permission denied to set parameter"*. Assuming read implies write is the
   inference this project keeps getting wrong.
3. **The decision that CI is the only path** — human-held production credentials stop being
   used, and a merge to `main` deploys. An access and operational decision.

Until all three, the detector plus the written note is the honest posture, and the note is
where the actor and the timestamp actually live.

#### D1 — the four sentinel registrations, in consequence order

**`FE-W44` — fixed, and worse than registered in two ways.** MR-31 recorded **two** consumers;
there are **five**, and the two missed were the serious ones: `queue.tsx` rendered an **empty
list** on the screen an MR opens when they already suspect something is wrong, and
`visit/[id].tsx` fed `witnessedStage` an empty queue, making a queued check-in invisible —
**MR-28's defect 12 by another route**.

**And the fifth is not a reporting bug.** `devicePersistence.read` feeds the outbox, and both
writers are read-then-write. While a corrupt read answered `emptyQueue`, **the next write
replaced the MR's unsent work with an empty queue — permanently**, on a device that may have
been offline all morning, with queued consent captures among what is lost.

Fixed as a discriminated `QueueLoad`, so the call sites that read the discriminant are
structurally all of them. Both writers refuse to write when the queue is unreadable; the
indicator gains an `unreadable` state — the second `critical` one, and the comment claiming
`failed` was the only one is corrected rather than left standing; and all five write screens
report it instead of claiming `queued` or, in `samples`, counting it as **sent**. Four
mutations, each failing exactly one test, including one on the **origin** — `loadQueueState`'s
own catch, which had no test file at all until now.

**`FE-W45` — fixed, and the test that proves it nearly did not.** `setStore` published the
restored records *before* the anchor was read, so one render held real visits with `zone` still
at `UTC_FALLBACK`: every clock **5h30m wrong for IST**, then corrected. Records and the zone
they are read in now arrive together — the records-and-cursor invariant applied to a second
pair.

**The first version of the ordering test passed against the defect.** `memoryPulledStore`
resolves `loadAnchor` synchronously, so React batched both updates into one render and the
intermediate state never existed. Only after the double was made as asynchronous as the real
`AsyncStorage` did the mutation produce `doctors:1, zone:fallback_utc` and fail. **A
synchronous test double can hide an ordering defect completely** — now a `gotchas.md` entry,
in the same family as *assert the content, not the container*: the test looked correct, ran,
and measured nothing.

**`FE-W46` — not fixed, genuinely blocked.** `sizeBytes: 1` is fabricated because the byte
count is unknowable until `BE-W7` exists, and every candidate fix invents a different wrong
number.

**`FE-W47` — not fixed, as a decision rather than a deferral.** `role ?? 'mr'` renders no false
claim — the screen already says *"Signed in as unknown role"* — and changing it would mean the
**client** deciding what an unknown role may see, which the standing rules forbid. Recorded so
the verdict is on the record rather than inferred from silence.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | 10 passed |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | **499 passed** — was 489 |
| `@fieldforce/field` | jest | **125 passed, 125 total** — was 122 |
| `@fieldforce/api` | vitest | **644 passed** — was 632; `backup.spec.ts` is new |

**1,640 passing, zero skipped, zero failing.** No deadlock in this run. `typecheck`, `lint`
and `format:check` all exit 0.

#### Where this session stopped

**At the end, with every part complete** — A1–A3, B1–B7, C1, D1.

Four things a reader should carry forward:

1. **Production is 37 migrations behind and nothing said so until a check ran.** It was found
   by the workflow MR-32 shipped *and labelled unverified* — the label was right, and the
   first run is what verified it.
2. **`BE-W11` is built and has nowhere to put its output.** The remaining work is not code; it
   is somebody deciding where a file containing the consent ledger may lawfully live.
3. **The obvious tool was not a backup.** `supabase db dump` omits `auth` and `storage`
   entirely. Proving an artefact by restoring it is what caught that, and producing one would
   not have.
4. **Two tests in this session measured nothing until they were mutated** — the ordering test
   that React batched away, and `loadQueueState`'s catch, which had no test at all. Mutation
   is the only thing that distinguishes a passing test from a present one.


### MR-34 — the deploy rehearsal

**The session found a migration that crashes, in the batch an operator is about to apply to
production, on the branch nobody could exercise. It was found by running the deploy, not by
reading it — and CI has never once run the path it fails on.**

#### A1 — NOT DONE, and this is the only part of MR-34 that is incomplete

**`git push` was denied by this environment's permission classifier** ("Out-of-Place
Publication"). The five MR-33 commits are still local. **There is therefore no CI run id, no
workflow, no event and no SHA to report, and no statement that any SHA equals HEAD can be
made.** Saying otherwise would be inventing a run that does not exist.

What *is* true and checkable: `HEAD` was `577bd815ee76669c2e9cc802448ab4ddfc95e144` at the
start of this session, the working tree was clean, and the checkout guard passed all three —
namespace `@fieldforce/api`, remote `Praverse-Tech-Pvt-Ltd/Elmiron-App`, `f34ceef` an ancestor
of HEAD. **Nine commits are now held locally.** A1 needs the operator to grant push, or to push
themselves.

#### A2 — the drift item is now a sequencing constraint with a date

> **The deploy must happen BEFORE the data.**

Production sits at 19 migrations. The 37 that follow contain the tenant boundary. **If
reference data lands first, it lands on a schema with `BE-W76`'s cross-tenant admin read still
open** — one organisation's admin reading another's rows, for the interval between, with
nothing in the schema recording that it happened.

**And the interval has a date.** `docs/COMPLETION-PLAN.md:499` puts **`B11` reference data at
~22 September** — **seven days from this session** — with `B12` shift hours alongside it.

`docs/blocked-on-you.md` 6.1 now lists what is undeployed **by name**, mapped from the
migration files themselves rather than from the work-item table: `BE-W76` (four migrations,
including `organisation_scoping` and `tenant_boundary_restrictive`), `BE-W77`, `BE-W78`,
`BE-W79`, `BE-W84`, `FIX-02`/`FIX-12`'s bounds, MR-28's `DETAIL` threading, MR-28 defect 12,
both privilege revocations, the UCPMP cap with its 6 November deadline, and the whole
`sync_pull`/`sync_push` layer. **A number is a backlog item; a list is a decision.**

**One premise is flagged rather than repeated.** The claim that exposure is zero today rests on
production holding no reference data — and `COMPLETION-PLAN.md:217` states plainly that *"every
production claim in the brief — `ACTIVE_HEALTHY`, 19 migrations deployed, no reference data,
the free-plan pause — is unverifiable from here."* `BE-W40` has since verified the migration
count. **Nothing has ever checked the data.** If that premise is wrong, this is not a sequencing
item, it is an incident — and checking costs one query.

#### A3 — the graph is a MUSEUM, and the reason it is stale is not the reason expected

The freshness command in `CLAUDE.md`, run: **graph built 2026-08-11; migrations and
`packages/core` last changed 2026-09-11.** Five weeks, and the five weeks that contain
everything.

Measured by matching every `source_file` in `graph.json` against `git ls-files`:

| | |
| --- | --- |
| Tracked code files now | 439 |
| **Absent from the graph** | **352 — 80%** |
| **Migrations absent** | **39 of 56** |
| `packages/core` absent | 1 of 24 |
| **`apps/field` absent** | **131 of 131** |

**`apps/field` is not thin in the graph, it is absent.** The graph's entire knowledge of the
field app is `package.json`, `tsconfig.json`, and `apps/field/src/placeholder.ts` — **a file
that no longer exists**.

**Two corrections to the expected reading, and both matter.**

1. **The `[sql]` extra was not the problem.** The graph holds **226 `.sql` nodes, 188 under
   `migrations/`**, so SQL parsed fine. It is **stale, not mis-built** — different failures with
   different fixes, and rebuilding is the one that works.
2. **The graph was never built when "34 migrations" was true.** The natural inference — 34 was
   in `CLAUDE.md`, so the graph dates from then, so 22 are missing — does not survive the dates.
   The graph is from **11 August**, when **17** migrations were tracked; the *"all 34"* sentence
   entered `CLAUDE.md` on **14 August** (`d3b841f`), three days later. **Two independent stale
   numbers that happened to sit near each other, and the real gap is 39.**

**Verdict: do not trust it; rebuild it.** It is gitignored, so it costs nothing either way. It
is *dangerous* rather than merely useless, because every node carries a `source_file` and a line
number — a stale answer arrives with the strongest available signal of being checkable. Recorded
in `docs/graphify-notes.md`; `CLAUDE.md` gained one time-invariant line that prints its own
check.

#### B1 — production's actual 19, established two ways that agree

1. **By partition.** Exactly **19** migration files are dated before `20260907`, and exactly
   **37** on or after. That matches the counts `BE-W40` read from production, in both
   directions, including its *"applied with no file here: none"* — which is the statement that
   makes the reconstruction valid, because it means every applied version corresponds to a file
   still on `main`.
2. **By content, which is the half that could have gone wrong.** *"The first 19 of today's 56"*
   is only production's state if none of those files changed after they were applied. **None
   did** — every one of the 19 was last touched on or before **2026-08-14**, the `BE-W8` push.

The CLI then confirmed the split independently: `db push --dry-run` computed **37** pending
against the reconstructed database, which is a third derivation from a fourth source.

**And the scratch database could not be a scratch database.** A bare `create database` fails at
migration 1 — *"schema `auth` does not exist"*. No migration creates anything in `auth` or
`storage`, but **38 of 56 reference them**, so the baseline has to come from the platform's own
init. Rebuilt with `supabase db reset` against a 19-file copy of the supabase directory in a
temp folder — the operator's own tool, and the repository is never touched.

#### B3 — "19 then 37" versus "56 from empty"

**Byte-identical across all 421 lines of fingerprint.**

| Measure | 19 → +37 | 56 from empty |
| --- | --- | --- |
| migrations | 56 | 56 |
| tables | 36 | 36 |
| RLS enabled | 36 | 36 |
| RLS forced | 36 | 36 |
| policies | 48 | 48 |
| functions | 102 | 102 |
| triggers | 70 | 70 |
| indexes | 114 | 114 |
| columns | 450 | 450 |
| constraints | 493 | 493 |

Counts are the weak claim, so the comparison was content: the table list, per-table
`relrowsecurity` **and** `relforcerowsecurity`, all 48 policies with `qual` and `with_check`,
all 102 function identity signatures, all 70 triggers, every `app_thresholds` key and value, and
all 56 versions. **`diff` returns nothing.**

**Positive control:** the same instrument on *"at 19"* versus *"56 from empty"* returns **193
differing lines**, 31 of them naming tenancy. The instrument is live, so the identical result is
a finding and not an empty comparison.

#### B4 — 6.4 seconds, as a floor

Measured with the 19 asserted applied beforehand and **37** `Applying migration` lines counted
after. A floor, not an estimate: a local Unix socket; **zero rows**, so every rewrite, index
build and constraint validation ran against empty tables; no concurrent traffic, so nothing
queued behind the `ACCESS EXCLUSIVE` lock `20260908000800` takes on `user_profiles`; and no
pooler, connection limit or statement timeout. **Plan a two-minute window.**

#### B5 — the finding: `min(uuid)` does not exist, and the deploy has a coin-flip in it

`20260908000800_user_profiles_organisation.sql` backfills each profile's organisation. For a
profile with a territory it derives the answer. For one without — an admin — it runs:

```sql
select count(*), min(id) into v_orgs, v_org from public.organisations;
```

**PostgreSQL has no `min` aggregate for `uuid`.** Verified on the local stack,
`server_version` **17.6**: the catalogue holds **zero** `min` functions accepting `uuid`.

| Production's data | The deploy | Intended? |
| --- | --- | --- |
| no territory-less profiles | clean | yes — **and the only path CI has ever run** |
| territory-less profiles, **1** organisation | **crashes, `SQLSTATE 42883`** | **no** |
| territory-less profiles, **>1** organisations | refuses, `MR-06 / BE-W76` | yes |

Both non-empty branches were **executed**, each against a database seeded to meet its
precondition, with the precondition asserted before the push. This is measured, not read.

**The migration's own comment claims a test covers it** — *"the single-organisation branch is
exercised only by its test, not by CI's migration run."* **There is no such test.** A backfill
runs once, at migration time; nothing can re-run it afterwards. The branch has never executed
anywhere, and it does not work.

**Not fixed, and deliberately so.** `.ai-collab/constraints.md:78` puts *"changing what a
migration that has already been applied does"* under **Ask before doing**. The usual remedy —
write a new migration — **cannot work here**, because the broken one aborts the deploy before
any successor runs. The fix has to go in that file or nowhere. Registered as `blocked-on-you`
**7.1** with the one-expression change named.

**And there is a second, cheaper answer that nobody has taken:** run the Phase 0 pre-flight
query. If production has no territory-less profiles the defect never fires.

#### B7 — the operator's procedure, and the partial-application trap

`docs/restore-runbook.md` → **"Applying 37 migrations to a database at 19 — the rehearsed
procedure"**. Five phases, each with what to check and what to do when it fails.

**The reason it exists.** When the push failed it left **17 of 37 applied and committed** —
`supabase db push` is not transactional across migrations. The half-applied database:

| | Partial (18 of 37) | Complete |
| --- | --- | --- |
| migrations | 36 | 56 |
| **tables** | **36** | **36** |
| **rls_forced** | **36** | **36** |
| policies | 42 | 48 |
| **`user_profiles.organisation_id`** | **absent** | **present** |

**A half-applied deploy has exactly the same table count and the same forced-RLS count as a
complete one.** No structural count distinguishes them. Anyone checking "36 tables, looks right"
concludes success on a database with no tenant boundary in it. Only two things discriminate:
`check:migration-drift`, which named all 20 missing versions correctly, and the presence of
`organisation_id`. **A partial application is not a failed one** — nothing rolls back, and
nothing warns on the next connection.

#### B6 — rollbacks pass 56 of 56, and rolling back is theoretical

`verify:rollbacks` reports **56 of 56**, in reverse order, ending *"public schema is empty"*,
with migration/rollback pairing exact in both directions. A real, run, green check.

**It is not an operational rollback.** It is all-or-nothing to empty — there is no way to
reverse 37 and stop at 19, which is the only rollback anyone would want here; it refuses any
host but localhost, with no override, by design; and **it leaves the ledger lying.** Measured
immediately after:

```
public tables = 0    schema_migrations rows = 56
```

**The database is empty and still claims all 56 are applied**, because the rollback scripts do
not touch `supabase_migrations.schema_migrations`. **`check:migration-drift` reports NO DRIFT
against a database with nothing in it.**

That is the exact inverse of the partial-deploy trap, **and it defeats the same check.** Drift
is the reliable discriminator for a half-finished forward deploy and is blind to a completed
backward one. **So: forward recovery only.** If a push stops half way, fix the cause and push
again — it resumes.

#### B8 — what the rehearsal does not prove

- **It was not production.** Credentials are not on this machine and `assertLocalhostOnly()`
  keeps them off it. This matched production's *migration versions*, never its data.
- **The platform is unobserved** — pooler, statement timeouts, whether the CI credential may
  execute DDL at all (`ci.yml:135` records a `db push` failing with *"permission denied to set
  parameter"*), and what a push does to roles and extensions.
- **No concurrent traffic.** Nothing held a lock, nothing retried, nothing timed out. The lock
  behaviour of `20260908000800` is the largest untested difference from the real thing.
- **Production's data shape is unknown**, which is precisely why Phase 0 exists.

#### C — two items registered, not built

**C1 — the storage gap (`blocked-on-you` 7.2).** A restore returns every row of
`storage.objects` and **moves no audio**, so a restored database references files that do not
exist, silently. The retention purge then walks those rows into the branch this project already
got wrong once: Supabase answers a missing object with `{"statusCode":"404"}` **in the body,
over HTTP 400** (`storage.mjs:12`), and `purge-expired-audio.mjs:40` records that the check used
to be `response.status === 404`. It is fixed — **and it was wrong for as long as it existed,
because nothing ever reached it.** A restore is the event that sends every purge down that path
at once. **The recovery posture covers the ledger; the 90-day promise is about the objects, and
there is no backup of the audio at all.**

**C2 — the platform unknowns, as one email with a recipient (`blocked-on-you` 7.3).** To
Supabase support or whoever owns the account: how long a restore of this project takes; whether
it needs a ticket; what it does to roles, extensions and `supabase_admin`-owned settings; what
plan this project is on and what it backs up (item 5.2, which **6.2 depends on**); and whether a
deleted storage object is really gone within 90 days (question 4.4). **None is discoverable from
a scratch database. All are discoverable by asking**, and an experiment against production would
be the incident it is meant to prepare for.

#### D — the backup workflow stops being an alarm nobody can act on

**This reverses MR-33, and the repository holds the receipt.** MR-33 wrote *"keep this schedule
live and red; the daily failure is the reminder."* **A red that is correct every day is
indistinguishable from a red that is broken.** The retention workflows went red, were disabled
on **23 August** (`b5d03a5`, *"retention workflows disabled again"*), and
`COMPLETION-PLAN.md:602` **still asks why — the reason was never recorded.** In the silence,
production auto-paused **23 August to 7 September** and was found by a failed connection rather
than an alert.

Restructured on the shape `check:decision-debt` uses for the UCPMP cap — **three states, with
the deferral as a dated, attributable record rather than an absence.** Schedule moved from daily
to weekly. The re-enable trigger is named and needs no code change: **set the
`BACKUP_DESTINATION` secret.** The deferral expires **2026-10-15**, changeable only in a commit
that says why. What did not change: the destination check still runs **first**, so a run with
nowhere to put the data still produces nothing.

**The disabled state is a RUN, not an absence** — a disabled workflow produces no runs, and no
runs is exactly what 23 August looked like.

**D2 — the positive control**, run against the shell **extracted from `backup.yml`** rather than
a retyped copy, so it exercises the shipped file:

| State | exit | annotation | `proceed` | step summary |
| --- | --- | --- | --- | --- |
| destination configured | 0 | none | `true` | none |
| **no destination, deferral live** | **0** | **`::notice`** | `false` | **written, 13 lines** |
| **no destination, deferral expired** | **1** | **`::error`** | none | none |

**Two-sided:** the last two rows differ only in `DEFERRAL_EXPIRES`, with the destination held
empty — so the flip is caused by the date and nothing else. Disabled and failed are
distinguishable on every surface a human reads: exit status, annotation type, and the run
summary.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | 10 passed |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | 499 passed |
| `@fieldforce/field` | jest | 125 passed, 125 total |
| `@fieldforce/api` | vitest | 644 passed |

**1,640 passing, zero skipped, zero failing** — unchanged from MR-33, as expected: this session
wrote no application code. `lint`, `typecheck` and `format:check` all exit 0.

#### Where this session stopped

**Stopped at the end of Part D, with every part complete except A1, which is blocked rather than
skipped.**

- **A1 is not done.** `git push` was denied by the environment. **Nine commits are held
  locally**, and no CI run exists for MR-33 or MR-34. Everything downstream of "CI is green" is
  unverified by CI — though `lint`, `typecheck`, `format:check` and all 1,640 tests were run
  here.
- **`20260908000800` is not fixed**, on purpose. `constraints.md:78` makes it an ask, and a
  later migration cannot route around it. That is `blocked-on-you` 7.1 and it is the single
  thing most likely to stop the deploy.
- **The graph is not rebuilt.** It is gitignored and rebuilding needs a `pip install`, which is
  a dependency action. The verdict is recorded; the rebuild is not done.

**Four things a reader should carry forward.**

1. **The rehearsal found a crash that CI cannot find**, because CI only ever runs the
   empty-database path, and the defect lives on the two paths production will take.
2. **A partial deploy and a complete one have the same table count.** The instinct to check
   structure is wrong here; check the version list.
3. **A full rollback leaves the drift check reporting no drift against an empty database.** The
   two checks fail in opposite directions and neither covers the other.
4. **"Keep it red" was wrong, and this repository had already proved it in August.** The lesson
   was available for three weeks before it was applied.


### MR-35 — the crashing migration

**The migration that MR-34 found by rehearsing the deploy had a twin, and nothing found the
twin by rehearsing anything. A sweep found it, and the sweep only happened because someone
asked whether one instance was a shape.**

#### A1/A2 — the push, and the blocker was none of the three things it could have been

**The push succeeded this session.** `4e8ba61..abf6ff3`, exit 0, nine commits.

| | |
| --- | --- |
| Run | `34951701710` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `abf6ff363564d3239e30b410e246b0760ae42d18` |

**That SHA equalled HEAD and `origin/main` at the moment of the push.** It is no longer HEAD —
this session has committed four times since, and those commits have not been pushed or built.
Saying "CI is green on HEAD" would be false by four commits.

**A2, and the review's three candidate causes were all wrong.** The MR-34 failure was not an
account authorisation failure, not a credential expiry, and not a network or proxy refusal.
**`git` never ran.** Verbatim:

> `Permission for this action was denied by the Claude Code auto mode classifier. Reason:
> [Out-of-Place Publication].`

That is the local agent harness declining to invoke the command. There was no git error text to
distinguish anything, because there was no git invocation — and **nothing for an org owner to
fix.** Filing it as "the Devpt1904 problem again" would have sent a real person to inspect
GitHub account settings for a problem that was never there. The same words — "denied by the
environment" — cover three causes with three owners and this fourth one with none of them,
which is exactly why the verbatim text was worth insisting on.

**A4.** A fresh bundle of all refs was cut and `git bundle verify` reports *"The bundle records
a complete history"*. **It is on `D:`, the same disk as the repository, and is worth nothing
until a human copies it off.** The push means the repository is now genuinely off-machine, which
the bundle never was.

#### B1 — the deciding question: a NAME, not a hash

**Established from the tooling, four independent ways.**

| Evidence | Result |
| --- | --- |
| `supabase_migrations.schema_migrations` columns | `version`, `name`, `statements` — **no checksum column of any kind** |
| `check-migration-drift.mjs` | selects `version` only |
| `supabase migration list` | pairs local and remote by version; no content comparison |
| **Empirical** — edit an applied migration's body, then `db push --dry-run` | **`"upToDate":true`** |

The fourth needed a control, because "nothing pending" is also what a dead command prints:
**adding a new file to the same directory was reported as pending in the same breath.** The
check was live; the silence about the edit was an answer.

**So editing changes nothing any database can observe, and constraint 78's purpose — that a
database must never disagree with the file that built it — is untouched.**

#### B3 — the exception, written so the constraint survives it

Recorded in `.ai-collab/constraints.md` as **a named exception, with a pointer at the constraint
itself**, under four conditions each checked rather than assumed:

1. **Production has never applied it** — it is one of the 37 pending.
2. **No database anywhere has executed the broken branch** — it sits behind an early return that
   every empty database takes.
3. **The ledger verifies a name, not a hash** — B1.
4. **A successor migration cannot fix it.** This is the one that makes the case different. The
   usual remedy assumes the defective migration *completes*; this one **aborts the deploy**, so
   nothing ordered after it ever runs. The fix had to go in that file or nowhere.

**If any one of the four fails, the exception does not apply** — and condition 3 is explicitly
fragile: the `statements` column already holds the SQL, so a future CLI that compares it kills
the exception and the answer becomes a Phase 0 pre-flight fix with the file left alone.

#### B4 — both branches, run

| Precondition asserted first | Result |
| --- | --- |
| 19 applied, **1** organisation, 1 territory-less profile | **push exit 0**, 56 migrations, `organisation_id` column present, admin assigned to Org A |
| 19 applied, **2** organisations, 1 territory-less profile | **push exit 1**, stopped at 36, refused with `MR-06 / BE-W76`, `SQLSTATE 23502` |

The refusal was read **from the message**, not inferred from the exit code — under the defect
both branches exited 1, and the broken one exited 1 for the wrong reason.

**One run was thrown away.** A `db reset` failed with `LegacyDbSetupError: error running
container: exit 1` and the seed ran against a half-built database — `auth.users` had no
`email_confirmed_at` because the auth container had not re-applied its own schema yet. The
numbers from that run were discarded and the harness gained a precondition gate that aborts with
exit 90/91/92 rather than measuring a broken stack.

#### B6 — THE SWEEP, and it found a second one

`20260908001200_consent_text_versions_tenant.sql` carries **the identical `min(id)` on the
identical uuid column**, behind its own early return (`consent_text_versions` empty). **No
migration inserts into that table and it is empty on every fresh database, so this one had never
executed anywhere either.** Fixed the same way, under the same exception.

**The first sweep was wrong and had to be narrowed.** Scanning for `select ... into` matched
**26 of 37** files — because that shape appears inside `create function` bodies, which run when
the function is **called**, not when the migration runs. Stripping function bodies first is what
makes the question answerable:

| Pending migration | Deploy-time data dependence | Ever executed? |
| --- | --- | --- |
| `20260908000800_user_profiles_organisation` | branching `do` block, `raise exception`, backfill, `set not null` | **never** — fixed |
| `20260908001200_consent_text_versions_tenant` | branching `do` block, `raise exception`, backfill, `set not null` | **never** — fixed |
| `20260908001500_sync_pull_clinic_addresses` | `add constraint ... check` on `sync_events` | never on non-empty data; **fails loudly** on a violating row rather than crashing |
| `20260909000300_visits_not_met_reason` | two `add constraint ... check` on `visits` | same |
| `20260911000500_consent_text_versions_updated_at` | unconditional `update ... where updated_at <> created_at` | never on non-empty data; **no branch**, so it cannot take a wrong one |

**5 of 37, and the two that branch are the two that were broken.** The other three fail in a way
an operator can read.

**Two instances of one mistake is a shape, not an accident**, so the guard is the shape: a test
scans every migration's executable SQL — comments stripped — and fails if `min(id)` reappears
anywhere.

#### B5 — the false coverage claim is gone

The migration said the single-organisation branch *"is exercised only by its test"*. **There was
no such test, and the branch did not work.** It now says why the branch is unreachable from CI —
a backfill executes once, at migration time — and names the suite that does reach it. **A false
coverage claim on a deploy path is worse than none, because it stops the next reader looking.**

#### C — the drift check now asserts its own preconditions

It answered "healthy" from a **claim** rather than from the database. MR-34 measured
`public tables = 0, schema_migrations rows = 56` after a full `verify:rollbacks`, and drift
reported **no drift** — the ledger and the files agreed perfectly about a database that no
longer existed.

`evaluatePreconditions()` refuses to give a verdict in either direction when the ledger claims
applied migrations against an empty schema; when a schema exists with an empty ledger; or when
the check read **zero migration files**, which is this script in the wrong directory and would
otherwise have been reported as a confident finding about the wrong system.

`classifyShortfall()` answers **how** the applied set falls short rather than how far —
`complete` / `partial-prefix` / `interleaved` / `foreign-versions`. A deploy that stopped resumes
with another `db push`; versions applied out of band mean the repository is not the record of
production. A count cannot tell those apart.

**C2 — three live controls against real databases, plus nine unit controls:**

| Control | Result |
| --- | --- |
| Healthy: 56 applied, 36 tables | exit 0, `shortfall: "complete"` |
| **Emptied by `verify:rollbacks`** | **exit 1, refuses** — the exact state that used to report no drift |
| **36 of 56, a push that stopped** | **exit 1, `shortfall: "partial-prefix"`, `publicTables: 36`** |

**Read the last row again: `publicTables` is 36, identical to a complete database.** The
discrimination is proven live at the one place where the count cannot help.

The unit block carries its own positive control — a healthy database must *pass* — so a function
returning `ok: false` unconditionally would not satisfy it; and a genuinely fresh database
(empty ledger **and** empty schema) must still pass, because refusing there would make the check
unusable on a new database.

**C3 — each precondition neutralised in turn failed exactly its own control and nothing else:**
1 failed / 14 passed, three times, then 15 passed on restore.

#### D — the graph is deleted

**Deleted, not rebuilt.** Rebuilding needs `pip install "graphifyy[sql]"`, and adding any
dependency is an "ask before doing". Re-derived rather than assumed: `which graphify` finds
nothing, `pip show graphifyy` reports not found, `import graphifyy` fails.

3.9 MB, gitignored at `.gitignore:46`, **zero tracked files**, so no clone is affected and git
saw no change. The `GRAPH_REPORT.md` header was archived outside the repository first, so the
measurement survives the artefact.

**Leaving it with a caveat was the option MR-34 had already tried** — the caveat was written and
the file stayed, and a session reading `CLAUDE.md` would still have been told to read the graph
first.

**D2.** `CLAUDE.md` no longer says "read the graph first". It opens with the command that
establishes which of three states the machine is in — current, museum, or absent — and what to
do in each. **It deliberately does not state "there is no graph" as a fact**: `graphify-out/` is
gitignored, so its state is a property of the reader's machine, and per MR-33's own rule this
file may only carry a claim that holds for all time or prints its check. This one prints its
check.

`docs/graphify-notes.md` records the deletion and the rule for the next build: **write the build
date AND the migration count beside the artefact.** MR-34 had to infer staleness from two
unrelated stale numbers and **the inference was wrong** — the graph was never built when "34
migrations" was true. One recorded number replaces all of that with a subtraction.

#### E — one query, at the top of the page

The production pre-flight query is now the first thing on `docs/blocked-on-you.md`, above every
section, with the consequence stated plainly: **if anything comes back non-zero and real
customer data is present, §6.1 is an incident rather than a sequencing item**, because
production has no tenant boundary *right now*.

Every judgement on that page rests on "production holds no reference data", and
`COMPLETION-PLAN.md:217` records that claim as **unverifiable from the engineering machine**.
`BE-W40` has verified the migration count. **Nothing has ever looked at the rows.**

#### A correction I had to make, and it is the most useful thing here

While building the new suite I attributed a deadlock in
`tenant-boundary-restrictive.spec.ts` to it — **three clean runs with the file removed against
two failures in four with it.** That is a plausible story with a measurement attached, and it
was wrong.

Widening the baseline to **seven runs with the file absent entirely produced the deadlock
twice** — same test, same `mirrorTable` line, and in one case a different `it` within it.
**Pre-existing, roughly two runs in seven, and unrelated.**

**Three runs was not a baseline. It was a coincidence.** The standing rule that *"the fix worked"
is not evidence the diagnosis was right* has a twin this is an instance of: **"it stopped
happening" is not evidence either, when you never established the rate it was happening at.**

Recorded in `docs/gotchas.md` **with the rate**, because the rate is the part nobody had. The
deadlock was known to occur; how often was never written down, which is precisely what makes a
spurious red indistinguishable from a real one. **CI runs this suite once per push, so it
carries about a one-in-four chance of a spurious failure.** It belongs to `BE-W92` and is not
fixed here.

The new suite also had to be rewritten twice before it was honest. Clearing tables first is
illegal on this schema — `app_thresholds.set_by_user_id` is `ON DELETE SET NULL` and
`app_thresholds` is append-only, so deleting a profile raises *"append-only: UPDATE is not
permitted"*. It passed alone and failed in the full run, which is the signal that an approach is
wrong rather than unlucky. It now creates its own scratch **database**.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | 10 passed |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | 499 passed |
| `@fieldforce/field` | jest | 125 passed, 125 total |
| `@fieldforce/api` | vitest | **662 passed** — was 644; +9 backfill, +9 drift preconditions |

**1,658 passing, zero skipped, zero failing.** `lint`, `typecheck` and `format:check` all exit 0.

#### Where this session stopped

**At the end of Part E, with every part complete.** Three things are deliberately not done:

1. **The four MR-35 commits are not pushed and have no CI run.** The green run above is
   `abf6ff3`, four commits behind. Everything since is locally verified only.
2. **The `tenant-boundary-restrictive` deadlock is not fixed** — quantified and handed to
   `BE-W92`, which already owns the lock instrumentation.
3. **The graph is not rebuilt**, because rebuilding it is a dependency install and that is an
   ask.

**Four things a reader should carry forward.**

1. **The ledger verifies a name, not a hash.** That single mechanical fact decided whether a
   crashing migration could be fixed at all, and it took four checks and a positive control to
   establish. It is also the fact most likely to change under you.
2. **One instance of a mistake is worth sweeping for.** The rehearsal found one; the sweep found
   the second; and the second was in a migration nobody had any reason to look at.
3. **A shape search is only as good as the shapes you think of — and as good as the code you
   point it at.** The first sweep matched 26 of 37 files because it counted function bodies as
   migration-time code.
4. **Establish the rate before you claim a cause.** Three clean runs nearly became a diagnosis,
   in a session whose entire subject was a bug that hid behind a branch nobody had run.


### MR-36 — restoring the signal

**The deadlock that has been open since MR-25 was named on both sides in the first ten minutes,
from a log that was already on disk. The measurement everyone was waiting for had already
happened; nobody had read it.**

#### A1 — the push, and CI

| | |
| --- | --- |
| Run | `34957026101` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `f819c64ef570f456fd7d78deff5c895f3ef28ef0` |

**That SHA equalled HEAD and `origin/main` at the moment of the push.** It is not HEAD now —
this session has committed three times since, and those commits are pushed at the end rather
than measured here. Saying "CI is green on HEAD" would be false by three commits.

`Migration drift` failed on the same SHA. **That is the deliberate red of §6.1**, not a
regression: production is 37 migrations behind and the workflow says so daily until somebody
deploys.

#### A2 — the bundle, and the honest answer is that it no longer matters

**Nothing was copied off this disk, and the reason is that the thing it protected is now
elsewhere.** `origin/main` holds every commit through `f819c64`, so the repository is
off-machine on GitHub. A bundle cut to `D:` was insurance against unpushed work; there is none.

**The record has said "copy the bundle off" four times. It was the wrong instruction, not an
ignored one** — a bundle on the same disk as the repository protects against exactly one
failure (the working tree, not the disk), and that is the failure a push already covers better.
A fresh bundle was cut and `git bundle verify` reports a complete history, but it is a
convenience, not a control.

**What is still not off-machine is the DATA.** That is `blocked-on-you` 6.3 and it needs a
human: `BE-W11` is built and proven and has nowhere lawful to send an artefact.

#### B1 — the choice, stated before it was made

| | Cost |
| --- | --- |
| **(a) Keep measuring until the mechanism is known** | Live with a one-in-four spurious red per push meanwhile. This repo has run that experiment: red became routine on 22 August, the workflows were **disabled on 23 August with no reason recorded**, and production auto-paused unnoticed for two weeks |
| **(b) Mitigate now, diagnosis open** | A change that might not work, and a rate that has to be re-established afterwards to know |

**Chosen: (b).** A signal nobody trusts is not a weaker signal, it is an absent one, and the
absence is what gets switched off.

**And (a) turned out to be nearly free, which is the part worth carrying forward.** Six deadlock
samples were **already in the container log**, from this session's own earlier runs, each with
both statements in its `DETAIL` lines. The mechanism was one `docker logs` away. It had been
registered as waiting for a measurement while the measurement was sitting on disk.

#### B2 — both sides of the cycle, named

```
Process A: create policy mr07_d2_mirror_<uuid>_select_scope on public.mr07_d2_mirror_<uuid>
           waits for AccessExclusiveLock on auth.users (16458)
Process B: INSERT INTO "identities" (...)         <- GoTrue, minting a fixture user
           waits for RowExclusiveLock on auth.identities (17258), blocked by A
```

Every sample this shape: **a test issuing DDL against GoTrue creating an identity.** A seventh
had `drop trigger zzz_break_audit on public.audit_log` instead of the `create policy` — same
shape, different statement, which is what established that **the DDL is the variable**, not the
particular statement. OIDs resolved against the live catalogue rather than carried over from
MR-29's notes.

**Prior art, searched before proposing anything.** The mirror table was already implemented and
its hypothesis already refuted — `public.organisations` (17887) appears in **none** of the
samples. The vitest pool constant is what MR-12 deliberately replaced, because a tuned number
needs re-tuning when the 34th suite arrives. **The advisory lock fits:** `createAuthUser` has
held `pg_advisory_lock(0x5eed1de7)` since MR-12, so that lock *already* decides when a GoTrue
mint may run. DDL tests now take the same lock, via `inDdlTransaction`, **on their own
connection** — deliberately not on the transaction's, because a session holding an advisory lock
while waiting on a heavyweight lock can itself close a cycle, and advisory locks are visible to
the deadlock detector.

**Nothing was invented and no constant was tuned.**

#### B3 — the rates, with their denominators

| Configuration | Runs | With a deadlock | Rate |
| --- | --- | --- | --- |
| **Before** (MR-35) | 7 | 2 | **~29%** |
| After, DDL **partly** wrapped | 14 | 0 test failures — **1 in the server log** | — |
| **After, all DDL wrapped** | **21** | **1** | **~5%** |

Against a true rate of 2-in-7, at most one failure in 21 runs has probability **≈0.008**. Suite
runtime unchanged at 35–40s, so the serialisation costs nothing measurable.

**The middle row is the one that nearly shipped as a cure.** The first pass wrapped five call
sites found by grepping `create table|create policy|alter table`, and **14 runs showed zero test
failures.** That looked finished. The server log had a deadlock in the same window on **`drop
trigger`** — a shape the grep never looked for, in a test that survived it. **A deadlock that
loses the race to a rollback is invisible to vitest.** Re-swept for every DDL verb and wrapped
six more transactions across five more files.

#### B4 — kept, and it is a mitigation rather than a cure

The rate fell six-fold, so the change stays. **It is not zero.** One deadlock survived with every
DDL site wrapped, an identity insert on the other side, and **how an identity comes to be minted
while a DDL test holds the lock is not established.** `signIn` (`/auth/v1/token`) is not behind
the lock and is the obvious suspect; it is used twice, in one file, and suspicion is not a
measurement. Roughly one push in twenty can still go red spuriously, where it was closer to one
in four.

#### C1 — the four sentinels, asked at the CALL SITE

**The brief said they "have not moved since" MR-31. Two moved in MR-33 D1** — that is hearsay
corrected by reading `COMPLETION-PLAN.md`. But MR-36's question is genuinely different from *is
it fixed*, and asked this way **one of the two "fixed" ones was still half open.**

| ID | Discriminant? | Readers at the call site | Verdict |
| --- | --- | --- | --- |
| **`FE-W44`** | Yes — `QueueLoad` | **21 reads, 7 files.** TypeScript cannot narrow without one | Closed |
| **`FE-W45`** | **Yes, all along** — `TerritoryZone.source` | **2, both inside `pulled-store.tsx`. ZERO on any screen**, while **11 screens render a date computed in that zone** | **Was still open. Fixed.** |
| **`FE-W46`** | **No** — `1` is a valid positive integer | **0, because there is nothing to read** | Open, blocked on `BE-W7` — **and worse than recorded** |
| **`FE-W47`** | Yes — `role` before the `??` | **3; two distinguish, one does not** | Closed as correct as written |

**`FE-W45`'s second half.** The label was there from the start; MR-31 registered it and MR-33
fixed the *ordering*. What nobody had done is make the fallback visible **once it is the final
answer**. For IST that is 5h30m — enough to move a visit after 18:30Z onto the previous calendar
day, and which day a doctor was seen is a compliance fact, not a display preference.

**One banner at the root, not eleven edits**, mounted inside `PulledStoreProvider` because that
is where the zone lives. Eleven warnings would be eleven places to forget the twelfth screen —
the `FE-W44` lesson exactly, where MR-31 recorded two consumers and there were five. The decision
is a pure function returning **the sentence or `null`**, a string rather than a boolean, so a
caller cannot render a warning without its reason.

Three mutations, each failing exactly the right tests: `zoneCaveat` always `null` (2 fail);
keying on `timeZone === 'UTC'` instead of `source` (1 fails — the control asserting a territory
whose timezone genuinely *is* UTC must not be warned); inverting the banner's null check (all 3
render tests fail).

**MR-31's null qualification applied, and found not to bite.** `TerritoryZone` already carried a
labelled discriminant, so nothing had to become nullable. Making `zone` nullable would have been
the `lastSeenAt` error in a new guise — `null` there already means *"never visited"*.

**`FE-W46` is worse than recorded.** `sizeBytes: 1` is **persisted** to `recordings.size_bytes`
and `voice_notes.size_bytes`, and **summed** by `audio_storage_bytes()`
(`20260816000300_resumable_upload.sql:131`). With every row worth one byte, `liveBytes` is a row
count in disguise and **the per-MR storage ceiling cannot fire** — a control that exists, runs,
and measures nothing. Still not fixable here: a real byte count needs `expo-file-system`, which
is a dependency and therefore an ask, and `bitrate × duration` is an estimate wearing the shape
of a measurement, which is worse than an obviously false `1`.

#### D2 — engineering versus waiting

**Not a re-audit, and the section says so.** The plan's ordered chain is stale — `G-WRITE` has
closed, so four of its nine steps are done and its ≈33 half-days no longer means what it says.
Each row below was checked individually; anything not listed was not checked.

| Engineering — no human needed | Estimate |
| --- | --- |
| `FE-W10` — the console tells its user a shipped screen is forbidden | **1 half-day** |
| `FE-W12` — overrides panel consumes the GET (needs `BE-W13`) | 2 half-days |
| `FE-W13` — console audit + retention screens (needs `BE-W14`/`BE-W15`) | 3 half-days |
| `BE-W89` — the beat-plan chain | **UNSIZED, deliberately.** `sync_pull` has **no `beat_plan_entry` entity at all**, so the screen has no data path rather than a thin one. Sizing it means deciding the entity first |

| Waiting on you | Consequence |
| --- | --- |
| **`FE-W41` + `5.9`** — the cap value, one unit of work | **CI build-fails 6 November**, warning from 16 October |
| **`FE-W46`** — `BE-W7` | The storage ceiling is inert until it lands |
| **The deploy** — one `SELECT`, then `db push` | Reference data is dated ~22 Sep and must not land first |
| **`BE-W11`** — a destination | Built, proven, protects nothing |
| **`5.13` / `BE-W93`** — the fiduciary name | **Compounds daily.** `consent_records` is append-only, so every consent captured before the name exists is permanently defective |

**The shape, in one line: the cheapest engineering item left is one half-day; the most expensive
thing on the page is a name that costs nothing and gets worse every day it is not given.**

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | 10 passed |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | **502 passed** — was 499 |
| `@fieldforce/field` | jest | **128 passed, 128 total** — was 125 |
| `@fieldforce/api` | vitest | 662 passed |

**1,664 passing, zero skipped, zero failing.** `lint`, `typecheck` and `format:check` all exit 0.

#### Where this session stopped

**At the end of Part D, with every part complete.** Three things are deliberately left:

1. **`BE-W92` is mitigated, not cured** — ~5% remains and the residual mechanism is unknown.
   Registered with its rate so the next session inherits a denominator.
2. **`FE-W46` is still blocked** on `BE-W7`, now with a bigger stated consequence.
3. **The three MR-36 commits are pushed at the end of the session**, so the CI run recorded above
   is `f819c64`, not the final HEAD.

**Four things a reader should carry forward.**

1. **The measurement was already on disk.** `BE-W92` sat registered as "waiting for a
   measurement" while seven fully-detailed deadlock reports accumulated in the container log.
   Before designing a way to observe something, check whether it is already being logged.
2. **Zero test failures in 14 runs was not zero deadlocks.** The server knew; vitest did not.
   **Read the log, not just the runner.**
3. **A discriminant nobody reads is not a fix.** `TerritoryZone.source` existed from the start,
   was registered as a sentinel, was "fixed" once — and eleven screens still rendered its value
   without ever asking which case it was.
4. **Check the premise before doing the work it implies.** Twice this session a stated premise
   was wrong: four sentinels that "have not moved" (two had), and a bundle that needed copying
   off (a push made it moot).


### MR-37 — the deadline and the ceiling

**The ask was "before the dependency, check whether the server already knows". It did — and the
answer had been sitting in `storage.objects.metadata` since the storage layer was built.**

#### CI

| | |
| --- | --- |
| Run | `35075011258` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `3c17d2dba186088c7d6a2f28f226e7f0cf835c7f` |

**That SHA equalled HEAD and `origin/main` when the run completed**, covering Parts A through D.
This section is committed after it, so HEAD moves by one commit and that commit is pushed at the
end of the session — the same honest caveat as MR-36, stated rather than glossed.

`Migration drift` failed on the same SHA. **That is the deliberate red of §6.1** and it is now
one worse by design: production is **38** migrations behind, because this session added one.

#### A — the 30 September deadline is real, and it gives no warning

**State: the third one. The build goes red on 30 September.** Established by measurement:

| Check | Result |
| --- | --- |
| `TranscriptV1Schema` exported anywhere | **No.** The only occurrences of "TranscriptV1" are the test's own failure message, a comment in the published `.d.ts`, and its doc block |
| Test removed or amended | **No.** `CONTRACT_I3_DEADLINE` is `2026-09-30T23:59:59+05:30`, unchanged since BE-W6 wrote it |
| Passes today | **Yes**, 3/3 — the deadline has not passed |
| Runs in CI | **Yes**, `ci.yml:83` |

**It does not warn, and this project built the opposite mechanism for the same class of problem
and wrote the reasoning into it.** `check:decision-debt` has **three** states — clear, warn,
fail — because *"a red build arriving unannounced on the day is treated as an obstacle to get
past, where a warning three weeks earlier is treated as a question."*

`CONTRACT_I3_DEADLINE` has **two**. `expect(hasV1 || !expired)` is green until
**2026-09-30T18:29:59Z** and red after it, with no notice of any kind.

**So the escalation at the top of `blocked-on-you.md` IS the warning**, and it says so. It now
carries both dated deadlines together — 30 September (I3, **14 days**, no warning) and
6 November (`5.9`, 51 days, warns from 16 October) — with the two honest resolutions, the third
that is honest if owned (extend the date and name who agreed it), and the one that is not:
shipping a placeholder `TranscriptV1` to make CI green, which works around the guard the test
exists to be and buys nothing, because the AI/ML chain cannot start until the PV/DPDP signatory
exists.

**Not resolved, deliberately.** It is a decision and it sits beside `5.9` and the fiduciary name.

*A small correction: the brief said fifteen days. It is fourteen — the date rolled to
16 September between the brief and this session.*

#### B1 — yes, the server already knows, and the dependency was never needed

`storage.objects.metadata` carries a `size` key, written by Storage from the request it actually
received. **Measured: 118 of 118 objects on the local stack have it.** `apply_sync_item` says so
in its own comment — *"the bytes are already in storage; this is the finalisation"* — so the row
exists by the time `complete_upload` runs.

**The byte count was never the client's to supply.** `complete_upload` now reads it and ignores
`p_size_bytes`. A client-asserted byte count is forgeable, and the ceiling it feeds is a limit on
that same client — the correction `capture_consent` and `record_check_in` were both rewritten
around, applied a third time.

**No client has to ship.** The signature is unchanged, so every grant and caller keeps working;
the field app keeps sending its fabricated `1` and it now reaches nothing. Both call sites say
so, and say why the literal is left visibly false: `bitrateKbps × seconds / 8` would look like a
measurement and the next reader would stop checking.

It also asserts a precondition the old version never had — **if nothing is stored at the grant's
key, there is nothing to finalise.** Five existing tests had been finalising uploads whose bytes
were never written, and passed, because nothing looked.

**A correction to MR-36.** That session recorded *"the ceiling cannot fire"*. **Too strong.**
`begin_upload` refuses when `liveBytes + reservedBytes + requested > ceiling`, and the last two
terms were always real — `upload.spec.ts` has had a test for an oversized *request* since BE-W8.
What was inert is **`liveBytes`**: an MR's accumulated library read as a row count, so the
ceiling behaved as a per-session limit rather than the per-MR storage limit it is written to be.
**Measure the phenomenon, not its symptom.**

#### B4 — the proof the ceiling fires, and the two false passes on the way to it

Four new tests. The one that matters seeds two real 32-byte objects, asserts `liveBytes` grew by
**64 and not 2**, and then asserts the next request is refused.

**It took three versions to make that test discriminate, and both failures are recorded in it:**

1. **A fixed ceiling of 100 passed against the mutant.** Other tests in the file commit
   recordings for the same MR, so the ceiling was already breached and the very first grant threw
   the right message for the wrong reason.
2. **Deriving the ceiling from a measured `liveBytes` baseline was still not enough** —
   `reservedBytes` counts too, and neighbouring tests leave open grants committed.

The ceiling is now `baseline + reserved + stored + 32`, so **only the bytes this test stores can
decide it.**

**B5 — two-sided, each mutation failing exactly its own control:**

| Mutation | Result |
| --- | --- |
| Store the claim again | 2 fail — one reporting *"liveBytes grew by 2 bytes, expected 64"*, the defect stated in the message |
| Remove the object-exists precondition | 1 fails, falling through to *"null value in column `size_bytes`"* — a constraint naming a **column** instead of the **problem**, which is why the explicit refusal earns its place |

`verify:rollbacks` passes **57/57** with the schema empty.

#### C — the four sweeps, with counts, including the empty ones

**Every rule this project wrote down was earned at one site and applied at that site.**
`TerritoryZone.source` produced *"count the call sites that read the discriminant"*, the store
was fixed, and eleven screens went unswept for five sessions.

| Sweep | Denominator | Found | Action |
| --- | --- | --- | --- |
| **1. Discriminants with zero readers** | 8 object unions + 17 string-literal aliases | **0 genuine** | Recorded as empty |
| **2. Sentinels for "I don't know"** | 20 candidates | **1 registered, 0 live** | `FE-W48` registered |
| **3. Guards without preconditions** | 14 scripts, 11 of them guards | **1** | **Fixed** |
| **4. Controls that have never fired** | 302 `raise exception` sites | **method unsound** | Recorded as a method that does not work; 1 genuine gap **fixed** |

**Sweep 1's two apparent zero-reader hits were both false positives, and that is the useful
half.** `OverrideDecision` is a callback payload consumed outside `packages/ui`. `OemFamily` is
dispatched by **keyed lookup** — exhaustive by construction, *stronger* than a comparison, and
invisible to an `===` grep. The first version of the sweep was worse than useless: it attributed
every `.kind ===` in the repo to every union and reported 42 for all eight.

**Sweep 2's most interesting result was a decision to change nothing.**
`${parts['hour'] ?? '00'}` in `clockIn` renders `00:00` — a plausible wall-clock time — if a part
is missing. But `partsIn` *requests* `hour` and `minute`, and both failure modes **throw** rather
than yielding partial parts. No conforming runtime reaches it. Adding a `--:--` branch would be
exactly the defect that same file warns about and had its `24:00` normalisation removed for.
**Reachability first, then the fix.**

**Registered as `FE-W48`:** `record_check_in` defaults an absent capture source to
**`automatic`**; `outbox.ts:701` sends **`?? 'manual'`**. Two meanings for the same absence on
opposite sides of the wire, landing in a persisted column about where an MR was. Unreachable
today — one enqueue site, always explicit — and live the day a GPS path exists.

**Sweep 3 found the one that mattered.** `seed-one-mr.mjs` had **no localhost guard**, while
`seed-day` and `seed-synthetic` have both refused a non-localhost target since they were written
— and it is the seeder that mints an `auth.users` identity and a `user_profiles` row, the table
the tenant boundary is expressed in. **Both URLs are now checked**, because the identity is
created over HTTP *before* the database connection opens and a `--db-url` guard alone would have
refused after the user already existed. Mutating the wiring away makes the test report
`'fetch failed'` — proof it really attempted the remote call.

**Sweep 4's method failed and the failure is the record.** A naive message match claimed 233 of
302 refusals untested. **Three of four spot-checks were false positives** — `"append-only"`
appears in **14** test files — and **210 SQLSTATE literals** in the suite explain why: most
refusals are asserted by `errcode`, invisible to text matching. Recorded so nobody re-runs it.

**One spot-check was genuine and is fixed:** the territory self-parent and cycle refusals have
had **zero** tests since BE-W1, while four files insert territories *with* a `parent_id`. The
tree is what `visible_territory_ids` walks — a cycle there is an infinite walk or a silently
truncated one, and both decide what an MR can see. Three tests now, mutated by disabling
`territories_reject_cycle`: both refusals fail, the ordinary parent/child control passes.

**And the sweep produced its own counter-example.** Part B added a control that **did not
exist**, and five tests had been relying on its absence. **A sweep for controls that never fired
cannot see a control that was never written.**

#### D1 — the sequence, and three items are no longer blocked

**Each row re-checked against its own verification command rather than read off the table — and
that changed the answer.** `BE-W13`, `BE-W14`, `BE-W15` and `BE-W47` are all **closed**, so the
three console items MR-36 listed as blocked are startable today.

```
FE-W10  the false "manager console is not here" card   (1 half-day, NOTHING BLOCKS IT)
   v
FE-W12  overrides panel consumes the GET               (2)   BE-W13 closed
   v
FE-W13  console audit + retention screens              (3)   BE-W14/15 closed
   v
BE-W89  beat-plan chain                                (UNSIZED, and deliberately)
```

**6 half-days of sized engineering.** `FE-W10` first because it is one file and the only item on
the page that makes the product *lie*. `FE-W12` and `FE-W13` are ordered by cost, not dependency
— independent, parallelisable. `BE-W89` stays unsized because `sync_pull` has **no
`beat_plan_entry` entity at all**: the screen has no data path rather than a thin one, and a
number put on it before that decision would be invented. **It is the last engineering item before
MR v1 is feature-complete minus the device gates.**

#### D2 — what a cut AI layer costs

**Cut outright:** the coaching, analysis and reply screens and the coaching tab; **`FE-W12`
entirely, all 2 half-days**; `analyses`, `analysis_overrides`, `transcripts_raw`,
`transcripts_redacted`; and `TranscriptV0` — **so cutting the AI layer RESOLVES the 30 September
deadline**, which is the one thing that makes this decision cheaper than it looks. `BE-W13`,
`BE-W47` and `BE-W56` are closed and sunk. The sequence becomes `FE-W10` → `FE-W13` → `BE-W89`,
four sized half-days instead of six.

**And the half that is easy to miss: the ENTIRE AUDIO PATH comes into question.** Audio is
captured so it can be transcribed, and nothing else in MR v1 reads a recording. On the table:
`recordings`, `voice_notes`, `upload_grants` and the resumable upload machinery; the retention
worker, its watchdog and the intake-stops-if-retention-stops control; **the per-MR storage
ceiling fixed in this session's Part B**; the 90-day deletion promise and the storage half of
`BE-W11`; and the runbook's entire step-3 reconciliation.

**This is not a recommendation to cut audio with it** — consent-recorded audio may be wanted as
evidence rather than as input. **It is that nobody has asked**, and answering *"cut the AI
layer"* without answering *"does audio capture survive it?"* leaves the largest and most
compliance-heavy subsystem in the product with no stated purpose.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | 21 passed |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | 10 passed |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | 502 passed |
| `@fieldforce/field` | jest | 128 passed, 128 total |
| `@fieldforce/api` | vitest | **675 passed** — was 662; +4 upload, +6 seed guard, +3 territory cycle |

**1,677 passing, zero skipped, zero failing.** `lint`, `typecheck` and `format:check` all exit 0.
The schema is at **57 migrations**.

#### Where this session stopped

**At the end of Part D, with every part complete.** Three things are deliberately left:

1. **The I3 deadline is not resolved.** It is a decision, and Part A was explicit that it should
   not be resolved by engineering.
2. **`FE-W48` is registered, not fixed** — unreachable today, and fixing it means choosing which
   default is right, which is a product question.
3. **`BE-W89` is unsized**, because sizing it requires deciding an entity that does not exist.

**Four things a reader should carry forward.**

1. **Ask the server before asking for a dependency.** `FE-W46` was registered as blocked on
   `BE-W7` across three sessions. The byte count was in `storage.objects.metadata` the whole
   time, and the fix needed no client change at all.
2. **"Cannot fire" and "has an inert term" are different claims.** MR-36 said the first; the
   truth was the second, and only reading the formula term by term separated them.
3. **A test that passes against the mutant is not a test.** The ceiling test passed against its
   own mutant twice before the third version discriminated — once because of committed rows from
   neighbouring tests, once because `reservedBytes` was left out of the baseline.
4. **A sweep that finds nothing is worth its denominator.** Two of the four sweeps found nothing
   real; both are recorded with counts so the next session does not spend a morning rediscovering
   that.


### MR-38 — the fourth instance

**There isn't one. The sweep's answer is a negative, and the session's real finding is that a
check MR-37 ran and trusted was passing for a reason unrelated to what it checked.**

#### CI

| | |
| --- | --- |
| Run | `35079692527` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `63d03b71ba830778aae1ae45c8b2ae4635956504` |

**Obtained from `git rev-parse HEAD`, not recalled, and it equals HEAD.** MR-37 wrote a
fabricated full SHA into this file's draft — twelve characters known and the tail invented — and
caught it only because the invented tail happened to be checked. **An invented identifier is
worse than a missing one, because it looks verifiable.** This one was read out of the repository.

This section is committed after that run, so HEAD moves by one commit and that commit is pushed
at the end of the session.

#### A1 — the deadline now warns, and it is warning today

It had **two** states where `5.9`'s mechanism has three, in the same repository, for the same
class of problem. It now has three, and the warning is live — **verified by running it, not by
arithmetic**:

```
::warning title=Decision due::CONTRACT I3 -- the transcript schema -- is due on 2026-09-30
(15 day(s) left). After that this test fails the build.
```

**The mechanism is reused, not rebuilt.** 21 days, taken from
`20260907001000_ucpmp_cap_decision_warning.sql`'s `warn_days`; a warning that does **not** fail
the build, for the reason that migration records; and the same `::warning::` GitHub annotation
`check:decision-debt` emits, so it reaches the run summary rather than a log nobody opens on a
green build.

**It is deliberately NOT implemented by extending `check:decision-debt`**, and that was checked
rather than assumed: `FIX-08 B2`'s `scripts-convention.spec.ts` fails the build if anything in
`services/api/scripts/` imports `packages/core`, because no workflow builds workspace
dependencies before running those scripts. The fact this turns on — whether `TranscriptV1Schema`
is *really* exported — is a runtime property of `packages/core`. Checking it in the test reads
the actual export; checking it in the script would have meant grepping source for a symbol.

**`daysRemaining` uses `ceil`, mirroring the UCPMP status function exactly.** That is why this
says 15 where MR-37 said 14: MR-37 took the floor, the project's own convention is `ceil`.
Recorded so the two records do not read as contradicting each other.

The evaluator is pure and takes `now` as an argument, so all three states are asserted at fixed
dates — the technique `decision-debt.spec.ts` uses by backdating a row rather than waiting for
November. Both boundaries tested from both sides. **Two-sided mutation:** removing the warn
branch fails 4 tests including *"is WARNING right now"*; removing the `hasV1` escape fails
exactly the positive control asserting `TranscriptV1` is the way out.

**A2: no `TranscriptV1Schema` was created.**

#### A3 — the question, at the top of the page, above the deadline

> ## Does the MR app record audio at all, if there is no AI layer?

It is above the deadline because the deadline is only what forces it. **Every claim in it was
verified rather than repeated.**

- **Nothing in MR v1 consumes a recording**, and the code says so deliberately in two places:
  `analysis/[id].tsx` — *"**No citation gets a play control.** … A play button that did nothing
  would tell the MR a recording was ever made"* — and `coaching/content.ts` — *"**There is
  nothing to play here.**"* The console does not read audio either. **The complete list of
  things that touch a recording is the code that uploads it and the code that deletes it.** An
  MR cannot play back their own voice note. Nobody can.
- **A voice note nobody can read is a file.** Captured with consent, encrypted, counted against a
  storage ceiling, carried through a retention schedule, reconciled after a restore — and never
  once opened.
- **The corpus justification is circular.** `docs/mr-app-plan.md` measures why the audio is
  collected: *"Whisper large-v2 zero-shot … **52.0% Mixed Error Rate**"* on code-switched
  Hindi-English. The conclusion was that a fine-tuned model is needed, which needs a corpus,
  which is why the app records. **But the model is the AI layer.** Cut it and the loop has no
  exit — only a gap where the purpose used to be.
- **Under DPDP the purpose is the weak part, not the consent and not the security.** Those are
  built, logged and encrypted. What is missing if the AI layer goes is the answer to what the
  data is *for*.

#### B — the sweep, and the fourth instance does not exist

**The prior was 3-for-3**: `capture_consent`, `record_check_in` and `complete_upload` were each a
client asserting a fact the server had already observed.

| | |
| --- | --- |
| RPCs callable by `authenticated` | **47** |
| Client-supplied parameters | **121** |
| A number or an identifier | **70** |
| A pure number | **24** |

**How the 24 classify:** 6 the client genuinely witnesses (GPS on check-in and check-out); 4 a
pure helper's own arguments; **3 the server cannot measure**; 2 a reservation rather than an
observation; 6 bounded caller preferences; 1 already fixed in MR-37; **2 of this shape with no
decision behind them**.

**The server cannot measure audio duration, and that was verified rather than assumed.**
`storage.objects.metadata` carries `size`, `contentLength`, `mimetype`, `eTag`, `cacheControl`,
`lastModified`, `httpStatusCode` — **and no duration.** Measuring it would mean decoding the
audio. So `p_duration_seconds` looks like the class and is not in it.

**B4: nothing to fix.** No client-supplied value feeds a ceiling, a retention clock or a refusal
that the server could have derived. **B6's mutation requirement is vacuous because nothing was
fixed, and manufacturing a change to satisfy it would be the opposite of the point.**

**B5 — the spot-check earned its place.** Five RPCs take `p_mr_id` while the server holds
`auth.uid()`, and **all five are `SECURITY DEFINER`** — which reads exactly like the class and
like a tenancy hole. Reading the full predicate instead of the grep line shows every one scopes
first and filters second:

```sql
where g.mr_id in (select public.visible_user_ids())
  and (p_mr_id is null or g.mr_id = p_mr_id)
```

`visible_user_ids()` derives from `auth.uid()`; the parameter narrows **within** an
already-authorised set and cannot widen it. A grep finds the second line; only the first decides
anything. Two further apparent hits were prior instances of this same correction already applied:
`check_outs.duration_seconds` is computed server-side from the check-in, and `capture_consent`
derives `v_active_then` through `active_consent_text_at()` alongside the claimed version.

**Registered as `BE-W94`:** `complete_upload.p_recorded_at` is the device's word with **no bounds
at all**, where the consent ledger's `captured_at` has both. It feeds no decision — `purge_after`
is `now()` and nothing reads `recorded_at` — so it is registered rather than fixed, but it is a
compliance-adjacent timestamp carrying less protection than its sibling. `p_bitrate_kbps` and
`p_bytes_received` are recorded as tidiness **with what reads them** — a `CHECK` range and a
progress bar — so the next sweep does not re-open them.

#### C — one of the three was unblocked, and the other two were not

**`FE-W10` — DONE.** The console carried a card reading *"The manager console is not here"*,
saying `§3.6` forbids the coaching queue and the analysis review. **Both halves were false by the
end of the same day**, and that was verified before deleting anything — removing a *truthful*
card would have been the worse error. `docs/fe-w3-spec.md` records a **second reversal on
3 September**, put and answered separately, which reopened `E1` and `E2` and says *"Both are now
built, in `apps/console`."* They are.

The guard is source-level because the console has no renderer, and it carries a precondition and
**two** positive controls: it found at least three `page.tsx` files; `E1` and `E2` are actually
present (**if they were not, the card was TRUE and deleting it was the defect**); and the admin
page still renders its real content, so removing the card by emptying the file fails. Two-sided
mutation, each failing exactly one test.

**`FE-W13` — STILL BLOCKED, and this corrects MR-37.** `BE-W14`'s recorded check has two clauses
and MR-37 ran the first and stopped:

> `grep -c "auditLog" packages/core/src/field/endpoints.ts` → `≥1`; **an RLS test proves a
> non-admin gets `permission denied`, not an empty list**

The grep returns 2 and **both matches are unrelated to an audit read path** — a prose comment,
and the `auditLogId` field on the *analysis overrides* response. Measured directly instead: the
only `public` functions matching `%audit%` or `%retention%` are **`write_audit_row` and
`stamp_audio_retention`, both writers**; there is no read path, no `AuditLog…Schema` or
`Retention…Schema`, and no mock route for either. **`BE-W14` (3) and `BE-W15` (2) are open.**

**`FE-W12` — BLOCKED on two things.** `ListAnalysisOverridesResponseSchema` is defined in
`packages/core` and **consumed by nothing**; `createApiClient` has the POST and no read.
`BE-W13` is genuinely closed *by its own check* — the RPC and the mock route both exist — but
nothing lets `apps/console` call it through the shared client, and **that gap sits between two
items with neither owning it.** And its recorded check asks for *"a console test [that] asserts
a previously-saved override renders"*; the console has no renderer, by its own
`vitest.config.ts`'s statement, and adding one is a dependency ask.

**Not worked around, deliberately.** Putting the fetch in a lib function, testing the shaping in
node and asserting the page source mentions it would satisfy a weaker claim while reporting
`FE-W12` done. `C3` says stop instead.

**So the engineering column is 1 half-day done and 6 half-days newly revealed**, not the
6 half-days of console work MR-37 recorded as ready.

#### A flake found and given a denominator

One full-suite run reported `Test Suites: 2 failed` with **`Tests: 237 passed, 237 total` and
zero failures** — a suite that never ran, not one that failed, and the only failure shape that
looks green at a glance. The unresolvable modules are inside
`@testing-library/react-native`'s own `dist`; `packages/ui` alone passes 243/243 immediately
afterwards.

**Rate: 1 in 7 full runs.** Six consecutive clean runs followed it, and **six clean runs is not
evidence it is gone** — against a true rate of 1-in-7 that has probability ≈0.40. Recorded in
`docs/gotchas.md` with the shape to recognise it by. No mechanism is claimed.

#### Counts — by workspace AND runner, from each runner's own line

| Workspace | Runner | Result |
| --- | --- | --- |
| `@fieldforce/core` | vitest | **28 passed** — was 21; +7 deadline states |
| `@fieldforce/ui-tokens` | vitest | 54 passed |
| `@fieldforce/ui` | vitest | 4 passed |
| `@fieldforce/ui` | jest | 243 passed, 243 total |
| `@fieldforce/console` | vitest | **14 passed** — was 10; +4 `FE-W10` guard |
| `@fieldforce/mock` | vitest | 40 passed |
| `@fieldforce/field` | vitest | 502 passed |
| `@fieldforce/field` | jest | 128 passed, 128 total |
| `@fieldforce/api` | vitest | 675 passed |

**1,688 passing, zero skipped, zero failing.** `lint`, `typecheck` and `format:check` all exit 0.

#### Where this session stopped

**At the end of Part C, with C stopped deliberately rather than completed.** Four things are
left, each for a stated reason:

1. **`FE-W12` and `FE-W13` are not started**, because they are blocked — one behind a missing
   client method and a missing renderer, one behind two open backend items.
2. **`FE-W11` is not done**, though `FE-W10` unblocks it. It was not among C1's three, and its
   recorded check requires `docs/frontend-status.md` to be **edited in place** while this
   session's instruction is that the file takes appends only. The same false claim is live at
   lines 34, 43 and 44 of that file and needs a decision, not a silent resolution.
3. **`BE-W94` is registered, not fixed** — it feeds no decision.
4. **The `packages/ui` load flake is not chased** — a rate and a shape, no mechanism.

**Four things a reader should carry forward.**

1. **A check that can pass for an unrelated reason is not a check.** `grep -c "auditLog" → ≥1`
   is satisfied by any file that says the words, and it was trusted by the session that wrote
   the rule about not trusting exactly this.
2. **A negative sweep result is worth its denominator.** There is no fourth instance, and the
   next session should not spend a morning looking for one.
3. **A suite that never runs reports zero failures.** `237 passed, 237 total` was the whole of
   the signal; the failure count was zero.
4. **Stopping is the result when the check cannot be met.** `FE-W12` could have been "finished"
   against a weaker test in an hour.


### MR-39 — the audit read path

**The rule that counts are read "from each runner's own line" was half a rule, and the half it
was missing is the half that hid a suite from MR-38. Then the two read paths that MR-38 proved
did not exist were built.**

#### CI

| | |
| --- | --- |
| Run | `35085549263` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `401310255baed78e4b6c0d5eb83248bbe73b9938` |

**Read with `git rev-parse HEAD`, not recalled, and it equals HEAD.** This section is committed
after that run, so HEAD moves by one and that commit is pushed at the end of the session.

#### A1 — a suite that never ran can no longer be reported as green

**The old rule could not see it.** `Tests: 237 passed, 237 total` with **zero failures** is
internally consistent and wrong: the cases inside a suite that failed to *collect* are not
counted anywhere, so every test-level number agrees with every other one.

`scripts/test-counts.mjs` now reads `numFailedTestSuites` and `numRuntimeErrorTestSuites` from
both runners and **exits 1 when either is non-zero, regardless of the case counts.** Two further
faults were found in the same file while there:

- **`numFailedTests` was captured into a variable and never read.** A reporter that prints a
  failure count it does not act on reports failures as green. It now fails on it.
- **`TOTAL` summed *discovered* cases**, which is why the record said for six sessions to read
  the runners rather than this script. It now sums **passing** cases, and `handoff.md`'s pointer
  is updated to match.

The suites column shows only the **bad** count: this file's own comment records that
`numTotalTestSuites` is not comparable across runners — vitest counts `describe` blocks, jest
counts files — and a column whose meaning changes per row is the defect the script exists to
close.

**A2 — the control, run both ways.** A file importing a module that does not exist was added to
`packages/ui`, reproducing the shape exactly:

```
Test Suites: 1 failed, 21 passed, 22 total
Tests:       243 passed, 243 total
```

**With the file present the reporter exits 1**, naming the workspace and runner. **With it
removed it exits 0.** Measured as exit codes rather than read off a pipe, because `$?` after a
pipe is the last command's status.

**And the control corrected the fix.** Jest counts a suite that threw during collection in
**both** `numFailedTestSuites` and `numRuntimeErrorTestSuites`, so the first version of the
column reported one bad suite as "2 BAD". It takes the **max**, not the sum — measured against
the control rather than reasoned about.

#### A3 — the rate, with its denominator

| Session | Runs | Occurrences |
| --- | --- | --- |
| MR-38 | 7 | **1** |
| MR-39 | 8 | **0** |
| **Combined** | **15** | **1** |

**Eight clean runs does not retire the 1-in-7 estimate** — if the true rate were 1 in 7, eight
clean runs has probability ≈0.30. The honest reading is **about 1 in 15**, and a single
occurrence cannot bound it more tightly. **Registered, not chased**: the A1 guard means it no
longer needs a mechanism to be caught.

#### A4 — the caveat on every count already in the record

**Every test total recorded before this change was read from the `Tests:` line alone and could
not have seen a suite that never ran, so all of them carry an error bar of unknown size — no
historical count is being corrected, because one occurrence in fifteen says they are very
probably right and re-deriving twenty sessions would cost more than the uncertainty is worth.**

#### B — the audit and retention read paths

**What reading an append-only log implies.** `audit_log` has RLS enabled **and forced** with **no
SELECT policy at all**, so the read must be `SECURITY DEFINER` and **the entire boundary is in
the function body** — there is no policy to fall back on. It only SELECTs and INSERTs, so
`audit_log_reject_mutation` is untouched. And **reading the trail is itself auditable**, so
`list_audit_log` writes its own row *before* gathering data: the read is self-referential on
purpose, and nobody reads the audit log without appearing in it.

**Stated rather than left to be discovered:** a *refused* read is **not** audited. The refusal
raises, which rolls back the audit row written in the same transaction. Recording it would need
an autonomous transaction, which this schema has nowhere else.

**Tenancy without a tenant column.** `audit_log` has no `organisation_id`; a row's tenant is its
**actor's**. Scope is `actor_id in (select public.visible_user_ids())` with **no
`or v_role = 'admin'` escape** — `list_consent_records` has one, written before BE-W76, and
copying it into a new function would reopen the boundary the console is the first surface to
exercise in anger. Rows with a null actor have no tenant, are excluded, and are **counted** in
`systemRowsHidden` so a short page reads as scoped rather than as empty.

**The 90 became one number.** It was a bare `interval '90 days'` inside `stamp_audio_retention`.
A read path returning its own `90` would have agreed **by luck** and drifted the first time
either moved. It is now `public.audio_retention_days()`, called by the trigger *and* the read
path, and there is exactly one `90` in the database.

#### B5 — both clauses run, and named

> **Clause 1 — REPLACED.** The recorded one was `grep -c "auditLog" endpoints.ts → ≥1`, which
> MR-37 ran and which passed for a reason unrelated to what it checks: the two matches were a
> prose comment and the `auditLogId` field on the *analysis overrides* response. **A grep
> locates; it does not decide.**
>
> The replacement requires the three schema names to be **exported**, to be **zod schemas**, and
> to **reject a malformed payload** — an exported name that parses anything is not a contract.
> **Run: PASS.**

> **Clause 2 — run as written.** *"An RLS test proves a non-admin gets `permission denied`, not
> an empty list."* **Run: PASS** — `audit-read-path.spec.ts`, 13 tests.

> **`BE-W15`'s extra clause — run as written.** *"A test asserting the figure shown is
> server-sourced."* **Run: PASS** — the test compares `retentionDays` against
> `audio_retention_days()` **and** asserts `stamp_audio_retention()`'s body calls that same
> function.

#### B6 — the full matrix, every cell with its control

| Caller | Result | The control that makes it mean something |
| --- | --- | --- |
| **admin, own organisation** | **sees the row** | This is the control for every row below. Without it, each refusal could be a function that refuses everybody |
| **admin, ANOTHER organisation** | **does not see the row** | **The same row IS visible to the admin who owns it**, asserted in the same test. An absence proves nothing without something that would have been present — and the page is separately asserted non-empty, so it is scoped rather than broken |
| **field_manager** | **`42501`**, not an empty list | The admin cell above proves the function returns data to somebody |
| **mr** | **`42501`**, not an empty list | As above |
| **anon** | **`42501` from the GRANT**, before the body runs | As above |
| *(retention)* **field_manager / mr / anon** | **`42501` / `42501` / `42501`** | Both tenants' admins get an answer, so neither count is an empty function returning zero |

**The `anon` cell is a correction made by measuring.** The test first asserted `28000` from the
body's `auth.uid() is null` check. **`anon` never gets there** — EXECUTE is granted to
`authenticated` only, so PostgreSQL refuses first. That is the *stronger* refusal, because the
function does not run and so cannot leak through a bug in its own scoping, and it is asserted as
what happens rather than as what the body would have done.

**B7 — two-sided mutation, each failing exactly its own cells:** removing the tenant scoping
fails the cross-organisation test **and nothing else**; making a non-admin receive an empty list
instead of a refusal fails **exactly the two refusal tests** — which is precisely the defect
`BE-W14`'s recorded check names.

`verify:rollbacks` passes with the schema empty. Both migrations have byte-accurate rollbacks.

**`BE-W95` registered, found while writing the contract.** `list_analysis_overrides` shapes rows
with `to_jsonb(o)` and emits `analysis_id`, `finding_id`, `overridden_by_user_id`, `created_at`,
while `AnalysisOverrideSchema` declares camelCase and the mock's fixtures are typed to the
schema. **The database and the contract disagree about the shape of the same endpoint** — the
FIX-03 drift that migration's own comment says it closed. Nothing caught it because **nothing
consumes that read**. The two new functions build their keys explicitly and do not join it.

#### C — ran, and stopped without starting the work

**`FE-W13` is no longer blocked.** Part B removed its blocker.

**Its recorded check carries the same defect B5 was about, and the evidence is a run:**
`grep -c "90" <screen> → 0` returns **2** today, and **both matches are prose comments explaining
why the number is not printed.** The check therefore **fails on a screen behaving correctly** and
would **pass on a screen that rendered the figure** from any expression without those digits.

**What it actually requires:** clause 1 cannot mean a render test — `apps/console` has no
renderer and adding one is a dependency ask — so it means the convention `queue.test.ts` follows,
testing the arithmetic the pages present. Clause 2 should assert the rendered figure **changes
when the stubbed `retentionDays` changes**, which cannot pass by accident.

**Not started, and the reason is ROOM, not blockage.** Those are different and the record should
not blur them: the previous twelve stops were blockages; this one is not.

#### Counts — by workspace AND runner, from BOTH lines

Read with `node scripts/test-counts.mjs`, which now exits 1 if any suite failed to run.

| Workspace | Runner | Passed | Failed | Suites |
| --- | --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 28 | 0 | ok |
| `@fieldforce/ui` | vitest | 4 | 0 | ok |
| `@fieldforce/ui` | jest | 243 | 0 | ok |
| `@fieldforce/ui-tokens` | vitest | 54 | 0 | ok |
| `@fieldforce/console` | vitest | 14 | 0 | ok |
| `@fieldforce/field` | vitest | 502 | 0 | ok |
| `@fieldforce/field` | jest | 128 | 0 | ok |
| `@fieldforce/api` | vitest | **688** | 0 | ok |
| `@fieldforce/mock` | vitest | **43** | 0 | ok |

**1,704 passing, zero failing, and no suite failed to run** — the last clause is the one that is
new. `lint`, `typecheck` and `format:check` all exit 0. The schema is at **59 migrations**.

#### Where this session stopped

**At the end of Part C, having run C's analysis and deliberately not started its work.**

1. **`FE-W13` is next**, unblocked, 3 half-days — **replace its clause-2 check before starting.**
2. **`FE-W12` is still blocked** — no `listAnalysisOverrides` client method, and its check asks
   for a render assertion in a workspace with no renderer.
3. **`BE-W95` is registered, not fixed.**
4. **The `packages/ui` load flake is registered at ~1 in 15**, and no longer needs chasing to be
   caught.

**Four things a reader should carry forward.**

1. **A count that cannot see a suite is not a count.** The rule said "from each runner's own
   line" and meant one of the two lines that runner prints.
2. **A grep clause in a recorded check is a defect in the check.** This session found a second
   one — `grep -c "90" → 0` — in the very next item, after replacing the first.
3. **An absence needs something that would have been present.** Every refusal in the B6 matrix is
   paired with a cell proving the target was reachable by somebody.
4. **"Blocked" and "out of room" are different words.** Twelve stops were the first; this one is
   the second, and conflating them would have made the next session distrust both.


### MR-40 — the refused read

**Part A was meant to be a register tidy-up and two reads. The second read found that an admin
of one organisation can read another's consent ledger, which is what this session became.**

#### CI

| | |
| --- | --- |
| Run | `35086717424` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `cc3febe53e2a5742db520417a932f626045e7a8c` |

**Read with `git rev-parse HEAD`, and it equalled HEAD.** Nothing was held at the start of this
session — clean tree, nothing unpushed — so A1 was a confirmation rather than a push. The
session's own commits are pushed at the end and their run is reported with them.

#### A2 — the register had two duplicate ids, and both were mine

A register with two of the same id stops being one register. All **129** ids carrying a
definition row were swept; **14** had differing descriptions, and spot-checking showed **12 were
the same item at different stages** — `FE-W44` registered then fixed, `BE-W11` open then proven.

**Two were genuine collisions:**

| Id | Original | Mine | Renumbered |
| --- | --- | --- | --- |
| `BE-W94` | *"Does an out-of-geofence check-in start the visit?"* (MR-25) | `p_recorded_at` is unbounded (MR-38) | **`BE-W96`** |
| `BE-W95` | A second consent answer does not supersede the first (MR-25, tied to `5.14`) | The overrides casing drift (MR-39) | **`BE-W100`** |

**The brief named one. The sweep found the second** — which is why it said to check the register
rather than to fix the item named. The originals keep their ids. `PROJECT-OVERVIEW.md` is
append-only, so its MR-38 and MR-39 sections still carry the old numbers; **this is the
correction of record.**

#### A3 — the admin escape is OPEN, on the consent ledger

**Measured with a positive control, not reasoned about from a `where` clause:**

| Probe | Result |
| --- | --- |
| `list_consent_records()` as admin of **A**, with a record belonging to **B** | **B's record is in the page** |
| `read_consent_record(B's id)` as admin of **A** | **returns the row — all 14 columns** |
| **Positive control:** the same record read by **B's own admin** | appears, as it should |

The control is what makes the other two mean anything: the record was created, was readable by
its owner, and was **also** readable by a stranger.

**Why nothing caught it.** `where (v_role = 'admin' or c.captured_by_mr_id in (select
public.visible_user_ids()))` — the `or` short-circuits before the scoped half runs. `BE-W76`
scoped `visible_user_ids()` and the six `*_admin_all` policies; **a body that bypasses
`visible_user_ids()` entirely is covered by neither.** These are `SECURITY DEFINER` against
`consent_records`, one of the nine tables with RLS **forced and no policy**, so the function body
*is* the boundary and there is nothing behind it. `FIX-04`'s matrix tested this function **before
`BE-W76`**, when an admin's emptiness came from territory scoping incidentally — **a test that
passed for a reason since removed is not a test that still passes.**

**Exposure, stated precisely.** Both functions are in the **first 19 migrations**, so production
runs this code — but production has **no second tenant to cross into**, because
`user_profiles.organisation_id` is in the pending 37. **The defect becomes live when reference
data and a second tenant arrive, which `§6.1` dates at ~22 September.** And a *successful*
cross-tenant read **is** audited: the row is written before the data is returned, so the trail
names the admin and their reason. It is a confidentiality failure, not an invisible one.

**Per-site verdicts — seven more share the shape, three of them WRITE.** Listed as untested
rather than assumed, because grep locates and does not decide:

| Function | Kind | Verdict |
| --- | --- | --- |
| `list_consent_records` | read | **PROVEN OPEN** |
| `read_consent_record` | read | **PROVEN OPEN** |
| `approve_call_report` | **WRITE** | shape-identical, untested |
| `create_analysis_override` | **WRITE** | shape-identical, untested |
| `reinstate_sync_item` | **WRITE** | shape-identical, untested |
| `read_analysis` | read | shape-identical, untested |
| `list_analyses` | read | shape-identical, untested |
| `list_analysis_overrides` | read | shape-identical, untested |

**Not fixed, because A3 said to stop and report if it was open.** Registered as **`BE-W101`** and
escalated to the top of `docs/blocked-on-you.md`. The two probes use `it.fails`, which states the
**correct** property and records that it does not hold — not a characterisation test asserting
the defect, which reads as approval and would make the eventual fixer delete an assertion that
looks deliberate. **CI stays green on a known-open defect, and the moment somebody closes the
escape these two turn red and force a deliberate update.**

#### B — the refused-read gap is systemic, and the attempt IS recorded somewhere

**B1: seven, not one.** MR-39 recorded this as a property of `BE-W14`. It is a property of
**audit-then-return inside one transaction**: `list_consent_records`, `read_consent_record`,
`list_analyses`, `list_analysis_overrides`, `read_analysis`, `list_audit_log`,
`retention_status`. A refusal raised *before* the insert writes nothing; one raised *after* it
writes a row the raise rolls back. Both leave the same nothing.

**B3:** nobody probing these paths leaves a trace in the trail. **For an audit trail a failed
attempt is usually more interesting than a successful one** — a successful read is somebody doing
their job; a hundred refused ones is somebody finding out what they can reach.

**B4 — "here, but not in the audit trail", measured rather than assumed.**
`log_min_error_statement = error`, and a forced refusal was **found in the Postgres log** with its
failing statement beside it. Three reasons that is not a substitute:

1. **It probably does not identify WHO.** `log_statement = ddl`, so only the *erroring* statement
   is logged — the RPC call. The caller's identity is in `request.jwt.claims`, set by a
   **separate** statement that is not logged.
2. **It is not tenant-scoped, not queryable by the console, and not append-only.** `audit_log`
   has a rejection trigger and RLS forced; the server log has neither and cannot be handed to one
   customer's auditor.
3. **Its retention window is the platform's, not this system's policy**, and has never been
   established.

**B2:** registered as **`BE-W102`**, **not built**, with four escape routes costed — PostgreSQL
has no autonomous transaction; `dblink` is a dependency *and* a new privilege surface on exactly
the functions whose privileges are in question; logging at the PostgREST layer is the one place
the actor is already known but moves part of the trail outside the database that guarantees the
rest; and doing nothing is what was chosen, written down so an assessor is told rather than left
to discover it.

#### C — the recorded-check sweep

| | |
| --- | --- |
| Register rows with a verification cell | **137** |
| Grep-based | **14** |
| **Sound** | 2 |
| **Weak** | 9 |
| **INVERTED** | **1** (`FE-W13`) |
| **STALE** | **1** (`BE-W73`) |
| Already replaced in MR-39 | 1 (`BE-W14`) |

**The spot-check changed two verdicts**, and the last sweep that skipped this step was 75% false
positives:

- **`FE-W13`** — `grep -c "90" → 0` **returns 2**, both prose comments explaining why the figure
  is *not* printed. **Inverted.**
- **`BE-W73`** — *"across all **33** migrations returns nothing"* **returns 2 files**, and there
  are **59**. The premise is false because MR-28 deliberately fixed the finding. **Stale, not
  inverted** — classified apart because the fix differs: mark it resolved, do not write a new
  check.
- **`BE-W60`** — `grep -rl list_consent_records tests/*.spec.ts returns a file` **passes**. A
  suite exists. It is titled **`'list_consent_records is scoped and audited'`** — and A3 proved
  that same function is open. `rls.spec.ts:1133` tests the reason and the audit row, and scoping
  only for an MR. **It never crosses a tenant.**

**That last row is the thesis in one line: the check asked whether a file mentions the function.
A file does.**

**C4 — replaced, not re-run.** A defective check re-run is a defective answer obtained twice.
`FE-W13`'s becomes *the rendered figure changes when the stubbed value changes*; `BE-W60`'s
becomes *there is a test that crosses a tenant, with a positive control* — which
`admin-escape.spec.ts` now is; `FE-W17`, `BE-W18` and `BE-W57` get conditions about named things
rather than absences in unbounded searches; `BE-W73` is marked resolved.

#### D — did not run

**FE-W13 was not started.** Its blocker is gone, its check is now replaced, and **it is not
blocked by `BE-W101`** — verified: `list_audit_log` and `retention_status`, the two functions its
screens consume, have **no admin escape**, having been written without one in MR-39.

#### Counts — by workspace AND runner, from BOTH lines

| Workspace | Runner | Passed | Failed | Suites |
| --- | --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 28 | 0 | ok |
| `@fieldforce/ui` | vitest | 4 | 0 | ok |
| `@fieldforce/ui` | jest | 243 | 0 | ok |
| `@fieldforce/ui-tokens` | vitest | 54 | 0 | ok |
| `@fieldforce/console` | vitest | 14 | 0 | ok |
| `@fieldforce/field` | vitest | 502 | 0 | ok |
| `@fieldforce/field` | jest | 128 | 0 | ok |
| `@fieldforce/api` | vitest | **691** | 0 | ok |
| `@fieldforce/mock` | vitest | 43 | 0 | ok |

**1,707 passing, zero failing, and no suite failed to run.** `lint`, `typecheck` and
`format:check` all exit 0. 59 migrations.

#### Where this session stopped — and it was ROOM, not blockage

**Stopped after Part C, with Part D deliberately not started. The reason is ROOM.**

`FE-W13` is unblocked, its check is replaced, and nothing stands in its way. Two RSC screens, a
data layer, tests and mutations at the end of a session that turned into a compliance escalation
is how a half-built screen gets shipped.

**The distinction matters and the register should carry it:** twelve prior stops were blockages —
something was genuinely in the way. MR-39's was room. **This one is room.** Conflating them
teaches the next session to distrust both.

**Four things a reader should carry forward.**

1. **`BE-W101` is the most serious open finding in this register.** An admin of one organisation
   can read another's consent ledger, proven, with six more functions sharing the shape and three
   of them writes. It becomes live at the same date `§6.1` already names.
2. **A test suite's title is not a test.** `'list_consent_records is scoped and audited'` tested
   the audit half and an MR's scoping, and the tenant boundary was open the whole time.
3. **A duplicate id is a register that has stopped being one** — and I created both of them, one
   session apart, without noticing either.
4. **"Blocked" and "out of room" are different words**, and this is the second consecutive
   session where the honest answer was the second one.

### MR-41 — the missing answers

**Part A asked five questions. Four already had recorded answers, and the fifth — whether the
admin escape crosses the tenant boundary — was open at two sites when this session started and
is open at ALL EIGHT now, three of them writes. The brief's own A3 rule fired.**

#### A1 — CI

| | |
| --- | --- |
| Run | `35198562720` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `6197987a3a995ec4e63d38ffa1eeaf815db27abd` |

Both jobs green: `typecheck · lint · format · unit tests` and
`migrations · Gate 0 RLS suite · rollbacks`. **Read with `git rev-parse HEAD`, and it equalled
HEAD.** The commit pushed was the banner-inset fix described under B3 below, made and committed
before this brief arrived.

#### A2 — MR-40's Parts A3, B and C DID run, and the report did not close on Part A

**The brief's premise is false, and the register is the evidence rather than my recollection.**
`PROJECT-OVERVIEW.md` carries `### MR-40 — the refused read` at line 15695, **199 lines**, with
these headings present: `#### A3 — the admin escape is OPEN, on the consent ledger`,
`#### B — the refused-read gap is systemic`, `#### C — the recorded-check sweep`,
`#### D — did not run`, the counts table, and `#### Where this session stopped`.

What MR-40 recorded, quoted:

- **A3** — *"`list_consent_records()` as admin of A, with a record belonging to B — **B's record
  is in the page**"*, with the positive control *"the same record read by B's own admin —
  appears, as it should"*. Registered `BE-W101`.
- **B** — *"**B1: seven, not one.**"* and *"**B4 — 'here, but not in the audit trail', measured
  rather than assumed.**"* Registered `BE-W102`.
- **C** — 137 register rows with a verification cell, 14 grep-based, *"**Sound** 2 / **Weak** 9 /
  **INVERTED** 1 (`FE-W13`) / **STALE** 1 (`BE-W73`)"*.

**The part that genuinely did not run was D** (`FE-W13`), and MR-40 said so under its own
heading. A part that did not run is not a part that passed — and the converse holds too: three
parts that ran are not three parts that did not.

#### A3 — OPEN AT ALL EIGHT SITES, AND THREE OF THEM WRITE

MR-40 proved two sites and listed six as *shape-identical, untested*. **This session measured
the other six. Every one is open.**

Sites enumerated from the **catalogue** — `pg_get_functiondef` over `pg_proc where prosecdef` —
not from grep. That returns exactly these eight, plus `visible_user_ids` and
`visible_territory_ids`, where the same branch **is** the scoping and is tenant-bounded by
`BE-W76`.

| Function | Kind | Verdict | What was measured |
| --- | --- | --- | --- |
| `list_consent_records` | read | **PROVEN OPEN** | A's admin finds B's consent record in the page |
| `read_consent_record` | read | **PROVEN OPEN** | returns B's row by id |
| `read_analysis` | read | **PROVEN OPEN** | returns another organisation's analysis |
| `list_analyses` | read | **PROVEN OPEN** | lists another organisation's MR's analyses |
| `list_analysis_overrides` | read | **PROVEN OPEN** | returns another organisation's override |
| `approve_call_report` | **WRITE** | **PROVEN OPEN** | **accepted** another organisation's call report |
| `create_analysis_override` | **WRITE** | **PROVEN OPEN** | **accepted** against another organisation's analysis |
| `reinstate_sync_item` | **WRITE** | **PROVEN OPEN** | **accepted** a dead-lettered item of another organisation |

**The cell, two-sided at every site.** Run directly against the local stack with the three DEMO
tenants, independently of `admin-escape.spec.ts`, so it is a measurement and not a citation of
one:

| Probe | Result |
| --- | --- |
| `list_consent_records` as admin of **A**, record owned by **B** | **contains B's record = `true`** |
| `read_consent_record(B's id)` as admin of **A** | **`A ROW`** |
| **Positive control** — the same record as **B's own admin** | **contains = `true`**, as it should |
| **Negative control** — the same call as **A's MR**, a non-admin | **contains = `false`** |

The negative control is what localises the defect: the identical query, identical target and
identical fixture returns nothing to a non-admin and everything to an admin, so **the branch
that fails is `v_role = 'admin'` — not the query, the fixture or the harness.** On the write side
the same pairing holds: `approve_call_report` was **accepted** for a cross-tenant admin and
refused for an MR with *"only a field_manager or admin may decide a call report"*.

**The three writes were exercised inside transactions that were rolled back.** Nothing was
persisted. One row was not reversible — the consent record minted as the read fixture, because
**`consent_records is append-only: DELETE is not permitted by any role`**, which is the guard
doing its job. That row remains in the LOCAL demo database only.

**Why this is worse than MR-40 recorded.** A cross-tenant read is a confidentiality failure. An
admin of one company **approving another company's call report** is an integrity failure, and
`approve_call_report` is the one the register already named as the first to check.

`BE-W101` updated in the register and at the top of `docs/blocked-on-you.md`. **Not fixed, for
the reason A3 gives: it is a compliance-boundary defect and the fix is a decision, not a patch.**

#### A4 — seven, and "here, but not in the audit trail"

**Seven**, re-derived from the catalogue rather than accepted: the `SECURITY DEFINER` functions
whose body both inserts into `public.audit_log` and takes a `p_reason` are exactly
`list_analyses`, `list_analysis_overrides`, `list_audit_log`, `list_consent_records`,
`read_analysis`, `read_consent_record`, `retention_status`. That is MR-40's list, item for item.

**Where an attempt IS recorded: the Postgres log — not PostgREST, not GoTrue, and not the audit
trail.** MR-40 measured this rather than reasoning about it: `log_min_error_statement = error`
puts the failing statement in the server log. It is not a substitute, for three recorded reasons
— the caller's identity is set by a *separate* statement that `log_statement = ddl` does not log,
so it probably does not say **who**; the log is not tenant-scoped, not queryable by the console
and not append-only, so it cannot be handed to one customer's auditor; and its retention window
is the platform's rather than this system's policy. **"Nowhere" would have been the wrong
answer.**

#### A5 — the sweep, spot-checked before reporting

Denominator and split as recorded by MR-40: **137** register rows carrying a verification cell,
**14** grep-based — **2 sound, 9 weak, 1 INVERTED (`FE-W13`), 1 STALE (`BE-W73`)**, and 1 already
replaced in MR-39 (`BE-W14`).

**Three spot-checks re-run this session, and all three reproduce:**

| Check | Claim | Re-measured |
| --- | --- | --- |
| `FE-W13` | `grep -c "90" <screen>` → `0` | **returns `2`** — `admin/page.tsx:29` and `:139`, both prose explaining why the figure is *not* printed. **INVERTED confirmed** |
| `BE-W73` | *"across all **33** migrations returns nothing"* | **returns 2 files**, and there are **59** migrations. **STALE confirmed** |
| `BE-W60` | `grep -rl list_consent_records` returns a file | passes — and A3 above proves that same function open at both sites. **Weak confirmed** |

The denominator itself is MR-40's count carried forward; what this session re-derived is the
three verdicts the split turns on.

#### B and C — DID NOT RUN

**Not started: B1 (`set -o pipefail`), B2 (the root `.env` destructive-command table), B3 (the
banner register entry), B4 (the mock-dead instrument), and all of C (`FE-W13`).**

The reason is **A3's own instruction** — *"IF IT IS OPEN, STOP AND REPORT — that is a
compliance-boundary defect and it changes what this session is."* It is open at eight sites
including three writes, which is more than was known when the brief was written.

**B3 is the one owed.** The banner fix is committed and CI-green but carries no register row, so
the finding it represents — *hoisting something to a root for coverage moves it out of whatever
the root's children inherit* — is currently recorded only in a commit message and two source
comments.

#### Counts — by workspace AND runner, from BOTH lines

| Workspace | Runner | Passed | Failed | Suites / Files |
| --- | --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 28 | 0 | 3 files |
| `@fieldforce/ui` | vitest | 4 | 0 | 1 file |
| `@fieldforce/ui` | jest | **246** | 0 | 22 suites |
| `@fieldforce/ui-tokens` | vitest | 54 | 0 | 3 files |
| `@fieldforce/console` | vitest | 14 | 0 | 2 files |
| `@fieldforce/field` | vitest | 502 | 0 | 32 files |
| `@fieldforce/field` | jest | **131** | 0 | 19 suites |
| `@fieldforce/api` | vitest | 691 | 0 | 46 files |
| `@fieldforce/mock` | vitest | 43 | 0 | 1 file |

**1,713 passing, zero failing, no suite failed to run.** Up 6 from MR-40's 1,707 — the three
`TopInset` tests and the three banner-inset tests.

**One transient, reported rather than smoothed over.** The FIRST full run of
`scripts/test-counts.mjs` reported `@fieldforce/api` at **690 passed / 1 failed / 2 suites BAD**.
It did not reproduce: the API suite alone then passed 691/46, and the second full counter run was
clean. **Rate: 1 failure in 4 API runs today.** I cannot name the failing test — the counter's
output does not print it, and by the time that was noticed the run was gone. That is *consistent
with* the pre-existing deadlock flake MR-35 measured at 2-in-7, but **consistent with is not
attributed to**, and it is recorded here as unexplained rather than as resolved.

#### Where this session stopped — and it was NEITHER blockage NOR room

**Stopped after Part A. The stop is neither of the two words the standing rule offers, and
calling it one of them would be false.**

- **Not a BLOCKAGE.** Nothing was in the way. The stack was up, the tenants existed, and B1
  through B4 are all reachable work.
- **Not ROOM.** There was room. The session had budget for Part B.

**It is the A3 rule firing.** The brief said to stop if the escape was open, because that changes
what the session is — and it is open at every site, including three writes nobody had measured
before today. Reporting that, and re-grading the register and the escalation to match, is what
the session became.

The distinction matters for the same reason MR-40's did: twelve prior stops were blockages, two
were room, and this is a third kind — **a conditional stop the brief itself defined, on a
condition that turned out to be true.** Recording it as "room" would suggest the work was
deferred by judgment; recording it as "blockage" would suggest something failed. Neither is what
happened.

### MR-41 (continued) — B and C ran after all

**The section above says Parts B and C did not run. That was true when it was written and is
false now: the operator read the A3 report and said "do B, then C".** `PROJECT-OVERVIEW.md` is
append-only and CI-enforced, so this corrects it by appending rather than by editing — which is
the behaviour the guard exists to produce.

`BE-W101` is unchanged by any of this: still open at all eight sites, still not fixed, still a
decision rather than a patch.

#### B1 — `set -o pipefail`, in both places a pipe actually runs

**The before-state, measured:** `false | tail -1` exits **0**. So does
`grep x /no/such/file | tail -1`.

| Surface | Mechanism |
| --- | --- |
| All five GitHub workflows | `defaults: run: shell: bash` — GitHub's bare default is `bash -e {0}` with **no pipefail**; `shell: bash` is `bash --noprofile --norc -eo pipefail {0}` |
| The session shell | `.claude/shell-init.sh` holding `set -o pipefail`, loaded via `BASH_ENV` in `.claude/settings.json` |

**Not cosmetic in this repository.** `ci.yml` pipes `git diff … | awk` to compute the deletion
count that the `PROJECT-OVERVIEW` append-only guard fails on, and `backup.yml` pipes `ls … |
head -1` to choose the artefact it then verifies. **A guard whose input command failed silently
reports the empty answer, and the empty answer is the passing one in both cases** — `0 deletions`
and `no artefact` each look like success.

**The control, two-sided:**

| | Before | After |
| --- | --- | --- |
| `false \| tail -1` | `0` | **`1`** |
| `grep x /no/such/file \| tail -1` | `0` | **`2`** |
| `echo ok \| tail -1` | `0` | **`0`** — unchanged, so the mechanism does not break working commands |

All five workflow files were parsed with `js-yaml` afterwards to confirm `defaults` landed as a
**top-level key** rather than inside `on:`.

#### B2 — the root `.env` premise was half wrong, and the table is proven

**Correction first, because the table means nothing without it:**

| Variable | Points at |
| --- | --- |
| `SUPABASE_URL` | `https://pgfdbzoapmleqtoezhoa.supabase.co` — **HOSTED** |
| `SUPABASE_DB_URL` | `127.0.0.1:54322` — **LOCAL** |
| `SUPABASE_REMOTE_DB_URL` | hosted, and a **separate variable nothing above reads** |

So the hosted *database* address is not in the variable the destructive scripts read. The hosted
*REST* endpoint is, and two unguarded scripts read exactly that one. **And nothing in the repo
loads the root `.env` into these scripts at all** — none uses `dotenv`, `pnpm` does not populate
`process.env`, and the one thing proven to read that file is the **Supabase CLI**, established by
its refusal to parse it while it carried a UTF-8 BOM.

**Every row below was produced by running the command. A NON-RESOLVING hostname was used rather
than the real hosted one, deliberately: a guard test that fails is a guard test that connects to
production.** With a host that cannot resolve, a missing guard produces a DNS error instead of a
live session.

| Command | Guard fires? | Evidence |
| --- | --- | --- |
| `seed:day` | **YES** | *"refuses to run against host … Only 127.0.0.1, ::1 or localhost are allowed"*, exit 1 |
| `seed:mr` | **YES** | *"…creates an auth identity … which must never reach a deployment"*, exit 1 |
| `seed:synthetic` | **YES** | *"…hundreds of thousands of invented rows … There is no --force"*, exit 1 |
| `verify:rollbacks` | **YES** | *"…destructive by design and only ever allowed against 127.0.0.1"*, exit 1 |
| `purge:audio` | **NO** | `getaddrinfo ENOTFOUND` — it tried to connect. **This one DELETES storage objects** |
| `check:purge-health` | **NO** | `getaddrinfo ENOTFOUND` |
| `reconcile:restore` | **NO** | `getaddrinfo ENOTFOUND` |
| `seed:reference` | **not reached** | Refuses earlier, for a different reason: *"requires --data"* |
| `db:reset` | **n/a** | Supabase CLI behaviour, not a repo guard. **Not executed** — observing it would have destroyed the local demo tenants |

Registered as **`BE-W103`**. Its recorded check requires a **refusal naming the host**, not merely
a non-zero exit: `ENOTFOUND` is what a missing guard looks like, and is indistinguishable from a
guard whenever the host happens not to resolve.

#### B3 and B4 — the two register entries

**`FE-W49`** — the banner inset, with the check written as **arithmetic on the distance that
reaches the title** plus a zero-inset positive control and a per-edge distinctness control. The
class is in `gotchas.md`: **hoisting something to a root for coverage moves it out of whatever the
root's children inherit.** Coverage and inheritance pull in opposite directions, and nothing
type-checks the loss.

**The mock-dead instrument** is in `gotchas.md` too: kill the other source and see whether the
screen still works. `HANDOVER-2026-09-08`'s §3 table is corrected by append — **Today is REAL,
established by ELIMINATION**, the pull now has a caller, and **the remaining nine rows are marked
as inspection-dated 8 September: claims, not facts.**

#### C — `FE-W13` IS BUILT

**C1 first, as instructed: the check was replaced before anything was built against it.** The old
one, `grep -c "90" <screen>` → `0`, returns **2** — `admin/page.tsx:29` and `:139`, both prose
explaining why the figure is *not* printed. It failed on a correct screen and passed on a wrong
one.

**What was built.** Two presenters — `src/lib/retention.ts` and `src/lib/audit.ts` — plus the
wiring in `admin/page.tsx`. **The arithmetic is in modules rather than in the page because the
console has no renderer**, which `vitest.config.ts` states in its own comment; adding one is a
dependency and this project requires asking first. That is the same split `queue.ts` already
keeps, and it is what makes the check assertable at all.

**The replacement check, satisfied at two levels:**

1. **Unit** — `retentionSentence` must print the server's `retentionDays` and must **differ**
   between two server values, with a **zero-case positive control** requiring **no digits at all**
   when the server supplies nothing. Mutants: hard-coding `90` kills the first; falling back to
   the design's `90` on failure kills the second. **Both were run and both died.**
2. **End-to-end, which is the one that matters** — the mock's `retentionDays` was changed from
   **90 to 45**, and the rendered page at `/admin` then read *"Audio is kept for 45 days"* with
   **no "90 days" anywhere**. Restored afterwards.

**The end-to-end guard asserts its own precondition, and that is not decoration.** The first
attempt showed the page still saying 90 — because a stale mock process still held port 4010 and
was serving 90. **Without the precondition check that reads exactly like "the page ignores the
server".** The mock was killed by PID, restarted, the precondition (`"retentionDays":45` on the
wire) was confirmed, and only then was the page asserted.

**What the audit panel is not allowed to claim, asserted rather than commented:** its heading is
**"Successful reads"** and its caveat names `BE-W102` — a refused read is not in the trail, so the
panel must not present itself as a list of attempts. A **refusal renders as a refusal**, never as
an empty list, because `list_audit_log` raises `42501` rather than returning an empty page and
collapsing the two converts a true statement into a false one. `systemRowsHidden` renders as
*"2 row(s) are not shown"*, so a scoped page is distinguishable from an empty one.

**Two of my own errors on the way, both caught by the thing they were aimed at.** An `emptyTrailNote`
assertion used a regex lookahead that could not express "these words may appear only inside the
disclaimer" and failed against correct output; it was replaced with the property stated directly.
And the first pass of the rendered-page assertions used `grep -E` with `row(s)` — which matches
`rows` — and reported two correct lines as ABSENT. **A check that fails on correct output is the
exact defect this session's Part A was about.**

#### Counts — by workspace AND runner, from BOTH lines

| Workspace | Runner | Passed | Failed | Suites / Files |
| --- | --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 28 | 0 | 3 files |
| `@fieldforce/ui` | vitest | 4 | 0 | 1 file |
| `@fieldforce/ui` | jest | 246 | 0 | 22 suites |
| `@fieldforce/ui-tokens` | vitest | 54 | 0 | 3 files |
| `@fieldforce/console` | vitest | **28** | 0 | **4 files** |
| `@fieldforce/field` | vitest | 502 | 0 | 32 files |
| `@fieldforce/field` | jest | 131 | 0 | 19 suites |
| `@fieldforce/api` | vitest | 691 | 0 | 46 files |
| `@fieldforce/mock` | vitest | 43 | 0 | 1 file |

**1,727 passing, zero failing, no suite failed to run.** Console **14 → 28**. `typecheck`, `lint`
and `format:check` all exit 0, each read from its own exit code rather than from the shape of its
output.

#### Where this session stopped — ROOM, and the earlier verdict stands as written

**Part C completed, so this stop is ROOM: the work asked for is done and the remaining register
items are new ones.**

That does **not** revise the verdict in the section above. That stop was real, it was the A3 rule
firing, and it ended when the operator read the report and chose to continue — which is what a
conditional stop is for. **Two stops, two different kinds, and the register now carries both
rather than flattening them into one.**

**What is owed next, in the order the register would take it:**

1. **`BE-W101`** — still the most serious open item here, now proven at eight sites with three
   writes. It needs a decision on whether an admin has any legitimate cross-tenant read at all.
2. **`BE-W103`** — three unguarded destructive scripts, one of which deletes.
3. **`FE-W12`** — still blocked: no `listAnalysisOverrides` client method, and no renderer.

### MR-42 — closing the escape

**`BE-W101` is closed at all eight sites. It was never a decision — the answer had been in
`.ai-collab/decisions.md` since 9 September, and two sessions waited for it.**

#### A1 — CI

| | |
| --- | --- |
| Run | `35202606537` — **`success`** |
| Workflow | `CI` |
| Event | `push` |
| SHA | `d7995f447e594b1b2316240b92047df42f8f9a2d` |

Both jobs green. **Read with `git rev-parse HEAD`, and it equalled HEAD.** Nothing was held at
the start of this session — clean tree, HEAD equal to `origin/main`.

#### A correction to the brief, before anything rests on it

The brief cited *"`.ai-collab/decisions.md`'s MR-07 entry"*. **There is no `MR-07` string in that
file.** The decision is real and says exactly what the brief says it says — it is **`C1`**, under
*"Reviewer decisions transcribed from the review conversation — 9 September 2026"*:

> *"The `admin` role administers **one organisation**. It is not a platform operator and must
> never be treated as one. Platform access … is a **separate, audited break-glass path** and is
> **out of MR v1 scope**."*

`20260908000800`'s own exception hint cites it as **"MR-06 section 3"**. Same substance, two
different labels, neither of them MR-07. Recorded so the next reader searching for "MR-07" does
not conclude the decision is missing.

#### A2 — the fix removes the disjunct rather than adding a predicate

```sql
where (v_role = 'admin' or <actor column> in (select public.visible_user_ids()))
```

**`visible_user_ids()` already IS the tenant boundary.** `BE-W76` scoped it to
`where p.organisation_id = v_org`, so for an admin it returns every user in their own
organisation and nobody else — which is precisely the access C1 describes. The `v_role = 'admin'`
disjunct therefore grants nothing legitimate; it only short-circuits past the check. **Removing
it is the whole fix.**

Writing a second organisation predicate into eight bodies would have been a second copy of a rule
that already has one home — the shape this repository has been bitten by repeatedly, and how
these eight drifted from the helper in the first place. **One boundary, one definition, eight
callers.**

`20260917000100_close_the_admin_escape.sql`, generated from the **catalogue's current
definitions** so that nothing added by a later migration was silently reverted, with exactly one
replacement asserted per function.

#### A3 — `visible_user_ids` and `visible_territory_ids` are deliberately untouched

**Their `if v_role = 'admin' then` branch IS the scoping** — it is where the organisation bound
is applied — and `BE-W76` bounded it. A catalogue sweep for `v_role = 'admin'` surfaces both of
them; they are correct and must stay. Stated in the migration header, in the test's comment and
here, because that sweep is now automated and will surface them on every run.

The escape's shape is `v_role = 'admin' or`. The two helpers use `if v_role = 'admin' then`,
which does not match — and the test's positive control asserts that non-match explicitly, so the
pattern cannot quietly widen.

#### A4 — the eight sites, three controls each, after the fix

| Site | Kind | ATTACKER admin of A | POSITIVE owner's admin | NEGATIVE A's non-admin |
| --- | --- | --- | --- | --- |
| `list_consent_records` | read | **BLOCKED** | SEES | BLOCKED |
| `read_consent_record` | read | **BLOCKED** | SEES | BLOCKED |
| `read_analysis` | read | **BLOCKED** | SEES | BLOCKED |
| `list_analyses` | read | **BLOCKED** | SEES | BLOCKED |
| `list_analysis_overrides` | read | **BLOCKED** `42501` | SEES | BLOCKED `42501` |
| `approve_call_report` | **WRITE** | **BLOCKED** `42501` | SEES | BLOCKED `42501` |
| `create_analysis_override` | **WRITE** | **BLOCKED** `42501` | SEES | BLOCKED `42501` |
| `reinstate_sync_item` | **WRITE** | **BLOCKED** `42501` | SEES | BLOCKED `42501` |

**The POSITIVE column is the one that proves the fix is a fix rather than a wall.** The owning
organisation's own admin still reads and still writes — tenant administration is intact, which is
exactly what C1 asks for. Without it, a function that refused everybody would have produced the
same attacker column.

**WRITE RESIDUE, measured before relying on it.** The three write probes ran inside transactions
that were rolled back: **0 rows committed to `audit_log`**. But `audit_log_id_seq` advanced
**29337 → 29356**. Sequences are non-transactional, so a rolled-back write probe against an
append-only trail leaves **gaps in the audit id sequence**. Nothing false is recorded — but a
table whose whole promise is that it is gap-free by construction now has nineteen missing ids,
and an auditor will ask. Worth knowing before the next person tests a write this way.

#### A5 — G-RLS-C restated, not re-graded

**It did not regress. It passed on an incomplete sample, and that is a different sentence.** Its
`function` path called `search_doctors(null, null, 200)` and nothing else — one function, chosen
rather than enumerated.

**The population, from the catalogue:**

| | |
| --- | --- |
| `SECURITY DEFINER` functions in `public` | **83** |
| `EXECUTE` granted to `authenticated` | **57** |
| of those, referencing `visible_user_ids`/`visible_territory_ids` | 23 |
| of those, **not** | 34 |

(The brief said eighty-eight. The catalogue returns 83 today; the measured number is the one
recorded.)

**The enumeration found a NINTH reachable path that the string match could never have found.**
`approve_call_reports_bulk` carries **no scoping of its own at all** and does not contain the
escape string — it is safe only because it delegates per id to `approve_call_report`. Measured
after the fix: attacker `decidedCount=0 notDecided=1`; the owning organisation's admin
`decidedCount=1 notDecided=0`. **A grep over eight bodies would have shipped believing the job
was done.**

#### A6 — does G-RLS-C pass, on the enumerated population?

**On the tenant boundary it now does, and it is asserted over the population rather than a
sample.** `admin-escape.spec.ts` requires that **no** `SECURITY DEFINER` body in `public`
contains the escape, enumerated from `pg_proc`, with a positive control that creates one in a
rolled-back transaction and requires the query to find it. The migration makes the same assertion
at deploy time. One fails a build, the other fails a deploy.

**Said precisely, because the gate deserves it: the eight sites and the ninth delegating path are
proven; the population-level claim is that no body carries the escape construct.** That is not
the same as every one of the 57 callable functions having been individually probed cross-tenant,
and this record does not claim it. **G-RLS-X remains ABSENT**, as it was: there is no clinical
schema to separate.

#### B — `BE-W103`, and a deliberate deviation from the brief

**B1 did not do what the brief said, and the reason is a recorded constraint.** The brief said to
guard these three the way `seed:day` is guarded — localhost-only. **`retention.yml` and
`retention-watchdog.yml` run `purge:audio` and `check:purge-health` against production on a
schedule**, and `BE-W7` built them because *"a control nobody runs is not a control"*. A
localhost-only assertion would have switched the 90-day retention promise off.

The seeds are different in kind: each writes invented rows or drops the schema, so no target but
a laptop makes sense for them. **Here the risk is not touching a deployment — it is touching one
by accident**, from a shell holding a stale `SUPABASE_DB_URL`.
`docs/backend-prompt-w8.md` §53 had already asked exactly this and left it open. This is the
answer: a deployment target is allowed, **but only deliberately**, via
`ELMIRON_ALLOW_REMOTE_TARGET=1` set in the two reviewed workflow files.

**Proven three-sided, with a NON-RESOLVING host — never the real one, because a guard test that
fails is a guard test that connects to production:**

| Condition | Result |
| --- | --- |
| non-local, no opt-in | **REFUSED, naming the host**, exit 1 — all four scripts |
| non-local, opt-in set | guard stands aside, reaches DNS — **production retention still runs** |
| localhost, no opt-in | runs, exit 0 — development unaffected |

**B2 earned itself within the hour.** My first `check-purge-health.mjs` edit had an unescaped
apostrophe and died with a `SyntaxError`, **exit 1** — and the check, which demands the refusal
*name the host*, correctly refused to call that a pass. A test satisfied by a non-zero exit would
have certified a broken file.

**B4 — enumerated, and it corrected me twice.** Fifteen scripts take a database, API or storage
URL; the brief named three. **My own first enumeration was a grep, and it was wrong:**
`seed-reference-data` looked unguarded and in fact carries a *stronger* guard — with `--apply` it
refuses to inherit the target at all and demands `--db-url` on the command line. Proven by
running it. The genuinely unguarded script nobody had listed was **`enable-lock-logging.mjs`**,
which has no package script of its own, inherits `SUPABASE_ADMIN_DB_URL`, and runs
`alter database … set`. Now guarded. `backup:database` and `check:migration-drift` target a
deployment **by design** and are left alone.

#### C — the drift workflow's daily red

**It was red on every commit, reporting that production has applied 19 of 60 migrations because
the schema is not deployed. A red that is correct every day is indistinguishable from a red that
is broken** — and the finding this job exists for, a hand-run `supabase db push`, would have
arrived as one more red on the pile.

Restructured into the three states `backup.yml` gives `BE-W11`:

| State | Outcome |
| --- | --- |
| no drift | green |
| clean trailing shortfall, before the date | **green, with a `::notice::`** naming the state and the date |
| the same, after the date | **red** — the acceptance lapsed, not the schema |
| anything else | **red — real drift, at any date** |

**The deploy is the trigger, not the date.** Once the schema is pushed the job goes green on its
own and the flag can be deleted; the date only bounds how long the accepted state may sit
unexamined. It is `2026-10-31`, set past the ~22 September reference-data date `§6.1` already
names, with margin.

**C2 — the control, and it is the reason the green is trustworthy.** Accepting a state is only
safe if the acceptance cannot swallow a real finding. `classifyRun` is pure and
`migration-drift.spec.ts` asserts that on the **same date**, with the **same trailing-shortfall
shape**, the run is still **`real-drift`** when a version was applied that has no file here — and
when the gaps are interleaved, and when the shortfall is `foreign-versions`, and when no
acceptance was granted at all. **The thing the job exists to catch is red on the day the known
state is green.** The human surface is the workflow annotation: `::notice title=BE-W40 schema not
deployed yet` versus `::error title=BE-W40 REAL DRIFT`, which are different titles on different
coloured runs.

#### D — two register fixes

**D1: `BE-W60` was the only weak row passing over something open**, and what it passed over is now
closed. Its check asked whether a file mentions `list_consent_records`; a file did, and the suite
it found never crossed a tenant. **That is worse than the inverted check, which at least fails
loudly — this one certified the defect.** Replaced with the cross-tenant assertion plus the
population clause.

**The other eight do not have that property — but three of them simply do not pass at all
today**: `BE-W18`'s `grep -c "4010"` matches seven files including the legitimate configurable
default; `FE-W17`'s phrase is present in `src/capture/samples.ts`; `BE-W57`'s `sync/queue` is
still routed by `services/mock`. The remaining five are phrase-absences **paired with a real
test**, and the paired clause is what carries them. **A check that fails misleads nobody; it just
is not doing work. `BE-W60` was the dangerous shape and the sweep found exactly one of it.**

**One new instance, found by tripping it.** `retention-ops.spec.ts` asserts the watchdog workflow
must not match `/purge:audio/` — a real property — but as a **text match over the file**, so it
cannot tell a `run:` step from a comment. It failed on a comment this session, and it would pass
on a workflow that invoked the purge through a variable. The sound form asserts the parsed YAML's
`run` steps, which is how the `ELMIRON_ALLOW_REMOTE_TARGET` opt-in was verified to reach all
three invocations.

**D2: `BE-W101` re-marked as a FIX, closed, with the pointer to `C1`** — in the register and at
the top of `docs/blocked-on-you.md`, which had been leading with a red banner for a defect that
is now closed. That banner was the same failure as the drift workflow's: a permanent red nobody
can act on.

#### Counts — by workspace AND runner, from BOTH lines

| Workspace | Runner | Passed | Failed | Suites / Files |
| --- | --- | --- | --- | --- |
| `@fieldforce/core` | vitest | 28 | 0 | 3 files |
| `@fieldforce/ui` | vitest | 4 | 0 | 1 file |
| `@fieldforce/ui` | jest | 246 | 0 | 22 suites |
| `@fieldforce/ui-tokens` | vitest | 54 | 0 | 3 files |
| `@fieldforce/console` | vitest | 28 | 0 | 4 files |
| `@fieldforce/field` | vitest | 502 | 0 | 32 files |
| `@fieldforce/field` | jest | 131 | 0 | 19 suites |
| `@fieldforce/api` | vitest | **707** | 0 | **47 files** |
| `@fieldforce/mock` | vitest | 43 | 0 | 1 file |

**1,743 passing, zero failing, no suite failed to run.** Up 16 on MR-41 — two catalogue
assertions, seven target-guard assertions and seven drift-state assertions. `typecheck`, `lint`,
`format:check` and `verify:rollbacks --files-only` all exit 0, each read from its own exit code.

#### Where this session stopped — ROOM

**Every part completed: A, B, C and D. The stop is ROOM.**

Not a blockage — nothing was in the way. Not the conditional stop MR-41 recorded either: **that
stop's condition was "the escape is open", and this session is what closed it.** The brief that
defined the conditional stop is the brief that has now been discharged.

**Three things a reader should carry forward.**

1. **The answer was already in the repository.** `BE-W101` sat as "needs a decision" for two
   sessions while `C1` had settled it on 9 September. **The register's own pointer was missing,
   not the decision.** That is the cheapest possible failure to repeat and the easiest to prevent:
   when a row says "needs a decision", search the decisions file before waiting.
2. **A catalogue enumeration found a path a string match could not.**
   `approve_call_reports_bulk` has no scoping of its own and never contained the escape string.
   Eight sites were the answer to "what matches this text"; nine was the answer to "what can cross
   the boundary".
3. **A permanent red is a broken alarm.** The drift workflow and the `blocked-on-you` banner were
   both correct every day and therefore useless every day. Both now distinguish the known accepted
   state from the thing they exist to catch, and the accepted state carries a date and a trigger.
