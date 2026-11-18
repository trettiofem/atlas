import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Row } from "./queries.js";

/** Most lines returned for one definition. */
export const MAX_LINES = 200;
/** Lines shown after the definition line when the graph has no end line for it. */
export const CONTEXT_LINES = 20;

export interface Slice {
  start: number;
  end: number;
  truncated: boolean;
  /** The lines, each prefixed with its 1-based line number. */
  text: string;
}

/** Lines `start..end` (1-based, inclusive) of `text`, clamped to the file and capped at MAX_LINES. */
export function sliceLines(text: string, start: number, end?: number): Slice {
  const lines = text.split("\n");
  const first = Math.min(Math.max(1, start), lines.length);
  let last = Math.min(Math.max(first, end ?? first + CONTEXT_LINES), lines.length);
  const truncated = last - first + 1 > MAX_LINES;
  if (truncated) last = first + MAX_LINES - 1;
  const width = String(last).length;
  const numbered = lines.slice(first - 1, last).map((line, i) => `${String(first + i).padStart(width)}  ${line}`);
  return { start: first, end: last, truncated, text: numbered.join("\n") };
}

const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Absolute path of a project-relative `file`; throws if it resolves outside `root`. */
export function resolveInRoot(root: string, file: string): string {
  const path = resolve(root, file);
  if (!isInside(root, path)) throw new Error(`${file} is outside the project root ${root}`);
  return path;
}

/** Source of each definition row from the `source` query, read from the project files under `root`. */
export async function readDefinitions(root: string, rows: Row[]) {
  const results = [];
  for (const row of rows) {
    const path = resolveInRoot(root, String(row.file));
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text === undefined) {
      results.push({ ...row, path, error: "file not readable; the graph may be stale" });
      continue;
    }
    const slice = sliceLines(text, Number(row.line), typeof row.endLine === "number" ? row.endLine : undefined);
    results.push({ kind: row.kind, name: row.name, file: row.file, path, ...slice });
  }
  return results;
}

/** Graph paths are project-relative with `/` separators; accept absolute paths under `root` too. */
export function toProjectRelative(root: string, file: string): string {
  if (!isAbsolute(file) || !isInside(root, file)) return file;
  return relative(root, file).split(sep).join("/");
}
