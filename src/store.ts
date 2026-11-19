import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

/** The SQLite file for agents and field notes, shared by the web server and every MCP process. The code graph is in graph-db/. */
export const STORE_PATH = fileURLToPath(new URL("../atlas.db", import.meta.url));

const SQLITE_BUSY = 5;
const WAL_ATTEMPTS = 5;

/** Opens the store (created if missing). WAL plus a busy timeout lets several processes write it. */
export function openStore(path = STORE_PATH) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  // Processes switching a new file to WAL at once can deadlock, and SQLite then fails one without waiting.
  for (let attempt = 1; ; attempt++) {
    try {
      db.exec("PRAGMA journal_mode = WAL");
      return db;
    } catch (e) {
      if ((e as { errcode?: number }).errcode !== SQLITE_BUSY || attempt === WAL_ATTEMPTS) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
}
