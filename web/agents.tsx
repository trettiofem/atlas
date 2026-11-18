import { ChevronRight, CircleCheck, File, LoaderCircle, Plus, Waypoints, X } from "lucide-react";
import { type Ref, useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/agent-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENTS, type Agent, type FileRef, type LineRange, SOURCES, type Turn } from "@/mock";
import { PromptBox } from "@/prompt-box";

const STEP_ICON = { graph: Waypoints, thought: CircleCheck };

/** Agent list, conversation and source panel. `id` comes from #/agents/<id>; without one the first agent opens. */
export function Agents({ id }: { id?: string }) {
  const agent = id ? AGENTS.find((a) => a.id === id) : AGENTS[0];
  return (
    <div className="relative flex min-h-0 flex-1">
      <nav aria-label="Agents" className="hidden w-62.5 shrink-0 overflow-y-auto border-r md:block">
        {AGENTS.map((a) => (
          <a
            key={a.id}
            href={`#/agents/${a.id}`}
            aria-current={a === agent ? "page" : undefined}
            className="flex gap-2 border-b p-4 hover:bg-accent aria-[current=page]:bg-accent"
          >
            <span className="flex h-5 items-center">
              <AgentIcon status={a.status} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{a.title}</span>
              <span className="mt-1 line-clamp-6">{a.description}</span>
            </span>
          </a>
        ))}
        <div className="border-b p-4">
          {/* New agents start from a prompt on Home. */}
          <Button variant="outline" className="w-full" asChild>
            <a href="#/">
              <Plus /> Create
            </a>
          </Button>
        </div>
      </nav>
      {agent ? <Conversation key={agent.id} agent={agent} /> : <p className="m-auto text-muted-foreground">Agent not found.</p>}
    </div>
  );
}

function Conversation({ agent }: { agent: Agent }) {
  const [file, setFile] = useState<FileRef | null>(null);
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <section aria-label={agent.title} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <AgentIcon status={agent.status} />
          <h1 className="truncate font-medium">{agent.title}</h1>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {agent.transcript.map((turn, i) => (
            <TurnView key={i} turn={turn} onOpenFile={setFile} />
          ))}
        </div>
        <div className="border-t p-4">
          {/* shortcut: sending is a no-op until the agents API exists. */}
          <PromptBox value={prompt} onValueChange={setPrompt} onSubmit={() => {}} className="min-h-10" />
        </div>
      </section>
      {file && <SourcePanel file={file} onClose={() => setFile(null)} />}
    </>
  );
}

function TurnView({ turn, onOpenFile }: { turn: Turn; onOpenFile: (file: FileRef) => void }) {
  switch (turn.type) {
    case "user":
      return <p className="ml-auto w-fit max-w-[80%] rounded-md border px-2.5 py-1.5 whitespace-pre-wrap shadow-raised">{turn.text}</p>;
    case "step": {
      const Icon = turn.duration ? STEP_ICON[turn.kind] : LoaderCircle;
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Icon className={cn("size-4 shrink-0", !turn.duration && "motion-safe:animate-spin")} />
          {turn.label}
          {turn.duration && ` · ${turn.duration}`}
        </p>
      );
    }
    case "answer":
      return <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5">{turn.body}</div>;
    case "file": {
      const { path, lines } = turn;
      const source = SOURCES[path];
      return (
        <div className="space-y-1">
          {/* A fresh object per click, so reopening the same reference scrolls back to its lines. */}
          <Button variant="ghost" size="sm" className="-mx-2.5 max-w-full font-mono font-normal" onClick={() => onOpenFile({ path, lines })}>
            <File className="text-muted-foreground" />
            <span className="truncate">
              {path}
              {lines && `:${lines[0] === lines[1] ? lines[0] : lines.join("-")}`}
            </span>
            <ChevronRight className="text-muted-foreground" />
          </Button>
          {source && lines && (
            <CodeLines
              code={source.code.split("\n").slice(lines[0] - source.startLine, lines[1] - source.startLine + 1)}
              startLine={lines[0]}
              highlight={lines}
              className="rounded-md border py-1.5"
            />
          )}
        </div>
      );
    }
  }
}

/** Beside the conversation on desktop, over it on mobile. Scrolls to the highlighted lines on every open. */
function SourcePanel({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const source = SOURCES[file.path];
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const hit = pre.current?.querySelector("[data-highlight]");
    if (hit) hit.scrollIntoView({ block: "center" });
    else pre.current?.scrollTo(0, 0);
  }, [file]);
  return (
    <aside aria-label={file.path} className="absolute inset-0 flex flex-col bg-background md:static md:w-[min(30rem,40%)] md:shrink-0 md:border-l">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <File className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate font-mono">{file.path}</h2>
        <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Close source" onClick={onClose}>
          <X />
        </Button>
      </header>
      {source ? (
        <CodeLines ref={pre} code={source.code.split("\n")} startLine={source.startLine} highlight={file.lines} className="flex-1 py-4" />
      ) : (
        <p className="m-auto text-muted-foreground">Source not available.</p>
      )}
    </aside>
  );
}

/** Mono code with a line-number gutter. Lines inside `highlight` get the agent highlight: a blue tint and left edge. */
function CodeLines({
  code,
  startLine,
  highlight,
  className,
  ref,
}: {
  code: string[];
  startLine: number;
  highlight?: LineRange;
  className?: string;
  ref?: Ref<HTMLPreElement>;
}) {
  return (
    <pre ref={ref} className={cn("overflow-auto text-xs", className)}>
      {/* w-max: a highlight spans the widest line, not just the visible width. */}
      <code className="block w-max min-w-full">
        {code.map((line, i) => {
          const n = startLine + i;
          const hit = highlight && n >= highlight[0] && n <= highlight[1];
          return (
            <span key={n} data-highlight={hit || undefined} className={cn("block border-l-2 border-transparent pr-4", hit && "border-blue bg-blue/10")}>
              <span className="inline-block w-12 pr-4 text-right text-muted-foreground select-none">{n}</span>
              {line}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
