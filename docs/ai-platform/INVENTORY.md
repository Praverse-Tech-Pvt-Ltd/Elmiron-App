# INVENTORY — an evidence-based account of the platform

**28 September 2026.** A snapshot document. It will be **replaced, not appended to**.

| | |
| --- | --- |
| `main` | **`5313513`** — `docs: one list of every decision the backend is waiting on` (24 Sep 2026) |
| `worktree-ai-platform-phase-a` = **draft PR #2** | **`7d4adfb`** — `feat: AI-D1 -- the gateway's logic, runtime- and vendor-neutral, with product_qa end to end` (24 Sep 2026) |
| PR #2 | open, draft, `worktree-ai-platform-phase-a` → `main` (`gh pr view 2`) |

**Nothing was built in this session.** No feature, no fix, no refactor. Defects found were
registered in place and left alone. The single output is this file and its commit.

**Every claim is marked `code`, `emulator`, `browser` or `handset`.** Unmarked claims are `code`.
**There is no handset result anywhere in this repository**, and no result of any kind against a
*hosted* Supabase project — every "real server" proof in this repo is against the local stack on
`127.0.0.1:54321`.

## The six things this inventory found

1. **The master build prompt is not in the repository** (A0). 20 of its 57 sections have no
   textual trace anywhere, so their status is UNKNOWN, not "not started".
2. **14 of 123 SECURITY DEFINER functions are reached by an app. 42 are reached only by a test**
   (B1). The never-called list is empty, which is the wrong question — a function whose only
   caller is its own spec is unexercised and *looks* covered.
3. **Zero of PR #2's eight pieces has ever been called by an app** (B3). 8,174 lines, no consumer.
   The build says so itself in a migration header.
4. **An entire user role is missing from both apps** (B4). The field-manager surface — 11
   functions — exists in the database, has declared paths and mock handlers, and has no client
   method and no call site.
5. **The discovery rate is ≈1.0** (E2): 30 opened, 31 closed over ten sessions. **Every session
   that touched a device opened as many as it closed.** The backlog does not converge by working
   through it; it converges when the generator — real hardware — has been run enough times. Two
   device gates have been open seven weeks waiting for a handset nobody has bought.
6. **Three registers disagree with each other about G-CI, G-CRON and G-WRITE** (F2), and the ones
   a reader reaches for first are the wrong ones. `COMPLETION-PLAN.md` has no status column, so
   ~40 of 171 work items sit in an undefined state, at least three of them describing problems
   that were solved long ago (E1).

## Re-deriving the headline counts

```bash
ls services/api/supabase/migrations/*.sql | wc -l                # main: 75   PR #2: 80
git log main..worktree-ai-platform-phase-a --oneline | wc -l     # 11
git diff --stat main...HEAD -- apps/                             # empty: PR #2 changes no app code
```

> `CLAUDE.md` states the repo has 56 migrations. **It has 75 on `main` and 80 on PR #2.** That
> file's own preamble was written to shame a stale count out of existence and now carries one.
> This is the third recorded instance of the same failure mode in this repository.

---

# PART A — THE MASTER PROMPT, SECTION BY SECTION

## A0. The master build prompt is not in this repository. That is a finding, not an excuse.

The brief asks for a walk of **§1–§57 of the "Elmiron AI Platform Master Build Prompt"**. That
document **does not exist in the working tree of either branch, and does not exist anywhere in
git history.**

```bash
grep -rho "§[0-9]*" --include=*.md .      # highest section number found anywhere: §56
git log --all --diff-filter=D --name-only --format="" | sort -u | grep -i "master\|prompt"
git grep -l "§57\|§55" $(git rev-list --all | head -50)          # no output
```

The only deleted file with a master-prompt-shaped name is **`elmiron-master-plan.md`** — 456
lines, headed *"PPS / Elmiron Digital Platform — Master Plan v1.0, Prepared: 4 August 2026"*,
with **11** numbered sections. It is an earlier, different document.

**So a §1–§57 walk cannot be evidence-based, and this session's rules forbid writing one from
recollection.** What the evidence supports:

- **37 sections are cited by number** in the repo with enough surrounding text — often a direct
  quotation — to state a status. A1.
- **20 sections have no textual trace at all.** A2. Listed, because completeness is the point.

**A correction to my own first pass, recorded because the method matters.** My first scan was
`--include=*.md` and found 27 sections. **The densest citations are not in markdown — they are in
the AI source files and migration headers on PR #2**, which quote the prompt directly
(`guardrails.ts:4`, `providers.ts:89`, `benchmarks.ts:5,145,159`,
`20260924000600_knowledge.sql:5-7`, `20260924000700_ai_control_plane.sql:5-9`). Ten sections were
missed by scanning only documentation. Anyone re-deriving this must grep `*.ts` and `*.sql` too.

**What the reviewer should do.** Put the master prompt in the repo. Until it is there, every
session reasons about a 57-section programme through a 420-line secondary source
(`docs/ai-platform/phase-a-recon.md`) written by one session in one day, and this gap recurs
every time.

## A1. The 37 sections the repository can speak to

§56's vocabulary, and §56's rule: **nothing is DONE because an endpoint, a migration or a test
exists.**

| § | Covers | Status | Evidence | Branch | Blocked by |
| --- | --- | --- | --- | --- | --- |
| §3 | *"every AI request passes one controlled path that knows who asked, for which feature, with which prompt version, from which knowledge versions, on which model, at what cost… and with which safety flags"* | **UNVERIFIED** | `20260924000700_ai_control_plane.sql:5` quotes it; the path is built. Nothing calls it | PR #2 | D1 |
| §4 | AI feature identifiers | **UNVERIFIED** | `ai_features` built, same migration; `AI_FEATURES` in `ai.ts:25`. `patient_education` **deliberately absent** — X1 puts it in the clinical project (`ai.ts:24`) | PR #2 | D1 |
| §5/§9 | *"an MR asks about a product; the answer comes only from approved knowledge for their market, with citations, or it is 'Approved information not available'"* | **UNVERIFIED** | `gateway/product-qa.ts:17` quotes it; implemented end to end against a **scripted** model (`ai-product-qa.spec.ts`) | PR #2 | **D1, D2** |
| §7–§9 | *"Do not automatically expose uploaded documents to AI. Require approved status. Store document version. Historical AI interactions must be traceable to the knowledge version used."* | **UNVERIFIED** | `20260924000600_knowledge.sql:5` quotes it; four-eyes approval, frozen text, chunk-to-version traceability all built. No screen calls it | PR #2 | D8 |
| §10 | *"MR chatbot must not become a clinical decision-support system … Implement detection for obvious patient identifiers where practical"* | **UNVERIFIED** (built) / **DECISION REQUIRED** (the rest of X1) | `gateway/guardrails.ts:4` quotes it and **implements it** — patterns that refuse before any model call, *"deliberately conservative and deliberately crude… they are not a guarantee, and nothing here claims to be"*. The PV-extraction and patient-support halves of X1 remain open | PR #2 | **X1** (part) |
| §15 | Admin-editable personas/scenarios, no deploy | **NOT STARTED** | `sim_*` tables proposed only, `phase-a-recon.md:324` | — | X2 |
| §17 | AI Coach, `overall_score` | **DECISION REQUIRED** | Contradicts the no-score rule, `constraints.md:53-54` | — | **X2, X4** |
| §21 | STT vendor | **DECISION REQUIRED** | No vendor; Whisper-class measured poorly on Hinglish, `blocked-on-you` 4.2 | — | **D2, BE-W32** |
| §21/§37 | Provider interfaces | **UNVERIFIED** | `packages/core/src/field/gateway/providers.ts:43` is an `interface LlmProvider` only; no adapter, on purpose | PR #2 | D1, D2 |
| §22 | Upload grant + retention | **DONE** | `emulator` 23 Sep: object in Storage, server byte count 382527, `purge_after` = receipt + 90d, phone folder empty after (PROJECT-OVERVIEW MR-54 A2) | main | — |
| §22 | Local encryption of the outbox | **NOT STARTED** | *"None found. Field outbox is AsyncStorage/SQLite, unencrypted"*, `phase-a-recon.md:154` | — | — |
| §23 | Consent capture + server verification | **DONE** | `emulator` 23 Sep: doctor agreed 11:49:44Z; verified in four places; `recording-permission.spec.ts` asserts the four agree | main | — |
| §24 | Withdrawal | **IN PROGRESS** | Server half works — `cascade_consent_withdrawal`, and `begin_upload` refused the withdrawn visit. **Phone half does not**: `emulator` MR-54 A5 wrote 518,740 bytes of a withdrawn doctor and kept them | main | **FE-W70, BE-W95** |
| §25 | Transcripts | **UNVERIFIED** | `ingest_transcript` built and tested, `service_role`-only, called **only** from `transcript-ingest.spec.ts`; `transcripts_redacted` written by nothing | main | D2 |
| §26 | Classification | **DECISION REQUIRED** | No severity/triage/confidence/category on `adverse_event_reports`, by design and by test | — | **X3** |
| §27 | AE structured extraction | **BLOCKED** | Named PV/DPDP signatory does not exist | — | **C3**, 4.1, X3 |
| §28 | Safety duties over real visits | **BLOCKED** | Same signatory, `decisions.md` C3 | — | **C3** |
| §29 | AI Doctor kept separate from real-visit data | **NOT STARTED** | Direction agreed (own tables, reuse the *mechanism*); nothing built | — | D1, X2 |
| §33 | Skill scores | **DECISION REQUIRED** | Same no-score rule | — | **X2** |
| §34 | Manager sees team averages | **DECISION REQUIRED** | The rule names *"the manager surface"* explicitly | — | **X2** |
| §35/§36 | Content "approved by" a medical/scientific reviewer | **UNVERIFIED** (mechanism) / **DECISION REQUIRED** (who) | Four-eyes approval with stored written attestation, `20260924000600_knowledge.sql`; the *person* is unnamed | PR #2 | **X5, D8** |
| §36 | *"every production prompt is versioned and approved, and a session names the version it used"* | **UNVERIFIED** | `20260924000700:7` quotes it; `ai_prompt_versions` with draft → in review → approved / rejected → retired, four eyes, one approved version per org per feature. **No seed sets one**, so `ai_begin_request` raises `45011` today | PR #2 | D1, D8 |
| §37 | `generateStructured()` / `embed()` | **UNVERIFIED** | `providers.ts:47,88` — interfaces only | PR #2 | D1, D2 |
| §38 | *"Validate model output server-side"* | **UNVERIFIED** | `providers.ts:89` quotes it and states the design: *"A vendor's JSON mode is a convenience; it is never trusted to have produced the right shape."* Validation is Zod, ours | PR #2 | D1 |
| §41 | Audit events | **DONE** (mechanism) / **NOT STARTED** (on AI tables) | `write_audit_row` on 16 tables; audio tables added 24 Sep (`20260924000100`). **No AI/LMS table carries it yet** — a gap this document registers and does not fix | main / PR #2 | — |
| §42 | Usage tracked and limited | **UNVERIFIED** | `20260924000700:8`; `ai_requests` + `ai_daily_requests_per_user`, which **refuses when unset** — *"An unlimited allowance is never the default"* (`:486`). Set only inside tests | PR #2 | D1, D7 |
| §44 | Notifications | **NOT STARTED** | *"§44 says integrate with the existing notification system — there isn't one"* | — | **D9** |
| §46/§47 | *"Never assume one country's promotional/regulatory content applies everywhere"* | **UNVERIFIED** | `20260924000600:7` quotes §47 and `:39` enforces it — product content must name a market. `markets`, `product_markets` built (AI-B1). Market placed on content as an **assumption**, not a ruling | PR #2 | **D6** |
| §48 | Patient-support AI | **DECISION REQUIRED** | Likely belongs in the separate clinical project | — | **X1** |
| §49 | Clean versioned APIs | **DECISION RECORDED — dropped** | API versioning dropped, `constraints.md:73`. Not open work | main | X6 (closed) |
| §50 | Frontend contract package | **UNVERIFIED** | `docs/ai-platform/api-contracts.md` (202 lines) over the Zod schemas; no frontend consumes it | PR #2 | — |
| §51 | Error codes | **UNVERIFIED** (partial) | `45011`/`45012` minted in AI-D0 and wired into `refusals.ts`; the rest of §51's codes do not exist | PR #2 | D1 |
| §52 | *"Do not log confidential payloads unnecessarily"* | **UNVERIFIED** | `20260924000700:9` quotes it; the request log holds *"identifiers, counts, timings and flags only"* — **no column for text** (`ai.ts:21`). Asserted by `product-qa.test.ts:147`: *"the log never receives the question"* | PR #2 | D1 |
| §53 | Error taxonomy — *"invalid structured response"*, *"AI provider timeout"* | **UNVERIFIED** | **Not a test list.** `benchmarks.ts:145,159` quote these two named failure modes and implement a benchmark case for each; both fail closed | PR #2 | D1, D2 |
| §54 | *"Every model/prompt update should run benchmarks. Compare against expected classification … critical flags … required escalation."* | **UNVERIFIED** | `benchmarks.ts:5` quotes it; 273 lines, two case kinds (guardrail cases script the model; others need a real one). **4 cases wait for a real model** | PR #2 | **D1, D2** |
| §56 | Status vocabulary | **IN USE, and enforced in the source** | `20260924000500_lms_core.sql:45` — *"Per the master prompt §56 and `constraints.md` ('Check that anything you build is actually called by something'), that makes the whole feature UNVERIFIED until an app exercises it."* The build labelled its own work UNVERIFIED | PR #2 | — |

