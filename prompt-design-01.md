# Claude Design Prompts — Weeks 1–4

For the UI/UX designer. Run in order. Review after each before moving on.

**Two ways to work these:**

- **Code-first (recommended).** Claude builds the real token package and a live component gallery you can open in a browser and test at real sizes, in real light, with a real screen reader. This is also the exact artifact the engineers consume, so nothing gets translated by hand. Figma library is then drawn *from* the built system, not the other way round.
- **Figma-first.** Use the Figma MCP tools (`figma-generate-library`, `figma-use`). Slower to validate accessibility, and creates a translation gap to code.

Reference documents to have open: `design-plan.md`, `design-tokens-reference.html`, the Elmiron Brand Identity Guidelines v1.0.

---

# PROMPT D1 — Product token system *(Week 1)*

> Paste everything between the lines.

---

You are building the Tier 2 product design system for a pharmaceutical clinical platform. There is an existing brand guideline. Your job is **not** to replace it — it is to derive a product layer from it that is accessible and complete.

## The brand input — Tier 1, do not change these

```
cream       #F8F6F1   primary ground
sage        #8AAB8A   brand accent
sage-deep   #4A7A4A
charcoal    #2C2C2A   primary text (warm black, never pure #000)
muted       #6B6B68
sage-pale   #E8F0E8
sage-light  #B8CDB8

Display  Cormorant Garamond (300–600, roman + italic)
Script   Italiana (400)
Body     DM Sans (300, 400, 500)

Spacing  xs 4 · sm 8 · md 16 · lg 32 · xl 48–64 · 2xl 80–128
Brand character: planar, architectural, restrained. Sage earns presence through restraint.
Motion: entrance y 24→0 over 0.6s ease [0.4,0,0.2,1]; elements enter from below, never above.
```

## Facts that constrain every decision

1. **The brand's primary button spec fails accessibility.** Sage `#8AAB8A` with white text is **2.54:1** — fails AA, AA-large and AAA. Its hover state (`#4A7A4A`, 5.03:1) passes. On mobile there is no hover, so users only ever see the failing state. This must be fixed.
2. **The badge spec fails.** Sage Deep on Sage Pale is **4.33:1**, paired with 10.4px uppercase text.
3. **Some users have drug-induced reading difficulty.** The drug this platform tracks carries a documented retinal risk whose reported symptoms include prolonged dark adaptation, night-vision difficulty and difficulty reading — often with normal visual acuity. The patient app must meet **WCAG 2.2 AAA for body text**.
4. **Nothing in the brand palette reaches AAA except charcoal.**

## Build this

### 1. `design-tokens.json` — W3C design-token format, the single source of truth

Structure it in three levels:

- **Primitive** — the raw brand values above, plus the derived scale below
- **Semantic** — role-named tokens the UI actually consumes (`text-primary`, `surface-raised`, `action-primary-bg`, `border-subtle`, `state-attention-fg`…)
- **Component** — only where a component genuinely needs an override

Add these product colours. They are darker renderings of the same sage hue, already verified:

```
interactive         #4A7A4A   4.66 on cream · 5.03 on white   AA
interactive-strong  #35593A   7.36 on cream · 7.95 on white   AAA
interactive-ink     #2F5233   8.18 on cream · 8.84 on white   AAA
on-dark             #B8CDB8   8.30 on charcoal                AAA
```

**`#8AAB8A` becomes decorative-only** in the semantic layer: borders, dividers, rules, large fills, illustration. Do not expose it as any text or action token.

### 2. Semantic state colours — you define these

The brand has one accent and no states. Define five, verify each, and keep them inside the brand's warm restraint. **Do not reach for `#FF0000`** — this is a calm clinical product, not an alarm panel.

`success` · `attention` (eye exam due, follow-up overdue) · `critical` (adverse event flagged, permission denied) · `info` · `offline`

Each needs a foreground, a background and a border value, tested on **both** cream and charcoal grounds.

### 3. Contrast validator

Write `scripts/check-contrast.ts` that reads `design-tokens.json`, computes every foreground/background pairing the semantic layer permits, and **fails with a non-zero exit code** if any pair used for text falls below its required threshold. Patient-app tokens require 7:1. Everything else requires 4.5:1, or 3:1 for text at 24px+ or 19px+ bold.

This runs in CI. A token that fails cannot be merged.

