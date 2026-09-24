# AI platform — API contracts for the frontend

**24 September 2026.** Master prompt §50: *"For every endpoint: method, path, authentication,
role, request, response, errors, loading state, pagination, permissions, feature flags."*

**The types are the contract; this page is the map.** Every shape named here is a Zod schema in
`@fieldforce/core` (`packages/core/src/field/{catalogue,lms,knowledge,ai}.ts`). Import the schema
and parse with it; do not re-type a shape from this page. Every RPC response below is parsed
against its schema by a database test (`services/api/tests/{lms-core,knowledge,ai-control-plane}.spec.ts`),
so the schema and the server cannot drift without a red build.

**Status: UNVERIFIED in the §56 sense.** Everything here is built and tested at the database and
against the contracts. No screen calls any of it yet.

---

## 1. How to call it

There is no application server (`.ai-collab/architecture.md`). Everything is PostgREST on the
Supabase project, through `supabase-js` as the app already does.

| Kind | Method and path | Body | Wire case |
| --- | --- | --- | --- |
| Table read | `GET /rest/v1/<table>?select=…` (`supabase.from(table).select()`) | — | **snake_case** — map to the camelCase entity schema |
| RPC | `POST /rest/v1/rpc/<name>` (`supabase.rpc(name, args)`) | JSON of `p_…` arguments | **camelCase** already |

- **Authentication.** Every call needs the signed-in user's JWT. There is no anonymous access to
  anything on this page; `anon` can execute none of these functions and read none of these tables
  (`privilege-posture.spec.ts`).
- **Authorisation is the server's.** Row-level security decides what a read returns; an RPC body
  decides what a write may do. **Never filter in the client to hide rows** — if a list contains a
  row the user should not see, that is a backend bug to report.
- **Pagination.** Table reads use PostgREST's `limit`/`offset` or `Range` headers; the server caps a
  response at 1,000 rows (`config.toml`, `max_rows`). No RPC here returns an unbounded list;
  `search_approved_knowledge` takes `p_limit` 1–20.
- **Loading state.** Every call is a network round-trip with no optimistic result: show a pending
  state until the RPC returns. Every write RPC here is idempotent or refuses a repeat with `22023`,
  so a retry after a timeout is safe.

## 2. Errors — map the `code`, never the HTTP status

A refusal arrives as PostgREST's error body, `{ code, message, details, hint }`, where `code` is the
Postgres SQLSTATE. **Use `refusalFromPayload(body)` / `refusalForSqlState(code)` from
`@fieldforce/core`.** They return a `RefusalCode` and whether the user can act on it.

**Do not branch on the HTTP status.** It was measured once in this project to differ by caller for
the same refusal (`42501` is 401 for `anon` and 403 for a signed-in user — `handoff.md`, MR-54), and
the rest of the status mapping has not been measured.

| SQLSTATE | `RefusalCode` | Actionable by the user | Meaning on this page |
| --- | --- | --- | --- |
| `28000` | `not_authenticated` | yes — sign in again | no session |
| `42501` | `not_permitted` | no | wrong role, not yours, other organisation, four-eyes violation |
| `22023` | `invalid_request` | no — refresh and show current state | wrong state (already published, not in review …), missing attestation/reason, bad argument |
| `23514` | `invalid_for_this_record` | no | a frozen record edited, a cross-organisation reference, an invented AI flag |
| `23001` | `append_only` | no | tried to change history |
| **`45011`** | **`ai_feature_disabled`** | no | AI feature off, or not configured for this organisation |
| **`45012`** | **`ai_rate_limited`** | yes — wait | daily AI allowance used up; resets at midnight IST |

`45011` and `45012` are new in this branch and are wired into `refusals.ts`;
`error-contract.spec.ts` fails the build if the database raises a code the contract does not map, or
the reverse.

---

## 3. Catalogue — `catalogue.ts` (AI-B1)

**Read-only for the app.** Admin writes are plain table inserts/updates through the console.

| Table | Entity schema | Who reads | Who writes |
| --- | --- | --- | --- |
| `markets` | `MarketSchema` | everyone in the organisation | admin |
| `therapy_areas` | `TherapyAreaSchema` | everyone | admin |
| `products` | `ProductSchema` | everyone | admin (never delete — set `is_active = false`) |
| `product_markets` | `ProductMarketSchema` | everyone | admin (insert, delete) |

**There is no product data yet** — D5, the client's product list. Build against an empty list.

---

## 4. LMS — `lms.ts` (AI-B2)

### Reads

| Table | Entity | Who reads |
| --- | --- | --- |
| `courses` | `CourseSchema` | everyone in the organisation |
| `course_versions` | `CourseVersionSchema` | published/retired: everyone; drafts: admin only |
| `course_modules`, `lessons` | `CourseModuleSchema`, `LessonSchema` | same as their version |
| `course_assignments` | `CourseAssignmentSchema` | the assignee, their manager's subtree, admin |
| `course_enrolments` | `CourseEnrolmentSchema` | the learner, their manager's subtree, admin |
| `lesson_completions` | `LessonCompletionSchema` | same as enrolments |

**"Overdue" is not a field.** Compute it from `dueOn` against the server's date from the last sync —
never `new Date()` (`constraints.md`: the clock is the server's, and an ESLint rule enforces it in
`apps/field/app/**`).

**There is no score, grade or pass mark** anywhere in the LMS. X2 is undecided; do not add one in the
client either.

### RPCs — `LMS_RPC`

