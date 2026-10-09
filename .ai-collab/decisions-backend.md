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

---

# Operator decisions — 1 October 2026 (W1-M)

**`BE-C26` – `BE-C40`. Fifteen recorded, and the brief said thirty-one.** The session brief that
relayed them said *"31 answers"* and spelled out **thirteen numbered points**, plus an instruction
to continue development, plus a request for a flow and diagram to approve (referred to in the brief
as the operator's "point 4", which is not the brief's point 4 — the brief renumbered them). **That is
fifteen. The other sixteen were not in the text this session received, and they are not recorded
here rather than reconstructed.** A decision written down from a guess at what someone probably said
is worse than a gap, because it reads as settled. **Asked for in `docs/operator-inputs.md`, I-12.**

Numbering below is the brief's, so a reader holding the brief can check each one.

---

## `BE-C26` — AI provider: **Claude through AWS Bedrock India, via the India geographic inference profile**

- **Decision (brief point 1):** Claude on AWS Bedrock, using the **India geographic inference
  profile** so processing stays in India. The gateway stays provider-independent so Gemini can be
  added later **only if Google gives written confirmation including voice.** **Do not hold the
  release for that.**
- **Settles:** `#5` / `D2` (the provider) and `D-14` in `docs/operator-inputs.md`. **Supersedes
  `BE-C6`** — see below.
- **What "India geographic inference profile" obliges the code to do:** the region and the profile
  are the substance of this decision, not configuration detail. A provider that reads its region
  from an environment variable and would quietly accept `us-east-1` has not implemented it. **The
  adapter must refuse to construct for any region or profile that is not the India one** — an
  assertion, not a default.
- **NOT BUILT in W1-M, and why:** no AWS credentials exist anywhere this session could reach (B1).
  An adapter that cannot be exercised is not built — see `docs/operator-inputs.md`, I-1.
- **⚠ Unverified by engineering:** that the India geographic inference profile offers **both** models
  `BE-C27` names. The exact inference-profile ids are to be **read from the Bedrock console at
  provisioning**, not typed from memory or documentation.

## `BE-C6` — **SUPERSEDED by `BE-C26`.** Its condition is MOOT, not MET

- **`BE-C6` chose Gemini 2.5 Flash *conditionally* on India residency including voice.** That condition
  was never met — `docs/ai-platform/GEMINI-RESIDENCY.md` found it UNVERIFIED with the evidence pointing
  away. **It is now moot rather than met**: the operator chose a different vendor, so whether Gemini
  passes no longer decides anything.
- **The difference matters for one reason:** if Gemini is revisited, it must be re-verified from
  scratch. **Nothing in this record says Gemini passed.** `GEMINI-RESIDENCY.md` stays where it is, with
  its three questions for Google Cloud, so the verification is not lost — and `BE-C26` names the bar
  any return must clear: **written confirmation from Google, including voice.**
- **`BE-C6` itself is not edited.** Its text stays as recorded on 30 September; this entry is the
  supersession.

## `BE-C27` — model routing: **Sonnet 5 for reasoning, Haiku 4.5 for light work**

- **Decision (brief point 2):** **Claude Sonnet 5** for AI Doctor, coaching, reasoning-heavy product
  Q&A and detailed analysis. **Claude Haiku 4.5** for classification, routing, short summaries and
  low-complexity work, to control cost.
- **Against what exists, by feature:** `ai_doctor`, `ai_coach`, `product_qa` → Sonnet. `mr_chat` and
  `lms_tutor` are not named; `mr_chat`'s scoping is a classification and the brief puts that on Haiku.
  **No feature-to-model mapping is recorded as decided beyond what the operator named** — the two
  unnamed features are an engineering proposal in `AI-SPEC.md` until confirmed.
- **Recorded verbatim as "Sonnet 5".** Whether that means a specific point release is the operator's to
  say and Bedrock's to offer; the model id is read from the console (`BE-C26`).
- **Where a reader will tell which model answered:** `ai_requests.model_name`, and for coaching
  `sim_coach_analyses.model_name`, both already written from the provider's own result. **Not
  exercised against a real model in W1-M** — B1 stopped Part B.

## `BE-C28` — **voice is a separate layer from the LLM**

- **Decision (brief point 3):** **Amazon Transcribe in Mumbai** (`ap-south-1`) for speech to text, an
  **India-compatible AWS voice option** for speech out. AI Doctor voice stays **simulation only**.
- **A structural change, not a vendor swap:** voice is no longer "the LLM, but audio". Speech in and
  speech out sit either side of a TEXT gateway call, so the guardrails, the approved prompt and the
  audit row apply to the transcript exactly as they apply to typed text. Drawn in `AI-SPEC.md`.
