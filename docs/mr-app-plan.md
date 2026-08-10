# MR App — Plan, Architecture & Tech Stack

**v1.0 · 6 August 2026 · MR app only. Patient app planned separately.**
Supersedes the commercial half of `elmiron-master-plan.md`.

> Regulatory research, not legal advice. Items marked ⚠️ need qualified counsel before build.

---

# 0. FIVE FINDINGS THAT CHANGE THE BRIEF

## 0.1 Apple will probably reject this app. This is the #1 project risk.

App Store Guideline **2.5.4** governs background modes. Apple has repeatedly rejected background-location apps whose purpose is workforce tracking. Verbatim App Review feedback, from two separate documented cases:

> *"…your app uses location background mode for the sole purpose of **tracking employees, which is not appropriate on the App Store**."*

> *"…we are unable to locate any features besides employee tracking that require persistent location. **Using the location background mode for the sole purpose of tracking employees is not appropriate.**"*

In the first case the workers were **independent contractors, not employees**, and the app *also* had invoicing and payment features. Apple rejected it anyway, across multiple appeals. **No documented successful resolution exists.** *[High confidence on the rejection pattern — multiple independent cases with verbatim Apple text. Medium on whether mitigations work — nobody has published a confirmed approval.]*

**This must shape the product from day one, not be discovered at submission.**

Mitigations, in order:

1. **Build the app MR-first, not employer-first.** Background location must deliver visible benefit *to the person holding the phone*: automatic check-in with no manual entry, auto-computed mileage for expense claims, next-nearest-doctor routing, an MR-visible daily route log.
2. **Prefer geofencing and significant-location-change over continuous background updates.** Better for App Review, dramatically better for battery, and it gets you 90% of the accountability.
3. **Demo the MR benefit in review notes** — never the manager dashboard.
4. **Have a foreground-only iOS fallback ready** so a rejection does not block launch.

Android is far more permissive but needs a Play Console background-location declaration and a prominent-disclosure flow.

## 0.2 One-party consent is not a defensible design in India

There is no Indian statute criminalising recording a conversation you are party to. That is not the point.

- Under **DPDP Act 2023 s.3**, there is **no B2B or professional-capacity exemption**. A doctor recorded in practice is a **Data Principal**. *[High confidence]*
- **s.6(1)**: consent must be *"free, specific, informed, unconditional and unambiguous with a clear affirmative action"* and *"limited to such personal data as is necessary for such specified purpose."* *[Verified]*
- **s.6(4)**: withdrawable at any time, with ease comparable to giving it.
- Multiple High Courts have held non-consensual recording infringes Article 21 privacy.
- **UCPMP 2024 Clause 4.3**: an MR *"must not employ any inducement or subterfuge to gain an interview."* Covertly recording a consultation is arguably obtaining the interview by subterfuge. *[Argument, not a decided point.]*

**So the doctor's consent must be captured in-app, on the record, before capture starts** — a tap-to-consent screen the MR shows the doctor, timestamped and logged, with a withdrawal route.

## 0.3 Recording a consultation captures patient data — a minimisation breach by design

This is the finding I most want you to sit with.

Doctors talk about cases. *"I have a patient who…"* An always-on microphone in a consulting room **necessarily** captures data outside the stated purpose.

- A patient mentioned identifiably is **also a Data Principal**, processed with no consent, no notice and no lawful basis. None of the DPDP s.7 legitimate uses fit — s.7(f)/(g) cover medical *emergency* and epidemic response, not incidental sales-call capture. *[High confidence]*
- **You cannot cure this with a broader consent clause.** s.6(1) caps collection at what is *necessary* regardless of what anyone agreed to, and Rule 3(b) requires an **itemised** description of data collected. You cannot itemise data you did not intend to collect.
- It also induces the doctor to breach their own patient-confidentiality duty under the medical ethics code — a relationship risk quite apart from your liability.

**Design consequence, non-negotiable:** automated PII/PHI redaction sits between transcription and everything else. The LLM never sees an unredacted transcript. This is a pipeline stage, not a policy.

## 0.4 Your recording archive creates a legal adverse-event screening duty

**Confirmed from the primary source.** Indian Pharmacopoeia Commission, *Pharmacovigilance Guidance for MAHs*, v2.0 (18 Jan 2024):

