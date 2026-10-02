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
