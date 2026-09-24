# AI Platform — Phase A: what exists, what conflicts, what must be decided

**24 September 2026. Written against `main` at `5313513`.** A dated snapshot, not a
maintained record. Anything that is a count is given with the command that re-derives it.

This is Phase A of the *"Elmiron AI Platform Master Build Prompt"* (LMS + knowledge/RAG +
MR chatbot + AI Doctor + AI Coach + voice + PV/complaint screening + analytics +
certification). That prompt says: *"Before writing new infrastructure, prove whether an
equivalent capability already exists … and reuse it when sound."* This file is that proof.

**No code was written.** Phase B cannot start cleanly until §4's decisions are made, because
several of them change the schema, not just the behaviour.

---

## 0. The short version

- **The security foundation is strong and fully reusable.** Tenancy, RLS, audit, append-only
  ledgers, server clocks, error codes, typed contracts, test harness, CI. Every new AI/LMS table
  should be built the same way. Nothing here needs replacing.
- **Almost none of the *content* layer exists.** No products table, no LMS, no document store,
  no knowledge base, no vector search, no notifications, no LLM call anywhere.
- **There is no place for an LLM call to run.** The architecture is "no application server"
  on purpose — all logic is in Postgres behind PostgREST. An AI gateway needs a runtime. That
  is the first and largest decision (§4, D1).
- **The master prompt contradicts eight recorded rules or decisions** in this repo (§3). Some
  are reviewer decisions marked *"not open"*. They must be resolved by a person, not by the
  build. Building around them silently is the failure `.ai-collab/constraints.md` exists to stop.
- **About half the prompt is blocked by the same thing that blocks recording today:** no named
  PV/DPDP signatory (C3). Voice-over-real-visits, transcripts, PV and complaint screening
  cannot reach a real doctor until that exists.
- **What can be built with no vendor and no real doctor:** products, LMS core, assessments,
  certification rules, knowledge ingestion with approval workflow (without embeddings), the
  AI config/prompt-version/audit/cost tables, and the provider interfaces. That is Phases
  B, C (partly) and K.

---

## 1. What exists — the reuse map

Paths relative to the repo root. Migrations are in `services/api/supabase/migrations/`.

### 1.1 Identity and organisation — REUSE, but it is thin

| Prompt asks for | What exists | Verdict |
| --- | --- | --- |
| Users, roles | `user_profiles` + `app_role` enum = `mr`, `field_manager`, `admin` only (`20260810000100:17`) | Reuse. **A 4th role is forbidden** (§3, X5) |
| Organisations | `organisations` — id, name, timestamps only (`20260811000100:179`) | Reuse. **No country/market column** |
| Territories | `territories` with `parent_id` hierarchy, org-scoped | Reuse |
| Managers | `user_profiles.reporting_manager_id`, validated (`20260811000100:101`) | Reuse |
| Teams | Not a table. Derived at runtime: territory subtree + `visible_user_ids()` | Reuse the derivation |
| Products | **None.** `call_reports.product_ids_discussed uuid[]` has no FK and no target table | **Build** — it is the foundation for LMS, RAG, AI Doctor |
| Therapy areas | **None** | Build |
| Country / market | **None** | Build (on org, or on content — see D6) |
| Per-org configuration | **None.** `app_thresholds.scope` is `global` or `territory` | Blocked on `BE-W106` (dated 2026-10-31) |

### 1.2 Security boundary — REUSE AS-IS, and copy the pattern exactly

- **Tenant predicate:** `current_user_organisation_id()` (`20260908000800:229`) — reads
  `user_profiles`, not the JWT; returns null for inactive users, and null matches nothing.
- **Visibility:** `visible_territory_ids()`, `visible_user_ids()` (`20260908000900`).
- **Two policy layers:** permissive scope policies, AND-ed with a **restrictive**
  `*_tenant_boundary` policy on every directly readable table (`20260908001300`,
  `20260922000300`). Tested by `tenant-boundary-restrictive.spec.ts` and
  `tenant-probe-direct-tables.spec.ts`.
- **Sensitive tables:** FORCE RLS with **no policies**; the only door is a `security definer`
  RPC with `set search_path = ''` whose body applies the scope.
- **Grant posture:** revoke all from `anon`, `authenticated`, `service_role` before any grant;
  `privilege-posture.spec.ts` fails the build if any `public` function is `anon`-executable.

