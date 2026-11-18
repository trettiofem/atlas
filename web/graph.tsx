import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BookSearch,
  CircleMinus,
  CirclePlus,
  LoaderCircle,
  Route,
  Scan,
  Search as SearchIcon,
  Shuffle,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type Direction,
  type EdgeGroup,
  type EdgeType,
  type FileText,
  fetchJson,
  fileUrl,
  type GraphEdge,
  type GraphNode,
  graphUrl,
  type Overview,
  overviewCounts,
  type Subgraph,
  useApi,
} from "@/api";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GraphCanvas, type GraphCanvasHandle, nodeLabel } from "@/graph-canvas";
import {
  addEdges,
  clearPath,
  collapse,
  emptyModel,
  expand,
  type GraphModel,
  type GroupKey,
  groupKey,
  pin,
  remove,
  setPath,
  shownByGroup,
} from "@/graph-model";
import { cn } from "@/lib/utils";
import { GraphUnavailable } from "@/search";
import { CodeLines, type LineRange } from "@/source";
import { kindLabel, PathLabel, SymbolIcon, searchHref } from "@/symbol";

const DEBOUNCE_MS = 150;
/** Neighbors per group when a whole node expands. */
const EXPAND_LIMIT = 10;
/** Neighbors when one group expands, or shows the rest. */
const GROUP_LIMIT = 200;
/** The API's longest path. */
const MAX_HOPS = 12;

/** Group names, in the inspector's order. */
const GROUPS: [GroupKey, string][] = [
  ["USES:out", "Uses"],
  ["USES:in", "Used by"],
  ["CONTAINS:in", "Inside"],
  ["CONTAINS:out", "Contains"],
  ["DEFINES:in", "Defined in"],
  ["DEFINES:out", "Defines"],
  ["REFERENCES:in", "Referenced in"],
  ["REFERENCES:out", "References"],
  ["IMPORTS:out", "Imports"],
  ["IMPORTS:in", "Imported by"],
  ["IMPLEMENTS:out", "Implements"],
  ["IMPLEMENTS:in", "Implemented by"],
  ["TYPE_OF:out", "Has type"],
  ["TYPE_OF:in", "Type of"],
];
const GROUP_LABEL = Object.fromEntries(GROUPS) as Record<GroupKey, string>;

/** What a path may pass through, in the same three kinds of line as the legend. */
const VIA = {
  uses: { label: "Uses", types: ["USES", "IMPLEMENTS", "TYPE_OF"] },
  nesting: { label: "Nesting", types: ["CONTAINS", "DEFINES"] },
  files: { label: "Files", types: ["REFERENCES", "IMPORTS"] },
} satisfies Record<string, { label: string; types: EdgeType[] }>;
type Via = keyof typeof VIA;

interface PathForm {
  from?: GraphNode;
  to?: GraphNode;
  directed: boolean;
  via: Via[];
}
type PathResult = { found: false } | ({ found: true } & Subgraph);

/** The page's state when it was last left, so the graph is still there when you come back. */
let saved: { model: GraphModel; selected?: string; tab: string; form: PathForm; result?: PathResult } | undefined;

function useDebounced<T>(value: T) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** #/graph, or #/graph?name=&file=&line= (or ?id=) to start from a symbol. */
export function Graph({ params }: { params: URLSearchParams }) {
  const overview = useApi<Overview>("/api/overview");
  if (overview.error) return <GraphUnavailable error={overview.error} />;
  return <Explorer params={params} overview={overview.data} />;
}

