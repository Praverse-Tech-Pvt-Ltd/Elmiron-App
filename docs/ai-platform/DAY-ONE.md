# Day one — from "the credential is present" to "all five features verified" (W2-D A)

**This is the one page to follow.** It replaces the six steps of `KEY-DAY-CHECKLIST.md` (W1-V A6) and
the five of the W1-Z B5 list in `docs/log/backend.md`, and adds the steps that arrived since (the named
practice-writer key, `BE-W162`; the deploy; `BE-W146`'s gate). `KEY-DAY-CHECKLIST.md` stays as the record
of how each step was derived; where the two disagree, this page is the later one.

**The one command is `pnpm ai:live`.** It runs `bedrock-live.spec.ts` (the two India profiles) and
`ai-live.spec.ts` (all five features through the real gateway, using the DRAFT instruction sets in
`drafts/`). Its first line always says where you are:

| First line of `pnpm ai:live` says | Meaning | Do |
| --- | --- | --- |
| `SKIPPING — no credential (…)` | `services/api/supabase/functions/.env` absent or incomplete | step 1 |
| `SKIPPING — model access not granted (ValidationException)` | the credential works; the AWS account owner has not enabled the models. **This is the line on 6 October** | wait — that is not an engineering step |
| `SKIPPING — AI_PROVIDER is not bedrock in …/.env` | the gateway would answer from the stub | step 2 |
| `SKIPPING — no local database` / `no function served` | the local stack is not up | step 3 |
| `gate: READY` and green | every feature answered by its India profile, every patient detail refused before the model | step 5 |
| `gate: READY` and red | the first real failures — read the failing assertion against the table below | step 5 |

## The local path — engineering, one person, about 2 hours once access is granted

| # | Do | Proves |
| --- | --- | --- |
| 1 | The credential in the git-ignored `services/api/supabase/functions/.env`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=ap-south-1`. Never in a commit, log or message | `pnpm ai:live` gets past "no credential" |
| 2 | Add `AI_PROVIDER=bedrock` to the same file (a setting, not a secret) | past the stub gate |
| 3 | `pnpm db:start`, then `pnpm functions:serve` from the repository root, **started after step 2** — a server started earlier keeps the stub, and the suite will go red saying `model_provider: 'stub'` | the gateway builds Bedrock |
| 4 | `pnpm ai:live` | 13 tests: two profiles; five features answered (`completed`, `bedrock`, the feature's India profile, real tokens, the approved prompt); four patient details `blocked` with `model_provider` null |
| 5 | Read every red against the predictions below; record which fired | the first failures, named |
| 6 | Remove `AI_PROVIDER=bedrock` before running the ordinary suites (prediction #12), and delete the `.env` when the AI work is finished | no credential left on the machine |

**What step 4 does for you that the old step 3 left to a person:** it seeds the product, market and
approved knowledge, a published lesson with the rep enrolled, a persona and scenario approved by four eyes,
the five flags, and the five prompts — each the DRAFT text from `drafts/`, submitted by one fixture admin
and approved by another. `seed-practice-world.mjs`, which the old step 3 named, creates **people only**.

## The hosted path — production. People first, then engineering

| # | Who | Do |
| --- | --- | --- |
| H1 | AWS account owner | Enable model access for both India profiles in `ap-south-1` (the gate above) |
| H2 | engineering | ~~Fix `BE-W164`~~ **FIXED W2-E** — the console now writes the schema name from the feature, offers all five features and requires the two limits; proved by the browser suite crossing into the gateway (#15, #16 below) |
| H3 | engineering | ~~Fix `BE-W163`~~ **FIXED W2-E** — the coach's contract now spells out the JSON (#14) |
| H4 | engineering | ~~Fix `BE-W146`~~ **FIXED W2-E** — the gateway closes every request as the service role (`ai_gateway_complete_request`, `BE-C74`); the rep can no longer write status, model or tokens. **The `practice_writer` key (H7) is now needed by all five features, not only practice** |
| H5 | operator | Edit and accept the five drafts and the personas/scenarios (`drafts/README.md` lists the decisions only the operator can make) |
| H6 | admin A, then a DIFFERENT admin B (Q-14) | `/prompts`: five instruction sets; `/practice`: five personas, six scenarios. Submit as A, approve as B |
| H7 | operator (dashboard) | Edge Function secrets: the three AWS values and `AI_PROVIDER=bedrock`; Settings → API Keys: create `practice_writer` (`BE-C72`) |
| H8 | engineering | Deploy `ai-gateway`; switch each `ai_feature_enabled:<feature>` on for the company |
| H9 | content owners, then an admin | Approved product documents (Q-9) for `product_qa`; courses for `lms_tutor`. **W2-H: both have loaders** — copy `docs/operator/course-template.md` / `knowledge-template.md`, then `node services/api/scripts/load-course.mjs <file>` / `load-knowledge.mjs <file>` (check), then `--write` as an admin (`LOADER_PASSWORD` in the environment). Each writes a DRAFT: a course is then published, a document submitted and approved by a second admin. **The market and product a file names must already exist** — nothing but a hand-written insert creates them yet |
| H10 | engineering | One request per feature against production, read back from `ai_requests`; cross-check one against AWS's own record of the call (D1 §5) |

## A2 — the predicted first-call failures, each with its remedy

**The brief said eleven; the table has thirteen**, and W2-D's reading of the code added three. Status
is from the code on 6 October, with the file that shows it.

| # | Prediction | Status | Remedy |
| --- | --- | --- | --- |
| 1 | No approved prompt — every request refused | **OPEN in production**; handled locally (the live suite approves the drafts) | H5–H6: drafts exist now (`drafts/`); the second admin (Q-14) |
| 2 | Deployed function answers 503 `no_provider` | **OVERTAKEN in code** — `AI_PROVIDER=bedrock` builds Bedrock (`ai-gateway/index.ts`, the construction line, W1-V) | H7–H8: the secret and the deploy |
| 3 | JSON with a sentence in front → `schema_invalid` | OPEN — deliberately not loosened (W1-S B) | if it fires: force JSON in the adapter, not a looser parser |
| 4 | A refusal logged as `schema_invalid` | **FIXED before the key** (W1-S B, `BE-C64`); the adapter sets `refused` from the stop reason (`bedrock-provider.ts`) | — |
| 5 | Every vendor error looks the same | **FIXED before the key** (W1-S B); `ProviderError(name)`. It fired on 2 October under two names for one cause (W1-U) | read `GetFoundationModelAvailability`, not the error name |
| 6 | The coach times out at 20 s | OPEN — no flow is given a `timeoutMs` | if it fires: a longer `timeoutMs` for `ai_coach` in the gateway, not a smaller `maxTokens` |
| 7 | A timed-out call keeps running and is billed | **OVERTAKEN** — the adapter passes the abort signal to the SDK (`bedrock-provider.ts`, `abortSignal`) | — |
| 8 | Citations reformatted → `unsupported_citation` / `unknown_turn_cited` | OPEN — needs a real model to show | the drafts say "copied exactly"; if it fires, it is prompt work |
| 9 | Scores as decimals or strings | OPEN | the coach draft says "WHOLE NUMBER" and gives anchors |
| 10 | `mr_chat` refuses more than expected (names a product) | OPEN, by design | the `mr_chat` draft tells the model not to name products at all |
| 11 | Long answers pass, and cost | **OVERTAKEN** — the adapter honours `modelConfig.maxTokens` (`bedrock-provider.ts`); each draft proposes a cap; **since W2-E the console requires `temperature` and `maxTokens` on every new version** (`BE-W164`) | the operator chooses the numbers when authoring |
| 12 | The HTTP suites break against a real provider | **OVERTAKEN** — the stub stays unless `AI_PROVIDER=bedrock`, which CI never sets | step 6: remove the setting before ordinary runs |
| 13 | Three benchmark cases cannot pass (`BE-W134`) | OPEN, unchanged | `BE-W134` |
| **14** | **Every coach analysis fails `schema_invalid`** — the coach's contract never names its JSON keys; the other four do (`sim-doctor.ts`, `analyseSimSession`) | **FIXED W2-E** — `BE-W163`: `SIM_COACH_OUTPUT_CONTRACT` names every key; `contract-keys.test.ts` checks all five flows | name the keys in the code's contract; meanwhile the coach DRAFT carries them |
| **15** | **Every prompt approved in the console fails `prompt_schema_mismatch`** — the screen saves no `output_schema_name` (`prompt-review-list.tsx`), and all five flows refuse a prompt without the right one (`product-qa.ts`, `mr-chat.ts`, `lms-tutor.ts`, `sim-doctor.ts` ×2). The console's browser test approves a prompt and never calls the gateway, which is why nothing saw it | **FIXED W2-E** — `BE-W164`; `promptDraftRow` (`prompt-contract.ts`) and the browser suite's crossing test | the console sets the schema name from the feature (a fixed map from `@fieldforce/core`), never typed |
| **16** | `mr_chat` and `lms_tutor` cannot be authored at all — `/prompts` offers three features (`prompts/page.tsx`, `OFFERED_FEATURES`); and no feature's `model_config` can be set | **FIXED W2-E** — `BE-W164`: five features offered (`GATEWAY_FEATURES`); limits required; the model shown, not chosen | add the two features (both have gateway paths now); a model-config field |

**Overtaken: #2, #7, #12 fully; #11 partly. Fixed before the key: #4, #5. Open: #1, #3, #6, #8, #9, #10,
#13. New and open: #14, #15, #16** — all three findable without the key, and all three would have been
the first thing day one saw. **W2-E (7 October): #11 fully overtaken; #14, #15 and #16 FIXED** — see the rows.

## A4 — the hours, split

**Estimates, not measurements**, from the work items' own sizes.

| Engineering | Hours |
| --- | --- |
| Local path, steps 1–6, including reading the first failures | 2 |
| `BE-W163` (coach keys in the contract, with a test) | 1 |
| `BE-W164` (console: schema name, two features, model config, tests) | 3–4 |
| `BE-W146` (the forgeable request log, before production traffic) | 8 |
| Deploy, flags, one production request per feature (H8, H10) | 1–2 |
| ~~The app: assistant and practice transports, wording, a new build (W1-Z B5 3–5)~~ **done W2-G**: both transports are live behind `EXPO_PUBLIC_ASSISTANT` / `EXPO_PUBLIC_PRACTICE` (off); on the day, set both to `true` and run the build script | ½ |
| **Engineering total** | **about 23–25 hours — three working days** |

| Waiting on a person | Who | Effort once they act | When |
| --- | --- | --- | --- |
| Model access (H1) | AWS account owner | minutes | **unknown — the whole path waits on it** |
| The drafts' decisions (H5) | operator | about half a day of reading and choosing | unknown |
| Approval (H6) | a second admin (Q-14) — **none exists yet** | 1–2 hours of reading | unknown |
| Secrets and key (H7) | operator | 15 minutes | unknown |
| Product documents and courses (H9) | content owners, plus about 1 day of loader engineering each | days | unknown |

**The honest summary: about three days of engineering, none of which is the critical path.** The critical
path is four people's actions, none of which has a date.
