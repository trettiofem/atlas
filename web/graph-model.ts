import type { Direction, EdgeType, GraphEdge, GraphNode, Subgraph } from "@/api";

/** One type and direction of edge at a node, e.g. "USES:out" for what it uses. */
export type GroupKey = `${EdgeType}:${Direction}`;
export const groupKey = (type: EdgeType, dir: Direction): GroupKey => `${type}:${dir}`;

/**
 * Why a node is shown. "pin": the user added it. "path": it's on the found path. Otherwise `<node id>\n<group>`:
 * expanding that node along that group brought it in. A node leaves once nothing keeps it.
 */
type Reason = string;
const expandedBy = (id: string, group: GroupKey): Reason => `${id}\n${group}`;

export interface ShownNode {
  node: GraphNode;
  reasons: Set<Reason>;
}

export interface GraphModel {
  nodes: Map<string, ShownNode>;
  edges: Map<string, GraphEdge>;
  /** The groups each node has been expanded along. */
  expanded: Map<string, Set<GroupKey>>;
  path?: { nodes: string[]; edges: string[] };
}

export const emptyModel = (): GraphModel => ({ nodes: new Map(), edges: new Map(), expanded: new Map() });

export const edgeId = (e: GraphEdge) => `${e.source}\n${e.type}\n${e.target}`;

/** Copies everything an update can touch, so each update returns a new model. */
function clone(m: GraphModel): GraphModel {
  return {
    nodes: new Map([...m.nodes].map(([id, s]) => [id, { node: s.node, reasons: new Set(s.reasons) }])),
    edges: new Map(m.edges),
    expanded: new Map([...m.expanded].map(([id, groups]) => [id, new Set(groups)])),
    path: m.path,
  };
}

function put(m: GraphModel, node: GraphNode, reason?: Reason) {
  const shown = m.nodes.get(node.id);
  if (shown) shown.node = node;
  else m.nodes.set(node.id, { node, reasons: new Set() });
  if (reason) m.nodes.get(node.id)!.reasons.add(reason);
}

function putEdges(m: GraphModel, edges: GraphEdge[]) {
  for (const e of edges) if (m.nodes.has(e.source) && m.nodes.has(e.target)) m.edges.set(edgeId(e), e);
}

/** Drops a node, its edges and everything only its expansions kept. */
function drop(m: GraphModel, id: string) {
  if (!m.nodes.delete(id)) return;
  for (const [key, e] of m.edges) if (e.source === id || e.target === id) m.edges.delete(key);
  for (const group of m.expanded.get(id) ?? []) release(m, expandedBy(id, group));
  m.expanded.delete(id);
}

function release(m: GraphModel, reason: Reason) {
  // Deleting while iterating a Map is safe: dropped entries just aren't visited.
  for (const [id, shown] of m.nodes) {
    if (shown.reasons.delete(reason) && shown.reasons.size === 0) drop(m, id);
  }
}

function unsetPath(m: GraphModel) {
  if (!m.path) return;
  m.path = undefined;
  release(m, "path");
}

/** Shows nodes the user picked. */
export function pin(m: GraphModel, nodes: GraphNode[]): GraphModel {
  const next = clone(m);
  for (const node of nodes) put(next, node, "pin");
  return next;
}

/** Shows `sub`, the neighbors of `id`, as expanded along `groups` (every group of its edges when omitted). */
export function expand(m: GraphModel, id: string, sub: Subgraph, groups?: GroupKey[]): GraphModel {
  if (!m.nodes.has(id)) return m;
  const next = clone(m);
  const done = next.expanded.get(id) ?? new Set();
  next.expanded.set(id, done);
  for (const group of groups ?? []) done.add(group);
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  for (const e of sub.edges) {
    const out = e.source === id;
    const other = byId.get(out ? e.target : e.source);
    if (!other) continue;
    const group = groupKey(e.type, out ? "out" : "in");
    done.add(group);
    // A recursive function is its own neighbor; it's kept by whatever showed it first.
    put(next, other, other.id === id ? undefined : expandedBy(id, group));
  }
  putEdges(next, sub.edges);
  if (done.size === 0) next.expanded.delete(id);
  return next;
}

/** Hides what expanding `id` along `group` (every group when omitted) brought in, unless something else keeps it. */
export function collapse(m: GraphModel, id: string, group?: GroupKey): GraphModel {
  const done = m.expanded.get(id);
  if (!done) return m;
  const next = clone(m);
  const groups = group ? [group] : [...done];
  const left = next.expanded.get(id)!;
  for (const g of groups) {
    left.delete(g);
    release(next, expandedBy(id, g));
  }
  if (left.size === 0) next.expanded.delete(id);
  return next;
}

/** Removes a node outright, with what only it kept. Removing a stop on the path clears the path. */
export function remove(m: GraphModel, id: string): GraphModel {
  const next = clone(m);
  if (next.path?.nodes.includes(id)) unsetPath(next);
  drop(next, id);
  return next;
}

/** Replaces the shown path; its nodes stay until the path is cleared. */
export function setPath(m: GraphModel, sub: Subgraph): GraphModel {
  const next = clone(m);
  unsetPath(next);
  for (const node of sub.nodes) put(next, node, "path");
  putEdges(next, sub.edges);
  next.path = { nodes: sub.nodes.map((n) => n.id), edges: sub.edges.map(edgeId) };
  return next;
}

export function clearPath(m: GraphModel): GraphModel {
  if (!m.path) return m;
  const next = clone(m);
  unsetPath(next);
  return next;
}

export function addEdges(m: GraphModel, edges: GraphEdge[]): GraphModel {
  const fresh = edges.filter((e) => !m.edges.has(edgeId(e)) && m.nodes.has(e.source) && m.nodes.has(e.target));
  if (fresh.length === 0) return m;
  const next = clone(m);
  putEdges(next, fresh);
  return next;
}

/** How many of each node's edges aren't shown. */
export function hiddenEdges(m: GraphModel): Map<string, number> {
  const shownCount = new Map<string, number>();
  for (const e of m.edges.values()) {
    shownCount.set(e.source, (shownCount.get(e.source) ?? 0) + 1);
    if (e.target !== e.source) shownCount.set(e.target, (shownCount.get(e.target) ?? 0) + 1);
  }
  return new Map([...m.nodes].map(([id, s]) => [id, Math.max(0, s.node.degree - (shownCount.get(id) ?? 0))]));
}

/** Shown edges at `id` per group. */
export function shownByGroup(m: GraphModel, id: string): Map<GroupKey, number> {
  const counts = new Map<GroupKey, number>();
  for (const e of m.edges.values()) {
    if (e.source === id) counts.set(groupKey(e.type, "out"), (counts.get(groupKey(e.type, "out")) ?? 0) + 1);
    else if (e.target === id) counts.set(groupKey(e.type, "in"), (counts.get(groupKey(e.type, "in")) ?? 0) + 1);
  }
  return counts;
}
