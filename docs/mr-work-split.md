# MR App — Work Split

**v1.0 · 6 August 2026 · Frontend · Backend · AI/ML**
Scope: MR app only. Patient app is a separate project.
Reads with `mr-app-plan.md`, `mr-app-design-plan.md`, `mr-app-architecture.html`.

---

# 0. TWO THINGS TO FIND OUT EARLY

Both of these can kill significant parts of the product. Both are cheap to test now and ruinous to discover in week 10. **They are the first thing I want scheduled.**

## 0.1 The Hinglish transcription bake-off — weeks 1–2

**If real MR–doctor Hinglish transcribes at 40% word error rate, the entire AI layer produces noise and should be cut.**

No public benchmark covers clinical pharma Hinglish. The evidence we have says generic Whisper-class models drop roughly half the words at code-switch points, and that Sarvam is best-in-class at 5.0% Hindi WER on unscripted speech — but neither number is about *your* audio, *your* accents, or *your* drug names.

**AI/ML's first deliverable is the answer.** 5–10 hours of real labelled MR audio, Sarvam vs Deepgram vs one Indian challenger, with your brand list as hotwords. Result by end of week 2.

Finding out in week 2 costs two weeks of one person. Finding out in week 9 costs the project.

## 0.2 The Apple probe — weeks 5–6

Apple has repeatedly rejected background-location apps for *"tracking employees, which is not appropriate on the App Store."* No documented successful resolution exists.

**Do not wait until week 12 to find out.** Submit a TestFlight build with background location and the MR-benefit features visible — auto check-in, mileage, route — in week 5 or 6, with review notes and a demo video showing the MR benefiting. You are buying information, not shipping.

If it comes back rejected, you have six weeks to build the foreground-only fallback. If you find out in week 12, you do not.

---

# 1. LOAD ANALYSIS

Unlike the full platform, a discipline split **actually balances on this app** — it is AI-heavy by nature, so the AI/ML role has real work from week one without inventing any.

| Role | Share | Tasks | Shape of the work |
|---|---|---|---|
| **Backend** | ~36% | 34 | Steady weeks 1–12. Densest at weeks 7–9 (audio storage, pipeline orchestration, AE routing). |
| **Frontend** | ~35% | 33 | Steady, with two hard weeks: week 6 (consent handoff) and week 10 (coaching feed). |
| **AI/ML** | ~29% | 28 | Front-loaded by the bake-off, then continuous. No idle stretch. |

**95 tasks over 12 weeks, 3 people = 2.6 tasks per person-week.** Aggressive but achievable, assuming the two probes in §0 come back clean.

---

# 2. TIMELINE

**12 weeks. Target 30 October 2026.**

Be clear with the client about what that date now means: **the MR app only.** Splitting into two apps did not make the total work smaller. The patient app is a separate project with its own timeline, and 30 October does not cover it.

