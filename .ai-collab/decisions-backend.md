# Decisions — backend track

> **The real decision log is `PROJECT-OVERVIEW.md`.** This file holds only decisions **not yet
> written there**, for the **backend** track, and it is append-only.
>
> Ids are minted **per track** (`BE-C<n>` / `FE-C<n>`, `CLAUDE.md`). `C1`–`C31` predate that
> rule, stay in `.ai-collab/decisions.md`, and keep their names.
>
> **Why the split — `BE-W120`:** two tracks appending to one file conflicted four times on
> 28 September, and a conflicting PR gets **no CI run at all**. It does **not** fix id collisions;
> per-track prefixes did that. Nothing already written moved.

---

## `BE-C4` — contract-request ids are minted per track · 29 September 2026

- **Decision:** the backend mints **`BE-CR<n>`**, the frontend **`FE-CR<n>`**, each from its own
  sequence starting at 1. `CR-1`–`CR-5` keep their names.
- **Why:** the frontend filed a voice-note item as `CR-5`, which was already the practice session
  API. Both tracks read the highest id in `docs/contract-requests.md`, which is only correct on one
  branch at a time — **the same mechanism as the `C20` collision**.
- **Why it recurred:** `BE-C3` applied per-track prefixes to **decisions** and stopped there.
  Contract requests are minted the same way from the same kind of file, and nobody extended the
  rule. **A rule that names one register does not cover the next one somebody invents.**
- **Recorded in `CLAUDE.md`**, beside `BE-C3`, because that is the only file both tracks load before
  reading any code.

## `BE-C5` — an off-site check-in is recorded and flagged, never refused · 29 September 2026

- **Decision:** (1) the rep **is told**, in one plain line, that the clinic could not be confirmed —
  and told nothing about consequences, because none are decided; (2) the visit **still starts**;
  (3) there is **no manager surface in v1**.
- **Why tell them:** it is a fact about their own check-in that someone may later read when deciding
  things about their job. The same omission is what makes today's privacy notice untrue.
- **Why not refuse:** the server already does not refuse, and refusing would strand a rep standing
  in front of a doctor because a clinic's stored coordinates are wrong. **A flagged check-in is
  strictly more useful than one that never happened.**
- **Why no manager surface:** nothing has ruled on what "outside" *means*, and the first conclusion
  drawn from such a screen will be about somebody's pay. The data is on every row from the start, so
  the screen can be built later against a complete history — **the asymmetry is the argument**.

# Operator decisions — 30 September 2026

**Twenty answers in one sitting. `BE-C6` – `BE-C25`.** Recorded here first, before any of them is
acted on, because a decision acted on before it is written down is a decision nobody can check later.

**One of them is CONDITIONAL and is recorded as conditional — `BE-C6`.** A conditional decision filed
as a plain one is how the condition gets forgotten.

---

## `BE-C6` — AI provider: **Gemini 2.5 Flash, CONDITIONALLY**

- **Decision:** Gemini 2.5 Flash as the primary model for AI Doctor, LMS, product Q&A, coaching and
  analysis, on economy grounds.
- **THE CONDITION, which is part of the decision and not a caveat on it:** *before final lock*, the
  exact Gemini setup — **including voice** — must be confirmed to satisfy India residency. **That
  confirmation has not been made.** Until it is, this decision is not final.
- **The named fallback if it cannot:** **Claude via AWS Bedrock India**, which `PROVIDER-SHORTLIST.md`
  already recommended for text.
- **Resolves:** `#5` / `D2` — **conditionally**. The register row stays open, re-marked as
  *conditionally answered, pending residency verification*.
- **Why the condition is load-bearing:** the operator named voice explicitly, and voice is the half
  where in-region inference is scarcest. A single "yes" covering text and speech is the answer to be
  suspicious of. Part B of W1-L is the verification, and it produces a document rather than a lock.
- **Unchanged by this:** the gateway is provider-independent by construction — see `BE-C25` below.

## `BE-C7` — a second admin account will be provided by the operator

- **Decision:** the operator supplies a second admin. They do final content approval. **No author
  approves their own content.**
- **Resolves:** the first prerequisite of the practice checklist (`blocked-on-you` → W1-F Part C,
  "two admin accounts belonging to two different people").
- **Nothing to build.** Four eyes is already a table CHECK on every content type — knowledge,
  personas, scenarios and prompt versions — so this decision supplies a person, not a feature.

