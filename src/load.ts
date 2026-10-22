import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Driver } from "neo4j-driver";
import { buildGraph, loadScipIndex } from "./parse.js";
import { type Edge, type Graph, NODE_KINDS, type NodeKind, type SymbolNode } from "./types.js";

const BATCH = 1000;

async function writeBatches(driver: Driver, cypher: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await driver.executeQuery(cypher, { rows: rows.slice(i, i + BATCH) });
  }
}

const edgeQuery = (fromLabel: string, key: string, toLabel: string, toKey: string, rel: string) =>
  `UNWIND $rows AS r
   MATCH (a:${fromLabel} {${key}: r.from}), (b:${toLabel} {${toKey}: r.to})
   MERGE (a)-[e:${rel}]->(b)
   SET e.count = r.count`;

/** Runs the statements in schemas/graph.cypher (constraints and indexes; `//` comment lines are ignored). */
async function applySchema(driver: Driver) {
  const text = readFileSync(fileURLToPath(new URL("../schemas/graph.cypher", import.meta.url)), "utf8");
  const statements = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await driver.executeQuery(statement);
}

function groupByKind(symbols: SymbolNode[]): Map<NodeKind | undefined, SymbolNode[]> {
  const groups = new Map<NodeKind | undefined, SymbolNode[]>();
  for (const s of symbols) {
    const group = groups.get(s.kind);
    if (group) group.push(s);
    else groups.set(s.kind, [s]);
  }
  return groups;
}

export async function writeGraph(driver: Driver, g: Graph) {
  await driver.executeQuery("MATCH (n) DETACH DELETE n");
  await applySchema(driver);

  await driver.executeQuery(
    "CREATE (:Project {root: $root, tool: $tool, toolVersion: $toolVersion, loadedAt: datetime()})",
    { root: g.project.root ?? null, tool: g.project.tool ?? null, toolVersion: g.project.toolVersion ?? null },
  );

  await writeBatches(driver, "UNWIND $rows AS r CREATE (:File {path: r.path, language: r.language, isTest: r.isTest})", g.files);
  for (const [kind, rows] of groupByKind(g.symbols)) {
    // Labels can't be parameters; `kind` is interpolated only after checking it against NODE_KINDS.
    const label = kind && NODE_KINDS.includes(kind) ? `:Symbol:${kind}` : ":Symbol";
    await writeBatches(
      driver,
      `UNWIND $rows AS r CREATE (s${label} {id: r.id, name: r.name, scipKind: r.scipKind, scheme: r.scheme,
                                           manager: r.manager, packageName: r.packageName, version: r.version,
                                           external: r.external, doc: r.doc, file: r.file, line: r.line,
                                           endLine: r.endLine})`,
      rows,
    );
  }

  const rel = (rows: Edge[], q: string) => writeBatches(driver, q, rows.map((e) => ({ count: 1, ...e })));
  await rel(g.defines, edgeQuery("File", "path", "Symbol", "id", "DEFINES"));
  await rel(g.references, edgeQuery("File", "path", "Symbol", "id", "REFERENCES"));
  await rel(g.imports, edgeQuery("File", "path", "File", "path", "IMPORTS"));
  await rel(g.contains, edgeQuery("Symbol", "id", "Symbol", "id", "CONTAINS"));
  await rel(g.uses, edgeQuery("Symbol", "id", "Symbol", "id", "USES"));
  await rel(g.implements, edgeQuery("Symbol", "id", "Symbol", "id", "IMPLEMENTS"));
  await rel(g.typeOf, edgeQuery("Symbol", "id", "Symbol", "id", "TYPE_OF"));
}

export async function loadGraph(driver: Driver, scipPath: string): Promise<string> {
  const graph = buildGraph(await loadScipIndex(scipPath));
  await writeGraph(driver, graph);
  const byKind = [...groupByKind(graph.symbols)]
    .map(([kind, rows]) => `${kind ?? "unknown"} ${rows.length}`)
    .join(", ");
  const byLanguage = new Map<string, number>();
  for (const f of graph.files) byLanguage.set(f.language ?? "unknown", (byLanguage.get(f.language ?? "unknown") ?? 0) + 1);
  const languages = [...byLanguage].map(([language, n]) => `${language} ${n}`).join(", ");
  const summary =
    `Loaded ${graph.files.length} files (${languages}), ${graph.symbols.length} symbols (${byKind}), ` +
    `${graph.defines.length} defines, ${graph.references.length} references, ${graph.imports.length} imports, ` +
    `${graph.contains.length} contains, ${graph.uses.length} uses, ${graph.implements.length} implements, ` +
    `${graph.typeOf.length} type-of`;
  const missing = graph.filesWithoutScopes;
  if (missing.length === 0) return summary;
  return (
    `${summary}\nwarning: ${missing.length} file(s) have no enclosing ranges, so they have no USES edges ` +
    `(only File-[:REFERENCES]): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}`
  );
}
