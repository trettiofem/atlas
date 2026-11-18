// shortcut: agents are stored in a second embedded RelateDB store (agents-db/), separate from the code graph, with
// the Anthropic message history as a JSON string property and every save rewriting all of an agent's turns. It's a
// stopgap to keep agents across restarts: move them to a proper store (with users, and history that isn't a blob)
// before more than one person or process uses them.
import { fileURLToPath } from "node:url";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { type Connection, Database, type ParamValue } from "@relate/relate";
import type { Turn } from "./agent.js";

export const AGENTS_DB_PATH = fileURLToPath(new URL("../agents-db", import.meta.url));

export type AgentStatus = "ready" | "working";

export interface AgentRecord {
  id: string;
  title: string;
  description: string;
  status: AgentStatus;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  /** The Anthropic conversation, so follow-ups keep the tool calls and results. */
  history: MessageParam[];
}

type TurnRow = { seq: number; type: string; text?: string; kind?: string; label?: string; durationMs?: number; path?: string; from?: number; to?: number };

const toRow = (turn: Turn, seq: number): TurnRow => {
  const { lines, ...rest } = turn as Turn & { lines?: [number, number] };
  return { seq, ...rest, ...(lines && { from: lines[0], to: lines[1] }) };
};

function fromRow(row: TurnRow): Turn {
  switch (row.type) {
    case "user":
    case "answer":
    case "error":
      return { type: row.type, text: row.text ?? "" };
    case "step":
      return { type: "step", kind: row.kind === "graph" ? "graph" : "thought", label: row.label ?? "", durationMs: row.durationMs ?? 0 };
    default:
      return { type: "file", path: row.path ?? "", ...(row.from != null && row.to != null && { lines: [row.from, row.to] as [number, number] }) };
  }
}

/** Drops undefined values, which RelateDB parameters can't hold. */
const params = (obj: object) => JSON.parse(JSON.stringify(obj)) as { [key: string]: ParamValue };

/** The agents store. One writer: the web server opens it once and keeps it. */
export class AgentsDb {
  private readonly conn: Connection;

  constructor(private readonly db: Database) {
    this.conn = db.connect();
    this.conn.query("CREATE CONSTRAINT agent_id IF NOT EXISTS FOR (a:Agent) REQUIRE a.id IS UNIQUE");
  }

  static open(path = AGENTS_DB_PATH) {
    return new AgentsDb(Database.open(path));
  }

  load(): AgentRecord[] {
    const { rows } = this.conn.query(
      `MATCH (a:Agent)
       OPTIONAL MATCH (a)-[:HAS_TURN]->(t:Turn)
       WITH a, t ORDER BY t.seq
       RETURN a {.*} AS agent, collect(t {.*}) AS turns
       ORDER BY agent.createdAt DESC`,
    );
    return rows.map((row) => {
      const a = row.agent as Record<string, unknown>;
      return {
        id: String(a.id),
        title: String(a.title),
        description: String(a.description),
        status: a.status === "working" ? "working" : "ready",
        createdAt: Number(a.createdAt),
        updatedAt: Number(a.updatedAt),
        history: JSON.parse(String(a.history ?? "[]")),
        turns: (row.turns as TurnRow[]).map(fromRow),
      };
    });
  }

  save(agent: AgentRecord) {
    const { turns, history, ...props } = agent;
    this.conn.begin();
    try {
      this.conn.query("MERGE (a:Agent {id: $id}) SET a += $props", { id: agent.id, props: params({ ...props, history: JSON.stringify(history) }) });
      this.conn.query("MATCH (:Agent {id: $id})-[:HAS_TURN]->(t:Turn) DETACH DELETE t", { id: agent.id });
      this.conn.query("MATCH (a:Agent {id: $id}) UNWIND $turns AS turn CREATE (a)-[:HAS_TURN]->(t:Turn) SET t = turn", {
        id: agent.id,
        turns: params(turns.map(toRow)) as unknown as ParamValue[],
      });
      this.conn.commit();
    } catch (e) {
      this.conn.rollback();
      throw e;
    }
  }

  /** Compacts the write-ahead log, which otherwise grows with every save. */
  checkpoint() {
    this.db.checkpoint();
  }
}
