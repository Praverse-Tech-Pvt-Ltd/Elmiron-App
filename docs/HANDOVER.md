# Handover — what to do when each blocker arrives

**Written 8 October 2026 (W2-I), when engineering ran out of work that was not waiting on someone.**
Each section below is one thing the project is waiting for. For each: who supplies it, the first hour
after it arrives, the commands, the page with the detail, and **what proves it worked**. You do not need
to have read the session log (`docs/log/backend.md`) to follow this page.

**Where things are.** The repository root is the folder holding `package.json`. "The local stack" is the
Supabase copy that runs in Docker on the engineer's laptop (`pnpm db:start`; its address and publishable
key are printed by `npx supabase --workdir services/api status`). "The console" is the admin web app
(`apps/console`). "The app" is the Android app reps use (`apps/field`). Every script that writes
something signs in as a named admin; the password is read from the `LOADER_PASSWORD` environment variable
and never typed on the command line.

## What unblocks what

```
model access ──────────────┐
second admin (Q-14) ───────┼──► the five AI features answering, in production
content (Q-9) ─► approval ─┘        (each feature needs ALL THREE: the switch, an approved
                 (needs Q-14)        instruction set, and model access)

Q-19 (backup location) ─► production deploy ─► production address ─┐
release key ────────────────────────────────────────────────────────┼─► a signed production APK
                                                                    │     ─► a real handset test
a handset ──────────────────────────────────────────────────────────┘        and any pilot
```

* **Independent of each other:** model access, the second admin, content, a handset, Q-19, the release key,
  and every decision. None waits on another to be *started*.
* **The second admin is worth more than it looks, alone.** With no model access at all, it unlocks every
  approval: the five instruction sets, the personas and scenarios, and approved material. Each of those is
  then ready the moment model access lands, so model-access day shrinks to switching on and checking.
  See "The second admin".
* **A handset is useful today, without Q-19 or a key:** a DEMO build against the laptop runs the real
  offline day on a real radio. See "A handset".

---

## Model access (Q-1)

**Who:** the AWS account owner — Bedrock model access for the Anthropic models, in the region already in
`services/api/supabase/functions/.env` (git-ignored; the credential lives only there).

**First hour:** follow `docs/ai-platform/DAY-ONE.md`, "The local path", steps 1–6, exactly. Rehearsed against
the stub on 8 October: the mechanics take minutes. The hour is step 5, reading real failures; the
predicted ones and their remedies are in the same page, section A2.

**The command:** `pnpm ai:live` from the repository root, with the local stack and `pnpm functions:serve`
running.

**What proves it worked:** `pnpm ai:live` stops printing `SKIPPING` and its two suites **run and pass**. Read
both runner lines: a skipped suite also exits 0.

---

## The second admin (Q-14)

**Who:** the operator, provisioning a second admin account in the company. Nothing can be approved without
one: the database refuses an approval by the person who wrote or submitted the thing.

**First hour, with no model access needed:**

1. In the console, `/prompts`: the five instruction sets. Admin A submits; **admin B** approves
   (`docs/ai-platform/DAY-ONE.md`, H6).
2. `/practice`: the personas and the six scenarios, the same way.
3. If material is loaded (see "Content"), `/knowledge`: admin B approves each submitted document.
4. Check what each feature now lacks:
   `node services/api/scripts/ai-switches.mjs status --url <address> --key <publishable key> --email <admin>`.

**What proves it worked:** `ai-switches.mjs status` no longer says `no approved instruction set` for any of
the five. What remains is `switched off` (your choice: `… on all`) and model access.

---

## Content (Q-9, and courses)

**Who:** the content owners write the files; one admin loads them; a second admin approves material.

**The order, end to end** (every step is a command or a console page; none is SQL):

| # | Step | Command / page | Cost |
| --- | --- | --- | --- |
| 1 | The catalogue: markets and products, **first** — the other files name them, and are refused until they exist | Copy `docs/operator/catalogue-template.md`; `node services/api/scripts/load-catalogue.mjs <file>` (checks, writes nothing), then add `--write --url <address> --key <publishable key> --email <admin>` | seconds; re-running is safe |
| 2 | Courses | Copy `docs/operator/course-template.md`; `load-course.mjs <file>`, then `--write …` → a DRAFT | seconds per file |
| 3 | Publish each course | `node services/api/scripts/content-step.mjs publish-course "<course title>" --url … --key … --email …` (no console screen does this) | seconds |
| 4 | Assign it | the console's Learning page | a minute |
| 5 | Approved material | Copy `docs/operator/knowledge-template.md`; `load-knowledge.mjs <file>`, then `--write …` → a DRAFT | seconds per file |
| 6 | Submit it for review | `content-step.mjs submit-knowledge "<document title>" …` (a draft does not appear in the console until submitted) | seconds |
| 7 | Approve it | **a different admin**, in the console's `/knowledge` | minutes per document, to read it |

Every loader lists every problem in the file, by line, and writes nothing if there is one. The samples are
refused by name (their titles start `EXAMPLE`), so copy and rename them.

**One build setting, or reps see nothing.** Courses appear in the app only in a build made with
`EXPO_PUBLIC_LEARNING=true` in the environment; the row that opens them is on the **Me** tab, and with the
setting off that row does not exist. It is off by default.

**What proves it worked:** a rep assigned the course opens Me → Learning in a build made with that
setting, sees the course, and starts it;
`/knowledge` shows nothing waiting once everything is approved. All seven steps are proved together on a
fresh company by `services/api/tests/catalogue-loader.spec.ts`.

**The real cost of content day is the writing and the reading** — engineering has none left.