| RPC | Who | Request | Response schema | Refusals |
| --- | --- | --- | --- | --- |
| `publish_course_version` | admin | `{ p_course_version_id }` | `PublishCourseVersionResponseSchema` | 42501; 22023 not a draft / no lessons |
| `retire_course_version` | admin | `{ p_course_version_id }` | `RetireCourseVersionResponseSchema` | 42501; 22023 not published |
| `assign_course` | admin, field manager — for a user they can already see | `{ p_course_id, p_assignee_user_id, p_due_on? }` | `AssignCourseResponseSchema` — idempotent | 42501 out of scope; 22023 nothing published |
| `cancel_course_assignment` | admin, field manager | `{ p_assignment_id }` | `CancelCourseAssignmentResponseSchema` | 42501; 22023 already cancelled |
| `start_course_version` | anyone, for themselves | `{ p_course_version_id }` | `StartCourseVersionResponseSchema` — idempotent, resumes | 42501 other organisation; 22023 not open to new learners |
| `complete_lesson` | anyone, own enrolment | `{ p_enrolment_id, p_lesson_id }` | `CompleteLessonResponseSchema` — idempotent; `courseCompletedAt` set once by the server | 42501 not yours; 22023 lesson not in this version |

A learner who started a version keeps it after it is retired or superseded — resume with the same
`courseVersionId`, not the newest one.

---

## 5. Approved knowledge — `knowledge.ts` (AI-C1)

### Reads

| Table | Entity | Who reads |
| --- | --- | --- |
| `knowledge_documents` | `KnowledgeDocumentSchema` | everyone in the organisation |
| `knowledge_document_versions` | `KnowledgeDocumentVersionSchema` | approved: everyone; every status: admin |
| `knowledge_chunks` | `KnowledgeChunkSchema` | same as their version |

### RPCs — `KNOWLEDGE_RPC`

| RPC | Who | Request | Response schema | Refusals |
| --- | --- | --- | --- | --- |
| `submit_knowledge_version` | admin | `{ p_version_id }` | `SubmitKnowledgeVersionResponseSchema` | 42501; 22023 not a draft / no text |
| `approve_knowledge_version` | admin **who neither wrote nor submitted it** | `ApproveKnowledgeVersionRequestSchema` | `ApproveKnowledgeVersionResponseSchema` | 42501 incl. four-eyes; 22023 not in review / no attestation |
| `reject_knowledge_version` | same four-eyes rule | `RejectKnowledgeVersionRequestSchema` | `RejectKnowledgeVersionResponseSchema` | 42501; 22023 not in review / no reason |
| `retire_knowledge_version` | admin | `{ p_version_id }` | `RetireKnowledgeVersionResponseSchema` | 42501; 22023 not approved |
| `search_approved_knowledge` | anyone in the organisation | `SearchApprovedKnowledgeRequestSchema` | `SearchApprovedKnowledgeResponseSchema` | 42501 market/product of another organisation; 22023 empty query / bad limit |

**Console, review screen:** show the approve button to an admin only when they are neither
`createdByUserId` nor `submittedByUserId` — the server refuses otherwise, and a button that always
fails for the author is a worse screen than no button. The server is still the control.

**Search:** `status: 'not_available'` is an answer, not an error. Show
`KNOWLEDGE_NOT_AVAILABLE_MESSAGE` verbatim; never fall back to anything else. A product question
must pass `p_market_id` — with no market, product content is never returned.

---

## 6. AI control plane — `ai.ts` (AI-D0)

**The app does not call these.** `ai_begin_request` and `ai_complete_request` are called by the AI
gateway, which does not exist yet (D1). They are listed so the console team knows what the gateway
will do and what an AI screen will receive. **No client ever calls a model vendor directly.**

### Reads

| Table | Entity | Who reads |
| --- | --- | --- |
| `ai_prompt_versions` | `AiPromptVersionSchema` | **admin only** |
| `ai_requests` | `AiRequestSchema` | the user it belongs to; their organisation's admin. **Not a field manager.** |

### RPCs — `AI_RPC`

| RPC | Who | Request | Response schema | Refusals |
| --- | --- | --- | --- | --- |
| `submit_ai_prompt_version` | admin | `{ p_version_id }` | `SubmitAiPromptVersionResponseSchema` | 42501; 22023 |
| `approve_ai_prompt_version` | admin, four eyes | `{ p_version_id, p_attestation }` | `ApproveAiPromptVersionResponseSchema` | 42501; 22023 |
| `reject_ai_prompt_version` | admin, four eyes | `{ p_version_id, p_reason }` | `RejectAiPromptVersionResponseSchema` | 42501; 22023 |
| `retire_ai_prompt_version` | admin | `{ p_version_id }` | `RetireAiPromptVersionResponseSchema` | 42501; 22023 |
| `ai_begin_request` | the gateway, as the user | `AiBeginRequestRequestSchema` | `AiBeginRequestResponseSchema` | **45011**, **45012**, 42501 |
| `ai_complete_request` | the gateway, as the same user, once | `AiCompleteRequestRequestSchema` | `AiCompleteRequestResponseSchema` | 42501 not yours; 22023 twice / bad source; 23514 unknown flag |

### Feature flags

A feature runs only when all three hold, else `45011`:

1. `app_thresholds` key `aiFeatureFlagKey(feature)` = `true` — **every feature ships off**;
2. the organisation has an **approved** prompt version for that feature;
3. `AI_DAILY_LIMIT_KEY` is set — an unlimited allowance is never the default.

Both keys are **global** rows until BE-W106 decides per-organisation settings. `patient_education`
is not a feature here (X1). `transcript_analysis`, `pv_screening` and `complaint_screening` are also
blocked by the PV/DPDP signatory (C3), and `ai_coach`/`ai_doctor` scoring by X2/X4, whatever the
flag says.