- **Not built.** Nothing in the repository calls a speech service today.
- **⚠ Unverified by engineering:** which AWS speech-synthesis option is India-hosted. "India-compatible"
  is the operator's word; which service and voice satisfies it is a provisioning question, not
  asserted here.

## `BE-C29` — `D-11`: **all five AI features ON at company level, each independently switchable**

- **Decision (brief point 4):** enable `product_qa`, `mr_chat`, `lms_tutor`, `ai_doctor` (simulation),
  `ai_coach`. Each switchable from admin.
- **Mechanism already exists:** `ai_feature_enabled:<feature>` resolved per organisation
  (`20260930000300_organisation_thresholds.sql`, `BE-C10`). **This decision is a VALUE, entered per
  company through `set_organisation_threshold` when the company exists** — it is not a migration.
  Shipping it as a global `true` row would switch AI on for every future tenant nobody has asked.
- **Settles `D-11`.**

## `BE-C30` — `D-12`: **100 AI requests per MR per day, a warning at 80%**

- **Decision (brief point 5):** 100/day as the launch default, admin-changeable without a code change,
  usage logged, **warning at 80%**.
- **Already true:** the allowance is a per-company threshold (`ai_daily_requests_per_user`) and every
  request is a row in `ai_requests`. **New:** the 80% warning — W1-M Part D.
- **Settles `D-12`.**

## `BE-C31` — `D-17`: **English first; Hindi or a regional language selectable before consent**

- **Decision (brief point 6):** English first, switchable to Hindi or a regional language **before
  consent**, configurable by company and territory.
- **Settles `D-17` / `#25`.** Not built in W1-M.

## `BE-C32` — `D-18`: **keep 72 hours and 120 seconds, as ADMIN CONFIG, and LOG EVERY REJECTION**

- **Decision (brief point 7):** keep the values; make both admin-configurable rather than constants;
  **log every rejection they cause, so nothing fails silently.**
- **The log is the requirement**, the config is the means. **Settles `D-18` / `#26`.**

## `BE-C33` — `D-13`: **market is a property of the CONTENT**

- **Decision (brief point 8):** keep the implementation. **Settles `D-13`.** Nothing to change — `AI-B1`
  stands as built.

## `BE-C34` — **AI analysis covers NINE things**

- **Decision (brief point 9):** after every practice session: product knowledge, scientific accuracy,
  communication, opening/pitch quality, objection handling, relevance of response, closing/follow-up,
  areas for improvement, suggested learning modules. **MR sees their own, admin can access, no manager
  leaderboard or ranking.**
- **Supersedes `BE-C19`'s seven** and turns `BE-W127` into a nine-item gap. W1-M Part C.

## `BE-C35` — AI Doctor personas to build

- **Decision (brief point 10):** busy, scientific, price-sensitive, competitor-loyal, skeptical, and a
  difficult-objection scenario.
- **Against the schema:** `sim_personas.stance` is a closed enum. Whether those six are stances, briefs,
  or scenarios is content work; **personas are authored and four-eyes approved like all content**
  (`BE-C7`), so "build" means draft-and-submit, not insert-as-approved. Not started in W1-M.

## `BE-C36` — `D-16`: **minimum necessary data; the MR only FLAGS an adverse event**

- **Decision (brief point 11):** the MR flags a possible adverse event and performs no medical
  assessment. Patient-identifiable information stays in the authorised admin/PV workflow, **never
  reaches AI Doctor or coaching**, and leaves only through the authorised PV process.
- **Settles `D-16` / `#22`** — the question `BE-C20` narrowed and left open. **It does not settle who
  operates "the authorised PV process"**: that is `D-15`, the signatory, still outstanding.

## `BE-C37` — AI may DRAFT training; it may NEVER invent a product claim

- **Decision (brief point 12):** AI may draft training explanations, lessons, quizzes and summaries. It
  must never invent a product claim, prescribing information, indication, dosage, efficacy or safety
  claim. **Product Q&A answers only from approved uploaded material, with traceability to the source.**
- **Restates `C24` and confirms `BE-C21`.** `product_qa` already refuses without approved knowledge and
  cites chunk ids; nothing to build for the Q&A half.

## `BE-C38` — `D-6`: **working hours per territory, a company default, and 09:00–18:00 is TEST DATA**

- **Decision (brief point 13):** configurable per territory with a company default. **09:00–18:00
  Mon–Sat is a TESTING value only and must not be treated as business policy.**
