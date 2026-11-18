import { stat } from "node:fs/promises";
import type { Connection } from "@relate/relate";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type Artifact, findArtifacts, saveArtifact } from "./artifacts-db.js";
import { NOT_LOADED, reader } from "./db.js";
import { getProject, overview, type QueryOptions, type Row, runQuery } from "./queries.js";
import { readDefinitions, resolveInRoot, toProjectRelative } from "./source.js";
import { NODE_KINDS } from "./types.js";

// stdout carries the JSON-RPC stream, so anything human-readable goes to stderr.
const log = (...args: unknown[]) => console.error("[code-graph]", ...args);

const MAX_ROWS = 200;
const MAX_SOURCE_MATCHES = 3;

const INSTRUCTIONS = `Code graph of one indexed project, built from a SCIP index and stored in RelateDB.
Start with \`overview\` to see which project is loaded and how big it is. Use \`search_symbols\` when you don't
know a symbol's exact name, then \`get_source\` to read it instead of opening whole files. Names are not unique:
when a name matches several symbols, pass \`file\` to pick one. Results carry \`file\` (project-relative) and
\`path\` (absolute). The graph is a snapshot: it doesn't see edits made since the last \`pnpm graph sync\`.

Artifacts are write-ups that earlier agents saved after investigating part of this project. Before investigating a
component, call \`find_artifacts\` (by \`query\`, \`file\` or \`symbol\`): reading one is far cheaper than redoing the
work. Check any \`staleFiles\` against the current code. After a long investigation that others are likely to repeat,
call \`save_artifact\`. Write it for agents: the non-obvious design, invariants, pitfalls and the key symbols and
files, not a restatement of the source. Skip it for small or obvious findings.`;

