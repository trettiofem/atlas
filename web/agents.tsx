import { ChevronRight, CircleCheck, File, Plus, Search as SearchIcon, Waypoints } from "lucide-react";
import { useState } from "react";
import { AgentIcon } from "@/agent-icon";
import avatar from "@/assets/User.svg";
import { Step, UserMessage } from "@/chat";
import { Button } from "@/components/ui/button";
import { ExplainDialog, ExplainTip } from "@/explain";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { fuzzyFilter } from "@/fuzzy";
import { AGENTS, type Agent, SOURCES, type Turn } from "@/mock";
import { PromptBox } from "@/prompt-box";
import { CodeLines, type FileRef, SourcePanel } from "@/source";

const STEP_ICON = { graph: Waypoints, thought: CircleCheck };

/** `id` comes from #/agents/<id>; without one the first agent opens. */
export const findAgent = (id?: string) => (id ? AGENTS.find((a) => a.id === id) : AGENTS[0]);

/** Agent list, conversation and source panel. */
export function Agents({ id }: { id?: string }) {
  const agent = findAgent(id);
  const [query, setQuery] = useState("");
  const q = query.trim();
  const agents = fuzzyFilter(AGENTS, q, (a) => [a.title, a.description, a.creator.name]);
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="hidden w-62.5 shrink-0 flex-col border-r md:flex">
        <div role="search" className="border-b p-4">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Find an agent"
              placeholder="Find an agent…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              autoComplete="off"
              spellCheck={false}
            />
          </InputGroup>
        </div>
        <nav aria-label="Agents" className="flex-1 overflow-y-auto">
          {agents.length === 0 && <p className="border-b p-4 text-muted-foreground">No agents match “{q}”.</p>}
          {agents.map((a) => (
            <a
              key={a.id}
              href={`#/agents/${a.id}`}
              aria-current={a === agent ? "page" : undefined}
              className="flex gap-2 border-b p-4 hover:bg-accent aria-[current=page]:bg-accent"
            >
              <span className="flex w-4 shrink-0 flex-col items-center">
                <span className="flex h-5 items-center">
                  <AgentIcon status={a.status} />
                </span>
                {/* Level with the description's first line. */}
                <span className="mt-1 flex h-5 items-center">
                  <img src={avatar} alt={`Created by ${a.creator.name}`} title={`Created by ${a.creator.name}`} width={12} height={12} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{a.title}</span>
                <span className="mt-1 line-clamp-6">{a.description}</span>
              </span>
            </a>
          ))}
          <div className="border-b p-4">
            {/* New agents start from a prompt on Home. */}
            <Button variant="primary" className="w-full" asChild>
              <a href="#/">
                <Plus /> Create
              </a>
            </Button>
          </div>
        </nav>
      </div>
      {agent ? <Conversation key={agent.id} agent={agent} /> : <p className="m-auto text-muted-foreground">Agent not found.</p>}
    </div>
  );
}

function Conversation({ agent }: { agent: Agent }) {
  const [file, setFile] = useState<FileRef | null>(null);
  const [prompt, setPrompt] = useState("");
  const [explaining, setExplaining] = useState(false);
  const source = file && SOURCES[file.path];
  const lines = file?.lines;
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
      {file && (
        <SourcePanel
          file={file}
          text={source?.code ?? null}
          startLine={source?.startLine}
          highlightAction={lines && source && <ExplainTip below={lines[0] === source.startLine} onClick={() => setExplaining(true)} />}
          onClose={() => setFile(null)}
        />
      )}
      {file && lines && source && (
        <ExplainDialog
          open={explaining}
          onOpenChange={setExplaining}
          name={file.path.split("/").pop()!}
          file={file.path}
          text={source.code}
          startLine={source.startLine}
          lines={lines}
        />
      )}
    </>
  );
}

function TurnView({ turn, onOpenFile }: { turn: Turn; onOpenFile: (file: FileRef) => void }) {
  switch (turn.type) {
    case "user":
      return <UserMessage>{turn.text}</UserMessage>;
    case "step":
      return <Step icon={STEP_ICON[turn.kind]} label={turn.label} duration={turn.duration} />;
    case "answer":
      return <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-5">{turn.body}</div>;
    case "file": {
      const { path, lines } = turn;
      const source = SOURCES[path];
      return (
        <div className="space-y-1">
          {/* A fresh object per click, so reopening the same reference scrolls back to its lines. */}
          <Button variant="ghost" size="sm" className="-mx-2.5 max-w-full font-mono text-xs font-normal" onClick={() => onOpenFile({ path, lines })}>
            <File className="text-muted-foreground" />
            <span className="truncate">
              {path}
              {lines && `:${lines[0] === lines[1] ? lines[0] : lines.join("-")}`}
            </span>
            <ChevronRight className="text-muted-foreground" />
          </Button>
          {source && lines && (
            <CodeLines
              text={source.code}
              path={path}
              startLine={source.startLine}
              only={lines}
              highlight={lines}
              className="rounded-md border py-1.5"
            />
          )}
        </div>
      );
    }
  }
}