**Every new AI/LMS table must follow this pattern.** New tables get the restrictive boundary,
get added to the tenant probe, and get a rollback file.

**A trap specific to RAG — measured 24 September 2026 on the local stack, pgvector 0.8.2.**
`.ai-collab/constraints.md` (FIX-08) proves that on an RLS table a non-`LEAKPROOF` operator in a
**`WHERE`** clause can never use an index. **Every pgvector operator is `leakproof = false`**
(`select o.oprname, p.proleakproof from pg_operator o join pg_proc p on p.oid = o.oprcode join
pg_type l on l.oid = o.oprleft where l.typname = 'vector'`, after `create extension vector`).

What that does and does not mean, measured as `authenticated` on a 20,000-row table with RLS
forced and an HNSW index:

| query shape | plan |
| --- | --- |
| `order by e <=> $q limit 5` (nearest neighbours) | **Index Scan** on the HNSW index, RLS applied as a `Filter` |
| `where e <=> $q < 0.1` (distance threshold) | **Seq Scan** — the FIX-08 effect |

So nearest-neighbour search is **not** slowed by RLS. The real trap is different and quieter:
the HNSW scan hands back a bounded candidate set (`hnsw.ef_search`, default 40) and RLS filters
it **afterwards**. If most near chunks belong to another tenant, another market or an
unapproved document version, the query returns **fewer than k rows, or none** — which reads as
"approved information not available" when it is available. pgvector 0.8's
`hnsw.iterative_scan` exists for this. The design that avoids it is the one the repo already
uses: a `security definer` retrieval RPC that resolves org / product / market / approval status
to values first and filters inside the scan, with a test that plants many near-but-forbidden
chunks and asserts the permitted ones still come back.

### 1.3 Audit — REUSE AS-IS

- `audit_log` (`20260811000300:80`): actor, role, action, table, row, server clock,
  `request_id`, IP, reason, `refused` (`20260924000300`).
- Writes: `write_audit_row()` trigger, attached per table. Reads: the RPC writes the audit row
  first and returns `{data, readAt, auditLogId}`. Admin reads require a `p_reason`.
- Immutable: statement-level `reject_mutation()` blocks UPDATE/DELETE/TRUNCATE for every role.
- Every §41 audit event in the prompt (knowledge published, prompt changed, course published,
  certificate issued, …) maps onto this with **no new mechanism** — attach the trigger.

### 1.4 Config and feature flags — REUSE, with a gap

- `app_thresholds`: append-only, audited, a revert is a new row. Read only through
  `threshold(key, territory)` (`20260923000300` closed direct reads).
- `recording_feature_enabled` is the model for AI feature flags (`ai_doctor_enabled`,
  `patient_education_enabled`, …): **two mechanisms**, a server flag read inside the RPC plus
  a client guard in `packages/core/src/shared/config.ts` that refuses against a hosted URL.
- **Gap:** flags cannot differ per organisation until `BE-W106` is decided. That blocks
  per-org AI entitlements, per-org cost limits and per-org model choice.

### 1.5 API and contracts — REUSE the convention

- API = PostgREST RPCs. **No Edge Functions** (`services/api/supabase/functions` does not exist).
- Contracts = Zod in `packages/core/src/field/*.ts` and `shared/*.ts`; `services/mock` conforms
  to them; `contract.test.ts` enforces it. §50's "frontend contract package" **already exists as
  a pattern** — new AI/LMS contracts go in `packages/core/src/ai/` and `.../lms/` beside it.
- "Contract shape" migrations (`20260922000100`, `…0200`, `20260923000100`) convert RPC output to
  the camelCase Zod shape. New RPCs should be born in that shape.
- **Versioned paths (`/api/v1/…`) were DROPPED** (`constraints.md` "Dropped" §8) — §3, X6.

### 1.6 Error codes — REUSE, extend

- `raise … using errcode`. Standard codes (28000, 42501, 22023, 23xxx) plus project codes
  **45001–45010** for actionable refusals. Mapped to named codes and rep-facing sentences in
  `packages/core/src/shared/refusals.ts:105` (`BY_SQLSTATE`); `tests/error-contract.spec.ts`
  enforces the mapping both ways.
