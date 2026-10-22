import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

import {
  type DescriptorKind,
  type Edge,
  type FileNode,
  type Graph,
  NODE_KINDS,
  type NodeKind,
  type ScipDocument,
  type ScipIndex,
  type ScipSymbolInfo,
  type SymbolNode,
} from "./types.js";
import { isSourceFileName, languageOf, type LanguageRules, rulesFor } from "./languages.js";

const SYMBOL_ROLE_DEFINITION = 0x1;

export async function loadScipIndex(path: string): Promise<ScipIndex> {
  const root = await protobuf.load(fileURLToPath(new URL("../schemas/scip.proto", import.meta.url)));
  const type = root.lookupType("scip.Index");
  const message = type.decode(readFileSync(path));
  return type.toObject(message, { enums: String, defaults: false, arrays: true }) as ScipIndex;
}

type Pos = [number, number];
interface Span {
  start: Pos;
  end: Pos;
}

function toSpan(r: number[] | undefined): Span | undefined {
  if (!r || r.length < 3) return undefined;
  return r.length === 3
    ? { start: [r[0], r[1]], end: [r[0], r[2]] }
    : { start: [r[0], r[1]], end: [r[2], r[3]] };
}
const cmp = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1];
const contains = (outer: Span, inner: Span) => cmp(outer.start, inner.start) <= 0 && cmp(inner.end, outer.end) <= 0;

interface SymbolParts {
  scheme: string;
  manager?: string;
  packageName?: string;
  version?: string;
  descriptor: string;
}

/**
 * `scip-typescript npm pkg 1.0.0 src/`a.ts`/Foo#bar().` -> scheme, manager, package name, version, descriptor.
 * Per the SCIP grammar a double space is an escaped space inside a field, and `.` stands for an empty field.
 */
function splitSymbol(symbol: string): SymbolParts {
  const fields: string[] = [];
  let field = "";
  let i = 0;
  while (fields.length < 4 && i < symbol.length) {
    if (symbol[i] !== " ") {
      field += symbol[i++];
    } else if (symbol[i + 1] === " ") {
      field += " ";
      i += 2;
    } else {
      fields.push(field);
      field = "";
      i++;
    }
  }
  const opt = (f: string | undefined) => (f && f !== "." ? f : undefined);
  return {
    scheme: fields[0] ?? "",
    manager: opt(fields[1]),
    packageName: opt(fields[2]),
    version: opt(fields[3]),
    descriptor: symbol.slice(i),
  };
}

interface Descriptor {
  name: string;
  kind: DescriptorKind;
}

const DESCRIPTOR = /(`(?:[^`]|``)+`|[\w$+-]+)(\/|#|\.|:|!|\([^)]*\)\.)|\[([^\]]+)\]|\(([^)]+)\)/g;
const SUFFIX_KIND: Record<string, DescriptorKind> = { "/": "Namespace", "#": "Type", ".": "Term", ":": "Meta", "!": "Macro" };

function parseDescriptors(symbol: string): Descriptor[] {
  const out: Descriptor[] = [];
  for (const m of splitSymbol(symbol).descriptor.matchAll(DESCRIPTOR)) {
    if (m[3]) out.push({ name: m[3], kind: "TypeParameter" });
    else if (m[4]) out.push({ name: m[4], kind: "Parameter" });
    else out.push({ name: m[1].replace(/^`|`$/g, ""), kind: m[2].startsWith("(") ? "Method" : SUFFIX_KIND[m[2]] });
  }
  return out;
}

/** The symbol one descriptor up, e.g. `Foo#bar().(x)` -> `Foo#bar().`; undefined at the top level. */
function descriptorParent(symbol: string): string | undefined {
  const { descriptor } = splitSymbol(symbol);
  const matches = [...descriptor.matchAll(DESCRIPTOR)];
  if (matches.length < 2) return undefined;
  return symbol.slice(0, symbol.length - descriptor.length) + descriptor.slice(0, matches.at(-1)!.index);
}

/** Symbols without a name an agent could navigate by, e.g. scip-typescript's anonymous type-literal members. */
function isNoise(descriptors: Descriptor[], rules: LanguageRules): boolean {
  return !!rules.dropMeta && descriptors.some((d) => d.kind === "Meta");
}

