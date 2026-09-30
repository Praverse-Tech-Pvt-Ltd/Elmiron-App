# Operator inputs — everything still needed from you, in one list

**30 September 2026. W1-L Part D.**

**`BE-C23` asked for exactly this — "proceed with the structure, one consolidated list" — and this file is it.**

**It supersedes the scattered asks.** `blocked-on-you.md` §5.x, its "If you answer only three"
table at line ~1415, and `COMPLETION-PLAN.md`'s several ask tables were all correct when written and
all say different subsets. **Three lists is the same failure as none**, because nobody can tell which
one is current. From today, **this file is the list**, and the others are history.

**What is on it.** Things the system needs FROM YOU and cannot derive, invent, or default. **A
decision you have already made is not on this list** — the twenty answers of 30 September are
recorded as `BE-C6`–`BE-C25` in `.ai-collab/decisions-backend.md`, and everything they closed has
been struck from here. What survives is mostly the split those answers created: **you answered the
METHOD, and the VALUE is still outstanding.** Those are two different things and only one of them
is done.

**How to read "What it blocks".** It is the honest answer, including when the answer is *nothing
yet*. An item that blocks nothing today is still on the list, because the reason it blocks nothing
is usually that the thing it feeds has not been built — and that changes.

---

## 1. The four that compound, block a deploy, or cost money while you read this

| # | What is needed | What it blocks | Why it is in this group |
| --- | --- | --- | --- |
| **D-1** | **The organisation's REGISTERED LEGAL NAME**, as it should appear on a consent notice | The consent screen names nobody as Data Fiduciary. **It does not block a build — it damages every record captured until it arrives** | **The only item whose cost is larger tomorrow than today.** `consent_records` is append-only *by design*, so a consent captured against an unnamed notice is permanently defective **and cannot be amended**. The same property that protects the ledger from tampering prevents repair. `BE-C9` answered the METHOD — do not hard-code it, do not let engineering pick one. **The name itself is still missing.** `BE-W93` |
| **D-2** | **The UCPMP sample cap: the NUMBER, the DIMENSION it is measured on, and whether `input` counts against it** | Nothing downstream today. **`check:decision-debt` turns CI RED on 6 November 2026**, and starts warning on 16 October | `BE-C11` answered that the cap is configurable from the admin console, which is the method. **A configurable cap with no number configured is still no cap.** Verify with `node services/api/scripts/check-decision-debt.mjs`; it prints the days remaining |
| **D-3** | **A SECOND admin account that is a real person**, distinct from the first | **Every four-eyes approval, `42501`** — knowledge, AI prompts, LMS content. The whole draft → in_review → approved path cannot be exercised by a human even once | `BE-C7` says this was provided. **It is listed here until it is provisioned in the production project and one approval has actually been made with it** — a decision to provide an account and an account are not the same object. The local database has admins because fixtures mint them; that proves nothing about production |
| **D-4** | **The deploy sequence's prerequisite: the schema before any reference data** | The production deploy | `BE-C8` fixed the order. It is here as the gate on items D-5 to D-9: **none of them can be loaded until the 56 migrations are applied**, and loading them first is the specific mistake that decision exists to prevent |

---

## 2. Reference data — what the system is empty without

**Every item here is data you hold and we cannot invent.** For each, "what it blocks" was
established by reading what refuses, not by recollection.

| # | What is needed | Where it lands | What it blocks |
| --- | --- | --- | --- |
| **D-5** | **The territory tree** — national, regions, areas, with names and codes and each one's parent | `public.territories` | **Nearly everything.** An MR's organisation is DERIVED from their territory (`user_profiles` has no organisation for field roles otherwise), so with no territories there are no users, and with no users there is nothing else. This is the first load after the schema |
| **D-6** | **Working hours per territory** — the shift window each territory actually works | `public.territory_shift_windows` | Check-in validity and the out-of-hours exception. With neither a row nor a default the code refuses with an explicit hint: *"Insert a `territory_shift_windows` row, or set the `org_default_shift_window` threshold"* (`20260815000100_thresholds_and_shift_defaults.sql:200`). **The threshold is the temporary escape hatch and the schema enforces that it is temporary** — an `org_default_shift_window` without an `expiresAt` is rejected (`20260816000200_shift_window_expiry.sql:61`) |
| **D-7** | **The product list — brand name AND generic name for each** | `public.products` (`brand_name`, `generic_name`) | **`mr_chat` scoping.** `mr_chat_scope_terms` returns exactly these two columns for the caller's company, and `namesAProduct()` decides from them whether a question is in scope. With an empty table **every** question reads as out of scope. Also the product picker on every visit screen |
| **D-8** | **Approved product content** — labels, prescribing information, the approved claims a rep may make | `knowledge_documents` → `knowledge_document_versions`, approved through four-eyes | **`product_qa` entirely.** The feature is only permitted to answer from approved knowledge, so with none it refuses rather than guessing — which is the design. `BE-C12` settled the STRUCTURE now and the CONTENT later; **this is the content half.** <br><br>**This is the boundary `C24` must not cross:** a model may draft training text, **never a product claim.** Whoever signs these off is a medical-affairs question, not an engineering one |
| **D-9** | **Doctors and their clinics** — names, registration numbers, specialties, addresses | `public.doctors` | Real visits. Practice and simulation do not need it (`BE-C17` defers real doctor recording, `BE-C18` makes AI Doctor simulation only), so this blocks the live field app and not the AI work |
| **D-10** | **Source material for LMS courses** | `courses` → `course_versions` → `lessons` | Real training content. `BE-C21` settled that lessons may be AI-DRAFTED and then approved by a human — **that is a method, and it still needs something to draft FROM.** A tutor grounded in an empty lesson is the failure `lms_tutor` was built to refuse |

