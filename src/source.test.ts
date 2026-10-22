import { describe, expect, it } from "vitest";
import { CONTEXT_LINES, MAX_LINES, resolveInRoot, sliceLines, toProjectRelative } from "./source.js";

const file = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");

describe("sliceLines", () => {
  it("returns the definition's lines, numbered", () => {
    expect(sliceLines("a\nb\nc\nd", 2, 3)).toEqual({ start: 2, end: 3, truncated: false, text: "2  b\n3  c" });
  });

  it("pads line numbers to the widest one", () => {
    expect(sliceLines(file, 9, 10).text).toBe(" 9  line 9\n10  line 10");
  });

  it("shows context lines when there is no end line", () => {
    expect(sliceLines(file, 100).end).toBe(100 + CONTEXT_LINES);
  });

  it("clamps to the file", () => {
    expect(sliceLines("a\nb", 0, 99)).toMatchObject({ start: 1, end: 2 });
    expect(sliceLines("a\nb", 5)).toMatchObject({ start: 2, end: 2 });
  });

  it(`caps a definition at ${MAX_LINES} lines`, () => {
    expect(sliceLines(file, 1, 500)).toMatchObject({ start: 1, end: MAX_LINES, truncated: true });
  });
});

describe("paths", () => {
  it("resolves project-relative files under the root", () => {
    expect(resolveInRoot("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
  });

  it("refuses paths that leave the root", () => {
    expect(() => resolveInRoot("/repo", "../etc/passwd")).toThrow(/outside the project root/);
    expect(() => resolveInRoot("/repo", "/etc/passwd")).toThrow(/outside the project root/);
  });

  it("accepts absolute paths under the root as input", () => {
    expect(toProjectRelative("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(toProjectRelative("/repo", "src/a.ts")).toBe("src/a.ts");
    expect(toProjectRelative("/repo", "/elsewhere/a.ts")).toBe("/elsewhere/a.ts");
  });
});