/**
 * A file's own module symbol (`src/`a.ts`/`). It stands for the File node and only feeds file -> file imports.
 * Packages that span several files (Java's `com/foo/`, Go packages) stay Namespace nodes.
 */
function isModule(symbol: string, info: ScipSymbolInfo | undefined): boolean {
  if (info?.kind === "File") return true;
  const last = parseDescriptors(symbol).at(-1);
  return last?.kind === "Namespace" && isSourceFileName(last.name);
}

const isParameter = (kind: NodeKind | undefined) => kind === "Parameter" || kind === "TypeParameter";
const nodeKind = (kind: DescriptorKind | undefined): NodeKind | undefined =>
  NODE_KINDS.find((k) => k === kind);

/** Multi-project indexes can contain the same file more than once (e.g. via tsconfig references); merge them. */
function mergeDocuments(documents: ScipDocument[]): ScipDocument[] {
  const byPath = new Map<string, ScipDocument & { seen: Set<string> }>();
  for (const doc of documents) {
    let merged = byPath.get(doc.relativePath);
    if (!merged) {
      merged = { relativePath: doc.relativePath, occurrences: [], symbols: [], seen: new Set() };
      byPath.set(doc.relativePath, merged);
    }
    for (const o of doc.occurrences ?? []) {
      const key = `${o.symbol}|${o.symbolRoles ?? 0}|${o.range?.join(",")}`;
      if (merged.seen.has(key)) continue;
      merged.seen.add(key);
      merged.occurrences!.push(o);
    }
    merged.symbols!.push(...(doc.symbols ?? []));
  }
  return [...byPath.values()].map(({ seen, ...doc }) => doc);
}

