import { Bot, Plus, Search as SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/agent-icon";
import { createAgent, sendMessage, useAgents } from "@/agents-store";
import { type Agent, type FileText, fileUrl, useApi } from "@/api";
import avatar from "@/assets/User.svg";
import { Transcript } from "@/chat";
import { Button } from "@/components/ui/button";
import { ExplainDialog, ExplainTip } from "@/explain";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { fuzzyFilter } from "@/fuzzy";
import { USER } from "@/mock";
import { PromptBox } from "@/prompt-box";
import { type FileRef, SourcePanel } from "@/source";

/** #/agents/new: an empty conversation whose first prompt creates the agent. */
export const NEW = "new";

/** `id` comes from #/agents/<id>; without one the newest agent opens. */
export const findAgent = (agents: Agent[], id?: string) => (id ? agents.find((a) => a.id === id) : agents[0]);

/** Agent list, conversation and source panel. */
export function Agents({ id }: { id?: string }) {
  const { agents: all, loaded } = useAgents();
  const agent = findAgent(all, id);
  const [query, setQuery] = useState("");
  const q = query.trim();
  // shortcut: every agent is the mock USER's until agents have real creators.
  const agents = fuzzyFilter(all, q, (a) => [a.title, a.description, USER.name]);
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="hidden w-80 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-2 border-b p-4">
          <div role="search" className="min-w-0 flex-1">
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
          <Button variant="primary" size="icon" aria-label="Create" asChild>
            <a href={`#/agents/${NEW}`}>
              <Plus />
            </a>
          </Button>
        </div>
        <nav aria-label="Agents" className="flex-1 overflow-y-auto">
          {q && agents.length === 0 && <p className="border-b p-4 text-muted-foreground">No agents match “{q}”.</p>}
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
                  <img src={avatar} alt={`Created by ${USER.name}`} title={`Created by ${USER.name}`} width={12} height={12} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{a.title}</span>
                <span className="mt-1 line-clamp-6">{a.description}</span>
              </span>
            </a>
          ))}
        </nav>
      </div>
      {id === NEW ? (
        <NewConversation />
      ) : agent ? (
        <Conversation key={agent.id} agent={agent} />
      ) : !loaded ? null : all.length === 0 ? (
        <p className="m-auto px-4 text-center text-muted-foreground">
          No agents yet.{" "}
          <a href={`#/agents/${NEW}`} className="text-foreground underline underline-offset-2">
            Start one
          </a>
          .
        </p>
      ) : (
        <p className="m-auto text-muted-foreground">Agent not found.</p>
      )}
    </div>
  );
}

function NewConversation() {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (text: string) => {
    setSending(true);
    setError(undefined);
    try {
      const agent = await createAgent(text);
      // Replaced, so Back skips the empty conversation.
      location.replace(`#/agents/${agent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  };
  return (
    <section aria-label="New agent" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Bot className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate font-medium">New agent</h1>
      </header>
      <p className="m-auto px-4 text-center text-muted-foreground">Ask anything about the code base to start an agent.</p>
      <div className="space-y-2 border-t p-4">
        {error && <p className="text-muted-foreground">{error}</p>}
        <PromptBox value={prompt} onValueChange={setPrompt} onSubmit={send} disabled={sending} className="min-h-10" autoFocus />
      </div>
    </section>
  );
}

function Conversation({ agent }: { agent: Agent }) {
  const [file, setFile] = useState<FileRef | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();
  const [explaining, setExplaining] = useState(false);
  const source = useApi<FileText>(file ? fileUrl(file.path) : null);
  const text = source.data?.text;
  const lines = file?.lines;
  const working = agent.status === "working";

  // Follow the transcript as it grows, unless the user has scrolled up to read.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [agent.turns]);

  const send = async (text: string) => {
    setError(undefined);
    setPrompt("");
    pinned.current = true;
    try {
      await sendMessage(agent.id, text);
    } catch (e) {
      setPrompt(text);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <section aria-label={agent.title} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <AgentIcon status={agent.status} />
          <h1 className="truncate font-medium">{agent.title}</h1>
        </header>
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
          className="flex-1 space-y-4 overflow-y-auto p-4"
        >
          <Transcript turns={agent.turns} onOpenFile={setFile} />
        </div>
        <div className="space-y-2 border-t p-4">
          {error && <p className="text-muted-foreground">{error}</p>}
          <PromptBox value={prompt} onValueChange={setPrompt} onSubmit={send} disabled={working} className="min-h-10" />
        </div>
      </section>
      {file && (
        <SourcePanel
          file={file}
          text={source.error ? null : text}
          highlightAction={lines && text !== undefined && <ExplainTip below={lines[0] === 1} onClick={() => setExplaining(true)} />}
          onClose={() => setFile(null)}
        />
      )}
      {file && lines && text !== undefined && (
        <ExplainDialog open={explaining} onOpenChange={setExplaining} name={file.path.split("/").pop()!} file={file.path} text={text} lines={lines} />
      )}
    </>
  );
}