- The prompt's §51 codes (`AI_FEATURE_DISABLED`, `COURSE_NOT_ASSIGNED`, `RATE_LIMITED`, …) become
  new SQLSTATEs `45011+` with named refusal codes, **not** a parallel error system.
- `RECORDING_CONSENT_REQUIRED` / `RECORDING_WITHDRAWN` **already exist** as
  `recording_permission()` outcomes (`never_asked`, `declined`, `withdrawn`).

### 1.7 Recording, consent, retention — REUSE; it is built and switched off

| Prompt § | What exists |
| --- | --- |
| §23 consent | `consent_text_versions` (immutable, hashed), `consent_records` (append-only; withdrawal = new row; `supersedes_consent_record_id`), `capture_consent` RPC with bounded clocks |
| §23 server verification | Checked in **four** places: grant issue, every chunk (`assert_upload_still_permitted`), insert trigger, storage write policy. `recording-permission.spec.ts` asserts they agree |
| §24 withdrawal | `cascade_consent_withdrawal`: deletes transcripts + analyses, schedules audio purge now, revokes grants, writes `audio_destruction_log` |
| §22 upload grant | `begin_upload` / `complete_upload` via `sync_push`; server-generated opaque keys; server-observed byte count; duplicate-safe |
| §22 retention | `purge_after` = server receipt + 90 days; hourly GitHub Actions purge + watchdog; DB refuses new audio if purge stalls |
| §22 feature flag | `recording_feature_enabled` = false, two mechanisms |
| §22 local encryption | **None found.** Field outbox is AsyncStorage/SQLite, unencrypted |
| §25 transcripts | `ingest_transcript(jsonb)` accepts `TranscriptV1` (per-segment confidence), service-role only, **called by nothing**. No status column. `transcripts_redacted` exists, **written by nothing** |
| §21 STT vendor | **None.** Undecided (`blocked-on-you` 4.2); Whisper-class models measured poorly on Hinglish |
| Legal hold | **None** |

**Do not build a second pipeline.** AI Doctor voice is a *different* data type (an MR talking
to a simulator — no doctor, no consent ledger) and should get its own tables. It should reuse
the upload-grant and retention *mechanism*, not the `recordings` table (§29 of the prompt
agrees).

### 1.8 Analysis, PV, complaints — PARTLY EXISTS, with opposite design assumptions

- `analyses` + `analysis_overrides`: sales-call coaching on real visits. Categories: opening,
  message_accuracy, objection_handling, question_ratio, call_to_action, follow_through,
  content_usage. Every finding must cite a transcript span. `refused` is a first-class
  outcome. **No score, by design and by test.** Manager override is append-only with a reason.
  An `llm_gateway` DB role exists (no login), SELECT on `transcripts_redacted` only.
- `adverse_event_reports` (`20260816000500`): source `mr_reported` | `transcript_detected`,
  points into the redacted transcript, server-stamped `statutory_due_at`. **No severity, triage,
  confidence or category — by design and by test.** No PV officer, routing or escalation
  (blocked on sign-off).
- Product-quality complaints: **none.**
- Off-label / unsupported-claim detection: **none** (planned as Tier-1 #5 in
  `docs/mr-app-plan.md:274`).

### 1.9 Things that do not exist at all

- LMS (courses, lessons, assessments, attempts, certificates, learning paths, skill profile).
- Document store / knowledge base / approval workflow. The only storage bucket is `audio`.
- pgvector. Only `pg_trgm` is installed (`grep -rh "create extension" services/api/supabase/migrations`).
- Any LLM, embedding or TTS call. No AI SDK is a dependency.
- Notifications of any kind (no push, no email, no in-app table). §44 says "integrate with the
  existing notification system" — **there isn't one.**
- AI usage/cost tracking, prompt versioning, benchmark suite.

---

## 2. Where the prompt and the repo already agree

Worth stating, because these need no argument:

- One backend, one identity, one security boundary, one audit model.
- RLS is the enforcement layer, never frontend or app code.
- AI flags, never judges, on safety. Never closes a case.
- Refusal is a correct output ("Approved information not available…" ≈ `analyses.status = 'refused'`).
- Structured, schema-validated output; findings must cite sources.
- Features are feature-flagged until compliance prerequisites are met.

---

