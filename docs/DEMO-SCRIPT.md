# The demo — a script someone else can follow (rehearsed 2 October 2026, W1-T)

**Built on the frontend's demo path** (`docs/demo-path-2026-10-01.md` on `fe-d17-practice`) and on a
rehearsal of it on 2 October. **What the rehearsal changed is marked ⚠.** It ran the walkthrough's
SERVER half end to end as the seeded rep; it could NOT run the screens — see "What the rehearsal could
not establish" before relying on any step.

## The one sentence to say before anything else

> **"This is the app running against a development server on this laptop, with demonstration data.
> It is not production, and none of these people or doctors are real."**

It is true: production holds 19 of 94 migrations and no reps (`docs/4-OCTOBER.md`). Showing this data
without that sentence would present a laptop as a deployment.

---

## Before the audience arrives — who must have done what

| # | What | Who | Why it matters |
| --- | --- | --- | --- |
| P1 | **Use the laptop that can build the APK.** ⚠ This one cannot: the build pins CMake `3.31.6` and this machine's SDK has only `3.22.1` (`[CXX1300]`, rehearsed). Installing it is a dependency ask. The frontend's laptop built the last demo APK | Dev | No APK, no demo |
| P2 | ⚠ **On a fresh checkout, build the shared packages BEFORE the APK script:** `pnpm --filter "./packages/*" run build`. Without it the bundle fails: `@fieldforce/ui-tokens` … `dist/index.js` — none of these files exist (rehearsed). The script does not do it and does not check | Dev | The documented build fails from a clean clone |
| P3 | The APK is built for the laptop's **current** Wi-Fi address and the phone is on that Wi-Fi. ⚠ The last demo APK was built for `192.168.1.15`; this laptop is `192.168.1.6` — an APK cannot follow a laptop to a new address | Dev | The app reaches nothing |
| P4 | `pnpm db:start`, then **re-seed on the day, after 05:30 IST:** `pnpm --filter @fieldforce/api run seed:day -- --another` (plain `seed:day` refuses once it has run on that database). **Sign in with the account THAT run prints** — every run mints new accounts | Presenter | Visits are dated "today" by the database's date |
| P5 | ⚠ **Do not walk the visit after seeding — or re-seed after you do.** The seed makes three visits today, and **two are already completed**: there is exactly ONE visit to walk. Rehearsed: one practice run leaves all three completed, and Home offers only the next *planned* visit | Presenter | A practised demo arrives with nothing to show |
| P6 | Emulator only: `apps\field\scripts\demo-emulator-location.ps1` running, so check-in gets a position at the seeded clinic | Presenter | Check-in times out after 10 s without it |

## The walkthrough — what to do, what they see, what is true

| # | Do | They see | Say — the true sentence |
| --- | --- | --- | --- |
| 1 | Sign in with P4's account | The sign-in, then the first-run screens | "Real sign-in, against the development server." |
| 2–5 | Location → notifications → battery → "What we record" → **Start my first day** | Permission screens | "These are on the phone; nothing is sent yet. Notifications are asked for but nothing sends them yet." |
| 6 | **Home / Today** | Today's plan, the next visit, the shift window | "Real: pulled from the server. Two of today's visits are already done, so the plan shows a day in progress." (Rehearsed: 3 visits today, statuses `completed, completed, planned`; window `04:00–23:59`, the demo's wide test value) |
| 7 | Open the **beat plan** | Three stops; status **"Submitted — not yet approved"** | "Nothing approves a beat plan in this version — that status is true and permanent for now." |
| 8 | Open the planned visit → microphone prompt | The permission prompt (first visit only) | "Asked once, before the first visit." |
| 9 | **Check in** | Recorded, the stage moves | "Real: written through the sync path and checked by the server." (Rehearsed: `accepted`) |
| 10 | **Consent** → doctor consents | The notice, the answer recorded | "Real: the notice text is the one the server published, and the answer is stored with its version." (Rehearsed: one notice, `en-IN`; `accepted`) |
| 11 | **Samples** → two strips | The entry, and a note that no cap is set | "The sample limit is not configured yet — samples are accepted and not counted, and the screen says so." (Rehearsed: `accepted`) |
| 12 | **Voice note** | Recorded and uploaded | "The audio is stored. **Nothing transcribes it** — there is no transcription service." (Not rehearsed — see limits) |
| 13 | **Check out** | The visit completes | "Real." (Rehearsed: `accepted`, visit `completed`) |
| 14 | **Call report** → submit | Submitted | "Real; a manager would review it." (Rehearsed: `accepted`) |
| 16 | **Day end** | The day's visits and **distance 0.0 km** | ⚠ "**Distance is zero because all the demo clinics are at one address** — on real visits it is measured between check-ins." (Rehearsed: `distance_metres: 0`, `check_in_count` 1. Without this sentence it reads as broken) |

**Step 15 (the offline queue) is left out live** — proven by tests, but turning Wi-Fi off in front of
people risks the rest of the demo on one network toggle.

## What must NOT be shown — and why

| Do not show | Why |
| --- | --- |
| **Coaching, Analysis, Reply** | Hidden by the build. Their content is mock output dressed as a real model's ("gemini", "Written by the system from the transcript"). If a Coaching tab is visible, **the wrong APK is installed** |
| **The assistant / any AI feature** | Not in the demo build. With no AWS key no model is connected, and the local stub answers every question with a refusal — **a working assistant appearing to decline** is a missing credential that reads as a product defect |
| **Practice with the AI doctor** | On the frontend's branch, on SAMPLE data, flag off. A stub conversation shown as practice is exactly the stub-as-answer this project refuses |
| **Maps / "Open in Maps"** | Not built — needs the Google key |
| **Check-in indoors on a real phone, away from the seeded clinic** | Recorded **off-site** and flagged — true, and alarming if unexplained (demo path FE-D11). Use the emulator, or say it before pressing |
| **A second walk of the same visit** | The server records a late or repeated check-in by design (offline replay) without changing the visit — on screen it looks like a visit done twice |
| **Anything said to be "in production"** | It is not. See the sentence at the top |

## What the rehearsal could NOT establish

1. **The screens.** No APK could be built on this laptop (P1, P2), so no screen was seen. Everything
   in the "they see" column is the frontend's documented path; only the "rehearsed" notes were run.
2. **The phone and the network** — the Wi-Fi, the firewall, the LAN address from a real handset.
3. **The first-run permission screens and the OEM battery screens** — device-only.
4. **The voice-note upload** to storage (step 12) — not driven.
5. **The offline queue** live (step 15).
6. **The frontend's own demo APK and laptop** — not inspected; this script assumes the APK at P1 exists
   and was built from `fe-d17-practice` or later with Coaching and the assistant off.
7. **Tomorrow's re-seed** — the data above is today's; P4 makes tomorrow's.
