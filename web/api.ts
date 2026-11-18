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

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

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
    getJson<T>(url, abort.signal).then(
      (data) => {
        setState({ url, data });
        setLatest(data);
      },
      (e) => abort.signal.aborted || setState({ url, error: e instanceof ApiError ? e : new ApiError(0, String(e)) }),
    );
    return () => abort.abort();
  }, [url]);
  const current = state.url === url;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    latest,
    loading: !!url && !current,
  };
}
