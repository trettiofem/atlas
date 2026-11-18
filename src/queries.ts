import type { Connection } from "@relate/relate";
import { NODE_KINDS, type NodeKind } from "./types.js";

export const QUERY_USAGE = `  search <text>     symbols whose name contains the text (--kind to filter by label)
  find <name>       symbols with this name and where they are defined
  source <name>     definition location (file, line, endLine) of the symbol
  outline <file>    symbols defined in a file, with line numbers
  refs <name>       files and symbols that use the symbol
  callers <name> [depth]   symbols that (transitively) use it
  callees <name> [depth]   symbols it (transitively) uses
  deps <file>       files this file imports
  dependents <file> files that import this file
  tests-for <name>  test files that use the symbol, directly or via a caller
  impact <name>     files that could be affected by changing the symbol
  overview          indexed project, file counts per language, symbol counts per kind

Name-based queries take --file <path> to pick one of several symbols with the same name.`;

export interface QueryOptions {
  depth?: string | number;
  /** Restricts name-based queries to symbols defined in this project-relative file. */
  file?: string;
  /** Restricts name-based queries to the symbol defined on this 1-based line (same-name symbols in one file). */
  line?: number;
  /** Kind label for `search`, e.g. "Method". */
  kind?: string;
  /** Row limit for `search`. */
  limit?: number;
}

const SYM =
  "(s:Symbol {external: false}) WHERE s.name = $arg AND ($file IS NULL OR s.file = $file) AND ($line IS NULL OR s.line = $line)";

/** The kind label next to `Symbol`, e.g. "Method". */
const kindOf = (v: string) => `[l IN labels(${v}) WHERE l <> 'Symbol'][0]`;

const depthOf = (v?: string | number) => Math.max(1, Math.min(Number(v) || 1, 10)); // Cypher can't parameterize path bounds

export const isNodeKind = (kind: string | undefined): kind is NodeKind =>
  !!kind && (NODE_KINDS as readonly string[]).includes(kind);

const commands: Record<string, (o: QueryOptions) => string> = {
  // Labels can't be parameters; `kind` is interpolated only after checking it against NODE_KINDS.
  search: (o) =>
    `MATCH (s:Symbol${isNodeKind(o.kind) ? `:${o.kind}` : ""} {external: false})
     WHERE toLower(s.name) CONTAINS toLower($arg)
       ${isNodeKind(o.kind) ? "" : "AND NOT s:Parameter AND NOT s:TypeParameter"}
       AND ($file IS NULL OR s.file = $file)
     RETURN ${kindOf("s")} AS kind, s.name AS name, s.file AS file, s.line AS line
     ORDER BY CASE WHEN toLower(s.name) = toLower($arg) THEN 0 ELSE 1 END, size(s.name), file, line
     LIMIT $limit`,
  find: () => `MATCH ${SYM} RETURN ${kindOf("s")} AS kind, s.name AS name, s.file AS file, s.line AS line ORDER BY file, line`,
  source: () =>
    `MATCH ${SYM}
     RETURN ${kindOf("s")} AS kind, s.name AS name, s.file AS file, s.line AS line, s.endLine AS endLine
     ORDER BY file, line`,
  outline: () =>
    `MATCH (f:File {path: $arg})-[:DEFINES]->(s:Symbol) WHERE NOT s:Parameter AND NOT s:TypeParameter
     RETURN s.line AS line, ${kindOf("s")} AS kind, s.name AS name ORDER BY line`,
  refs: () =>
    `MATCH ${SYM}
     OPTIONAL MATCH (u:Symbol)-[x:USES]->(s) WHERE u.external = false
     WITH s, collect(DISTINCT {by: u.name, file: u.file, count: x.count}) AS usedBy
     MATCH (f:File)-[r:REFERENCES]->(s)
     RETURN f.path AS file, r.count AS refs, [u IN usedBy WHERE u.file = f.path | u.by] AS inside ORDER BY file`,
  callers: (o) =>
    `MATCH ${SYM}
     MATCH p = (c:Symbol)-[:USES*1..${depthOf(o.depth)}]->(s) WHERE c.external = false AND c <> s
     RETURN DISTINCT c.name AS name, ${kindOf("c")} AS kind, c.file AS file, c.line AS line, min(length(p)) AS distance
     ORDER BY distance, file, line`,
  callees: (o) =>
    `MATCH ${SYM}
     MATCH p = (s)-[:USES*1..${depthOf(o.depth)}]->(c:Symbol {external: false}) WHERE c <> s
     RETURN DISTINCT c.name AS name, ${kindOf("c")} AS kind, c.file AS file, c.line AS line, min(length(p)) AS distance
     ORDER BY distance, file, line`,
  deps: () => `MATCH (:File {path: $arg})-[i:IMPORTS]->(g:File) RETURN g.path AS file, i.count AS refs ORDER BY file`,
  dependents: () => `MATCH (f:File)-[i:IMPORTS]->(:File {path: $arg}) RETURN f.path AS file, i.count AS refs ORDER BY file`,
  "tests-for": () =>
    `MATCH ${SYM}
     MATCH (t:File {isTest: true})-[:REFERENCES]->(x:Symbol)
     WHERE x = s OR (x)-[:USES*1..5]->(s)
     RETURN DISTINCT t.path AS testFile, collect(DISTINCT x.name) AS via ORDER BY testFile`,
  impact: () =>
    `MATCH ${SYM}
     MATCH (f:File)-[:REFERENCES]->(x:Symbol)
     WHERE x = s OR (x)-[:USES*1..5]->(s)
     RETURN DISTINCT f.path AS file, f.isTest AS isTest ORDER BY isTest, file`,
};

export type Row = Record<string, unknown>;

export const isQueryCommand = (cmd: string | undefined): cmd is string => !!cmd && Object.hasOwn(commands, cmd); // not `in`: "constructor" would pass

export async function runQuery(conn: Connection, cmd: string, arg: string, opts: QueryOptions = {}): Promise<Row[]> {
  const { rows } = await conn.queryAsync(commands[cmd](opts), {
    arg,
    file: opts.file ?? null,
    line: opts.line ?? null,
    limit: Math.max(1, Math.min(opts.limit ?? 50, 500)),
  });
  return rows;
}

/** Whether `path` (project-relative) is a file in the graph. */
export async function isIndexedFile(conn: Connection, path: string): Promise<boolean> {
  const { rows } = await conn.queryAsync("MATCH (f:File {path: $path}) RETURN f.path AS path LIMIT 1", { path });
  return rows.length > 0;
}

export interface Project {
  root?: string;
  tool?: string;
  toolVersion?: string;
  loadedAt?: string;
}

/** The loaded project, or undefined when nothing has been loaded. */
export async function getProject(conn: Connection): Promise<Project | undefined> {
  const { rows } = await conn.queryAsync(
    "MATCH (p:Project) RETURN p { .root, .tool, .toolVersion, loadedAt: toString(p.loadedAt) } AS p LIMIT 1",
  );
  return rows[0]?.p as Project | undefined;
}

export async function overview(conn: Connection) {
  const project = await getProject(conn);
  const languages = await conn.queryAsync(
    "MATCH (f:File) RETURN f.language AS language, count(*) AS files, sum(CASE WHEN f.isTest THEN 1 ELSE 0 END) AS testFiles ORDER BY files DESC",
  );
  const kinds = await conn.queryAsync(
    `MATCH (s:Symbol {external: false}) RETURN ${kindOf("s")} AS kind, count(*) AS symbols ORDER BY symbols DESC`,
  );
  return { project, languages: languages.rows, kinds: kinds.rows };
}
