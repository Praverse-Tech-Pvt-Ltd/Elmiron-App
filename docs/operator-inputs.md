# What we need from you — credentials, legal text and master data, nothing else

**1 October 2026, W1-N.** Rewritten to your rule: *"one consolidated list only, for items that
genuinely need credentials, legal text or master data."* Every decision you have made is recorded
(`BE-C6`–`BE-C61`, `.ai-collab/decisions-backend.md`) and is not repeated here.

**Nothing on this list stops development.** Each line says what it unblocks when it arrives.

| # | Kind | What | Unblocks | Blocking 4 October? |
| --- | --- | --- | --- | --- |
| **Q-1** | Credentials | **AWS for Bedrock India** — section 1 | All five AI features answering for real, instead of a labelled stub | **Yes** — no real AI without it |
| **Q-2** | Credentials | **Google Maps Platform** — section 2 | Maps in the app and the console | Yes, for maps |
| **Q-3** | Credentials | **Firebase Cloud Messaging** — section 3 | Notifications | Yes, for notifications |
| **Q-4** | Your answers | **The sixteen lost subjects** — section 4 | Whatever they decide | Unknown |
| **Q-5** | Master data | **Territories and MRs** — `docs/operator/territory-template.xlsx`, section 5 | Every user; everything else is loaded after it | Yes, for a real deployment |
| **Q-6** | Master data | **Products** — brand, generic, market, status | `mr_chat` scoping, product pickers | No — structure works empty |
| **Q-7** | Master data | **Doctors and clinics** | Real visits only. **AI Doctor does not need them** (`BE-C53`) | No |
| **Q-8** | Master data | **Approved working hours** per territory and a company default | Check-in validity. 09:00–18:00 Mon–Sat is test data (`BE-C50`) | No — test value in place |
| **Q-9** | Master data | **Approved product content** (labels, PI, approved claims) and **who signs it** | Product Q&A has nothing to answer from until then — it refuses rather than guesses (`BE-C52`) | No, but Q&A is empty without it |
| **Q-10** | Master data | **The UCPMP sample cap number and its basis** — arrives separately, never invented (`BE-C42`) | Cap enforcement. **CI warns from 16 October and fails on 6 November** while unset | No |
| **Q-11** | Legal text | **The registered legal name** for the consent notice (`BE-C61`) | Every consent record captured after it. **The only item that costs more each day it is missing** | No, but see the cost |
| **Q-12** | Legal text | **Approve the live-tracking privacy notice** — drafted by us, `docs/operator/live-tracking-notice-DRAFT.md` | Live tracking (`BE-C45`) — it cannot start without a separate consent | Yes, for tracking |
| **Q-13** | Legal text | **The PV / data-protection signatory** — **not a current-release blocker** (`BE-C55`) | Recording and transcripts, both deferred | No |
| **Q-14** | Account | **The second production admin** you are provisioning (`BE-C57`) — tell us when one approval has been made with it | Every approval: prompts, personas, knowledge, lessons | **Yes** — nothing can be approved without it |
| **Q-15** | Your answer | **Should Product Q&A notice side effects, off-label requests and product complaints — or is noticing them the rep's job?** — section 6 (`BE-W134`) | Either a new piece of work, or deleting three tests that can never pass | No |
| **Q-16** | Your answer | **May a manager plan for their direct reports only, or for everyone beneath them?** — section 7 | Manager planning (item 10) | No — but nothing of manager planning is built until Q-16–Q-18 are answered |
| **Q-17** | Your answer | **Does the manager plan on the web console or on the phone?** — section 7 | Manager planning screens | Same |
| **Q-18** | Your answer | **Does an MR's unplanned visit need the manager's approval before, after, or never?** — section 7 | Unplanned visits (`FE-W28`) | Same |
| **Q-19** | Your answer | **Where may a full copy of the production database be kept: GitHub, a storage bucket you provide, or Supabase's own backups?** — section 8. **Expected answer (10 October): Supabase-managed backups** — runbook step 0.1 is already written for it; confirm the paid plan is active and a backup dated today exists | **The production deploy you approved** — its first step is a backup from today. And the backup job, which goes red from 16 October | **Yes — the deploy cannot start without it** |
| **Q-20** | Your answer | **Should the code repository stay public?** — section 9. Anyone can read your messages, the runbook and every finding; no credential was found in it | Nothing technical — a decision about who may read the documents | No |

