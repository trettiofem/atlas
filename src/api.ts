import type { IncomingMessage, ServerResponse } from "node:http";
import { NOT_LOADED, reader } from "./db.js";
import { getProject, isQueryCommand, overview, runQuery } from "./queries.js";
import { readDefinitions } from "./source.js";

const MAX_SOURCE_MATCHES = 3;

// Only loopback Host headers: stops a DNS-rebinding page from reading project files through this server.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * JSON API for the web UI, the same queries the MCP server answers:
 *   GET /api/overview
 *   GET /api/query?cmd=<query command>&arg=<name or path>[&file=<path>&kind=<label>&depth=<n>]
 *   GET /api/source?name=<symbol>[&file=<path>]
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
      case "/api/query":
        if (!isQueryCommand(p.cmd) || !p.arg) return send(400, { error: "Expected a query command `cmd` and `arg`" });
        return send(200, await runQuery(reader(), p.cmd, p.arg, { file: p.file, kind: p.kind, depth: p.depth }));
      case "/api/source": {
        if (!p.name) return send(400, { error: "Expected a symbol `name`" });
        const conn = reader();
        const root = (await getProject(conn))?.root;
        if (!root) return send(503, { error: NOT_LOADED });
        const rows = await runQuery(conn, "source", p.name, { file: p.file });
        return send(200, await readDefinitions(root, rows.slice(0, MAX_SOURCE_MATCHES)));
      }
    }
    send(404, { error: "Not found" });
  } catch (e) {
    send(500, { error: e instanceof Error ? e.message : String(e) });
  }
}
