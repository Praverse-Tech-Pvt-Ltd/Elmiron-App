# Gemini and India residency — the verification `BE-C6` is conditional on

**Read this before anything is signed.** `BE-C6` chose **Gemini 2.5 Flash** for AI Doctor, LMS,
product Q&A, coaching and analysis, **subject to confirming that the exact setup — including voice —
satisfies India residency.** This document is that verification. **It produces a verdict, not a
lock**: nothing has been signed, no account opened, no vendor SDK added.

**All pages read 30 September 2026.** Every cell is either a quotation with a URL or marked
**UNVERIFIED**. Nothing is inferred into a blank.

---

## B3 — THE VERDICT FIRST

> ## **UNVERIFIED, and what evidence exists points AWAY from the chosen configuration.**
>
> **Nothing found confirms that Gemini 2.5 Flash can be pinned to an India region through the Vertex
> AI API this gateway would call, and no evidence found puts VOICE in India at all.**
>
> **The one India data-residency confirmation located is for a different product and a different model
> version** — Gemini *Enterprise* (and Gemini Notebook Enterprise), naming **Gemini 3.5 Flash**, on a
> page that **explicitly excludes 2.5 Pro from the India region**.
>
> **So `BE-C6`'s condition is NOT met.** The recorded fallback — **Claude via AWS Bedrock India** —
> stands, and `PROVIDER-SHORTLIST.md` already recommended it for text.

**This is not a claim that Gemini fails the requirement.** It is a claim that **the requirement has
not been shown to be met**, which is the only honest reading when the vendor's own regional pages
could not be read as text. **What would settle it is one question to Google Cloud with the model id
and the region in it** — see "What to ask" below.

---

## B1 — text inference, retention, training, sub-processors, and the two routes

**The single most important finding is that there are at least THREE different Google products with
"Gemini" in the name, and their residency answers differ.** Treating them as one is the mistake this
document exists to prevent:

| Route | What it is | Is it what we would use? |
| --- | --- | --- |
| **Gemini API / Google AI Studio** (`ai.google.dev`) | The consumer/developer API, API-key based | Possible, and **the cheapest** — which is why `BE-C6` chose on economy grounds |
| **Vertex AI Gemini API** (`cloud.google.com/vertex-ai`) | The enterprise route, GCP project, regional endpoints | **The one a residency requirement would force us to** |
| **Gemini Enterprise / Gemini Notebook Enterprise** | A packaged app product, not a model API | **No.** But it is the only one whose India residency I could confirm |

### Where INFERENCE runs, and whether India can be pinned