- **The approved hours themselves are still an input** (operator's own list).

## `BE-C39` — **continue development; send ONE list**

- **Decision:** *"continue development immediately, do not stop for items that are configurable or
  deferred."* Outstanding inputs go in **one** list — `docs/operator-inputs.md`, rewritten in W1-M A3
  to hold only what is still needed.

## `BE-C40` — **a flow and diagram to approve before major AI work**

- **Decision:** the operator approves a flow and diagram before major AI work proceeds.
- **Delivered as** `docs/ai-platform/AI-SPEC.md`, updated in W1-M Part E with every box marked BUILT,
  PARTLY BUILT or DOES NOT EXIST.
- **A tension worth naming rather than resolving silently:** `BE-C39` says do not stop; `BE-C40` says
  approve before *major* AI work. **W1-M reads them together as: build what is already decided (nine
  dimensions, the 80% warning, logged rejections), and do not start the real-vendor adapter, voice, or
  persona content ahead of the spec** — which B1 enforced anyway.

**Correction (W1-N), appended rather than edited:** the preamble above says the sixteen unrecorded
answers are asked for as *"`docs/operator-inputs.md`, I-12"*. **It was I-11.** Found by a W1-N search,
not by a reader. The id that preamble should have named is gone with the W1-N rewrite of that file;
the ask itself lives on as **Q-4** there.

---

# Operator direction — 1 October 2026, second message (W1-N)

**`BE-C41` – `BE-C61`, one per item, in the operator's own codes**, so a reader holding their message
can check each line. **Recorded from the reviewer's SUMMARY of that message, not the message itself**
— the brief says so in as many words, and says the operator's text wins on any disagreement. **No
disagreement could be checked, because the operator's text was not provided.**

| Id | Code | Decision | Relation to earlier records |
| --- | --- | --- | --- |
| `BE-C41` | A-1 | **AI-SPEC APPROVED.** Lighter model for chat and learning, stronger for AI Doctor, coaching and detailed analysis. **Do not hold AI implementation further** | **Settles `BE-C40`** and confirms the two engineering-proposed rows of `BE-C27`: `mr_chat` and `lms_tutor` → Haiku 4.5 |
| `BE-C42` | A-2 | Sample cap stays admin-configurable; **never invent or hard-code the number**; it arrives before enforcement is mandatory | Restates `BE-C11`. The 6 November CI deadline is unchanged by it |
| `BE-C43` | A-3 | Send **only** the sixteen lost subjects | See W1-N A4: **they cannot be named from any evidence engineering holds** |
| `BE-C44` | A-4 | Product claims, labels and PI need an authorised medical/business approver; the operator gives final approval; **author and approver are SEPARATE ACCOUNTS**; AI drafts training, never a claim | `C24` / `BE-C37`. Four eyes is already a table CHECK on every content type |
| `BE-C45` | A-5 | **Live tracking: YES, conditionally** — active working hours only, visible to the MR, a **separate** notice and consent, stopping outside hours. Check-in/out GPS continues regardless | **New.** Designed in W1-N Part C, **not built** |
| `BE-C46` | A-6 | **Maps: Google Maps Platform**, the billing/API account swappable without a rewrite | **New.** Setup ask in `docs/operator-inputs.md` |
| `BE-C47` | A-7 | **Notifications: Firebase Cloud Messaging**, project under the company's account — LMS reminders, assignments, certificates, field alerts, system notifications | Names the channel `BE-C14` approved |
| `BE-C48` | A-8 | **The six remaining app screens and the AI-limit warning in the UI are part of 4 October and are not to be postponed** | Turns `BE-W128` into a 4 October item. **Frontend-owned** |
| `BE-C49` | B-1 | Territory: National → Region → Area/Territory → MR, with name, code, parent, company; **an Excel template**; do not block on the data | Template + checker built in W1-N A3 |
| `BE-C50` | B-2 | Working hours per territory and company; **09:00–18:00 Mon–Sat is a temporary test value**; production value editable from admin | Restates `BE-C38` |
| `BE-C51` | B-3 | Product master: brand, generic, market, status, **a link to approved content**; real list later | Restates `BE-C12`. *Whether a product row links to approved content today is not established in W1-N* |
| `BE-C52` | B-4 | Product Q&A answers only from approved material and **refuses** product-claim questions when none exists | Already true: `answerProductQuestion` returns *"approved information not available"* and never calls the model |
| `BE-C53` | B-5 | Doctor/clinic import and admin entry ready; **AI Doctor must not depend on the real doctor master** | Already true for AI Doctor: no `sim_*` table references `doctors` (asserted, `sim-gateway.spec.ts` B6) |
| `BE-C54` | B-6 | AI drafts modules, explanations, quizzes, role-play and summaries **from supplied source material**; all final content approved | `BE-C21` / `BE-C37` |
| `BE-C55` | B-7 | **PV/data-protection signatory is NOT a current-release blocker**; keep the field and workflow ready | **Changes the standing of `D-15` / I-8**: still needed, no longer blocking |
| `BE-C56` | C-1 | **Proceed with Bedrock India**; say exactly what AWS account, IAM and key scope is needed, **restricted** | `BE-C26`. The policy is in `docs/operator-inputs.md` Q-1 |
| `BE-C57` | C-2 | Second production admin **being provisioned now** | `BE-C7`. Stays open until one approval is made with it |
| `BE-C58` | C-3 | Production order: pre-flight → working-hour config → pending changes → reference data → **production smoke test**. Never reference data before schema | `BE-C8`, plus the smoke test as a final step |
| `BE-C59` | C-4 | **Paid plan**; uptime/heartbeat monitoring **outside** the hosting platform | `BE-C25` |
| `BE-C60` | D-1 | AI privacy limit **acknowledged**. Keep the filter; **do not intentionally collect patient identifiers in the MR app; minimise what is sent; log and filter risky inputs where practical; keep patient/PV workflows separate from AI Doctor and coaching** | `BE-C20` / `BE-C36`. "Log risky inputs" is the same requirement as `BE-W129`, from a second direction |
| `BE-C61` | — | **The legal name remains the only legal-name input outstanding. Do not invent it** | `BE-C9` |

## `BE-C62` — **the coach's analysis covers TEN items; "Strengths" is the existing list** (W1-R B)

- **The operator's words** (Pratham, 1 October, item 5, quoted in the W1-R brief): *"Product knowledge,
  Scientific accuracy, Communication quality, Opening / pitch, Objection handling, Relevance of
  responses, Closing / follow-up, Strengths, Areas for improvement, Recommended LMS/training modules."*
- **`BE-C34` recorded NINE because the brief that relayed it dropped "Strengths".** Ten is the source.
- **All ten have a home, read from `SimCoachOutputSchema` and `sim_coach_analyses`, not recalled:**

| # | Operator's item | In the contract | Shape |
| --- | --- | --- | --- |
| 1 | Product knowledge | `dimensionScores.product_knowledge` | score 0–100 |
| 2 | Scientific accuracy | `dimensionScores.scientific_accuracy` | score 0–100 |
| 3 | Communication quality | `dimensionScores.communication` | score 0–100 |
| 4 | Opening / pitch | `dimensionScores.opening` | score 0–100 |
| 5 | Objection handling | `dimensionScores.objection_handling` | score 0–100 |
| 6 | Relevance of responses | `dimensionScores.response_relevance` | score 0–100 |
| 7 | Closing / follow-up | `dimensionScores.closing` | score 0–100 |
| 8 | **Strengths** | `strengths` | **list, at least one**, each naming a dimension and citing a turn |
| 9 | Areas for improvement | `improvements` | list, at least one, same shape |
| 10 | Recommended LMS/training modules | `suggestedModules` | list of 0–3, only modules the rep can open |

  Not asked for, and kept: `overallScore` and `summary`.
- **Reading taken: the LIST, not a separate score.** Items 1–7 are skills and each is already a score;
  items 8–10 are kinds of feedback, and "Areas for improvement" — its pair — is plainly a list. A
  "strengths score" would re-score the seven skills under another name. **Nothing changes.**
- **The reviewer's "the contract covers nine" was wrong for the same reason `BE-C34` was**: both counted
  from the relayed nine, not the operator's ten.

## `BE-C63` — **visibility: MR + Admin yes, Manager no — MET as enforced** (W1-R B4)

- **The operator's words** (item 6): *"MR: Can see their own detailed practice feedback and analysis.
  Admin: Can access the practice analysis for administration/training oversight. Manager: Do NOT show
  individual practice scores, rankings or team averages for now."*
- **Measured from the catalogue, two ways that differ in kind:**
  1. **Policy:** `sim_coach_analyses_read` — same company AND (`mr_id = auth.uid()` OR `is_admin()`);
     `is_admin()` is `effective_role() = 'admin'`, so a manager matches neither. `sim_sessions` and
     `sim_turns` carry the same rule. Only `authenticated` has `SELECT`.
  2. **Every reader:** the only function whose body mentions `sim_coach_analyses` or `overall_score` is
     the writer `record_sim_coach_analysis`; no view mentions either. **No average or ranking exists to
     show anyone.**
- **Nothing differs from the operator's rule.** Restates `C27`, `BE-C13`, `BE-C34`. "Later if management
  formally decides" is a future change to `is_admin()`'s branch, not to anything here.

## `BE-C64` — **the request log tells a refusal from garbage, and keeps the vendor's error NAME** (W1-S B)

- **Decided by backend, not put to the operator, and why:** it changes only what `ai_requests` records,
  and **no reader of that log exists** outside its two writers — measured from the catalogue (no other
  function or view mentions `ai_requests`) and from the code (no app or console file reads `error_code` or
  `flags`). With no reader, no count can be silently redefined; and the change only ADDS: every existing
  flag and error code keeps its meaning.
- **What changed:** a vendor-reported refusal (`LlmResult.refused`) is flagged **`model_refused`**, no
  longer `schema_invalid`; a vendor-named failure (`ProviderError`) keeps the flag `provider_error` and
  records the vendor's error **name** in `error_code` (`provider_throttling_exception`) — **never its
  message**, which can echo the request (§52). Unnamed failures still read exactly `provider_error`.
- **The bar the brief set:** an existing reader of the log is not misled. There is none; and a future one
  that counts `schema_invalid` now counts only malformed output, which is what the name always claimed.

## `BE-C65` — **a rollback never rewrites the request log; it refuses instead** (W1-T B)

- **Decided by backend, not put to the operator:** it governs only how one migration is undone, loses
  nothing either way, and touches no business rule.
- **What was wrong:** the `model_refused` rollback (W1-S) rewrote such rows to `schema_invalid` — making
  the log say something that did not happen. Measured: it could not even run. `ai_requests_before_update`
  refuses any change to a completed request (23514), so with one refused row the rollback stopped on an
  error that explains nothing.
- **Now:** while any request records a refusal, the rollback refuses by name (55000) and the migration is
  fixed FORWARD; with none — every database until a real model answers — it rolls back cleanly.
- **Alternatives weighed:** keep the flag permanently allowed on rollback (a "rolled back" schema that
  silently differs from the original); rewrite the rows (forbidden by the table, and false). Refusing is the
  only one that leaves the log true and says why.
- **Swept for the same thing elsewhere (B4):** of 26 UPDATE/DELETE statements on the 31 history tables in
  migrations and rollbacks, every other one is a guarded lifecycle transition inside a function or fills a
  column added in the same migration. **This rollback was the only rewrite of a recorded fact.**

## `BE-C66` — **settings belong to each company** (operator item 15, 2 October) — and what that does and does not close

- **The operator's words** (`docs/operator/2026-10-02-operator-direction.md`, item 15): *"This has already been
  decided: Settings belong to EACH COMPANY. Do not keep this as an open question."*
- **The dated alarm is already off, and was before the operator wrote that.** `be_w106_decision_status()`
  reports `settingsScoped: true` (measured W1-U3): `app_thresholds` has carried `organisation_id` since
  `20260930000300` (W1-L), and the status function detects resolution from the schema. The 31 October
  build failure (`check:decision-debt`) cannot fire. **`BE-W106` is CLOSED** — by the schema, now with the
  operator's decision attached. No row is added to `app_thresholds`: a deadline row with no date would
  make the status function fail closed, and resolution is read from the schema by design.
- **What the system implements:** every setting read through `threshold()` resolves territory → company →
  global, the company taken from the caller (`set_organisation_threshold` writes a company row; any key).
- **What it does NOT yet implement — so "decided" and "implemented" differ in two places:** a company's
  default working hours can only ever be TEMPORARY (the 60-day expiry checks the key, not the scope —
  `BE-W140`); and the UCPMP decision check runs with no caller, reads only the GLOBAL cap, and would still
  fail the build on 6 November after a company sets its own cap (`BE-W141`).

## `BE-C67` — **a cut-off answer is not a broken one: `output_truncated`** (W1-W C, 5 October)

- **What the vendor reports, measured from the pinned SDK, not from documentation:** `StopReason` in
  `@aws-sdk/client-bedrock-runtime` 3.1144.0 (`dist-types/models/enums.d.ts`) has nine values —
  `content_filtered`, `end_turn`, `guardrail_intervened`, `malformed_model_output`, `malformed_tool_use`,
  `max_tokens`, `model_context_window_exceeded`, `stop_sequence`, `tool_use`. An answer cut off at the
  token limit is `max_tokens`.
- **What the log said before:** the adapter read `max_tokens` as an ordinary finish, the half-answer
  failed `JSON.parse`, and the request was logged **`schema_invalid`, error code `not_json`** — beside
  garbage output. `BE-C64`'s confusion by a second door, and the coach (the longest output) first.
- **Decided: a NEW flag, `output_truncated`**, not an existing one. `schema_invalid` would keep the
  confusion; `provider_error` would say the call failed when it succeeded; `model_refused` would say the
  model declined when it did not. The remedy differs too — a truncation is fixed by the prompt version's
  `maxTokens`, nothing else is.
- **Made exactly as `BE-C64` was:** `LlmResult.truncated` set from the vendor's stop reason, never from
  the text; `generateStructured` reports it before parsing; `invalidOutput` logs `output_truncated`;
  `20261005000100` lets the database accept it; its rollback refuses while one is recorded (`BE-C65`).
  Decided by backend for the same reason as `BE-C64`: re-measured on 5 October, **nothing reads
  `ai_requests`** but its two writers (`ai_begin_request`, `ai_complete_request`; no view), and no app
  file on `main` or on the three unmerged frontend branches reads `flags` or `error_code`. Only ADDS.
- **Every stop reason, decided** (`STOP_REASON_MEANING`, keyed on the SDK's own type, so a new one fails
  to typecheck): `content_filtered`, `guardrail_intervened` → refused; `max_tokens`,
  `model_context_window_exceeded` → truncated; `end_turn`, `stop_sequence`, `tool_use`,
  `malformed_tool_use`, `malformed_model_output` → handed to validation, which decides (§38).
  **W1-V's `refusal` is not on the list** — it came from documentation — and is removed.

## `BE-C69` — **a practice turn and score are written by the gateway, as the service role, for exactly two functions** (W1-Z A, 5 October)

- **Amends `C30` narrowly.** The gateway still calls the database as the REP for every decision
  (`ai_begin_request`: flag, allowance, approved prompt, organisation; `sim_session_context`;
  `ai_complete_request`). It now ALSO reads `SUPABASE_SERVICE_ROLE_KEY`, on the `ai_doctor` and `ai_coach`
  paths only, and hands it to `_shared/practice-writer.ts`, which can call `record_sim_turn` and
  `record_sim_coach_analysis` and refuses every other name before a network call.
- **Why (`BE-W144`):** whatever the gateway could write with the rep's token, the rep could write too —
  both sides of a practice turn and their own score labelled as any model, which blocked the real coach
  (one analysis per session). Proof of origin needs something the rep does not hold.
- **The binding that keeps authorisation in Postgres:** both functions are granted to `service_role`
  only (`20261005000200`), and each refuses unless it names an OPEN request, of the right feature, begun
  by the rep who owns the session. The trusted path cannot attach a score the rep never asked for.
- **Alternatives, and why they lose:** (1) *a database check that a request is open* — the rep can open
  one with their own token, so it proves nothing; (2) *a dedicated signing secret* shared by the gateway
  and the database — keeps the gateway key-free, but adds a value to provision in three environments
  (local, CI, production) for a team that has not yet received the keys it already needs; (3) *leave it
  until an admin sees a score* — that was the W1-Y answer; the window in which the fix is cheap is now.
  The service-role key is supplied to every Edge Function by Supabase whether or not code reads it, so
  reading it adds a code path, not an exposure.
- **Not covered (`BE-W146`):** the request log itself. `ai_complete_request` runs as the rep, so a rep
  can still close their own request as `completed` with any model name and token counts. A practice
  SCORE can no longer be forged; a request-log ROW can.

## `BE-C70` — **the service-role key is read in exactly one place, and the build fails otherwise** (W2-A A, 5 October)

- **What `BE-C69` spent, said plainly.** `C30`'s guarantee was an ABSENCE: the Edge Function had no
  reference to the service-role key, so nobody fixing a 401 in a hurry could reach for it. `BE-C69` was
  right — the practice writes must come from the gateway — and it ended that absence. Nothing restores it
  while the key is in the process.
- **What replaces it.** `_shared/practice-writer.ts` is the only code that reads the key; it exports one
  function, which returns a writer for `record_sim_turn` and `record_sim_coach_analysis` and never the key
  or the client. The gateway no longer names the key. `services/api/scripts/check-service-role-reads.mjs`
  (CI, static job) fails if the name appears in code anywhere else under `supabase/functions`, if anything
  reads the whole environment or a variable whose name is not literal, if the writer exports anything
  else or its list changes, or if `packages/core` reads the environment. It cannot catch deliberate
  obfuscation or a third-party package.
- **What the key can reach, measured (A4) — not reassured.** Through the DATABASE, little: the service role
  holds no SELECT/INSERT/UPDATE/DELETE on any public table (REST answers 403 `42501`), and may EXECUTE four
  functions — the two practice writers, `ingest_transcript`, `visible_territory_ids`. Through Supabase's
  OTHER services, a great deal: the auth admin API (every account — list, create, delete) and Storage
  (every object, including the private `audio` bucket of consent recordings) both accept it (local demo
  key: HTTP 200 for both). A change that reached for the key outside the writer could do those things.
  The check is what stands between a hurried change and them; the database grants are not.

## `BE-C71` — **`BE-W146` (the forgeable request log) deferred, with a trigger that reverses it** (W2-A B, 5 October)

- **What a rep can write, measured.** On their OWN request still `started`: the status (`completed`,
  `failed`, `blocked`), `model_provider`, `model_name`, input and output token counts, flags (the known
  list), the error code, and knowledge versions (only approved ones of their company). Not another rep's
  request (`r.user_id = caller`). They can also begin requests without the gateway — each counts against
  their own allowance.
- **What reads it, measured.** `ai_begin_request` — the allowance — counts rows begun today
  (`started_at`), whatever their status, so a forged completion changes nobody's allowance; the two
  practice writers require the request to be `started`, so closing it early sabotages only the rep's own
  turn; an admin may `SELECT` the table, but no screen, report or export does. Nothing in either app or the
  console reads it.
- **The argument, both ways.** For fixing now: a log that can be forged is not a log, and the token counts
  become the cost record the day the model is live. Against: no reader today; a rep can falsify only their
  own rows; and the fix — closing through the gateway's service-role writer — touches all five flows and
  their tests and **widens what the key reaches**: the writer could then close ANY rep's request, where
  today each rep can touch only their own. That is a real cost, so it is paid when it buys something.
- **Decided: defer, with a trigger** — whichever first: **production AI traffic** (real
  `AI_PROVIDER=bedrock` with real secrets), or **any screen, report or export reading `ai_requests` model,
  token or status fields**. Written into `docs/ai-platform/KEY-DAY-CHECKLIST.md` as a gate before
  production AI, where the trigger will be read on the day it fires.

## `BE-C72` — **what `BE-C70`'s check bought, said so nobody misreads it; and the two doors it left open** (W2-B E, 6 October)

- **The framing, corrected.** `BE-C70`'s last line says the check "is what stands between a hurried
  change and" the auth admin API and the `audio` bucket. That is true of **accidental USE** and says
  nothing about **CAPABILITY**. The platform supplies the key to every Edge Function whatever the code
  does — before `BE-C69` too — so the function has always been able to reach both. **The check reduces
  accidental use; it changes nothing about what the function can do.** Read `BE-C70` with this beside it.
- **The doors it left open, from Supabase's own guide** ("Environment variables",
  `supabase.com/docs/guides/functions/secrets`, read 6 October). Every Edge Function has by default:
  `SUPABASE_SERVICE_ROLE_KEY` (legacy), **`SUPABASE_SECRET_KEYS`** — the new keys, which "will bypass Row
  Level Security" — and **`SUPABASE_DB_URL`**, a direct Postgres connection string. `BE-C70` guarded the
  first only; a hurried change reaching for either of the others passed it. **Closed as rule 6:** neither
  (nor `SUPABASE_SECRET_KEY`, the local single-key fallback) may be named in function code at all.
  Proved both ways (`service-role-reads.spec.ts`, 15 tests; removing each name from the rule kills
  exactly its own test).