## A2. The 20 sections with no textual trace

**§1, §2, §6, §11, §12, §13, §14, §16, §18, §19, §20, §30, §31, §32, §39, §40, §43, §45, §55,
§57.**

Two notes on the edges. **§4's citation is ambiguous** — the literal `§4` at
`phase-a-recon.md:11` is that file's *own* §4; only *"`ai_features` (the §4 identifiers)"* refers
to the prompt, and A1 lists it on that reading. **§1** appears in three migration headers but
every one of them means `phase-a-recon.md` §1.1 / §1.9, not the prompt, so §1 is in this list.

For every section here the honest status is **UNKNOWN: the section text is not in the
repository** — not "NOT STARTED". Writing "NOT STARTED" against a section whose subject I cannot
read would be exactly the recollection-over-evidence failure this session exists to prevent.

## A3. What the section-by-section walk actually shows

Read down the Status column and the shape is stark, and it is not the shape a §1–§57 programme
plan implies:

Counted by row of A1's table — **36 rows covering 37 distinct sections**, since several rows cover
a cited range (§5/§9, §7–§9, §35/§36, §46/§47, §21/§37) and §22 gets two rows.

| Status | Rows | Where |
| --- | --- | --- |
| **DONE** | 2 | §22 grant/retention, §23 consent — both `main`, both `emulator` |
| **DONE** (mechanism) / **NOT STARTED** (on AI tables) | 1 | §41 audit |
| **UNVERIFIED** | 15 | **all 15 on PR #2** |
| **UNVERIFIED** (partial) | 1 | §51 error codes |
| **UNVERIFIED** + **DECISION REQUIRED** (hybrid) | 2 | §10 guardrails, §35/§36 approval |
| **DECISION REQUIRED** | 6 | §17, §21 STT, §26, §33, §34, §48 |
| **BLOCKED** | 2 | §27, §28 — both on C3, the PV/DPDP signatory |
| **IN PROGRESS** | 1 | §24 withdrawal — server half works, phone half does not |
| **NOT STARTED** | 4 | §15, §22 encryption, §29, §44 |
| **DECISION RECORDED — dropped** | 1 | §49 |
| **IN USE** | 1 | §56 |
| | **36** | |
| **UNKNOWN — text absent** | 20 | A2 |
| | **56 rows / 57 sections** | |

**Two DONE against eighteen UNVERIFIED rows is the whole story of this codebase**, and it is the
story §56 exists to force into the open. Every one of those eighteen is on PR #2. The AI platform
did not fail to get built — **it got built and never got called.** Part B measures exactly that,
and finds zero of eight pieces reached by an app.

---

# PART B — WHAT HAS ACTUALLY BEEN CALLED BY AN APP

This is the distinction §56 turns on, and it is this project's characteristic defect.

## B0. Method and population

Population extracted from the SQL, not from remembered names: an `awk` pass over
`services/api/supabase/migrations/*.sql` pairing each `create [or replace] function <name>` with
the first non-comment `security definer` in its body, keeping the **last** definition per name
(functions are redefined across migrations). Callers found by grepping `apps/console/src`,
`apps/field/src`, `apps/field/app`, `packages/core/src`, `packages/ui/src`, `services/api/tests`,
`services/api/scripts`, `services/mock/src`, `scripts`, `.github`, and separately the migrations
themselves for SQL-internal calls.

**Population: 90 SECURITY DEFINER functions on `main`, 123 on PR #2.** `main` is a strict
subset — every shared function has an identical last-definition file:line on both branches. The
33 new ones come from the five PR #2 migrations.

> **A discrepancy I am not hiding.** A second, cruder `awk` pass over the same files gives
> **94 / 127**. The two methods differ by 4 in absolute terms — the crude pass mis-attributes a
> `security definer` line to a preceding function in a few multi-function migrations — but
> **both give a delta of exactly 33**, which is the load-bearing number. Treat 90/123 as the
> careful figure and 33 as certain. If the absolute number matters to a decision, re-derive it.

**Two traps that would corrupt this count if missed:**

1. `services/api/rollbacks/*.down.sql` mentions almost every function. Those are `DROP`
   statements, **not callers**. Excluded.
2. `packages/core` is largely a **contract declaration** package. `API_PATHS`
   (`endpoints.ts:688-746`), `LMS_RPC` (`lms.ts:135`), `KNOWLEDGE_RPC` (`knowledge.ts:113`) and
   `AI_RPC` (`ai.ts:124`) are **string tables**. A function name appearing there is **not** a
   caller. The only genuine wrapper is `createApiClient` (`client.ts`), and each of its methods
   was traced to an app call site.

## B1/B2. The four counts, and the never-called list

| Class | PR #2 | `main` only |
| --- | --- | --- |
| **apps/field** | **7** | 7 |
| **apps/console** | **7** | 7 |
| **both apps** | **0** | 0 |
| **script only** (`services/api/scripts`, `.github`) | **13** | 13 |
| **tests only** | **42** | 25 |
| called by other SQL only (triggers, RLS predicates, internal helpers) | 54 | 38 |
| **NOTHING at all** | **0** | 0 |
| **Total** | **123** | 90 |

### The never-called list is empty, and that is the wrong question

**Every one of the 123 functions has at least a trigger attachment, an RLS reference, an internal
SQL call, a script, a test or an app caller.** Verified per name with both an
exclude-definition/grant/revoke/comment grep of the migrations and a word-boundary grep across
all source trees; zero names came back empty on both.

**So the number that matters is not "never called" — it is 42 tests-only.** Under §56's rule,
a function whose only caller is its own spec is exactly as unexercised as one with no caller at
all. The difference is that it *looks* covered.

**14 of 123 functions (11%) are reached by an app. 42 (34%) are reached only by a test.**

### apps/field — 7

`recording_permission` (`recording-permission.ts:105`) · `daily_mileage` (`visits.ts:98`) ·
`sync_push` (`push-client.ts:219`) · `begin_upload` (`push-client.ts:321`) · `my_shift_window`
(`shift-window.ts:38`) · `record_check_in` and `record_check_out` — both via the `createApiClient`
wrapper (`client.ts:234-248` → `endpoints.ts:702-703`) from `visit/[id].tsx:377` and
`outbox.ts:655,660`.

### apps/console — 7, all through `createApiClient`

`list_audit_log` (`admin/page.tsx:85`) · `retention_status` (`admin/page.tsx:86`) ·
`list_consent_records` (`admin/page.tsx:84`, `coaching/page.tsx:60`) · `list_analyses`
(`coaching/page.tsx:59`) · `read_analysis` (`coaching/[analysisId]/page.tsx:55`) ·
`list_analysis_overrides` (`overrides-panel.tsx:32`) · `create_analysis_override`
(`override-form.tsx:83`).

**No function is called by both apps.** The two apps share a contract package and a database and
touch entirely disjoint RPC sets.

### Script only — 13

The retention and recovery machinery, which is the one subsystem with no UI and no app caller by
design: `audio_purge_health`, `claim_expired_audio`, `close_stale_upload_sessions`,
`confirm_audio_destroyed`, `record_audio_purge_failure`, `finish_audio_purge_run`,
`begin_restore_reconciliation`, `reconcile_row_without_object`, `reconcile_object_without_row`,
`finish_restore_reconciliation`, `storage_key_is_referenced`, `ucpmp_cap_decision_status`
(also `.github/workflows/ci.yml:198`), `be_w106_decision_status`.

### Tests only — the 42, in full

**On `main` — 25, all granted to `authenticated` and callable by a signed-in user today:**

`abandon_upload`, `resume_upload`, `record_upload_progress`, `my_upload_queue`,
`issue_recording_upload_grant`, `clear_audio_quarantine`, `search_doctors`, `team_activity`,
`team_exceptions`, `mr_activity_detail`, `approvable_call_reports`, `approve_call_reports_bulk`,
`overdue_call_reports`, `list_sync_rejections`, `reinstate_sync_item`, `sync_queue_status`,
`read_consent_record`, `respond_to_analysis`, `report_adverse_event`,
`adverse_event_clock_summary`, `sample_cap_status`, `org_default_shift_window_status`,
`purge_expired_sync_events`, `ingest_detected_adverse_event`, `ingest_transcript`
(`service_role`).