---

## 3. Settings that have no safe default — you must choose a value

**These are now per-company** (`BE-C10`, built by `20260930000300_organisation_thresholds.sql`), so
each is a choice **per company**, not once for everybody.

| # | Setting | What it blocks | Why there is no default |
| --- | --- | --- | --- |
| **D-11** | **Which AI features are switched ON**, one per feature: `product_qa`, `mr_chat`, `lms_tutor`, `ai_doctor`, `ai_coach` | Each feature, individually. Off gives `45011 ai_feature_disabled` | **Every feature is off out of the box and no migration inserts a row to change that.** That is deliberate and tested: a feature nobody switched on must not run. Set from the admin console (`set_organisation_threshold`) |
| **D-12** | **The daily AI request allowance per user** (`ai_daily_requests_per_user`) | **All five AI features**, even the ones switched on | No migration inserts it either, and `ai_begin_request` refuses with the hint *"An unlimited allowance is never the default"*. **This is a cost control, and the absent value fails closed rather than open** |

---

## 4. Still-open DECISIONS the twenty did not reach

**Not inputs — questions.** They are here so that consolidating the lists does not lose them.

| # | Question | What it blocks | Current state |
| --- | --- | --- | --- |
| **D-13** | **Is "market" a property of the COMPANY or of the CONTENT?** | Nothing today. **An answer of "company" REWORKS `AI-B1` rather than unblocking it** | Built as *on the content*. This is the one open question whose answer could make finished work wrong, which is why it is worth asking early even though nothing waits on it |
| **D-14** | **Gemini's India residency, including voice** | **Locks or unlocks `BE-C6`.** The fallback (Claude via AWS Bedrock India) is already recommended for text and needs no answer from you | **`BE-C6` is CONDITIONAL and the condition is NOT met.** `docs/ai-platform/GEMINI-RESIDENCY.md` records the verdict as UNVERIFIED with the evidence pointing away, and carries three questions written to be sent to Google Cloud as-is. **Nothing has been signed** |
| **D-15** | **Who is the PV / DPDP signatory?** | **Transcripts.** Untouched by all twenty answers and still the blocker on them | `#18`. This is a named person with an accountable role, not a department. It has been asked before and never answered |
| **D-16** | **May an adverse-event report carry patient information and leave the platform?** | Adverse-event reporting end to end | `#22`. **`BE-C20` narrowed it and did not close it** — that decision says patient information is not exposed in the MR app, which is a different question from what a PV report may contain when it is sent onward |
| **D-17** | **The consent-notice LANGUAGE ORDER** — which language a doctor is shown first | Nothing today; it is a default nobody has confirmed | `#25`. Unasked until now. Filed because an unconfirmed default on a consent face is the same class of problem as D-1, one degree smaller |
| **D-18** | **Confirm the 72-hour and 120-second consent thresholds** (`consent_max_sync_lag_hours`, `consent_future_tolerance_seconds`) | Nothing today. They have values and the values were chosen by engineering | `#26`. **These are the two numbers most likely to be wrong in a way nobody notices**, because they fail silently by accepting or rejecting a record at the margin. Ten minutes of your time closes them |

---

## What is NOT on this list, and why

Struck because the twenty answers of 30 September closed them outright. Listed so you can see the
list shrank for a reason rather than by oversight.

| Previously asked | Closed by |
| --- | --- |
| Where does the AI gateway run / which provider | `BE-C6` — Gemini 2.5 Flash conditional, Bedrock India the fallback. **Conditional, see D-14** |
| Approve `pgvector` / vector search | `BE-C16` — approved, with keyword search as the fallback, **and it must not hold up other work** |
| Notifications, and by which channel | `BE-C14` — approved, Firebase |
| A PDF-reading component for knowledge upload | `BE-C15` — approved |
| Should settings belong to a company (`BE-W106`) | `BE-C10` — **answered AND built.** The debt gate now reports it clear |
| May a manager see practice scores, or which AI features an MR used | `BE-C13` — MR and company admin only. **Never a manager surface** |
| Real doctor recording for AI practice | `BE-C17` — deferred; `BE-C18` — simulation only |
| Patient information in the MR app | `BE-C20` — no |
| Backups and their region; point-in-time recovery | `BE-C24`, `BE-C25` — India region documented, PITR plus an external heartbeat monitor |

---

## If you supply only three

**D-1, D-3, D-5.**

* **D-1** because it is the only one that gets more expensive every day, and it is one sentence from
  your legal counsel.
* **D-3** because without it no approval can be made by a human at all, and it is a provisioning
  task rather than a decision.
* **D-5** because everything in section 2 is loaded after it and none of it can start without it.

**D-2 is fourth only because its deadline is 6 November.** It moves to the top on 16 October, when
CI begins warning.

**And D-15 is not fourth, fifth or anywhere on that shortlist — which is worth saying out loud.**
It blocks transcripts entirely, it has been asked before, and all twenty answers went past it. An
item that keeps not being answered is not thereby less important; it is usually harder to answer,
which is a reason to start it sooner.
