# Elmiron / PPS Platform — Spend Approval Request

**Requested by:** Maanav Shah (Backend / Release Ops)
**Date:** 10 August 2026 · **Revised 14 August 2026**

> ## ⚠️ REVISION — the week-1 ask is WITHDRAWN
>
> **The MR app is Android-only, permanently.** iOS is dropped, there is no week-5
> App Store probe, and App Store Guideline 2.5.4 — previously risk #2 on the
> project — is closed.
>
> **Do not buy the Apple Developer Program. Do not start a D-U-N-S application.**
> If one is already in progress, stop it; nothing else on this project needs it.
>
> Nothing on this list now requires a decision this week. §1 is kept below, struck
> through, so that anyone who saw the original ask can see it was cancelled rather
> than quietly disappeared.
**Project:** MR field-force mobile app — 12-week build, pilot at 100 medical representatives

This is every paid item the project needs across the 12 weeks, when it is needed, and what breaks without it. Costs are taken from the project's technical plan; the INR/USD figures below use the plan's own conversion (~₹88/USD) and should be re-checked against the rate on the day of purchase.

---

## 1. ~~Approve this week~~ — WITHDRAWN 14 August 2026

> ~~**Decision needed by: Friday, 14 August 2026.**~~ **No longer required.**

| Item | Cost | Status |
|---|---|---|
| ~~**Apple Developer Program** (organization account)~~ | ~~$99 / year~~ | **Withdrawn.** The app is Android-only. There is no iOS build, no App Store submission and no week-5 probe. |

### ~~The real long pole: a D-U-N-S number~~ — no longer applicable

**Nothing below this line in §1 is actionable.** It is retained only so the original
reasoning is legible to anyone who received the first version.

#### Original text

An Apple Developer Program **organization** account requires the company to have a **D-U-N-S number**. If Praverse does not already hold one, obtaining it is itself a multi-day process that sits *inside* the "days to weeks" above — it is not additional to it, but it does consume most of it.

**This is the action item, not the $99.** Before anything else:

1. Check whether Praverse already has a D-U-N-S number.
2. If not, start that application first — the Apple enrolment cannot proceed without it.
3. Then enrol in the Apple Developer Program.

*[High confidence that D-U-N-S is required for an organization account. Current turnaround times should be verified with Apple directly — they are not something I can confirm.]*

~~**Nothing else needs money this week.**~~ Still true, and now true of every week
until week 7. Weeks 1–6 run entirely on free tiers.

---

## 2. Recurring costs at pilot scale (100 MRs)

| Item | Monthly | Notes |
|---|---|---|
| Sarvam AI — speech transcription | **~₹66,000 (~$750)** | ₹45/hr diarized × ~1,467 hrs/month. Works out to **₹660 per MR per month**. |
| Supabase Pro | ~$25 + usage | Database, auth, storage, egress. |
| LLM analysis | $10 – 40 | 1–5% of the transcription bill. |
| Audio storage + egress (90-day retention) | Low hundreds of ₹ | |
| **Total** | **~₹69,000 – 72,000 / month (~$785 – 815)** | |

**Transcription is 90%+ of the running cost.** Every other line item is noise by comparison. Two things follow from that:

- Do not spend review time optimising the small lines.
- At ₹660 per MR per month against Indian MR salaries, the unit economics are not a concern at pilot scale — but the figure scales linearly with headcount, so a 1,000-MR rollout is ~₹6.6 lakh/month and *would* warrant a vendor bake-off.

---

## 3. Full schedule — what to expect and when

| Week | Item | Cost | Type | Owner |
|---|---|---|---|---|
| 1 | GitHub | Free tier | — | Maanav |
| 1 | Supabase (Free tier) | ₹0 | — | Maanav |
| 2 | Sarvam AI API account | ₹100 free credits, then ~₹45/hr | Usage | AI/ML |
| ~~3~~ | ~~Apple Developer Program~~ | ~~$99/yr~~ | **Withdrawn — Android only** | — |
| 3 | Transistorsoft background-geolocation licence | $399 – 999 | One-time* | Frontend |
| 4 | PowerSync (offline sync) | Free tier | Conditional | Frontend |
| **5** | **Google Play Developer** | **$25** | One-time | Frontend — now the *only* store account needed |
| 7 | Supabase Pro | ~$25/mo + usage | Recurring | Maanav |
| 8 | LLM provider (Gemini or Sarvam) | ~$10 – 40/mo | Usage | AI/ML |
| 11 | Sentry error tracking | Free tier expected | — | Maanav |

\* **Transistorsoft terms are unconfirmed.** The plan flags an open question: whether the licence is per-bundle-ID, and whether it is perpetual or a subscription. That changes the number materially. Someone should confirm before week 3, not at the point of purchase.

---

## 4. Two items needing a decision, not a payment

**Docker Desktop licensing.** Free for personal use and for small businesses; the paid threshold is **250+ employees or $10M+ annual revenue**. Praverse is almost certainly below both, but this should be confirmed rather than assumed — it is already installed and in daily use across the team.

**PowerSync tier.** Free tier covers the build. The paid Team tier (~$599/month) is only required **if the client demands SOC 2 compliance**. That is a client conversation, and it should happen before week 4 rather than becoming an emergency purchase.

---

## 5. Summary of the ask

| | Amount |
|---|---|
| **Approve now** | **Nothing.** The only time-critical item was the Apple Developer Program, and it is withdrawn. |
| Committed later, one-time | $25 (Google Play) + $399–999 (Transistorsoft, terms pending) |
| Steady-state monthly at 100-MR pilot | ~₹69,000 – 72,000 (~$785 – 815) |
| Contingent, client-dependent | ~$599/mo (PowerSync Team, only if SOC 2 is required) |

---

## 6. Note on figures

All costs come from the project's own technical planning documents (`backend-setup.md` §8–9, `mr-app-plan.md`). They are estimates made during planning, not vendor quotes. The two worth verifying before committing money are the **Sarvam per-hour rate** and the **Transistorsoft licence terms** — those are the largest recurring and largest one-time lines respectively.

---

## 7. Revision log

**14 August 2026 — the Apple Developer Program request is withdrawn.**

The MR app is Android-only permanently. That removes:

- the $99/year Apple Developer Program fee,
- the D-U-N-S number dependency, which was the actual long pole rather than the fee,
- the week-5 App Store submission probe, and
- App Store Guideline 2.5.4 (`mr-app-plan.md` §0.1) as a project risk — it was
  risk #2 and it is now closed rather than mitigated.

**Google Play Developer, $25 one-time, is now the only store account needed**, and
it has no comparable lead time.

Recurring costs in §2 are unaffected: they are transcription, database and storage,
none of which depend on the platform.