| Question | Answer | Source |
| --- | --- | --- |
| Does the consumer Gemini API document a processing region? | **NO.** The "available regions" page lists **India** among supported countries, but it is about **where you may USE the service** — it "does not specify where data is processed or stored" | [ai.google.dev/gemini-api/docs/available-regions](https://ai.google.dev/gemini-api/docs/available-regions) |
| Can Vertex AI Gemini 2.5 Flash be pinned to an India region? | **UNVERIFIED.** The Vertex AI locations and data-residency pages returned navigation shells rather than policy text through the tooling available here | [docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) · [.../learn/data-residency](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency) |
| What at-rest residency did Google publish for generative AI on Vertex AI? | **10 countries. In Asia: Japan, Singapore, Korea. India is NOT listed.** The post also **does not distinguish** at-rest storage from ML-processing location | [cloud.google.com/blog/…/google-cloud-generative-ai-data-residency-guarantees-for-data-stored-at-rest](https://cloud.google.com/blog/products/ai-machine-learning/google-cloud-generative-ai-data-residency-guarantees-for-data-stored-at-rest) |
| Is there ANY documented India region with at-rest DRZ and in-region ML processing? | **Yes — but for Gemini Enterprise, not the model API.** India (`in`) is listed as an in-country region providing "at-rest DRZ within the specified location", applying to **Gemini Enterprise and Gemini Notebook Enterprise**. The model named as supported there is **Gemini 3.5 Flash**; the page states **"IN, SG, UK regions don't offer the 2.5 Pro model"** | [docs.cloud.google.com/gemini/enterprise/docs/locations](https://docs.cloud.google.com/gemini/enterprise/docs/locations) |

**⚠ The at-rest blog post is probably superseded and is cited with that caveat.** It names **PaLM 2,
Codey and Imagen** — pre-Gemini models — so the region list has very likely grown. **It is cited
because it is the only list of regions I could read as text**, and because it establishes the
distinction that matters: *at-rest storage residency and ML-processing residency are different
commitments*, and a page answering one does not answer the other. **That is the same confusion that
eliminated OpenAI direct in `PROVIDER-SHORTLIST.md`** — India was a *storage* residency region there,
not a *processing* one.

### Retention, training, and human review — the one area that IS well documented

**For the consumer Gemini API, the paid and unpaid tiers differ completely**, and the difference is
decisive:

| | **Unpaid (free) tier** | **Paid tier** |
| --- | --- | --- |
| Used to improve/train Google products | **YES** — *"Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services"* | **NO** — *"Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products"* |
| Human review | **YES** — *"human reviewers may read, annotate, and process your API input and output"* | Not stated as applying |
| Retention | — | *"Google logs prompts and responses for a limited period of time, solely for detecting and preventing violations of the Prohibited Use Policy"* |

Source: [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms), read 30 September
2026.

**The consequence for this project is blunt: the free tier is unusable.** Human reviewers reading API
input, on a system whose guardrails admit three sentences that could describe a patient (W1-K Part A),
is not a residency question — it is a disclosure one. **If Gemini is used at all, it must be the paid
tier, and that must be a written condition of the choice.**

| Question | Answer |
| --- | --- |
| Is the "no training" commitment contractually switchable? | **UNVERIFIED.** It is stated as a property of the paid tier, not as a toggle. Whether it is restated in an enterprise agreement was not established |
| Is prompt/response logging for abuse detection opt-out-able? | **UNVERIFIED** for the consumer API. Vertex AI has historically offered an abuse-monitoring exception process; **I could not read that page**, so it is not asserted |
| Does any abuse-monitoring copy leave the region? | **UNVERIFIED.** This is the question that most often defeats a residency claim, and it is precisely the one I could not source |
| Sub-processor position | **UNVERIFIED.** Google publishes a Cloud sub-processor list; I did not read it, so it is not summarised here |

---

## B2 — VOICE, which the operator named explicitly

**The operator was right to name it separately, and a single "yes" covering text and speech is the
answer to be suspicious of.**

| Question | Answer | Source |
| --- | --- | --- |
| Which regions serve Gemini 2.5 Flash with Live API native audio? | **UNVERIFIED from vendor documentation.** The model's own page returned a navigation shell | [docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api) |
| Is any India region among them? | **No India region appears in any evidence found.** The regions named in a Google AI developer-forum thread are `us-central1`, `us-east5`, `us-east1`, `us-west1`, `europe-west1`, `europe-west4`, `asia-northeast1` | [discuss.ai.google.dev](https://discuss.ai.google.dev/t/gemini-3-1-flash-live-preview-on-vertex-ai-eu-region-availability/144429) — **a forum post, NOT vendor documentation.** Weak evidence, recorded as weak |
| Does Google market Live API as multi-region with residency controls? | Yes, in marketing terms — "enterprise-grade data residency features allow you to manage where your data is processed" — **without naming India** | [cloud.google.com/blog/…/gemini-live-api-available-on-vertex-ai](https://cloud.google.com/blog/products/ai-machine-learning/gemini-live-api-available-on-vertex-ai) |

**So the voice answer differs from the text answer, exactly as the operator suspected it might** — and
it differs in the unhelpful direction. **Voice is the half with the least evidence of an India region
and the weakest sourcing.**

**This matters beyond `BE-C6`, because `BE-C18` puts voice in AI Doctor.** If voice cannot run in
India, then either practice voice runs outside India, or it waits. That is a product decision, not an
engineering one.

---

## What to ask Google Cloud — three questions that would close this

Written so they can be sent as-is. **Each names a model id and a region, because a question that does
not cannot be answered precisely.**

1. **"For `gemini-2.5-flash` on Vertex AI, can ML processing and data-at-rest be confined to
   `asia-south1` or `asia-south2`? If not, which is the nearest region where both hold?"**
2. **"For the Live API native-audio model on Vertex AI, which regions serve it, and is any India
   region among them?"**
3. **"With abuse monitoring enabled, does any copy of prompts or audio leave the chosen region, and is
   there a documented exception process?"**

---

## B5 — what the gateway already guarantees, and the one file that changes

**The operator's provider-independence requirement is already met by construction, not by promise.**

* Every flow — `answerProductQuestion`, `answerMrChat`, `answerLessonQuestion`, `takeDoctorTurn`,
  `analyseSimSession` — takes an **`LlmProvider`** as an argument. The interface is one method:
  `generate(request): Promise<LlmResult>` (`packages/core/src/field/gateway/providers.ts`).
* **No flow, no migration and no test names a vendor.** The only thing that constructs a provider is:

  **`services/api/supabase/functions/ai-gateway/index.ts`**, at the line
  `provider = createStubProvider(STUB_SHAPE[feature]);`

**That is the file, and it is one line.** Swapping `createStubProvider` for a Gemini or Bedrock
provider changes the vendor for all five features at once, and changes nothing else — because the
flag, the approved prompt, the guardrails, the citation validation, the audit row and the SQLSTATE
mapping all sit either side of it.

**Checkable claim:** `grep -ril "gemini\|bedrock\|anthropic\|openai" packages/core/src services/api/supabase/migrations`
returns nothing. **The vendor does not appear anywhere in the contract or the schema.**

**So the cost of the Gemini-vs-Bedrock decision is not architectural.** It is a provider class and its
credentials. **Which means waiting for the residency answer costs almost nothing in engineering
time** — the thing that would have been expensive was already avoided.
