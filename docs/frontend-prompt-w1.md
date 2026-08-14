# PROMPT FE-W1 — Foundations

> Paste everything between the lines into Claude Code. Read `frontend-plan-v2.md` first.

---

You are the frontend developer on a pharmaceutical field-force app for medical representatives in India. This is sprint 1 of 8.

**Before writing any code, read, in this order:**

1. `.ai-collab/constraints.md` — hard boundaries. (This line originally called the file untracked; it is tracked.)
2. `docs/gotchas.md` — seven sprints of platform failures already paid for.
3. `PROJECT-OVERVIEW.md` — the durable record. Do not overwrite any `###` section.
4. `docs/frontend-plan-v2.md` — your plan.

The monorepo exists and Backend built it. **Do not restructure it.** `services/api` and `packages/core` are read-only to you; if you believe you need a change in either, stop and ask.

## What this sprint is for

At the end of it, a signed-in APK runs on a physical Android phone. Nothing more. Everything after this sprint depends on the build path working, and a build path that works on the second attempt has cost a week.

## Build

### 1. The development build

**Expo Go will not work** — this app needs three native modules (Transistorsoft background geolocation, `expo-audio` with background recording, PowerSync). You need an Expo development build.

The reviewer has chosen the build path; it is stated in `frontend-plan-v2.md` §4.1. Use it. Do not switch mid-sprint.

Acceptance: an APK installed on a real Android device, not an emulator. State the device model in your report.

### 2. `packages/ui-tokens`

Design tokens from `docs/design-plan.md` and the brand guideline.

**One thing is not negotiable: the brand's primary button spec is 2.54:1 contrast and fails every WCAG level.** Do not ship it as given. Produce a corrected token that meets at least 4.5:1 for text, document the original value and the corrected value side by side, and state the computed ratio for each. This is a one-time fix in one place; shipping the brand values and correcting per screen later is a full visual re-review.

### 3. `packages/ui` and the extraction rule

Every component lives here. Nothing UI-shaped goes in `apps/field`.

**Enforce it with a lint rule, not with discipline.** A rule that fails the build when `apps/field` defines a component. The console in FE-W6 and the patient app later both consume this package; extracting components after the fact is a rewrite of every screen.

### 4. Config

`loadAppConfig()` in `packages/core/src/shared/config.ts` **throws** if any of `APP_JWT_AUDIENCE`, `APP_SITE_URL`, `APP_ADDITIONAL_REDIRECT_URLS`, `APP_DEEP_LINK_SCHEME` is missing. All four are absent today and nothing has ever called it. **You are the first caller.**

Add all four to `.env` and to `.env.example` in the same change — `.env.example` is the tracked contract a new developer copies.

**`EXPO_PUBLIC_*` values are inlined into the shipped bundle.** Publishable key only. Never the secret key. If you are unsure which a value is, stop and ask.

### 5. Auth and the navigation shell

- Sign-in against the **local** Supabase stack. Not production — production has no seed data and capture refuses there by design.
- Role-aware shell for `mr`, `field_manager`, `admin`. The role comes from the JWT claims Backend's auth hook installs; read them, do not infer them.
- Enough navigation to reach placeholder screens. No features.

### 6. Point everything at the mock

`services/mock` is running and conforms to `packages/core`. Build against it, not against a live database.

It deliberately returns empty lists, single-item lists, permission-denied responses and error shapes. **Wire at least one screen to a non-happy-path fixture in this sprint** so the pattern exists from the start rather than being retrofitted.

## Do not build

- Any feature screen — check-in, consent, recording, call reports. Later sprints.
- Anything that displays a transcript, analysis, summary or AI output. That work is blocked and may be cancelled outright.
- Any ranking, score, rank, percentile or grade, anywhere, for any reason.
- Anything in `apps/console`. That is FE-W6.
- Any iOS configuration. This app is Android-only, permanently.

## Rules

- No features beyond the list. No speculative abstraction.
- **Ask before adding any dependency**, including a dev dependency.
- Match the existing repo conventions — TypeScript strictness, lint config, formatting. They are already set and CI enforces them.
- If a requirement is ambiguous, stop and ask rather than choosing a default.

## Required at the end

**Append a `### FE-W1 — Foundations` section to `PROJECT-OVERVIEW.md`.** Never overwrite an earlier section.

Include:

- The device model the APK was installed and signed in on
- The corrected contrast tokens, original and corrected, with computed ratios
- How the `apps/field` component-extraction rule is enforced, and proof it fails the build
- The four `APP_*` values you chose and why
- Anything in this prompt you believe is the wrong call

Then **update `docs/gotchas.md`** with anything this sprint cost you that would cost the next developer the same. It is cumulative — append, never rewrite.
