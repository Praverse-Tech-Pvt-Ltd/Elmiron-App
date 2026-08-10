# Elmiron / PPS Platform — Spend Approval Request

**Requested by:** Maanav Shah (Backend / Release Ops)
**Date:** 10 August 2026
**Project:** MR field-force mobile app — 12-week build, pilot at 100 medical representatives

This is every paid item the project needs across the 12 weeks, when it is needed, and what breaks without it. Costs are taken from the project's technical plan; the INR/USD figures below use the plan's own conversion (~₹88/USD) and should be re-checked against the rate on the day of purchase.

---

## 1. Approve this week — one item, and only because of lead time

> **Decision needed by: Friday, 14 August 2026.**

| Item | Cost | Needed by | Why now |
|---|---|---|---|
| **Apple Developer Program** (organization account) | **$99 / year** | Week 5 | Verification takes days to weeks. This is the only item on the list with a lead time that cannot be compressed. If it is not started by week 3, the week-5 App Store submission probe slips, and everything downstream of it slips with it. |

### The real long pole: a D-U-N-S number

An Apple Developer Program **organization** account requires the company to have a **D-U-N-S number**. If Praverse does not already hold one, obtaining it is itself a multi-day process that sits *inside* the "days to weeks" above — it is not additional to it, but it does consume most of it.

**This is the action item, not the $99.** Before anything else:

1. Check whether Praverse already has a D-U-N-S number.
2. If not, start that application first — the Apple enrolment cannot proceed without it.
3. Then enrol in the Apple Developer Program.

*[High confidence that D-U-N-S is required for an organization account. Current turnaround times should be verified with Apple directly — they are not something I can confirm.]*

**Nothing else needs money this week.** Weeks 1–2 run entirely on free tiers. The $99 is trivial; the calendar is not.

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
| **3** | **Apple Developer Program** — *start the purchase now* | **$99/yr** | Recurring | Frontend |
| 3 | Transistorsoft background-geolocation licence | $399 – 999 | One-time* | Frontend |
| 4 | PowerSync (offline sync) | Free tier | Conditional | Frontend |
| 5 | Google Play Developer | $25 | One-time | Frontend |
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
| **Approve now — by Friday 14 August 2026** | **$99/yr** (Apple Developer Program. Confirm the company's D-U-N-S status first — that, not the fee, is the long pole.) |
| Committed later, one-time | $25 (Google Play) + $399–999 (Transistorsoft, terms pending) |
| Steady-state monthly at 100-MR pilot | ~₹69,000 – 72,000 (~$785 – 815) |
| Contingent, client-dependent | ~$599/mo (PowerSync Team, only if SOC 2 is required) |

---

## 6. Note on figures

All costs come from the project's own technical planning documents (`backend-setup.md` §8–9, `mr-app-plan.md`). They are estimates made during planning, not vendor quotes. The two worth verifying before committing money are the **Sarvam per-hour rate** and the **Transistorsoft licence terms** — those are the largest recurring and largest one-time lines respectively.