> **§2.2.1.5** — *"MAHs should regularly screen relevant websites or digital media (including newspapers) or social media **under their management or responsibility** for potential reports of Adverse Events."*

> **§2.8** — *"All Serious Adverse Events must be reported by MAH **within 15 calendar days** of receipt of information from any source."*

Your app is digital media under the company's management. It records doctors discussing drugs. **You cannot record and then not look.**

Worse — **§2.6** requires a valid case report to have an **identifiable patient**. **§2.2.1.6** classes organised data collection systems including HCP surveys as *solicited* reports, which carry higher causality-assessment expectations than spontaneous ones.

**So §2.6 (you need an identifiable patient to file) directly contradicts DPDP minimisation (you must not retain one).** These pull in opposite directions. This must be resolved deliberately, in writing, with PV and privacy both signing off, **before** the recording feature ships. It is not an engineering decision.

## 0.5 The obvious speech vendors fail badly on Indian languages

Independent peer-reviewed 2026 benchmarks — *Voice of India* (AI4Bharat/IIT Madras, Interspeech 2026) and *Indic DiarBench*:

| System | Hindi WER | Note |
|---|---|---|
| **Sarvam Audio** | **5.0%** | Best on 13 of 15 languages |
| Gemini 3 Pro | 6.0% | Only global system at parity |
| OpenAI GPT-4o Transcribe | — | **~55%+ average across Indian languages** |
| GPT-4o Mini Transcribe | — | Gujarati **295.9%** — catastrophic |
| AssemblyAI Universal | — | Malayalam / Telugu **>100%** |
| Azure STT | — | **Unsupported for 6 of 15 languages** |

And on Hinglish specifically — the single most important number here:

> **Whisper large-v2 zero-shot on the MUCS Hindi-English code-switching corpus: 52.0% Mixed Error Rate**, with only 42.9% code-switch bigram accuracy. Whisper *"often leads to deletions when a switch to a different language occurs."* *(Interspeech 2025, Biswas et al.)*

**Generic Whisper-class models drop roughly half the words at exactly the moments that matter.** If you were planning to use Whisper or OpenAI for Hinglish, that plan does not work.

---

# 1. THE SPLIT

Two apps, two codebases, two data domains, one shared design system.

| | **MR App** *(this document)* | **Patient App** *(separate plan)* |
|---|---|---|
| Users | MR · MR Manager · Admin | Patient · Doctor · PV Officer |
| Domain | Commercial | Clinical |
| Contains patient PII | **Never** | Yes, under consent |
| Data store | Commercial DB | Clinical DB |
| Shared | Auth, design tokens, audit log pattern, AE routing endpoint | |

**The two systems connect at exactly two points:**

1. **Anonymised aggregates**, one-way, clinical → commercial, suppressed under 5 patients.
2. **The AE routing endpoint**, one-way, commercial → clinical PV queue. When the MR app's transcript pipeline detects a possible adverse event, it hands it to the same human PV queue the patient diary feeds. **It never handles it itself.**

Splitting the apps does not weaken the compliance boundary — it hardens it. The MR app has no read path into clinical data at all.

---

# 2. "REQUIRED ON EVERY VISIT" — WHAT THAT CAN ACTUALLY MEAN

You chose recording required on every visit. There is a problem with the literal version, and it is not a legal technicality.

**You cannot compel a third party's consent.** The doctor is not your employee. The system cannot force them to agree. So "required" can only mean one of two things:

| Interpretation | Result |
|---|---|
| **Required to RECORD** | An MR whose job depends on producing a recording, facing a doctor who says no, has three options: lose the visit, argue with the doctor, or **record covertly and tick the consent box**. At scale, some will choose the third. You have then built a system that manufactures unlawful recordings and false consent records — and logs them, with timestamps, on your own servers. |
| **Required to ASK** *(recommended)* | The MR must always ask, and must always log the outcome. If the doctor declines, the visit proceeds normally, is **not penalised**, and the MR files a voice note instead. |

**Build it as required-to-ask.** Concretely:

- The consent step is **mandatory and non-skippable** in the visit flow.
- Three logged outcomes: `consented` · `declined` · `not_asked` (with a reason).
- **Declining is not a negative signal** in any MR metric. Say so in the app.
- The **voice note is required on every visit regardless** — that is your universal coaching signal.
- **Consent rate is a manager-visible metric, but it measures the territory, not the MR.** If one doctor always declines, that is information. If one MR has a 100% consent rate and everyone else has 40%, that is a fraud signal, not a performance win.