## 3. Conflicts — the prompt versus recorded rules

Each needs a named person to rule. **None has been worked around.**

| # | Prompt says | Repo says | Source |
| --- | --- | --- | --- |
| X1 | §10, §27, §48: detect patient identifiers, extract minimal patient info for PV, future patient-support AI | **"Zero patient or clinical data in this repo. Not even placeholder tables."** Patient/PV roles live in the *clinical* Supabase project | `constraints.md:18-20` |
| X2 | §17, §33, §34: `overall_score`, subscores, skill scores, manager sees team averages | **"Never add a ranking, score, rank, percentile or grade to `analyses` or the manager surface."** Tests assert it | `constraints.md:53-54`; `packages/core/src/field/analysis.ts:7-10` |
| X3 | §27: AE "structured extraction"; §26 classification | **No severity/triage/confidence/causality/category on `adverse_event_reports`** — "a field a model could write a judgement into is a field a model will" | `constraints.md:55-58`; `adverse-event.ts:10-18` |
| X4 | §17 AI Coach, §34 Manager AI | **C4: coaching is OUT of v1** until §3.6 is written down with a named human | `.ai-collab/decisions.md` C4, C7 |
| X5 | §35, §36: content "approved by", medical/scientific reviewer | **Three roles only; "a fourth role may never exist here"** | `constraints.md:18, 70-72` |
| X6 | §49: "clean versioned APIs" | **API versioning DROPPED** — one consumer, pre-release | `constraints.md:73` |
| X7 | §22-§28 on real visits | **C3: audio OUT of v1** until the PV/DPDP signatory exists; the consent text doesn't name AI processing (`BE-W109`) | `decisions.md` C3, C8; `BACKEND-DECISIONS.md` §2 |
| X8 | §44: reuse existing notifications | None exist | §1.9 |

**My read on each, as a starting point for the decision — not a ruling:**

- **X1** — the prompt's own §48 says keep patient AI separate. That separation already exists:
  it is the clinical project. Patient education should be built **there**, not here. PV
  "structured extraction" of patient details should not happen in this database at all; the
  commercial side flags a passage and the clinical side owns the case.
- **X2** — this is the one with the most real tension. The rule was written for analyses of
  **real doctor visits**, which is employee monitoring (C8). AI Doctor sessions are
  **simulations the MR chose to do.** There is an argument that a practice score on a
  simulation is a different thing. But the rule also names **"the manager surface"**, and
  §34's team averages sit exactly there. **Do not let the build decide this.** Options: (a)
  scores on simulations, visible only to the MR; (b) scores visible to managers too, with the
  rule formally amended; (c) no numeric scores, cited findings only, like `analyses`.
- **X3** — keep the rule. Let the AI set `source = 'transcript_detected'` and point at a span.
  That already meets the prompt's own "must not independently close or reject a safety case".
- **X4** — AI Coach on *simulations* is different from coaching on *real visits*, but C4 is
  written about coaching generally. Needs the operator to say whether C4 covers practice.
- **X5** — `admin` can hold the "approve" action, with the approver's name and a required
  attestation stored on each approval row. That keeps three roles. Medical/regulatory sign-off
  would then be a **process** fact (a named admin who is the medical reviewer), not a role.
- **X6** — keep it dropped. Version the *contracts* (`TranscriptV1` pattern) and the *prompts*,
  not the URL paths.

---

## 4. Decisions required before Phase B

Numbered so they can be answered by number. **Owner** is who should answer, not who asks.

