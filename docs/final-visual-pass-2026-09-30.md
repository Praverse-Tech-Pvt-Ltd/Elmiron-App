# Final visual pass: the demo path, 30 September 2026 (FE-D12)

A walkthrough of every screen in `docs/demo-path-2026-10-01.md`, in order. It was done on the
Pixel_10 emulator (1080×2424) with APK 3 (`8607101`), on a fresh seeded day (`seed:day --another`,
account `demo-1d15cbea-mr`).

- Screenshots, one or more per screen: `C:\dev\demo-screenshots\fe-d12\before\`.
- After the fixes: `C:\dev\demo-screenshots\fe-d12\after\`.

**Severity:**

- **demo-visible:** someone watching would notice it.
- **minor:** visible only if you look for it.

**Outcome:**

- **fix:** fixed in FE-D12, because it is visual or copy only.
- **skip:** changes behaviour, data or meaning, so it is left for a decision. The reason is given.

## How the screens were reached

- First run was already complete on this phone. A2, S4, A3, the battery screen, A9 and A4 were
  opened by deep link (`com.praversetech.fieldforce://onboarding/…`) and viewed. Nothing on them was
  pressed.
- Every other screen was reached by using the app:
  1. sign out, then sign in;
  2. Today → beat plan → the next stop's visit;
  3. check in → consent ("No, don't record") → samples (1 recorded) → voice note (4 s, sent);
  4. check out → call report (sent) → queue → Me → Day end.
- Writes went to the local fixture database only.
- Check-in and check-out used the emulator mock location (the FE-D10 method).

## Issues

| # | Screen (demo step) | What is wrong | Severity | Outcome |
| --- | --- | --- | --- | --- |
| V1 | Every scrolling screen; seen on **Consent** (10) and **Samples** (11) | Scrolled content draws **under the status bar**: the clock sits on top of "May we record this" and on top of the samples "Recorded" banner. `Screen` puts the top inset inside the scrolling content, so it scrolls away | demo-visible | fix |
| V2 | **Home** (6) | The main button's label, "Start the visit to Dr Asha Deshpande (DEMO)", wraps to two **left-aligned** lines. Every other button label is centred | demo-visible | fix |
| V3 | Every screen with a `Button`; plainest on **Voice note** (12) | Buttons sit **6 dp inside** the edges of the cards, fields and hold button around them. On the voice-note card, "Save this note" and "Start again" are visibly narrower than "Hold to record" | demo-visible | fix |
| V4 | **Voice note** (12) | After a note is captured, the caption under "00:04" still says **"hold the button to start"** | demo-visible | fix |
| V5 | **Me** (from 6, where Sign out is) | The screen title "Settings" is drawn at section-heading size. Every other screen title uses `Title` since FE-D7 4, which missed this one | demo-visible | fix |
| S1 | **A9 What we record** (5) | Says **"Right now this app records nothing new about you"**, and marks location, check-ins, voice notes and recordings **"Not yet — this app cannot do this today."** The app records check-ins with position, samples, voice notes and reports today. "Where you are, during your shift — Start day to End day" also contradicts A2's "only when you press check in or check out" | demo-visible | **skip.** It changes what a transparency disclosure says. Its wording is a decision for the operator, and possibly for legal |
| S2 | **A3 Notifications** (3) | Promises "Coaching notes" (Coaching is hidden) and "when a recording you made is confirmed" (recording is off). Nothing in the app sends a notification yet | demo-visible | **skip.** Meaning: which promises the screen makes |
| S3 | **Battery** (4) | A disabled primary-sized placeholder button, **"20-second video — not recorded yet"** | demo-visible | **skip.** It is an honest placeholder for a missing asset. Removing it changes what the screen says will come |
| S4 | **Home** (6) | **"Your list has been rebuilt"** (a full resync notice) appeared on a brand-new account's first sign-in. It pushes the main button half under the tab bar. The pull cursor is per user (`pull-cursor.ts:28`), so why a new account got a cursor refusal is not established. On Thursday's path, a fresh install, no stored cursor exists | demo-visible | **skip.** Sync behaviour, and the cause is unknown |
| S5 | **Samples** (11) | After "Record what I left" at the bottom, the "Recorded — 1 recorded against this visit" banner appears at the **top**, off-screen. The only visible change is the form clearing | demo-visible | **skip.** Showing it needs a scroll change, which is behaviour |
| S6 | **Call report** (14) | After "Report sent", **"Send the report" stays enabled** with the text still in place, so a second press would send a second report | demo-visible | **skip.** Behaviour |
| S7 | **Visit, after check-out** (13) | "Visit finished" shows only "Checked in 12:04", and no check-out time | demo-visible | **skip.** Data: the screen would need a value it does not read today |
| S8 | **Day end** (16) | "Visits: Not available — the day could not be fetched" and "Distance not available" | — | Not a defect: the mock was not running. Covered by the demo document's §3.4 |
| m1 | A2 (2) → A3 (3) | A2's cards have a border and shadow; A3's are flat white. Two consecutive first-run screens | minor | — |
| m2 | Beat plan (7) | The "Next stop" card shows no time; Home shows "Scheduled 13:00" for the same visit | minor | — |
| m3 | Visit (9, 13) | "Dr Asha Deshpande (DEMO)" at display size runs right to the right margin. A longer name would wrap | minor | — |
| m4 | A4 Microphone (8) | The label "Recording a consultation is separate" is followed by body text that says the same thing | minor | — |
| m5 | Visit, check-in (9) | While finding a position, the small white spinner beside "Finding your position…" reads as a stray mark in a still frame. It animates live | minor | — |
| m6 | Samples (11) | The "Packs" label is muted grey while "Kind" and the others are ink. The "Kind" selector has no chevron. Help text runs close to the next label | minor | — |
| m7 | Call report (14) | The help text "What happened, in your words." repeats its label | minor | — |
| m8 | A9 (5) | The subtitle sits tight under the display title compared with the other first-run screens | minor | — |
| m9 | Consent (10) | "Notice DEMO v1 1d15cbea · English · 09ce2467" looks like debug text. It is deliberate: it identifies the notice version shown | minor | — |
| m10 | Visit (9) | The action buttons sit just under the status card rather than low in thumb reach: `spacer` is `flex: 1` inside a `ScrollView`, which does not grow | minor | — |
| m11 | Me (from 6) | Navigation rows ("Mileage", "How today ended") carry a green ✓, which reads as "done" | minor | — |

**Transitions:** every push and back used the one slide transition (FE-D7 3). No stutter was seen.
It was not measured.

**Not exercised:**

- **the queue with items waiting** (step 15, offline). The emulator stayed online, so the queue
  screen was seen only as "Everything is sent";
- **the first-run flow in sequence.** Those screens were viewed one at a time, by deep link.

## Fixed

| # | Commit | Change |
| --- | --- | --- |
| V1 | see `PROJECT-OVERVIEW.md` FE-D12 | `Screen`: when scrolling, the top inset is on a fixed wrapper outside the `ScrollView`, so content clips below the status bar instead of passing under it |
| V2 | 〃 | `Button`: the label is centred when it wraps |
| V3 | 〃 | `Button`: the focus-ring wrapper keeps its reserved 6 dp, but outside the button's edge (negative margin), so a button lines up with the content around it |
| V4 | 〃 | `VoiceNoteScreen`: with a captured, unsaved note the caption says "recorded · save it, or start again" |
| V5 | 〃 | `SettingsScreen`: "Settings" uses `Title`, like every other screen title |
