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

