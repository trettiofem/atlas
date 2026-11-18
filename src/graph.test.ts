import { describe, expect, it } from "vitest";
import { bidirectionalSearch, type EdgeType, type Hop } from "./graph.js";

/** `expand` over an in-memory edge list, following edges forward from the "from" side and backward from the "to" side. */
function over(edges: [string, string, EdgeType?][], directed: boolean) {
  return async (frontier: string[], side: "from" | "to"): Promise<Hop<string>[]> =>
    edges.flatMap(([s, t, type = "USES"]) => {
      const hops: Hop<string>[] = [];
      const forward = !directed || side === "from";
      const backward = !directed || side === "to";
      if (forward && frontier.includes(s)) hops.push({ a: s, b: t, type, out: true });
      if (backward && frontier.includes(t)) hops.push({ a: t, b: s, type, out: false });
      return hops;
    });
}

const names = (steps?: { node: string }[]) => steps?.map((s) => s.node).join(" ");

describe("bidirectionalSearch", () => {
  const chain: [string, string, EdgeType?][] = [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "e"],
    ["a", "x", "CONTAINS"],
    ["x", "e", "CONTAINS"],
  ];

  it("finds a shortest path", async () => {
    expect(names(await bidirectionalSearch("a", "e", over(chain, false)))).toBe("a x e");
    expect(names(await bidirectionalSearch("b", "d", over(chain, false)))).toBe("b c d");
  });

  it("records each edge's type and whether it runs along the path", async () => {
    const steps = await bidirectionalSearch("e", "a", over(chain, false));
    expect(steps).toEqual([
      { node: "e" },
      { node: "x", edge: { type: "CONTAINS", forward: false } },
      { node: "a", edge: { type: "CONTAINS", forward: false } },
    ]);
  });

  it("follows edge direction when directed", async () => {
    expect(names(await bidirectionalSearch("a", "e", over(chain, true)))).toBe("a x e");
    expect(await bidirectionalSearch("e", "a", over(chain, true))).toBeUndefined();
    const steps = await bidirectionalSearch("b", "e", over(chain, true));
    expect(names(steps)).toBe("b c d e");
    expect(steps?.slice(1).every((s) => s.edge?.forward)).toBe(true);
  });

  it("returns the single node for a path to itself, and nothing between disconnected nodes", async () => {
    expect(names(await bidirectionalSearch("a", "a", over(chain, false)))).toBe("a");
    expect(await bidirectionalSearch("a", "z", over([...chain, ["z", "y"]], false))).toBeUndefined();
  });

  it("gives up beyond maxHops", async () => {
    expect(await bidirectionalSearch("b", "e", over(chain, true), { maxHops: 2 })).toBeUndefined();
    expect(names(await bidirectionalSearch("b", "e", over(chain, true), { maxHops: 3 }))).toBe("b c d e");
  });

  it("picks the shortest meeting when one round reaches the other side at different depths", async () => {
    // From "s" the first round reaches both "m" (one hop from "t") and "t" itself.
    const edges: [string, string][] = [
      ["s", "m"],
      ["m", "t"],
      ["s", "t"],
      ["t", "u"],
      ["u", "v"],
      ["v", "w"],
    ];
    expect(names(await bidirectionalSearch("s", "t", over(edges, false)))).toBe("s t");
  });
});