- **Can the capability be narrowed? On the hosted platform, no — as far as the documentation says.**
  Named secret keys exist, but for independent ROTATION: the migration guide says secret keys "bypass Row
  Level Security and have full access to your data", every one of them. The guide documents no way to
  stop the platform injecting its default secrets. The one narrowing available is to give database-only
  work a custom Postgres role and a JWT minted for it — which narrows what the CODE uses, not what the
  function HOLDS. **That is the end of it** unless Supabase ships a scoped key. [Medium confidence on
  "no opt-out": it is the absence of a documented option, not a documented "no".]
- **A trigger with a date on it.** The same guide: the legacy `anon` and `service_role` keys "keep
  working until the end of 2026". The practice writer reads `SUPABASE_SERVICE_ROLE_KEY`; when the legacy
  keys are deactivated it gets nothing, `practiceWriterFromEnv` returns null, and every practice turn
  fails closed ("the practice writer is not configured"). **Before the legacy keys are switched off**,
  move the writer to a NAMED secret key read from `SUPABASE_SECRET_KEYS`, and move rule 1 of the check
  with it — the check will say so, because rule 6 forbids that name today.

## `BE-C77` — **the author submits; a different admin decides — `BE-W170` closed in the database** (Pratham, 9 October)

- **The rule, on operator instruction (9 October 2026):** AUTHOR drafts → AUTHOR submits for review →
  a DIFFERENT admin approves or rejects. **The author may not decide their own content.** This is the
  controlling four-eyes rule for knowledge, AI instruction sets (prompts) and practice content
  (personas, scenarios).
