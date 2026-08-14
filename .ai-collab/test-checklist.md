# Test checklist

Commands **and their expected output**. The expected output is the point of this
file.

> **The trap this file exists for.** `services/api` tests report **skipped**, not
> failed, when no database is reachable — and a skipped suite and a passing suite
> look nearly identical in a terminal. Before that behaviour was added, a run against
> no database reported *152 passed*. **Read for "passed", never for the absence of
> red.**

Prerequisite for anything below the line: Docker running and `pnpm db:start` done.

---

## The full gate, in the order CI runs it

```bash
pnpm run build          # Tasks: 3 successful, 3 total
pnpm run typecheck      # Tasks: 8 successful, 8 total
pnpm run lint           # Tasks: 6 successful, 6 total
pnpm run format:check   # All matched files use Prettier code style!
pnpm --filter @elmiron/core test   # Tests  21 passed (21)
pnpm --filter @elmiron/mock test   # Tests  40 passed (40)
pnpm --filter @elmiron/api  test   # Tests  312 passed (312)  <- "passed", not "skipped"
```

Per-file expectation for the database suite, so a silently-skipped file is visible:

| File | Expected |
| --- | --- |
| `foundations.spec.ts` | 18 passed |
| `rls.spec.ts` | 70 passed |
| `field.spec.ts` | 33 passed |
| `sync.spec.ts` | 33 passed |
| `manager.spec.ts` | 32 passed |
| `gate1.spec.ts` | 8 passed |
| `consent-audio.spec.ts` | 35 passed |
| `upload.spec.ts` | 35 passed |
| `retention-ops.spec.ts` | 25 passed |
| `adverse-events.spec.ts` | 23 passed |

## Rollbacks — destructive, run last

```bash
pnpm --filter @elmiron/api verify:rollbacks
# All rollbacks applied in reverse order; public schema is empty.
pnpm db:reset          # required afterwards; the previous command emptied the schema
```

## After changing anything in the audio or retention path

```bash
pnpm --filter @elmiron/api check:purge-health
# Prints the audio_purge_health() JSON, then: "Audio retention is healthy."
# Exit 1 with "AUDIO RETENTION IS NOT HEALTHY" is a real finding, not a flake.

pnpm --filter @elmiron/api reconcile:restore
# DRY RUN: N row(s) checked against M object(s). 0 row(s) had no object; 0 object(s) had no row.
# Anything non-zero on a healthy local stack means a test left an orphan behind.
```

## After changing a guard (trigger, policy, grant, constraint)

A passing suite is not evidence the guard works — only that nothing noticed it. Break
it on purpose and confirm something goes red:

```bash
pnpm db:reset
Get-Content <mutation>.sql | docker exec -i supabase_db_Elmiron-App psql -U postgres -d postgres
pnpm --filter @elmiron/api test   # expect >= 1 failure, and read WHICH test failed
pnpm db:reset                     # revert
```

**A mutation that produces zero failures is a guard that was never a guard.** This has
caught a hollow test twice now — BE-W6 (bulk-approve truncation, shipped with no
test) and BE-W7 (the upload hard-ceiling test asserted the wrong property).

## Flakiness

The suite shares **one database and one storage bucket** across ten parallel worker
threads. If a test fails, before assuming a real bug:

```bash
pnpm db:reset; pnpm --filter @elmiron/api test    # repeat 5-10 times
```

A *different* test failing each run, in files nobody touched, is a cross-file race —
see the "Spec files run in parallel" entry in `docs/gotchas.md`. A *consistent*
failure is a real bug.
