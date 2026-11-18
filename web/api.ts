import { useEffect, useState } from "react";

// Row shapes of GET /api/query, per command (see src/queries.ts). `kind` is null for symbols without a kind label.
export interface SymbolHit {
  kind: string | null;
  name: string;
  file: string;
  line: number;
}
export interface Definition extends SymbolHit {
  endLine: number | null;
}
export interface Related extends SymbolHit {
  distance: number;
}
export interface RefFile {
  file: string;
  refs: number;
  inside: string[];
}
export interface TestFile {
  testFile: string;
  via: string[];
}
export interface ImpactFile {
  file: string;
  isTest: boolean;
}

export interface Overview {
  project: { root: string; tool?: string; toolVersion?: string; loadedAt?: string };
  languages: { language: string | null; files: number; testFiles: number }[];
  kinds: { kind: string | null; symbols: number }[];
}

/** Totals for hints: parameters aren't counted as symbols, since search skips them. */
export function overviewCounts({ languages, kinds }: Overview) {
  return {
    files: languages.reduce((n, row) => n + row.files, 0),
    testFiles: languages.reduce((n, row) => n + row.testFiles, 0),
    symbols: kinds.reduce((n, row) => (row.kind === "Parameter" || row.kind === "TypeParameter" ? n : n + row.symbols), 0),
  };
}

export interface FileText {
  file: string;
  text: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 503: no graph has been loaded yet. */
  get notLoaded() {
    return this.status === 503;
  }
}

export function queryUrl(cmd: string, arg: string, opts: { file?: string; line?: number; kind?: string } = {}) {
  const params = new URLSearchParams({ cmd, arg });
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) params.set(k, String(v));
  return `/api/query?${params}`;
}

export const fileUrl = (path: string) => `/api/file?${new URLSearchParams({ path })}`;

// Agent shapes (see src/agent.ts and src/agents.ts).
export type Turn =
  | { type: "user"; text: string }
  /** A tool call or thinking step; no `durationMs` means it is still running. */
  | { type: "step"; kind: "graph" | "thought"; label: string; durationMs?: number }
  /** Markdown. */
  | { type: "answer"; text: string }
  | { type: "file"; path: string; lines?: [number, number] }
  | { type: "error"; text: string };
export interface Agent {
  id: string;
  title: string;
  description: string;
  /** False while Claude names it; until then the title and description are the prompt. */
  named: boolean;
  status: "ready" | "working";
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
}

// Code Graph shapes (see src/graph.ts). Ids are `file:<path>` or `sym:<SCIP symbol>`.
export type EdgeType = "USES" | "CONTAINS" | "DEFINES" | "REFERENCES" | "IMPORTS" | "IMPLEMENTS" | "TYPE_OF";
export type Direction = "in" | "out";
export interface GraphNode {
  id: string;
  /** "File", or the symbol's kind label. */
  kind: string | null;
  /** The symbol's name, or the file's path. */
  name: string;
  file: string | null;
  line: number | null;
  endLine: number | null;
  external: boolean;
  isTest: boolean;
  package: string | null;
  /** Edges to other nodes the graph shows. */
  degree: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  count: number;
}
export interface EdgeGroup {
  type: EdgeType;
  dir: Direction;
  count: number;
}
export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const graphUrl = (route: string, params: Record<string, string | number | undefined> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const query = p.toString();
  return `/api/graph/${route}${query ? `?${query}` : ""}`;
};

/** GETs, or POSTs `body` as JSON, and throws an ApiError for an error status. */
export async function fetchJson<T>(
  url: string,
  { body, method, signal }: { body?: unknown; method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method, signal }
      : { method: method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal };
  const res = await fetch(url, init);
  // An aborted body must reject. Swallowing it as `{}` stores a blank payload and the view stays on Loading.
  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json?.error ?? res.statusText);
  return json as T;
}

const getJson = <T>(url: string, signal: AbortSignal) => fetchJson<T>(url, { signal });

/**
 * GETs `url` (nothing when null) and refetches when it changes, aborting the stale request.
 * `data` and `error` belong to the current `url`; `latest` is the last data for any url, to show while the next loads.
 */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: ApiError }>({ url: null });
  const [latest, setLatest] = useState<T>();
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    // Strict Mode runs the effect, cancels it, and runs it again. A response from the cancelled run
    // can still resolve and must not overwrite the live one, or `state.url` no longer matches and loading sticks.
    let ignore = false;
    getJson<T>(url, abort.signal).then(
      (data) => {
        if (ignore) return;
        setState({ url, data });
        setLatest(data);
      },
      (e) => {
        if (ignore || abort.signal.aborted) return;
        setState({ url, error: e instanceof ApiError ? e : new ApiError(0, String(e)) });
      },
    );
    return () => {
      ignore = true;
      abort.abort();
    };
  }, [url]);
  const current = state.url === url;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    latest,
    loading: !!url && !current,
  };
}