### 4. Type scale

Two scales, one for web consoles and one for mobile, both derived from the brand faces:

- **Cormorant Garamond** — weight **500 minimum**, size **24px minimum**. Brand moments only: login, onboarding, empty states, print report headers. Never a form label, table cell or data value.
- **DM Sans** — weight **400 minimum**. Weight 300 is removed from the product scale entirely.
- Web body 16px / line-height 1.6. **Patient app body 18px minimum**, scalable to 200%.
- Data values use **tabular numerals**.
- **Italiana is excluded from the product system.** Marketing only.

### 5. Spacing, radius, density

Keep the brand spacing scale. Add:

- **Radius:** `0` for web (brand-true, planar). Mobile: `8px` on touch targets and inputs, `12px` on cards. Badges stay `0` on both.
- **Three density modes** off one scale: `compact` (manager, marketing, admin, PV) · `standard` (doctor, MR) · `comfortable` (patient).
- **Minimum touch targets:** 32px pointer · 44px MR app · 48px patient app.

### 6. Dark theme

A real theme, not an inversion. Charcoal ground, `sage-light` for accent (8.30:1), and every semantic token re-verified against the dark ground. This matters specifically because of constraint 3 above — night use by people with dark-adaptation difficulty.

### 7. Motion

Keep the brand's entrance spec. Add what a product needs and a website does not: press feedback, loading, skeleton, transitions between screens, and pull-to-refresh. All must honour `prefers-reduced-motion`.

### 8. Live token gallery

A single self-contained HTML page rendering every token, every state, light and dark, with the measured contrast ratio printed next to each pair. I need to open this on a phone, outdoors, and judge it.

## Rules

- Do not invent brand colours outside the sage/cream/charcoal family.
- Every colour pair you introduce must be measured and the number stated. No "looks fine."
- No token exists without a stated use. Delete anything speculative.
- If a brand rule and an accessibility requirement conflict, accessibility wins — and you note the conflict explicitly in the output so we can take it to the client.

## Final step — required

Create `DESIGN-OVERVIEW.md` at the design repo root. **Every later design prompt appends to this same file — never overwrite it.** Structure:

```
# Elmiron Platform — Design Overview

## Current state
## Design decisions
(each decision, the reasoning, and what it rules out)
## Deviations from the brand guideline
(what changed, why, the measured evidence, and what the client must sign off)
## Phase log
### D1 — Token system (date)
- What was built
- Files created
- Tokens defined and their verified contrast ratios
- Open questions for the reviewer
## How to run
## Known gaps
```

Fill in the D1 section completely. The **Deviations** section matters most — the client owns the brand and needs to see exactly what we changed and why.

---

# PROMPT D2 — Core components *(Week 2)*

> Run only after D1 is reviewed and approved.

Read `DESIGN-OVERVIEW.md` and `design-tokens.json` first. Follow the conventions already set.

Build a component library consuming **only semantic tokens** — no hard-coded hex, anywhere. Two targets sharing one API where possible: React (web consoles) and React Native (mobile apps).

### Components

Button · IconButton · TextInput · TextArea · Select · Combobox · Checkbox · Radio · Switch · DatePicker · Slider (symptom severity) · Card · ListItem · Table (sortable, sticky header, tabular numerals) · Tabs · Modal · BottomSheet (mobile) · Toast · Banner · Badge · Avatar · Progress · Skeleton · EmptyState · ErrorState · **OfflineBanner** · Stepper (consent flow) · SegmentedControl

### Every component ships its full state matrix

`default` · `hover` (web only) · **`press`** (mobile — mandatory) · `focus-visible` · `disabled` · `loading` · `error` · `read-only`

**A component without a documented press state is not done.** The brand guideline says "hover: colour transition only" — that instruction does not apply on a phone.

### Three components with special requirements

**`AISummaryCard`** — every AI output on a doctor screen renders through this. It must, by construction, always render: inline source citations, a link to the raw underlying data, and a visible "AI-generated summary — not medical advice, verify against source records" label. Make it structurally impossible to use without them. This satisfies a regulatory requirement, not a style preference.

**`SLAClock`** — time remaining against a legal deadline. Used in the pharmacovigilance queue where a serious adverse event carries a 15-day statutory clock. Must be readable at a glance, escalate visually as time runs down, and never use colour alone to signal urgency.