**On PR #2 — 17 more, the entire AI/LMS/knowledge write surface:**

`ai_begin_request`, `ai_complete_request`, `search_approved_knowledge`,
`submit_ai_prompt_version`, `approve_ai_prompt_version`, `reject_ai_prompt_version`,
`retire_ai_prompt_version`, `submit_knowledge_version`, `approve_knowledge_version`,
`reject_knowledge_version`, `retire_knowledge_version`, `publish_course_version`,
`retire_course_version`, `assign_course`, `cancel_course_assignment`, `start_course_version`,
`complete_lesson`.

## B3. The eight pieces of PR #2 — what has ever been reached from an app

**None of them. Zero of eight.**

| Piece | Reached from an app? | Only ever reached from |
| --- | --- | --- |
| Recon document | n/a — a document | — |
| D1 premise measurement | n/a — a throwaway function, deleted, never committed | — |
| **AI-B1 catalogue** | **No** | `catalogue.spec.ts` |
| **AI-B2 LMS core** | **No** | `lms-core.spec.ts` (7 RPCs) |
| **AI-C1 approved knowledge** | **No** | `knowledge.spec.ts`, `ai-control-plane.spec.ts` (4 RPCs) |
| **AI-C2 any-term search** | **No** | `ai-product-qa.spec.ts` via the gateway wrapper |
| **AI-D0 control plane** | **No** | `ai-control-plane.spec.ts` (6 RPCs) |
| **AI-D1 gateway logic** | **No** | `product-qa.test.ts` and `ai-product-qa.spec.ts` |

`answerProductQuestion` (`gateway/product-qa.ts:117,128,161`) is the one real wrapper over
`ai_begin_request`, `ai_complete_request` and `search_approved_knowledge`. It is imported by
**exactly two files, both tests.** No app imports it.

**This is the migration header's own verdict, and the build wrote it before I did**
(`20260924000500_lms_core.sql:45`): *"Per the master prompt §56 and `constraints.md` ('Check that
anything you build is actually called by something'), that makes the whole feature UNVERIFIED
until an app exercises it."* PR #2 is honest about its own status. The problem is not a false
claim; it is that 8,174 lines were added without a consumer.

## B4. Five findings this enumeration turned up

**1. `respond_to_analysis` is granted to `authenticated` and unreachable in production.**
The field reply screen (`reply/[analysisId].tsx:90`) calls `client.respondToAnalysis`, which posts
to `API_PATHS.analysisResponse` = `` `/analyses/${id}/response` `` (`endpoints.ts:720`). **Only the
mock serves that route** (`services/mock/src/server.ts:478`, pattern `/analyses/:id/response`).
PostgREST has no such path — it serves `/rpc/<name>`. Against Supabase the RPC is never invoked.
*Verified independently: `grep -c team_activity client.ts` → 0, and the mock pattern confirmed.*

**2. The entire manager surface is dead client-side.** `team_activity`, `team_exceptions`,
`coverage`, `mr_activity_detail`, `approvable_call_reports`, `approve_call_reports_bulk`,
`overdue_call_reports`, `list_sync_rejections`, `reinstate_sync_item`, `search_doctors` and
`sync_queue_status` all have `/rpc/…` paths declared in `endpoints.ts:729-739` **and mock
handlers**, but **no method on `createApiClient` and no app call site**. They are granted EXECUTE
to `authenticated`. This is an entire user role — field manager, one of the three that exist —
built in the database and absent from both apps.

**3. `purge_expired_sync_events` has no runner.** No script, no workflow, no SQL caller — only
`sync-pull.spec.ts:750`. **`sync_events` will grow unbounded in a deployment.** Registered here;
not fixed.

**4. PR #2 expands the `authenticated`-callable SECURITY DEFINER surface by 17 functions with no
consumer.** That is a security-relevant fact independent of whether the features are wanted: 17
new doors, granted to every signed-in user, exercised only by tests.

**5. `audio_purge_is_stalled` reads as script-called and is not.** Both mentions in
`check-purge-health.mjs` (lines 24, 53) are **comments**; the script reads the verdict out of
`audio_purge_health()`'s jsonb. Grep alone misclassifies it — which is the general warning for
anyone re-deriving this table.

---

# PART C — THE TWO APPS, SCREEN BY SCREEN

**PR #2 changes no application code.** `git diff --stat main...HEAD -- apps/` is empty, so this
inventory is identical on both branches. Everything in Part C is **`main`**.

## How the base URL is chosen — this is the whole story

**`apps/field` has two clients, and which one a screen imports decides whether it is real.**

- **Mock** — `apps/field/src/config.ts:42`:
  `process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4010'`, consumed by
  `apps/field/src/api.ts:30-32`. Any screen calling `createClientForScenario` talks to
  `services/mock`.
- **Real** — `apps/field/src/capture/client.ts:62-66` → `apps/field/src/supabase.ts:13`
  → `EXPO_PUBLIC_SUPABASE_URL` (`config.ts:24`).

**`apps/console` has one client and it is always real** — `apps/console/src/lib/session.ts:24-30`
builds `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1`. No `:4010` anywhere in `apps/console/src`, and a
test reads every console source and fails if one reappears (commit `1f30fd9`).

## C1. `apps/field` — expo-router, 24 routes

| Screen | Route | Source | Evidence class | Evidence |
| --- | --- | --- | --- | --- |
| Splash gate | `/` | none | n/a | — |
| Sign-in | `/sign-in` | **REAL** | (b) inspection | `src/supabase.ts:13` |
| Transparency | `/transparency` | none (static) | n/a | — |
| Onboarding ×5 | `/onboarding/*` | none (device) | n/a | — |
| **Today** | `/home` | **REAL** | **(a) ELIMINATION** | `docs/gotchas.md:3515-3534` — mock on `:4010` not running at all, screen still rendered |
| **Doctors** | `/doctors` | **REAL** | **(a) ELIMINATION** | `COMPLETION-PLAN.md:2286` — *"mock dead; screen rendered the three DEMO doctors… MR-44's table called this row 'STILL MOCK' by inspection, and was wrong"* |
| **Beat plan** | `/beat-plan` | **REAL** | **(a) ELIMINATION** | `COMPLETION-PLAN.md:2285` — Pixel 10, mock dead, rendered exactly what Postgres held |
| Doctor profile | `/doctor/[id]` | **REAL** | (b) inspection | `doctor/[id].tsx:4` |
| Visit | `/visit/[id]` | **REAL** | (b) inspection; write path has commit evidence `9c2ff56` | `src/sync/push-client.ts:218` |
| Consent | `/consent/[visitId]` | **REAL** | (b) inspection | `src/consent/notices.ts:3-8` |
| Samples | `/samples/[visitId]` | **REAL** | (b) inspection | `samples/[visitId].tsx:162` |
| Voice note | `/voice-note/[visitId]` | **REAL** | (b) inspection | `src/sync/push-client.ts:319` |
| Queue | `/queue` | **REAL** | (b) inspection | `queue.tsx:7` |
| **Call report** | `/report/[visitId]` | **MIXED** — reads MOCK, writes REAL | (b) inspection | reads `report/[visitId].tsx:44-46`; write `:106` |
| **Coaching feed** | `/coaching` | **MOCK** | (b) inspection | `coaching.tsx:19` admits *"This screen still READS from the mock at :4010"* |
| **Analysis detail** | `/analysis/[id]` | **MOCK** | (b) inspection | `analysis/[id].tsx:46` |
| **Analysis reply** | `/reply/[analysisId]` | **MOCK** | (b) inspection | `reply/[analysisId].tsx:39,89` |
| **Day end** | `/day-end` | **MOCK** | (b) inspection | `day-end.tsx:83` |
| **Mileage** | `/mileage` | **MOCK** | (b) inspection | `mileage.tsx:59` |

**Six field surfaces still read the mock**: coaching, analysis, reply, mileage, day-end, and the
read half of the call report. **Three screens are established by elimination; the rest by
inspection.**

## C2. `apps/console` — Next.js App Router, 5 routes, all real

| Screen | Route | Source | Evidence class | Evidence |
| --- | --- | --- | --- | --- |
| Root redirect | `/` | none | n/a | `page.tsx:12` |
| Sign-in | `/sign-in` | **REAL** | **(a) ELIMINATION** | `1f30fd9` — *"an admin signed in… with the mock killed it still worked"*; `COMPLETION-PLAN.md:2484` — *"curl → 000, nothing listening on 4010"* |
| Coaching queue | `/coaching` | **REAL** | **(a) ELIMINATION** | same sweep; `PROJECT-OVERVIEW.md:18212` |
| Analysis review | `/coaching/[analysisId]` | **REAL** | **(a) ELIMINATION**, driven twice | `74e7303` — panel rendered from the real read with the mock running, then killed |
| Admin / consent versions | `/admin` | **REAL** | **(a) ELIMINATION**, weaker for the retention panel | MR-52 A5 sweep, `COMPLETION-PLAN.md:2481-2484`. The MR-41 C2 retention measurement is *corrective*, not clean: a stale mock on `:4010` caused a false negative (`COMPLETION-PLAN.md:313`) |

**The console is the stronger app on this axis**: 4 of 4 data-bearing screens by elimination,
against 3 of ~14 in the field app.

## C3. Screens for features that produce nothing yet

### Structurally empty — nothing ever writes the row

**`analyses` has no insert path in production code.** `insert into public.analyses` appears only
at `services/api/tests/fixtures.ts:514` and `consent-audio.spec.ts:673`. No seed script writes
it. The root cause is stated in the repo itself —
`packages/core/src/field/gateway/providers.ts:5-9`: *"No adapter exists yet, on purpose: writing
one would choose a vendor."* There is no LLM SDK import and no `fetch` to a model endpoint
anywhere in `packages/core/src`.

| App | Screen | Why empty |
| --- | --- | --- |
| console | Coaching queue `/coaching` | reads `list_analyses` against the real server; `analyses` never written → **always empty**. This is the known example |
| console | Analysis review `/coaching/[analysisId]` | `read_analysis` returns null → renders the "could not be loaded" note (`:59-67`). **Its override form is dead by dependency**: `create_analysis_override` is a real wired writer with nothing to override |
| field | Coaching feed `/coaching` | would be empty against the real server. **Not empty today only because it reads the mock's fixtures** |
| field | Analysis detail `/analysis/[id]` | same |
| field | Analysis reply `/reply/[analysisId]` | same; `respond_to_analysis` exists (`20260811000300:461`) with no row to act on |

**A second always-empty chain: transcripts.** Audio uploads for real, but nothing transcribes it.
`ingest_transcript` is `service_role`-only and called only from its own spec. There is no
edge-function directory and no transcription worker. This makes the citation panels on the
analysis screens **structurally unfillable even if analyses existed** — the coaching queue is not
one empty feature, it is the visible end of a three-link empty chain.

