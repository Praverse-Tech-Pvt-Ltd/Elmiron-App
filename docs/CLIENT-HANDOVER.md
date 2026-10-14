# Field Force: handover to the client

**15 October 2026.** This page is for the people receiving the product: the client's project lead, IT,
compliance and the first managers and admins. It says what the product does today, what is switched off
and why, what we need from you before reps use it, and what to expect. Engineers start at
`docs/START-HERE.md` instead.

| Guide | For |
| --- | --- |
| **This page** | what you are receiving, its state, and what is needed from you |
| [`docs/client/rep-guide.md`](client/rep-guide.md) | medical representatives: a working day in the app |
| [`docs/client/admin-guide.md`](client/admin-guide.md) | managers and admins: the web console |
| [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) | the open-source material inside the product |

---

## 1. What you are receiving

| Part | What it is | Where |
| --- | --- | --- |
| **The field app** | the Android app reps carry through the day: plan, visits, consent, reports, samples, notes, day end, mileage, learning and the AI helpers | `apps/field` (Expo / React Native). The code is also prepared for iPhone (section 6) |
| **The console** | the web app managers and admins use: planning, the team's day, live location, courses, content approvals, users, territories, audit | `apps/console` (Next.js) |
| **The backend** | the database, its security rules, and the server functions both apps call, including the AI gateway | `services/api` (Supabase: Postgres, row-level security, Edge Functions) |
| **Shared code** | the data contract both apps use, the design system and its tokens | `packages/core`, `packages/ui`, `packages/ui-tokens` |
| **Operator documents** | templates and runbooks for your data, content, deployment and translations | `docs/operator/`, `docs/DEPLOY-RUNBOOK.md`, `docs/KEY-DAY.md` |

## 2. Where it stands

**Built and tested on our test stack; not yet in production.** Every feature in section 3 runs against
a complete local copy of the backend, with a test company, test users and a published course. The
checks that run on every change (type checks, lint, formatting, thousands of automated tests and the
database's own security tests) pass.

**Not yet done, and why:**

- **Production deployment.** Waiting on your Supabase paid plan (it provides the backups you chose,
  Q-19) and your go-ahead. The runbook is `docs/DEPLOY-RUNBOOK.md`.
- **A signed production APK.** Waiting on your release signing key (section 5).
- **A real handset pilot.** No rep's phone has run the app yet; everything has been exercised on
  emulators.
- **Hindi and Marathi.** The app is ready for them; the words come from your translators (section 5).

## 3. What the product does

**Status key:** **Ready**: works today. **Off by choice**: built and tested, switched off in the build until
you decide. **Needs your input**: built, waiting on data, a key or a sign-off from you. **Not built**.

### The field app (reps)

| Feature | Status | Notes |
| --- | --- | --- |
| Sign in; first-run permission steps | Ready | Passwords are reset by an admin in the console; there is no self-service reset |
| Today: the day's plan, next visit, sync status | Ready | |
| Today's route | Ready | The manager plans it in the console |
| Unplanned visit, with a reason | Ready | No approval needed; managers review afterwards (your answer to Q-18) |
| Visit: check in and check out, with position | Ready | Position is read when the rep presses check in / check out |
| Doctor's answer about recording (consent) | Ready | English only, until an approved translated notice exists. Needs your registered legal name (Q-11) |
| Call report | Ready | "Products discussed" is empty until your product catalogue is loaded (Q-6) |
| Samples and inputs left | Ready | The UCPMP sample limit needs your number (Q-10) |
| Voice note after a visit | Ready | Sent on Wi-Fi by default; deleted after 90 days |
| Flag a possible side effect | Ready | Reaches your company's admins in the console until you name a PV contact (Q-13) |
| Day end ("End my day") | Ready | |
| Mileage | Ready | Kilometres only; no rupee amount |
| Doctors and doctor history | Ready | Needs your doctor and clinic list (Q-7) |
| Offline working and the send queue | Ready | Everything is saved on the phone and sent when there is signal |
| Mobile data settings | Ready | |
| "What this app records" | Ready | The wording needs your privacy/legal sign-off (section 5) |
| Language: English, Hindi, Marathi | Needs your input | English today; Hindi and Marathi appear the moment your translators' file is complete |
| Learning (courses, lessons, lesson videos) | Off by choice | One build setting. Course content needs your medical/regulatory approval |
| Live location during working hours | Off by choice | Needs your approved privacy notice (Q-12); foreground only, never in the background |
| Assistant (how to use the app) | Off by choice | AI. Needs the AI key in production |
| Product questions | Off by choice | AI. Answers only from your approved material (Q-9) |
| AI Doctor practice, with feedback, typed or spoken | Off by choice | AI. Voice has not yet been heard on a real phone |
| Lesson tutor | Off by choice | AI, inside Learning |
| Maps | Needs your input | A Google Maps key (Q-2) |
| Notifications | Needs your input | Firebase (Q-3); Android only |
| Consultation recording and AI coaching of real visits | Off by choice | Deferred by decision until the PV/data-protection signatory is named (Q-13) |
| Monthly tour plan, expenses / TA-DA, leave, orders | Not built | Not in this release |

### The console (managers and admins)

| Feature | Who | Status |
| --- | --- | --- |
| Coaching queue | managers, admins | Ready; empty while recording is off |
| Plan a rep's day; review unplanned visits | managers | Ready |
| Call reports: read and approve, one or several at once | managers | Ready |
| Team exceptions and visit coverage, never ranked | managers | Ready |
| Side-effect flags: the list with deadlines, and each report read with a reason (audited) | admins | Ready |
| Live location: reps' latest positions, the company switch | managers, admins | Ready; the map view needs an optional Google key |
| The team's day: who started and ended, reopening a day | managers, admins | Ready |
| Course assignments; publishing and retiring courses | managers assign; admins publish | Ready. Course files are loaded by an operator script |
| Knowledge, practice doctors, AI prompts, practice feedback: write and approve | admins | Ready. **Approvals need a second admin** (Q-14) |
| Consent versions, planning access, the live location notice | admins | Ready |
| Users and roles, territories and working hours, audit log, retention | admins | Ready |
| Each person sees only the pages for their role | everyone | Ready |
| Dashboard / KPIs | — | Not built: the plan exists and waits on your decisions D1–D8 |

## 4. Privacy, data and AI: the facts

- **Recordings and voice notes** are deleted 90 days after the server receives them, together with the
  file itself, by a scheduled job that is watched hourly. Consultation recording is switched off.
- **Live location**, when you switch it on, is read only during working hours, only while the app is on
  screen, only after the rep has accepted your notice, and is deleted after 90 days.
- **Call reports, visits and samples** have no automatic deletion period yet; set one with us if your
  policy requires it.
- **Every company's data is separated in the database itself** (row-level security, forced on every
  table), not only in the apps. Reads of sensitive records are written to an audit log that cannot be
  edited. Content changes need two different admins.
