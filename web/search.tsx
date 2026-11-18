import { ArrowLeft, File, LoaderCircle, Search as SearchIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type ApiError,
  type Definition,
  type FileText,
  fileUrl,
  type ImpactFile,
  type Overview,
  queryUrl,
  type RefFile,
  type Related,
  type SymbolHit,
  type TestFile,
  useApi,
} from "@/api";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExplainDialog, ExplainTip } from "@/explain";
import { cn } from "@/lib/utils";
import { rememberSymbol } from "@/recent";
import { type FileRef, type LineRange, SourcePanel, SourceText } from "@/source";
import { KIND_FILTERS, kindLabel, PathLabel, SymbolIcon, type SymbolRef, searchHref } from "@/symbol";

const DEBOUNCE_MS = 150;
/** The API's default row limit for `search`. */
const SEARCH_LIMIT = 50;

const TABS = ["source", "callers", "callees", "refs", "tests", "impact"] as const;
type Tab = (typeof TABS)[number];

/** Everything the page shows, from #/search?q=&kind=&name=&file=&line=&tab= */
interface SearchState {
  q: string;
  kind?: string;
  symbol?: SymbolRef;
  tab: Tab;
}

function readState(params: URLSearchParams): SearchState {
  const name = params.get("name");
  const file = params.get("file");
  const line = Number(params.get("line"));
  const tab = params.get("tab") as Tab;
  return {
    q: params.get("q") ?? "",
    kind: params.get("kind") || undefined,
    symbol: name && file && Number.isInteger(line) && line > 0 ? { name, file, line } : undefined,
    tab: TABS.includes(tab) ? tab : "source",
  };
}

const toHref = ({ q, kind, symbol, tab }: SearchState) =>
  searchHref({ q, kind, name: symbol?.name, file: symbol?.file, line: symbol?.line, tab: symbol && tab !== "source" ? tab : undefined });

/** Changes search parameters without a history entry, so typing and switching tabs don't pile up Back steps. */
function replaceParams(patch: Record<string, string | undefined>) {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  history.replaceState(null, "", searchHref(Object.fromEntries(params)));
  // replaceState doesn't fire hashchange, and the router listens for it.
  dispatchEvent(new HashChangeEvent("hashchange"));
}

const sameSymbol = (a: SymbolRef | undefined, b: SymbolRef | undefined) =>
  !!a && !!b && a.name === b.name && a.file === b.file && a.line === b.line;

