import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NOT_LOADED, reader } from "./db.js";
import { findPath, findSymbolId, getEdgesAmong, getNeighbors, getNode, isEdgeType, isNodeId, searchNodes } from "./graph.js";
import { getProject, isIndexedFile, isQueryCommand, overview, runQuery } from "./queries.js";
import { readDefinitions, resolveInRoot } from "./source.js";

const MAX_SOURCE_MATCHES = 3;
const MAX_FILE_BYTES = 1_000_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_EDGE_IDS = 5000;

const LINE = /^[1-9]\d*$/;

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

// Only loopback Host headers: stops a DNS-rebinding page from reading project files through this server.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * JSON API for the web UI, the same queries the MCP server answers:
 *   GET /api/overview
 *   GET /api/query?cmd=<query command>&arg=<name or path>[&file=<path>&line=<n>&kind=<label>&depth=<n>]
 *   GET /api/source?name=<symbol>[&file=<path>]
 *   GET /api/file?path=<file>   whole text of a file in the graph
 * and for the Code Graph page, nodes and edges (ids are `file:<path>` or `sym:<SCIP symbol>`):
 *   GET  /api/graph/search?q=<text>                       files and symbols to start from
 *   GET  /api/graph/node?id=<id> | ?name=&file=&line=     a node and its edge counts per type and direction
 *   GET  /api/graph/neighbors?id=<id>[&type=<EDGE>&dir=in|out&limit=<n>]
 *   POST /api/graph/edges {ids: [...]}                    every edge between these nodes
 *   GET  /api/graph/path?from=<id>&to=<id>[&types=USES,CONTAINS&directed=1]   a shortest path; no nodes if none
 */
export async function handleApi(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (!LOOPBACK_HOST.test(req.headers.host ?? "")) return send(403, { error: "Forbidden host" });

  const url = new URL(req.url ?? "/", "http://localhost");
  const p = Object.fromEntries(url.searchParams) as Record<string, string | undefined>;
  try {
    switch (url.pathname) {
      case "/api/overview": {
        const result = await overview(reader());
        return result.project ? send(200, result) : send(503, { error: NOT_LOADED });
      }
      case "/api/query": {
        if (!isQueryCommand(p.cmd) || !p.arg) return send(400, { error: "Expected a query command `cmd` and `arg`" });
        if (p.line !== undefined && !LINE.test(p.line)) return send(400, { error: "Expected `line` to be a line number" });
        const opts = { file: p.file, line: p.line ? Number(p.line) : undefined, kind: p.kind, depth: p.depth };
        return send(200, await runQuery(reader(), p.cmd, p.arg, opts));
      }
      case "/api/source": {
        if (!p.name) return send(400, { error: "Expected a symbol `name`" });
        const conn = reader();
        const root = (await getProject(conn))?.root;
        if (!root) return send(503, { error: NOT_LOADED });
        const rows = await runQuery(conn, "source", p.name, { file: p.file });
        return send(200, await readDefinitions(root, rows.slice(0, MAX_SOURCE_MATCHES)));
      }
      case "/api/file": {
        if (!p.path) return send(400, { error: "Expected a file `path`" });
        const conn = reader();
        const root = (await getProject(conn))?.root;
        if (!root) return send(503, { error: NOT_LOADED });
        // Only indexed files: everything else under the root (.env, the graph store) stays unreadable.
        if (!(await isIndexedFile(conn, p.path))) return send(404, { error: `${p.path} is not in the graph` });
        const path = resolveInRoot(root, p.path);
        const size = (await stat(path).catch(() => undefined))?.size;
        if (size === undefined) return send(404, { error: "File not readable; the graph may be stale" });
        if (size > MAX_FILE_BYTES) return send(413, { error: `${p.path} is too large to show` });
        return send(200, { file: p.path, text: await readFile(path, "utf8") });
      }
      case "/api/graph/search": {
        if (!p.q) return send(400, { error: "Expected a search text `q`" });
        return send(200, await searchNodes(reader(), p.q));
      }
      case "/api/graph/node": {
        const conn = reader();
        let id = p.id;
        if (!id && p.name && p.file && p.line && LINE.test(p.line)) id = await findSymbolId(conn, p.name, p.file, Number(p.line));
        else if (!isNodeId(id)) return send(400, { error: "Expected a node `id`, or a symbol `name`, `file` and `line`" });
        const found = id && (await getNode(conn, id));
        return found ? send(200, found) : send(404, { error: "Not in the graph" });
      }
      case "/api/graph/neighbors": {
        if (!isNodeId(p.id)) return send(400, { error: "Expected a node `id`" });
        if (p.type !== undefined && !isEdgeType(p.type)) return send(400, { error: "Unknown edge `type`" });
        if (p.dir !== undefined && p.dir !== "in" && p.dir !== "out") return send(400, { error: "Expected `dir` to be in or out" });
        if (p.limit !== undefined && !LINE.test(p.limit)) return send(400, { error: "Expected `limit` to be a number" });
        return send(200, await getNeighbors(reader(), p.id, { type: p.type, dir: p.dir, limit: p.limit ? Number(p.limit) : undefined }));
      }
      case "/api/graph/edges": {
        if (req.method !== "POST") return send(405, { error: "Use POST" });
        const body = (await readJson(req)) as { ids?: unknown } | undefined;
        const ids = body?.ids;
        if (!Array.isArray(ids) || ids.length > MAX_EDGE_IDS || !ids.every((id) => typeof id === "string" && isNodeId(id))) {
          return send(400, { error: `Expected {ids: [...]} with at most ${MAX_EDGE_IDS} node ids` });
        }
        return send(200, await getEdgesAmong(reader(), ids));
      }
      case "/api/graph/path": {
        if (!isNodeId(p.from) || !isNodeId(p.to)) return send(400, { error: "Expected node ids `from` and `to`" });
        const types = p.types?.split(",");
        if (types && !types.every(isEdgeType)) return send(400, { error: "Unknown edge type in `types`" });
        const path = await findPath(reader(), p.from, p.to, { types, directed: p.directed === "1" });
        return send(200, path ?? { nodes: [], edges: [] });
      }
    }
    send(404, { error: "Not found" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    send(message === NOT_LOADED ? 503 : e instanceof RangeError ? 413 : 500, { error: message });
  }
}