- **Why it changed.** Every `submit_*` accepted any admin, and every approve/reject refuses the author
  AND the submitter. A draft submitted by the non-author therefore had nobody left to decide it in a
  two-admin organisation — the size Q-14 is about to supply (`BE-W170`).
- **How it is held — two mechanisms.** `20261009000100_author_submits`: each submit function refuses a
  non-author `42501`, and a `*_author_submits` CHECK on all four tables (`submitted_by_user_id` null or
  equal to `created_by_user_id`) holds it for every writer, BYPASSRLS roles included.
- **What was deliberately NOT changed.** The approve/reject refusals and the existing `*_four_eyes`
  CHECKs still name author and submitter. With submitter = author they reduce exactly to the rule; the
  submitter clause is now redundant, not wrong, and removing it would loosen a working control for no
  gain.
- **Courses are out of this rule** until Q-21 is answered: `publish_course_version` is one step by design.

## `BE-C78` — **the manager plans a rep's day; a rep's own visit is explicitly unplanned** (Pratham, 9 October)

- **The rules, from the development instruction of 9 October 2026,** which answers Q-16, Q-17 and
  Q-18 (`docs/operator-inputs.md` §7). Q-16: a manager plans for every rep in their **territory
  subtree**, and outside it only under an admin's grant. Q-17: on the **web console**. Q-18: an
  unplanned visit needs **no** approval; the manager **reviews it afterwards**. Recorded as that
  instruction's answer; if the operator rules differently, this entry is what changes.
