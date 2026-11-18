// shortcut: artifacts are stored in a third embedded RelateDB store (artifacts-db/), separate from the code graph,
// with their files and symbols as list properties rather than edges into the graph. RelateDB allows one writer
// process and @relate/relate 1.1.0 can't close a database, so every save spawns a short-lived writer process. It's a
// stopgap: move artifacts to a proper store (with versions, authors and review) before they're relied on.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Connection, Database, type ParamValue } from "@relate/relate";
import { snapshot } from "./db.js";

export const ARTIFACTS_DB_PATH = fileURLToPath(new URL("../artifacts-db", import.meta.url));

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVE_ATTEMPTS = 5;
const RETRY_MS = 200;
// The child's exit code when it couldn't open the store, most likely because another save holds it.
const EXIT_OPEN_FAILED = 75;

export interface ArtifactInput {
  /** Absolute project root; artifacts are scoped to one project. */
  project: string;
  /** Unique per project: saving the same topic again replaces the artifact. */
  topic: string;
  summary: string;
  markdown: string;
  /** Project-relative paths. */
  files: string[];
  symbols: string[];
}

export interface Artifact extends Omit<ArtifactInput, "project"> {
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactFilter {
  project: string;
  /** Every word has to occur in the topic, summary or markdown, ignoring case. */
  query?: string;
  file?: string;
  symbol?: string;
  limit?: number;
}

export class ArtifactsDb {
  constructor(private readonly conn: Connection) {}

  /** Creates the schema; only writers can. */
  init() {
    this.conn.query("CREATE CONSTRAINT artifact_id IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE");
    return this;
  }

  save(artifact: ArtifactInput, now = Date.now()): { replaced: boolean } {
    const { stats } = this.conn.query("MERGE (a:Artifact {id: $id}) ON CREATE SET a.createdAt = $now SET a += $props", {
      id: `${artifact.project}::${artifact.topic}`,
      now,
      props: { ...artifact, updatedAt: now } as unknown as ParamValue,
    });
    return { replaced: stats.nodes_created === 0 };
  }

  find({ project, query, file, symbol, limit = 5 }: ArtifactFilter): Artifact[] {
    const { rows } = this.conn.query(
      `MATCH (a:Artifact {project: $project})
       WHERE ($file IS NULL OR $file IN a.files)
         AND ($symbol IS NULL OR $symbol IN a.symbols)
         AND ALL(w IN $words WHERE toLower(a.topic + ' ' + a.summary + ' ' + a.markdown) CONTAINS w)
       WITH a ORDER BY a.updatedAt DESC LIMIT $limit
       RETURN a {.*} AS artifact`,
      { project, file: file ?? null, symbol: symbol ?? null, words: query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [], limit },
    );
    return rows.map((row) => {
      const { id: _, project: __, ...a } = row.artifact as Artifact & { id: string; project: string };
      return a;
    });
  }
}

/** Artifacts from the latest snapshot of the store; none before the first save. */
export function findArtifacts(filter: ArtifactFilter): Artifact[] {
  if (!existsSync(ARTIFACTS_DB_PATH)) return [];
  return new ArtifactsDb(snapshot(ARTIFACTS_DB_PATH)).find(filter);
}

/** Saves through a short-lived writer process, so no long-running process holds the store's one writer lease. */
export async function saveArtifact(artifact: ArtifactInput): Promise<{ replaced: boolean }> {
  for (let attempt = 1; ; attempt++) {
    const { code, stdout, stderr } = await runSave(JSON.stringify(artifact));
    if (code === 0) return JSON.parse(stdout);
    if (code !== EXIT_OPEN_FAILED || attempt === SAVE_ATTEMPTS) {
      throw new Error(code === EXIT_OPEN_FAILED ? "The artifacts store is busy; try again." : stderr.trim() || `Save exited with ${code}`);
    }
    await new Promise((r) => setTimeout(r, RETRY_MS * attempt));
  }
}

function runSave(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(`${REPO_ROOT}node_modules/.bin/tsx`, [fileURLToPath(import.meta.url), "save"], { cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function saveFromStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let db: Database;
  try {
    db = Database.open(ARTIFACTS_DB_PATH);
  } catch {
    process.exit(EXIT_OPEN_FAILED);
  }
  const result = new ArtifactsDb(db.connect()).init().save(JSON.parse(input));
  db.checkpoint();
  process.stdout.write(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv[2] === "save") await saveFromStdin();
