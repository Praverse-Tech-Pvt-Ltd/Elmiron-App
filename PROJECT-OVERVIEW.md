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
