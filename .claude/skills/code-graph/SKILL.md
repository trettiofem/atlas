---
name: code-graph
description: Navigate the indexed project through its code graph (the code-graph MCP server) instead of grepping. Use when you need where a symbol is defined, its source, who calls it or what it calls, what references it, which files depend on a file, which tests cover some code, or what a change could affect. Also use to orient yourself in unfamiliar code. Fall back to grep only for strings, comments, config and other non-code text.
---

# Code graph

The `code-graph` MCP server answers symbol-level questions from a RelateDB graph built from a SCIP index of one
project: files, symbols (labelled `Type`, `Method`, `Term`, `Namespace`, `Parameter`…), and the edges between
them (defines, references, uses, contains, imports, implements). Answers are exact rather than text matches,
and they cost far less context than reading files.

## 1. Check what's loaded

Call `overview` first. It returns the project root, the indexer, when the graph was loaded, and file and symbol
counts.

- **"graph is not loaded", or the root isn't the project you're working on:** load it from the code-graph repo
  (where `.mcp.json` lives) with `pnpm graph sync -p <project dir>`, then call `overview` again. The MCP
  server picks up the new graph without a restart.
- **You (or the user) have edited code since `loadedAt`:** results for the edited files may be stale. Re-run the
  sync if it matters for the task.

## 2. Check for field notes

Field notes are markdown write-ups that earlier agents saved after investigating part of the project. Before you
dig into a component, call `find_notes` with a `query`, `file` or `symbol`. If one covers it, start from it
instead of redoing the investigation. It's much cheaper. Results with `staleFiles` were written before those files
last changed, so check the parts they cover against the current code.

## 3. Pick a tool

| Question | Tool |
|---|---|
| I only know part of the name | `search_symbols` (`query`, optional `kind`, `limit`) |
| Where is X defined? | `find_symbol` |
| Show me X's code | `get_source`, which returns the definition with line numbers, not the whole file |
| What's in this file? | `outline` |
| Who uses X? | `callers` (symbol-level, `depth` up to 10) or `references` (file-level, includes top-level code) |
| What does X depend on? | `callees` |
| What does this file import, and what imports it? | `file_dependencies`, `file_dependents` |
| Which tests cover X? | `tests_for` |
| What breaks if I change X? | `impact` |
| Has someone already explained this? | `find_notes` (`query`, `file`, `symbol`, `limit`) |
| Keep what I learned for the next agent | `save_note` (`topic`, `summary`, `markdown`, `files`, `symbols`) |

Results include `file` (project-relative) and `path` (absolute). Use `path` with Read or Edit. Tools accept
either form for `file` inputs.

## 4. Common workflows

**Understand a symbol**
1. `search_symbols` to get the exact name, kind and file.
2. `get_source` (pass `file` if there are several matches).
3. `callees` to see what it relies on, and `callers` to see how it's used. Use `get_source` on the interesting
   ones.

**Plan a change to X**
1. `impact` for the set of files at risk.
2. `tests_for` to find the tests to run afterwards.
3. `callers` with `depth` 2–3, plus `get_source` on the direct callers, to check how call sites depend on the
   current behaviour.

**Orient in a file or module**
`outline`, then `file_dependencies` and `file_dependents`, then `get_source` on the symbols that matter.

**Save a field note after a long investigation**
Save one when understanding a component took many calls and someone else is likely to need the same answer.
Skip it for small or obvious findings, or for anything a single `get_source` would show.
1. `find_notes` on the topic first. Saving an existing `topic` replaces it, so fold in what still holds.
2. `save_note` with a short `topic`, a one-sentence `summary`, and the `files` and exact `symbols` it covers,
   so later agents can find it by file or symbol and see when it goes stale.
3. Write the `markdown` for agents: how the parts fit together, invariants, pitfalls, why it's built that way,
   and where to look (symbol names and paths). Don't paste the source or restate what the code plainly says.

## 5. Caveats

- **Names aren't unique.** If a name-based tool returns several symbols (in different files, or a field and a
  method), repeat the call with `file` to pick one.
- **Names are exact** in every tool except `search_symbols`.
- **Top-level code has no enclosing symbol.** A call at module top level, or in a test's `describe`/`it`
  callback that the indexer doesn't treat as a symbol, shows up in `references`, `impact` and `tests_for` but
  not in `callers`. Check `references` before concluding something is unused.
- **Parameters are skipped.** They appear in `outline` and `search_symbols` (with `kind: "Parameter"`), but
  references to them aren't recorded.
- **External code isn't included.** Symbols from dependencies (npm packages, the standard library) are
  references only, with no source.
- **One project at a time.** Loading another project replaces the graph. Field notes are kept per project root and
  survive syncs.
- **Field notes can be wrong or stale.** Agents wrote them, and nobody reviews them. Treat `staleFiles` as "verify
  before relying on it", and replace a note when you find it's wrong.
- **Not everything is code.** For strings, comments, config files, docs, or anything the indexer doesn't
  cover, use grep or Glob.
