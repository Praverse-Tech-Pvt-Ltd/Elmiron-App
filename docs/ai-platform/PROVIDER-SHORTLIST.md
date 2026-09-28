# AI provider shortlist — for the operator to choose from

**28 September 2026.** Written for a reader who is not an engineer. This exists because `#5` /
`D2` is the decision that blocks every AI feature, and `R10` asked for a shortlist judged on
**quality, latency, cost, and data and privacy terms**, for **text and voice**, under India
residency.

**Every factual claim below carries the URL it came from and the date I read it (28 September
2026).** Where I could not confirm something from the vendor's own documentation, the cell says
**UNVERIFIED** rather than a plausible number. **There are 17 UNVERIFIED cells and they are listed
together at the end**, because the gaps are the part a decision can trip over.

**Two warnings about this document's own reliability.**

1. **My training data ends before today, and vendor regions and terms change monthly.** Nothing
   here rests on what I remember. Where a search result and a vendor document disagreed, I used
   the vendor document and said so.
2. **A marketing page is not a contract.** Everything in the "data and privacy" column is what
   public documentation *says*. **What binds is the signed agreement**, which nobody has obtained
   for any of these vendors — see Part B7.

---

# 1. THE RESIDENCY QUESTION, BEFORE ANY VENDOR

**"Has a Mumbai region" is not the same as "our data stays in India." They come apart in four
separate places, and a provider can pass three and fail the fourth.**

| The question | Why it is separate |
| --- | --- |
| **Where does INFERENCE run?** | The model actually reading your prompt may run somewhere else entirely, even when your account, your storage and your billing are Indian |
| **Are prompts and outputs RETAINED?** | For how long, by whom, and **does an abuse-monitoring copy leave the region?** Safety systems are a common, legitimate and usually undocumented exception |
| **Is data used for TRAINING?** | And can that be contractually switched off, or is it only a default that can change? |
| **Who are the SUB-PROCESSORS?** | A provider may be Indian and still route through a third party that is not |

**The finding that makes this section worth reading: one major vendor passes on storage and fails
on inference, and its own documentation says so.** See OpenAI direct, below.

**The rule this implies, stated plainly for the operator: a provider that processes in India but
retains prompts elsewhere fails the requirement.** So does one that stores in India but infers
elsewhere. Residency is the weakest of the four links, not the strongest.

---

# 2. CANDIDATES — how the list was built

**I did not use the reviewer's list.** The starting categories were: the major cloud AI platforms
with an India region; Indian providers built for Indic languages; and self-hosting an open model
inside our own India region. Each was then verified or discarded on evidence.

**A caution the operator should hold onto:** an assistant's knowledge of vendor regions and terms
is out of date the moment it is written, and **only the vendor's current documentation counts.**
Every row below names the page and the date.

---

# 3. TEXT — for Product Q&A, MR Chat and the learning tutor

