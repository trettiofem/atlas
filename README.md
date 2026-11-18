# scip-test

**Warning**: this project is both very vibe-coded and untested, proceed with caution.

MVP code graph: index TypeScript with [scip-typescript](https://github.com/sourcegraph/scip-typescript), load the SCIP index into an embedded [RelateDB](https://relatedb.ai) store, and query it
from an agent through an MCP server, or from the CLI.

```sh
pnpm graph sync               # scip-typescript index -> index.scip -> RelateDB in graph-db/ (wipes and reloads the graph)
pnpm graph sync -p example-project   # same, for another project (every dir with a tsconfig.json is indexed)
pnpm graph find buildGraph
pnpm graph callers buildGraph 2
pnpm test
```

## Storage

The graph is an embedded RelateDB store in `graph-db/` (git-ignored), opened in-process through `@relate/relate`.
There is no server, container or configuration. `load` and `sync` open it for writing, and only one writer can
run at a time. Queries and the MCP server open read-only snapshots, and the MCP server reopens its snapshot after
a load. To explore the graph with Cypher, use the [`relate` CLI](https://relatedb.ai):
`relate query -d graph-db "MATCH (s:Symbol:Method) RETURN count(s)"`.

## Graph model

The full schema (labels, properties, relationships, constraints and indexes) is in
[schemas/graph.cypher](schemas/graph.cypher), which the loader applies before every load. The schema is
language-agnostic because it only uses SCIP's own model. The conventions SCIP doesn't carry, such as test-file
patterns and which kinds are noise, are per-language rules in [src/languages.ts](src/languages.ts).

| Node | Properties |
|---|---|
| `Project` | `root` (absolute path that `File.path` is relative to), `tool`, `toolVersion`, `loadedAt`; one per load |
| `File` | `path`, `language`, `isTest` |
| `Symbol:<Kind>` | `id` (SCIP symbol), `name`, `scipKind`, `scheme`, `manager`, `packageName`, `version`, `external`, `file`, `line`, `endLine`, `doc` |

Every symbol has the `Symbol` label plus one kind label, taken from the suffix of its SCIP descriptor. Every
SCIP indexer uses the same descriptor grammar, so the labels mean the same thing in every language:

| Label | Descriptor | Examples |
|---|---|---|
| `Namespace` | `Foo/` | TS `namespace Foo {}` / `declare module "fs"`, Java or Go package |
| `Type` | `Foo#` | class, interface, struct, trait, enum, type alias |
| `Term` | `foo.` | variable, constant, field, property, enum member |
| `Method` | `foo().` | function, method |
| `Parameter` | `(x)` | function or method parameter |
| `TypeParameter` | `[T]` | generic type parameter |
| `Macro` | `foo!` | Rust or C/C++ macro |
| `Meta` | `foo:` | indexer-specific; dropped for TS/JS (anonymous type-literal members) |

`scipKind` holds SCIP's detailed kind (`Class`, `Trait`, `Constructor`, ...) when the indexer sets one.
scip-typescript doesn't, so for TS it's always null and the label is the only type information.

`language` comes from SCIP's `Document.language`, or from the file extension when that's empty, as it is with
scip-typescript.

Match `(s:Symbol:Method {name: ...})` rather than `(s:Method {...})` so the planner can use the `Symbol` indexes.

| Edge | Meaning |
|---|---|
| `File-[:DEFINES]->Symbol` | definition occurrence |
| `File-[:REFERENCES]->Symbol` | any non-definition occurrence |
| `File-[:IMPORTS]->File` | derived: file references a symbol or module defined in another file |
| `Symbol-[:CONTAINS]->Symbol` | nesting (Type -> Method -> Parameter), from SCIP enclosing ranges or else the declared parent |
| `Symbol-[:USES]->Symbol` | reference occurs inside the source symbol's body (calls, type uses) |
| `Symbol-[:IMPLEMENTS]->Symbol` | SCIP `is_implementation` relationships |
| `Symbol-[:TYPE_OF]->Symbol` | SCIP `is_type_definition`: the source's type is the target |

- A file's own module symbol (`` src/`a.ts`/ ``) is represented by its `File` node, not a `Namespace`. Packages
  that span several files, such as Java's `com/foo/`, stay `Namespace` nodes.
- Parameters and type parameters hang off their function via `CONTAINS`. References to them are not recorded,
  since only the owning function can use them.
- `USES` needs SCIP enclosing ranges. If an indexer doesn't emit them, `CONTAINS` falls back to SCIP's
  `enclosing_symbol` or the descriptor parent, but references only produce `File-[:REFERENCES]`. The loader
  prints a warning listing the files affected.
- References at file top level have no enclosing symbol and only produce `File-[:REFERENCES]`.
- Each load replaces the whole graph, so one index (one indexer run) is loaded at a time.

## MCP server

`src/mcp.ts` is a stdio MCP server, registered for Claude Code in [.mcp.json](.mcp.json) as `code-graph`. Claude
Code asks you to approve it the first time you start a session in this repo. Load a graph first
(`pnpm graph sync -p <dir>`); the server reads whatever is loaded, and tells the agent to sync if nothing is.

| Tool | Answers |
|---|---|
| `overview` | loaded project (root, indexer, load time), files per language, symbols per kind |
| `search_symbols` | symbols whose name contains a string, optionally of one kind |
| `find_symbol` | where symbols with an exact name are defined |
| `get_source` | a definition's source lines (from `line` to `endLine`), numbered |
| `outline` | symbols defined in a file |
| `references` | files referencing a symbol, and the symbols the references sit in |
| `callers` / `callees` | symbols using / used by a symbol, up to `depth` hops |
| `file_dependencies` / `file_dependents` | file-level imports in either direction |
| `tests_for` | test files reaching the symbol directly or through callers |
| `impact` | files affected by changing the symbol |
| `find_artifacts` | saved write-ups about the project, by text, file or symbol, with the files changed since |
| `save_artifact` | saves (or replaces, by topic) a markdown write-up of an investigation |

Name-based tools take an optional `file` to pick one of several symbols with the same name. Results carry both
`file` (project-relative) and `path` (absolute), and file inputs accept either. Every tool except
`save_artifact` is read-only.

### Artifacts

An artifact is a markdown write-up that an agent saves after a long investigation, such as how a pipeline fits
together, its invariants and pitfalls, and where to look. Later agents read it instead of investigating the same
component again. It works like a README for agents. Each artifact has a `topic` (unique per project, so saving it
again replaces it), a one-line `summary`, the `markdown`, and the `files` and `symbols` it covers.

`find_artifacts` matches every word of `query` against the topic, summary and markdown, and can filter by a
covered `file` or `symbol`. Each result lists its `staleFiles`, the covered files modified after the artifact was
saved (or since deleted), so the agent knows what to check against the current code. Artifacts belong to the
loaded project's root and survive `pnpm graph sync`. The MCP instructions and the
[code-graph skill](.claude/skills/code-graph/SKILL.md) tell agents to look for artifacts first and to save one
after a long investigation.

Artifacts are rows of the `artifacts` table in `atlas.db` (git-ignored), a SQLite file opened with Node's built-in
`node:sqlite` ([src/store.ts](src/store.ts)) and shared with the agents. It's separate from the code graph in
`graph-db/`. Files and symbols are JSON columns, not edges into the graph. The file is in WAL mode with a busy
timeout, so every MCP server process writes it directly.

> **Warning: artifacts have no history, authorship or review.** Whatever an agent writes is served to the next one,
> and a save overwrites the topic. See [src/artifacts-db.ts](src/artifacts-db.ts).

The [code-graph skill](.claude/skills/code-graph/SKILL.md) tells agents when to use these tools instead of
grep, which workflows to follow, and the graph's blind spots. To run the server by hand, use
`node_modules/.bin/tsx src/mcp.ts`. Don't use `pnpm mcp` as a client command, because pnpm's `$ tsx …` banner
would corrupt the stdio stream.

## Web UI

`pnpm web` starts **Atlas**, a React UI at http://localhost:5182 (React, Tailwind, shadcn/ui).
- **Search** runs on the loaded graph. Find a symbol, then read its source and browse its callers, callees,
  references, tests and impact.
- **Home** starts an agent from a prompt, and **Agents** lists them and continues their conversations. Agents
  answer with Claude (see [Agents](#agents)). The Explain chat on highlighted code uses the same loop.
- **Code Graph** draws the loaded graph with [Cytoscape.js](https://js.cytoscape.org). Start from a symbol or file,
  expand and collapse nodes to follow their edges, and find the shortest path between two nodes.

The design language and tokens are in [AGENTS.md](AGENTS.md).

It is one process. [src/web.ts](src/web.ts) serves a JSON API ([src/api.ts](src/api.ts), the same queries as the
MCP server) and hands everything else to Vite, which serves the app in [web/](web/). It listens on 127.0.0.1 only
and refuses API requests whose `Host` isn't loopback. Run `pnpm graph sync` first. Reload the page after a sync.

| Route | Returns |
|---|---|
| `GET /api/overview` | loaded project, files per language, symbols per kind (503 if nothing is loaded) |
| `GET /api/query?cmd=<query>&arg=<name or path>` | the rows of a [query](#queries); optional `file`, `line`, `kind`, `depth` |
| `GET /api/source?name=<symbol>` | definition source, like the MCP `get_source` tool; optional `file` |
| `GET /api/file?path=<file>` | `{ file, text }`; only files in the graph (404 otherwise), at most 1 MB |
| `GET /api/graph/search?q=<text>` | files whose path, then symbols whose name, contains the text, as graph nodes |
| `GET /api/graph/node?id=<id>` | a node and its edge counts per type and direction; or `?name=&file=&line=` for a symbol |
| `GET /api/graph/neighbors?id=<id>` | a node's neighbors and the edges to them; optional `type`, `dir` (`in`/`out`), `limit` per group |
| `POST /api/graph/edges` | `{ ids }` in, every edge between those nodes out |
| `GET /api/graph/path?from=<id>&to=<id>` | a shortest path (`nodes`, `edges`; empty if none); optional `types` (comma-separated) and `directed=1` |
| `GET /api/agents/events` | server-sent events: a `snapshot` of every agent, then an `agent` event per change (at most every 100ms) |
| `POST /api/agents` | `{ prompt }` in; creates an agent, starts it, and returns it |
| `POST /api/agents/<id>/messages` | `{ prompt }` in; a follow-up (409 while the agent is still working) |
| `POST /api/explain` | `{ file, lines, name, messages }` in; NDJSON out, each line the reply's turns so far |

Graph node ids are `file:<path>` or `sym:<SCIP symbol>`, stable across syncs. Paths come from a bidirectional
breadth-first search in [src/graph.ts](src/graph.ts), one Cypher query per hop, rather than Cypher's
`shortestPath`: with a path filter, RelateDB enumerates paths, and a query with no path ran for minutes. They skip
parameters and never pass through external symbols.

`line` narrows name-based queries to the symbol defined on that line, for same-name symbols in one file.

### Agents

Agents need `CLAUDE_API_KEY` in `.env`, which `pnpm web` loads. They use the newest Haiku (`claude-haiku-5-5`);
set `CLAUDE_MODEL` to use another model. Without a key, the agent routes return 503.

[src/agent.ts](src/agent.ts) runs Claude with the Messages API in a tool loop. It starts [src/mcp.ts](src/mcp.ts)
with the MCP client SDK (the same command as `.mcp.json`), so agents get exactly the code-graph tools Claude Code
does, plus a local `show_code` tool that puts a file's lines into the transcript. Each tool call is a step in the
transcript, and answers stream in as markdown.

Agents are rows of the `agents` table in `atlas.db`, the SQLite file artifacts use. Each row holds the agent's
turns and its Anthropic message history as JSON columns, and every save rewrites them. The web server keeps
agents in memory and saves them as they change, so run one `pnpm web` at a time.

> **Warning: agents have no owner yet.** Every agent shows the mock user as its creator. Add users before agents
> have several. See [src/agents-db.ts](src/agents-db.ts).

If the server stops while an agent works, the agent is marked interrupted on the next start and can take a follow-up.

## Queries

`pnpm graph <search|find|source|outline|refs|callers|callees|deps|dependents|tests-for|impact> <name-or-path> [depth]`,
plus `pnpm graph overview`. `--file <path>` narrows name-based queries, and `--kind <label>` narrows `search`.

`-p/--project <dir>` selects the project to index (default: this repo). File paths in the graph are relative to that project, and each load replaces the whole graph, so one project is loaded at a time.

Other commands: `index [file]`, `load [file]`, `sync`. Run `pnpm graph` with no arguments for usage.

Sources: `src/main.ts` (CLI entry point), `src/mcp.ts` (MCP server), `src/web.ts` + `src/api.ts` (web UI server),
`web/` (React UI), `src/queries.ts` (Cypher queries shared by
all three), `src/graph.ts` (the Code Graph page's queries and path search), `src/source.ts` (source slicing), `src/store.ts` (the SQLite file for agents and artifacts), `src/agents-db.ts` (agent store), `src/artifacts-db.ts` (artifact store), `src/index.ts` (runs scip-typescript), `src/parse.ts`
(SCIP -> graph), `src/load.ts` (graph -> RelateDB), `src/db.ts` (store access), `src/types.ts` (SCIP and graph
types), `src/languages.ts` (per-language rules), `schemas/graph.cypher` (graph schema).
