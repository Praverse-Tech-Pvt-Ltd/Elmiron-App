# Key day — the OpenAI key arrives (`BE-W206`)

**The only page you need on the day.** The pilot's AI provider is **OpenAI** (`BE-C79`). Everything
else is built: the gateway calls OpenAI when told to, the live suite checks it, and one command makes a
local test company with every feature switched on. Written 14 October 2026.

## A. Local — on this laptop, today

| # | Do | What you should see |
| --- | --- | --- |
| 1 | Copy `services/api/supabase/functions/.env.example` to `.env` in the same folder. **In an editor** (never `echo >>` — Trap 4 in `START-HERE.md`) set `AI_PROVIDER=openai` and paste the key after `OPENAI_API_KEY=`. Save. Never paste the file anywhere else | the file is git-ignored; `git status` does not list it |
| 2 | `pnpm db:start` | ten containers in `docker ps` |
| 3 | `pnpm key-day` | ends `READY — TEST Key-day Pharma …`, five test accounts and one password, and `OPENAI_API_KEY is present` (never the key). If it says **`STOPPED: the database is not the code's`**, run `pnpm db:reset` and step 3 again |
| 4 | `pnpm functions:serve` — a second terminal; leave it running; **restart it whenever the `.env` changes** | it keeps running; re-running `pnpm key-day` now says `ai-gateway answers` |
| 5 | `pnpm ai:live` | see "It worked", below |
| 6 | Sign in and use it: the console (`apps/console`: copy `.env.example` to `.env.local` once, `pnpm --filter @fieldforce/console dev`, `http://localhost:3100/sign-in`) as admin A or B; the phone with the demo APK `pnpm key-day` printed the command for (`build-demo-apk.ps1 -Ip <laptop address> -AllFeatures`, about 18 minutes) as rep 1 or rep 2 | Product Q&A, the assistant, the lesson tutor and AI Doctor practice answer from OpenAI |

`pnpm key-day` is safe to run again: it re-uses its company (`--fresh` makes a new one). It never reads
out, prints or stores the key.

### It worked

`pnpm ai:live`'s first lines say **`gate: READY (openai)`** and **`gate: SKIPPING — AI_PROVIDER=openai —
this suite checks the Bedrock India profiles only`**, and the last two lines read **`Test Files 2 passed`**
and **`Tests 11 passed | 2 skipped (13)`** — nine checks of the five features: each answered
(`completed`, provider `openai`, the feature's model, real token counts) and each patient detail
refused before OpenAI was called. **Read the runner lines: a skipped suite also exits 0.**

| If the first line says | It means | Do |
| --- | --- | --- |
| `SKIPPING — no services/api/supabase/functions/.env` / `AI_PROVIDER is not set` | step 1 not done | step 1 |
| `SKIPPING — … still the .env.example placeholder` | the key was not pasted | step 1 |
| `REFUSED — OpenAI refused the key (HTTP 401 invalid_api_key)` | a wrong, revoked or mistyped key | paste it again, in an editor |
| `REFUSED — … no quota (HTTP 429 insufficient_quota)` | the OpenAI account has no credit | add billing to that OpenAI organisation |
| `REFUSED — … model "gpt-4.1" is not available to this key (HTTP 404 …)` | the key's project cannot use the model | allow the model for the project in OpenAI's dashboard |
| `SKIPPING — ai-gateway is not served` | step 4 not running | step 4 |
| a red saying `answered by the STUB` | `functions:serve` was started before the `.env` was saved | restart step 4 |
| any other red | the first real model failure | `docs/ai-platform/DAY-ONE.md`, A2: the predicted failures and their remedies |

**Before the ordinary test suites, remove `AI_PROVIDER=openai` from the `.env` and restart
`functions:serve`** — the HTTP suites expect the stub (`DAY-ONE.md` #12). The pre-push hook runs them.

**Still off, on purpose:** recording and coaching of real visits (`EXPO_PUBLIC_RECORDING_ENABLED`,
`EXPO_PUBLIC_COACHING_ENABLED`) and practice scenario S6 — decision `D-15`, blocked on the PV/DPDP
signatory (Q-13). Nothing on this page changes that.

**Models.** `gpt-4.1` (Product Q&A, AI Doctor, the coach) and `gpt-4.1-mini` (assistant, lesson tutor),
from `OPENAI_MODEL` in `packages/core/src/field/gateway/prompt-contract.ts`. **OpenAI has announced both
shut down on 14 January 2027** (its deprecations page, entry dated 14 October 2026): enough for the
pilot's start, not for a long pilot — `BE-W207`.

## B. Production — later, only when the owner says so

Nothing below has been done, and nothing in `pnpm key-day` touches production.

1. **Edge Function secrets** (Supabase dashboard → Edge Functions → Secrets), set by the operator:
   `AI_PROVIDER=openai` and `OPENAI_API_KEY=<the key>`. The key is a server secret: never in the app,
   the console, an `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` value, the repository or a chat.
2. **The `practice_writer` key** (Settings → API Keys, `BE-C72`): the gateway closes every request with
   it, so all five features need it, not only practice (`DAY-ONE.md`, H4 and H7).
3. Deploy, then switch on and check: **`docs/DEPLOY-RUNBOOK.md`** (step 1.3 deploys `ai-gateway`), then
   `DAY-ONE.md` H6–H10 — a real second admin approves the instruction sets (the local approvals were a
   TEST company's and count for nothing), `ai-switches.mjs on all`, one request per feature read back
   from `ai_requests`.
