import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type NoteInput, NotesDb } from "./notes-db.js";
import { openStore } from "./store.js";

const input = (over: Partial<NoteInput> = {}): NoteInput => ({
  project: "/repo",
  topic: "Graph loading",
  summary: "How a SCIP index becomes the RelateDB graph.",
  markdown: "`loadGraph` wipes the store, then writes nodes before edges.",
  files: ["src/load.ts", "src/parse.ts"],
  symbols: ["loadGraph", "buildGraph"],
  ...over,
});

const open = () => new NotesDb(openStore(":memory:"));

describe("NotesDb", () => {
  it("round-trips a note", () => {
    const db = open();
    expect(db.save(input(), 1000)).toEqual({ replaced: false });
    const { project: _, ...rest } = input();
    expect(db.find({ project: "/repo" })).toEqual([{ ...rest, createdAt: 1000, updatedAt: 1000 }]);
  });

  it("replaces a note with the same topic, keeping its creation time", () => {
    const db = open();
    db.save(input(), 1000);
    expect(db.save(input({ summary: "Updated.", files: [] }), 2000)).toEqual({ replaced: true });
    expect(db.find({ project: "/repo" })).toMatchObject([{ summary: "Updated.", files: [], createdAt: 1000, updatedAt: 2000 }]);
  });

  it("scopes notes to their project", () => {
    const db = open();
    db.save(input());
    db.save(input({ project: "/other" }));
    expect(db.find({ project: "/repo" })).toHaveLength(1);
    expect(db.find({ project: "/none" })).toEqual([]);
  });

  it("filters by query words, file and symbol, newest first", () => {
    const db = open();
    db.save(input(), 1000);
    db.save(input({ topic: "Path search", summary: "Bidirectional BFS.", markdown: "One query per hop.", files: ["src/graph.ts"], symbols: ["findPath"] }), 2000);
    const topics = (filter: object) => db.find({ project: "/repo", ...filter }).map((n) => n.topic);
    expect(topics({})).toEqual(["Path search", "Graph loading"]);
    expect(topics({ query: "BFS hop" })).toEqual(["Path search"]);
    expect(topics({ query: "GRAPH" })).toEqual(["Graph loading"]);
    expect(topics({ query: "bfs wipes" })).toEqual([]);
    expect(topics({ file: "src/load.ts" })).toEqual(["Graph loading"]);
    expect(topics({ symbol: "findPath" })).toEqual(["Path search"]);
    expect(topics({ limit: 1 })).toEqual(["Path search"]);
  });

  it("deletes a note by project and topic", () => {
    const db = open();
    db.save(input());
    db.save(input({ project: "/other" }));
    expect(db.delete("/repo", "Graph loading")).toBe(true);
    expect(db.delete("/repo", "Graph loading")).toBe(false);
    expect(db.find({ project: "/repo" })).toEqual([]);
    expect(db.find({ project: "/other" })).toHaveLength(1);
  });

  it("keeps the notes of a store from when they were artifacts", () => {
    const store = openStore(":memory:");
    store.exec(`CREATE TABLE artifacts (
      project TEXT NOT NULL, topic TEXT NOT NULL, summary TEXT NOT NULL, markdown TEXT NOT NULL,
      files TEXT NOT NULL, symbols TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (project, topic)
    )`);
    store.exec(`INSERT INTO artifacts VALUES ('/repo', 'Old', 'Saved before.', 'Text.', '[]', '[]', 1000, 1000)`);
    expect(new NotesDb(store).find({ project: "/repo" }).map((n) => n.topic)).toEqual(["Old"]);
  });

  it("lets two connections to one file both write", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-"));
    try {
      const path = join(dir, "atlas.db");
      const a = new NotesDb(openStore(path));
      const b = new NotesDb(openStore(path));
      a.save(input({ topic: "From a" }), 1000);
      b.save(input({ topic: "From b" }), 2000);
      expect(a.find({ project: "/repo" }).map((x) => x.topic)).toEqual(["From b", "From a"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
