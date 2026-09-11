# Architecture

> **Pointer file.** The real system map is already written and tracked:
>
> - `docs/mr-app-plan.md` — the plan, the tech stack, and §0's five findings that
>   shape everything. **Read §0 before proposing anything.**
> - `docs/mr-app-architecture.html` — the diagram.
> - `docs/mr-work-split.md` — who owns which contract (I1–I4) and the interface rules.
> - `PROJECT-OVERVIEW.md` → "Architecture decisions" — every structural choice and
>   what it rules out.
>
> Duplicating those here would create a second copy that drifts. What follows is only
> the thirty-second orientation.

---

## The split that governs everything

**Two apps, two codebases, two databases.** This repo is the **MR app** — commercial
domain, users are MR / MR Manager / Admin, and it **contains no patient PII, ever**.
The patient app is a separate project with a separate database.

They connect at exactly two points, both one-way:

1. Anonymised aggregates, clinical → commercial, suppressed under 5 patients.
2. The **adverse-event routing endpoint**, commercial → clinical PV queue. The MR app
   hands an AE to the same human queue the patient diary feeds and **never handles it
   itself**. _(Not built — blocked on the PV/privacy sign-off.)_

## Workspaces

| Workspace | What it owns |
| --- | --- |
| `packages/core` | Contract **I1** — Zod schemas, types derived via `z.infer`, the typed API client. One source of truth. |
| `packages/ui-tokens` | Design tokens, shared with the patient app. |
| `services/api` | Migrations, rollbacks, database tests, the retention and reconciliation workers. |
| `services/mock` | Contract **I2** — a running mock server conforming to `packages/core`. Frontend builds against it for twelve weeks. |
| `apps/field` | The MR app (Expo). |
| `apps/console` | The manager/admin console (week 11). |

## Where the logic actually lives

**In the database, on purpose.** There is no application server. PostgREST exposes
the schema; validity rules live in RPCs and triggers, not in a service layer. The two
consequences worth internalising:

- A guard that is not a trigger, a policy or a revoked grant **is not a guard**.
- `postgres` and `service_role` hold BYPASSRLS, so RLS is not a control against them.
  Anything that must hold against every role is a **statement-level trigger plus
  revoked privileges**.

## External dependencies

- **Supabase** — Postgres, GoTrue (auth), PostgREST, Storage. Self-hostable; nothing
  depends on a proprietary Supabase feature except Storage's HTTP API.
- **GitHub Actions** — CI, and the retention schedule. See BE-W7 for why the schedule
  lives here and what backstops it.
- **A speech vendor** — undecided. Contract I3, five weeks late. `docs/mr-app-plan.md`
  §0.5 has the benchmark data; the short version is that Whisper-class models drop
  roughly half the words on Hinglish.

---

## The access model, as implemented (recorded 7 September 2026, FIX-06)

Written down because five consecutive reviews read the wrong artefact. Counts are from
the applied schema, not from a plan.

**What the documents say.** `plan-backend.md` §2: *"Enforce it in Postgres row-level
security. Not in application code… A commercial user must never reach clinical data
through any code path."* Every handoff since has repeated "RLS enabled and forced on
every table" as the evidence for that.

**What is actually true.** RLS *is* enabled and forced everywhere — but for the most
sensitive tables there is **no policy at all**, which denies everything, and access
happens through `SECURITY DEFINER` functions whose bodies hold the authorisation logic.

| | count |
| --- | ---: |
| tables in `public` | 35 |
| policies | 41 |
| **tables with RLS forced and ZERO policies** | **9** |
| functions in `public` | **88** |

`analyses`, `consent_records` and `analysis_overrides` are in the nine. A direct
`SELECT` on any of them is `permission denied` for every role including `admin`, and the
real path is `list_analyses`, `read_consent_record`, `list_analysis_overrides` and
friends — each of which re-implements scope with
`... in (select public.visible_user_ids())` and writes an `audit_log` row **before**
returning data.

**The consequence for anyone reviewing this system.** The authorisation surface is
**88 function bodies, not 41 policies.** A reviewer who reads `pg_policies` and stops has
read the smaller half. Nine tables' worth of access control is written in PL/pgSQL, and
the same scope expression appears in each one — so a change to `visible_user_ids()`
changes nine independent call sites at once, and a mistake in one is invisible in the
other eight.

**This is not drift; it was chosen twice, with reasons.** `PROJECT-OVERVIEW.md:483`
weighs the options and picks the `SECURITY DEFINER` route for `analyses` and
`consent_records`; line 170 gives the deciding reason — *"the brief requires every read of
both to be audited… Postgres has no SELECT trigger"*, so an RLS policy cannot log a read
and a function can. The 10 August amendment (`docs/amendment-gate0-criterion.md`)
separately settled that `403`, `200 []` and `0 rows affected` are all acceptable, and
rejected RPC-only reads *across the board* as cosmetic — this is the narrow case where the
audit rule forces them anyway.