### Empty by plumbing, not by data — the mileage screens

`mileage.tsx` and the mileage half of `day-end.tsx` call `listMileage()` →
`API_PATHS.mileage = '/mileage'` (`packages/core/src/field/endpoints.ts:705`). **There is no
`mileage` table or view in any migration** — only the function `public.daily_mileage(...)`
(`20260812000100:427`), which is **not in `API_PATHS`**. So `/mileage` resolves on the mock and
would 404 against PostgREST. The data exists (it derives from `check_ins`, which the app really
writes). This screen cannot simply be repointed.

### Built backends with no screen at all

Not "screens that produce nothing" but the same defect from the other side, and the larger
population: `adverse_event_reports` / `report_adverse_event`; the whole LMS set; the whole
knowledge set; the whole AI control plane; and `product-qa.ts`, a complete feature with **no
caller in `apps/`**. All PR #2 except the first.

### One methodology warning, from the repo's own record

`COMPLETION-PLAN.md:2288-2295` records that MR-44 read the Doctors screen's source, concluded
*"STILL MOCK"*, and wrote two wrong comments into a file whose line 31 calls `usePulledStore()`.
Elimination corrected it in one tap. **Every row above marked (b) inspection carries exactly that
risk** — in particular the visit / consent / samples / voice-note write paths. Six screens would
settle in one session: kill `:4010`, open each, see what renders.

---

# PART D — EVERY OPEN DECISION, IN FULL TEXT

## D1. The eighteen from `phase-a-recon.md`, quoted in full

### §3 — the conflicts: X1–X8

Preamble, quoted: *"Each needs a named person to rule. **None has been worked around.**"*

| # | Prompt says | Repo says | Source |
| --- | --- | --- | --- |
| **X1** | §10, §27, §48: detect patient identifiers, extract minimal patient info for PV, future patient-support AI | **"Zero patient or clinical data in this repo. Not even placeholder tables."** Patient/PV roles live in the *clinical* Supabase project | `constraints.md:18-20` |
| **X2** | §17, §33, §34: `overall_score`, subscores, skill scores, manager sees team averages | **"Never add a ranking, score, rank, percentile or grade to `analyses` or the manager surface."** Tests assert it | `constraints.md:53-54`; `packages/core/src/field/analysis.ts:7-10` |
| **X3** | §27: AE "structured extraction"; §26 classification | **No severity/triage/confidence/causality/category on `adverse_event_reports`** — "a field a model could write a judgement into is a field a model will" | `constraints.md:55-58`; `adverse-event.ts:10-18` |
| **X4** | §17 AI Coach, §34 Manager AI | **C4: coaching is OUT of v1** until §3.6 is written down with a named human | `.ai-collab/decisions.md` C4, C7 |
| **X5** | §35, §36: content "approved by", medical/scientific reviewer | **Three roles only; "a fourth role may never exist here"** | `constraints.md:18, 70-72` |
| **X6** | §49: "clean versioned APIs" | **API versioning DROPPED** — one consumer, pre-release | `constraints.md:73` |
| **X7** | §22-§28 on real visits | **C3: audio OUT of v1** until the PV/DPDP signatory exists; the consent text doesn't name AI processing (`BE-W109`) | `decisions.md` C3, C8; `BACKEND-DECISIONS.md` §2 |
| **X8** | §44: reuse existing notifications | None exist | §1.9 |

**The author's read on each, quoted in full, labelled in the source as *"a starting point for the
decision — not a ruling"*:**

> - **X1** — the prompt's own §48 says keep patient AI separate. That separation already exists:
>   it is the clinical project. Patient education should be built **there**, not here. PV
>   "structured extraction" of patient details should not happen in this database at all; the
>   commercial side flags a passage and the clinical side owns the case.
> - **X2** — this is the one with the most real tension. The rule was written for analyses of
>   **real doctor visits**, which is employee monitoring (C8). AI Doctor sessions are
>   **simulations the MR chose to do.** There is an argument that a practice score on a
>   simulation is a different thing. But the rule also names **"the manager surface"**, and
>   §34's team averages sit exactly there. **Do not let the build decide this.** Options: (a)
>   scores on simulations, visible only to the MR; (b) scores visible to managers too, with the
>   rule formally amended; (c) no numeric scores, cited findings only, like `analyses`.
> - **X3** — keep the rule. Let the AI set `source = 'transcript_detected'` and point at a span.
>   That already meets the prompt's own "must not independently close or reject a safety case".
> - **X4** — AI Coach on *simulations* is different from coaching on *real visits*, but C4 is
>   written about coaching generally. Needs the operator to say whether C4 covers practice.
> - **X5** — `admin` can hold the "approve" action, with the approver's name and a required
>   attestation stored on each approval row. That keeps three roles. Medical/regulatory sign-off
>   would then be a **process** fact (a named admin who is the medical reviewer), not a role.
> - **X6** — keep it dropped. Version the *contracts* (`TranscriptV1` pattern) and the *prompts*,
>   not the URL paths.

**X5 has since been answered the way the note recommends, and the reviewer should know that
before ruling:** AI-C1 stores a written attestation on the approval row and keeps three roles
(`20260924000600_knowledge.sql`). X5 is a ratification, not an open design question. **X7 and X8
carry no author's note** — they were left to C3 and D9 respectively.

### §4 — decisions required before Phase B: D1–D10

Preamble, quoted: *"Numbered so they can be answered by number. **Owner** is who should answer,
not who asks."*

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

#### D1 in full — it is the architectural fork

| Option | For | Against |
| --- | --- | --- |
| **(a) Supabase Edge Functions as a thin gateway** — every auth, scope, flag, quota and audit decision stays in Postgres RPCs; the function only holds the vendor key, calls the model, validates JSON, and writes the result back through an RPC | Same platform. `config.toml` has `[edge_runtime] enabled = true`. Supports streaming (SSE). Keeps "RLS is the enforcement layer" intact because the function calls RPCs **as the user's JWT** | BE-W7 rejected Edge Functions **for the retention worker**, on the grounds that the local stack could not run one. That premise looks stale now — **not yet verified by running one.** Deno, not Node. Adds a runtime to test |
| **(b) A separate Node service** | Familiar tooling | Exactly the "second backend" the prompt and `architecture.md` both warn against. Hosting, secrets, deploys, one more place for a bug to bypass RLS |
| **(c) GitHub Actions / queue workers only** | Matches the retention pattern | Fine for async jobs (transcript analysis, embeddings, benchmarks). **Cannot serve interactive chat or a live AI Doctor** |

> **Recommendation: (a) for interactive calls, plus (c) for batch work** (embeddings, transcript
> analysis, benchmark runs). The gateway is deliberately dumb: it cannot grant anything the
> database would not.

**BE-W7's premise was re-measured on 24 September 2026 and no longer holds** — a throwaway
function (deleted, never committed) was served by `supabase-edge-runtime-1.74.3`; no token gave
401; the anon key was refused by the database (`42501`); a signed `authenticated` token ran and
Postgres decided. The recon states the limit of that result explicitly: *"This removes the
testability objection. It does **not** by itself make D1 decided: BE-W7's other point — a second
place for logic to live — still stands."*

## D2. `blocked-on-you.md` and `BACKEND-DECISIONS.md`, deduplicated

`BACKEND-DECISIONS.md` says of itself: *"Twenty-two decisions, server-side only… The canonical
rows live in `docs/blocked-on-you.md`… If this file and that one ever disagree, that one is
right."*

**A finding about the file itself.** `BACKEND-DECISIONS.md` is **untracked** —
`git ls-files --error-unmatch BACKEND-DECISIONS.md` fails, and commit `5313513`, titled *"one
list of every decision the backend is waiting on"*, touched **only `docs/blocked-on-you.md`
(+79)**. `handoff.md:97` records this as deliberate — *"Created, untracked, uncommitted"* — but
the result is that the document written to be sent to the client exists on one machine and in no
backup. It is also **not** on PR #2.

Its own framing, which is the single most important line for the reviewer: **"As of this date
there is no open backend item that engineering can close on its own. Every item below is a
decision, not a task."**

### The 22, in full

**1. Dated — these turn CI red, or their cost grows daily**

- **1.1 The UCPMP sample cap — value, dimension, and whether `input` counts.** Owner: client
  (`5.9` / `BE-W21`). *"A build-failing deadline of **6 November** is already wired, warning from
  **16 October**. Until the number is set, `enforce_ucpmp_sample_cap()` is inert: samples are
  accepted and uncounted, and the samples screen says so. **Do not let engineering pick a number
  to clear it.** A constraint built on an invented figure looks enforced while being wrong
  invisibly."*
- **1.2 Should configuration belong to an ORGANISATION?** Owner: client (`2.7` / `BE-W106`).
  *"`app_thresholds.scope` is `global` or `territory` and nothing else. The read leak was closed
  in September; the **model** is untouched, so every organisation still shares one set of
  thresholds. Dated **2026-10-31** and wired into `check:decision-debt`."*
- **1.3 The organisation's registered legal name for the consent notice.** Owner: client
  (`5.13` / `BE-W93`). Also whether MRs' display names may be shown to doctors. *"**This is the
  only item whose cost is larger tomorrow than today.** `consent_records` is append-only by
  design, so every consent captured before the name exists is permanently defective **and cannot
  be amended**. The property that protects the ledger from tampering is the one that prevents
  repair."*

**2. The recording and transcript path — built, and cannot be switched on**

- **2.1 The named PV/DPDP signatory.** Owner: client (`5.8`). *"Blocks audio, permanently. It is
  why the recording feature ships with its flag **off** and why the app refuses to start if that
  flag is turned on against anything but a local target."*
- **2.2 Which transcription vendor, and the measured Hinglish error rate.** Owner: client
  (`4.2` / `BE-W32`). *"Transcript ingestion is built, tested, and callable by nothing. Choosing
  a vendor needs labelled audio, which needs 2.3."*
- **2.3 Consent from employees whose audio joins the bake-off corpus.** Owner: client and legal
  (`E1`). *"Blocks collecting the corpus at all. The draft still needs: the vendor list, a
  retention date, and a named person an employee can withdraw to."*
- **2.4 The text a doctor reads before being recorded.** Owner: client (`E2` / `BE-W109`).
  *"The live notice says the team 'reviews how they presented'. It names neither the AI
  processing nor the SOP monitoring — so a doctor agreeing to it **is not agreeing to what
  happens**. Confirmed still live on the emulator on 23 September 2026."*
- **2.5 May an adverse-event report contain patient information, and does it leave the
  platform?** Owner: client (`4.1`). *"Decides the schema and the egress path for the
  adverse-event screening duty, which follows from transcripts existing at all."*

**3. What the consent ledger MEANS**

