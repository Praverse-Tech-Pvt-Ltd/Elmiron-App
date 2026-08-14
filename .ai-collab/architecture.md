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
