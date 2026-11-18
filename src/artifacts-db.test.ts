import { Database } from "@relate/relate";
import { describe, expect, it } from "vitest";
import { type ArtifactInput, ArtifactsDb } from "./artifacts-db.js";

const input = (over: Partial<ArtifactInput> = {}): ArtifactInput => ({
  project: "/repo",
  topic: "Graph loading",
  summary: "How a SCIP index becomes the RelateDB graph.",
  markdown: "`loadGraph` wipes the store, then writes nodes before edges.",
  files: ["src/load.ts", "src/parse.ts"],
  symbols: ["loadGraph", "buildGraph"],
  ...over,
});

const open = () => new ArtifactsDb(Database.open(":memory:").connect()).init();

describe("ArtifactsDb", () => {
  it("round-trips an artifact", () => {
    const db = open();
    expect(db.save(input(), 1000)).toEqual({ replaced: false });
    const { project: _, ...rest } = input();
    expect(db.find({ project: "/repo" })).toEqual([{ ...rest, createdAt: 1000, updatedAt: 1000 }]);
  });

  it("replaces an artifact with the same topic, keeping its creation time", () => {
    const db = open();
    db.save(input(), 1000);
    expect(db.save(input({ summary: "Updated.", files: [] }), 2000)).toEqual({ replaced: true });
    expect(db.find({ project: "/repo" })).toMatchObject([{ summary: "Updated.", files: [], createdAt: 1000, updatedAt: 2000 }]);
  });

  it("scopes artifacts to their project", () => {
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
    const topics = (filter: object) => db.find({ project: "/repo", ...filter }).map((a) => a.topic);
    expect(topics({})).toEqual(["Path search", "Graph loading"]);
    expect(topics({ query: "BFS hop" })).toEqual(["Path search"]);
    expect(topics({ query: "GRAPH" })).toEqual(["Graph loading"]);
    expect(topics({ query: "bfs wipes" })).toEqual([]);
    expect(topics({ file: "src/load.ts" })).toEqual(["Graph loading"]);
    expect(topics({ symbol: "findPath" })).toEqual(["Path search"]);
    expect(topics({ limit: 1 })).toEqual(["Path search"]);
  });
});
