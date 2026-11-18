import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connection, Database } from "@relate/relate";

/** The embedded RelateDB store (a directory), shared by the CLI and the MCP server. */
export const DB_PATH = fileURLToPath(new URL("../graph-db", import.meta.url));

export const NOT_LOADED = "The graph is not loaded. Run `pnpm graph sync -p <project dir>` in the code-graph repo first.";

/** Opens the store for writing (created if missing). One writer process at a time; readers can stay open. */
export const openWriter = () => Database.open(DB_PATH);

/** Newest mtime of any file in the store; every commit and checkpoint bumps it, read-only opens don't. */
const storeVersion = () => Math.max(...readdirSync(DB_PATH, { recursive: true, encoding: "utf8" }).map((f) => statSync(join(DB_PATH, f)).mtimeMs));

let cached: { version: number; conn: Connection } | undefined;

/** A read-only connection. Read-only handles are snapshots, so this reopens once the store has changed. */
export function reader(): Connection {
  if (!existsSync(DB_PATH)) throw new Error(NOT_LOADED); // Relate only says "internal error" for a missing store
  const version = storeVersion();
  // shortcut: @relate/relate 1.1.0 has no Database.close(), so each reopen leaks the old snapshot; fine for a few syncs per MCP session, close it once the client exposes that.
  if (cached?.version !== version) cached = { version, conn: Database.open(DB_PATH, { readOnly: true }).connect() };
  return cached.conn;
}
