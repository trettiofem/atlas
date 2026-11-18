import type { Connection } from "@relate/relate";

/**
 * Queries for the Code Graph page: whole nodes and edges rather than rows, so the UI can draw and grow a subgraph.
 * Node ids are stable across loads: `file:<path>` for files and `sym:<SCIP symbol>` for symbols.
 */

export const EDGE_TYPES = ["USES", "CONTAINS", "DEFINES", "REFERENCES", "IMPORTS", "IMPLEMENTS", "TYPE_OF"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export type Direction = "in" | "out";

export const isEdgeType = (t: string | undefined): t is EdgeType => !!t && (EDGE_TYPES as readonly string[]).includes(t);

export interface GraphNode {
  id: string;
  /** "File", or the symbol's kind label ("Method", "Type"…); null for symbols without one. */
  kind: string | null;
  /** The symbol's name, or the file's project-relative path. */
  name: string;
  /** Defining file; null for external symbols. */
  file: string | null;
  line: number | null;
  endLine: number | null;
  external: boolean;
  isTest: boolean;
  /** Package of an external symbol, e.g. "react". */
  package: string | null;
  /** Edges to other shown nodes (parameters aren't shown). */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  count: number;
}

/** Edges of one type and direction at a node, e.g. 12 outgoing USES. */
export interface EdgeGroup {
  type: EdgeType;
  dir: Direction;
  count: number;
}

// Parameters only hang off their function by CONTAINS and are never referenced, so the graph leaves them out.
const shown = (v: string) => `(${v}:File OR (${v}:Symbol AND NOT ${v}:Parameter AND NOT ${v}:TypeParameter))`;

const node = (v: string) =>
  `CASE WHEN ${v}:File
     THEN {id: 'file:' + ${v}.path, kind: 'File', name: ${v}.path, file: ${v}.path, line: null, endLine: null, external: false,
           isTest: ${v}.isTest, package: null, degree: COUNT { (${v})--(x) WHERE ${shown("x")} }}
     ELSE {id: 'sym:' + ${v}.id, kind: [l IN labels(${v}) WHERE l <> 'Symbol'][0], name: ${v}.name, file: ${v}.file,
           line: ${v}.line, endLine: ${v}.endLine, external: ${v}.external, isTest: false, package: ${v}.packageName,
           degree: COUNT { (${v})--(x) WHERE ${shown("x")} }}
   END`;

const keyOf = (v: string) => `CASE WHEN ${v}:File THEN 'file:' + ${v}.path ELSE 'sym:' + ${v}.id END`;

/** `MATCH` for the node with this id, bound to `v`, with its key in `$key`; undefined for a malformed id. */
function matchId(id: string, v = "n") {
  if (id.startsWith("file:")) return { match: `MATCH (${v}:File {path: $key})`, key: id.slice(5) };
  if (id.startsWith("sym:")) return { match: `MATCH (${v}:Symbol {id: $key})`, key: id.slice(4) };
  return undefined;
}

export const isNodeId = (id: string | undefined): id is string => !!id && !!matchId(id);

export async function getNode(conn: Connection, id: string): Promise<{ node: GraphNode; groups: EdgeGroup[] } | undefined> {
  const m = matchId(id);
  if (!m) return undefined;
  const { rows } = await conn.queryAsync(
    `${m.match}
     OPTIONAL MATCH (n)-[r]-(x) WHERE ${shown("x")}
     WITH n, type(r) AS type, CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END AS dir, count(r) AS count
     RETURN ${node("n")} AS node, collect(CASE WHEN type IS NULL THEN null ELSE {type: type, dir: dir, count: count} END) AS groups`,
    { key: m.key },
  );
  const row = rows[0];
  if (!row) return undefined;
  return { node: row.node as GraphNode, groups: (row.groups as (EdgeGroup | null)[]).filter((g) => !!g) };
}

/** The id of the symbol defined at `name`, `file` and `line`, as the Search page names symbols. */
export async function findSymbolId(conn: Connection, name: string, file: string, line: number): Promise<string | undefined> {
  const { rows } = await conn.queryAsync(
    "MATCH (s:Symbol {external: false}) WHERE s.name = $name AND s.file = $file AND s.line = $line RETURN 'sym:' + s.id AS id LIMIT 1",
    { name, file, line },
  );
  return rows[0]?.id as string | undefined;
}

/** Files whose path, then symbols whose name, contains the text. Exact and shorter matches first. */
export async function searchNodes(conn: Connection, text: string, limit = 50): Promise<GraphNode[]> {
  const files = await conn.queryAsync(
    `MATCH (n:File) WHERE toLower(n.path) CONTAINS toLower($text)
     RETURN ${node("n")} AS node ORDER BY size(n.path), n.path LIMIT $limit`,
    { text, limit },
  );
  const symbols = await conn.queryAsync(
    `MATCH (n:Symbol {external: false}) WHERE toLower(n.name) CONTAINS toLower($text) AND NOT n:Parameter AND NOT n:TypeParameter
     RETURN ${node("n")} AS node
     ORDER BY CASE WHEN toLower(n.name) = toLower($text) THEN 0 ELSE 1 END, size(n.name), n.file, n.line LIMIT $limit`,
    { text, limit },
  );
  // An exact symbol name beats a path that merely contains it.
  const exact = symbols.rows.filter((r) => (r.node as GraphNode).name.toLowerCase() === text.toLowerCase());
  const rest = symbols.rows.filter((r) => !exact.includes(r));
  return [...exact, ...files.rows, ...rest].slice(0, limit).map((r) => r.node as GraphNode);
}

/**
 * Neighbors of a node along one type and direction of edge, or along every group when `type` is omitted.
 * Each group returns at most `limit` nodes, project code before external symbols and busiest edges first.
 */
export async function getNeighbors(
  conn: Connection,
  id: string,
  opts: { type?: EdgeType; dir?: Direction; limit?: number } = {},
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const m = matchId(id);
  if (!m) return { nodes: [], edges: [] };
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
  const groups = opts.type ? [{ type: opts.type, dir: opts.dir ?? "out" }] : ((await getNode(conn, id))?.groups ?? []);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const { type, dir } of groups) {
    // Types can't be parameters; `type` is interpolated only after checking it against EDGE_TYPES.
    if (!isEdgeType(type)) continue;
    const pattern = dir === "out" ? `(n)-[r:${type}]->(m)` : `(n)<-[r:${type}]-(m)`;
    const { rows } = await conn.queryAsync(
      `${m.match} MATCH ${pattern} WHERE ${shown("m")}
       RETURN ${node("m")} AS node, r.count AS count
       ORDER BY coalesce(m.external, false), r.count DESC, coalesce(m.name, m.path) LIMIT $limit`,
      { key: m.key, limit },
    );
    for (const row of rows) {
      const other = row.node as GraphNode;
      nodes.set(other.id, other);
      const [source, target] = dir === "out" ? [id, other.id] : [other.id, id];
      edges.push({ source, target, type, count: (row.count as number | null) ?? 1 });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Every edge between two of these nodes. */
export async function getEdgesAmong(conn: Connection, ids: string[]): Promise<GraphEdge[]> {
  const wanted = new Set(ids);
  const files = ids.filter((id) => id.startsWith("file:")).map((id) => id.slice(5));
  const symbols = ids.filter((id) => id.startsWith("sym:")).map((id) => id.slice(4));
  const edges: GraphEdge[] = [];
  for (const [match, keys] of [
    ["MATCH (a:File {path: k})", files],
    ["MATCH (a:Symbol {id: k})", symbols],
  ] as const) {
    if (keys.length === 0) continue;
    const { rows } = await conn.queryAsync(
      `UNWIND $keys AS k ${match} MATCH (a)-[r]->(b) WHERE ${shown("b")}
       RETURN ${keyOf("a")} AS source, ${keyOf("b")} AS target, type(r) AS type, r.count AS count`,
      { keys },
    );
    for (const r of rows) {
      if (wanted.has(r.target as string) && isEdgeType(r.type as string)) {
        edges.push({ source: r.source as string, target: r.target as string, type: r.type as EdgeType, count: (r.count as number | null) ?? 1 });
      }
    }
  }
  return edges;
}

/** One hop out of a search frontier: `a` is in the frontier, `b` is its neighbor, `out` says the edge runs a -> b. */
export interface Hop<Id> {
  a: Id;
  b: Id;
  type: EdgeType;
  out: boolean;
}

export interface PathStep<Id> {
  node: Id;
  /** The edge from the previous node; absent on the first step. */
  edge?: { type: EdgeType; forward: boolean };
}

/**
 * Bidirectional breadth-first search from `from` to `to`. `expand(frontier, side)` returns the hops out of the
 * frontier: the "from" side walks forward along edges and the "to" side backward, which only matters to the caller
 * when the search is directed. Each round grows the smaller frontier, and returns one of the shortest paths.
 */
export async function bidirectionalSearch<Id>(
  from: Id,
  to: Id,
  expand: (frontier: Id[], side: "from" | "to") => Promise<Hop<Id>[]>,
  { maxHops = 12, maxVisited = 100_000 } = {},
): Promise<PathStep<Id>[] | undefined> {
  if (from === to) return [{ node: from }];
  type Visit = { depth: number; prev?: Id; type?: EdgeType; out?: boolean };
  const sides = {
    from: { seen: new Map<Id, Visit>([[from, { depth: 0 }]]), frontier: [from], depth: 0 },
    to: { seen: new Map<Id, Visit>([[to, { depth: 0 }]]), frontier: [to], depth: 0 },
  };
  while (sides.from.frontier.length > 0 && sides.to.frontier.length > 0 && sides.from.depth + sides.to.depth < maxHops) {
    const name = sides.from.frontier.length <= sides.to.frontier.length ? "from" : "to";
    const side = sides[name];
    const other = sides[name === "from" ? "to" : "from"];
    const next: Id[] = [];
    let meet: { node: Id; total: number } | undefined;
    for (const hop of await expand(side.frontier, name)) {
      if (!side.seen.has(hop.b)) {
        side.seen.set(hop.b, { depth: side.depth + 1, prev: hop.a, type: hop.type, out: hop.out });
        next.push(hop.b);
      }
      const there = other.seen.get(hop.b);
      if (there) {
        const total = (side.seen.get(hop.b)?.depth ?? 0) + there.depth;
        if (!meet || total < meet.total) meet = { node: hop.b, total };
      }
    }
    side.frontier = next;
    side.depth++;
    if (meet) return joinPath(meet.node, sides.from.seen, sides.to.seen);
    if (sides.from.seen.size + sides.to.seen.size > maxVisited) return undefined;
  }
  return undefined;
}

type Visit<Id> = { prev?: Id; type?: EdgeType; out?: boolean };

function joinPath<Id>(meet: Id, fromSeen: Map<Id, Visit<Id>>, toSeen: Map<Id, Visit<Id>>): PathStep<Id>[] {
  // Walk back to `from`: each visit holds the edge from its predecessor, `out` meaning predecessor -> node.
  const path: PathStep<Id>[] = [];
  for (let id: Id | undefined = meet; id !== undefined; ) {
    const v: Visit<Id> = fromSeen.get(id)!;
    path.unshift({ node: id, edge: v.type ? { type: v.type, forward: !!v.out } : undefined });
    id = v.prev;
  }
  // Walk on to `to`: there `prev` is the next node along the path, and `out` means next -> node, i.e. backward.
  for (let v: Visit<Id> = toSeen.get(meet)!; v.prev !== undefined; v = toSeen.get(v.prev)!) {
    path.push({ node: v.prev, edge: { type: v.type!, forward: !v.out } });
  }
  return path;
}

/**
 * A shortest path between two nodes over the given edge types. `directed` follows edges only from source to target.
 * External symbols (library code) can be the ends but not stops along the way: everything passes through them.
 */
export async function findPath(
  conn: Connection,
  fromId: string,
  toId: string,
  opts: { types?: EdgeType[]; directed?: boolean; maxHops?: number } = {},
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | undefined> {
  const types = (opts.types ?? [...EDGE_TYPES]).filter(isEdgeType);
  const ends: number[] = [];
  for (const id of [fromId, toId]) {
    const m = matchId(id);
    if (!m) return undefined;
    const { rows } = await conn.queryAsync(`${m.match} RETURN id(n) AS id`, { key: m.key });
    if (!rows[0]) return undefined;
    ends.push(rows[0].id as number);
  }
  if (types.length === 0) return undefined;
  const rel = `[r:${types.join("|")}]`;
  const steps = await bidirectionalSearch<number>(
    ends[0],
    ends[1],
    async (frontier, side) => {
      const pattern = !opts.directed ? `(a)-${rel}-(b)` : side === "from" ? `(a)-${rel}->(b)` : `(a)<-${rel}-(b)`;
      const { rows } = await conn.queryAsync(
        `MATCH (a) WHERE id(a) IN $ids MATCH ${pattern}
         WHERE ${shown("b")} AND (coalesce(b.external, false) = false OR id(b) IN $ends)
         RETURN id(a) AS a, id(b) AS b, type(r) AS type, startNode(r) = a AS out`,
        { ids: frontier, ends },
      );
      return rows as unknown as Hop<number>[];
    },
    { maxHops: opts.maxHops },
  );
  if (!steps) return undefined;
  const { rows } = await conn.queryAsync(`MATCH (n) WHERE id(n) IN $ids RETURN id(n) AS id, ${node("n")} AS node`, {
    ids: steps.map((s) => s.node),
  });
  const byId = new Map(rows.map((r) => [r.id as number, r.node as GraphNode]));
  const nodes = steps.map((s) => byId.get(s.node)!);
  const edges = steps.slice(1).map((s, i): GraphEdge => {
    const [a, b] = [nodes[i].id, nodes[i + 1].id];
    return { ...(s.edge!.forward ? { source: a, target: b } : { source: b, target: a }), type: s.edge!.type, count: 1 };
  });
  return { nodes, edges };
}
