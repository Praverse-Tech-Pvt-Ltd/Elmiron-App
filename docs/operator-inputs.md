# Operator inputs — what is still needed from you, and nothing else

**1 October 2026. W1-M Part A3.** Rewritten, per your instruction (`BE-C39`), to hold **only what is
still INPUT REQUIRED**. Every decision you have made is in `.ai-collab/decisions-backend.md`
(`BE-C6`–`BE-C40`) and is not repeated here. The 30 September version of this file, with its decided
rows, is in git history at `afb12fc`.

**You said seven. Checked against the register, it is eleven.** Your seven are all here (I-2 to I-8).
Four more are not on your list and are still needed. Each says why:

| Not on your list | Why it is still here |
| --- | --- |
| **I-1** AWS access | **New today.** The provider you chose cannot be built without it (W1-M B1) |
| **I-9** approved product content | Your point 12 (`BE-C37`) says Product Q&A answers **only** from approved uploaded material. With none uploaded, it refuses every question, correctly |
| **I-10** the second admin, provisioned | `BE-C7` decided to provide one. **No approval of any content can happen until one exists in production** |
| **I-11** the other sixteen answers | The brief that reached engineering spelled out 15 of your 31 answers. **The rest were not recorded rather than guessed** |

**Two old rows were removed rather than answered:** old `D-4` (the deploy order) was a rule, not an
input, and it is recorded as `BE-C8`. Old `D-10` (LMS source material) folds into **I-9**: under
`BE-C37`, AI may draft lessons, but a product lesson may only be drafted from approved content.

---

| # | What is needed | What it blocks today | Where it lands |
| --- | --- | --- | --- |
| **I-1** | **AWS access for AI, in India.** (1) an AWS account the company owns; (2) **Amazon Bedrock model access granted for Claude Sonnet 5 AND Claude Haiku 4.5** (`BE-C27`); (3) confirmation that **both are offered through the India geographic inference profile** — the exact inference-profile ids copied from the Bedrock console; (4) an IAM access key scoped to `bedrock:InvokeModel` on those two profiles only, **sent as a deployment secret, never in a file or chat** | **The real provider — all five AI features are still answering from a stub.** Engineering built nothing vendor-specific, because an adapter that cannot be called cannot be tested | Edge Function secrets. **Later, the same account needs Amazon Transcribe in `ap-south-1` and a speech-out service for voice (`BE-C28`)** — not needed yet |
| **I-2** | **The registered legal name**, as it should appear on a consent notice (`BE-C9`) | **Nothing refuses — every consent captured before it arrives is permanently defective.** `consent_records` is append-only and cannot be amended | The consent configuration |
| **I-3** | **The UCPMP sample cap: the number, the basis it is measured on, and whether `input` counts against it** (`BE-C11`) | **CI turns RED on 6 November 2026, warns from 16 October.** Check with `node services/api/scripts/check-decision-debt.mjs` | Admin settings |
| **I-4** | **Territories — names, codes, and each one's parent** | **Nearly everything.** An MR's company is derived from their territory, so no territories means no users | `public.territories`. **First load after the schema** (`BE-C8`) |
| **I-5** | **Approved working hours** per territory and a company default (`BE-C38`) | Check-in validity. **09:00–18:00 Mon–Sat is TEST DATA, not this value** | `territory_shift_windows`, and the company default |
| **I-6** | **The real product list — brand name and generic name for each** | `mr_chat` treats every question as out of scope with an empty list; the product picker is empty | `public.products` |
| **I-7** | **Doctor and clinic master data** — names, registration numbers, specialties, addresses | Real visits only. Practice does not need it (`BE-C18`) | `public.doctors` |
| **I-8** | **The PV / data-protection signatory — a named person** | **Transcripts, and the "authorised PV process" your point 11 (`BE-C36`) relies on.** Asked repeatedly and never answered | The PV workflow |
| **I-9** | **Approved product content** — labels, prescribing information, approved claims — and **who signs it off** | **`product_qa` entirely, and any AI-drafted product lesson.** AI may never invent a claim (`BE-C37`), so it can only draft from what you approve | `knowledge_documents`, four-eyes approved |
| **I-10** | **The second admin, provisioned in production** and used for one real approval (`BE-C7`) | **Every approval** — knowledge, prompts, personas, lessons. Four eyes is a database check; one admin cannot pass it | `user_profiles` |
| **I-11** | **The text of the other sixteen answers** of your 31 | Unknown, by definition. Nothing is built on them | `.ai-collab/decisions-backend.md` |

---

## If you supply only three

* **I-1**, because it is the one thing standing between five finished AI features and a real model.
* **I-2**, because it is the only item that gets more expensive every day it is missing.
* **I-4**, because every other piece of reference data is loaded after it.

**I-3 moves to the top on 16 October**, when CI starts warning. **I-8 keeps not being answered**, and
that is a reason to start it now, not a reason it matters less.