| Provider | Quality | Latency | Cost | Data & privacy terms | Verdict |
| --- | --- | --- | --- | --- | --- |
| **AWS Bedrock, India** (`ap-south-1` Mumbai / `ap-south-2` Hyderabad) | 61 models from Amazon, Anthropic, Cohere, DeepSeek, Google and others, so quality is a per-model choice rather than a vendor choice. **Quality not independently benchmarked by us — UNVERIFIED** | **UNVERIFIED** — no in-region latency measured by us | Per-model; **UNVERIFIED** at India-region rates | **The strongest documented story.** *"Amazon Bedrock uses a zero data retention (ZDR) data security model… by default, Amazon Bedrock does not store model inputs or outputs."* And: *"Amazon Bedrock routes requests only within the India geography across Regions such as Asia Pacific (Mumbai) Region (ap-south-1) and Asia Pacific (Hyderabad) Region (ap-south-2)."* **The exception, quoted: *"for certain models, including GPT-5.6, content flagged by the Amazon Bedrock automated abuse-detection classifiers is retained for offline abuse detection."* Whether that flagged content leaves India is NOT stated — UNVERIFIED, and it is the single most important gap in this table.** Training use: **UNVERIFIED** (not addressed on the page read) | **SHORTLIST** |
| **Sarvam AI** (Indian) | **Strongest published evidence of any candidate for Indian languages** — see the voice table; the same house builds the text models | **UNVERIFIED** | **Cheapest verified.** Sarvam 105B Chat: **₹29.28 per million input tokens, ₹73.2 per million output tokens** | Public site: *"developed and operated entirely in India"*, *"SOC 2 Type II, ISO 27001, DPDP compliant"*, *"data residency controls built into the core"*, and deployment *"Private cloud, on-premise, or hybrid"* with *"Air-gapped deployment available"*. **The pricing documentation page carries no retention, residency or training terms at all — UNVERIFIED for the hosted API.** The "no training on customer data" claim appears in third-party summaries, **not in a vendor page I could read — UNVERIFIED** | **SHORTLIST** |
| **Google Vertex AI / Gemini**, `asia-south1` | Gemini 3 Pro is the only global system at parity with Sarvam on Indian speech (see voice table), which is indicative for text too | **UNVERIFIED** | **UNVERIFIED** | Generative AI on Vertex AI **is available** in Mumbai (`asia-south1`). **But I could not retrieve Google's data-residency page**, so whether ML *processing* is guaranteed in-region at `asia-south1` is **UNVERIFIED**. Google's related Text-to-Speech documentation is the warning sign: it offers a Mumbai regional endpoint, yet the residency guarantee sentence names **only Europe and the USA** (see voice table) | **SHORTLIST, conditional** on Google confirming in-region ML processing for `asia-south1` in writing |
| **Azure OpenAI**, India regions | — | **UNVERIFIED** | **UNVERIFIED** | Microsoft's own Q&A, asked exactly this, answered: *"When an Azure OpenAI resource is deployed in an India region, it is designed to keep data within that region. However, specific guarantees about routing or inference execution outside India due to capacity or fallback scenarios are not explicitly detailed in the available context"* — and referred the asker to a Microsoft representative. **That is an AI-generated answer on a Q&A forum, not a Microsoft commitment**, and it does not address abuse monitoring | **NOT SHORTLISTED** on current evidence — the question was asked publicly and not answered |
| **OpenAI, direct API** | — | — | 10% uplift on data-residency endpoints for models released on or after 5 March 2026 | **FAILS THE REQUIREMENT, on OpenAI's own documentation.** India is a **storage** residency region but **not a processing** region. Regional *processing* is supported only in the **United States, Europe (EEA + Switzerland)** and the UAE (limited). For every other region, including India: *"If your selected Region does not support regional processing… OpenAI may also process and temporarily store Customer Content outside of the Region to deliver the services."* Training default is good — *"data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in)"* — but that does not rescue residency | **ELIMINATED.** Storing in India while inferring in the US is exactly the failure §1 describes |
| **Self-hosting an open model in our own India region** | **UNVERIFIED** — depends entirely on the model chosen | **UNVERIFIED** | **Not a per-token cost — a GPU bill.** Around the clock, this is the most expensive option at our volume, not the cheapest, because our volume is small | **Perfect on paper**: nothing leaves the machine, no sub-processor, no retention question, no training question. Sarvam also offers on-premise and air-gapped deployment, which is a hybrid of this and the row above | **NOT NOW.** Right answer if residency terms cannot be obtained; wrong answer for a four-person decision this week |

**Note on OpenAI models reached *through* Bedrock:** AWS's India in-country inferencing post is
specifically about running OpenAI models inside India on Bedrock. **Reaching a model through
Bedrock and reaching it from OpenAI directly are different products with different residency
answers**, and the difference is the whole point of the table.

---

# 4. VOICE — practice simulation only (`C22`, speech in and speech out)

**Voice is the harder half, and the field is much smaller.** It is also where the only hard
numbers in this document live.

## The benchmark evidence, and where each claim comes from

**Two independent, published, peer-reviewed benchmarks exist, and I verified both are real.**

- **Voice of India** — arXiv `2604.19151v2`, 24 May 2026, by AI4Bharat (IIT Madras) with Josh
  Talks. 14 ASR systems, 15 Indian languages, 35,000+ speakers.
- **Indic DiarBench** — arXiv `2607.23808`, to be presented at Interspeech 2026, by **Sarvam with
  AI4Bharat**.

**A conflict of interest the operator must weigh, and it is not disqualifying:** Sarvam ranks
first on these benchmarks, and Sarvam is a **co-author of the second one**. *Voice of India*, the
one with the headline numbers, is **not** Sarvam's — it is AI4Bharat and Josh Talks — so the
ranking does not rest on the vendor's own paper. But the operator should know the field is small
and the same names recur.