- **Who does what.** A field manager plans (`plan_mr_day`) and reassigns (`reassign_planned_visits`).
  An admin grants and revokes extra planning scope (`grant_planning_access` /
  `revoke_planning_access`: dated, reasoned, append-only, revoked by a second row) and **never plans
  and never writes a visit**. A rep plans nothing; their direct write grants on `beat_plans` and
  `beat_plan_entries` are withdrawn. `validate_visit` refuses any visit whose `mr_id` is not a rep, on
  every path, the owner's included.
- **What a visit is, said by the schema.** `visits.origin`: `planned` (has a plan and a planned date;
  only the plan path may create one), `unplanned` (no plan, a 3-500 character reason), `unclassified`
  (every row before `20261009000200`, and owner-written fixtures). **No signed-in caller may create an
  unclassified visit**, so a null `beat_plan_id` never again makes a malformed visit look legitimate.
  Origin, planned date, reason and rep are fixed once the row exists.
- **Versions.** Every save is version N+1 superseding N; versions are never edited. A visit not yet
  started follows the new version (same row, same id); one whose doctor left the plan is `cancelled`;
  a started, completed or not-met visit is never touched and keeps pointing at the version it was
  worked against. A late check-in against a cancelled visit is accepted with `stale_beat_plan` and the
  visit stays cancelled (`record_check_in` does not move a status backwards).