- **AI.** The AI features use **OpenAI**. Unlike the earlier Bedrock-India design, OpenAI does not
  guarantee processing inside India (your decision of 9 October). Patient data is filtered out before
  anything is sent, answers come only from instructions and material your admins approved, and each
  rep is limited to 100 AI requests a day. OpenAI retires the two configured models on
  **14 January 2027**; a successor must be chosen before then.
- **Side-effect flags** carry free text that may mention a patient. Until you name a PV contact (Q-13),
  your company's admins can list them and read each one, and every read is written to the audit log
  with its reason.

## 5. What we need from you

**Before reps use it (blocks a pilot):**

| # | What | Why |
| --- | --- | --- |
| Q-14 | A **second admin** account | nothing can be approved by the person who wrote it |
| Q-5 | **Territories and reps** (`docs/operator/territory-template.xlsx`) | every user hangs off a territory |
| Q-7 | **Doctors and clinics** (`docs/operator/doctors-clinics-template.csv`) | real visits |
| Q-6 | **The product catalogue**, Elmiron first | "Products discussed", product questions, the course's product line |
| Q-11 | **The registered legal name** for the consent notice | every consent captured before it lacks it |
| Q-13 | **The PV / data-protection contact**, and where side-effect flags go | today they stop at your admins |
| — | **Supabase paid plan** and the go-ahead to deploy | backups (your Q-19 answer) and lesson video bandwidth |
| — | **A release signing key** (kept by you) and its SHA-256 fingerprint | a production APK; losing the key means the app can never be updated |
| — | **One or two Android phones** of the kind reps carry | the first real-handset test |
| — | **Where the console is hosted** and its web address | the console has no production host yet |
| — | **Production AI**: an OpenAI key with a monthly spending cap | the AI features |
| — | **A support contact** (email or phone) | the app's "Tell the help desk" button appears once it is set |
| — | **Sign-off of "What this app records"** and the live location notice (Q-12, 7 blanks) | a rep's privacy notice under DPDP |

**With a date on it:**

- **Q-10, the UCPMP sample limit**: our checks warn from 16 October and fail from 6 November while it is
  unset.
- **The AI model successor**: before 14 January 2027.

**Not blocking a first pilot:** Hindi and Marathi translations (`docs/operator/translations.md`), approved
product material for Product questions (Q-9), the brand display name and app icon (the build uses
"Field Force" and a placeholder leaf icon), course content approval and the missing conference videos,
Maps (Q-2) and Firebase (Q-3), whether the code repository stays public (Q-20), and the dashboard
decisions D1–D8.

**For iPhone:** an Apple Developer account (US$99 a year) and an Expo account. See section 6.

## 6. iPhone

The app's code is prepared for iPhone (same features, same rules, location "While Using the App" only),
but no iPhone build has been made. iPhone apps are built on a Mac; without one, Expo's cloud build
service (EAS) builds them. What it needs and how: `docs/operator/ios.md`. Notifications stay
Android-only until Apple's push key is supplied.

## 7. Known limitations

- No self-service password reset; an admin resets passwords.
- Mileage is in kilometres, without a rupee rate.
- Course and knowledge files are loaded by an operator script, not written in the console.
- There is no dashboard yet; the console is exception-first and never ranks reps.
- The console is English only. In the app, the consent and side-effect wording stays English until
  approved translations exist.
- Two AI screens put two primary actions side by side (a lesson with its tutor; practice with voice);
  a design decision for the next round.
- The app has not run on a real handset; expect a short round of fixes after the first one.

## 8. Recommended order from here

1. You send the pilot-blocking inputs in section 5.
2. We deploy to production on your paid plan, following the runbook, with a backup taken that day.
3. We build the signed APK with your key and test it on your handsets with two or three reps.
4. You approve content (prompts, material, courses) with the second admin, and we switch on the AI
   features you want.
5. Translations arrive; we import them and Hindi and Marathi switch on.
6. Then the dashboard, and the items in "Not built".