**Word Error Rate, from *Voice of India* (lower is better):**

| System | Hindi WER | Average across 15 Indian languages | Source of the claim |
| --- | --- | --- | --- |
| **Sarvam Audio** | **5.0%** | **Best on 13 of 15 languages** | Published benchmark, not the vendor |
| **Google Gemini 3 Pro** | **6.0%** | ~14.1% | Published benchmark |
| Microsoft Speech-to-Text | 11.4% | ~26.9% | Published benchmark |
| AssemblyAI Universal | 19.3% | Highly variable; **exceeds 100%** on some languages | Published benchmark |
| **OpenAI GPT-4o Transcribe** | **33.9%** | **~64.2%** | Published benchmark |

The paper's own summary: *"most models exceed a WER of 20… and no system meets this criterion
consistently across all languages"*, and even the best struggles on Bhojpuri and Maithili.

**And on Hinglish specifically — the number that matters most for a detailing conversation.**
`docs/mr-app-plan.md` §0.5 records: **Whisper large-v2 zero-shot on the MUCS Hindi–English
code-switching corpus: 52.0% Mixed Error Rate**, with 42.9% code-switch bigram accuracy, citing
Biswas et al., Interspeech 2025. **I did not independently verify that paper — the figure is the
repository's record, not mine. UNVERIFIED.** It is consistent with GPT-4o Transcribe's 64.2%
average above, which I did verify.

**The practical conclusion: a generic Whisper-class model drops roughly half the words exactly
when the speaker switches language, which in an Indian detailing conversation is constantly.**

## The voice table

| Provider | Quality (Hinglish) | Latency | Cost | Data & privacy | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Sarvam** (Saarika/Saaras STT, Bulbul TTS) | **Best available, on a published third-party benchmark** — 5.0% Hindi WER, best on 13/15 languages. Code-mixing explicitly supported | **UNVERIFIED** | **STT ₹30 per hour** (billed per second). **TTS ₹30 per 10,000 characters** | As the text table: strong public claims, **no retention or training term I could read in the documentation — UNVERIFIED**. On-premise and air-gapped options exist, which would remove the question entirely | **RECOMMENDED for voice** |
| **Google** (Cloud STT v2, Cloud TTS) | **6.0% Hindi WER** — the only global system near Sarvam | **UNVERIFIED** | **UNVERIFIED** | **Mumbai (`asia-south1`) IS a listed regional endpoint** for Text-to-Speech, and `asia-south1` is supported for Speech-to-Text v2. **But the documented guarantee reads: *"If you use a regional endpoint, your data at-rest and in-use stay within the regional or continental boundaries of Europe or the USA, respectively."* It names Europe and the USA and not India.** A Mumbai endpoint without the guarantee sentence covering it is precisely the §1 trap | **SHORTLIST, conditional** on Google confirming in writing that the guarantee extends to `asia-south1` |
| **Microsoft / Azure Speech** | 11.4% Hindi WER; and `docs/mr-app-plan.md` §0.5 records it as **unsupported for 6 of 15 languages** (repo record, **UNVERIFIED** by me) | **UNVERIFIED** | **UNVERIFIED** | Same unanswered India question as Azure OpenAI | **NOT SHORTLISTED** |
| **OpenAI / Whisper-class** | **33.9% Hindi, ~64.2% average.** On Hinglish, ~52% MER (repo record) | — | — | Fails residency on inference (see text table) | **ELIMINATED on quality AND on residency.** Either alone would be enough |
| **ElevenLabs and other TTS specialists** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** — no India residency position checked | **NOT ASSESSED.** Named here so its absence is visible rather than implied |

---

# 5. COST — against the approved budget of about $10–40 a month

**Every number below is arithmetic on stated assumptions. Change an assumption and the answer
changes; the assumptions are the argument.**

**Assumptions, all of which the operator should correct if wrong:**

| Assumption | Value | Status |
| --- | --- | --- |
| Reps using the app | **20** | **ASSUMED** — the real headcount is not in this repository |
| Working days per month | 22 | assumed |
| Product Q&A questions per rep per day | 10 | assumed |
| Tokens per Q&A call | 2,000 in (approved passages + prompt), 300 out | assumed |
| Practice sessions per rep per week | 2, of 10 minutes | assumed |
| Speech rate | ~900 characters per minute | assumed |
| Rupee to dollar | **₹88 = $1** | **UNVERIFIED** — I did not check today's rate |

