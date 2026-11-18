import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/api";
import { clearPath, collapse, emptyModel, expand, groupKey, hiddenEdges, pin, remove, setPath } from "./graph-model";

const n = (id: string, degree = 1): GraphNode => ({
  id,
  kind: "Method",
  name: id,
  file: "a.ts",
  line: 1,
  endLine: 1,
  external: false,
  isTest: false,
  package: null,
  degree,
});
const uses = (source: string, target: string): GraphEdge => ({ source, target, type: "USES", count: 1 });
const ids = (m: { nodes: Map<string, unknown> }) => [...m.nodes.keys()].sort().join(" ");

describe("graph model", () => {
  it("collapsing hides what expanding showed", () => {
    let m = pin(emptyModel(), [n("a", 2)]);
    m = expand(m, "a", { nodes: [n("b"), n("c")], edges: [uses("a", "b"), uses("c", "a")] });
    expect(ids(m)).toBe("a b c");
    expect([...m.expanded.get("a")!].sort()).toEqual(["USES:in", "USES:out"]);
    expect(hiddenEdges(m).get("a")).toBe(0);
    m = collapse(m, "a", groupKey("USES", "out"));
    expect(ids(m)).toBe("a c");
    m = collapse(m, "a");
    expect(ids(m)).toBe("a");
    expect(m.edges.size).toBe(0);
    expect(m.expanded.has("a")).toBe(false);
  });

  it("keeps a node another expansion or a pin still needs", () => {
    let m = pin(emptyModel(), [n("a"), n("d")]);
    m = expand(m, "a", { nodes: [n("b")], edges: [uses("a", "b")] });
    m = expand(m, "d", { nodes: [n("b")], edges: [uses("d", "b")] });
    m = collapse(m, "a");
    expect(ids(m)).toBe("a b d");
    m = collapse(m, "d");
    expect(ids(m)).toBe("a d");
  });

  it("collapses recursively, without dropping pinned nodes in cycles", () => {
    let m = pin(emptyModel(), [n("a")]);
    m = expand(m, "a", { nodes: [n("b")], edges: [uses("a", "b")] });
    m = expand(m, "b", { nodes: [n("a"), n("c")], edges: [uses("b", "a"), uses("b", "c")] });
    expect(ids(m)).toBe("a b c");
    m = collapse(m, "a");
    expect(ids(m)).toBe("a");
  });

  it("keeps path nodes until the path is cleared, and removing a stop clears it", () => {
    let m = pin(emptyModel(), [n("a")]);
    m = setPath(m, { nodes: [n("a"), n("x"), n("z")], edges: [uses("a", "x"), uses("x", "z")] });
    expect(ids(m)).toBe("a x z");
    expect(m.path?.nodes).toEqual(["a", "x", "z"]);
    expect(ids(clearPath(m))).toBe("a");
    const removed = remove(m, "x");
    expect(removed.path).toBeUndefined();
    expect(ids(removed)).toBe("a");
  });

  it("returns new models and leaves the old ones alone", () => {
    const a = pin(emptyModel(), [n("a")]);
    const b = expand(a, "a", { nodes: [n("b")], edges: [uses("a", "b")] });
    expect(ids(a)).toBe("a");
    expect(ids(b)).toBe("a b");
  });
});