**The strategic point:** the MR's own voice note gives you most of the coaching value at a fraction of the legal risk. No third-party consent, no patient data from the doctor's mouth, no recording law. Recordings enrich it. They should not be the foundation.

---

# 3. MR APP SCOPE

### Roles
`mr` · `field_manager` · `admin`

### Existing tracking — unchanged
Beat planning · **geofenced check-in/out** (now the primary mechanism, see §0.1) · hybrid work-hours location · call reporting · doctor master · offline-first sync · tracking transparency screen · samples and inputs with UCPMP caps · territory KPIs.

### New — the AI performance layer
Doctor consent capture · in-visit recording · post-visit voice note · transcription · redaction · AE detection · performance analysis · coaching feed · manager review.

---

# 4. THE AI PERFORMANCE PIPELINE

Nine stages. Each guard exists because of a specific finding in §0.

```
1  CONSENT           doctor taps consent on the MR's device
                     → logged: doctor id, timestamp, consent version,
                       outcome (consented / declined / not_asked)
                     → declined or not_asked ends here, visit continues
                            │
2  CAPTURE           record locally, Opus mono ~24-32 kbps
                     → persistent, unmissable in-app red indicator (Apple 2.5.14)
                     → Android FGS shows a non-dismissible notification
                     → hard cap on duration, MR-initiated start/stop
                            │
3  VOICE NOTE        MR records a post-visit note — ALWAYS, consent or not
                            │
4  QUEUE + UPLOAD    encrypted at rest on device, resumable presigned upload
                     → survives an MR being offline for a full day
                            │
5  TRANSCRIBE        Sarvam batch API, diarized, codemix mode,
                     hotword list = your drug + competitor brand names
                            │
6  REDACT   ← the gate that makes everything downstream lawful
                     → strip patient names, ages, phone numbers, IDs,
                       any case-identifying detail
                     → post-ASR fuzzy correction of brand names
                     → ONLY the redacted transcript proceeds
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
7  AE DETECTION                          8  PERFORMANCE ANALYSIS
   any mention of a suspected               LLM assesses the MR's own
   adverse reaction →                       behaviour against a rubric
   HUMAN PV QUEUE, 15-day clock             → never the doctor
   → never AI-triaged                       → never advice or prediction
   → never AI-dismissed                     → cited to transcript spans
        │                                       │
        └───────────────────┬───────────────────┘
                            │
9  COACHING FEED     MR sees their own analysis first
                     manager sees it too, and decides everything
                     → AI never triggers an HR consequence
```

### Why each guard is there

| Stage | Guard | Source |
|---|---|---|
| 1 | Consent logged before capture, withdrawable | DPDP s.6(1), s.6(4) |
| 2 | Visible recording indicator | Apple Guideline 2.5.14 |
| 3 | Voice note independent of consent | Coverage without coercion (§2) |
| 6 | Redaction before storage and before the LLM | DPDP s.6(1) necessity cap, Rule 3(b) itemisation |
| 7 | Human PV queue, SLA clock from ingest | IPC PV Guidance §2.2.1.5, §2.8 |
| 8 | Scores the MR only, never the doctor | UCPMP Cl.8, anti-kickback exposure |
| 9 | Human decides every consequence | DPDP s.8(3) accuracy duty; EU AI Act Annex III |

**On audio retention:** you chose a fixed period. Recommendation: **90 days maximum**, auto-purged, with a documented reason. Long enough for an MR to contest a score, short enough to limit breach and discoverability exposure. The redacted transcript persists; the audio does not.

---

# 5. WHAT THE AI ASSESSES

### It does assess — the MR's own observable behaviour

- **Opening** — did they establish purpose in the first 20 seconds?
- **Message accuracy** — were product claims consistent with approved content? *(This is the single highest-value signal: an MR making an unapproved claim is a UCPMP problem, and today nobody would ever know.)*
- **Objection handling** — was an objection raised, and was it addressed or deflected?
- **Question ratio** — talk time vs listen time
- **Call to action** — was a next step agreed?
- **Follow-through** — does the voice note match what the call report says?
- **Content usage** — which approved materials were actually referenced?

### It must never do