## `BE-C8` — production deploy sequence

- **Decision:** proceed in the stated order — **pre-flight check → working hours → pending changes →
  reference data → paid hosting.**
- **The constraint that matters:** **reference data is NOT loaded before the schema updates.** Loading
  it first means loading against a schema that is 12 migrations behind.
- **Resolves:** the deploy ordering question. **Does not** resolve what the reference data contains —
  that is `BE-C23` and Part D.

## `BE-C9` — the registered legal name comes later

- **Decision:** keep the consent configuration ready; the registered name is supplied separately.
  **Do not invent or hard-code it.**
- **Resolves:** `#3` / `BE-W93` — **the method, not the value.** The name is still required and is
  item 1 of Part D's list.
- **Why this is the right shape:** a hard-coded legal name in a consent notice is a compliance defect
  that looks like a string.

## `BE-C10` — **settings belong to each company**

- **Decision:** thresholds, AI controls and compliance settings belong to **each company**, not
  shared.
- **Resolves:** **`#2` / `BE-W106`**, which has been open since 23 September and is the largest
  unblock on the list.
- **What it unblocks, concretely:** the AI feature flag becomes a per-company row, which removes the
  **last "an engineer runs SQL" step** from the operator's own checklist; and `BE-C11`'s cap can be
  entered per company. **Built in W1-L Part C.**

## `BE-C11` — the UCPMP cap is configurable from admin

- **Decision:** configurable from the admin side. **No hard-coded number.** Tracking works now;
  **enforcement activates when the approved cap is entered.**
- **Resolves:** `#1` / `BE-W21`'s *mechanism*. **The VALUE is still outstanding** and is item 3 of
  Part D's list, along with the second half nobody has answered: **whether `input` counts against the
  same ceiling as `sample`.**
- **Note the deadline this interacts with:** `check:decision-debt` fails the build on **6 November**
  if the cap is still unset, warning from **16 October**. Making it configurable does not clear that;
  entering a value does.

## `BE-C12` — product catalogue: structure now, content later

- **Decision:** build the structure now. Real names, labels and prescribing information load later.
  **Product Q&A uses only approved material.**
- **Resolves:** `#7` / `D5` — **the build/wait question.** Who supplies approved labels and
  prescribing information remains theirs, and is item 4 of Part D's list.
- **Already true and worth restating:** `product_qa` answers *"approved information not available"*
  when nothing approved matches, so an empty catalogue produces a correct screen rather than a broken
  one.

## `BE-C13` — practice scores: MR and admin, never a manager surface

- **Decision:** the MR sees their own, an admin can access them, **no team rankings or averages for
  managers.**
- **Resolves:** **`#14`**, and it is answer **(a)** — *the rule stands, nothing to amend.*
- **Nothing to build: this is what `C27` already enforces in RLS**, with tests that fail the build if
  a ranking column name appears on a manager surface. **`#17`** (may a manager see which AI features
  an MR used) was noted as becoming load-bearing only if `#14` were answered (b); it is not, so `#17`
  stays as built — **no**.

## `BE-C14` — notifications: proceed, push architecture / Firebase

- **Decision:** proceed, for LMS reminders, assignments, certificates and important MR alerts.
- **Resolves:** `#10` / `D9` — **approved, not built.** See `E1`.
- **Requires an ask before starting:** Firebase is a **dependency and an external service**, which
  `.ai-collab/constraints.md` requires be raised before installing. This decision approves the
  direction; the install is a separate confirmation.

## `BE-C15` — PDF knowledge upload approved

- **Decision:** approved. **Content enters the AI knowledge base only after approval.**
- **Resolves:** `#11` — approved, not built. See `E1`.
- **The second clause is the important one:** ingestion must produce a **draft** that a second admin
  approves, which is `C24` applied to a new entry path. A PDF that lands as approved content would be
  the never-born-approved rule defeated by an importer.

## `BE-C16` — vector search approved, keyword retained

- **Decision:** approved. **Keyword search is retained as the fallback**, and vector work **must not
  hold up other development.**
- **Resolves:** `#6` / `D3` — approved, not built. See `E1` and `E2`.
- **`pgvector` is a Postgres extension**, so this is also a dependency question.

## `BE-C17` — real doctor recording: completely deferred this release

