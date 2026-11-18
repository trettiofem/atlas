import { File, X } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Inclusive, 1-based line numbers in a file. */
export type LineRange = [from: number, to: number];

/** A file to show, optionally at lines to highlight. */
export interface FileRef {
  path: string;
  lines?: LineRange;
}

/** Beside the main column on desktop, over it on mobile. `text` is undefined while loading and null when missing. */
export function SourcePanel({
  file,
  text,
  startLine,
  onClose,
}: {
  file: FileRef;
  text: string | null | undefined;
  startLine?: number;
  onClose: () => void;
}) {
  return (
    <aside aria-label={file.path} className="absolute inset-0 flex flex-col bg-background md:static md:w-[min(30rem,40%)] md:shrink-0 md:border-l">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <File className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate font-mono">{file.path}</h2>
        <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Close source" onClick={onClose}>
          <X />
        </Button>
      </header>
      {text != null ? (
        // A fresh `file` per open, so reopening the same reference scrolls back to its lines.
        <SourceText text={text} startLine={startLine} highlight={file.lines} reveal={file} className="flex-1 py-4" />
      ) : (
        <p className="m-auto text-muted-foreground">{text === undefined ? "Loading…" : "Source not available."}</p>
      )}
    </aside>
  );
}

/** A whole file. Scrolls the highlighted lines to the center when `reveal` changes, or to the top without a highlight. */
export function SourceText({
  text,
  startLine = 1,
  highlight,
  highlightAction,
  reveal,
  className,
}: {
  text: string;
  startLine?: number;
  highlight?: LineRange;
  highlightAction?: ReactNode;
  reveal?: unknown;
  className?: string;
}) {
  const code = useMemo(() => text.split("\n"), [text]);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const hit = pre.current?.querySelector("[data-highlight]");
    if (hit) hit.scrollIntoView({ block: "center" });
    else pre.current?.scrollTo(0, 0);
  }, [reveal, code]);
  return <CodeLines ref={pre} code={code} startLine={startLine} highlight={highlight} highlightAction={highlightAction} className={className} />;
}

/**
 * Mono code with a line-number gutter. Lines inside `highlight` get a blue tint and left edge. They sit in one
 * `group/highlight` block, so `highlightAction` (positioned against it) can show while the highlight is hovered.
 */
export function CodeLines({
  code,
  startLine,
  highlight,
  highlightAction,
  className,
  ref,
}: {
  code: string[];
  startLine: number;
  highlight?: LineRange;
  highlightAction?: ReactNode;
  className?: string;
  ref?: Ref<HTMLPreElement>;
}) {
  const [from, to] = highlight ?? [Infinity, Infinity];
  const before: ReactNode[] = [];
  const hits: ReactNode[] = [];
  const after: ReactNode[] = [];
  code.forEach((line, i) => {
    const n = startLine + i;
    const hit = n >= from && n <= to;
    (n < from ? before : hit ? hits : after).push(
      <span key={n} data-highlight={hit || undefined} className={cn("block border-l-2 border-transparent pr-4", hit && "border-blue bg-blue/10")}>
        <span className="inline-block w-12 pr-4 text-right text-muted-foreground select-none">{n}</span>
        {line}
      </span>,
    );
  });
  return (
    <pre ref={ref} className={cn("overflow-auto text-xs", className)}>
      {/* w-max: a highlight spans the widest line, not just the visible width. */}
      <code className="block w-max min-w-full">
        {before}
        {hits.length > 0 && (
          <span className="group/highlight relative block">
            {hits}
            {highlightAction}
          </span>
        )}
        {after}
      </code>
    </pre>
  );
}