| Wk | Phase | Backend | Frontend | AI/ML | Gate |
|---|---|---|---|---|---|
| **1** | Foundations | Monorepo, CI, Supabase Mumbai, auth + 3 roles, **publish types (I1)** | Expo + Next.js scaffolds, token pipeline | **Bake-off harness, collect + label eval audio** | |
| **2** | Foundations | Schema, RLS, audit log, consent ledger, **mock server (I2)**, RLS test suite | Shell nav, component wiring, mock connection | **Run bake-off. Vendor decision + transcript schema (I3)** | **G0** |
| **3** | Field core | Doctor/territory/beat APIs, geofence check-in API with work-hours enforcement | Onboarding: permission rationale + per-OEM battery setup | Brand-name correction, hotword list | |
| **4** | Field core | Offline sync protocol, conflict resolution | Home/Today, beat plan, doctor list & profile | **Redaction engine v1** | |
| **5** | Field core | Manager APIs, approval hierarchy, mileage computation | Geofence arrival, check-in/out, shift start/end, sync queue UI, offline states | Redaction test suite + adversarial eval | **G1** · **Apple probe** |
| **6** | Consent | Consent capture API, versioning, ledger immutability | **Consent handoff screen** + declined path | **AE detection** — rules + LLM hybrid, recall-optimised | |
| **7** | Recording | Audio storage, encryption, 90-day lifecycle, resumable upload, queue API | Recording UI + persistent indicator, voice note capture | AE detection eval — **a false negative is a missed legal deadline** | **G2** |
| **8** | Pipeline | Pipeline orchestration: queue, retries, dead-letter. Transcription job API | Call report (auto-drafted), samples & inputs, mileage & expenses | LLM gateway, provider abstraction, analysis rubric prompts | |
| **9** | Pipeline | **AE routing to PV queue, SLA timer, redaction gate enforced in the storage layer** | Tracking transparency, settings — language, WiFi-only, data usage | **Analysis engine — findings with transcript citations (I5)** | **G3** |
| **10** | AI + coaching | Analysis storage, override log API, coaching feed API | **Coaching feed, analysis detail, respond to a finding** | Output guard, unapproved-claim detection | |
| **11** | Manager | Admin APIs, break-glass, retention config, security hardening | Manager console: dashboard, coaching queue, analysis review, override | **Red-team**, coaching content, manager digest | **G4** |
| **12** | Ship | Pen test remediation, backup/restore, pilot ops, monitoring | Admin console, accessibility + sunlight audit, pilot fixes | Analytics, pilot dashboards, cost monitoring | **G5** |

---

# 3. GATES

The reviewer runs every one personally. Never accept a passing report.

| Gate | Wk | Owner | Passes when |
|---|---|---|---|
| **G0** | 2 | BE + AI | MR and Manager tokens are permission-denied on every restricted path. Audit log rejects UPDATE/DELETE. **And the bake-off has a written vendor decision with measured WER on real audio.** |
| **G1** | 5 | BE + FE | One territory runs a full simulated day offline and syncs clean. No lost writes, no duplicates. Location capture visibly stops at shift end. |
| **G2** | 7 | FE + BE | Consent captured, logged, versioned, withdrawable. **Declined path produces no negative signal anywhere.** Voice note fires on every visit regardless. Recording indicator unmissable. Audio uploads and resumes after a killed connection. |
| **G3** | 9 | AI + BE | **Redaction gate: seed 50 transcripts with patient identifiers. Zero reach storage or the LLM.** AE detection recall measured against a labelled set. AE routes to the PV queue with the clock starting at ingest. |
| **G4** | 11 | AI | Red-team: two independent testers fail to make the AI give advice, predict, score the doctor, reach a patient surface, or produce an uncited finding. |
| **G5** | 12 | BE | Clean pen test on high findings. Restore performed from backup, witnessed. Retention purge verified on real data. |

---

# 4. INTERFACE CONTRACTS

| # | Contract | Owner | Consumers | Due | If it slips |
|---|---|---|---|---|---|
| **I1** | Typed API contract — `packages/core` types + Zod | Backend | FE, AI | **End W1** | Frontend cannot start |
| **I2** | Mock server with realistic fixtures | Backend | Frontend | **End W2** | Frontend blocked for the whole project |
| **I3** | **STT vendor decision + transcript schema** | AI/ML | BE, FE | **End W2** | Backend cannot design the pipeline. Highest-consequence contract in this project. |
| **I4** | Redacted-transcript schema | AI/ML | Backend | End W6 | Storage layer cannot enforce the gate |
| **I5** | Analysis contract — finding shape, citation format, refusal cases | AI/ML | Frontend | **End W8** | Coaching feed built against a moving target |

**No interface changes silently.** Breaking changes get announced in writing before they land.

---

# 5. 🔵 BACKEND

**Owns:** monorepo, CI/CD, DevOps, Supabase (Mumbai), auth, RBAC, audit log, consent ledger, all APIs, offline sync, geofence enforcement, audio storage and lifecycle, resumable upload, pipeline orchestration, AE routing, admin, security, app-store release ops.

### Your five non-negotiables

