// shortcut: notes have no versions, authors or review, and their files and symbols are JSON columns rather than
// links into the graph. Add those before notes are relied on.
import { stat } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { resolveInRoot } from "./source.js";
import { openStore } from "./store.js";

export interface NoteInput {
  /** Absolute project root; notes are scoped to one project. */
  project: string;
  /** Unique per project: saving the same topic again replaces the note. */
  topic: string;
  summary: string;
  markdown: string;
  /** Project-relative paths. */
  files: string[];
  symbols: string[];
}

export interface Note extends Omit<NoteInput, "project"> {
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
}

export interface NoteFilter {
  project: string;
  /** Every word has to occur in the topic, summary or markdown, ignoring case. */
  query?: string;
  file?: string;
  symbol?: string;
  limit?: number;
}

type NoteRow = { topic: string; summary: string; markdown: string; files: string; symbols: string; created_at: number; updated_at: number };

export class NotesDb {
  constructor(private readonly db: DatabaseSync) {
    // Several processes open the store at once, so only one may rename the table notes had when they were artifacts.
    db.exec("BEGIN IMMEDIATE");
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('artifacts', 'notes')").all();
      if (tables.length === 1 && tables[0].name === "artifacts") db.exec("ALTER TABLE artifacts RENAME TO notes");
      db.exec(`CREATE TABLE IF NOT EXISTS notes (
        project TEXT NOT NULL, topic TEXT NOT NULL, summary TEXT NOT NULL, markdown TEXT NOT NULL,
        files TEXT NOT NULL, symbols TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (project, topic)
      )`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  save(note: NoteInput, now = Date.now()): { replaced: boolean } {
    const { created_at } = this.db
      .prepare(
        `INSERT INTO notes (project, topic, summary, markdown, files, symbols, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project, topic) DO UPDATE SET summary = excluded.summary, markdown = excluded.markdown,
           files = excluded.files, symbols = excluded.symbols, updated_at = excluded.updated_at
         RETURNING created_at`,
      )
      .get(
        note.project,
        note.topic,
        note.summary,
        note.markdown,
        JSON.stringify(note.files),
        JSON.stringify(note.symbols),
        now,
        now,
      ) as { created_at: number };
    return { replaced: created_at !== now };
  }

  find({ project, query, file, symbol, limit = 5 }: NoteFilter): Note[] {
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
      .prepare(`SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit) as NoteRow[];
    return rows.map((n) => ({
      topic: n.topic,
      summary: n.summary,
      markdown: n.markdown,
      files: JSON.parse(n.files),
      symbols: JSON.parse(n.symbols),
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    }));
  }

  /** False if the project has no note with this topic. */
  delete(project: string, topic: string): boolean {
    return this.db.prepare("DELETE FROM notes WHERE project = ? AND topic = ?").run(project, topic).changes > 0;
  }
}

/** The note's files that changed after it was saved, or no longer exist. */
export async function staleFiles(root: string, note: Note) {
  const changed = await Promise.all(
    note.files.map((f) => stat(resolveInRoot(root, f)).then((s) => s.mtimeMs > note.updatedAt, () => true)),
  );
  return note.files.filter((_, i) => changed[i]);
}

let shared: NotesDb | undefined;
const store = () => (shared ??= new NotesDb(openStore()));

export const findNotes = (filter: NoteFilter): Note[] => store().find(filter);

export const saveNote = (note: NoteInput): { replaced: boolean } => store().save(note);

export const deleteNote = (project: string, topic: string): boolean => store().delete(project, topic);
