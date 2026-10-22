import { describe, expect, it } from "vitest";
import { buildGraph } from "./parse.js";
import type { ScipIndex } from "./types.js";

const sym = (descriptor: string) => `scip-typescript npm demo 1.0.0 src/\`a.ts\`/${descriptor}`;
const DEF = 1;

// src/a.ts:
//   export namespace Shapes {                        (lines 1-8)
//     export class Box {                             (lines 2-7)
//       area<T>(scale: number) {                     (lines 3-5)
//         return scale * this.width;                 (line 4)
//       }
//       width = 1;                                   (line 6)
//     }
//   }
//   const opts: { verbose: boolean } = ...           (line 9, `verbose` is a Meta descriptor)
// src/a.test.ts: imports a.ts and references Box.
const index: ScipIndex = {
  metadata: { projectRoot: "file:///work/demo", toolInfo: { name: "scip-typescript", version: "0.4.0" } },
  documents: [
    {
      relativePath: "src/a.ts",
      occurrences: [
        { symbol: sym(""), symbolRoles: DEF, range: [0, 0, 0] },
        { symbol: sym("Shapes/"), symbolRoles: DEF, range: [1, 17, 23], enclosingRange: [1, 0, 8, 1] },
        { symbol: sym("Shapes/Box#"), symbolRoles: DEF, range: [2, 15, 18], enclosingRange: [2, 2, 7, 3] },
        { symbol: sym("Shapes/Box#area()."), symbolRoles: DEF, range: [3, 4, 8], enclosingRange: [3, 4, 5, 5] },
        { symbol: sym("Shapes/Box#area().[T]"), symbolRoles: DEF, range: [3, 9, 10] },
        { symbol: sym("Shapes/Box#area().(scale)"), symbolRoles: DEF, range: [3, 12, 17] },
        { symbol: sym("Shapes/Box#area().(scale)"), range: [4, 13, 18] },
        { symbol: sym("Shapes/Box#width."), range: [4, 26, 31] },
        { symbol: sym("Shapes/Box#width."), symbolRoles: DEF, range: [6, 4, 9], enclosingRange: [6, 4, 6, 14] },
        { symbol: sym("opts."), symbolRoles: DEF, range: [9, 6, 10], enclosingRange: [9, 0, 9, 40] },
        { symbol: sym("opts.typeLiteral0:verbose."), symbolRoles: DEF, range: [9, 14, 21] },
      ],
    },
    {
      relativePath: "src/a.test.ts",
      occurrences: [
        { symbol: sym(""), range: [0, 20, 28] },
        { symbol: sym("Shapes/Box#"), range: [2, 2, 5] },
      ],
    },
  ],
};

describe("buildGraph", () => {
  const g = buildGraph(index);
  const byId = new Map(g.symbols.map((s) => [s.id, s]));
  const names = (edges: { from: string; to: string }[]) =>
    edges.map((e) => `${byId.get(e.from)?.name ?? e.from} -> ${byId.get(e.to)?.name ?? e.to}`).sort();

  it("records the project root and indexer", () => {
    expect(g.project).toEqual({ root: "/work/demo", tool: "scip-typescript", toolVersion: "0.4.0" });
  });

  it("records where each definition ends", () => {
    expect(byId.get(sym("Shapes/Box#area()."))).toMatchObject({ line: 4, endLine: 6 });
    expect(byId.get(sym("Shapes/Box#area().(scale)"))?.endLine).toBeUndefined();
  });

  it("labels each symbol with its descriptor kind", () => {
    expect(Object.fromEntries(g.symbols.map((s) => [s.name, s.kind]))).toEqual({
      Shapes: "Namespace",
      Box: "Type",
      area: "Method",
      T: "TypeParameter",
      scale: "Parameter",
      width: "Term",
      opts: "Term",
    });
  });

  it("represents the module symbol by its File, not a Namespace node", () => {
    expect(byId.has(sym(""))).toBe(false);
    expect(g.imports).toEqual([{ from: "src/a.test.ts", to: "src/a.ts", count: 2 }]);
  });

  it("drops Meta (type-literal) members", () => {
    expect(g.symbols.map((s) => s.name)).not.toContain("verbose");
  });

  it("nests parameters under their method", () => {
    expect(names(g.contains)).toEqual(["Box -> area", "Box -> width", "Shapes -> Box", "area -> T", "area -> scale"]);
  });

  it("does not record parameter references as uses or references", () => {
    expect(names(g.uses)).toEqual(["area -> width"]);
    expect(g.references.map((e) => byId.get(e.to)?.name)).not.toContain("scale");
  });
});