- **3.1 Is a doctor's second answer a withdrawal of the first, or a separate answer?** Owner:
  client (`5.14` / `BE-W95`). *"`is_withdrawal` and `supersedes_consent_record_id` are still
  null, because the app sends neither. Open since MR-24."*
- **3.2 When a doctor withdraws, must audio already on the rep's phone be destroyed?** Owner:
  client (`FE-W70`, measured 23 September 2026). *"**Measured on the emulator: a withdrawal does
  not stop a running recording.** 518,740 bytes of a doctor who had withdrawn were written to the
  phone and kept there. Nothing reached the company — the upload was refused and the server
  boundary held."*

  **Two recorded rules contradict each other and both cannot stand:**

  | | Says |
  | --- | --- |
  | The current engineering rule, under test | A refused recording is **KEPT** on the phone: a refusal is not proof it should be destroyed, and destroying it would also destroy the only copy of something a manager may need to know existed |
  | What was asked for in MR-54 | After a withdrawal, **nothing is left on the phone** |

  *"Engineering has deliberately not picked one. If the answer is 'destroy', two further things
  follow: the phone must gain a way to learn about a withdrawal at all (today it cannot), and the
  rep must be told something about a recording that has vanished."*
- **3.3 Which consent-notice language an MR is shown first.** Owner: client (`5.12`). *"Decides
  `displayed_language` on a compliance record. The current order is labelled **arbitrary** rather
  than dressed up as a preference."*
- **3.4 Confirm the two clock thresholds — 72 hours and 120 seconds.** Owner: client (`5.10`).
  *"`consent_max_sync_lag_hours` (72h) and `consent_future_tolerance_seconds` (120s) are both
  **UNVERIFIED** — defaults nobody has confirmed. **Their reach grew on 24 September.** They now
  also bound `recorded_at` on every audio upload, not only consent captures. Two figures nobody
  has ratified decide whether a recording can be filed at all."*

**4. Data model and retention**

- **4.1 The data-controller model.** Owner: client, open one month (`5.5` / `O1`). *"Controller
  fields on **every clinical table**. The patient app cannot start without it."*
- **4.2 Reference data and per-territory shift hours.** Owner: client, open since sprint 3
  (`5.7`). *"Capture **refuses** without them. The organisation-default window expires 60 days
  after configuration and then refuses again."*
- **4.3 Does a deleted storage object really disappear?** Owner: operator (`4.4`). *"Specifically:
  does it survive in S3 versioning, a soft-delete window, or a sub-processor's backup? This
  decides whether 'destroyed' in the destruction log is **true**. The 90-day promise is about the
  objects, not the rows."*
- **4.4 The storage gap.** Owner: operator (`7.2`). *"A database restore brings back every row
  describing an object and none of the objects. The recovery posture covers the ledger and not
  the audio."*

**5. Operations and recovery**

- **5.1 Production must be migrated before any reference data is loaded.** Owner: operator
  (`6.1`). *"A sequencing constraint with a date, not a backlog item."*
- **5.2 Re-make the point-in-time-recovery decision.** Owner: operator (`6.2`). *"Both premises
  of the original decision are absent, so the recorded 'daily backups plus the runbook' posture
  rests on assumptions that no longer hold."*
- **5.3 Where may the backup lawfully go?** Owner: operator (`6.3` / `BE-W11`). *"The backup
  mechanism is built and proven end to end — it produces a dump, restores it into a scratch
  database and compares counts. The artefact has **nowhere lawful to go**."*
- **5.4 The platform unknowns — one email to Supabase support.** Owner: operator (`7.3`).
  *"Several facts in the restore runbook are written down as 'unobserved' because nobody has
  asked."*
- **5.5 The Supabase paid plan, about $25 a month.** Owner: operator (`5.2`). *"The free tier
  **auto-paused production for two weeks in August**."*

**6. One that is engineering's, and is still a decision**

- **6.1 Auditing refusals that happen before the function runs.** Owner: engineering, with an
  operator trade-off (`BE-W102`). *"The in-body half was **closed on 24 September**… But a
  grant-level refusal fires **before the function body runs**, so no in-database mechanism will
  ever see it. Closing that half means logging at the API layer — which moves part of the trail
  outside the database that guarantees the rest of it. That trade is unchanged and still not
  chosen."*

**The file's own triage, quoted:** *"If you answer only three — 1.1 the UCPMP cap… 1.3 the
registered legal name… 3.2 destroy or keep on withdrawal. The current behaviour keeps audio of a
doctor who said stop."*

### Which ids are the same question under different names