/** Results column, the picked symbol's source and relationships, and a peek panel for files. */
export function Search({ params }: { params: URLSearchParams }) {
  const state = readState(params);
  const overview = useApi<Overview>("/api/overview");
  if (overview.error) {
    const { notLoaded, message } = overview.error;
    return (
      <div className="m-auto max-w-md px-4 text-center">
        <p className="font-medium">{notLoaded ? "The graph isn’t loaded." : "Couldn’t reach the graph."}</p>
        <p className="mt-1 text-muted-foreground">
          {notLoaded ? (
            <>
              Run <code className="font-mono">pnpm graph sync -p &lt;project dir&gt;</code>, then reload.
            </>
          ) : (
            message
          )}
        </p>
      </div>
    );
  }
  const { symbol } = state;
  return (
    <div className="relative flex min-h-0 flex-1">
      <Results state={state} overview={overview.data} />
      {symbol ? (
        <SymbolView key={`${symbol.name}\n${symbol.file}\n${symbol.line}`} state={state} symbol={symbol} />
      ) : (
        <div className="m-auto hidden max-w-sm flex-col items-center gap-2 px-4 text-center md:flex">
          <p className="text-muted-foreground">Pick a symbol to see its source, callers and impact.</p>
          {overview.data && (
            <p className="font-mono text-xs text-muted-foreground">
              <span className="block break-all">{overview.data.project.root}</span>
              {overview.data.project.tool} {overview.data.project.toolVersion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Results({ state, overview }: { state: SearchState; overview?: Overview }) {
  const { q, kind, symbol } = state;
  const [draft, setDraft] = useState(q);
  const [synced, setSynced] = useState(q);
  // Back, Forward and sidebar links change `q` from outside; the debounced writes below already match the draft.
  if (q !== synced) {
    setSynced(q);
    if (q !== draft.trim()) setDraft(q);
  }
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = setTimeout(() => replaceParams({ q: draft.trim() }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, q]);

  const search = useApi<SymbolHit[]>(q ? queryUrl("search", q, { kind }) : null);
  // Keep the previous results up while the next ones load, so the list doesn't flash empty on every keystroke.
  const results = q ? (search.data ?? (search.loading ? search.latest : undefined)) : undefined;

  const kinds = Object.keys(KIND_FILTERS).filter((k) => overview?.kinds.some((row) => row.kind === k));
  const symbolCount = overview?.kinds.reduce((n, row) => (row.kind === "Parameter" || row.kind === "TypeParameter" ? n : n + row.symbols), 0);
  const fileCount = overview?.languages.reduce((n, row) => n + row.files, 0);

  return (
    <section aria-label="Search" className={cn("flex w-full flex-col md:w-80 md:shrink-0 md:border-r", symbol && "hidden md:flex")}>
      <form
        role="search"
        className="space-y-3 border-b p-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter searches right away, or opens the first result once they're in.
          if (draft.trim() !== q) replaceParams({ q: draft.trim() });
          else if (results?.[0]) location.hash = toHref({ ...state, symbol: results[0] });
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Find a symbol"
            placeholder="Find a symbol…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          {search.loading && (
            <InputGroupAddon align="inline-end">
              <LoaderCircle className="motion-safe:animate-spin" />
              <span className="sr-only">Searching</span>
            </InputGroupAddon>
          )}
        </InputGroup>
        {kinds.length > 0 && (
          <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" aria-pressed={!kind} onClick={() => replaceParams({ kind: undefined })}>
              All
            </Button>
            {kinds.map((k) => (
              <Button key={k} type="button" variant="outline" size="sm" aria-pressed={kind === k} onClick={() => replaceParams({ kind: k })}>
                {KIND_FILTERS[k]}
              </Button>
            ))}
          </div>
        )}
      </form>
      <nav aria-label="Results" className="flex-1 overflow-y-auto">
        {!q ? (
          overview && (
            <Hint>
              Search {symbolCount} symbols across {fileCount} files.
            </Hint>
          )
        ) : search.error ? (
          <Hint>{search.error.message}</Hint>
        ) : !results ? null : results.length === 0 ? (
          <Hint>No symbols match “{q}”.</Hint>
        ) : (
          <>
            {results.map((r) => (
              <SymbolRow key={`${r.file}:${r.line}:${r.name}`} symbol={r} href={toHref({ ...state, symbol: r })} current={sameSymbol(r, symbol)} />
            ))}
            {results.length >= SEARCH_LIMIT && <Hint>Showing the first {SEARCH_LIMIT}. Keep typing to narrow it down.</Hint>}
          </>
        )}
      </nav>
    </section>
  );
}

function SymbolView({ state, symbol }: { state: SearchState; symbol: SymbolRef }) {
  const opts = { file: symbol.file, line: symbol.line };
  const definition = useApi<Definition[]>(queryUrl("source", symbol.name, opts));
  const source = useApi<FileText>(fileUrl(symbol.file));
  // All at once, so every tab can show its count.
  const callers = useApi<Related[]>(queryUrl("callers", symbol.name, opts));
  const callees = useApi<Related[]>(queryUrl("callees", symbol.name, opts));
  const refs = useApi<RefFile[]>(queryUrl("refs", symbol.name, opts));
  const tests = useApi<TestFile[]>(queryUrl("tests-for", symbol.name, opts));
  const impact = useApi<ImpactFile[]>(queryUrl("impact", symbol.name, opts));
  const [peek, setPeek] = useState<FileRef | null>(null);
  const peekSource = useApi<FileText>(peek ? fileUrl(peek.path) : null);

  const [explaining, setExplaining] = useState(false);

  const found = definition.data?.[0];
  const lines = useMemo((): LineRange | undefined => found && [found.line, found.endLine ?? found.line], [found]);
  useEffect(() => {
    if (found) rememberSymbol({ name: found.name, file: found.file, line: found.line, kind: found.kind });
  }, [found]);

  // Jumping along a caller or callee lands on its source; Back returns to this tab.
  const symbolHref = (s: SymbolRef) => toHref({ ...state, symbol: s, tab: "source" });
  const fileRow = (file: string, note?: string, detail?: ReactNode) => (
    <FileRow key={file} file={file} note={note} detail={detail} current={peek?.path === file} onOpen={() => setPeek({ path: file })} />
  );

  return (
    <>
      <section aria-label={symbol.name} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <Button variant="ghost" size="icon-sm" className="-ml-2 text-muted-foreground md:hidden" aria-label="Back to results" asChild>
            <a href={toHref({ ...state, symbol: undefined })}>
              <ArrowLeft />
            </a>
          </Button>
          <SymbolIcon kind={found?.kind} />
          <h1 className="truncate font-mono font-medium">{symbol.name}</h1>
          {/* Phones keep the room for the name; the icon still says the kind. */}
          {found && <span className="hidden shrink-0 text-muted-foreground sm:inline">{kindLabel(found.kind)}</span>}
          <PathLabel path={symbol.file} line={symbol.line} className="ml-auto max-w-[50%] pl-4" />
        </header>
        {definition.error ? (
          <p className="m-auto px-4 text-muted-foreground">{definition.error.message}</p>
        ) : definition.data?.length === 0 ? (
          <p className="m-auto px-4 text-center text-muted-foreground">Symbol not found. The graph may have changed since this link was made.</p>
        ) : (
          <Tabs value={state.tab} onValueChange={(t) => replaceParams({ tab: t === "source" ? undefined : t })} className="min-h-0 flex-1">
            <TabsList aria-label="Symbol details" className="w-full shrink-0 justify-start overflow-x-auto border-b p-4">
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="callers">
                Callers <Count rows={callers.data} />
              </TabsTrigger>
              <TabsTrigger value="callees">
                Callees <Count rows={callees.data} />
              </TabsTrigger>
              <TabsTrigger value="refs">
                References <Count rows={refs.data} />
              </TabsTrigger>
              <TabsTrigger value="tests">
                Tests <Count rows={tests.data} />
              </TabsTrigger>
              <TabsTrigger value="impact">
                Impact <Count rows={impact.data} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="source" className="flex min-h-0 flex-col">
              {lines && source.data ? (
                <SourceText
                  text={source.data.text}
                  highlight={lines}
                  highlightAction={<ExplainTip below={lines[0] === 1} onClick={() => setExplaining(true)} />}
                  className="flex-1 py-4"
                />
              ) : (
                <p className="m-auto text-muted-foreground">{source.error ? "Source not available." : "Loading…"}</p>
              )}
            </TabsContent>
            <TabsContent value="callers" className="min-h-0 overflow-y-auto">
              <Rows result={callers} empty="Nothing calls this." hint="Calls from top-level code don’t count. Check References.">
                {(s) => <SymbolRow key={`${s.file}:${s.line}:${s.name}`} symbol={s} href={symbolHref(s)} />}
              </Rows>
            </TabsContent>
            <TabsContent value="callees" className="min-h-0 overflow-y-auto">
              <Rows result={callees} empty="This doesn’t use any other symbols.">
                {(s) => <SymbolRow key={`${s.file}:${s.line}:${s.name}`} symbol={s} href={symbolHref(s)} />}
              </Rows>
            </TabsContent>
            <TabsContent value="refs" className="min-h-0 overflow-y-auto">
              <Rows result={refs} empty="Nothing references this.">
                {(r) => fileRow(r.file, r.refs === 1 ? "1 ref" : `${r.refs} refs`, r.inside.length > 0 && <Names prefix="in" names={r.inside} />)}
              </Rows>
            </TabsContent>
            <TabsContent value="tests" className="min-h-0 overflow-y-auto">
              <Rows result={tests} empty="No tests reach this.">
                {(t) => fileRow(t.testFile, undefined, <Names prefix="via" names={t.via} />)}
              </Rows>
            </TabsContent>
            <TabsContent value="impact" className="min-h-0 overflow-y-auto">
              <Rows result={impact} empty="Changing this affects no other files.">
                {(f) => fileRow(f.file, f.isTest ? "test" : undefined)}
              </Rows>
            </TabsContent>
          </Tabs>
        )}
      </section>
      {peek && <SourcePanel file={peek} text={peekSource.error ? null : peekSource.data?.text} onClose={() => setPeek(null)} />}
      {found && lines && source.data && (
        <ExplainDialog open={explaining} onOpenChange={setExplaining} name={found.name} file={found.file} text={source.data.text} lines={lines} />
      )}
    </>
  );
}

/** A symbol: icon and mono name, with its path underneath, lined up with the name. */
function SymbolRow({ symbol, href, current }: { symbol: SymbolHit; href: string; current?: boolean }) {
  return (
    <a href={href} aria-current={current ? "page" : undefined} className="block border-b px-4 py-2.5 hover:bg-accent aria-[current=page]:bg-accent">
      <span className="flex items-center gap-2">
        <SymbolIcon kind={symbol.kind} />
        <span className="truncate font-mono">{symbol.name}</span>
      </span>
      <PathLabel path={symbol.file} line={symbol.line} className="mt-0.5 pl-6" />
    </a>
  );
}

/** A file that opens in the peek panel. `note` sits on the right, `detail` underneath. */
function FileRow({ file, note, detail, current, onOpen }: { file: string; note?: string; detail?: ReactNode; current: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      onClick={onOpen}
      className="block w-full border-b px-4 py-2.5 text-left hover:bg-accent aria-[current=true]:bg-accent"
    >
      <span className="flex items-center gap-2">
        <File className="size-4 shrink-0 text-muted-foreground" />
        <PathLabel path={file} className="text-sm text-foreground" />
        {note && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{note}</span>}
      </span>
      {detail && <span className="mt-0.5 block truncate pl-6 text-xs text-muted-foreground">{detail}</span>}
    </button>
  );
}

function Names({ prefix, names }: { prefix: string; names: string[] }) {
  return (
    <>
      {prefix} <span className="font-mono">{names.join(", ")}</span>
    </>
  );
}

function Rows<T>({
  result,
  empty,
  hint,
  children,
}: {
  result: { data?: T[]; error?: ApiError };
  empty: string;
  hint?: string;
  children: (row: T) => ReactNode;
}) {
  if (result.error) return <Hint>{result.error.message}</Hint>;
  if (!result.data) return <Hint>Loading…</Hint>;
  if (result.data.length === 0) {
    return (
      <Hint>
        {empty}
        {hint && <span className="mt-1 block text-xs">{hint}</span>}
      </Hint>
    );
  }
  return result.data.map(children);
}

const Count = ({ rows }: { rows?: unknown[] }) => rows && <span className="text-muted-foreground tabular-nums">{rows.length}</span>;

const Hint = ({ children }: { children: ReactNode }) => <p className="p-4 text-muted-foreground">{children}</p>;
