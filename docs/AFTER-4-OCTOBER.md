> **RETIRED 7 October 2026 (W2-G C, `BE-C76`) — not a plan any more; do not re-plan against it.**
> The single list of what the operator asked for is `docs/operator/must-haves.json` — the operator's own
> 2 October text, fourteen items — and the status table in the latest section of `docs/log/backend.md`
> is checked against it in CI (`services/api/scripts/check-status-table.mjs`). This file ordered the work after 4 October and never mentioned LMS.
> Everything below is kept unchanged, as the record of the day it was written.

# 5 October — what to do first, and what each costs

**For the operator. Written 2 October 2026 (W1-T F).** Ordered by how much each one unblocks. The day
counts are **engineering days AFTER the input arrives**, estimated from work already done on this
project — they are estimates, not measurements, and each assumes nothing else goes wrong.

| # | Do this | Unblocks | Engineering days once the input exists |
| --- | --- | --- | --- |
| 1 | **Merge PR #2** (Maanav) | The AI contracts the app's screens wait for; the precondition for the deploy | **½** — merge, CI, then the frontend re-points its local contract copies |
| 2 | **Say go to the production deploy; confirm the paid plan** | Everything "real" becomes real outside a laptop | **½** — `docs/DEPLOY-RUNBOOK.md`, rehearsed; about an hour watched, the rest is checking |
| 3 | **Send the territory and MR sheet (Q-5)** | Reps can sign in | **½** for the first ~6 people, by hand with the runbook's check (step 4) |
| 4 | **Decide who plans a rep's day** (`BE-W139`) — the manager, the admin, or the rep | **A rep sees a visit at all.** Nothing in production creates one today, and this is on no list | **2–4** for the simplest version (an admin enters plans in the console), once decided. **Not estimated more precisely: the decision shapes the work** |
| 5 | **Send the registered legal name (Q-11)** | Consent, and with it voice notes | **½** — the notice is written with it and loaded |
| 6 | **Approve the working hours (Q-8)** — or say the test value stands | Check-in | **under ½** — runbook step 3 |
| 7 | **Finish the second admin (Q-14)** | Every approval: prompts, personas, lessons, product content | **under ½** — runbook step 4, `role = 'admin'` |
| 8 | **The AWS key (Q-1)** | Real AI — see the chain below | **the chain below** |

**Items 1–7 together: about a week of engineering, most of it item 4.** With them, a rep can sign in,
see a planned visit, check in, record consent and a voice note, give samples and write a call report —
in production, with no AI.

---

## Real AI: the chain nobody can shorten

Each step needs the one before it. None can run in parallel with its predecessor.

| Step | Needs | Engineering days |
| --- | --- | --- |
| **a.** The AWS key, with Bedrock model access granted in the India region | Q-1. AWS's own approval of model access is not in our hands — **not estimated** | — |
| **b.** The adapter, worked through `docs/ai-platform/KEY-DAY-CHECKLIST.md` | a | **1** |
| **c.** The first real calls, debugged — the checklist predicts thirteen failures; the log now tells a refusal from a vendor error | b | **1–2** |
| **d.** A prompt written for each of the five features | c (a prompt is tuned against real answers, not the stub's) | **2–3** |
| **e.** Each prompt **approved by a second admin** | d and **Q-14** | **½** if Q-14 exists; **the chain stops here if it does not** |
| **f.** The app's AI screens switched from sample data to the real gateway | e, and PR #2 merged | **2–3** (frontend) |
| **g.** Deployed and smoke-tested | f, and the deploy (item 2) | **½** |

**End to end: about 7 to 10 working days after the key arrives — two weeks of calendar time — if Q-14
already exists and no step goes badly.** Product Q&A additionally needs approved product content
(Q-9), which is content work of its own.

**Plainly: real AI in a rep's hands is weeks away, not days.** The earliest it could start is the day
the key arrives; nothing before that day shortens it.

## Not on this page, on purpose

Maps (Q-2), notifications (Q-3), live tracking (Q-12, deferred first), voice practice and AI drafting
wait on inputs or decisions not yet made, and each comes after real AI or alongside it. They are in
`docs/4-OCTOBER.md` under CANNOT BE READY.