**`SuppressedValue`** — renders an em dash when an aggregate covers fewer than 5 patients. Re-identification protection. Include the tooltip explaining why.

### Accessibility, enforced not aspired to

- Every interactive element keyboard-reachable, with a visible focus ring that is not the browser default
- Correct roles and labels; test with VoiceOver and TalkBack, not just an automated checker
- Touch targets meet the per-app minimums from D1
- **No component encodes meaning in colour alone** — every state carries an icon and a text label
- Patient-app variants verified at 200% text scale without layout break

### Output

A live component gallery, browsable on desktop and phone, with every state visible, a light/dark toggle, and a density toggle. Plus per-component docs: props, states, accessibility notes, and when *not* to use it.

**Then append a `### D2 — Core components` section to `DESIGN-OVERVIEW.md`.** Do not overwrite D1.

---

# PROMPT D3 — Field app, MR day flow *(Weeks 3–4)*

> Run only after D2 is approved. Engineering needs these screens in build week 3.

Read `DESIGN-OVERVIEW.md` first.

Design the medical representative's mobile app. Screens listed in `design-plan.md` §3.

**Who this is for:** outdoors, in Indian sunlight, on a phone, often one-handed, often on 3G or no signal, watching battery drain, with roughly 90 seconds in a clinic waiting room before the doctor is free.

**Design the whole day, and design every offline branch:**

`shift start → beat plan → travel → arrive → geo check-in → detail the doctor → call report → check-out → next visit → shift end`

### Non-negotiable for this app

- **Offline is a normal state**, designed deliberately — not an error screen. Sync status is visible on every screen. Queued items are visible and countable. The user always knows what has and has not reached the server.
- **Primary actions sit in the bottom third** — one-handed reach.
- **High-contrast outdoor mode** — a real mode, not just "we used dark text."
- **Check-in is one tap** from the doctor screen.
- **A call report is completable in under 60 seconds.** Time your own prototype. If it takes longer, cut fields.
- **Battery-conscious** — no continuous animation, no persistent map render.

### One screen that must be designed with unusual care

**The tracking transparency screen.** Location is captured continuously, but only during a defined shift window. This screen states plainly: what is captured, when capture starts and stops, how long it is kept, and exactly who can see it. It is reachable in one tap from home.

Design it to be genuinely reassuring rather than legally defensive. Field-force resistance to tracking is the main adoption risk for this app, and a screen that reads like a disclaimer will increase it, not reduce it. Also design the **visible confirmation that tracking has stopped** at shift end — the user must be able to see that it is off.

### Deliverables

Low-fidelity flow first — get the flow reviewed before any polish. Then high fidelity for every screen in every state: loading, empty, error, offline, permission-denied. Then a clickable prototype including the failure branches.

### Constraint that overrides everything

**No screen in this app may contain any patient identity, diagnosis, prescription or diary content** — not in a list, a chart, a tooltip, an export or an empty state. Medical representatives have zero access to clinical data. If you find yourself designing a screen that would be more useful with patient data on it, that is the constraint working correctly.

**Then append a `### D3 — Field app` section to `DESIGN-OVERVIEW.md`.**

---

# Reviewer checklist

**After D1**
- [ ] Does `check-contrast.ts` actually fail the build on a bad token, or just warn?
- [ ] Is every patient-app text token at 7:1 or better?
- [ ] Are the five semantic states measured on both grounds, or only on cream?
- [ ] Is `#8AAB8A` genuinely unreachable as a text or action token?
- [ ] Is the Deviations section honest and complete enough to take to the client?

**After D2**
- [ ] Does every mobile component have a press state?
- [ ] Can `AISummaryCard` be rendered without citations? It should be impossible.
- [ ] Any hard-coded hex anywhere in the component layer?
- [ ] Tested with a real screen reader, or only an automated checker?
- [ ] Does anything break at 200% text scale?

**After D3**
- [ ] Is offline designed as a normal state or bolted on as an error?
- [ ] Timed: is a call report genuinely under 60 seconds?
- [ ] Are primary actions reachable one-handed?
- [ ] Does the tracking screen read as reassuring or as legal cover?
- [ ] Any patient data anywhere in the field app? Even one field is a fail.

---

**Coming next:** D4 Manager console · D5 Patient app *(with mandatory user testing in Week 5)* · D6 Doctor console · D7 PV, Admin, Marketing.
