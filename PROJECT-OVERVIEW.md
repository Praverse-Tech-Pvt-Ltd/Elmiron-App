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