| Never | Why |
|---|---|
| Score, profile or characterise the **doctor** | UCPMP Cl.8; anti-kickback pattern |
| Predict prescribing behaviour | Converts commercial data into prescriber targeting |
| Analyse **emotion or voice stress** of the MR | ⚠️ EU AI Act Art. 5 appears to **prohibit** emotion inference in the workplace outright — not high-risk, prohibited. *[Medium confidence — verify the exact scope before anyone proposes this feature.]* |
| Triage, classify or dismiss an adverse event | IPC §2.2.1.5 |
| Trigger any HR consequence automatically | DPDP s.8(3); EU AI Act Annex III |
| Produce a single number with no explanation | Unappealable, and useless as coaching |

### Two design rules that make this survivable

**Every finding cites its transcript span.** "You did not address the pricing objection at 02:14" beats a score of 6/10. Citation is what makes it coachable, contestable, and defensible.

**The MR sees their own analysis before their manager acts on it**, and can attach a written response. That single feature converts the system from surveillance into coaching in the field's perception — which is the difference between adoption and sabotage.

### EU AI Act — read this before any EU ambition

Annex III lists as **high-risk**: AI intended to be used *to monitor and evaluate the performance and behaviour of persons* in work relationships. *[Verified wording.]* If this product ever goes to the EU, it is high-risk AI with conformity assessment, logging, human oversight and transparency obligations. India and the US impose no equivalent ex-ante regime today. Design to the EU standard anyway — it is mostly good governance and it costs little now.

---

# 6. MANAGER VIEW

**Exception-first. Never a wall of everything.**

- Team map: who is where, who is off-plan *(work hours only)*
- Coverage vs beat plan
- **Coaching queue** — MRs whose recent analyses show a repeated weakness
- Per-MR trend, not per-visit score — one bad call is noise
- **Consent-rate anomalies** — flagged as a data-quality signal, not a performance one
- Approvals: call reports, expenses, leave
- Every AI finding opens to the cited transcript span

**Two things the manager view must have:**

1. A visible statement that AI output is **advisory** and the manager decides.
2. An **override log** — when a manager disagrees with an analysis, that is recorded. It is your evidence of genuine human oversight, and your training signal for improving the rubric.

---

# 7. AUTOMATION OPTIONS

### Tier 1 — build in v1, high value, low risk

| # | Automation | Why it earns its place |
|---|---|---|
| 1 | **Auto call-report draft from the voice note** | Kills the 60-second form. The single biggest MR time-saver, and it makes the voice note something they *want* to record. |
| 2 | **Geofenced auto check-in/out** | No manual entry. Also your primary Apple 2.5.4 mitigation. |
| 3 | **Auto mileage and expense from route** | Real money in the MR's pocket. Also an Apple mitigation. |
| 4 | **AE detection → PV queue** | Legally mandatory (§0.4). Not optional. |
| 5 | **Unapproved-claim detection** | Compares spoken claims against the approved content library. Today this is invisible; it is a genuine UCPMP control. |
| 6 | **Brand-name correction after ASR** | Fuzzy-match against your product list. Transcripts are useless if drug names are mangled. |
| 7 | **Missed-visit nudge** | Beat plan vs actual, same day, to the MR not the manager. |
| 8 | **Auto attendance from shift geofence** | Removes a daily chore. |

### Tier 2 — phase 2

| # | Automation | Note |
|---|---|---|
| 9 | **Objection library auto-built from transcripts** | Real objections, real language, fed back as training. Compounds in value. |
| 10 | **Competitor mention extraction** | Which competitor products came up, in what context. Legitimate market intelligence — not patient data. |
| 11 | **Auto-assigned coaching content** | Weakness detected → relevant module pushed. |
| 12 | **Manager 1:1 brief** | Auto-generated pre-read before a coaching conversation. |
| 13 | **Next-best-doctor routing** | Coverage gaps + travel time. Also an Apple mitigation. |
| 14 | **Beat plan generation from coverage gaps** | Draft, manager approves. |
| 15 | **Duplicate/fraudulent visit detection** | GPS + audio fingerprint + timing anomalies. Sensitive — needs a written policy and an appeal route. |
| 16 | **Content recommendation per doctor** | Based on what has been shown, not on prescribing behaviour. |
| 17 | **Daily digest for the manager** | One summary, not fifty notifications. |
| 18 | **Team-wide training gap analysis** | Aggregate weakness patterns across the field force. |
| 19 | **Offline queue health monitoring** | Alerts when an MR's device has not synced in N hours. |
| 20 | **Receipt OCR for expenses** | Straightforward, saves real time. |