function Explorer({ params, overview }: { params: URLSearchParams; overview?: Overview }) {
  const [model, setModel] = useState(() => saved?.model ?? emptyModel());
  // Async work reads and grows the latest model, not the one from the render that started it.
  const latest = useRef(model);
  const update = (change: (m: GraphModel) => GraphModel) => {
    latest.current = change(latest.current);
    setModel(latest.current);
  };
  const [selected, setSelected] = useState(saved?.selected);
  const [anchor, setAnchor] = useState<string>();
  const [focus, setFocus] = useState<{ ids: string[] }>();
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState(saved?.tab ?? "explore");
  const [form, setForm] = useState<PathForm>(saved?.form ?? { directed: false, via: ["uses", "nesting", "files"] });
  const [result, setResult] = useState<PathResult | undefined>(saved?.result);
  const canvas = useRef<GraphCanvasHandle>(null);

  useEffect(() => {
    saved = { model, selected, tab, form, result };
  }, [model, selected, tab, form, result]);

  const run = async (work: () => Promise<void>) => {
    setBusy((n) => n + 1);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((n) => n - 1);
    }
  };

  /** Applies `change` along with every edge among the nodes it leaves, so new nodes link to what's already shown. */
  const grow = async (change: (m: GraphModel) => GraphModel, hints: { anchor?: string; focus?: string[] } = {}) => {
    const ids = [...change(latest.current).nodes.keys()];
    const edges = ids.length > 1 ? await fetchJson<GraphEdge[]>(graphUrl("edges"), { body: { ids } }) : [];
    setAnchor(hints.anchor);
    update((m) => addEdges(change(m), edges));
    if (hints.focus) setFocus({ ids: hints.focus });
  };

  const neighbors = (id: string, group?: { type: EdgeType; dir: Direction }) =>
    fetchJson<Subgraph>(graphUrl("neighbors", { id, type: group?.type, dir: group?.dir, limit: group ? GROUP_LIMIT : EXPAND_LIMIT }));

  const expandNode = (id: string, group?: { type: EdgeType; dir: Direction }) =>
    run(async () => {
      const sub = await neighbors(id, group);
      await grow((m) => expand(m, id, sub, group && [groupKey(group.type, group.dir)]), { anchor: id });
    });

  const toggle = (id: string) => (latest.current.expanded.has(id) ? update((m) => collapse(m, id)) : expandNode(id));

  const focusNode = (id: string) => {
    setSelected(id);
    canvas.current?.center(id);
  };

  /** Shows a node with its neighbors, or just goes to it when it's already shown. */
  const open = (node: GraphNode) =>
    run(async () => {
      setSelected(node.id);
      if (latest.current.nodes.has(node.id)) {
        canvas.current?.center(node.id);
        return;
      }
      const sub = await neighbors(node.id);
      await grow((m) => expand(pin(m, [node]), node.id, sub), { focus: [node.id, ...sub.nodes.map((n) => n.id)] });
    });

  // Links from Search open their symbol here.
  const id = params.get("id");
  const name = params.get("name");
  const file = params.get("file");
  const line = params.get("line");
  const seed = id ?? (name && file && line ? [name, file, line].join("\n") : null);
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!seed || seeded.current === seed) return;
    seeded.current = seed;
    run(async () => {
      const found = await fetchJson<{ node: GraphNode }>(graphUrl("node", id ? { id } : { name: name!, file: file!, line: line! })).catch((e) => {
        throw e instanceof ApiError && e.status === 404 ? new Error("Symbol not found. The graph may have changed since this link was made.") : e;
      });
      await open(found.node);
    });
  }, [seed]);

  const findPath = () =>
    run(async () => {
      const { from, to, directed, via } = form;
      if (!from || !to) return;
      const types = via.flatMap((v) => VIA[v].types).join(",");
      const sub = await fetchJson<Subgraph>(graphUrl("path", { from: from.id, to: to.id, types, directed: directed ? 1 : undefined }));
      if (sub.nodes.length === 0) {
        setResult({ found: false });
        update(clearPath);
        return;
      }
      setResult({ found: true, ...sub });
      await grow((m) => setPath(m, sub), { focus: sub.nodes.map((n) => n.id) });
    });

  const dropPath = () => {
    setResult(undefined);
    update(clearPath);
  };

  const pathEnd = (end: "from" | "to", node: GraphNode) => {
    setForm((f) => ({ ...f, [end]: node }));
    setTab("path");
  };

  const current = selected ? model.nodes.get(selected)?.node : undefined;
  const empty = model.nodes.size === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
      <section aria-label="Graph tools" className="flex max-h-[45svh] shrink-0 flex-col border-b md:max-h-none md:w-80 md:border-r md:border-b-0">
        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
          <TabsList aria-label="Tools" className="w-full shrink-0 justify-start border-b p-4">
            <TabsTrigger value="explore">Explore</TabsTrigger>
            <TabsTrigger value="path">Path</TabsTrigger>
          </TabsList>
          <TabsContent value="explore" className="flex min-h-0 flex-col">
            <ExplorePanel overview={overview} model={model} selected={selected} onOpen={open} onFocus={focusNode} />
          </TabsContent>
          <TabsContent value="path" className="min-h-0 overflow-y-auto">
            <PathPanel
              form={form}
              onFormChange={setForm}
              selected={current}
              result={model.path || result?.found === false ? result : undefined}
              busy={busy > 0}
              onFind={findPath}
              onClear={dropPath}
              onFocus={focusNode}
              current={selected}
            />
          </TabsContent>
        </Tabs>
      </section>

      <section aria-label="Code graph" className="relative min-h-80 min-w-0 flex-1 overflow-hidden">
        <GraphCanvas
          ref={canvas}
          model={model}
          selected={current?.id}
          anchor={anchor}
          focus={focus}
          onSelect={setSelected}
          onToggle={toggle}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <p className="font-medium">Start from a symbol or file.</p>
              <p className="mt-1 text-muted-foreground">
                Find one in Explore. Click a node’s <CirclePlus aria-hidden className="inline size-3.5 align-[-2px]" />
                <span className="sr-only">plus</span> to show what it’s connected to, and <CircleMinus aria-hidden className="inline size-3.5 align-[-2px]" />
                <span className="sr-only">minus</span> to hide it again.
              </p>
            </div>
          </div>
        )}
        {busy > 0 && (
          <div className="absolute top-4 left-4 flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
            <span className="sr-only">Loading</span>
          </div>
        )}
        <div className="absolute top-4 right-4 flex gap-1.5">
          <ToolButton label="Zoom in" onClick={() => canvas.current?.zoomBy(1.25)} disabled={empty}>
            <ZoomIn />
          </ToolButton>
          <ToolButton label="Zoom out" onClick={() => canvas.current?.zoomBy(0.8)} disabled={empty}>
            <ZoomOut />
          </ToolButton>
          <ToolButton label="Fit to view" onClick={() => canvas.current?.fitAll()} disabled={empty}>
            <Scan />
          </ToolButton>
          <ToolButton label="Rearrange" onClick={() => canvas.current?.relayout()} disabled={empty}>
            <Shuffle />
          </ToolButton>
          <ToolButton
            label="Clear graph"
            disabled={empty}
            onClick={() => {
              update(emptyModel);
              setSelected(undefined);
              setResult(undefined);
            }}
          >
            <Trash2 />
          </ToolButton>
        </div>
        {!empty && <Legend />}
        {error && (
          <div role="alert" className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-3 text-xs">
            <span className="truncate">{error}</span>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Dismiss" onClick={() => setError(undefined)}>
              <X />
            </Button>
          </div>
        )}
      </section>

      {current && (
        <Inspector
          key={current.id}
          node={current}
          model={model}
          onClose={() => setSelected(undefined)}
          onToggle={() => toggle(current.id)}
          onGroup={(type, dir, on) => (on ? expandNode(current.id, { type, dir }) : update((m) => collapse(m, current.id, groupKey(type, dir))))}
          onRemove={() => {
            update((m) => remove(m, current.id));
            setSelected(undefined);
          }}
          onPathEnd={(end) => pathEnd(end, current)}
        />
      )}
    </div>
  );
}