### Text — Product Q&A fits the budget comfortably

20 reps × 10 questions × 22 days = **4,400 calls/month** → 8.8M input tokens, 1.32M output tokens.

**On Sarvam 105B Chat**, at the published ₹29.28 / ₹73.2 per million:

- input 8.8 × ₹29.28 = **₹257.66**
- output 1.32 × ₹73.2 = **₹96.62**
- **total ≈ ₹354 per month ≈ $4.0**

**That is an order of magnitude inside the $10–40 budget**, and it would still fit at roughly
three times the assumed volume. **Product Q&A, MR Chat and the learning tutor are affordable.**

**Bedrock and Vertex per-token rates at India-region pricing: UNVERIFIED.** I did not retrieve
them, so I cannot say whether they also fit — only that the cheapest verified option fits easily.

### Voice — does NOT fit, and this is the finding

Same 20 reps, 2 sessions of 10 minutes a week = **1,600 minutes a month of speech in**, and
roughly the same of speech out.

**On Sarvam's published rates:**

- **Speech in:** 1,600 min ÷ 60 × ₹30 = **₹800 ≈ $9.1**
- **Speech out:** 1,600 min × 900 chars = 1,440,000 chars → 144 × ₹30 = **₹4,320 ≈ $49.1**
- **plus the model turns**, not counted here
- **≈ $58 a month, before the LLM, at 20 reps**

**Two things follow and both matter.**

1. **Voice practice alone exceeds the entire approved budget**, on the **cheapest** verified
   vendor, at a modest 80 minutes per rep per month. The text-to-speech half is **five times** the
   speech-to-text half — the synthetic doctor talking is what costs.
2. **It scales linearly with reps and with minutes.** At 100 reps it is roughly $290/month; at 20
   reps practising twice as much, roughly $116. **There is no volume at which this fits $10–40.**

**So the budget question is not "which vendor" — it is whether voice practice is funded at all.**
That is a decision for the operator and it was not in `R10`.

---

# 6. RECOMMENDATION — TEXT

**Use AWS Bedrock in the India geography (`ap-south-1`), and put Sarvam's text model beside it as
the cost and Indic-language option once its written terms are in hand.**

**Why, in two sentences.** Bedrock is the only candidate whose own documentation states both
halves of the requirement — inference routed *only* within India, and zero data retention by
default — while OpenAI direct explicitly fails on inference and Azure's India question was asked
publicly and left unanswered. Sarvam is cheaper, Indian, and the strongest on Indian languages,
but **its retention and training terms are not in any documentation I could read**, and a claim in
a marketing summary is not a term.

**The one thing that would change it: Sarvam producing a written no-training and retention term,
or AWS confirming that abuse-flagged content stays in India.** If Sarvam's terms arrive first,
Sarvam becomes the recommendation on cost and quality together. If AWS cannot confirm where
abuse-flagged content goes, Bedrock's advantage narrows to routing alone.

---

# 7. RECOMMENDATION — VOICE

**Sarvam, and voice should WAIT.**

**Why Sarvam if it proceeds.** It is first on a published third-party benchmark it did not write,
at **5.0% Hindi WER against OpenAI's 33.9%**, it supports code-mixing explicitly, it is Indian,
and it is the cheapest verified. No other candidate is close on the one axis — Hinglish — that
decides whether a practice conversation is usable at all.

**Why it should wait, and this is the stronger half.**

1. **It is not funded.** ≈$58/month at 20 reps against a $10–40 budget, on the cheapest vendor,
   before the model turns. That is a funding decision, not a vendor decision.
2. **It has nothing to run on.** `AI-SPEC.md` records that AI Doctor — the persona store, the
   scenario store, the session, the screen — **does not exist**. Voice is an input method for a
   feature that has not been built.
3. **An employee's recorded voice is the payload**, and the employee-notice question that raises
   is the same class as register `#20`, which is deferred and unanswered.

**So: choose the text vendor now, and revisit voice when AI Doctor exists and voice has a budget.**
Nothing is lost by waiting — the gateway's `TranscriptionProvider` and `SpeechSynthesisProvider`
interfaces already exist and are vendor-neutral.

---

# 8. WHAT MUST BE SIGNED BEFORE ANY REAL PROMPT IS SENT

