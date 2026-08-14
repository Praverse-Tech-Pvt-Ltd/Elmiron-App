# Working in this repository

## Use the knowledge graph for orientation

There is a graphify knowledge graph of this codebase at **`graphify-out/`**:

| File | What it is |
| --- | --- |
| `graphify-out/GRAPH_REPORT.md` | Human-readable. 159 named communities, hyperedges, god nodes, knowledge gaps. **Read this first.** |
| `graphify-out/graph.json` | The graph itself: 1,221 nodes, 1,545 edges, node-link JSON (`nodes` / `links`). |
| `graphify-out/graph.html` | Interactive visualisation, for humans not agents. |

**Go through the graph before grepping** when the question is *"where does X live"*, *"what
touches Y"*, *"which migration owns this table"*, or *"what is the shape of this system"*.
It answers those in one read instead of a dozen searches. Node records carry
`source_file` and `source_location`, so a graph hit gives you a file and a line number to
open next.

There is no `graphify` CLI installed. Query `graph.json` directly — it is plain JSON:

```bash
# what nodes mention a concept, and which file each came from
python -c "import json;g=json.load(open('graphify-out/graph.json',encoding='utf-8'));\
[print(n.get('label'),'|',n.get('source_file'),'|',n.get('source_location')) \
 for n in g['nodes'] if 'consent' in (n.get('label') or '').lower()]"
```

### The graph is an index, not an authority

**Never act on what the graph says without opening the file it points at.** It is a
derived snapshot. The code, the migrations in `services/api/supabase/migrations/`, and
`PROJECT-OVERVIEW.md` are the sources of truth; the graph is a way of finding them
quickly. If the graph and the code disagree, the code is right and the graph is stale.

This is the same rule that keeps `handoff.md` and `.ai-collab/` out of git: a
point-in-time snapshot goes stale within hours and the next reader trusts it anyway.

**Check freshness before trusting it.** `GRAPH_REPORT.md` carries its build date on line 1.
If migrations or `packages/core` have changed since, the graph is behind:

```bash
git log -1 --format=%cd -- services/api/supabase/migrations packages/core
```

### Known distortions — discount these

The graph has four measured weaknesses. Do not draw conclusions from them:

1. **The god-nodes list measures the test harness, not the architecture.** The top ten
   are `inRolledBackTransaction()`, `asUser()`, `requireDatabase()`, `seedFixtures()`,
   `FixtureWorld` and friends, because 312 tests funnel through them. The first real
   domain nodes are `public.team_activity()` and `public.recordings` at #14 and #15.
2. **Doc concepts are not linked to the SQL that implements them.** `explain
   consent_withdrawal_cascade` returns four `conceptually_related_to [INFERRED]` edges,
   all sourced from `PROJECT-OVERVIEW.md` — while `public.cascade_consent_withdrawal()`
   sits in three migration files as unconnected nodes. Treat the doc layer and the SQL
   layer as parallel maps that were never joined.
3. **456 nodes (37%) are isolated config keys** — `printWidth`, `semi`, `singleQuote`
   — from indexing `.prettierrc` and `tsconfig.json`. The report's "Suggested Questions"
   section is mostly noise as a result.
4. **A BFS query pulls in test plumbing on unrelated topics.** Asking about retention
   returns `seedFixtures()` and `FixtureWorld`, purely on degree.

### Regenerating it

`graphify-out/` is **gitignored** (see `.gitignore`), so it will not exist on a fresh
clone. If it is missing or stale, rebuild it:

```bash
pip install "graphifyy[sql]"        # the [sql] extra is NOT optional — see below
graphify install                     # only if you want the /graphify skill; edits CLAUDE.md
GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify extract . --backend claude-cli
```

**The `[sql]` extra is mandatory for this repo.** The base `graphifyy` package bundles 36
tree-sitter grammars and SQL is not one of them. Without it, all 34 migrations contribute
nothing and you get a confident-looking graph with the entire RLS enforcement layer
missing. It warns, but the warning scrolls past in a wall of output.

Two other traps: the CLI backend is `--backend claude-cli`, not `claude` (`--help` omits
it, and `claude` demands `ANTHROPIC_API_KEY`); and without
`GRAPHIFY_CLAUDE_CLI_MODEL`, doc extraction runs on Opus, which the tool's own source
comments call "overkill".
