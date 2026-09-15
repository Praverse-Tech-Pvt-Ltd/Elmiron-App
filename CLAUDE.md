# Working in this repository

> **What belongs in this file — MR-33 A3.**
>
> `CLAUDE.md` is loaded into every session's context **before any code is read**, so a stale
> claim here is not one stale claim: it is a stale prior in every session that will ever run,
> and it arrives with more authority than anything the session goes on to read.
>
> **The test: a claim belongs here only if it holds for all time, or if the command that
> checks it is printed beside it.** Counts, measurements, dated findings and
> environment-specific facts fail that test and belong in a file a reader chooses to open.
>
> This file carried *"1,221 nodes, 1,545 edges"*, *"159 named communities"*, four measured
> graph weaknesses, and *"all 34 migrations"* — **when there are 56**. That last one is the
> demonstration: a stale count had been reaching every session unchallenged. The snapshots
> now live in `docs/graphify-notes.md`.

## Use the knowledge graph for orientation

There is a graphify knowledge graph of this codebase at **`graphify-out/`** — gitignored, so
it will not exist on a fresh clone.

| File | What it is |
| --- | --- |
| `graphify-out/GRAPH_REPORT.md` | Human-readable. **Read this first.** |
| `graphify-out/graph.json` | The graph itself, node-link JSON (`nodes` / `links`) |
| `graphify-out/graph.html` | Interactive visualisation, for humans not agents |

**Go through the graph before grepping** when the question is *"where does X live"*, *"what
touches Y"*, *"which migration owns this table"*, or *"what is the shape of this system"*.
It answers those in one read instead of a dozen searches. Node records carry `source_file`
and `source_location`, so a graph hit gives you a file and a line number to open next.

There is no `graphify` CLI installed. Query `graph.json` directly — it is plain JSON:

```bash
# what nodes mention a concept, and which file each came from
python -c "import json;g=json.load(open('graphify-out/graph.json',encoding='utf-8'));\
[print(n.get('label'),'|',n.get('source_file'),'|',n.get('source_location')) \
 for n in g['nodes'] if 'consent' in (n.get('label') or '').lower()]"
```

### The graph is an index, not an authority

**Never act on what the graph says without opening the file it points at.** It is a derived
snapshot. The code, the migrations in `services/api/supabase/migrations/`, and
`PROJECT-OVERVIEW.md` are the sources of truth; the graph is a way of finding them quickly.
If the graph and the code disagree, the code is right and the graph is stale.

The same staleness argument applies to `handoff.md` and `.ai-collab/` — a point-in-time
snapshot goes stale within hours and the next reader trusts it anyway. **Those two are
tracked** (BE-W6 kept them out of git, BE-W8 reversed it — `.gitignore:22-26`); they are
working notes, expected to be updated, and `PROJECT-OVERVIEW.md` plus `docs/gotchas.md`
remain the durable record.

**Check freshness before trusting it.** `GRAPH_REPORT.md` carries its build date on line 1.
If migrations or `packages/core` have changed since, the graph is behind:

```bash
git log -1 --format=%cd -- services/api/supabase/migrations packages/core
```

**A checked-in graph is a build artefact of one date, so "behind" is the default state, not
the exception.** Compare the two dates before you believe anything it says, and treat a gap of
weeks as a rebuild rather than a caveat — a stale node still carries a `source_file` and a line
number, so a wrong answer arrives looking checkable. The last time this was measured, and what
it found, is in `docs/graphify-notes.md`.

### Known distortions, and the counts

**`docs/graphify-notes.md`** — four measured weaknesses that will make a graph answer
misleading, with the measurements that established them. Read it before drawing a conclusion
from a god-node list, a BFS result or the report's "Suggested Questions".

### Regenerating it

```bash
pip install "graphifyy[sql]"        # the [sql] extra is NOT optional — see below
graphify install                     # only if you want the /graphify skill; edits CLAUDE.md
GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify extract . --backend claude-cli
```

**The `[sql]` extra is mandatory for this repo.** The base `graphifyy` package bundles
tree-sitter grammars and SQL is not among them. Without it, **every** file under
`services/api/supabase/migrations/` contributes nothing and you get a confident-looking graph
with the entire RLS enforcement layer missing. It warns, but the warning scrolls past in a
wall of output. How many that is:

```bash
ls services/api/supabase/migrations/*.sql | wc -l
```

Two other traps: the CLI backend is `--backend claude-cli`, not `claude` (`--help` omits it,
and `claude` demands `ANTHROPIC_API_KEY`); and without `GRAPHIFY_CLAUDE_CLI_MODEL`, doc
extraction runs on Opus, which the tool's own source comments call "overkill".