const server = new McpServer({ name: "code-graph", version: "0.1.0" }, { instructions: INSTRUCTIONS });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Runs `fn` with the loaded project's root, turning a missing graph or a database error into a tool error. */
async function withRoot(fn: (root: string, conn: Connection) => Promise<ToolResult>): Promise<ToolResult> {
  try {
    const conn = reader();
    const project = await getProject(conn);
    if (!project?.root) return fail(NOT_LOADED);
    return await fn(project.root, conn);
  } catch (e) {
    log(e);
    return fail(`Graph query failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Adds an absolute `path` next to each row's project-relative `file` / `testFile`. */
const withPaths = (root: string, rows: Row[]) =>
  rows.map((row) => {
    const file = row.file ?? row.testFile;
    return typeof file === "string" ? { ...row, path: resolveInRoot(root, file) } : row;
  });

function queryTool(cmd: string, arg: string, opts: QueryOptions = {}) {
  return withRoot(async (root, conn) => {
    const file = opts.file && toProjectRelative(root, opts.file);
    const target = cmd === "outline" || cmd === "deps" || cmd === "dependents" ? toProjectRelative(root, arg) : arg;
    const rows = await runQuery(conn, cmd, target, { ...opts, file });
    if (rows.length === 0) {
      return ok({ results: [], hint: `No results for "${arg}". Names are exact; try search_symbols for partial names.` });
    }
    const results = withPaths(root, rows.slice(0, MAX_ROWS));
    return ok(rows.length > MAX_ROWS ? { results, truncated: `${rows.length - MAX_ROWS} more rows omitted` } : { results });
  });
}

const name = z.string().min(1).describe("Exact symbol name, e.g. buildPalette");
const file = z
  .string()
  .optional()
  .describe("Defining file, project-relative or absolute. Picks one of several symbols with the same name.");
const depth = z.number().int().min(1).max(10).optional().describe("How many USES hops to follow (default 1)");
const filePath = z.string().min(1).describe("File path, project-relative or absolute");
const readOnly = { readOnlyHint: true, openWorldHint: false };

server.registerTool(
  "overview",
  {
    description: "Which project is loaded (root, indexer, load time), file counts per language, symbol counts per kind.",
    annotations: readOnly,
  },
  async () => withRoot(async (_, conn) => ok(await overview(conn))),
);

server.registerTool(
  "search_symbols",
  {
    description:
      "Find symbols whose name contains `query` (case-insensitive). Exact matches and shorter names rank first. " +
      "Parameters are left out unless `kind` asks for them. Use this when you don't know the exact name.",
    inputSchema: {
      query: z.string().min(1).describe("Part of a symbol name"),
      kind: z.enum(NODE_KINDS).optional().describe("Only symbols with this kind label"),
      limit: z.number().int().min(1).max(MAX_ROWS).optional().describe("Most results to return (default 50)"),
    },
    annotations: readOnly,
  },
  async ({ query, kind, limit }) => queryTool("search", query, { kind, limit }),
);

server.registerTool(
  "find_symbol",
  {
    description: "Where symbols with this exact name are defined: kind, file and line.",
    inputSchema: { name, file },
    annotations: readOnly,
  },
  async (args) => queryTool("find", args.name, { file: args.file }),
);

server.registerTool(
  "get_source",
  {
    description:
      `Source code of a symbol's definition, with line numbers (at most ${MAX_SOURCE_MATCHES} matches, ` +
      "200 lines each). Cheaper than reading the whole file.",
    inputSchema: { name, file },
    annotations: readOnly,
  },
  async (args) =>
    withRoot(async (root, conn) => {
      const rows = await runQuery(conn, "source", args.name, { file: args.file && toProjectRelative(root, args.file) });
      if (rows.length === 0) return ok({ results: [], hint: `No symbol named "${args.name}"; try search_symbols.` });
      const results = await readDefinitions(root, rows.slice(0, MAX_SOURCE_MATCHES));
      const more = rows.length - results.length;
      return ok(more > 0 ? { results, truncated: `${more} more matches; pass file to pick one` } : { results });
    }),
);

server.registerTool(
  "outline",
  {
    description: "Symbols defined in a file (types, functions, fields; no parameters), in line order.",
    inputSchema: { file: filePath },
    annotations: readOnly,
  },
  async (args) => queryTool("outline", args.file),
);

server.registerTool(
  "references",
  {
    description:
      "Files that reference the symbol, with counts and the enclosing symbols the references occur in " +
      "(`inside`). Includes top-level code, which `callers` misses.",
    inputSchema: { name, file },
    annotations: readOnly,
  },
  async (args) => queryTool("refs", args.name, { file: args.file }),
);

server.registerTool(
  "callers",
  {
    description: "Symbols that use (call, instantiate, reference the type of) the symbol, up to `depth` hops away.",
    inputSchema: { name, file, depth },
    annotations: readOnly,
  },
  async (args) => queryTool("callers", args.name, { file: args.file, depth: args.depth }),
);

server.registerTool(
  "callees",
  {
    description: "Symbols the symbol uses (calls, types, fields), up to `depth` hops away.",
    inputSchema: { name, file, depth },
    annotations: readOnly,
  },
  async (args) => queryTool("callees", args.name, { file: args.file, depth: args.depth }),
);

server.registerTool(
  "file_dependencies",
  {
    description: "Files this file imports from (it references symbols defined there), with reference counts.",
    inputSchema: { file: filePath },
    annotations: readOnly,
  },
  async (args) => queryTool("deps", args.file),
);

server.registerTool(
  "file_dependents",
  {
    description: "Files that import from this file, with reference counts.",
    inputSchema: { file: filePath },
    annotations: readOnly,
  },
  async (args) => queryTool("dependents", args.file),
);

server.registerTool(
  "tests_for",
  {
    description: "Test files that exercise the symbol, directly or through up to 5 hops of callers (`via`).",
    inputSchema: { name, file },
    annotations: readOnly,
  },
  async (args) => queryTool("tests-for", args.name, { file: args.file }),
);

server.registerTool(
  "impact",
  {
    description: "Files that could be affected by changing the symbol: direct references plus up to 5 hops of callers.",
    inputSchema: { name, file },
    annotations: readOnly,
  },
  async (args) => queryTool("impact", args.name, { file: args.file }),
);

/** The artifact's files that changed after it was saved, or no longer exist. */
async function staleFiles(root: string, artifact: Artifact) {
  const changed = await Promise.all(
    artifact.files.map((f) => stat(resolveInRoot(root, f)).then((s) => s.mtimeMs > artifact.updatedAt, () => true)),
  );
  return artifact.files.filter((_, i) => changed[i]);
}

const unique = (items: string[] = []) => [...new Set(items)];

server.registerTool(
  "find_artifacts",
  {
    description:
      "Write-ups that earlier agents saved after investigating this project, newest first, with their full markdown. " +
      "Every `query` word has to occur in the topic, summary or markdown. `staleFiles` lists covered files that " +
      "changed after the artifact was saved: check those parts against the current code.",
    inputSchema: {
      query: z.string().optional().describe("Words to look for, e.g. graph loading"),
      file: z.string().optional().describe("Only artifacts covering this file, project-relative or absolute"),
      symbol: z.string().optional().describe("Only artifacts covering this exact symbol name"),
      limit: z.number().int().min(1).max(20).optional().describe("Most artifacts to return (default 5)"),
    },
    annotations: readOnly,
  },
  async (args) =>
    withRoot(async (root) => {
      const found = findArtifacts({ project: root, ...args, file: args.file && toProjectRelative(root, args.file) });
      if (found.length === 0) {
        return ok({ results: [], hint: "No artifacts match. Investigate, and if it took a while, save what you learned with save_artifact." });
      }
      return ok({ results: await Promise.all(found.map(async (a) => ({ ...a, staleFiles: await staleFiles(root, a) }))) });
    }),
);

server.registerTool(
  "save_artifact",
  {
    description:
      "Save a markdown write-up of something you investigated, for later agents to read with find_artifacts. " +
      "Saving an existing topic replaces it, so read it first and keep what still holds.",
    inputSchema: {
      topic: z.string().min(1).max(200).describe("Short name of what it explains, e.g. Graph loading pipeline"),
      summary: z.string().min(1).max(500).describe("One sentence: what it explains and when to read it"),
      markdown: z.string().min(1).max(20_000).describe("The write-up: design, invariants, pitfalls, key symbols and files"),
      files: z.array(z.string().min(1)).optional().describe("Files it covers, project-relative or absolute"),
      symbols: z.array(z.string().min(1)).optional().describe("Exact names of the symbols it covers"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (args) =>
    withRoot(async (root) => {
      const files = unique(args.files?.map((f) => toProjectRelative(root, f)));
      try {
        for (const f of files) resolveInRoot(root, f);
        const { replaced } = saveArtifact({ ...args, project: root, files, symbols: unique(args.symbols) });
        return ok({ saved: args.topic, replaced });
      } catch (e) {
        return fail(`Couldn't save the artifact: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
);

const shutdown = () => process.exit(0);
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
log("ready");