**What the grants do and do not guarantee.** FIX-05 revoked `EXECUTE` from `PUBLIC` on all
functions, so `anon` is refused by the grant before any function body runs — 65 of 86 were
`anon`-reachable before that. It also set
`alter default privileges … revoke execute on functions from public` to make the posture
automatic. **FIX-06 proved that inert:** the default ACL for new functions in `public`
belongs to `supabase_admin`, grants `anon` *explicitly* rather than through `PUBLIC`, and
`postgres` — the role migrations run as — cannot alter it
(`permission denied to change default privileges`, 42501). A new function is therefore
born `anon`-executable, and the only thing preventing that from recurring is a test in
`rls.spec.ts` that fails the build when any function in `public` is `anon`-executable.

**Nothing here argues that one design is better.** The point is that the next security
review should read 88 function bodies and one grant test, and should not conclude from
"RLS forced on 35 tables" that the boundary has been reviewed.

---

## The field app's data path, as of 11 September 2026 (MR-14 → MR-28)

Written because the section above describes the database and a reader arriving at
`apps/field` needs the other half. **This is a snapshot. The code is the authority.**

### Reads — one provider, one store, one clock

```
sync_pull (RPC, SECURITY INVOKER, RESTRICTIVE tenant policy)
  -> apps/field/src/sync/pull.ts          pullOnce / applyChanges
  -> apps/field/src/sync/pulled-store.tsx PulledStoreProvider   <- mounted once in app/_layout.tsx
       store   : Map per entity  (visit, doctor, beat_plan, clinic_address, consent_text_version)
       today   : territoryToday(outcome.serverTime, zone)
       serverTime : the SERVER's instant, exposed since MR-28 A2
       failure : refused | unreachable      <- a refusal and a silence are different states
  -> apps/field/src/sync/selectors.ts     joins the streams the pull cannot aggregate
```

Persisted to AsyncStorage beside the cursor, in the same step, per user — a cursor ahead of
the records it was saved beside is silent data loss.

**Five entities travel. `consent_record`, `analysis`, `call_report`, `check_in`,
`check_out`, `sample_and_input`, `voice_note` and `recording` are in `sync_pull`'s own
`c_omitted` list, deliberately.**

### Writes — one RPC, one queue, exactly once

```
screen -> sendOrQueue(send, queueItem)          apps/field/src/sync/outbox.ts
            server answered + accepted  -> sent
            server answered + refused   -> refused   <- NEVER queued; a verdict is not a failure
            no answer                   -> queued    <- AsyncStorage, replayed by flushOutbox
       -> createPushClient()                     apps/field/src/sync/push-client.ts
       -> public.sync_push(batch, items[])       one RPC for all five entities
            -> apply_sync_item -> record_check_in / record_check_out / capture_consent / ...
```

`sync_items.id` is the device-generated request id and is the idempotency key. A duplicate
verdict is a **success**, not an error: the write landed and the acknowledgement did not.

### How a refusal becomes a sentence an MR can act on

```
raise ... using errcode = '45004', detail = '...', hint = '...'
  -> sync_push  get stacked diagnostics  sqlstate | message | DETAIL | HINT   (DETAIL/HINT: MR-28 BE-W97)
  -> verdict    { sqlState, sqlDetail, sqlHint, rejectionCode, rejectionDetail }
  -> SyncPushRefusal  ->  sendOrQueue  { kind: 'refused', message, sqlState, detail }
  -> refusalTextFor()        apps/field/src/sync/explanation.ts
       remedyForSqlState(sqlState)   <- the INSTRUCTION, keyed by refusalForSqlState()
       + "Figures from the server: <DETAIL>."   <- attributed, verbatim, NEVER parsed
```

`sqlState` decides. `sqlDetail` informs. `error-contract.spec.ts` guards the SQLSTATE map in
both directions; nothing guards prose, which is why nothing may branch on it.

`presentRejection()` is the same derivation for the QUEUE screen, which has a whole
`RejectionRecord`; `refusalTextFor()` is for a screen refused in the moment, which has only
what `sendOrQueue` handed back.

### What is still on the mock

`createClientForScenario()` → `:4010` serves `coaching`, `analysis`, `mileage`, `reply`,
`day-end` and `beat-plan`. The two-column module/screen table in `PROJECT-OVERVIEW.md`
(MR-14 D4, updated since) is the authority on which is which. **`beat-plan` is on the mock
deliberately**: `sync_pull` has no `beat_plan_entry` entity, and converting it would render
an empty route as fact.

### The one rule that shapes all of it

The server owns every verdict and every fact; the client owns only what this device
**witnessed**. `witnessedStage(visit, queued)` is that rule in code — a queued check-in is
not a guess, because this device watched itself write a durable row, and the copy says
**"Checked in — waiting to send"** rather than "You are checked in".

MR-28's defect 12 is the same rule failing on the other branch: a write the server
**accepted** is on neither the store nor the queue until the next pull, so the sent path now
calls `refresh()` and lets the server move the stage.