| # | Decision | Why it blocks | Owner |
| --- | --- | --- | --- |
| **D1** | **Where does the AI gateway run?** | No runtime exists for an LLM call (§1.5) | Maanav + reviewer |
| **D2** | **Which LLM vendor(s), and may prompts/answers leave India?** | Residency is `ap-south-1` (`constraints.md:25`). MR chat can contain things an MR types about a patient. `spend-approval.md` budgets "Gemini or Sarvam, ~$10–40/mo" — an AI Doctor voice product will cost far more | Client + legal |
| **D3** | **Add `pgvector`?** (an extension, and an "ask before" item) | RAG needs it. Alternative: `pg_trgm`/full-text first, vectors later | Maanav |
| **D4** | **Rule on X1–X7** | They change the schema | Reviewer / client |
| **D5** | **The product catalogue** — what products, what brand names, who supplies approved PI/labels | No products table exists. ELMIRON is a *third-party* trademark (`docs/brand-identifier-decision.md`) — the client's real product list has never been given | Client |
| **D6** | **Country/market on the organisation or on the content?** | §46-47. One org may sell in India and abroad | Client |
| **D7** | **`BE-W106` — per-organisation config** | Already dated 2026-10-31. Blocks per-org AI entitlements and cost limits | Client |
| **D8** | **Who is the named medical/scientific approver** for knowledge and prompts | "Do not automatically expose uploaded documents to AI. Require approved status" — needs a real approver | Client |
| **D9** | **Notifications** — build them? Which channel (FCM push)? | §44 assumes they exist. Push = a new dependency + a Firebase project | Maanav |
| **D10** | **Branch or `main`?** | `constraints.md` "Ask before doing". This Phase A doc is on a branch | Maanav |

### D1 in more detail — it is the architectural fork

| Option | For | Against |
| --- | --- | --- |
| **(a) Supabase Edge Functions as a thin gateway** — every auth, scope, flag, quota and audit decision stays in Postgres RPCs; the function only holds the vendor key, calls the model, validates JSON, and writes the result back through an RPC | Same platform. `config.toml` has `[edge_runtime] enabled = true`. Supports streaming (SSE). Keeps "RLS is the enforcement layer" intact because the function calls RPCs **as the user's JWT** | BE-W7 rejected Edge Functions **for the retention worker**, on the grounds that the local stack could not run one. That premise looks stale now — **not yet verified by running one.** Deno, not Node. Adds a runtime to test |
| (b) A separate Node service | Familiar tooling | Exactly the "second backend" the prompt and `architecture.md` both warn against. Hosting, secrets, deploys, one more place for a bug to bypass RLS |
| (c) GitHub Actions / queue workers only | Matches the retention pattern | Fine for async jobs (transcript analysis, embeddings, benchmarks). **Cannot serve interactive chat or a live AI Doctor** |

**Recommendation: (a) for interactive calls, plus (c) for batch work** (embeddings, transcript
analysis, benchmark runs). The gateway is deliberately dumb: it cannot grant anything the
database would not.

**BE-W7's premise, re-checked 24 September 2026 — it no longer holds.** A throwaway function
(deleted afterwards, never committed) was served with `supabase functions serve` against the
stack `pnpm db:start` brings up:

- `pnpm db:start` runs a `supabase_edge_runtime_*` container; the function was served by
  `supabase-edge-runtime-1.74.3 (compatible with Deno v2.1.4)`.
- **No token → 401** `UNAUTHORIZED_NO_AUTH_HEADER`. JWT verification is on by default.
- The function forwarded the caller's `Authorization` header to PostgREST and called
  `rpc/current_user_organisation_id`. **With the anon key the database refused it**
  (`42501 permission denied for function current_user_organisation_id`); **with a signed
  `authenticated` token it ran** and returned `null` (no profile for that user). So the caller's
  identity reaches Postgres through the gateway, and Postgres — not the function — decides.
- A function added **after** `db:start` is not picked up (404 `Function not found`) until
  `functions serve` runs. CI would need that step; it does not have one today.

This removes the testability objection. It does **not** by itself make D1 decided: BE-W7's
other point — a second place for logic to live — still stands, and is answered only by keeping
the gateway free of authorisation logic, which a test can check (it should hold no service-role
key for user traffic).

---

## 5. Proposed shape (for review, not built)

### 5.1 Where each concern lives

```
apps/field, apps/console
   │   (never call a vendor; only RPCs + the gateway)
   ▼
Edge Function  ai-gateway           ← holds vendor key only; no authorisation logic
   │  1. rpc ai_begin_request(feature, context)  → refuses: flag off / not entitled / quota / scope
   │     returns: prompt_version, allowed knowledge scope, model config, request_id
   │  2. rpc knowledge_search(...)   → security-definer; scope applied in body (§1.2 trap)
   │  3. provider.generate / generateStructured  (LLMProvider interface)
   │  4. validate against Zod schema from packages/core
   │  5. rpc ai_complete_request(request_id, output, usage, flags)  → audit + cost row
   ▼
Postgres (unchanged philosophy): RLS + restrictive tenant boundary + audit triggers
```

