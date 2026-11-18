import { Box, Code, File, Hash, type LucideIcon, Package, SquareFunction, Variable } from "lucide-react";
import { cn } from "@/lib/utils";

/** One symbol: names aren't unique, but name, file and line are. */
export interface SymbolRef {
  name: string;
  file: string;
  line: number;
}

// "File" is the Code Graph's file nodes.
const ICON: Record<string, LucideIcon> = { Type: Box, Method: SquareFunction, Term: Variable, Namespace: Package, Macro: Hash, File };

export const kindIcon = (kind: string | null | undefined): LucideIcon => (kind && ICON[kind]) || Code;

/** Graph kind labels in words: `Method` covers functions too, `Term` variables, fields and properties. */
const KIND_LABEL: Record<string, string> = {
  Type: "Type",
  Method: "Function",
  Term: "Variable",
  Namespace: "Namespace",
  Macro: "Macro",
  Parameter: "Parameter",
  TypeParameter: "Type parameter",
  File: "File",
};

export const kindLabel = (kind: string | null | undefined) => (kind && KIND_LABEL[kind]) || "Symbol";

/** The search filters, in chip order. Parameters are left out: search skips them unless asked. */
export const KIND_FILTERS: Record<string, string> = {
  Type: "Types",
  Method: "Functions",
  Term: "Variables",
  Namespace: "Namespaces",
  Macro: "Macros",
};

/** Lucide icon for the symbol's kind, with the kind as screen-reader text. */
export function SymbolIcon({ kind }: { kind: string | null | undefined }) {
  const Icon = kindIcon(kind);
  // `relative` anchors the absolutely positioned sr-only text here; otherwise it escapes scrolling lists and stretches the page.
  return (
    <span className="relative shrink-0">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <span className="sr-only">{kindLabel(kind)}</span>
    </span>
  );
}

/** Mono path where the directory truncates first, so `basename:line` stays visible. */
export function PathLabel({ path, line, className }: { path: string; line?: number; className?: string }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span title={path} className={cn("flex min-w-0 font-mono text-xs text-muted-foreground", className)}>
      <span className="truncate">{path.slice(0, cut)}</span>
      <span className="max-w-full shrink-0 truncate">
        {path.slice(cut)}
        {line !== undefined && `:${line}`}
      </span>
    </span>
  );
}

/** Link to the Search page with these parameters; empty ones are left out. */
export function searchHref(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const query = p.toString();
  return query ? `#/search?${query}` : "#/search";
}

/** Link to the Code Graph page, opened on this symbol. */
export const graphHref = ({ name, file, line }: SymbolRef) => `#/graph?${new URLSearchParams({ name, file, line: String(line) })}`;
