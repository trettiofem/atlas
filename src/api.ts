import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NOT_LOADED, reader } from "./db.js";
import { getProject, isIndexedFile, isQueryCommand, overview, runQuery } from "./queries.js";
import { readDefinitions, resolveInRoot } from "./source.js";

const MAX_SOURCE_MATCHES = 3;
const MAX_FILE_BYTES = 1_000_000;

// Only loopback Host headers: stops a DNS-rebinding page from reading project files through this server.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * JSON API for the web UI, the same queries the MCP server answers:
 *   GET /api/overview
 *   GET /api/query?cmd=<query command>&arg=<name or path>[&file=<path>&line=<n>&kind=<label>&depth=<n>]
 *   GET /api/source?name=<symbol>[&file=<path>]
 *   GET /api/file?path=<file>   whole text of a file in the graph
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
        if (p.line !== undefined && !/^[1-9]\d*$/.test(p.line)) return send(400, { error: "Expected `line` to be a line number" });
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
    }
    send(404, { error: "Not found" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    send(message === NOT_LOADED ? 503 : 500, { error: message });
  }
}