**None of this is engineering. All of it is a signature, and no prompt containing real company
content should be sent to any vendor until it exists.**

| # | The term | Why it is not optional |
| --- | --- | --- |
| 1 | **No training on our data**, in the contract, not the FAQ | A default can change; a term cannot. OpenAI's default is good and is still a default |
| 2 | **Retention: what is kept, for how long, and WHERE** — explicitly including anything an abuse or safety system retains | This is the gap in the strongest candidate. Bedrock's ZDR has a named exception and does not say where that copy lives |
| 3 | **The sub-processor list**, and notice before it changes | An Indian provider with a non-Indian sub-processor fails the requirement without ever saying so |
| 4 | **In-region inference, in writing** — not "designed to", and covering capacity and fallback routing | Exactly what Microsoft's public Q&A declined to confirm |
| 5 | **A DPDP-appropriate data processing agreement**, naming the controller | The residency rule exists to serve this |
| 6 | **For voice: an employee-voice term**, and the notice employees are given | Their voice is personal data about an identifiable person |

**Who signs.** The same unanswered question as register `#18` — **this project has no named
signatory for data-protection commitments**, and `C29` deferred that item for *real doctor* work.
**It is not deferred for this**: a vendor contract needs a signatory whether or not a doctor is
ever recorded. **This is the one item in this document that the operator must resolve about their
own organisation rather than about a vendor.**

---

# 9. THE UNVERIFIED LIST — 17 cells

**Listed together because a decision can trip over a gap it did not notice.**

**Material to the recommendation (5):**

1. **Whether AWS's abuse-flagged content leaves India.** The exception is documented; its location
   is not. *The single most important gap here.*
2. **Whether AWS Bedrock uses customer data for training.** Not addressed on the page I read.
3. **Sarvam's retention terms for the hosted API.** Absent from its pricing documentation.
4. **Sarvam's no-training term.** Appears in third-party summaries, not a vendor page I could read.
5. **Whether Google guarantees in-region ML processing at `asia-south1`.** Its Text-to-Speech
   guarantee sentence names only Europe and the USA; I could not retrieve the Vertex AI
   data-residency page at all.

**Cost (4):**

6. Bedrock per-token rates at India-region pricing.
7. Vertex AI / Gemini per-token rates.
8. Azure OpenAI rates.
9. **The rupee–dollar rate used throughout (₹88 = $1).**

**Latency (5):** 10–14. **Not one candidate's in-region latency has been measured by us** —
Bedrock, Sarvam, Google, Azure, self-hosted. Latency is one of the four criteria `R10` named and
it is the one this document cannot answer at all, because measuring it needs an account.

**Quality and coverage (3):**

15. Bedrock text quality — no independent benchmark of our own.
16. The Whisper 52% Hinglish MER figure — the repository's record, not verified by me.
17. Azure Speech's "unsupported for 6 of 15 languages" — the repository's record, not verified.

**Not assessed at all:** ElevenLabs and other TTS specialists; Krutrim, Reverie, Gnani and other
Indian vendors. Named so their absence is visible.

---

# Sources, with the date read

All read **28 September 2026**.

- AWS — [Introducing OpenAI models on Amazon Bedrock for in-country inferencing in India](https://aws.amazon.com/blogs/machine-learning/introducing-openai-models-on-amazon-bedrock-for-in-country-inferencing-in-india/), published **27 August 2026**
- OpenAI — [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- Microsoft Q&A — [Clarification on India-Only Data Residency for Azure OpenAI](https://learn.microsoft.com/en-in/answers/questions/5664854/clarification-on-india-only-data-residency-for-azu), dated **16 December 2025**, and an **AI-generated answer**
- Google — [Specify a regional endpoint, Cloud Text-to-Speech](https://docs.cloud.google.com/text-to-speech/docs/endpoints)
- Sarvam — [API pricing](https://docs.sarvam.ai/api/getting-started/pricing) and [sarvam.ai](https://www.sarvam.ai/)
- [Voice of India: A Large-Scale Benchmark for Real-World Speech Recognition in India](https://arxiv.org/html/2604.19151v2), arXiv 2604.19151v2, **24 May 2026**
- [Indic DiarBench](https://arxiv.org/html/2607.23808), arXiv 2607.23808, Interspeech 2026
- Repository record, not independently verified: `docs/mr-app-plan.md` §0.5