function ToolButton({ label, children, ...props }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" className="text-muted-foreground" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The three kinds of edge line. */
function Legend() {
  const line = (dash?: string) => (
    <svg aria-hidden width="24" height="6" className="shrink-0">
      <line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="1" strokeDasharray={dash} />
    </svg>
  );
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex">
      <span className="flex items-center gap-1.5">{line()}Uses</span>
      <span className="flex items-center gap-1.5">{line("4 3")}Nesting</span>
      <span className="flex items-center gap-1.5">{line("1 2")}Files</span>
      <span>Double-click a node to expand or collapse it.</span>
    </div>
  );
}

function ExplorePanel({
  overview,
  model,
  selected,
  onOpen,
  onFocus,
}: {
  overview?: Overview;
  model: GraphModel;
  selected?: string;
  onOpen: (node: GraphNode) => void;
  onFocus: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const q = useDebounced(draft.trim());
  const search = useApi<GraphNode[]>(q ? graphUrl("search", { q }) : null);
  const results = q ? (search.data ?? (search.loading ? search.latest : undefined)) : undefined;
  const counts = overview && overviewCounts(overview);
  const shown = useMemo(() => [...model.nodes.values()].map((s) => s.node).sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b))), [model]);
  return (
    <>
      <form
        role="search"
        className="border-b p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (results?.[0]) onOpen(results[0]);
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find a symbol or file"
            placeholder="Find a symbol or file…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft("")}
            autoComplete="off"
            spellCheck={false}
          />
          {(search.loading || draft.trim() !== q) && (
            <InputGroupAddon align="inline-end">
              <LoaderCircle className="motion-safe:animate-spin" />
              <span className="sr-only">Searching</span>
            </InputGroupAddon>
          )}
        </InputGroup>
      </form>
      <nav aria-label={q ? "Results" : "On the graph"} className="flex-1 overflow-y-auto">
        {q ? (
          search.error ? (
            <Hint>{search.error.message}</Hint>
          ) : !results ? null : results.length === 0 ? (
            <Hint>Nothing matches “{q}”.</Hint>
          ) : (
            results.map((node) => <NodeRow key={node.id} node={node} note={model.nodes.has(node.id) ? "shown" : undefined} onClick={() => onOpen(node)} />)
          )
        ) : (
          <>
            {counts && (
              <Hint>
                Search {counts.symbols} symbols across {counts.files} files.
              </Hint>
            )}
            {shown.length > 0 && (
              <>
                <h2 className="border-b px-4 pb-2 text-xs font-medium text-muted-foreground">On the graph · {shown.length}</h2>
                {shown.map((node) => (
                  <NodeRow key={node.id} node={node} current={node.id === selected} onClick={() => onFocus(node.id)} />
                ))}
              </>
            )}
          </>
        )}
      </nav>
    </>
  );
}

