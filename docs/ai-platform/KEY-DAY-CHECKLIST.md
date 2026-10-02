# The hour the AWS key arrives — checklist (W1-Q D)

**Written before the key, on purpose. The adapter is NOT written here** (`D3`): code that cannot be
exercised is a claim. This file is so the first hour is spent connecting, not discovering.

Every statement below about this repository cites a file. **Statements about AWS are marked
"verify"** — they are from general knowledge, not from anything in this repository, and an AWS
console is the source of truth on the day.

---

## D1 — what to do, in order

### 1. The files that change

| File | Change |
| --- | --- |
| `services/api/supabase/functions/_shared/<vendor>-provider.ts` | **NEW** — implements `LlmProvider` (`packages/core/src/field/gateway/providers.ts`). One method: `generate({ messages, modelConfig, json, signal })` → `{ text, usage, provider, model }` |
| `services/api/supabase/functions/ai-gateway/index.ts` | **The one construction line**: `provider = createStubProvider(STUB_SHAPE[feature])`. It becomes "the real adapter when the deployment has credentials; the stub on a local target". **Keep the stub for local and CI** — see D2 #12 |
| `packages/core/**` | **Nothing.** Business logic never names a vendor (`providers.ts` header). If a flow has to change on the day, that is a finding, not a step |

### 2. The environment the function needs — as SECRETS, never in a file

`supabase secrets set …` for the deployed function; a git-ignored env file for `functions serve` locally.

| Variable | What |
| --- | --- |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the credential (Q-1). Verify whether a session token is also issued |
| `AWS_REGION` | `ap-south-1` (Mumbai) — the residency the operator set (`constraints.md`) |
| `AI_MODEL_ID` (name to choose) | the **inference profile** id, not a bare model id. Verify the India geographic profile's exact id in the Bedrock console, and that **model access is enabled in that region** |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are already read (`ai-gateway/index.ts`).

### 3. Region and profile — ASSERTED, not merely configured

**Today they are asserted nowhere.** Grep finds `ap-south-1` only in a latency script's comment and
in backup tests; no code refuses a wrong region. The audit row's `model_provider` / `model_name` are
whatever the adapter SAYS (`LlmResult.provider`/`.model`, "never used to branch on").

So the adapter must, mirroring the stub's own refusal (`stub-provider.ts`, `isLocalTarget`):

- **refuse to construct** unless `AWS_REGION === 'ap-south-1'`;
- **refuse to construct** unless `AI_MODEL_ID` is an India-scoped profile (the prefix to check is a
  verify item — do not guess it into code);
- report `model` as the profile id it actually called, so the audit row names it;
- have a unit test for each refusal, two-sided, before the first real call.

### 4. The tests that prove it end to end

| Test | Today | On the day |
| --- | --- | --- |
| `packages/core/**/*.test.ts` (scripted providers) | green | unchanged — they test the CODE, not the model |
| `services/api/tests/{ai-gateway,mr-chat,lms-tutor,sim-gateway}.spec.ts` | green against the stub | **unchanged and still against the stub** — they drive `[STUB:…]` branches |
| **A live suite, gated on the credential being present** | does not exist | one call per feature against a local stack holding the secrets; asserts the audit row below. Write it on the day, alongside the adapter |
| `ai-product-qa.spec.ts` todo `related-but-unanswered` | todo (W1-Q A) | becomes runnable against the real model |
| `services/api/scripts/measure-provider-latency.mjs` | never run | run **from inside `ap-south-1`**. It sends `PROVIDER_AUTH` as a header — Bedrock normally needs SigV4 signing, so verify whether it can call Bedrock as written |

### 5. What the audit row must show (`ai_requests`)

| Column | Must be |
| --- | --- |
| `status` | `completed` |
| `model_provider` | the adapter's name — never `stub` |
| `model_name` | the India inference profile id from step 3 |
| `input_tokens`, `output_tokens` | non-null and > 0 (the stub reports fixed small numbers) |
| `prompt_version_id` | the APPROVED prompt for that feature |
| `knowledge_version_ids` | product_qa only: the version the answer cited |