export function buildGraph(rawIndex: ScipIndex): Graph {
  const index = { ...rawIndex, documents: mergeDocuments(rawIndex.documents ?? []) };
  const symbols = new Map<string, SymbolNode>();
  const infos = new Map<string, ScipSymbolInfo>();
  for (const info of [...(index.externalSymbols ?? []), ...(index.documents ?? []).flatMap((d) => d.symbols ?? [])]) {
    infos.set(info.symbol, info);
  }

  const ensureSymbol = (id: string): SymbolNode => {
    let node = symbols.get(id);
    if (!node) {
      const info = infos.get(id);
      const last = parseDescriptors(id).at(-1);
      const { scheme, manager, packageName, version } = splitSymbol(id);
      node = {
        id,
        name: info?.displayName || last?.name || id,
        kind: nodeKind(last?.kind),
        scipKind: info?.kind && info.kind !== "UnspecifiedKind" ? info.kind : undefined,
        scheme,
        manager,
        packageName,
        version,
        external: true,
        doc: (info?.documentation ?? []).join("\n"),
      };
      symbols.set(id, node);
    }
    return node;
  };

  const files: FileNode[] = [];
  const edges = {
    defines: new Map<string, Edge>(),
    references: new Map<string, Edge>(),
    contains: new Map<string, Edge>(),
    uses: new Map<string, Edge>(),
  };
  const bump = (m: Map<string, Edge>, from: string, to: string) => {
    const key = `${from}\0${to}`;
    const e = m.get(key);
    if (e) e.count = (e.count ?? 1) + 1;
    else m.set(key, { from, to, count: 1 });
  };
  const definedIn = new Map<string, string>(); // symbol -> file
  const refsByFile: [string, string][] = [];
  const declaredParents: [string, string][] = []; // [parent, child] for definitions no enclosing range covers
  const filesWithoutScopes: string[] = [];
  const module = (symbol: string) => isModule(symbol, infos.get(symbol));

  for (const doc of index.documents ?? []) {
    const path = doc.relativePath;
    const language = languageOf(path, doc.language);
    const rules = rulesFor(language);
    files.push({ path, language, isTest: rules.tests.some((re) => re.test(path)) });

    const occs = (doc.occurrences ?? []).filter(
      (o) => o.symbol && !o.symbol.startsWith("local ") && !isNoise(parseDescriptors(o.symbol), rules),
    );
    const defs = occs
      .filter((o) => (o.symbolRoles ?? 0) & SYMBOL_ROLE_DEFINITION)
      .map((o) => ({ occ: o, span: toSpan(o.range), scope: toSpan(o.enclosingRange) }));
    if (defs.some((d) => !module(d.occ.symbol)) && !defs.some((d) => d.scope)) filesWithoutScopes.push(path);

    for (const d of defs) {
      if (module(d.occ.symbol)) {
        definedIn.set(d.occ.symbol, path);
        continue;
      }
      const node = ensureSymbol(d.occ.symbol);
      node.external = false;
      node.file = path;
      node.line = (d.span?.start[0] ?? 0) + 1;
      if (d.scope) node.endLine = d.scope.end[0] + 1;
      definedIn.set(d.occ.symbol, path);
      bump(edges.defines, path, d.occ.symbol);
    }

    /** Innermost definition whose enclosing range contains `span`, other than `self`. */
    const enclosing = (span: Span, self: string) => {
      let best: { symbol: string; scope: Span } | undefined;
      for (const d of defs) {
        if (!d.scope || d.occ.symbol === self || !contains(d.scope, span)) continue;
        if (!best || cmp(d.scope.start, best.scope.start) >= 0) best = { symbol: d.occ.symbol, scope: d.scope };
      }
      return best?.symbol;
    };

    for (const o of occs) {
      const span = toSpan(o.range);
      const isDef = ((o.symbolRoles ?? 0) & SYMBOL_ROLE_DEFINITION) !== 0;
      if (module(o.symbol)) {
        if (!isDef) refsByFile.push([path, o.symbol]);
        continue;
      }
      // Parameter references can only come from the owning function, so they'd just restate CONTAINS.
      if (!isDef && isParameter(nodeKind(parseDescriptors(o.symbol).at(-1)?.kind))) continue;
      ensureSymbol(o.symbol);
      const parent = span && enclosing(span, o.symbol);
      if (isDef) {
        if (parent) bump(edges.contains, parent, o.symbol);
        else {
          // No enclosing range covers it (or the indexer emits none): fall back to the declared parent.
          const declared = infos.get(o.symbol)?.enclosingSymbol ?? descriptorParent(o.symbol);
          if (declared && !module(declared)) declaredParents.push([declared, o.symbol]);
        }
      } else {
        bump(edges.references, path, o.symbol);
        refsByFile.push([path, o.symbol]);
        if (parent) bump(edges.uses, parent, o.symbol);
      }
    }
  }

  const imports = new Map<string, Edge>();
  for (const [from, symbol] of refsByFile) {
    const to = definedIn.get(symbol);
    if (to && to !== from) bump(imports, from, to);
  }

  for (const [parent, child] of declaredParents) {
    if (symbols.has(parent)) bump(edges.contains, parent, child);
  }

  const implementsEdges: Edge[] = [];
  const typeOf: Edge[] = [];
  for (const [id, info] of infos) {
    if (!symbols.has(id)) continue;
    for (const r of info.relationships ?? []) {
      if (r.symbol.startsWith("local ") || (!r.isImplementation && !r.isTypeDefinition)) continue;
      ensureSymbol(r.symbol);
      if (r.isImplementation) implementsEdges.push({ from: id, to: r.symbol });
      if (r.isTypeDefinition) typeOf.push({ from: id, to: r.symbol });
    }
  }

  // Drop self-edges (e.g. recursion, or a symbol's own definition range).
  const uses = [...edges.uses.values()].filter((e) => e.from !== e.to);

  const { projectRoot, toolInfo } = rawIndex.metadata ?? {};
  return {
    project: {
      root: projectRoot?.startsWith("file:") ? fileURLToPath(projectRoot) : projectRoot,
      tool: toolInfo?.name,
      toolVersion: toolInfo?.version,
    },
    files,
    symbols: [...symbols.values()],
    defines: [...edges.defines.values()],
    references: [...edges.references.values()],
    imports: [...imports.values()],
    contains: [...edges.contains.values()],
    uses,
    implements: implementsEdges,
    typeOf,
    filesWithoutScopes,
  };
}
