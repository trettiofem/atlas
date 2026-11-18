import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { handleApi } from "./api.js";

async function call(url: string, host = "localhost:5180") {
  const out = { status: 0, body: undefined as unknown };
  const res = {
    writeHead: (status: number) => ((out.status = status), res),
    end: (body: string) => (out.body = JSON.parse(body)),
  };
  await handleApi({ url, headers: { host } } as IncomingMessage, res as unknown as ServerResponse);
  return out;
}

// These fail before the graph is opened, so they don't need a loaded graph.
describe("handleApi", () => {
  it("refuses a non-loopback Host (DNS rebinding)", async () => {
    expect((await call("/api/overview", "evil.example")).status).toBe(403);
    expect((await call("/api/overview", "localhost.evil.example")).status).toBe(403);
  });

  it("rejects unknown query commands, including Object.prototype keys", async () => {
    expect((await call("/api/query?cmd=constructor&arg=x")).status).toBe(400);
    expect((await call("/api/query?cmd=callers")).status).toBe(400);
  });

  it("rejects a `line` that isn't a line number", async () => {
    expect((await call("/api/query?cmd=find&arg=x&line=abc")).status).toBe(400);
    expect((await call("/api/query?cmd=find&arg=x&line=0")).status).toBe(400);
  });

  it("requires a path for /api/file", async () => {
    expect((await call("/api/file")).status).toBe(400);
  });

  it("404s unknown routes", async () => {
    expect((await call("/api/nope")).status).toBe(404);
  });
});