- **Decision:** deferred entirely.
- **Resolves / defers, and this is the largest simplification in the twenty:** `#19` (speech vendor
  for real visits), `#20` (employee bake-off consent), `#21` / `BE-W109` (the notice a doctor reads),
  `#24` (destroying audio already on the phone on withdrawal) and `BE-W32` (the Hinglish bake-off) are
  **all deferred with it** — they exist only to support recording a real consultation.
- **What does NOT defer:** the retention machinery already built, and the `destroyedTotal: 0` finding.
  Deferring recording means there is nothing to destroy; it does not mean the destruction path is
  proven.

## `BE-C18` — AI Doctor: simulation only, voice and text

- **Decision:** simulation only — personas, scenarios, objections, product discussion, practice. Voice
  and text.
- **Confirms what is built.** `AI-SPEC` §4 already says no real doctor is involved at any point, and
  `sim_personas`/`sim_scenarios` are authored and approved through the console.
- **Voice is the part that does not exist**, and it inherits `BE-C6`'s condition: voice residency is
  exactly what Part B must verify.

## `BE-C19` — AI analysis is mandatory after practice

- **Decision:** mandatory after a practice session — product knowledge, scientific accuracy,
  communication, objection handling, pitch quality, areas to improve, learning recommendations.
- **Against what is built:** `SimCoachAnalysisSchema` has **five** dimensions — `opening`,
  `product_knowledge`, `objection_handling`, `communication`, `closing`. The decision names **seven
  things**, of which *scientific accuracy* and *pitch quality* have no dimension, and *areas to
  improve* and *learning recommendations* map to the existing `improvements` array.
- **So this decision requires a contract change**, not just a flag: two new dimensions. **Not done in
  W1-L** — it changes a schema three tests and one migration depend on, and it deserves its own
  session. **Registered as `BE-W127`.**

## `BE-C20` — patient information is not exposed in the MR app

- **Decision:** not exposed in the MR app; the admin side **may** have restricted access; retain the
  safeguards, **which the operator acknowledges are not perfect.**
- **Resolves:** the framing of `#22` in part — but **not** whether an adverse-event report may carry
  patient information or leave the platform, which stays open.
- **The acknowledgement is the important half**, and it is why W1-K Part A exists: the operator has
  been shown the three sentences that still reach a model and has accepted that ceiling in writing.

## `BE-C21` — LMS content: AI-generated now, reviewed and approved before production

- **Decision:** generate as much useful training text as possible with AI now; the operator reviews,
  refines and approves before production use.
- **This is `C24` exactly**, and the machinery exists: `course_versions` has a
  `draft → published` lifecycle, and AI-authored content carries `authorship` and `authoring_model`.
- **What it needs before starting:** `BE-C6`'s provider. Generating the text is a model call.

## `BE-C22` — data controller / patient app: not a blocker this release

- **Decision:** not a blocker. Keep it separate.
- **Resolves:** the release-scope question. `patient_education` was already **out permanently from
  this repository** (`AI-SPEC` §A2), so this confirms rather than changes scope.

## `BE-C23` — reference data: proceed with the structure, one consolidated list

- **Decision:** proceed with the structure, and send **ONE consolidated list** of exactly the business
  inputs needed, rather than stopping development each time one is missing.
- **Delivered as:** `docs/operator-inputs.md`, W1-L Part D. Each item names **what is absent, what it
  blocks — a screen, a test, a deploy, or nothing yet — and the consequence of leaving it blank.**

## `BE-C24` — backups: safest compliant India-region setup, documented

- **Decision:** audio recovery is **not** a blocker while recording is deferred (`BE-C17`). Use the
  safest compliant **India-region** setup for database backups and **document the configuration.**
- **Resolves:** the backup-scope question. The audio half is deferred with recording.

## `BE-C25` — PITR and an **external** heartbeat monitor

- **Decision:** proceed with production recovery configuration **and add an external heartbeat
  monitor, so an outage is detectable independently of Supabase.**
- **Resolves:** the decision W1-H Part D put to the operator — *"a monitor running on the same platform
  as the thing it monitors cannot detect that platform stopping"* — and it is answered in the
  direction engineering recommended.
- **It is an approval, not an implementation.** The monitor is an **external service and a recurring
  cost**, so the specific provider is a dependency ask. What it buys, measured: the 23 Aug – 7 Sep
  blackout was found by a failed connection **fifteen days late**, with all five workflows silent
  together.