| Same question | Names it goes by |
| --- | --- |
| Per-organisation configuration | **D7** = `BACKEND-DECISIONS` 1.2 = `blocked-on-you` 2.7 = **BE-W106** |
| The doctor's consent text names AI/SOP | **X7** (part) = `BACKEND-DECISIONS` 2.4 = `E2` = **BE-W109** |
| Audio may not touch a real doctor | **X7** (part) = `BACKEND-DECISIONS` 2.1 = `blocked-on-you` 5.8 = **C3** |
| STT vendor + Hinglish error rate | **D2** (part) = `BACKEND-DECISIONS` 2.2 = `blocked-on-you` 4.2 = **BE-W32** |
| AE may carry patient data / egress | **X1** (part) + **X3** (part) = `BACKEND-DECISIONS` 2.5 = `blocked-on-you` 4.1 |
| Coaching / scores on the manager surface | **X2** + **X4** = **C4** (+ **C7** partially reversing C4's second reason) |
| Who may approve content | **X5** + **D8** — and X5's mechanism half is **already built** (AI-C1) |

**Genuinely distinct, no duplicate:** D1, D3, D5, D6, D9, D10, X6, X8, and all of
`BACKEND-DECISIONS` §§1.1, 1.3, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1–4.4, 5.1–5.5, 6.1.

**Net population after dedup: 33 open decisions** — 18 from `phase-a-recon` (D1–D10, X1–X8) and
22 from `BACKEND-DECISIONS`, less 7 that are the same question twice. X5 and X6 are arguably
closed, which would make it 31.

## D3. Ranked by how much work each unblocks

Counted as: items in Part A's status table plus Part G3's step list plus Part E's register that
move from blocked to startable. **This ranks by unblocking power, not urgency** — the most urgent
item on the list (1.1, the UCPMP cap, which reddens CI on 6 November) unblocks almost nothing and
sits near the bottom.

| Rank | Decision | Unblocks | Count |
| --- | --- | --- | --- |
| **1** | **D1 — where the gateway runs** | Every AI capability. §4, §21/§37 providers, §51 codes, §54 benchmarks, the control plane's whole reason to exist, product_qa steps 10/11/25, MR chatbot, AI Doctor, Coach | **~14** |
| **2** | **D2 — vendor, and may data leave India** | Everything in rank 1 that needs a model to actually run, plus §21 STT, §25 transcripts becoming non-dead, the bake-off corpus, the 4 benchmark cases | **~10** |
| **3** | **C3 / 2.1 — the PV/DPDP signatory** | §22–§28 on real visits, §27 AE, Tier-1 automations 1/4/5/6, the coaching queue ever having rows, G-AE | **~9** |
| **4** | **X2 — scores, and whether managers see them** | §17, §33, §34, assessments, certification, `sim_evaluations` shape, Phase K, Phase E/F, Phase I | **~8** |
| **5** | **D5 — the product catalogue** | Catalogue rows, knowledge seeded against products, product_qa steps 16 and 18, LMS content, RAG scope | **~6** |
| **6** | **D4 — rule on X1–X7** | A meta-decision: resolving it resolves 5 still-open X items at once, several of which change the schema | **~5** |
| **7** | **D8 — the named approver** | Knowledge approval becomes usable by a real second human; product_qa step 18; §35/§36 | **~4** |
| **8** | **D10 — branch or main** | Nothing technically, but **all 8 pieces of PR #2 and 5 migrations** stay unmerged until answered. Cheapest high-leverage answer on the list | **~3** (8 artefacts) |
| **9** | **D6 — market on org or content** | Already assumed and built one way; an answer of "organisation" *reworks* AI-B1 and the knowledge scope rather than unblocking | **~3** (or negative) |
| **10** | **3.2 / FE-W70 — destroy or keep on withdrawal** | FE-W70, FE-W69's re-ask policy, and a phone-side withdrawal channel that does not exist | **~3** |
| **11** | **D7 / BE-W106 — per-org config** | Per-org entitlements, cost limits, model choice. Dated 2026-10-31 | **~3** |
| **12** | **D9 — notifications** | §44, plus anything in LMS/AI that wants to tell a user something | **~2** |
| **13** | **D3 — pgvector** | Vector retrieval only. **Explicitly not blocking**: AI-C2's any-term ranked search is the deliberate fallback | **~1** |
| **14** | **1.1 — the UCPMP cap** | Nothing downstream. But it reddens CI on **6 November** whatever else is true | **0 + a date** |
| 15– | 1.3, 2.2–2.5, 3.1, 3.3, 3.4, 4.1–4.4, 5.1–5.5, 6.1, X1, X3, X6, X8 | 0–2 each; several are irreversibility or operations risks rather than unblockers | — |

**The shape of that table is the finding.** Two decisions — D1 and D2 — gate roughly two-thirds
of everything not yet started, and both are answerable in a meeting. The reviewer should not read
this list top to bottom; they should answer D1, D2 and D10 and re-derive the rest.

---

# PART E — THE REGISTER

## E0. Which file is the register, and its defect

**`docs/COMPLETION-PLAN.md`.** It is the only file that defines the id namespace —
`:278`: *"IDs continue the existing convention from the highest already used — `BE-W8` and
`FE-W9`. No ID is reused."* So `BE-W9+` / `FE-W10+` are work items and `BE-W1..W8` / `FE-W1..W9`
are **sprint** ids. Any count of "BE-W" mentions that misses that split over-counts. It is also
the only file where items are registered as rows (title, changes, deps, blocker, half-day
estimate, verification command) and where closures are written back.

**Its defect, which shapes everything below: `COMPLETION-PLAN.md` has no status column.** Only
**39 of the 171 distinct ids** ever receive an explicit status row, and that convention only
begins around MR-30. Items registered before then are never marked open or closed again.

## E1. Every open BE-W and FE-W item

### Engineering — someone can just build it

| id | One line | Type | Estimate | Source |
| --- | --- | --- | --- | --- |
| **FE-W58** | Date labels re-derive a visit's day themselves — `samples/[visitId].tsx:235` prints the *schedule* date on a UCPMP-relevant record; `analysis/[id].tsx:175` and `report/[visitId].tsx:52` slice the ISO string, so the date is whatever offset it carries | ENGINEERING | **1d** | `COMPLETION-PLAN.md:2417` |
| **BE-W108** | The UCPMP cap's month is the **UTC** month — `date_trunc('month', occurred_at)` in the session timezone, so a sample handed over 00:00–05:30 IST on the 1st counts into the previous month | ENGINEERING | **0.5d** | `:2433` |
| **FE-W69** | The visit screen asks the server once — `useEffect` keyed on `[visit?.id]`, no focus listener, no invalidation — so a screen left in the stack keeps a stale recording permission | ENGINEERING | **0.5d** | `:2510`; `handoff.md:53` |
| **BE-W83** (remainder) | Restrictive tenant policies built for **18 of 19** directly readable tables. The 19th is `app_thresholds` | ENGINEERING | **unsizable until BE-W106** | `:2471` |
| **BE-W32** (engineering half) | Run the transcription vendor bake-off. The harness exists; the run needs 5–10 h of labelled Hinglish MR–doctor audio, which does not exist | ENGINEERING | **unsizable until E1 (corpus consent)** | `:2450` |
| **FE-W20** | Signed-in APK driven on a physical handset — closes `FE-G1` | ENGINEERING | **unsizable until a handset is provided** | `:345` |
| **FE-W19** | A full offline day on a physical handset, then sync — closes `FE-G2` | ENGINEERING | **unsizable until a handset is provided** | `:344` |

**Four of seven engineering items are unsizable.** Two of those wait on a physical handset, which
is not a decision anyone has to make — it is a device nobody has bought. That is the cheapest
unblock on the entire register and it appears in no decision list.

### Decision — waits on a human ruling

| id | One line | Ruling |
| --- | --- | --- |
| **FE-W70** | A withdrawal cannot stop a running recording; 518,740 bytes of a withdrawn doctor written to the phone and kept. Server boundary held | `BACKEND-DECISIONS` **3.2** |
| **FE-W52** | The reps' transparency notice understates what the app records — **six of eight claims false or partly false**. Truthful wording + 8 tests sit on branch `mr-46/fe-w52-notice-pending-approval`, **not on `main`**. Written at `2ab65f7` (MR-46 A) and **revised three times since while awaiting approval** — `17260f2` (the draft claimed a recording the app cannot make), `7ec0c0f` (redrafted for C8/C9), `75dd570` (voice notes are sent then removed). **The false notice is live on `main` the whole time** | `blocked-on-you` **2.6** |
| **BE-W109** | The doctor's notice names neither AI processing nor SOP monitoring | `blocked-on-you` **E2** |
| **BE-W106** | Per-organisation configuration. Leak closed; model untouched. Dated **2026-10-31** | `blocked-on-you` **2.7** |
| **BE-W21 / FE-W41** | The UCPMP cap value, dimension, and whether `input` counts. **CI red 6 November** | `blocked-on-you` **5.9** |
| **BE-W93** | The organisation's registered legal name. Cost accrues daily and cannot be repaired | `blocked-on-you` **5.13** |
| **BE-W95** | Is a doctor's second answer a withdrawal or a separate answer? Open since MR-24 | `blocked-on-you` **5.14** |
| **BE-W102** (grant half) | Grant-level refusals fire before the body runs; closing means logging outside the database | engineering trade-off, unchosen |
| **BE-W11** | Off-machine backup built and proven end to end; the artefact has nowhere lawful to go | `blocked-on-you` **6.3** |
| **FE-W65** | Should the beat-plan stop also open a visit in progress? Registered for a decision, deliberately not built | product ruling, **unnamed owner** |
| **FE-W48** | Client and server disagree what an absent capture source means — `'automatic'` vs `'manual'`. Unreachable today; live the day a GPS check-in exists | product ruling, **unnamed owner** |
| **FE-W11** | Correct the E1/E2 rows in `frontend-status.md` — recorded as *"needs a decision, not work"* | record-keeping ruling |
| **BE-W98** | A dead-letter replay carries no refusal figures. **DEFER with a named trigger** — revisit when a manager-facing dead-letter queue exists | trigger not yet met |
| **BE-W105** (remainder) | Three further unscoped SQL wrappers; MR-45 C found the label wrong and one half proven. No closing status row | partly NOT DETERMINED |

**14 decision items against 7 engineering items.** `BACKEND-DECISIONS.md`'s claim — *"there is no
open backend item that engineering can close on its own"* — is very nearly true of the whole
register, not just the backend.

### NOT DETERMINED — registered once and never resolved

**~40 ids carry a registration row and zero subsequent closure or re-confirmation.** Method:
`grep -c` for `closed|done|fixed|✅` on lines naming the id → 0.

Several are visibly **stale-open** — the thing was later built by other work and nobody went back:

- **`BE-W51`** (`:643`) — *"`POST /sync/pull` — no `sync_pull` function exists at all"*. It exists
  and runs on the device (MR-47/48).
- **`FE-W23`** (`:805`) / **`FE-W36`** (`:1039`) — *"no screen consumes the pull"*. Screens
  consume it.
- **`FE-W33`** (`:1025`) — *"no seed gives a signed-in MR a real working day"*. `seed:mr` is
  guarded and run (MR-43 D2).

The rest, listed so they can be swept: `BE-W48, BE-W49, BE-W50, BE-W52, BE-W53, BE-W54, BE-W55,
BE-W58, BE-W59, BE-W62, BE-W67, BE-W68, BE-W71, BE-W80, BE-W81, BE-W82, BE-W86`, `FE-W21, FE-W24,
FE-W25, FE-W26, FE-W27, FE-W28, FE-W31, FE-W34, FE-W35, FE-W37`. Three more — `BE-W18`, `FE-W17`,
`BE-W57` — have a recorded check that fails today, and MR-42 D1 says **the check is bad, not
necessarily the item** (`:1975-1977`).

**This is the register's real defect, and it is the same failure `CLAUDE.md` argues about the
deleted knowledge graph, reproduced inside the register itself.** A stale row arrives with the
strongest available signal of being checkable — an id, a file and a line — and a reader cannot
tell `BE-W51` (solved, unmarked) from a live defect. A one-column sweep
(`OPEN` / `CLOSED` / `SUPERSEDED`, plus last-touch session) would cost less than one of the
sessions counted in E2.

## E2. The discovery rate, from the register's own history

Counted from `### Added by <SESSION>` headings and `| **ID** — status | **CLOSED (MR-nn …)** |`
rows in `COMPLETION-PLAN.md`.

| # | Session | Opened | Closed | Net |
| --- | --- | --- | --- | --- |
| 1 | MR-45 | 4 | 2 | +2 |
| 2 | MR-46 | 2 | 1 | +1 |
| 3 | MR-47 | 4 | 1 | +3 |
| 4 | MR-48 | 4 | 3 | +1 |
| 5 | MR-49 | 5 | 5 | 0 |
| 6 | MR-50 | 2 | 8 | −6 |
| 7 | MR-51 | 3 | 3 | 0 |
| 8 | MR-52 | 0 | 3 | −3 |
| 9 | MR-53 | 1 | 0 | +1 |
| 10 | MR-54 | 5 | 5 | 0 |
| | **Total** | **30** | **31** | **−1** |

**The discovery rate is ≈ 1.0 — one new item registered for every item closed.** Two
qualifications, because the raw net flatters it:

- **6 of the 31 closures were of items opened in the same session** (`FE-W50`, `FE-W51`,
  `FE-W62`, `BE-W112`, `BE-W113`, `BE-W114`). Strip those: 24 pre-existing opens survived against
  25 pre-existing closes. Still ≈ 1.0, not better.
- The backlog fell only in **MR-50 and MR-52**, both of which opened almost nothing. **Every
  session that touched the device — MR-47, MR-48, MR-49, MR-54 — opened as many as or more than
  it closed.**

**The conclusion the reviewer needs: contact with a real handset is the generator of new items,
not a shrinking tail.** At a rate of 1.0, the register does not converge by working through it.
It converges when the thing that generates items — running the app on real hardware — has been
done enough times. Two device gates (FE-G1, FE-G2) have been open seven weeks waiting for a
handset nobody has bought, and the register cannot start converging until they close.

Two cautions on the instrument: the closure convention only exists from ~MR-30, so the same count
cannot be produced for earlier sessions; and the register is **edited in place**, not purely
appended — MR-46's close of `BE-W89` was written back into `:1052`, inside the MR-11 section. A
line-range count would miss it.

## E3. Work that would be CANCELLED, not completed

| Open item | Decision | Direction that cancels it |
| --- | --- | --- |
| **FE-W70** + its two consequences | `BACKEND-DECISIONS` **3.2** | **KEEP.** The current rule, already under test, keeps a refused recording. If KEEP, FE-W70 is not a defect — **and the phone gaining a withdrawal channel at all, and telling the rep a recording vanished, both vanish with it.** If DESTROY, all three get built |
| **BE-W106** (model half) | `blocked-on-you` **2.7** / **D7** | *"Global is correct."* The per-org threshold model disappears; only the shipped leak fix remains |
| **BE-W83** (19th table) | same | *"Global is correct."* With no per-org model there is no boundary to add to `app_thresholds` — cancelled, not deferred |
| **BE-W102** (grant half) | **6.1** | *"The trail stays in the database."* The half becomes permanently uncloseable by design |
| **FE-W65** | product ruling | *"One door."* MR-49 D3 registered it for a decision, naming the risk of opening the wrong visit for a doctor seen twice |
| **FE-W69** | design ruling inside the item | *"Mount-only is acceptable."* Cold starts are always correct, and each alternative costs network traffic **during a consultation** |
| **FE-W48** | product ruling | *"GPS check-in will never exist."* The disagreement never fires |
| **BE-W109** + the §8.6 signatory work | **C3** / `blocked-on-you` **5.8** | *"No recording of real doctors, ever."* The notice rewrite exists only to let a real recording happen; a permanent no cancels rather than postpones |

**One large cancellation is already foreclosed, and is listed because D4 could reopen it.**
*"Cut the AI layer"* would have cancelled `BE-W32`, `BE-W31`, `BE-W33`–`BE-W35`, `FE-W12`'s
coaching route, four tables, `TranscriptV0`, `CONTRACT_I3_DEADLINE` — and, easy to miss, **the
entire audio path**: `recordings`, `voice_notes`, `upload_grants`, the retention worker and its
watchdog, the storage ceiling, the 90-day promise, the storage half of `BE-W11`, and the restore
runbook's step-3 reconciliation (MR-37 D2, `:1424-1456`). **`C7` ruled KEEP on 22 September** and
`:2450` records that *"cut the AI layer is no longer a valid result"*. Recon **D4** nonetheless
re-opens X1–X7 for the AI phase, so the reviewer should know what a scope revisit would reach.

**The precedent is real, not hypothetical.** `BE-W69` (`pg_cron` keep-warm) was cancelled outright
by FIX-14 when the reviewer ruled the honest fix was to pay for the tier — *"There is no task
here, no extension to install and no design to review"* (`:812-817`).

**Checked and NOT cancellable:** `FE-W52` (the notice is measurably false — 2.6 can approve
wording, not make it true), `BE-W93`, `BE-W95`, `BE-W108`, `FE-W58`, `FE-W19`/`FE-W20`. **No
currently-open BE-W/FE-W id is cancelled by any of D1–D10 or X1–X8** — those govern the unbuilt
AI platform. **NOT DETERMINED** for the ~40 items in E1's third table: their state is unknown, so
their cancellability is too.

---

# PART F — TESTS AND GATES

## F1. Full counts, per workspace and runner, from each runner's own summary lines

Workspaces enumerated from `pnpm-workspace.yaml` (`packages/*`, `apps/*`, `services/*`), not from
directory names. Nine test targets across seven workspaces. No Playwright anywhere. `packages/ui`
and `apps/field` run **both** vitest and jest; `apps/field/src/runner-boundary.test.ts` asserts
the two globs cannot overlap, so nothing is double-counted.

### `main` @ `5313513`

| Workspace / runner | Summary line |
| --- | --- |
| core / vitest | `Test Files  4 passed (4)` · `Tests  38 passed (38)` |
| ui-tokens / vitest | `Test Files  3 passed (3)` · `Tests  54 passed (54)` |
| ui / vitest | `Test Files  1 passed (1)` · `Tests  4 passed (4)` |
| ui / jest | `Test Suites: 22 passed, 22 total` · `Tests: 253 passed, 253 total` |
| console / vitest | `Test Files  6 passed (6)` · `Tests  37 passed (37)` |
| field / vitest | `Test Files  40 passed (40)` · `Tests  613 passed (613)` |
| field / jest | `Test Suites: 21 passed, 21 total` · `Tests: 162 passed, 162 total` |
| api / vitest | `Test Files  14 passed | 49 skipped (63)` · `Tests  101 passed | 729 skipped (830)` |
| mock / vitest | `Test Files  1 passed (1)` · `Tests  43 passed (43)` |

**main: 161 suites/files · 1,536 cases declared · 1,305 passed · 729 skipped.** The repo's own
tool agrees — `node scripts/test-counts.mjs` printed `TOTAL PASSING 1305`, then **exited 1** with
`@fieldforce/api / vitest reported 729 SKIPPED case(s)`.

### PR #2 @ `7d4adfb`

| Workspace / runner | Summary line |
| --- | --- |
| core / vitest | `Test Files  5 passed (5)` · `Tests  79 passed | 4 skipped (83)` |
| ui-tokens / vitest | `Test Files  3 passed (3)` · `Tests  54 passed (54)` |
| ui / vitest | `Test Files  1 passed (1)` · `Tests  4 passed (4)` |
| ui / jest | **DID NOT RUN** — see F1a |
| console / vitest | `Test Files  6 passed (6)` · `Tests  37 passed (37)` |
| field / vitest | `Test Files  40 passed (40)` · `Tests  613 passed (613)` |
| field / jest | **DID NOT RUN** — see F1a |
| api / vitest | `Test Files  14 passed | 54 skipped (68)` · `Tests  101 passed | 819 skipped (920)` |
| mock / vitest | `Test Files  1 passed (1)` · `Tests  43 passed (43)` |

**Actually run: 70 files · 1,241 declared · 931 passed · 823 skipped.** Adding back the two jest
suites the branch does not touch: **113 suites/files · 1,656 declared · 1,346 passed.**

**Delta main → PR #2:** `packages/core` +1 file / +45 cases (all from `gateway/product-qa.test.ts`);
`services/api` +5 files / +90 cases. **Every one of those 90 API cases is in the skipped column.**

### The database situation — not what "needs a live DB" usually means

`services/api` does **not** fail without Postgres. It self-detects and skips:

> `No database at postgresql://postgres:postgres@127.0.0.1:54322/postgres — database tests will
> be skipped.` / `Run 'pnpm db:start' first if you meant to run them.`

So 63/830 and 68/920 are **real runner counts, not static file counts** — vitest collected every
file and reported the skips. No `it(`/`test(` grep was needed.

**But: 89% of PR #2's API test cases (819 of 920) have never executed on this machine.** "Vitest
is green on `services/api`" currently means *101 non-database cases passed*. For comparison, the
repo's own record of a run with the stack up (MR-54, BE-W96) reports
`@fieldforce/api 62 files / 824 tests, none skipped` on `main`. **PR #2's five new specs have no
recorded green run with a database at all.**

### F1a. Finding: jest cannot run inside this worktree

Both jest targets fail in the worktree with exit 1:

```
No tests found, exiting with code 1
  testMatch: D:/Praverse/Elmiron-App\.claude/worktrees/ai-platform-phase-a/apps/field/**/*.test.tsx - 0 matches
  157 files checked.
```

`testMatch: ['<rootDir>/**/*.test.tsx']` in `apps/field/jest.config.cjs` and the `packages/ui`
equivalent. `rootDir` contains the dot-segment **`.claude`**, and jest's glob matcher does not
traverse dot segments by default. This is an artifact of **where the worktree lives**, not of the
branch — GitHub CI checking the branch out normally would run them. But it means **`pnpm test` is
red in this worktree for `@fieldforce/ui` and `@fieldforce/field`**, `test-counts.mjs` exits 1,
and **415 render tests (253 + 162) are silently unrunnable for anyone reviewing PR #2 from here.**
Registered, not fixed.

## F2. The nine gates

**Structural finding first: not one of these nine gates has a definition in this repository.**
Every `*.md`, `.github/` and source file in both checkouts was grepped. What exists is *status
registers* and *re-check commands* — tables that assume the reader already knows what the gate
requires. There is no `gates.md` and no gate section in `PROJECT-OVERVIEW.md`. The ids are
inherited from an external brief that is not tracked here — **the same absence as the master
prompt in Part A.**

The two nearest things to a register — `COMPLETION-PLAN.md:260-272` and
`HANDOVER-2026-09-08.md:194-207` — are **both dated 8 September**, and `handoff.md` (14 Sep,
uncommitted) contradicts them. **The repo has no single current gate status.**

| Gate | Requires | Status as the repo states it | What closes it |
| --- | --- | --- | --- |
| **G-CI** | CI green on real runs **plus** an off-machine backup copy | **Partly met.** CI green; the git bundle *"is on the same disk as the repository and must be copied off by a human"* — `PROJECT-OVERVIEW.md:10993-10996` calls that *"the only reason G-CI is partly met rather than met"* | A human copies the bundle off-disk (`BE-W11`) |
| **G-CRON** | A run with `event: schedule` (not `workflow_dispatch`) must succeed | **CONTRADICTORY.** `COMPLETION-PLAN.md:269` = "Not met". `PROJECT-OVERVIEW.md:6548` gives two successful `schedule` runs — `retention.yml` #34135046578 and `retention-watchdog.yml` #34136136779, both 7 Sep, both `success`. `HANDOVER:362` calls that *"a reading of the gate, not a measurement"* | **Nothing technical.** Someone must close or restate `BE-W36`; the evidence is already in the record |
| **G-RLS-C** | 4 roles × 2 boundaries × 5 paths = 40 deny cells + 15 positive controls = 55 cells | **Met on the tenant boundary**, with the caveat the record insists on (`PROJECT-OVERVIEW.md:16357`): proven for 8 sites + a 9th delegating path, and **population-level only** as *"no SECURITY DEFINER body carries the escape construct"* | Individually probing the remaining SECURITY DEFINER functions, if you want the population claim rather than the construct claim. **Its spec file is its definition — the one gate that can be audited** |
| **G-RLS-X** | The commercial/clinical data boundary | **ABSENT, not passing** — stated that way deliberately and repeatedly. No clinical schema, no clinical roles. Re-check command is literally *"— (nothing to run)"* | A clinical schema and clinical roles must exist first |
| **G-PERF** | *"A doctor found in under three seconds in a waiting room"* — **end to end** | **Split.** Met for server execution: `search_doctors` 2.137 ms / 3,520 doctors, 2.259 ms / 30,272, 2.600 ms / 99,968. **Open as written** — end-to-end never measured at any scale; network, PostgREST serialisation, pooler, parse and render all excluded, and *"on an Indian mobile network those are the larger terms"* | A physical handset on a real network |
| **G-WRITE** | All five MR write paths reach Supabase from real screens | **CONTRADICTORY, and the sharpest conflict in the repo.** `COMPLETION-PLAN.md:265` and `HANDOVER:203` (8 Sep) = *"NOT MET — no Supabase write exists anywhere in the app"*. `handoff.md:214` (14 Sep, **uncommitted**), `.ai-collab/handover.md:30` and `frontend-status.md:308` = **MET**. `COMPLETION-PLAN.md:1336` confirms the older figure is *"stale: G-WRITE has since closed"* | **Already closed on the later evidence.** The two 8-Sep tables need correcting |
| **FE-G1** | Signed-in APK driven on a physical handset; `adb devices` shows a non-emulator serial | **NOT MET.** Emulator only. MR-51/`C12`: verified means a handset **run after the AI integration exists** — an emulator result never closes it | A handset — specifically **Xiaomi/Oppo/Vivo/Realme, not a Pixel** (`blocked-on-you.md:349`): those four ROMs do the OEM battery-killing the app must survive. **Open seven weeks** |
| **FE-G2** | A full offline day on a handset then sync: **8 hours, ≥20 queued writes, no losses, no duplicates**, verified by row count in Postgres | **NOT MET.** `blocked-on-you.md:447` records the upgrade: item 5.1 now blocks FE-G1 **and** FE-G2 | Same handset. `blocked-on-you.md:382`: *"blocked by the handset alone"* |
| **G-PILOT** | Pilot cutover on one territory: **1 territory, 2 MRs, 2 doctors, 10 patients, 1 PV officer, on a database that does not pause itself** | **NOT MET.** Depends on every gate above | All other gates, plus a paid non-pausing database |

**All nine ids found; none NOT FOUND.** Two things the reviewer should push back on:

1. **G-CI, G-CRON and G-WRITE all have live contradictions between the 8-September registers and
   later records** — and the registers are the documents a reader reaches for first. Same failure
   mode `CLAUDE.md` describes for the deleted knowledge graph.
2. **A gate with no written definition cannot be audited, only asserted.** Nine gates gate the
   pilot and not one has its acceptance criteria written in one place. G-RLS-C is the exception
   that proves it: it is credible precisely because its spec file *is* its definition.

## F3. §53's mandatory test list

**There is no mandatory test list in this repository, and I will not reconstruct one.**

`§53` appears five times across both branches, in three unrelated senses, and none is a test list:

1. **`docs/backend-prompt-w8.md` §53** — cited three times as an open question about guarding
   scripts against non-localhost targets (`PROJECT-OVERVIEW.md:16382`,
   `services/api/scripts/target-guard.mjs:19`, `COMPLETION-PLAN.md:1945`). **That section does not
   exist in the file.** `backend-prompt-w8.md` is 160 lines; its headings run `Part 1`–`Part 5`
   with sub-numbers `1.1 … 3.3`. There is no `53`, no `5.3`. `git log` shows one commit for the
   file, so no longer version exists in history. **Three places cite a section of a tracked file
   that is not in that file.**
2. **Master prompt §53** — `benchmarks.ts:145,159`, an **error taxonomy**: *"invalid structured
   response"* and *"AI provider timeout"*. Both have a benchmark case; both fail closed. This is
   the A1 row.
3. The prompt itself is named once (`phase-a-recon.md:6`) and **is not in either checkout**.

The nearest thing to a mandatory-test requirement is **§54**, quoted at `benchmarks.ts:5` —
*"Every model/prompt update should run benchmarks"* — which is the `product_qa` benchmark, **4
cases, all waiting for a real model**.

**So F3's answer is: the list cannot be checked against the repo, because the document that
carries it is not in the repo.** Three source files currently cite section numbers nobody here
can verify.

---

# PART G — THE THREE SIZING ANCHORS

## G1. MR-14 → MR-28, the five write paths

**40 commits** carry an `MR-14`..`MR-28` id in the subject line (65 mention one anywhere; 40 in
the subject, which is the convention). **Date span 2026-09-09 → 2026-09-11, three calendar days,
one author.**

| Date | Commits |
| --- | --- |
| 2026-09-09 | 1 |
| 2026-09-10 | 18 |
| 2026-09-11 | 21 |

First `6f3f859` *"MR-14 A2 — one local command, derived from ci.yml"*; last `f7a684c` *"bring
handoff.md, .ai-collab and the status docs up to MR-28"*.

**Sessions: 7, from the explicit record rather than from clustering.** `PROJECT-OVERVIEW.md`'s
Phase log has one heading per session; inside this range there are seven —
MR-14 (11027, its own text says *"Session ran across 9–10 September"*), MR-19 (11374),
MR-24 (11543), MR-25 (11868), MR-26 (12100), MR-27 (12318), MR-28 (12512). The
*"Gate 1 — its evidence was VOID FOR THE WRITE PATH"* heading at 11789 is **not** an eighth:
commit `5bcf227` shows it was written during MR-25.

**A correction that matters for any rate derived from this: `MR-NN` is a work item, not a
session.** MR-15–18 and MR-20–23 have commits but no phase-log heading — they were folded into
the MR-19 and MR-24 write-ups. **Clustering by day gives 3; the explicit record gives 7.** The two
disagree by more than 2×, so state which you used. This document uses 7.

**Rate: 5 write paths / 7 sessions / 40 commits ≈ 1.4 sessions and 8 commits per write path.**

**The five write paths**, named by `bb85ab3` *"MR-18 B — the five writes go to Supabase through
sync_push"* and confirmed by `handoff.md:26` (*"G-WRITE MET. All five MR writes reach Supabase
from real screens, online and offline, exactly once"*): **check-in** (`check_ins`), **check-out**
(`check_outs`), **call report** (`call_reports`), **samples** (UCPMP-capped), **consent record**
(`consent_records`, MR-27). *Caveat: these were assembled from per-session narratives; no single
line in the repo enumerates all five together. `bb85ab3`'s diff is authoritative.*

## G2. The AI platform's eight pieces

**11 commits, all on 2026-09-24, one author, one calendar day. 32 files, +8,174 / −2.**

| SHA | Subject |
| --- | --- |
| `03b4661` | docs: AI platform Phase A — what exists, what conflicts, what must be decided |
| `a323a6c` | docs: AI platform Phase A — measure the two D1 premises instead of assuming them |
| `af26f22` | feat: AI-B1 — the catalogue: markets, therapy areas, products |
| `2f8501c` | feat: AI-B2 — LMS core, and typed contracts for it and the catalogue |
| `45b7f89` | docs: AI platform — record what AI-B1/AI-B2 built and what stays unverified |
| `b34340c` | feat: AI-C1 — approved knowledge: reviewed versions, chunks, scoped search |
| `3fa599c` | fix: AI-C1 rollback — drop order forced by two function dependencies |
| `762e57b` | feat: AI-D0 — the AI control plane, database half |
| `e77f7fd` | docs: AI platform — API contracts for the frontend (§50), and status for AI-D0 |
| `89b1920` | fix: AI-C2 — knowledge search matches any term of the question, ranked |
| `7d4adfb` | feat: AI-D1 — the gateway's logic, runtime- and vendor-neutral, with product_qa end to end |

**The eight pieces**: recon; the D1 premise measurement; AI-B1 catalogue; AI-B2 LMS core; AI-C1
approved knowledge; AI-C2 any-term ranked search; AI-D0 control plane; AI-D1 gateway logic.
(`api-contracts.md` is a ninth artefact, listed separately in the recon's §7.)

**Sessions: 2, and this is the weakest number in the document.** There is no explicit session
record for this branch — it does not touch `PROJECT-OVERVIEW.md` at all, so the Phase-log
convention that answered G1 gives nothing. The only evidence is
`phase-a-recon.md:363`, *"## 6a. What was built after this document (24 September 2026)"*, which
implies a recon session and a build session. **That is inference from one heading.**

**Rate: 8 pieces / ~2 sessions / 11 commits ≈ 4 pieces and 5.5 commits per session** — and it is
not comparable to G1 without the caveat below.

### The two anchors are not measuring the same thing, and the reviewer must not average them

G1's 5 write paths are **DONE** in §56's sense: exercised on an emulator, through real screens,
online and offline, exactly once. G2's 8 pieces are **UNVERIFIED**: *"Nothing in `apps/field` or
`apps/console` calls any of it."* **G2's rate is the rate of building database-and-contract
layers with no app attached. G1's is the rate of finishing something.** The gap between them is
the whole subject of Part B, and using G2's 4-pieces-per-session to forecast delivered features
would overstate throughput by whatever Part C's conversion work turns out to cost.

## G3. The smallest complete remaining vertical — Product Q&A

Listed, not estimated, as instructed.

### What already exists

| # | Step | Evidence |
| --- | --- | --- |
| 1 | Schema — catalogue | `20260924000400_catalogue.sql` |
| 2 | Schema — approved knowledge | `20260924000600_knowledge.sql` |
| 3 | Schema — AI control plane | `20260924000700_ai_control_plane.sql:68`, `:117` |
| 4 | RPC — `ai_begin_request` / `ai_complete_request` | same file `:450`, `:530` |
| 5 | RPC — prompt lifecycle (admin/submit/approve/reject/retire) | same file `:292`, `:316`, `:337`, `:383`, `:414` |
| 6 | RPC — `search_approved_knowledge` | `20260924000600`, re-ranked by `20260924000800` |
| 7 | Rollbacks for all five migrations | `services/api/rollbacks/20260924000400..000800_*.down.sql` |
| 8 | Contract package — Zod types | `packages/core/src/field/{ai,catalogue,knowledge,lms}.ts`, `shared/refusals.ts` |
| 9 | Gateway logic, vendor-neutral | `packages/core/src/field/gateway/product-qa.ts:110` `answerProductQuestion` |
| 19 | Tests — database level | `ai-control-plane.spec.ts`, `ai-product-qa.spec.ts`, `knowledge.spec.ts`, `catalogue.spec.ts` |
| 20 | Tests — gateway unit | `packages/core/src/field/gateway/product-qa.test.ts` (253 lines) |
| 24 | CI gate — the new specs | `.github/workflows/ci.yml:180` already runs every api spec; `:212` verifies rollbacks |

### What does not exist — ten distinct missing steps

| # | Step | Evidence it is absent |
| --- | --- | --- |
| 10 | **HTTP path wiring** | `packages/core/src/field/endpoints.ts` has no `rpc/ai_*` or `rpc/search_approved_knowledge`. `ai.ts:130` names `aiBeginRequest: 'ai_begin_request'` as a bare RPC name, not a routed path in `API_PATHS` |
| 11 | **Gateway runtime** — the thing holding the vendor key | No `services/api/supabase/functions/` directory at all. The recon's proof used *"a throwaway function (deleted afterwards, never committed)"* |
| 12 | **Vendor adapter** | `providers.ts:43` is an interface only. Tests pass a scripted model |
| 13 | **MR-facing screen** | Nothing in `apps/field` or `apps/console` references `product_qa`, `gateway`, or `ai_begin_request` |
| 14 | **Admin screen to author/approve a prompt version** | No AI route in `apps/console/src/app`. Approval is RPC-only, **and four-eyes means two humans must call it** |
| 15 | **Feature-flag values** (mechanism exists) | Read at `20260924000700:471` and `:486`; set **only** inside `ai-control-plane.spec.ts:135-136`. `:486` refuses when unset — *"An unlimited allowance is never the default"* |
| 16 | **Seed data — products** | Recon §7: *"No rows (D5)"*. No product seed in `services/api/scripts/` |
| 17 | **Seed data — an approved prompt version** | No seed touches `ai_prompt_versions`; without one `ai_begin_request` raises `45011` |
| 18 | **Seed data — approved knowledge** | No seed touches `knowledge_documents`; with none the flow returns `not_available` and never calls a model |
| 21 | **Contract guards for the AI schemas** | `packages/core/src/contract.test.ts` imports `catalogue.ts` and `lms.ts` only — **no import of `ai.ts`, `knowledge.ts` or `gateway/`** |
| 22 | **App / end-to-end test through a screen** | Recon §6a: *"'It must be exercised through the real application' has not happened."* |
| 23 | **Benchmark run (§54)** | 4 cases wait for a real model |
| 25 | **CI step to serve the edge function** | Recon §4: *"A function added after `db:start` is not picked up (404) until `functions serve` runs. CI would need that step; it does not have one today."* |

### What it depends on

**Hard blockers:** **D1** (runtime), **D2** (vendor + egress — blocks step 12 outright),
**D5** (products — blocks 16 and 18), **D8** (named approver — blocks 18), **D10** (branch or
main — nothing merges without it).

**Soft / scoping:** **D6** already assumed and built as "market on content"; an answer of
"organisation" reworks `product_markets`. **D7 / BE-W106** blocks a *second tenant*, not a first
vertical. **D3 pgvector is explicitly not blocking** — AI-C2's any-term ranked search is the
deliberate fallback. **D9** is off this path.

**X-items: none of X1–X8 blocks product_qa.** X5 is the one it touches, and AI-C1 already answers
it the way §3 recommends.

### The honest summary

This is **not** "schema to screen, minus a screen". Ten distinct steps are missing — a runtime, a
vendor adapter, an MR screen, an admin authoring path, three classes of seed data, route wiring,
contract guards, an app-level test and a CI step — **and two of them (D2's vendor, D5's products)
cannot be started by engineering at all.** Product Q&A is the *smallest* remaining vertical, and
it is still gated on two client decisions before the first line is written.
