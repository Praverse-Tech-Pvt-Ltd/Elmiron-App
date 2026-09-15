# The knowledge graph — measurements and known distortions

**Moved out of `CLAUDE.md` on 14 September 2026 (MR-33 A3).** Everything here is a
**snapshot**: it was measured against one build of `graphify-out/` and will drift the moment
the graph is regenerated or the code moves. That is exactly why it does not belong in a file
loaded into every session before any code is read — see the note at the top of `CLAUDE.md`.

**Read this before drawing a conclusion from the graph.** Nothing here is a reason to
distrust the graph as an *index*; all of it is a reason not to treat a graph answer as a
finding.

---

## The measurements, as of the build these were taken from

| | |
| --- | --- |
| Nodes | ~1,221 |
| Edges | ~1,545 |
| Named communities in `GRAPH_REPORT.md` | ~159 |

**Check them rather than trusting them:**

```bash
python -c "import json;g=json.load(open('graphify-out/graph.json',encoding='utf-8'));\
print('nodes', len(g['nodes']), 'edges', len(g['links']))"
head -1 graphify-out/GRAPH_REPORT.md    # the build date
```

---

## Four measured weaknesses — discount these

1. **The god-nodes list measures the test harness, not the architecture.** The top ten were
   `inRolledBackTransaction()`, `asUser()`, `requireDatabase()`, `seedFixtures()`,
   `FixtureWorld` and friends, because the database suite funnels through them. The first
   real domain nodes were `public.team_activity()` and `public.recordings`, at #14 and #15.

2. **Doc concepts are not linked to the SQL that implements them.** `explain
   consent_withdrawal_cascade` returned four `conceptually_related_to [INFERRED]` edges, all
   sourced from `PROJECT-OVERVIEW.md` — while `public.cascade_consent_withdrawal()` sat in
   three migration files as unconnected nodes. **Treat the doc layer and the SQL layer as
   parallel maps that were never joined.**

3. **Roughly a third of all nodes are isolated config keys** — `printWidth`, `semi`,
   `singleQuote` — from indexing `.prettierrc` and `tsconfig.json`. About 456 nodes, 37%, on
   the build measured. The report's "Suggested Questions" section is mostly noise as a
   result.

4. **A BFS query pulls in test plumbing on unrelated topics.** Asking about retention
   returned `seedFixtures()` and `FixtureWorld`, purely on degree.

---

## Why this file exists at all

The counts above were in `CLAUDE.md` until MR-33, alongside the claim that the `[sql]` extra
matters because *"all **34** migrations contribute nothing"* without it. **There were 56.**
The number had gone stale and was being loaded into every session's context ahead of
everything else, which is the highest-authority place in the repository for a wrong number to
sit.

The rule that came out of it is in `docs/gotchas.md`: **a claim belongs in `CLAUDE.md` only
if it holds for all time, or if the command that checks it is printed beside it.**

---

## Freshness verdict — 15 September 2026 (MR-34 A3)

**The graph is a museum. Rebuild it before trusting a single answer from it.**

The freshness check that `CLAUDE.md` prints beside its own warning:

```bash
head -1 graphify-out/GRAPH_REPORT.md                                          # 2026-08-11
git log -1 --format=%cd -- services/api/supabase/migrations packages/core     # Fri Sep 11 2026
```

**The graph was built on 11 August. The layer it indexes last changed on 11 September.** Five
weeks, and the five weeks that contain everything.

### Measured coverage, not inferred

Counted by matching every `source_file` in `graph.json` against `git ls-files`:

| | |
| --- | --- |
| Tracked code files now (`.ts`, `.tsx`, `.sql`, `.mjs`, `.mts`) | 439 |
| **Absent from the graph** | **352 — 80%** |
| Migration files represented in the graph | **17** |
| Migration files on disk | **56** |
| **Migrations absent** | **39** |
| `packages/core` files absent | 1 of 24 |
| `apps/field` files absent | **131 of 131 — all of them** |

**`apps/field` is not thin in the graph. It is absent.** The graph's entire knowledge of the
field app is three paths: `apps/field/package.json`, `apps/field/tsconfig.json`, and
`apps/field/src/placeholder.ts` — **a file that no longer exists.** Every screen, the outbox,
the sync layer, the sentinel work of MR-31 through MR-33: none of it is in there. A graph
query about the field app will return a confident answer about a placeholder.

### Two corrections to how this was expected to read

**1. The `[sql]` extra was NOT the problem here.** `CLAUDE.md` warns that without it every
migration contributes nothing. This graph has **226 `.sql` nodes, 188 of them under
`migrations/`** — so the extra was installed and SQL parsed fine. **The graph is stale, not
mis-built**, and those are different failures with different fixes. Rebuilding fixes this one;
installing the extra would not have.

**2. The graph was never built when "34 migrations" was true.** The reasonable inference —
`CLAUDE.md` said 34, so the graph dates from when there were 34, so 22 are missing — does not
survive the dates. The graph was built **11 August**, when **17** migration files were tracked.
The *"all 34 migrations"* sentence entered `CLAUDE.md` on **14 August** (`d3b841f`), three days
**after** the graph. They are two independent stale numbers that happen to sit near each other.

**So the gap is 39 migrations, not 22** — worse than the number that prompted the check, which
is the usual direction.

### What is missing is exactly the layer `CLAUDE.md` warns about losing

Among the 39: `20260908001300_tenant_boundary_restrictive.sql`,
`20260908000900_organisation_scoping.sql`, `20260907000300_revoke_public_execute.sql`,
`20260908000400_revoke_sequence_grants.sql`,
`20260908001100_consent_capture_bounds_trigger.sql`, `20260908001400_visits_validation.sql`,
and the whole `sync_pull` / `sync_push` layer.

**A graph query asking "what enforces tenancy" answers from a schema that has no tenancy
boundary in it.** Not a wrong answer with a caveat — a confident, sourced, complete-looking
answer drawn from a schema five weeks gone.

### The verdict

| Question | Answer |
| --- | --- |
| Index or museum? | **Museum** |
| Trust it? | **No.** Not for tenancy, consent bounds, sync, or anything in `apps/field` |
| Rebuild or delete? | **Rebuild.** It is gitignored, so it costs nothing to regenerate and nothing to be without |
| Is it dangerous or merely useless? | **Dangerous.** Every node carries a `source_file` and a line number, so a stale answer arrives with the strongest possible signal of being checkable |

The rebuild command is in `CLAUDE.md`. Note that **80% absent is not a degraded index, it is a
different codebase** — nothing in the report's "Suggested Questions" should be run against it
until it is rebuilt.