describe("buildGraph across languages", () => {
  // Rust: the indexer declares the language, sets SCIP kinds and emits no enclosing ranges.
  const rs = (descriptor: string) => `rust-analyzer cargo my  crate 0.1.0 crate/${descriptor}`;
  const g = buildGraph({
    documents: [
      {
        relativePath: "src/lib.rs",
        language: "Rust",
        occurrences: [
          { symbol: rs("Point#"), symbolRoles: DEF, range: [0, 11, 16] },
          { symbol: rs("Point#new()."), symbolRoles: DEF, range: [2, 9, 12] },
          { symbol: rs("ORIGIN."), symbolRoles: DEF, range: [5, 6, 12] },
          { symbol: rs("point!"), symbolRoles: DEF, range: [7, 13, 18] },
          { symbol: rs("Point#x:"), symbolRoles: DEF, range: [0, 19, 20] },
        ],
        symbols: [
          { symbol: rs("Point#"), kind: "Struct" },
          { symbol: rs("ORIGIN."), kind: "Constant", relationships: [{ symbol: rs("Point#"), isTypeDefinition: true }] },
        ],
      },
      {
        relativePath: "src/main/java/com/foo/A.java",
        occurrences: [
          { symbol: "scip-java maven com.foo:lib 1.0 com/foo/", symbolRoles: DEF, range: [0, 8, 15] },
          { symbol: "scip-java maven com.foo:lib 1.0 com/foo/A#", symbolRoles: DEF, range: [1, 13, 14] },
        ],
      },
      { relativePath: "pkg/test_util.py", language: "Python", occurrences: [] },
      { relativePath: "server/handler_test.go", occurrences: [] },
      { relativePath: "server/handler.go", occurrences: [] },
    ],
  });
  const byName = new Map(g.symbols.map((s) => [s.name, s]));
  const file = (path: string) => g.files.find((f) => f.path === path);

  it("takes the language from the document, or else the file extension", () => {
    expect(g.files.map((f) => f.language)).toEqual(["rust", "java", "python", "go", "go"]);
  });

  it("detects test files with per-language conventions", () => {
    expect(g.files.filter((f) => f.isTest).map((f) => f.path)).toEqual(["pkg/test_util.py", "server/handler_test.go"]);
    expect(file("server/handler.go")?.isTest).toBe(false);
  });

  it("keeps Macro and, outside TypeScript, Meta symbols", () => {
    expect(byName.get("point")?.kind).toBe("Macro");
    expect(byName.get("x")?.kind).toBe("Meta");
  });

  it("keeps the indexer's detailed kind", () => {
    expect(byName.get("Point")?.scipKind).toBe("Struct");
    expect(byName.get("new")?.scipKind).toBeUndefined();
  });

  it("splits package coordinates, unescaping double spaces and `.` placeholders", () => {
    expect(byName.get("Point")).toMatchObject({
      scheme: "rust-analyzer",
      manager: "cargo",
      packageName: "my crate",
      version: "0.1.0",
    });
    const dotted = buildGraph({
      documents: [
        {
          relativePath: "a.py",
          occurrences: [{ symbol: "scip-python python . . a/f().", symbolRoles: DEF, range: [0, 4, 5] }],
        },
      ],
    }).symbols[0];
    expect(dotted).toMatchObject({ scheme: "scip-python", manager: "python", packageName: undefined, version: undefined });
  });

  it("falls back to the descriptor parent for CONTAINS and reports files without enclosing ranges", () => {
    const contains = g.contains.map((e) => `${e.from.split(" ").at(-1)} -> ${e.to.split(" ").at(-1)}`);
    expect(contains).toEqual(expect.arrayContaining(["crate/Point# -> crate/Point#new().", "crate/Point# -> crate/Point#x:"]));
    expect(g.filesWithoutScopes).toEqual(["src/lib.rs", "src/main/java/com/foo/A.java"]);
  });

  it("keeps multi-file packages as Namespace nodes", () => {
    expect(byName.get("foo")?.kind).toBe("Namespace");
    expect(g.contains.map((e) => [e.from, e.to])).toContainEqual([
      "scip-java maven com.foo:lib 1.0 com/foo/",
      "scip-java maven com.foo:lib 1.0 com/foo/A#",
    ]);
  });

  it("records SCIP type definitions as TYPE_OF", () => {
    expect(g.typeOf).toEqual([{ from: rs("ORIGIN."), to: rs("Point#") }]);
  });
});
