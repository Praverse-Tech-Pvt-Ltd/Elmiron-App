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
