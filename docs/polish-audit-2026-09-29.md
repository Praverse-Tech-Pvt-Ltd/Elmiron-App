# Polish audit — demo-path screens against `docs/design/` (FE-D7 1)

**Read-only comparison, written 28 September 2026 for the 29 September polish pass, on branch
`fe-d7-polish` at `25034f9`.** The screens are the walkthrough in
`docs/demo-path-2026-10-01.md` (steps 1–16). The designs are the four files in `docs/design/`:

- `phase1-tokens-and-components.dc.html` — tokens and shared components;
- `phase2-first-run-and-the-day.dc.html` — A1–A9, S4, B1–B7, C1, C5, C6;
- `phase3-consent-handoff.dc.html` — D1–D7;
- `phase4-coaching-and-console.dc.html` — hidden in this build (P6), so not audited.

The designs are inline styles. A pressed state is a `style-active="…"` attribute on the element.
**No design file contains a `transition` rule**, so the designs specify no screen transition.

**How this list is ranked:** by how visible a deviation would be to someone watching the
walkthrough on the phone — something on every screen first, then something on one screen that
the eye lands on, then something that shows only when a finger is on it, then details. The
**Kind** column decides whether FE-D7 4 may touch it:

- **visual** or **copy** — may be fixed in this pass;
- **meaning** — changes behaviour, or what a number or status means. **Skipped by rule**, and
  listed as skipped;
- **deliberate** — the code carries a comment explaining why it differs; left alone unless the
  comment is wrong.

Code references are to the code at `25034f9`.

## Ranked deviations

| # | Screen(s) | Deviation | Design | Code | Kind |
| --- | --- | --- | --- | --- | --- |
| 1 | Every demo screen | **Screen titles are body-sized.** The first heading on each screen is `Heading`, 16.5px/600 | Day screens title at 27px; first-run screens at 29–32px | `Heading` everywhere (e.g. `TodayScreen.tsx:195`, `BeatPlanScreen.tsx:133`, `VisitScreen.tsx:232`, `sign-in.tsx:58`, `onboarding/*.tsx`). `tokens.typography.title` (27) exists and **nothing uses it** | visual |
| 2 | Day end (B7) | **"Your Today"** reads as a mistake. `DayEndScreen` prefixes "Your " to `dayLabel` over the day's numbers, and the route passes `"Today"` | "Your Thursday" — the weekday | `DayEndScreen.tsx:164`, `day-end.tsx:120` | copy |
| 3 | A4 Microphone | **Button labels differ from the design** (noted in the demo path, step 8) | "Turn on the microphone" / "I'll type my reports" | "Allow the microphone" / "Not now" (`onboarding/microphone.tsx:83-84`) | copy |
| 4 | Voice note (D7) | **The hold-to-record button's label is nearly invisible.** The label is `BodyText` inside the hero surface, so it renders white, on a pale sage fill | Sage `#B8CDB8` with ink text | `VoiceNoteScreen.tsx` hold: `successFill` background, white label | visual |
| 5 | Voice note (D7) | **The hold button has no pressed state** — a static style, not a style callback | `style-active` `#B8CDB8 → #9EB89E` | `[styles.hold, recording ? styles.holding : null]` | visual |
| 6 | Beat plan (B3), Queue (C1), Home (B1) | **Pressing an offline-styled row shows nothing.** `ListItem`'s and `SyncQueueIndicator`'s pressed fill is `wash` `#F1EFE8`, which is the same colour as their offline fill `offlineFill` `#F1EFE8` | Every tappable row darkens when pressed | `ListItem.tsx`, `SyncQueueIndicator.tsx` | visual |
| 7 | Beat plan (B3) | Upcoming and cancelled stops are drawn with the dashed **"saved on phone"** style | Plain upcoming rows | Stops map to status `'offline'` | **meaning** — the status a row carries |
| 8 | Every screen | Side padding is 16px | 22px | `space.md` | visual — **left**: a layout change on every screen, too wide to verify in one pass |
| 9 | Day end (B7) | "See everything recorded today" is a **primary** (green) button | Secondary | `variant="primary"` | visual |
| 10 | Home (B1), every banner | A banner's action is a quiet green text button | Attention-coloured text, pressed `#F2E6CC` | `Banner.tsx:87` renders a quiet `Button` | visual — **left**: needs a new banner-action variant in the shared `Button` |
| 11 | Consent (D1–D5) | The answer buttons are secondary buttons | White, 2px ink border, pressed `#F1EFE8` | secondary `Button`; `ConsentScreen.tsx:25-28` explains the choice | **deliberate** |
| 12 | Consent (D2–D4) | The fiduciary line starts in lower case: "your rep's employer is the Data Fiduciary…" | Sentence case | `consent/content.ts:155` with `firstName = 'your rep'` (`consent/[visitId].tsx:191`) | copy |
| 13 | Consent handoff | "Give the phone back" fades to 60% opacity when pressed | The text colour changes | opacity 0.6 | visual |
| 14 | Consent (D3) | "Back to the question" link fades when pressed | Colour change | opacity | visual |
| 15 | Voice note (D7) | While recording, the button fills accent green | Deeper sage | `success` | visual |
| 16 | Voice note (D7) | The recording indicator is a tint | Solid | `RecordingIndicator` | visual |
| 17 | Consent | The spinner is accent green | Muted | `Spinner` colour | visual |
| 18 | Every screen | The `Button`'s visible edge sits 6px inside its focus ring | Flush | `Button.tsx` inset | visual — **left**: changes every button's hit area |
| 19 | Form screens | `Select` has no pressed or open border change | Border darkens | `Select.tsx` | visual |
| 20 | Samples (C5) | `ListItem` selected rows press to the same hue as unselected | A darker selected hue | `ListItem.tsx` | visual |
| 21 | Queue (C1) | A failed item presses to wash, not a darker critical fill | Darker critical | `SyncQueueIndicator.tsx` | visual |
| 22 | Sign in, forms | The text field's clear ✕ fades when pressed | Colour change | opacity | visual |
| 23 | — | The hero `Card` presses to `#2F5233` | `#101208` | `Card.tsx` `pressedHero` | visual — **unreached**: no hero card on the demo path is tappable |

### Copy differences already documented as deliberate — all meaning, all skipped

These change what the screen says a thing does or counts, so they are out of scope by rule. Each is
already recorded in the demo path or in a code comment:

- **A2 Location** shows two benefits, not three (auto check-in and nearest doctor need background
  location, an open decision).
- **A3 Notifications** lists what the app will send; nothing sends yet.
- **S4 Location off** is a standalone screen, not Home in manual mode; its figures are labelled as
  design estimates.
- **B1 Home** offers only the next visit; **B3** says "Submitted — not yet approved"; **B7**
  counts, statuses and kilometres come from the mock and show "not available" when unknown.
- **C5 Samples** says the UCPMP cap is inert; **C6 Call report** heads an unknown visit "This
  visit" and has no product picker.

### Screen transitions

No design file specifies one. The code uses the native stack's platform `'default'`, which differs
by Android version, and ignores the "Remove animations" setting. Fixed in FE-D7 3.

### Stale comments found on the way

`notifications.ts` and `oem-content.ts` say the design is not in the repo. It is
(`phase2-first-run-and-the-day.dc.html`).