/** A node: icon and mono name, with where it lives underneath. */
function NodeRow({ node, current, note, onClick }: { node: GraphNode; current?: boolean; note?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      onClick={onClick}
      className="block w-full border-b px-4 py-2.5 text-left hover:bg-accent aria-[current=true]:bg-accent"
    >
      <span className="flex items-center gap-2">
        <SymbolIcon kind={node.kind} />
        <span className="truncate font-mono">{nodeLabel(node)}</span>
        {note && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{note}</span>}
      </span>
      <NodePlace node={node} className="mt-0.5 pl-6" />
    </button>
  );
}

/** `file:line`, the file's path, or the package of an external symbol. */
function NodePlace({ node, className }: { node: GraphNode; className?: string }) {
  if (node.file) return <PathLabel path={node.file} line={node.kind === "File" ? undefined : (node.line ?? undefined)} className={className} />;
  return <span className={cn("block truncate text-xs text-muted-foreground", className)}>External{node.package && ` · ${node.package}`}</span>;
}

function PathPanel({
  form,
  onFormChange,
  selected,
  result,
  busy,
  onFind,
  onClear,
  onFocus,
  current,
}: {
  form: PathForm;
  onFormChange: (form: PathForm) => void;
  selected?: GraphNode;
  result?: PathResult;
  busy: boolean;
  onFind: () => void;
  onClear: () => void;
  onFocus: (id: string) => void;
  current?: string;
}) {
  const set = (patch: Partial<PathForm>) => onFormChange({ ...form, ...patch });
  const toggleVia = (v: Via) => set({ via: form.via.includes(v) ? form.via.filter((x) => x !== v) : [...form.via, v] });
  const narrowed = form.directed || form.via.length < Object.keys(VIA).length;
  return (
    <>
      <form
        className="space-y-4 border-b p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onFind();
        }}
      >
        <Endpoint
          label="From"
          value={form.from}
          selected={selected}
          onChange={(from) => set({ from })}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Swap from and to"
              title="Swap"
              disabled={!form.from && !form.to}
              onClick={() => set({ from: form.to, to: form.from })}
            >
              <ArrowDownUp />
            </Button>
          }
        />
        <Endpoint label="To" value={form.to} selected={selected} onChange={(to) => set({ to })} />
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Direction</legend>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" aria-pressed={!form.directed} onClick={() => set({ directed: false })}>
              Any
            </Button>
            <Button type="button" variant="outline" size="sm" aria-pressed={form.directed} onClick={() => set({ directed: true })}>
              Follow arrows
            </Button>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Through</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VIA) as Via[]).map((v) => (
              <Button key={v} type="button" variant="outline" size="sm" aria-pressed={form.via.includes(v)} onClick={() => toggleVia(v)}>
                {VIA[v].label}
              </Button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" variant="primary" className="w-full" disabled={!form.from || !form.to || form.via.length === 0 || busy}>
          <Route />
          Find path
        </Button>
      </form>
      {result &&
        (result.found ? (
          <section aria-label="Path">
            <div className="flex items-center justify-between border-b py-2 pr-2 pl-4">
              <h2 className="font-medium">{result.edges.length === 1 ? "1 step" : `${result.edges.length} steps`}</h2>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClear}>
                Clear
              </Button>
            </div>
            <ol>
              {result.nodes.map((node, i) => (
                <li key={node.id}>
                  {i > 0 && <PathEdge edge={result.edges[i - 1]} forward={result.edges[i - 1].source === result.nodes[i - 1].id} />}
                  <NodeRow node={node} current={node.id === current} onClick={() => onFocus(node.id)} />
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <Hint>
            No path within {MAX_HOPS} steps.
            {narrowed && <span className="mt-1 block text-xs">Try any direction, or let it go through more kinds of edge.</span>}
          </Hint>
        ))}
      <p className="p-4 text-xs text-muted-foreground">Paths don’t go through external symbols, since everything that calls a library would connect.</p>
    </>
  );
}

function PathEdge({ edge, forward }: { edge: GraphEdge; forward: boolean }) {
  const Arrow = forward ? ArrowDown : ArrowUp;
  return (
    <p className="flex items-center gap-1.5 border-b py-1 pl-4 text-xs text-muted-foreground">
      <Arrow className="size-4" aria-hidden />
      {GROUP_LABEL[groupKey(edge.type, forward ? "out" : "in")].toLowerCase()}
    </p>
  );
}

/** Picks one end of a path: by search, or the node selected on the graph. */
function Endpoint({
  label,
  value,
  selected,
  onChange,
  action,
}: {
  label: string;
  value?: GraphNode;
  selected?: GraphNode;
  onChange: (node: GraphNode | undefined) => void;
  action?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const q = useDebounced(draft.trim());
  const search = useApi<GraphNode[]>(q && !value ? graphUrl("search", { q }) : null);
  const results = q ? (search.data ?? (search.loading ? search.latest : undefined)) : undefined;
  const pick = (node: GraphNode) => {
    onChange(node);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-1.5 flex h-6 items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {action}
      </div>
      {value ? (
        <InputGroup>
          <InputGroupAddon>
            <SymbolIcon kind={value.kind} />
          </InputGroupAddon>
          <span className="min-w-0 flex-1 truncate pl-2 font-mono" title={value.file ?? value.name}>
            {nodeLabel(value)}
          </span>
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" className="text-muted-foreground" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(undefined)}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={`${label}: find a symbol or file`}
              placeholder="Find a symbol or file…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setDraft("");
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results?.[0]) pick(results[0]);
                }
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </InputGroup>
          {!q && selected && (
            <Button type="button" variant="ghost" size="xs" className="mt-1 max-w-full text-muted-foreground" onClick={() => pick(selected)}>
              Use <span className="truncate font-mono">{nodeLabel(selected)}</span>
            </Button>
          )}
          {q && results && (
            <div className="mt-1.5 max-h-60 overflow-y-auto rounded-md border [&>button:last-child]:border-b-0">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-muted-foreground">Nothing matches “{q}”.</p>
              ) : (
                results.slice(0, 20).map((node) => <NodeRow key={node.id} node={node} onClick={() => pick(node)} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The selected node: where it is, its edges by group (each one toggles), and a symbol's source. */
function Inspector({
  node,
  model,
  onClose,
  onToggle,
  onGroup,
  onRemove,
  onPathEnd,
}: {
  node: GraphNode;
  model: GraphModel;
  onClose: () => void;
  onToggle: () => void;
  onGroup: (type: EdgeType, dir: Direction, on: boolean) => void;
  onRemove: () => void;
  onPathEnd: (end: "from" | "to") => void;
}) {
  const info = useApi<{ node: GraphNode; groups: EdgeGroup[] }>(graphUrl("node", { id: node.id }));
  const hasSource = node.kind !== "File" && !node.external && node.file && node.line;
  const source = useApi<FileText>(hasSource ? fileUrl(node.file!) : null);
  const lines: LineRange | undefined = hasSource ? [node.line!, node.endLine ?? node.line!] : undefined;
  const shown = shownByGroup(model, node.id);
  const expanded = model.expanded.get(node.id);
  const counts = new Map(info.data?.groups.map((g) => [groupKey(g.type, g.dir), g.count]));
  const groups = GROUPS.filter(([key]) => counts.has(key));

  return (
    <aside aria-label={nodeLabel(node)} className="absolute inset-0 z-10 flex flex-col bg-background md:static md:w-80 md:shrink-0 md:border-l">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <SymbolIcon kind={node.kind} />
        <h2 className="truncate font-mono font-medium">{nodeLabel(node)}</h2>
        <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Remove from graph" title="Remove from graph" onClick={onRemove}>
          <Trash2 />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Close details" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 border-b p-4">
          <div className="space-y-0.5">
            <p className="text-muted-foreground">
              {node.external ? "External " : node.isTest ? "Test " : ""}
              {node.external || node.isTest ? kindLabel(node.kind).toLowerCase() : kindLabel(node.kind)}
            </p>
            <NodePlace node={node} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.degree > 0 && (
              <Button variant="outline" size="sm" onClick={onToggle}>
                {expanded ? <CircleMinus /> : <CirclePlus />}
                {expanded ? "Collapse" : "Expand"}
              </Button>
            )}
            {node.kind !== "File" && !node.external && node.file && node.line && (
              <Button variant="outline" size="sm" asChild>
                <a href={searchHref({ q: node.name, name: node.name, file: node.file, line: node.line })}>
                  <BookSearch />
                  Symbols
                </a>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => onPathEnd("from")}>
              <Route />
              Path from here
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPathEnd("to")}>
              Path to here
            </Button>
          </div>
        </div>
        <section aria-label="Edges">
          {info.error ? (
            <Hint>{info.error.message}</Hint>
          ) : !info.data ? (
            <Hint>Loading…</Hint>
          ) : groups.length === 0 ? (
            <Hint>Nothing connects to this.</Hint>
          ) : (
            groups.map(([key, label]) => {
              const [type, dir] = key.split(":") as [EdgeType, Direction];
              const total = counts.get(key)!;
              const on = !!expanded?.has(key);
              const count = shown.get(key) ?? 0;
              return (
                <div key={key} className={cn("flex items-center border-b", on && "bg-accent")}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onGroup(type, dir, !on)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-2 pl-4 text-left hover:bg-accent"
                  >
                    {on ? <CircleMinus className="size-4 shrink-0 text-muted-foreground" /> : <CirclePlus className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{label}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{on && count < total ? `${count} of ${total}` : total}</span>
                  </button>
                  {on && count < total && (
                    <Button variant="outline" size="xs" className="mr-2" onClick={() => onGroup(type, dir, true)}>
                      More
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </section>
        {lines && (
          <section aria-label="Source" className="p-4">
            {source.data ? (
              <CodeLines
                text={source.data.text}
                path={node.file!}
                startLine={1}
                only={lines}
                highlight={lines}
                className="max-h-80 rounded-md border py-1.5"
              />
            ) : (
              <p className="text-muted-foreground">{source.error ? "Source not available." : "Loading…"}</p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="p-4 text-muted-foreground">{children}</p>;