---

## A handset

**Who:** the operator — one Android phone of the kind reps carry.

**First hour, with nothing else needed:** a DEMO build against the laptop.

1. Phone and laptop on the same Wi-Fi; find the laptop's address (`ipconfig`).
2. `pnpm db:start`, then `pnpm --filter @fieldforce/api run seed:day -- --another`. Sign in with the
   account it prints.
3. **In that PowerShell window, set the four values the script cannot work out** — not secrets; W2-K
   found this page omitted them, and a fresh clone's build is refused without them:
   `$env:EXPO_PUBLIC_APP_JWT_AUDIENCE = 'authenticated'`,
   `$env:EXPO_PUBLIC_APP_SITE_URL = 'http://127.0.0.1:3000'`,
   `$env:EXPO_PUBLIC_APP_DEEP_LINK_SCHEME = 'com.praversetech.fieldforce'`,
   `$env:EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS = 'com.praversetech.fieldforce://auth-callback'`.
   Then `powershell -ExecutionPolicy Bypass -File apps\field\scripts\build-demo-apk.ps1 -Ip <laptop address>`
   (5–15 minutes), then install the APK it names on the phone. (`docs/START-HERE.md`, "The app".)
4. Walk `docs/DEMO-SCRIPT.md`. Then turn the radio off mid-visit, finish the visit, turn it on again.

**What proves it worked:** the finished visit reaches the server after the radio comes back. Its check-in
and check-out times in the console match the phone's. **A demo APK is debug-signed and says "(demo)":
never give it to a rep.** `apps/field/scripts/verify-release-apk.mjs <apk>` refuses it, by design.

---

## Q-19 — where a backup may be kept

**Who:** the operator. One word: **Supabase**, **GitHub** or **Bucket** (`docs/operator-inputs.md`,
section 8).

**First hour:** add the step that stores the backup (about 1 hour for Supabase, half a day otherwise; the
backup job today makes a copy and then discards it, `BE-W143`). Then `docs/DEPLOY-RUNBOOK.md` from
"Deploy attempt — 5 October", which resumes at step 0.1, then operator steps 1–5.

**What proves it worked:** the runbook's step 5 smoke test, with the expected answers it lists.

**What it unblocks next:** the production address, which the production APK needs.

---

## The release key (the production APK)

**Who:** the operator creates it and keeps it, **outside this repository and outside any chat or log**.
Losing it means no installed copy of the app can ever be updated. Record its **SHA-256 certificate
fingerprint**: that is public, and engineering needs it.

**Where it goes on the build machine:** four Gradle properties, in `%USERPROFILE%\.gradle\gradle.properties`
or as `ORG_GRADLE_PROJECT_<name>` environment variables: `FIELDFORCE_UPLOAD_STORE_FILE` (the keystore's
path), `FIELDFORCE_UPLOAD_STORE_PASSWORD`, `FIELDFORCE_UPLOAD_KEY_ALIAS` and `FIELDFORCE_UPLOAD_KEY_PASSWORD`.

**What exists now:** a release build without those four is **refused by Gradle** before anything is
compiled (`apps/field/plugins/release-signing.cjs`). And
`node apps/field/scripts/verify-release-apk.mjs <apk> --expect-sha256 <fingerprint>` refuses any APK not
signed by exactly that key.

**The production build script exists (`BE-W177`):** `apps/field/scripts/build-release-apk.ps1 -ExpectSha256 <fingerprint>`.
**It reads the four values from the ENVIRONMENT of the shell it runs in** (`FIELDFORCE_UPLOAD_STORE_FILE`,
`_STORE_PASSWORD`, `_KEY_ALIAS`, `_KEY_PASSWORD`) and refuses before Gradle if any is missing — values kept
only in `gradle.properties` are not seen by its checks. It also needs `FIELD_ANDROID_VERSION_CODE` (higher
for every APK handed out) and the production `EXPO_PUBLIC_*` values. `BE-W150` is closed.

**What proves it worked:** `verify-release-apk.mjs` prints `OK`, and the APK installs and signs in against
production.

---

## The decisions

Each is one answer from the operator; the detail is in `docs/operator-inputs.md`.

| Decision | Unblocks | After the answer |
| --- | --- | --- |
| **Q-15** — should Product Q&A flag side effects, off-label requests and complaints? | three Product Q&A benchmark cases (`BE-W134`) | engineering, size depends on the answer |
| **Q-16, Q-17, Q-18** — manager planning: whose plans, web or phone, approval of unplanned visits | manager planning | 10–15 working days |
| **Q-20** — should the repository stay public? | nothing technical | minutes |
| **Q-21** — does a course need a second admin's approval? | course four-eyes | ½ day if yes; nothing if no. Today ONE admin publishes, by command (`content-step.mjs`) — there is no screen |
| **`BE-W150`** — the app refuses to start without `EXPO_PUBLIC_API_BASE_URL`, an address nothing uses (re-rule FE-D2 2) | the production APK's settings | minutes |
| **Q-13 / `D-15`** — the PV / data-protection signatory | recording, transcripts, coaching of real visits, practice scenario S6 | not estimated |
| **What the coach's `scientific_accuracy` means** | the coach's scoring | minutes |
| **Q-2** Maps key, **Q-3** Firebase, **Q-12** the live-tracking notice | maps, notifications, live tracking — not started | not estimated |
| **Branch protection on `main`** (a repository admin) and the **`practice_writer` key** on the hosted project (dashboard, `docs/ai-platform/DAY-ONE.md` H7) | CI as a required gate; all five AI features in production | minutes each |
