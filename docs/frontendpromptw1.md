# PROMPT FE-W1 — Foundations

> **Before pasting:** commit `frontend-plan-v2.md` into the repo as `docs/frontend-plan-v2.md` and push it. This prompt is self-contained and does not require it, but the developer will want it and a plan that lives only in a chat window is the exact failure this project has hit four times.

---

You are the frontend developer on a pharmaceutical field-force app for medical representatives in India. **Android only, permanently.** This is sprint 1 of 8.

**Read before writing any code, in this order:**

1. `.ai-collab/constraints.md` — hard boundaries, tracked in the repo
2. `docs/gotchas.md` — eight sprints of platform failures already paid for, cumulative
3. `PROJECT-OVERVIEW.md` — the durable record. Append-only; never overwrite a `###` section
4. `docs/frontend-plan-v2.md` — your full plan, if it is present

The monorepo exists and Backend built it. **Do not restructure it.** `services/api` and `packages/core` are read-only to you — if you believe you need a change in either, stop and ask.

## What this sprint is for

At the end of it, a signed-in APK runs on a physical Android phone. Nothing more. Every later sprint depends on the build path working, and a build path that works on the second attempt has already cost a week.

## Decisions already made — do not relitigate

- **Android only.** No iOS configuration, no Apple anything.
- **Build path: local Gradle**, not EAS Build. Android Studio, JDK 17, ~10 GB disk. Native config changes are frequent on this app and cloud build round-trips would dominate the sprint. *If the Windows toolchain fights you for more than half a day — see `docs/gotchas.md` for the class of problem — stop and report rather than burning the sprint on it. Switching to EAS is the reviewer's call, not yours.*
- **Expo Go will not work.** Three native modules require a development build: Transistorsoft `react-native-background-geolocation`, `expo-audio` with background recording, and PowerSync. Do not attempt Expo Go as a shortcut.

## Build

### 1. The development build

An APK installed on a **real Android device**, not an emulator. State the device model in your report.

If no physical device is available to you, build the APK anyway, say so plainly, and record the gate as unmet. Do not substitute an emulator run and call it done.

### 2. `packages/ui-tokens`

Design tokens from the brand guideline and `docs/design-plan.md` if present.

**One thing is not negotiable.** The brand's primary button specification is **2.54:1 contrast — it fails every WCAG level.** The badge specification is 4.33:1.

Do not ship the brand values as given. Produce corrected tokens meeting at least **4.5:1 for text**, and document original value, corrected value and the computed ratio for each, side by side. This is a one-time fix in one place. Shipping the brand values and correcting per screen later is a full visual re-review of the whole app.

### 3. `packages/ui` and the extraction rule

Every component lives in `packages/ui`. Nothing UI-shaped goes in `apps/field`.

**Enforce it with a lint rule that fails the build**, not with discipline. The console in FE-W6 and a second app later both consume this package. Extracting components after the fact is a rewrite of every screen.

Prove the rule fails: add a component in `apps/field`, show the build going red, remove it.

### 4. Config

`loadAppConfig()` in `packages/core/src/shared/config.ts` **throws** if any of `APP_JWT_AUDIENCE`, `APP_SITE_URL`, `APP_ADDITIONAL_REDIRECT_URLS`, `APP_DEEP_LINK_SCHEME` is missing. All four are absent today and nothing has ever called it. **You are the first caller.**

Add all four to `.env` **and** `.env.example` in the same change — `.env.example` is the tracked contract a new developer copies.

**`EXPO_PUBLIC_*` values are inlined into the shipped bundle.** Publishable key only, never the secret key. If you are unsure which a value is, stop and ask.

### 5. Auth and navigation shell

- Sign in against the **local** Supabase stack. Not production — production has no seed reference data and capture refuses there by design.
- Role-aware shell for `mr`, `field_manager`, `admin`. The role comes from the JWT claims Backend's auth hook installs. **Read them; do not infer them.**
- Enough navigation to reach placeholder screens. No features.

### 6. Point everything at the mock

`services/mock` is running and conforms to `packages/core`. Build against it, not a live database.

It deliberately returns empty lists, single-item lists, permission-denied responses and error shapes. **Wire at least one screen to a non-happy-path fixture this sprint**, so the pattern exists from the start instead of being retrofitted in FE-W7.

## Do not build

- Any feature screen — check-in, consent, recording, call reports, mileage. Later sprints.
- Anything displaying a transcript, analysis, summary or AI output. **That work is blocked and may be cancelled outright.**
- **Any ranking, score, rank, percentile or grade, anywhere, for any reason.** Backend has tests asserting those column names do not exist. This is a regulatory line, not a preference.
- Anything in `apps/console`. That is FE-W6.
- Any iOS configuration.

## Rules

- No features beyond the list. No speculative abstraction.
- **Ask before adding any dependency**, including a dev dependency.
- Match existing repo conventions — TypeScript strictness, lint config, formatting. CI enforces them and they are already set.
- If a requirement is ambiguous, **stop and ask** rather than choosing a default.
- If something you build is not called by anything, say so. That check has caught two dead functions on this project already.

## Required at the end

**Append a `### FE-W1 — Foundations` section to `PROJECT-OVERVIEW.md`.** Never overwrite an earlier section.

Include:

- The device model the APK was installed and signed in on — or that no device was available
- Corrected contrast tokens: original, corrected, computed ratios
- How the `apps/field` extraction rule is enforced, and proof it fails the build
- The four `APP_*` values chosen and why
- Anything you were asked to build that you believe is the wrong call

Then **append to `docs/gotchas.md`** anything this sprint cost you that would cost the next developer the same. It is cumulative — append, never rewrite.