### 5.2 New table families (names indicative)

- **Catalogue:** `products`, `therapy_areas`, `markets` (+ org link).
- **LMS:** `courses`, `course_versions` (immutable once published), `modules`, `lessons`,
  `lesson_content`, `assignments`, `enrolments`, `lesson_progress`, `assessments`,
  `assessment_questions`, `assessment_attempts` (append-only), `attempt_answers`,
  `certificate_rules`, `certificates` (append-only), `learning_paths`.
- **Knowledge:** `knowledge_documents`, `knowledge_document_versions` (status: draft →
  in_review → approved → retired; approval row names a person), `knowledge_chunks`
  (+ embedding if D3). Storage: a new private `knowledge` bucket.
- **AI control plane:** `ai_features` (the §4 identifiers), `ai_prompt_versions`
  (append-only; approved_by), `ai_model_configs`, `ai_requests` (one row per call: feature,
  prompt version, knowledge versions used, model, tokens, latency, cost, flags — **no payload
  by default**), `ai_usage_limits`.
- **Chat:** `chat_sessions`, `chat_messages` — separate from simulation data (§29).
- **Simulation:** `sim_personas`, `sim_scenarios` (admin-editable data, no deploy — §15),
  `sim_sessions`, `sim_turns`, `sim_evaluations` — shape depends on X2.
- **Safety:** reuse `adverse_event_reports`; add `quality_complaint_flags` with the same
  "flag, never judge" rules; `compliance_flags` for off-label/unsupported-claim, human-reviewed.

### 5.3 Provider interfaces (§21, §37) — no dependency needed

`LLMProvider.generate / generateStructured / embed`, `TranscriptionProvider.transcribe`,
`SpeechSynthesisProvider.synthesise`. Vendors are called over plain `fetch`, so the interfaces
themselves add no package. `TranscriptV1` already follows this pattern — it is
vendor-agnostic on purpose.

---

## 6. Phase plan, re-ordered by what is actually blocked

| Phase | Needs | Can start |
| --- | --- | --- |
| **B — Catalogue + LMS core** (products, courses, versions, enrolment, progress, assessments, attempts) | D5 (products), D6, D10; X2 for whether attempts carry a score visible to managers | **Yes, once D5/D6/X2 answered.** No vendor, no real doctor |
| **K — Certification rules** | Phase B; X2 | With B |
| **C — Knowledge ingestion + approval** (no embeddings yet) | D8, D3 for vector search | Ingestion/approval: yes. Retrieval: after D3 |
| **AI control plane** (features, prompt versions, requests/cost, limits, provider interfaces, error codes 45011+) | D1, D7 | After D1 |
| **D — MR chatbot** | D1, D2, C | After D2 |
| **E/F — AI Doctor text + Coach** | D1, D2, C, **X2, X4** | After X2/X4 |
| **G — Voice** | D2 + an STT/TTS vendor; employee-voice notice (MR voice is still personal data) | Simulator voice: after vendor. Real-visit voice: **blocked by C3** |
| **H — PV / complaint / off-label on real transcripts** | **C3 signatory, BE-W109 consent text, 4.1** | **Blocked** |
| **I — Recommendations**, **J — Analytics/admin** | B, E/F, X2 | Later |
| **L — Hardening** | all | Last |

**A cost of the plan, stated plainly.** The existing field-force app is itself pre-pilot. The
last recorded gate table (`docs/COMPLETION-PLAN.md:259-275`) lists G-PERF, G-AE, the device
gates and G-PILOT as unmet — **that table predates later work** (its G-WRITE row says no write
exists, which is no longer true), so re-check each gate before quoting it. The Supabase paid
plan (~$25/month) is still unapproved (`BACKEND-DECISIONS.md` §5.5). Everything above competes with finishing
that. The prompt describes a multi-quarter programme; nothing in this repo suggests the
people-time or the spend has been approved for it.

---

## 6a. What was built after this document (24 September 2026)

Built on the branch, under three assumptions each of which the operator can overrule: **work
stays on the branch** (D10), **no dependency is added** (none was), and **market lives on
content, not on the organisation** (D6).

- **AI-B1 — catalogue.** `markets`, `therapy_areas`, `products`, `product_markets`. Identity only
  — no claim, indication or label text, by design and by test. Admin writes; the organisation
  reads; restrictive tenant boundary; cross-organisation references refused by trigger.
