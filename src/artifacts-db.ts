// shortcut: artifacts have no versions, authors or review, and their files and symbols are JSON columns rather than
// links into the graph. Add those before artifacts are relied on.
import { stat } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { resolveInRoot } from "./source.js";
import { openStore } from "./store.js";

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

type ArtifactRow = { topic: string; summary: string; markdown: string; files: string; symbols: string; created_at: number; updated_at: number };

export class ArtifactsDb {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS artifacts (
      project TEXT NOT NULL, topic TEXT NOT NULL, summary TEXT NOT NULL, markdown TEXT NOT NULL,
      files TEXT NOT NULL, symbols TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (project, topic)
    )`);
  }

  save(artifact: ArtifactInput, now = Date.now()): { replaced: boolean } {
    const { created_at } = this.db
      .prepare(
        `INSERT INTO artifacts (project, topic, summary, markdown, files, symbols, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project, topic) DO UPDATE SET summary = excluded.summary, markdown = excluded.markdown,
           files = excluded.files, symbols = excluded.symbols, updated_at = excluded.updated_at
         RETURNING created_at`,
      )
      .get(
        artifact.project,
        artifact.topic,
        artifact.summary,
        artifact.markdown,
        JSON.stringify(artifact.files),
        JSON.stringify(artifact.symbols),
        now,
        now,
      ) as { created_at: number };
    return { replaced: created_at !== now };
  }

  find({ project, query, file, symbol, limit = 5 }: ArtifactFilter): Artifact[] {
    const where = ["project = ?"];
    const params: SQLInputValue[] = [project];
    if (file != null) {
      where.push("EXISTS (SELECT 1 FROM json_each(files) WHERE value = ?)");
      params.push(file);
    }
    if (symbol != null) {
      where.push("EXISTS (SELECT 1 FROM json_each(symbols) WHERE value = ?)");
      params.push(symbol);
    }
    for (const word of query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []) {
      where.push("instr(lower(topic || ' ' || summary || ' ' || markdown), ?) > 0");
      params.push(word);
    }
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit) as ArtifactRow[];
    return rows.map((a) => ({
      topic: a.topic,
      summary: a.summary,
      markdown: a.markdown,
      files: JSON.parse(a.files),
      symbols: JSON.parse(a.symbols),
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));
  }

  /** False if the project has no artifact with this topic. */
  delete(project: string, topic: string): boolean {
    return this.db.prepare("DELETE FROM artifacts WHERE project = ? AND topic = ?").run(project, topic).changes > 0;
  }
}

/** The artifact's files that changed after it was saved, or no longer exist. */
export async function staleFiles(root: string, artifact: Artifact) {
  const changed = await Promise.all(
    artifact.files.map((f) => stat(resolveInRoot(root, f)).then((s) => s.mtimeMs > artifact.updatedAt, () => true)),
  );
  return artifact.files.filter((_, i) => changed[i]);
}

let shared: ArtifactsDb | undefined;
const store = () => (shared ??= new ArtifactsDb(openStore()));

export const findArtifacts = (filter: ArtifactFilter): Artifact[] => store().find(filter);

export const saveArtifact = (artifact: ArtifactInput): { replaced: boolean } => store().save(artifact);

export const deleteArtifact = (project: string, topic: string): boolean => store().delete(project, topic);
