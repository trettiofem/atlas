import { Database } from "@relate/relate";
import { describe, expect, it } from "vitest";
import { type AgentRecord, AgentsDb } from "./agents-db.js";

const agent = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "a1",
  title: "Who calls buildGraph",
  description: "Find the callers of buildGraph.",
  status: "working",
  createdAt: 1000,
  updatedAt: 2000,
  history: [{ role: "user", content: "Who calls buildGraph?" }],
  turns: [
    { type: "user", text: "Who calls buildGraph?" },
    { type: "step", kind: "graph", label: "Found callers of buildGraph", durationMs: 52 },
    { type: "answer", text: "It's called by `loadGraph`." },
    { type: "file", path: "src/load.ts", lines: [83, 86] },
    { type: "file", path: "src/parse.ts" },
    { type: "error", text: "Interrupted." },
  ],
  ...over,
});

describe("AgentsDb", () => {
  it("round-trips agents, turns in order and history", () => {
    const db = new AgentsDb(Database.open(":memory:"));
    db.save(agent());
    expect(db.load()).toEqual([agent()]);
  });

  it("replaces turns on save and lists newest first", () => {
    const db = new AgentsDb(Database.open(":memory:"));
    db.save(agent());
    db.save(agent({ status: "ready", turns: [{ type: "user", text: "Hi" }] }));
    db.save(agent({ id: "a2", createdAt: 5000 }));
    const [newest, first] = db.load();
    expect(newest.id).toBe("a2");
    expect(first).toMatchObject({ status: "ready", turns: [{ type: "user", text: "Hi" }] });
  });
});