- **AI-B2 — LMS core.** `courses`, `course_versions` (draft → published → retired),
  `course_modules`, `lessons`, `course_assignments`, `course_enrolments`, `lesson_completions`.
  A published version is frozen by trigger, even for the table owner; state changes go through
  six RPCs; completions are append-only; the server stamps every time. **No score, grade or
  pass mark anywhere** — X2 is still open.
- **AI-C1 — approved knowledge.** `knowledge_documents`, `knowledge_document_versions` (draft →
  in review → approved / rejected → retired), `knowledge_chunks`. Submitting freezes the text and
  chunks it, so what was reviewed is what is retrieved. **Four eyes**: the author or submitter
  cannot approve, and approval stores a written attestation — D8's "approved by" as a named admin,
  not a fourth role. Product content must name a market. `search_approved_knowledge` resolves the
  caller's scope (organisation, market, product, approved, in date, document active) to version
  ids first and only then runs the text search, so nothing out of scope can crowd out a
  permitted result; nothing matching is `status: 'not_available'`, never a guess.
- **Evidence, not impressions.** For each: a spec (`catalogue.spec.ts`, `lms-core.spec.ts`), a
  deliberate mutation run in which weakening each guard failed exactly the test that covers it,
  the new tables added to the restrictive-boundary catalog check and the over-HTTP tenant probe,
  every RPC response parsed against `packages/core`, `verify:rollbacks` executed, and the
  database rebuilt from every migration with `db:reset`.
- **Still UNVERIFIED in the §56 sense.** Nothing in `apps/field` or `apps/console` calls any of
  it. "It must be exercised through the real application" has not happened.

## 7. Status (§56 of the prompt)

`DONE` means exercised through the real application, not "an endpoint exists".

| Capability | Status |
| --- | --- |
| Auth, tenancy, RLS, audit, error contract | **DONE** (existing; 63 api spec files — `ls services/api/tests/*.spec.ts \| wc -l`) |
| Consent ledger, upload grant, retention | **DONE**, switched off (emulator end-to-end, 23 Sep) |
| Transcript ingestion | **UNVERIFIED** — built and tested, called by nothing |
| AI analysis on real visits | **BLOCKED** (C3, C4) |
| Adverse-event ingest | **BLOCKED** — mechanical half built; routing awaits sign-off |
| Products / therapy / market | **Schema built, UNVERIFIED** — AI-B1, `20260924000400_catalogue.sql`. No rows (D5); market on content (assumed for D6). Tested at the database; no screen reads it yet |
| LMS core — courses, versions, lessons, assignments, enrolments, completions | **Built, UNVERIFIED** — AI-B2, `20260924000500_lms_core.sql`, contracts in `packages/core/src/field/lms.ts`. Tested at the database and against the contracts; no screen calls it yet |
| Assessments, certification | **DECISION REQUIRED** (X2) — deliberately not built |
| Knowledge ingestion, review and approval | **Built, UNVERIFIED** — AI-C1, `20260924000600_knowledge.sql`, contracts in `packages/core/src/field/knowledge.ts`. Four-eyes approval with attestation; product content must name a market; server-side chunking; scoped full-text search returning `not_available` when nothing qualifies. No screen calls it yet |
| Vector retrieval (embeddings) | **DECISION REQUIRED** (D3, pgvector) — the full-text search above is the fallback until then |
| PDF / file extraction | **DECISION REQUIRED** — needs a parser dependency; versions take supplied text for now |
| AI gateway / provider layer / cost tracking | **DECISION REQUIRED** (D1, D2) — D1's testability premise now measured (§4): the local edge runtime works and forwards the caller's identity |
| MR chatbot, AI Doctor, AI Coach | **DECISION REQUIRED** (D1, D2, X2, X4) |
| Voice (simulator) | **DECISION REQUIRED** (D2, vendor) |
| PV / complaint / off-label screening | **BLOCKED** (C3, `blocked-on-you` 4.1, 5.8) |
| Patient-support AI | **DECISION REQUIRED** (X1 — likely belongs in the clinical project) |
| Notifications | **DECISION REQUIRED** (D9) |
| Benchmark suite | Not started; depends on D1/D2 |
