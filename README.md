# scip-test

**Warning**: this project is both very vibe-coded and untested, proceed with caution.

MVP code graph: index TypeScript with [scip-typescript](https://github.com/sourcegraph/scip-typescript), load the SCIP index into Neo4j, and query it
from an agent through an MCP server, or from the CLI.

```sh
cp .env.example .env          # once; Neo4j settings for both the container and the CLI
docker compose up -d --wait   # Neo4j: browser http://localhost:7474, bolt://localhost:7687
pnpm graph sync               # scip-typescript index -> index.scip -> Neo4j (wipes and reloads the graph)
pnpm graph sync -p example-project   # same, for another project (every dir with a tsconfig.json is indexed)
pnpm graph find buildGraph
pnpm graph callers buildGraph 2
pnpm test
```

## Configuration

`.env` (git-ignored; template in `.env.example`) is read by `docker-compose.yml` for the container and loaded by
`src/main.ts` for the connection. Variables already set in the shell win over `.env`.

| Variable | Used by |
|---|---|
| `NEO4J_PASSWORD` | container (`NEO4J_AUTH`, required) and CLI |
| `NEO4J_USERNAME` | CLI |
| `NEO4J_URI` | CLI, e.g. `neo4j://localhost:7687` |
| `NEO4J_DATABASE` | reserved; the CLI uses the server's default database |
| `NEO4J_IMAGE_TAG` | container image tag |

The container publishes 7474 (Browser) and 7687 (Bolt) on 127.0.0.1 only. Neo4j only applies the password when
it first creates its data volume, so after changing it run `docker compose down -v` (this deletes the graph) and
`docker compose up -d --wait`.

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

Match `(s:Symbol:Method {name: ...})` rather than `(s:Method {...})` so Neo4j can use the `Symbol` indexes.

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

Name-based tools take an optional `file` to pick one of several symbols with the same name. Results carry both
`file` (project-relative) and `path` (absolute), and file inputs accept either. The tools are read-only.

The [code-graph skill](.claude/skills/code-graph/SKILL.md) tells agents when to use these tools instead of
grep, which workflows to follow, and the graph's blind spots. To run the server by hand, use
`node_modules/.bin/tsx src/mcp.ts`. Don't use `pnpm mcp` as a client command, because pnpm's `$ tsx …` banner
would corrupt the stdio stream.

## Queries

`pnpm graph <search|find|source|outline|refs|callers|callees|deps|dependents|tests-for|impact> <name-or-path> [depth]`,
plus `pnpm graph overview`. `--file <path>` narrows name-based queries, and `--kind <label>` narrows `search`.

`-p/--project <dir>` selects the project to index (default: this repo). File paths in the graph are relative to that project, and each load replaces the whole graph, so one project is loaded at a time.

Other commands: `index [file]`, `load [file]`, `sync`. Run `pnpm graph` with no arguments for usage.

Sources: `src/main.ts` (CLI entry point), `src/mcp.ts` (MCP server), `src/queries.ts` (Cypher queries shared by
both), `src/source.ts` (source slicing), `src/index.ts` (runs scip-typescript), `src/parse.ts`
(SCIP -> graph), `src/load.ts` (graph -> Neo4j), `src/neo4j.ts` (connection), `src/types.ts` (SCIP and graph
types), `src/languages.ts` (per-language rules), `schemas/graph.cypher` (Neo4j schema).