**The row is self-reported by our adapter.** Cross-check one request against AWS's own record of the
call in `ap-south-1` (verify: Bedrock model-invocation logging or CloudTrail) — that is the only
evidence the right model, in the right region, answered.

---

## D2 — what will FAIL the first time a real model answers, and why

Enumerated from the contracts (`providers.ts`, the five flows, `simulation.ts`, the migrations), not
from guesses about the vendor. **Ordered by how early it bites.**

| # | What will fail | Why — from the contract | What the log will say |
| --- | --- | --- | --- |
| 1 | **Every request, before the model** | No production prompt is approved (`4-OCTOBER.md` item 7); `ai_begin_request` raises "has no approved prompt" (`20261001000200_ai_allowance_warning.sql:124`), and approval needs the second admin (Q-14) | a refusal from `ai_begin_request`, no row reaching the model |
| 2 | **Deployed function still answers 503** | The construction line builds the stub, which refuses any non-local target (`no_provider`). Until step 1 changes it, production cannot reach a model | HTTP 503 `no_provider` |
| 3 | **JSON with a sentence before it** | `generateStructured` accepts bare JSON, or JSON wrapped WHOLLY in one code fence (`stripCodeFence`). "Here is the JSON: {…}" is `not_json` | `schema_invalid`, request `failed` |
| 4 | **A model refusal** | A refusal is prose, so it is `not_json` — **logged as `schema_invalid`, indistinguishable from malformed output.** No flow classifies a refusal | `schema_invalid` — misleading |
| 5 | **Every vendor error looks the same** | Each flow's `catch` maps anything that is not `ProviderTimeoutError` to `provider_error`. Model access not enabled, a wrong profile id, throttling and bad credentials all become one code, and the vendor's error name is not stored | `provider_error`, nothing more |
| 6 | **The coach times out** | Every flow defaults to 20 s (`withTimeout(input.timeoutMs ?? 20_000)`); the gateway passes no `timeoutMs`. The coach's output is the longest of the five (7 scores, findings, modules, summary over a whole transcript) | `provider_timeout` (now unit-tested in all five flows, W1-Q B2) |
| 7 | **A timed-out call keeps running** | `withTimeout` aborts the `signal`; only an adapter that passes `signal` to the SDK actually stops the call. Otherwise it completes and is billed after the rep was told it failed | nothing — invisible |
| 8 | **Citations reformatted** | `citedChunkIds` must be UUIDs (`UuidSchema`) AND ones the flow supplied; the coach's `turnIndex` a positive int in the session; `moduleId` one it was offered | `schema_invalid`, or `guardrail_triggered`/`unsupported_citation`, `unknown_turn_cited` (`BE-W133`), `unknown_learning_module` |
| 9 | **Scores as decimals or strings** | `ScoreSchema` is `int` 0–100; `7.5`, `"80"` or `8/10` fail. Dimension keys must be exactly the seven snake_case names | coach `schema_invalid` |
| 10 | **More product chat refused than expected** | `mr_chat` discards an answer that NAMES a catalogue product, whatever the model said about scope (`mr-chat.ts`). A real model mentions products far more than the stub | `out_of_scope`, flags `guardrail_triggered` + `off_label_request` — correct by design, but the rate will surprise |
| 11 | **Long answers pass, and cost** | No output string has a max length (`answer`, `explanation`, `reply`, `summary`); the allowance counts REQUESTS, not tokens | nothing fails — but tokens per request will be the first cost surprise |
| 12 | **The HTTP suites break if the real provider is used in CI** | 30+ tests drive `[STUB:<branch>]` directives (W1-P D2). Against a real model they are ordinary text | dozens of reds that are not defects |
| 13 | **Three benchmark cases still cannot pass** | `adverse-event-in-question`, `off-label-flagged`, `quality-complaint-in-question` expect flags NO product_qa step can set (`BE-W134`). A real model does not change that | they stay `todo` |

**#4 and #5 are the two that make a first failure hard to diagnose.** Both are in the five flows'
`catch` blocks, which are vendor-neutral, so fixing them is not adapter work — it can be done before the
key. Not done here: it changes what `ai_requests.error_code` records, which is a contract change, and
deserves its own decision.