### Tier 3 — technically possible, I would advise against

| Automation | Why not |
|---|---|
| Doctor sentiment or receptiveness scoring | UCPMP Cl.8 and anti-kickback exposure. You would be profiling prescribers. |
| Prescribing prediction per doctor | The patient-prescriber linkage problem, in commercial clothing. |
| **MR emotion or voice-stress analysis** | ⚠️ Appears to be a **prohibited practice** under EU AI Act Art. 5 in a workplace context. Also corrosive to trust for near-zero coaching value. |
| Automatic performance action from a score | Removes the human oversight that is your entire defence. |
| Recording without the doctor present *(pre/post-call ambient)* | Collects data with no consent and no purpose. |
| Real-time in-ear coaching during the visit | Interesting, and it turns the MR into a conduit. Adoption and dignity problem. |

---

# 8. TECH STACK

## 8.1 Speech-to-text — the highest-stakes vendor decision

**Primary: Sarvam AI. Challenger: Deepgram Nova-3 `multi`.**

| | Sarvam | Deepgram Nova-3 multi |
|---|---|---|
| Hindi WER *(Voice of India)* | **5.0%** — best of all systems | Not published per-language |
| Indian languages | 22 + Indian English *(Sarvam Audio)* | Hindi, Bengali, Telugu, Marathi |
| Code-mixing | **First-class feature** — 5 output modes incl. `codemix` and romanized | `language=multi`, per-word language tags. Only Western provider with Hindi genuinely inside a code-switch model |
| Diarization | Best-in-class *(Indic DiarBench, 16.0% DER)*, ₹15/hr delta | +$0.0020/min |
| Custom vocabulary | Hotword retention | Multilingual keyterm prompting |
| **India data residency** | **Yes** — plus single-tenant and air-gapped options. ISO 27001, SOC 2 Type II | No India endpoint; self-host is the answer |
| Cost, diarized | **₹45/hr** | ~$0.0125/min all-in |
| Limits | REST caps at 30s — **use the Batch API** (up to 2 hrs/file) | — |

**Do not shortlist:** OpenAI (~55%+ Indic WER) · AssemblyAI (worst on both independent benchmarks despite lowest price) · Azure (unsupported for 6 of 15 languages) · Google Chirp 3 (**no `asia-south1`** — eliminated on residency alone).

**Monthly cost at 100 MRs** — 8 visits/day × 4 min + 1 min voice note, 22 days:

> 4,000 min/day = 66.7 hrs/day × 22 = **1,467 hrs/month** × ₹45 = **₹66,000/month = ₹660 per MR per month**

LLM analysis on top is roughly **1–5% of the transcription bill** — negligible. **Do not optimise this decision on price.** The spread across all vendors is ₹22k–₹124k/month; against Indian MR salaries that is a rounding error. Optimise on accuracy and residency.

### The one thing you must do before committing

**No public benchmark covers clinical pharma Hinglish.** Build a **5–10 hour internally-labelled eval set** of real MR–doctor audio with your actual brand list, and run Sarvam vs Deepgram vs one Indian challenger head-to-head.

**This bake-off is the deliverable that de-risks the whole product.** Budget for it. It is not optional.

## 8.2 Mobile — React Native + Expo, development builds

Not Expo Go. Not native. Flutter is a defensible equal-second if your team knows Dart.

