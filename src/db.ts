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
const storeVersion = (path: string) =>
  Math.max(...readdirSync(path, { recursive: true, encoding: "utf8" }).map((f) => statSync(join(path, f)).mtimeMs));

const snapshots = new Map<string, { version: number; conn: Connection }>();

/** A read-only connection to the store at `path`, which must exist. Read-only handles are snapshots, so this reopens once the store has changed. */
export function snapshot(path: string): Connection {
  const version = storeVersion(path);
  const cached = snapshots.get(path);
  if (cached?.version === version) return cached.conn;
  // shortcut: @relate/relate 1.1.0 has no Database.close(), so each reopen leaks the old snapshot; fine for a few syncs per MCP session, close it once the client exposes that.
  const conn = Database.open(path, { readOnly: true }).connect();
  snapshots.set(path, { version, conn });
  return conn;
}

/** A read-only connection to the code graph. */
export function reader(): Connection {
  if (!existsSync(DB_PATH)) throw new Error(NOT_LOADED); // Relate only says "internal error" for a missing store
  return snapshot(DB_PATH);
}
