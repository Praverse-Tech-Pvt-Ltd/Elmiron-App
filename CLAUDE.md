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

## The knowledge graph — CHECK WHETHER ONE EXISTS BEFORE RELYING ON IT

**There is no checked-in graph. `graphify-out/` is gitignored, so its state is a fact about
your machine and nothing in this file can tell you what it is.** One command can:

```bash
head -1 graphify-out/GRAPH_REPORT.md 2>/dev/null || echo "NO GRAPH — grep instead"
```

**Three states, and only the first is usable.**

| What that prints | What it means | What to do |
| --- | --- | --- |
| a date, and it is not behind the code | a current index | use it, and still open every file it points at |
| a date **older than the code** | a museum | **rebuild or delete it. Do not query it.** |
| `NO GRAPH` | nothing to read | grep. This is the normal state on a fresh clone |

**The freshness comparison, which is the whole decision:**

```bash
head -1 graphify-out/GRAPH_REPORT.md                                       # when the graph was built
git log -1 --format=%cd -- services/api/supabase/migrations packages/core  # when the code last moved
```

### Why this section no longer says "read the graph first"

**MR-35 D1 deleted the graph that was here, and it is worth knowing why before you build
another one.** It was built on 11 August. By 15 September it was missing **39 of 56
migrations** and **80% of all tracked code files**, and `apps/field` was absent entirely — its
whole representation was `package.json`, `tsconfig.json`, and a `placeholder.ts` that had been
deleted. Every screen, the outbox and the sync layer were simply not in it.

**A stale graph is worse than no graph, not merely less useful.** Every node carries a
`source_file` and a `source_location`, so a wrong answer arrives with the strongest available
signal of being checkable — a file and a line number. Asked "what enforces tenancy", it would
have answered confidently from a schema that had no tenant boundary in it.

It was **not** mis-built: it had 226 SQL nodes, so the `[sql]` extra was installed and parsing
worked. It was five weeks old. Staleness and mis-building are different failures with different
fixes, and only one of them is fixed by rebuilding.

**So the rule this file now enforces on itself: a graph must declare its own state, and a
reader must check that state before trusting a single answer.** The measurements above are in
`docs/graphify-notes.md`.

### The graph is an index, not an authority

**Never act on what a graph says without opening the file it points at.** It is a derived
snapshot. The code, the migrations in `services/api/supabase/migrations/`, and
`PROJECT-OVERVIEW.md` are the sources of truth.

The same staleness argument applies to `handoff.md` and `.ai-collab/` — a point-in-time snapshot
goes stale within hours and the next reader trusts it anyway. **Those two are tracked** (BE-W6
kept them out of git, BE-W8 reversed it — `.gitignore:22-26`); they are working notes, expected
to be updated, and `PROJECT-OVERVIEW.md` plus `docs/gotchas.md` remain the durable record.

### Building one

Adding the tool is a dependency install, which this project requires you to **ask about first**
(`.ai-collab/constraints.md`, "Ask before doing").

```bash
pip install "graphifyy[sql]"        # the [sql] extra is NOT optional — see below
graphify install                     # only if you want the /graphify skill; edits CLAUDE.md
GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify extract . --backend claude-cli
```

**The `[sql]` extra is mandatory for this repo.** The base `graphifyy` package bundles
tree-sitter grammars and SQL is not among them. Without it, **every** file under
`services/api/supabase/migrations/` contributes nothing and you get a confident-looking graph
with the entire RLS enforcement layer missing. It warns, but the warning scrolls past in a wall
of output. How many files that is:

```bash
ls services/api/supabase/migrations/*.sql | wc -l
```

Two other traps: the CLI backend is `--backend claude-cli`, not `claude` (`--help` omits it, and
`claude` demands `ANTHROPIC_API_KEY`); and without `GRAPHIFY_CLAUDE_CLI_MODEL`, doc extraction
runs on Opus, which the tool's own source comments call "overkill".

**If you build one, write its build date and the migration count it saw into
`docs/graphify-notes.md` in the same commit** — so the next reader checks freshness with one
command instead of inferring it from two unrelated stale numbers, which is what MR-34 had to do.

### Known distortions

**`docs/graphify-notes.md`** — measured weaknesses that make a graph answer misleading, with the
measurements that established them, and the freshness verdict that led to the deletion. Read it
before drawing a conclusion from a god-node list, a BFS result or a report's "Suggested
Questions".
