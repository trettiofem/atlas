import { ArrowLeft, ScrollText, Search as SearchIcon, Trash2 } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { type Artifact, artifactHref, type FileText, fetchJson, fileUrl, queryUrl, type SymbolHit, useApi } from "@/api";
import { MARKDOWN } from "@/chat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fuzzyFilter } from "@/fuzzy";
import { cn } from "@/lib/utils";
import { forgetArtifact, rememberArtifact } from "@/recent";
import { FileRow, GraphUnavailable } from "@/search";
import { type FileRef, SourcePanel } from "@/source";
import { searchHref } from "@/symbol";

/** The topic in #/artifacts/<topic>, which a hand-edited URL can leave badly encoded. */
export function decodeTopic(id?: string) {
  if (!id) return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// Artifacts are documents, so they keep their headings. The page's h1 is the topic, so they start at h2.
const DOC_MARKDOWN: Components = {
  ...MARKDOWN,
  h1: ({ children }) => <h2 className="pt-2 text-lg font-bold tracking-tight">{children}</h2>,
  h2: ({ children }) => <h3 className="pt-2 text-base font-bold tracking-tight">{children}</h3>,
  h3: ({ children }) => <h4 className="pt-1 font-bold tracking-tight">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold">{children}</h5>,
};

const formatDate = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const formatDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

const changedLabel = (n: number) => (n === 1 ? "1 file changed" : `${n} files changed`);

/** Artifact list, the open artifact and a source panel. Without a `topic` the newest opens on desktop. */
export function Artifacts({ topic }: { topic?: string }) {
  const list = useApi<Artifact[]>("/api/artifacts");
  // Dropped locally on delete, rather than refetching the list.
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const all = (list.data ?? []).filter((a) => !deleted.has(a.topic));
  const artifact = topic ? all.find((a) => a.topic === topic) : all[0];
  // Only artifacts the user picked, not the newest opened by default.
  const opened = topic && artifact ? topic : undefined;
  useEffect(() => {
    if (opened) rememberArtifact(opened);
  }, [opened]);
  if (list.error?.notLoaded) return <GraphUnavailable error={list.error} />;

  const none = !!list.data && all.length === 0;
  const q = query.trim();
  const artifacts = fuzzyFilter(all, q, (a) => [a.topic, a.summary, ...a.files, ...a.symbols]);
  return (
    <div className="relative flex min-h-0 flex-1">
      {/* On mobile the list is the page until an artifact is open, like Search's results. */}
      <div className={cn("flex w-full flex-col md:w-80 md:shrink-0 md:border-r", (topic || none) && "hidden md:flex")}>
        <div role="search" className="border-b p-4">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Find an artifact"
              placeholder="Find an artifact…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              autoComplete="off"
              spellCheck={false}
            />
          </InputGroup>
        </div>
        <nav aria-label="Artifacts" className="flex-1 overflow-y-auto">
          {list.error && <p className="border-b p-4 text-muted-foreground">{list.error.message}</p>}
          {q && artifacts.length === 0 && <p className="border-b p-4 text-muted-foreground">No artifacts match “{q}”.</p>}
          {artifacts.map((a) => (
            <a
              key={a.topic}
              href={artifactHref(a.topic)}
              aria-current={a === artifact ? "page" : undefined}
              className={cn(
                "flex gap-2 border-b p-4 hover:bg-accent",
                // Without a topic, mobile shows only the list, so the newest isn't open there.
                topic ? "aria-[current=page]:bg-accent" : "md:aria-[current=page]:bg-accent",
              )}
            >
              <span className="flex h-5 shrink-0 items-center">
                <ScrollText className="size-4 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{a.topic}</span>
                <span className="mt-1 line-clamp-3">{a.summary}</span>
                <span className="mt-1 block text-muted-foreground">
                  {formatDay(a.updatedAt)}
                  {a.staleFiles.length > 0 && ` · ${changedLabel(a.staleFiles.length)}`}
                </span>
              </span>
            </a>
          ))}
        </nav>
      </div>
      {artifact ? (
        <ArtifactView
          key={artifact.topic}
          artifact={artifact}
          className={cn(!topic && "hidden md:flex")}
          onDeleted={() => {
            setDeleted((d) => new Set(d).add(artifact.topic));
            forgetArtifact(artifact.topic);
          }}
        />
      ) : none ? (
        <p className="m-auto px-4 text-center text-muted-foreground">No artifacts yet. Agents save one after a long investigation.</p>
      ) : (
        topic && list.data && <p className="m-auto px-4 text-muted-foreground">Artifact not found.</p>
      )}
    </div>
  );
}

function ArtifactView({ artifact, className, onDeleted }: { artifact: Artifact; className?: string; onDeleted: () => void }) {
  const [peek, setPeek] = useState<FileRef | null>(null);
  const source = useApi<FileText>(peek ? fileUrl(peek.path) : null);
  const stale = new Set(artifact.staleFiles);
  return (
    <>
      <section aria-label={artifact.topic} className={cn("flex min-w-0 flex-1 flex-col", className)}>
        <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <Button variant="ghost" size="icon-sm" className="-ml-2 text-muted-foreground md:hidden" aria-label="Back to artifacts" asChild>
            <a href="#/artifacts">
              <ArrowLeft />
            </a>
          </Button>
          <ScrollText className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate font-medium">{artifact.topic}</h1>
          <DeleteArtifact artifact={artifact} onDeleted={onDeleted} />
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <article className="mx-auto max-w-3xl space-y-6">
            <div className="space-y-1">
              <p className="text-muted-foreground">{artifact.summary}</p>
              <p className="text-xs text-muted-foreground">Updated {formatDate(artifact.updatedAt)}</p>
            </div>
            <div className="space-y-3 break-words">
              <Markdown components={DOC_MARKDOWN}>{artifact.markdown}</Markdown>
            </div>
            {artifact.files.length > 0 && (
              <section aria-label="Files" className="space-y-2">
                <h2 className="font-bold tracking-tight">Files</h2>
                {/* The rows bring their own bottom borders; the box draws the last one. */}
                <div className="overflow-hidden rounded-md border [&>*:last-child]:border-b-0">
                  {artifact.files.map((f) => (
                    <FileRow
                      key={f}
                      file={f}
                      note={stale.has(f) ? "changed since" : undefined}
                      current={peek?.path === f}
                      onOpen={() => setPeek({ path: f })}
                    />
                  ))}
                </div>
              </section>
            )}
            {artifact.symbols.length > 0 && (
              <section aria-label="Symbols" className="space-y-2">
                <h2 className="font-bold tracking-tight">Symbols</h2>
                <div className="flex flex-wrap gap-1.5">
                  {artifact.symbols.map((s) => (
                    <SymbolChip key={s} name={s} files={artifact.files} />
                  ))}
                </div>
              </section>
            )}
          </article>
        </div>
      </section>
      {peek && <SourcePanel file={peek} text={source.error ? null : source.data?.text} onClose={() => setPeek(null)} />}
    </>
  );
}

/**
 * Opens Search on the name with the symbol selected. Artifacts store only names, so the click looks it up,
 * preferring a definition in the artifact's files. With no match, Search just shows the results for the name.
 */
function SymbolChip({ name, files }: { name: string; files: string[] }) {
  const open = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const hits = await fetchJson<SymbolHit[]>(queryUrl("find", name)).catch(() => []);
    const hit = hits.find((h) => files.includes(h.file)) ?? hits[0];
    location.hash = searchHref({ q: name, name: hit?.name, file: hit?.file, line: hit?.line });
  };
  return (
    <Button variant="outline" size="sm" className="font-mono" asChild>
      <a href={searchHref({ q: name })} onClick={open}>
        {name}
      </a>
    </Button>
  );
}

/** The header's delete button, which asks first. */
function DeleteArtifact({ artifact, onDeleted }: { artifact: Artifact; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setDeleting(true);
    setError(undefined);
    try {
      await fetchJson(`/api/artifacts?${new URLSearchParams({ topic: artifact.topic })}`, { method: "DELETE" });
      onDeleted();
      // Replaced, so Back skips the deleted artifact.
      location.replace("#/artifacts");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Delete artifact" onClick={() => setOpen(true)}>
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Delete artifact</TooltipContent>
      </Tooltip>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-bold tracking-tight">Delete this artifact?</DialogTitle>
          <DialogDescription>“{artifact.topic}” will be gone for good, and agents won’t find it anymore.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-muted-foreground">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={confirm} disabled={deleting}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