1. **Permission denied, not an empty result.** Enforce in row-level security. An empty list means the filter is in application code, and application code changes.
2. **The consent ledger is immutable.** Withdrawal is a new row, never an update. Every consent record carries the version of the text that was shown.
3. **The 90-day audio purge actually runs.** Configure the lifecycle rule in week 7 and test it in week 12 with real data. A retention policy that has never fired is not a retention policy.
4. **The redaction gate is enforced at the storage layer, not just in the pipeline.** If an unredacted transcript can be written to durable storage by any path, the gate is decorative.
5. **The AE SLA clock starts at ingest.** "Receipt" means the moment it lands on your server, not the moment a human reads it. 15 calendar days for a serious event.

### Your densest stretch: weeks 7–9

Audio storage plus resumable upload plus pipeline orchestration plus AE routing, back to back. This is where the schedule breaks if it breaks. Flag slippage at the week-6 checkpoint, not week nine.

### Watch out for

- **Resumable upload from a bad connection** is harder than it looks. Presigned URL plus a persistent queue. Avoid `react-native-background-upload` — unmaintained.
- **Pipeline retries need a dead-letter path.** A transcription job that fails silently is a visit that never gets coached and an AE that never gets seen.
- **Audio egress costs money.** Watch it from week 7, not week 12.

---

# 6. 🟢 FRONTEND

**Owns:** Expo app (MR), Next.js consoles (Manager, Admin), design-token consumption, every screen and state, offline UI, recording UI, consent handoff, coaching feed, accessibility, app-store submission.

### Your three non-negotiables

1. **Never implement permission logic in the client.** If the API returns something it shouldn't, that is a backend bug — report it, do not filter it away.
2. **On the consent screen, Allow and Decline are visually equal weight.** A grey no beside a green yes is a dark pattern, and under DPDP a dark pattern means consent was not freely given — which collapses the legal basis for the entire recording feature. This is not a style question.
3. **Offline is a normal state**, designed deliberately, never styled as an error. The sync queue is visible and countable on every screen.

### Your two hard weeks

**Week 6 — the consent handoff.** A device-handoff pattern: the MR hands their phone to a doctor with no account, mid-consultation, with five seconds of attention. It must be legally sufficient, readable in five seconds, and genuinely easy to decline. Design produces three variants; you build the one that tests best. **Budget time to test with five real doctors.**

**Week 10 — the coaching feed.** This surface decides whether MRs adopt or sabotage the app. Every finding cites a tappable transcript span. Every finding has a reply affordance on the card. The MR sees their analysis before the manager acts, and the UI says so. **No composite score, no leaderboard, ever.**

### Watch out for

- **Indian OEM battery killers** — Xiaomi, Oppo, Vivo, Realme kill background services and no library fully solves it. The per-OEM onboarding screens in week 3 are real work, and support cost afterwards is permanent.
- **The Apple probe in week 5** is yours to prepare: review notes, demo video, MR-benefit framing. Do not lead with the manager dashboard.
- **Sunlight.** Test outdoors on a real mid-range Android at 50% brightness. Cream grounds and light type fail there.

---

# 7. 🟣 AI/ML

**Owns:** the bake-off, transcription integration, brand-name correction, the redaction engine, AE detection, the LLM gateway, the analysis engine, output guard, eval harnesses, red-teaming, analytics and cost monitoring.

### Your first deliverable decides the product

**The bake-off, weeks 1–2.** Collect and label 5–10 hours of real MR–doctor audio. Run Sarvam vs Deepgram Nova-3 `multi` vs one Indian challenger, with the real drug brand list as hotwords. Measure WER overall, WER on brand names specifically, and diarization accuracy.

Then say plainly what the number is. **If it is bad, say so and recommend cutting the AI layer.** That is a good outcome delivered in week 2. It is a catastrophe delivered in week 9.

### Your four non-negotiables

