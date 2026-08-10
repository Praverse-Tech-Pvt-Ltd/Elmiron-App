# MR App — Project Overview

Pharmaceutical field-force app for medical representatives in India. MR app only —
the patient app is a separate project with a separate database.

**This file is append-only.** Every later prompt adds a new `###` section under
"Phase log". Nothing already written here gets overwritten.

---

## Current state

_This is the one section that describes now rather than history. The Phase log below
is append-only._

End of week 2 of 12. The security boundary exists and is adversarially tested.

What exists and runs:

- A Turborepo + pnpm monorepo, **seven** workspaces, strict TypeScript, ESLint on
  `strictTypeChecked`, Prettier.
- GitHub Actions CI, two jobs, both failing the build rather than warning. The
  database job applies every migration from empty, runs the Gate 0 suite, then
  **rolls every migration back and asserts the schema is empty**.
- **Five migrations**: roles and territories, commercial schema, consent ledger,
  audit log, and the whole RLS boundary in one auditable file.
- **16 tables**, RLS enabled and forced on every one. **31 policies.**
- The **consent ledger** and the **audit log**, both append-only against every role
  including `service_role` and the table owner — enforced by statement-level
  triggers, not by RLS, because BYPASSRLS roles never see a policy.
- `packages/core` — contract **I1** — types, Zod schemas and a typed API client.
- `services/mock` — contract **I2** — a running mock server covering every endpoint
  declared in `packages/core`, with populated / single / empty lists, real cursor
  pagination, every error code, and a full offline-sync queue.
- **127 passing tests**: 12 contract guards in `packages/core`, 27 mock-conformance
  tests in `services/mock`, 88 database tests in `services/api` of which 70 are the
  Gate 0 adversarial suite.

What does not exist yet: any application API. Every endpoint in `packages/core` is
still declaration plus mock only. Audio storage, the pipeline, AE routing and the
analysis engine are weeks 7–10.

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
3. **The custom access token hook is configured for local only.** `config.toml`
   registers it; the linked remote project needs the hook enabled in
   Dashboard → Authentication → Hooks after the first `db push`. Not done — the
   remote project is not linked yet.
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
    rollback loses it. Open question 4 above.
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
