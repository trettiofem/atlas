// shortcut: agents have no owner (the web UI shows a mock creator), and every save rewrites an agent's turns and
// history as JSON columns. Add users before more than one person uses them.
import type { DatabaseSync } from "node:sqlite";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Turn } from "./agent.js";
import { openStore } from "./store.js";

export type AgentStatus = "ready" | "working";

export interface AgentRecord {
  id: string;
  title: string;
  description: string;
  /** False while Claude names it; until then the title and description are the prompt. */
  named: boolean;
  status: AgentStatus;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  /** The Anthropic conversation, so follow-ups keep the tool calls and results. */
  history: MessageParam[];
}

type AgentRow = {
  id: string;
  title: string;
  description: string;
  named: number;
  status: string;
  created_at: number;
  updated_at: number;
  turns: string;
  history: string;
};

/** The agents table. One writer: the web server opens it once and keeps it. */
export class AgentsDb {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      named INTEGER NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      turns TEXT NOT NULL, history TEXT NOT NULL
    )`);
  }

  static open(path?: string) {
    return new AgentsDb(openStore(path));
  }

  load(): AgentRecord[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all() as AgentRow[];
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      named: a.named !== 0,
      status: a.status === "working" ? "working" : "ready",
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      turns: JSON.parse(a.turns),
      history: JSON.parse(a.history),
    }));
  }

  save(agent: AgentRecord) {
    this.db
      .prepare(
        `INSERT INTO agents (id, title, description, named, status, created_at, updated_at, turns, history)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description,
           named = excluded.named, status = excluded.status, updated_at = excluded.updated_at,
           turns = excluded.turns, history = excluded.history`,
      )
      .run(
        agent.id,
        agent.title,
        agent.description,
        agent.named ? 1 : 0,
        agent.status,
        agent.createdAt,
        agent.updatedAt,
        JSON.stringify(agent.turns),
        JSON.stringify(agent.history),
      );
  }

  delete(id: string) {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }
}