- **What it still will not tell you:** `destroyedTotal` is 0. A heartbeat proves the job *ran*, not
  that the purge *works* — which needs one object aged past `purge_after` in staging.

---

## What these twenty do NOT answer

Recorded so the remaining list is short and honest:

- **`BE-C6`'s condition** — Gemini residency, including voice. Part B.
- **The UCPMP cap's value**, and whether `input` counts against it (`BE-C11`).
- **The registered legal name** (`BE-C9`).
- **Approved labels and prescribing information** (`BE-C12`).
- **Whether an adverse-event report may carry patient information and leave the platform** (`#22`,
  narrowed by `BE-C20` but not closed).
- **The PV / DPDP signatory** (`#18`) — untouched by all twenty, and still the blocker on transcripts.
- **Consent-notice language order** (`#25`) and **the 72h / 120s thresholds** (`#26`), both unasked and
  both still defaults nobody has confirmed.

---

## W1-L Part E — the four things now APPROVED and NOT STARTED, in order

**Four of the twenty approved work that does not exist yet: `BE-C14` notifications, `BE-C15` PDF
upload, `BE-C16` vector search, `BE-C12` the product catalogue's content path.** An approval is not
a schedule, and four approvals arriving together is exactly how a queue gets worked in the order it
was written down rather than the order that makes sense.

**The ordering principle is not size and not value — it is what each one is BLOCKED BY.** Two of the
four need something from outside engineering before a line can be written, and starting those first
means waiting first. So they are ordered by *how soon work can actually begin*, and each one's
dependency ask is named rather than discovered later.

| Order | Item | Blocked by | What it needs before starting | Size |
| --- | --- | --- | --- | --- |
| **1** | **`BE-C12` — the catalogue's content path** (upload, version, four-eyes approve, retire for products) | **Nothing.** The structure exists; `products`, `knowledge_documents` and `knowledge_document_versions` are all there | Nothing from anyone. **It is first because it is the only one of the four that is unblocked today**, and because `product_qa` and `mr_chat` are both finished features sitting idle for want of content to answer from | ~2d |
| **2** | **`BE-C15` — PDF knowledge upload** | **A dependency ask.** A PDF text-extraction library is a new dependency, and `.ai-collab/constraints.md` requires asking before adding one | **The ask itself, which has not been made.** Text can be pasted today, so this is a convenience over a working path, not a gap. It follows #1 because it is the ingestion mouth of the thing #1 builds | ~1.5d + the ask |
| **3** | **`BE-C16` — vector search** | **`pgvector`,** a Postgres extension — a dependency ask of a different kind, plus an embedding model, which means it also inherits **`BE-C6`'s unmet residency condition** (`docs/ai-platform/GEMINI-RESIDENCY.md`) | The extension approved AND a provider decision. **Two dependencies, one of them currently UNVERIFIED** | ~2d after both |
| **4** | **`BE-C14` — notifications** | **A dependency ask (Firebase), a credential, and a recurring cost** | A Firebase project, service credentials, and the decision about which events are worth interrupting someone for — which nobody has made. **It is last because it is the only one of the four that no finished feature is waiting on**; measured in `AI-SPEC.md`, none exist today and nothing refuses for want of them | ~3d |

### Which item `BE-C16`'s "must not hold up other development" applies to

**The operator attached that condition to vector search, and it is worth being precise about what it
governs, because the obvious reading is the wrong one.**

It does **not** mean "do vector search quickly". It means **vector search must not become a
prerequisite of anything else** — and the thing it would most naturally have become a prerequisite
of is **knowledge retrieval for `product_qa`**, which is finished and working on keyword search
today.

**So the condition applies to item #1 above, not to item #3.** Concretely:

* **`BE-C12`'s content path is built against KEYWORD retrieval and ships without waiting for
  vectors.** `20260924000800_knowledge_search_any_term.sql` is the working fallback and it is not a
  placeholder.
* **Vector search is added later as a retrieval strategy behind the same call**, so nothing that
  consumes knowledge has to change when it lands.
* **If that ordering is ever inverted** — if someone makes the catalogue wait for embeddings —
  **`BE-C16`'s condition has been breached**, regardless of how fast the vector work is going.

**Its placement at #3 is therefore the condition being honoured, not ignored.** It is third because
it is blocked by two dependencies including an unverified one; being third costs nothing precisely
because nothing is waiting on it.