- **Idempotency.** A `request_id` per save (unique on `beat_plans`) and per reassignment; a save equal
  to the current version writes nothing; a per-rep-per-day advisory lock serialises saves; and a
  partial unique index allows one live planned visit per rep, doctor and day.
- **Reassignment is option A only: per visit, explicit.** "Move future plans with a reassigned rep"
  (option B) would put doctors on a rep's plan that are outside their new territory, which
  `validate_visit` rule 2 forbids; it is an open question, not built.
- **A rep changing territory moves nothing.** Their planned visits stay theirs until a manager
  reassigns them.

## `BE-C79` — **OpenAI answers the pilot's AI features; the abstraction and Bedrock stay** (Pratham, 9 October)

- **The decision, from the operator's release instruction of 9 October 2026:** OpenAI is the pilot's
  provider. Keep the provider abstraction; do not delete Bedrock; do not use Bedrock.
- **What it overrides, said plainly:** `BE-C26` chose Claude on Bedrock **India** so that processing
  stays in India. **OpenAI's API gives no such guarantee.** That property does not hold for the pilot,
  and that is the operator's accepted trade, not something the code hides. Re-selecting Bedrock is one
  secret (`AI_PROVIDER=bedrock`); its adapter still refuses any region or profile that is not India.
- **What does not change:** every rule that matters lives in the flows in `@fieldforce/core` —
  approved prompt and approved knowledge only, guardrails BEFORE the model (patient data is never
  sent), practice-only simulation from the stored session, four-eyes on content, the audit row. The
  adapter carries messages and reads replies; it adds nothing to the approved prompt.
- **The key:** `OPENAI_API_KEY` is an Edge Function secret. It is never in the phone, the console,
  an `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` value, the repository or a log line.
- **Models:** `OPENAI_MODEL` in `prompt-contract.ts` (`gpt-4.1` for the larger tier, `gpt-4.1-mini`
  for `mr_chat`/`lms_tutor`), shared with the console's label. That these are enabled on the
  operator's account is **not verified** — `BE-W178` is IMPLEMENTED, NOT LIVE VERIFIED.
