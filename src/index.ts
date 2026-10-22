import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_INDEX = "index.scip";

// TODO: read this from disk 
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

/** Directories under `root` (inclusive) that contain a tsconfig.json. */
function findTsProjects(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === "tsconfig.json")) found.push(dir);
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
  };
  walk(root);
  return found;
}

// Projects are discovered here rather than via scip-typescript's --pnpm-workspaces, which shells out to
// `pnpm ls` and fails when the target repo's lockfile is older than the pnpm version running this CLI.
export function index(project: string, output = DEFAULT_INDEX) {
  const cwd = resolve(project);
  if (!existsSync(cwd)) throw new Error(`Project directory not found: ${cwd}`);
  const projects = findTsProjects(cwd);
  const args = ["index", "--output", resolve(output), "--cwd", cwd];
  if (projects.length === 0) args.push("--infer-tsconfig");
  const bin = fileURLToPath(new URL("../node_modules/.bin/scip-typescript", import.meta.url));
  execFileSync(bin, [...args, ...projects], { stdio: "inherit" });
}