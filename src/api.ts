import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { hasApiKey, NO_API_KEY } from "./agent.js";
import { createAgent, deleteAgent, explain, listAgents, parseExplain, sendMessage, subscribe } from "./agents.js";
import { NOT_LOADED, reader } from "./db.js";
import { findPath, findSymbolId, getEdgesAmong, getNeighbors, getNode, isEdgeType, isNodeId, searchNodes } from "./graph.js";
import { deleteNote, findNotes, staleFiles } from "./notes-db.js";
import { getProject, isIndexedFile, isQueryCommand, overview, runQuery } from "./queries.js";
import { readDefinitions, resolveInRoot } from "./source.js";

const MAX_SOURCE_MATCHES = 3;
const MAX_FILE_BYTES = 1_000_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_EDGE_IDS = 5000;
const MAX_NOTES = 500;

const LINE = /^[1-9]\d*$/;
const AGENT = /^\/api\/agents\/([\w-]+)$/;
const AGENT_MESSAGES = /^\/api\/agents\/([\w-]+)\/messages$/;
const MAX_PROMPT = 20_000;
const STREAM_MS = 100;

const promptOf = (body: unknown) => {
  const prompt = (body as { prompt?: unknown } | undefined)?.prompt;
  return typeof prompt === "string" && prompt.trim() && prompt.length <= MAX_PROMPT ? prompt.trim() : undefined;
};

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
 * and for agents (see src/agents.ts):
 *   GET  /api/agents/events                 SSE: a `snapshot` of every agent, then an `agent` event per change and
 *                                           a `delete` event {id} per deletion
 *   POST /api/agents {prompt}               creates an agent and starts it; returns the agent
 *   POST /api/agents/<id>/messages {prompt} a follow-up; 409 while the agent is working
 *   DELETE /api/agents/<id>                 deletes the agent, stopping it if it's working
 *   POST /api/explain {file, lines, name, messages}   NDJSON: the reply's turns so far, one snapshot per line
 * and for field notes (see src/notes-db.ts), scoped to the loaded project:
 *   GET    /api/notes                       every note, newest first, each with its `staleFiles`
 *   DELETE /api/notes?topic=<topic>         deletes one; the topic is in the query since it can hold any character
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
      case "/api/agents/events": {
        const agents = listAgents();
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        event("snapshot", agents);
        const unsubscribe = subscribe((e) => (e.type === "agent" ? event("agent", e.agent) : event("delete", { id: e.id })));
        res.on("close", unsubscribe);
        return;
      }
      case "/api/agents": {
        if (req.method !== "POST") return send(405, { error: "Use POST" });
        if (!hasApiKey()) return send(503, { error: NO_API_KEY });
        const prompt = promptOf(await readJson(req));
        if (!prompt) return send(400, { error: "Expected {prompt}" });
        return send(201, createAgent(prompt));
      }
      case "/api/explain": {
        if (req.method !== "POST") return send(405, { error: "Use POST" });
        if (!hasApiKey()) return send(503, { error: NO_API_KEY });
        const body = parseExplain(await readJson(req));
        if (typeof body === "string") return send(400, { error: body });
        return streamExplain(req, res, body);
      }
      case "/api/notes": {
        const root = (await getProject(reader()))?.root;
        if (!root) return send(503, { error: NOT_LOADED });
        if (req.method === "DELETE") {
          if (!p.topic) return send(400, { error: "Expected a `topic`" });
          return deleteNote(root, p.topic) ? send(200, {}) : send(404, { error: "No such note" });
        }
        if (req.method !== "GET") return send(405, { error: "Use GET or DELETE" });
        const found = findNotes({ project: root, limit: MAX_NOTES });
        return send(200, await Promise.all(found.map(async (n) => ({ ...n, staleFiles: await staleFiles(root, n) }))));
      }
    }
    const agent = url.pathname.match(AGENT);
    if (agent) {
      if (req.method !== "DELETE") return send(405, { error: "Use DELETE" });
      return deleteAgent(agent[1]) ? send(200, {}) : send(404, { error: "No such agent" });
    }
    const messages = url.pathname.match(AGENT_MESSAGES);
    if (messages) {
      if (req.method !== "POST") return send(405, { error: "Use POST" });
      if (!hasApiKey()) return send(503, { error: NO_API_KEY });
      const prompt = promptOf(await readJson(req));
      if (!prompt) return send(400, { error: "Expected {prompt}" });
      const sent = sendMessage(messages[1], prompt);
      if (sent === undefined) return send(404, { error: "No such agent" });
      return sent ? send(202, {}) : send(409, { error: "The agent is still working" });
    }
    send(404, { error: "Not found" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    send(message === NOT_LOADED ? 503 : e instanceof RangeError ? 413 : 500, { error: message });
  }
}

/** Streams an Explain reply as NDJSON: each line is the reply's turns so far, at most one line per 100ms. */
async function streamExplain(req: IncomingMessage, res: ServerResponse, body: Exclude<ReturnType<typeof parseExplain>, string>) {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
  let latest: unknown[] = [];
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    res.write(`${JSON.stringify(latest)}\n`);
  };
  try {
    await explain(
      body,
      (turns) => {
        latest = turns;
        timer ??= setTimeout(flush, STREAM_MS);
      },
      abort.signal,
    );
  } catch (e) {
    latest = [...latest, { type: "error", text: e instanceof Error ? e.message : String(e) }];
  }
  if (!abort.signal.aborted) flush();
  res.end();
}