**Why Q-3 and Q-12 are here when the reviewer's brief asked for four items:** your rule covers anything
needing credentials or legal text, and these two are exactly that. Where the brief and your rule
differ, your rule wins.

---

## 1. Q-1 — AWS for Bedrock India (`BE-C26`, `BE-C56`)

**What to create — four things, nothing broader:**

1. **An AWS account the company owns.**
2. **Bedrock model access** (Bedrock console → *Model access*) for **Claude Sonnet 5** and **Claude
   Haiku 4.5**. Anthropic models ask for a one-time use-case form per account.
3. **One IAM user, `elmiron-ai-gateway`**, with **no console access** and **only** the policy below.
   Create one access key for it.
4. **Give the key to the gateway as a secret, never in a file, an email or a chat.** Supabase
   dashboard → your project → *Edge Functions* → *Secrets*, these names exactly:

| Secret name | Value |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | the key id |
| `AWS_SECRET_ACCESS_KEY` | the secret |
| `AWS_REGION` | `ap-south-1` |
| `BEDROCK_SONNET_PROFILE_ARN` | the Sonnet 5 India inference-profile ARN, copied from the console |
| `BEDROCK_HAIKU_PROFILE_ARN` | the Haiku 4.5 India inference-profile ARN, copied from the console |

**The IAM policy — paste it, then replace the five `<…>` values from the Bedrock console:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeOnlyTheTwoIndiaInferenceProfiles",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:ap-south-1:<ACCOUNT_ID>:inference-profile/<SONNET_5_INDIA_PROFILE_ID>",
        "arn:aws:bedrock:ap-south-1:<ACCOUNT_ID>:inference-profile/<HAIKU_4_5_INDIA_PROFILE_ID>"
      ]
    },
    {
      "Sid": "TheTwoModelsBehindThoseProfilesOnlyInIndianRegions",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:ap-south-1::foundation-model/<SONNET_5_MODEL_ID>",
        "arn:aws:bedrock:ap-south-2::foundation-model/<SONNET_5_MODEL_ID>",
        "arn:aws:bedrock:ap-south-1::foundation-model/<HAIKU_4_5_MODEL_ID>",
        "arn:aws:bedrock:ap-south-2::foundation-model/<HAIKU_4_5_MODEL_ID>"
      ]
    },
    {
      "Sid": "NeverOutsideIndia",
      "Effect": "Deny",
      "Action": "bedrock:*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": { "aws:RequestedRegion": ["ap-south-1", "ap-south-2"] }
      }
    }
  ]
}
```

**What each part does.** The first statement allows calling **only the two inference profiles**. The
second allows the two models **only in India's two regions** (Mumbai `ap-south-1`, Hyderabad
`ap-south-2`) — Bedrock requires permission on the model in each region a profile routes to. The
third **denies every Bedrock call outside India**, so even a mistake in the first two cannot send a
request elsewhere. **Nothing else in AWS is reachable with this key.**

**⚠ Three things we could not verify. Please check them while you are in the console:**

1. **Does the India geographic inference profile carry BOTH Claude Sonnet 5 and Claude Haiku 4.5?**
   And **which regions does it route to?** If it routes anywhere other than `ap-south-1` and
   `ap-south-2`, tell us before saving the policy — the Deny statement would block it, and that is a
   residency question rather than a policy edit.
2. **Which AWS speech service is hosted in India** for voice practice — speech-to-text is Amazon
   Transcribe in Mumbai (`BE-C28`); for **speech out**, please confirm which service and voice is
   available in `ap-south-1`. **Not needed yet** — voice is not started — and it will need its own,
   separately restricted policy.
3. **Is a usable AWS key already in the project's secrets?** We could not check: the Supabase
   access token engineering holds now returns **401 Unauthorized**. Please look at *Edge Functions →
   Secrets*; and if you want engineering to verify secrets directly, issue a new **personal access
   token** (Supabase → *Account* → *Access Tokens*) to whoever runs deployments.

**Cost control:** set an **AWS Budget** with an email alert on the account. Bedrock bills per token;
the daily allowance (100 requests per MR, `BE-C30`) is the in-app ceiling, the budget is the
account-level one.

### Measured 2 October (W1-U), from the AWS service with the key the operator supplied

**Not from this page, not from documentation:** signed calls to Bedrock in `ap-south-1` — the list of
inference profiles, the model-availability report for each model, and a one-token call to each
profile. No credential was printed; error text was scrubbed of account numbers and ARNs.

**1. The India profiles — the answer to "verify" item 1 above.** There is **no single India profile
carrying both models: there is one per model**, both `ACTIVE`, both `SYSTEM_DEFINED`:

| Model | Inference profile id (copied from the service) | Underlying model id | Routes to |
| --- | --- | --- | --- |
| Claude Sonnet 5 | `in.anthropic.claude-sonnet-5` | `anthropic.claude-sonnet-5` | `ap-south-2`, `ap-south-1` |
| Claude Haiku 4.5 | `in.anthropic.claude-haiku-4-5-20251001-v1:0` | `anthropic.claude-haiku-4-5-20251001-v1:0` | `ap-south-2`, `ap-south-1` |

**Both route only to Hyderabad and Mumbai — the residency answer.** The policy above is therefore
right as drafted: its two profile ARNs take these ids, its model ARNs take these model ids in both
regions, and the Deny on any other region blocks nothing these profiles need. (The account also sees
`apac.*` and `global.*` profiles that route outside India; the adapter refuses those by construction.)

**2. Model access is a SEPARATE approval from the key — and it is not granted.** The key signs
correctly and can list profiles, but every call is refused. The service's own report for BOTH models:

| Field | Value | What it means |
| --- | --- | --- |
| `regionAvailability` | `AVAILABLE` | The model exists in `ap-south-1` |
| `entitlementAvailability` | `AVAILABLE` | The account is eligible to use it |
| `agreementAvailability.status` | **`NOT_AVAILABLE`** | **The model's terms have not been accepted for this account** — the console's model-access step (for Anthropic models, a use-case form and the terms) |
| `authorizationStatus` | **`NOT_AUTHORIZED`** | **This caller may not invoke it.** Whether this follows from the agreement alone or ALSO from the IAM policy is not distinguishable from outside — so check both |

**Who fixes it: the AWS account owner**, in the Bedrock console for `ap-south-1`: enable access to
Claude Sonnet 5 and Claude Haiku 4.5, and confirm the IAM user carries the policy above. The calls
were refused first as `AccessDeniedException`, then as `ValidationException: Operation not allowed` —
two names for one condition, which is why the availability report, not the error, is the evidence.
**This is the first-day failure the key-day checklist predicted; it fired before an adapter existed.**

**3. The Supabase access token engineering holds is dead (401).** Nothing in this project can read
production's function secrets — which is also why nobody could say whether a key was already set
there (item 3 above). A fresh token is being issued.

---

## 2. Q-2 — Google Maps Platform (`BE-C46`)

**In a Google Cloud project the company owns, with a billing account attached** (Google requires
billing to be enabled for Maps even within free usage):

| Enable this API | Used for | Key restriction |
| --- | --- | --- |
| **Maps SDK for Android** | The map in the MR app | **Android key**: application restriction *Android apps*, package **`com.praversetech.fieldforce`**, plus the **SHA-1 of every certificate the app is signed with**. **The pilot is SIDELOADED (W1-P), so its certificate is the keystore engineering signs the APK with — engineering supplies that SHA-1, not the Play Console.** Add the Play Console's app-signing SHA-1 (*App integrity*) only when the Play listing exists. API restriction: **Maps SDK for Android only** |
| **Maps JavaScript API** | Maps in the admin console, including the live-tracking view | **Web key**: application restriction *HTTP referrers* = the console's domain(s) — **engineering supplies the domain; the console is not hosted yet, so create the key restricted by API now and add the referrer when it is**. API restriction: **Maps JavaScript API only** |
| *Geocoding API — only if you want clinic addresses turned into coordinates automatically on import* | Clinic import | A third key, API-restricted to Geocoding. **Say if you want this; otherwise do not enable it** |

**Billing safeguards:** a budget alert on the billing account, and a **daily quota cap** on each enabled
API (*APIs & Services → Quotas*). **We have not priced it** — Google's per-request pricing and free
allowances change; please read the current Maps pricing page for the two APIs above.

**Send us:** the two keys (as secrets, as with AWS), and the Google Cloud **project id**.

**How the account stays swappable — one place per app, configuration only:**

* **MR app:** `apps/field/app.config.ts` reads **`GOOGLE_MAPS_ANDROID_API_KEY`** from the build
  environment. Changing the account = a new key in that variable and **a new build** (an Android
  map key is compiled into the app, which is a property of Android, not of our code). No code change.
* **Console:** **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** in the console's environment. Changing it = a
  redeploy. No code change.
* **No code anywhere names a Google project.** **Not built yet** — this is the design the build will
  follow, and maps also needs a map library added to the app, which is a dependency we will ask you
  to approve separately.

---

## 3. Q-3 — Firebase Cloud Messaging (`BE-C47`)

**In the company's Google account** (the same Google Cloud project as Maps is fine — a Firebase
project *is* a Google Cloud project):

1. **Create a Firebase project** (or add Firebase to the Maps project).
2. **Register the Android app** with package **`com.praversetech.fieldforce`** and download
   **`google-services.json`**. Send it to us; it is configuration, not a secret.
3. **Make sure the Firebase Cloud Messaging API (V1) is enabled.**
4. **Create one service account for sending**, with **only** the role **Firebase Cloud Messaging API
   Admin**, and create a JSON key for it. **Give it to us as a secret**, never as a file attachment.

**Not built yet.** It also needs a notifications library added to the app — a dependency ask.

---

## 4. Q-4 — the sixteen lost subjects (`BE-C43`)

**We cannot list them, and we will not send you a guessed list.** Your 31 answers reached engineering
only as a summary carrying 15 of them, and the question list they answered is not anywhere we can
reach — searched: the repository, its history since 27 September, and the session records. Writing
16 subjects from inference would be the same failure that lost them, one step further on.

**What we can say from evidence:**

* **Your second message (21 items, `BE-C41`–`BE-C61`) probably re-answers several of them.** These
  subjects appear there and were **not** among the 15 recorded on 1 October: the sample cap,
  claim approval, live tracking, maps, notifications, the six screens, the territory hierarchy, the
  product master, the doctor master, the PV signatory, the second admin, the production order, the
  paid plan and monitoring, and the AI privacy limit. **All are now recorded.**
* **Three items from our 30 September list were not mentioned in either message:** the second admin
  (now answered by C-2), the deploy order (now answered by C-3), and **source material for LMS
  courses** — the last is still open.

**The fix is on our side, not yours:** the reviewer holds your original message. **We have asked for it
to be forwarded verbatim.** You will not be asked to repeat answers you have already given.

---

## 5. Q-5 — territories and MRs: `docs/operator/territory-template.xlsx`

**Three sheets.** *Read me*; *Territories* (`level, name, code, parent_code, company`); *MRs*
(`name, email, mobile, territory_code, company`). Example rows show the format; **delete them before
sending — any code starting `EXAMPLE-` is refused.**

**Send back:** each data sheet saved as CSV (*File → Save As → CSV UTF-8*).

**What the checker refuses, by row number, before anything is loaded**
(`services/api/scripts/check-territory-sheet.mjs`, every refusal tested in
`services/api/tests/territory-sheet.spec.ts`):

| Refused | Why |
| --- | --- |
| **A parent that does not exist** | `parent_code` is not a code on the sheet |
| **A duplicate code** | **Codes must be unique across every company, not just yours** — the database enforces it that way |
| **A missing company** | Every territory and MR row names its company |
| A parent in another company | A company's tree cannot borrow another company's node |
| A level that skips a step | National has no parent; a Region's parent is a National; an Area's parent is a Region |
| An unknown level | Only National, Region, Area or Territory |
| An MR on a missing or non-Area territory | MRs sit on Area/Territory rows |
| An MR in a different company from their territory | |
| A duplicate MR email | One sign-in account per MR |
| An example row left in | So example data can never be loaded |

**MR sign-in accounts are created separately**, one per MR row, after the territories load.

---

## 6. Q-15 — should Product Q&A notice side effects, off-label requests and complaints? (`BE-W134`)

**The question, in one line: when a rep types something into Product Q&A that sounds like a side
effect, an off-label use or a product complaint, should the assistant flag it — or is spotting those
the rep's job?**

Three examples the system was written to expect, and what happens today:

| The rep types | What a flag would mean | What happens today |
| --- | --- | --- |
| "A doctor told me someone developed a rash after starting [product]" | Possible **side effect** — someone should review it | Answered (or refused) like any question. **Nothing is flagged** |
| "Can [product] be used for migraine?" | **Off-label** request | Refused, because no approved material covers it. **Not flagged as off-label** |
| "The strips I received had broken tablets and a wrong label" | Possible **quality complaint** | Treated as a question. **Nothing is flagged** |

**Why this is your decision, not ours.** You already decided the rep **flags a possible adverse
event themselves** and makes no medical assessment (`BE-C36`). That covers the side-effect case
through the rep. Whether the assistant should ALSO notice — a second net, or a second opinion
nobody asked for — is a compliance choice.

**What each answer costs:**

* **"Yes, the assistant should notice."** New work: a step that reads every question for these three
  signs before answering. It needs the real model (Q-1) to be any good — keyword matching would
  flag "rash" in a training question and miss the same report in other words. Each flag then needs
  somewhere to go and someone to review it, which is the PV workflow (Q-13). **Not before 4 October.**
* **"No, that is the rep's job."** No work. The three tests that expect the assistant to flag these
  are **deleted**, not left looking as though they are waiting for something — they can never pass,
  with any model, because nothing in Product Q&A is built to raise these flags.

**Nothing is decided until you answer.** Until then the three tests stay marked as waiting on this
question, by name, in every test run.

## 7. Q-16, Q-17, Q-18 — three questions before the manager can plan the MR's day

**2 October 2026, W1-V D.** You decided the manager plans the MR's day (your item 10). The design is in
`docs/design/MANAGER-PLANS-THE-DAY.md`; **nothing is built**. Each question below is answered with one
word. If you would rather we decide, say "you decide" and we use the default shown, which can be
changed later.

### Q-16 — May a manager plan for their **direct reports** only, or for **everyone** beneath them?

| Answer | What it costs |
| --- | --- |
| **Direct** | Smallest permission. A regional manager cannot plan for an area manager's MRs. No extra work |
| **Everyone** | About the same work — managers can already *see* everyone beneath them. But two managers can then plan the same MR's day, so we must also decide whose change wins: **about +1 day** |

**Default if you say "you decide": Direct.** It is the narrower permission, and widening it later takes
nobody's access away (about half a day). Narrowing it later would.

### Q-17 — Does the manager plan on the **web** console or on the **phone**?

| Answer | What it costs |
| --- | --- |
| **Web** | **5–8 days** for three screens on the existing console (plan a week, reschedule or cancel, completion review) |
| **Phone** | **Estimated 7–10 days**, and less certain: placing a week of visits on a small screen needs new design work, and the phone app has no manager screens of this kind today |
| **Both** | Roughly the two added together |

**Default if you say "you decide": Web.** Planning a week is desk work, and the console already exists.

### Q-18 — Does an MR's unplanned visit need the manager's approval **before**, **after**, or **never**?

| Answer | What it costs |
| --- | --- |
| **Before** | The MR waits at the clinic until the manager answers — and cannot ask at all without signal. Needs an approval queue and a way to alert the manager, and notifications are not set up yet (Q-3). **About +3–4 days**, and it can stall field work |
| **After** | The visit happens; the manager sees it marked "unplanned" in completion review and accepts or questions it. **About +1–2 days** |
| **Never** | The visit is recorded and shown as unplanned. **No extra work** beyond letting the app add the visit (`FE-W28`, already counted) |

**Default if you say "you decide": After.** The MR can work offline, and the manager still sees and
answers every unplanned visit.

**The day figures above are estimates, not measurements.** The assumptions behind them are listed in
`docs/design/MANAGER-PLANS-THE-DAY.md`, "What the estimate assumes".

## 8. Q-19 — where may a backup of the production database be kept?

**5 October 2026, W1-W E.** One question, one word: **GitHub**, **Bucket**, or **Supabase**.

**Why it is urgent now.** You approved the production deploy (item 8). **Its first step is a backup
taken today** (`docs/DEPLOY-RUNBOOK.md` 0.1), and there is no backup, because nobody has said where one
may go. So the deploy is approved and cannot start. It was attempted on 5 October and stopped at that
step — nothing in production was changed.

**A second date.** The backup job has been allowed to sit idle until **15 October**. From
**16 October** (UTC) it turns red, every Monday it runs, until this is answered or the date is moved
in a commit that says why.

**Why it is your decision.** A copy of this database holds every user account, doctors' names, the
consent records and adverse-event text. Where it is kept is a data-protection choice, not a technical
one (`docs/blocked-on-you.md` 6.3).

| Answer | What it means | What it costs | Work after your answer |
| --- | --- | --- | --- |
| **Supabase** | Supabase's own daily backups, part of the paid plan you approved | Nothing extra — if the plan includes backups, which has never been checked (6.2) | Confirm the plan is active and takes backups; change runbook step 0.1 to "a Supabase backup from today exists". **About 1 hour** |
| **GitHub** | The copy is kept with the code, as a GitHub file kept about 90 days | Free | Add the step that stores it. **About half a day** |
| **Bucket** | Your own storage (Amazon S3, Google Cloud), with a key you create | A few dollars a month, plus creating the bucket and key | Add the step that stores it there. **About half a day** |

**Engineering's recommendation, not a default:** **Supabase.** The data stays with the company that
already holds it, with no new place and no new key (where Supabase stores its backups has not been checked). This one is not ours to default.

**Found while preparing this question (`BE-W143`):** whichever answer you give, **we still have to add a
step**. The backup job today would make a copy, check it, and then throw it away — it never stores it
anywhere. The note in the job that says "no code change needed" is wrong. That is engineering's
mistake, not something you need to act on; the times above include fixing it.

**The time estimates are ours, not measured.**

## 9. Q-20 — should the code repository stay public?

**5 October 2026, W1-Z D.** One word: **Public** or **Private**. Engineering has not changed the setting.

**What anyone on the internet can read today**, and has been able to since August: your own messages
to the team, copied word for word (`docs/operator/`); the production deploy runbook, step by step; every
finding about what the system cannot yet do and why (the engineering logs, the status tables, the
4 October score); the draft privacy notice and the territory template; the names of the people working
on it; two company email addresses; and **the identity of the production database** — its project id and
host, in Mumbai. **No password, key or token was found** — every commit on every branch was checked
(232,802 added lines); the only key-shaped strings are the public demonstration keys every local
Supabase install ships with, and placeholders. So this is a decision about candour and reconnaissance,
not about a leak.

**Making it private costs money, and breaks one thing unless you pay.** This repository used about
**3,200 build minutes a month** at last week's pace; I believe a private repository on GitHub's free
organisation plan includes about **2,000**, so builds would stop or bill once a month ran out. The
branch-protection rule recommended on 5 October (no merge without a green build) is, I believe, available
on a private repository only on a **paid plan (GitHub Team, roughly US$4 per person per month, which also
raises the minutes)** — on the free plan, private would mean choosing between protection and privacy.
**Please check those three figures on GitHub's pricing page; they are from memory, not measured.**
Nothing else breaks: the people already on the team keep their access, and no code changes.

**Engineering's recommendation, not a default: Private, on GitHub Team.** The documents were written
for the team, not for the world.

## 10. Q-21 — should a course need a second admin's approval before reps can take it?

**7 October 2026, W2-G B5.** One answer: **Yes, four eyes** or **No, one admin publishes**.

**Today one admin publishes a course and reps can take it at once.** Prompts and approved knowledge each
need a SECOND admin to approve them (the database refuses an approval by the author), because what they
say reaches reps as if the company said it. A course is training text an admin wrote, and it also reaches
reps as the company's word — but nothing checks it before it does. This is a choice, not a defect: the
course rules were written before four eyes was the pattern (`20260924000500_lms_core.sql`).

* **Yes** — engineering adds a review step to course versions (submit → a different admin approves →
  published), the same shape as prompts: about half a day, and nothing can be taken until two admins
  exist (Q-14).
* **No** — nothing changes; the screens built on 7 October already work this way.

**Engineering's lean, not a default: Yes, if courses will carry product information** (dosing, storage,
claims) — that is regulated content. **No, if they are process training only.** You know which they are.
