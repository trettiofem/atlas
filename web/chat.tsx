import { ChevronRight, CircleAlert, CircleCheck, File, LoaderCircle, type LucideIcon, Waypoints } from "lucide-react";
import { type ReactNode, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { type FileText, fileUrl, type Turn, useApi } from "@/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CodeLines, type FileRef } from "@/source";

/** A user's message: a right-aligned raised bubble. */
export function UserMessage({ children }: { children: ReactNode }) {
  return <p className="ml-auto w-fit max-w-[80%] rounded-md border px-2.5 py-1.5 whitespace-pre-wrap shadow-raised">{children}</p>;
}

/** A tool call or thinking step, e.g. "Queried code graph · 52ms". Without a `duration` it is still running. */
export function Step({ icon, label, duration }: { icon: LucideIcon; label: string; duration?: string }) {
  const Icon = duration ? icon : LoaderCircle;
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Icon className={cn("size-4 shrink-0", !duration && "motion-safe:animate-spin")} />
      {label}
      {duration && ` · ${duration}`}
    </p>
  );
}

const STEP_ICON = { graph: Waypoints, thought: CircleCheck };

/** "52ms" under a second, "2s" or "1.5s" above. */
export const formatDuration = (ms: number) => (ms < 1000 ? `${ms}ms` : `${Number((ms / 1000).toFixed(ms < 10_000 ? 1 : 0))}s`);

// Answers are body text: inline code without a background, plain lists, no headings.
export const MARKDOWN: Components = {
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="overflow-auto rounded-md border px-3 py-2 text-xs">{children}</pre>,
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  h4: ({ children }) => <p className="font-semibold">{children}</p>,
};

type StepTurn = Extract<Turn, { type: "step" }>;

/**
 * A transcript. Each run of consecutive steps folds into one row ("Queried the code graph 15 times · 21s") that
 * expands to list them; while a step runs, the row shows it with a spinner. A lone step shows as it is.
 */
export function Transcript({ turns, onOpenFile }: { turns: Turn[]; onOpenFile?: (file: FileRef) => void }) {
  const blocks: { key: number; turn?: Turn; steps?: StepTurn[] }[] = [];
  turns.forEach((turn, i) => {
    const last = blocks[blocks.length - 1];
    if (turn.type !== "step") blocks.push({ key: i, turn });
    else if (last?.steps) last.steps.push(turn);
    else blocks.push({ key: i, steps: [turn] });
  });
  return blocks.map(({ key, turn, steps }) =>
    steps ? (
      steps.length === 1 ? <TurnView key={key} turn={steps[0]} /> : <StepGroup key={key} steps={steps} />
    ) : (
      <TurnView key={key} turn={turn!} onOpenFile={onOpenFile} />
    ),
  );
}

function StepGroup({ steps }: { steps: StepTurn[] }) {
  const [open, setOpen] = useState(false);
  const running = steps.find((s) => s.durationMs === undefined);
  const queries = steps.filter((s) => s.kind === "graph").length;
  const total = steps.reduce((ms, s) => ms + (s.durationMs ?? 0), 0);
  const summary = queries === 0 ? "Thought" : `Queried the code graph ${queries === 1 ? "once" : `${queries} times`}`;
  const Icon = running ? LoaderCircle : queries === 0 ? CircleCheck : Waypoints;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1 flex max-w-full items-center gap-2 rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className={cn("size-4 shrink-0", running && "motion-safe:animate-spin")} />
        <span className="truncate">{running ? running.label : `${summary} · ${formatDuration(total)}`}</span>
        <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 ml-2 space-y-2 border-l pl-4">
          {steps.map((step, i) => (
            <TurnView key={i} turn={step} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One transcript entry. File references open `onOpenFile` (the source panel); without it they're plain labels. */
export function TurnView({ turn, onOpenFile }: { turn: Turn; onOpenFile?: (file: FileRef) => void }) {
  switch (turn.type) {
    case "user":
      return <UserMessage>{turn.text}</UserMessage>;
    case "step":
      return <Step icon={STEP_ICON[turn.kind]} label={turn.label} duration={turn.durationMs === undefined ? undefined : formatDuration(turn.durationMs)} />;
    case "answer":
      return (
        <div className="space-y-2 break-words">
          <Markdown components={MARKDOWN}>{turn.text}</Markdown>
        </div>
      );
    case "error":
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <CircleAlert className="size-4 shrink-0" />
          {turn.text}
        </p>
      );
    case "file":
      return <FileTurn path={turn.path} lines={turn.lines} onOpenFile={onOpenFile} />;
  }
}

function FileTurn({ path, lines, onOpenFile }: FileRef & { onOpenFile?: (file: FileRef) => void }) {
  const source = useApi<FileText>(lines ? fileUrl(path) : null);
  const label = (
    <>
      <File className="text-muted-foreground" />
      <span className="truncate">
        {path}
        {lines && `:${lines[0] === lines[1] ? lines[0] : lines.join("-")}`}
      </span>
    </>
  );
  return (
    <div className="space-y-1">
      {onOpenFile ? (
        // A fresh object per click, so reopening the same reference scrolls back to its lines.
        <Button variant="ghost" size="sm" className="-mx-2.5 max-w-full font-mono text-xs font-normal" onClick={() => onOpenFile({ path, lines })}>
          {label}
          <ChevronRight className="text-muted-foreground" />
        </Button>
      ) : (
        <p className="flex h-8 items-center gap-2 font-mono text-xs [&_svg]:size-4 [&_svg]:shrink-0">{label}</p>
      )}
      {lines && source.data && (
        <CodeLines text={source.data.text} path={path} startLine={1} only={lines} highlight={lines} className="rounded-md border py-1.5" />
      )}
    </div>
  );
}