| Need | Choice | Note |
|---|---|---|
| Framework | **React Native + Expo** (dev builds) | Deeper, cheaper JS talent pool in India |
| Background location | **`react-native-background-geolocation`** (Transistorsoft) | **Not `expo-location`** — its own docs concede background location stops on app termination with no auto-restart. Transistorsoft handles motion-triggered restart. Licence $399–999, **Android release builds only**; iOS release needs none. ⚠️ Confirm whether per-bundle-ID and perpetual vs subscription. |
| Audio | **`expo-audio`** with `enableBackgroundRecording: true` | Auto-wires `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, iOS `UIBackgroundMode: audio` |
| Offline sync | **PowerSync** | Actively maintained, production-ready |
| Upload | Presigned URL + persistent queue | Avoid `react-native-background-upload` — unmaintained |
| Push | `expo-notifications` / FCM + APNs | |

**Three things that are hard in *any* framework — not a framework problem:**

1. **Apple 2.5.4** (§0.1). No framework choice affects it.
2. **Background execution after app termination.** Android will not auto-restart on location events. iOS restarts only for geofence events. This is *the* reason to pay for Transistorsoft.
3. **Indian OEM battery killers.** Xiaomi, Oppo, Vivo, Realme dominate the Indian mid-range and aggressively kill background services. You will need per-OEM autostart onboarding screens and it will be a recurring support cost. **No library fully solves this.** Budget support time.

**Good news:** Google's call-recording ban does not apply to you. It targeted third-party *phone call* recording via the Accessibility API. In-person microphone recording remains permitted.

## 8.3 Backend

| Layer | Choice |
|---|---|
| Database | **Supabase Postgres, `ap-south-1` Mumbai**, row-level security |
| Auth | Supabase Auth, three roles |
| Audio storage | Supabase Storage, encrypted, **90-day lifecycle purge** |
| Pipeline | Edge Functions + a queue (transcribe → redact → detect → analyse) |
| LLM | **Provider-abstracted gateway.** Gemini Flash or Sarvam LLM. Cost negligible — pick on quality and residency |
| Manager console | Next.js, shared `packages/core` with the app |
| Audit | Append-only, DB triggers, every access logged |

---

# 9. ARCHITECTURE

See `mr-app-architecture.html`.

Five layers: Channels → Experience → Capture & Consent → AI Pipeline → Data. Two one-way bridges to the Patient app: anonymised aggregates in, AE reports out.

---

# 10. RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Apple rejects under 2.5.4** | **High** | Kills iOS launch | MR-first framing, geofencing over continuous, demo MR benefit, foreground-only fallback ready |
| 2 | **PV / DPDP contradiction unresolved** (§0.4) | High | Legal exposure both ways | Written position signed by PV **and** privacy before the recording feature ships |
| 3 | Redaction misses patient identifiers | Medium | DPDP breach, LLM sees PHI | Redaction is a hard pipeline gate with its own test suite. Sample-audit weekly. |
| 4 | Doctors refuse to be recorded | **High** | Low consent rate | Expected. Voice note is the universal signal. Declining is never penalised. |
| 5 | MRs fake consent to hit a target | Medium | Unlawful recordings at scale | Required-to-**ask**, not required-to-record (§2). Consent rate measures territory, not MR. |
| 6 | Hinglish transcription accuracy insufficient | Medium | AI analysis is noise | The bake-off (§8.1). Do it before committing. |
| 7 | Indian OEM background-kill | **High** | Missing tracking data | Per-OEM onboarding. Budget support. Expect gaps and design for them. |
| 8 | Field-force resistance | **High** | Sabotage, attrition | MR sees own analysis first, can respond. Score never touches pay. Transparency screen. |
| 9 | ⚠️ Emotion analysis proposed by someone | Medium | Possibly prohibited in EU | Written into the "never" list now (§5) |
| 10 | Audio breach | Low | Severe | 90-day purge, encryption at rest and in transit, India residency, no third-party analytics anywhere near it |

---

# 11. WHAT I NEED FROM YOU

**Decisions:**

1. **Required-to-ask vs required-to-record** (§2). I have planned required-to-ask. Confirm or override.
2. **Audio retention period.** I have assumed 90 days.
3. **iOS contingency** — if Apple rejects background location, do we ship iOS foreground-only, or delay?
4. **Who signs the PV/DPDP position** (§0.4)? This needs a named person, not a team.

**Actions:**

5. Commission the **Hinglish bake-off** — 5–10 hours of real MR audio, labelled.
6. ⚠️ Get Indian counsel on the recording design *before* build. Specifically: doctor consent wording, incidental patient capture, and the UCPMP Cl.4.3 subterfuge argument.
7. Confirm the Transistorsoft licence terms.

Once these are settled, tell me and I will split the work three ways.

---

*Legal findings trace to research dated 6 August 2026 with sources and confidence levels. Speech benchmarks are from Interspeech 2026 peer-reviewed papers. Prices are vendor list, retrieved 6 August 2026. Nothing here is legal advice.*