1. **The redaction gate is yours and it is the one that matters.** Patient identifiers must never reach storage or the LLM. Not because of a policy — because an always-on microphone in a consulting room is a data-minimisation breach by design, and redaction is the only thing that cures it. Build it with its own adversarial test suite.
2. **AE detection is tuned for recall, not precision.** A false positive costs a PV officer two minutes. A false negative is a missed 15-day legal deadline. Bias hard toward over-flagging, and say so in the design.
3. **The output guard is a hard filter with tests, not a prompt instruction.** A prompt instruction is a request. A filter is a control. It blocks advice-shaped and prediction-shaped language before anything leaves the gateway — "prediction" is a medical purpose under India's device guidance, and one sentence converts this into a regulated device.
4. **Never send an unmasked identifier to the model provider.** Under the FTC rule an unauthorised disclosure is a reportable breach with no intruder involved.

### The trap

You have the most interesting data in the project and the fewest people looking over your shoulder. The temptation is to build doctor sentiment scoring, prescribing prediction, or voice-stress analysis. **Every one of those converts this product into something different and regulated** — and voice-stress analysis appears to be a *prohibited* practice under EU AI Act Article 5 in a workplace context.

Bring any idea to the reviewer before building it.

---

# 8. HARD BOUNDARIES

### Frontend must never
Implement permission logic in the client · weight the consent buttons unequally · render an AI finding without its citation · show a composite score, leaderboard or peer ranking · style offline as an error · put patient data on any screen · ship a mobile component without a press state.

### Backend must never
Rely on the frontend to enforce access · return an empty list where permission-denied is correct · allow an unredacted transcript into durable storage by any path · let a consent withdrawal mutate the original record · let the AE clock start at triage instead of ingest · ship a retention rule that has never actually fired.

### AI/ML must never
Send an unmasked identifier to a provider · produce advice- or prediction-shaped output · triage, classify or dismiss an adverse event · score, profile or characterise the doctor · emit a finding with no traceable transcript span · build a new intelligence feature without asking first.

---

# 9. RISKS

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | **Hinglish WER too high — AI layer produces noise** | Medium | **Critical** | Bake-off in weeks 1–2. Decide early. Cut the layer if the number is bad. | AI/ML |
| 2 | **Apple rejects under 2.5.4** | **High** | High | Probe in week 5. Foreground-only fallback ready by week 8. | Frontend |
| 3 | Doctors refuse to be recorded | **High** | Medium | Expected. Voice note is the universal signal. Declining is never penalised. | — |
| 4 | Redaction misses identifiers | Medium | **Critical** | Own adversarial test suite. G3 seeds 50 transcripts. Weekly sample audit after launch. | AI/ML |
| 5 | AE false negative | Medium | **Critical** | Tune for recall. Measure against a labelled set at G3. | AI/ML |
| 6 | Backend bottleneck weeks 7–9 | Medium | High | Densest stretch. Flag at the week-6 checkpoint. Consider moving mileage computation earlier. | Backend |
| 7 | Indian OEM background-kill | **High** | Medium | Per-OEM onboarding. Expect gaps and design for them. Permanent support cost. | Frontend |
| 8 | Field-force resistance | **High** | High | MR sees own analysis first and can respond. No score touches pay. Transparency screen one tap from home. | Reviewer |
| 9 | PV/DPDP contradiction unresolved | High | High | Named person from PV and named person from privacy sign a written position **before** week 7. | Reviewer |
| 10 | Audio storage/egress cost overrun | Medium | Low | Monitor from week 7. Opus at 24–32 kbps, not WAV. | Backend |

---

# 10. FIRST WEEK

**🔵 Backend** — Monorepo, CI, Supabase Mumbai, auth with three roles. **Publish `packages/core` types by Friday.** Frontend and AI are both waiting on you.

**🟢 Frontend** — Expo and Next.js scaffolds. Wire the token pipeline from the designer's `design-tokens.json`. Build shells against the types Backend publishes Friday. **Do not build screens yet** — design D2 lands in week 2.

**🟣 AI/ML** — Start collecting real MR–doctor audio today. You need 5–10 hours labelled by end of week 2 and getting real recordings takes longer than anyone expects. Build the eval harness while collection runs.

**Reviewer** — Book the Apple TestFlight probe for week 5 now. Get the PV and privacy sign-off started; it blocks week 7.

---

*Constraints traceable to a legal or regulatory source are documented with citations and confidence levels in `mr-app-plan.md` §0.*
