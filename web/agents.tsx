import { Bot, Plus, Search as SearchIcon, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/agent-icon";
import { createAgent, deleteAgent, sendMessage, useAgents } from "@/agents-store";
import { type Agent, type FileText, fileUrl, useApi } from "@/api";
import avatar from "@/assets/User.svg";
import { Transcript } from "@/chat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExplainDialog, ExplainTip } from "@/explain";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { fuzzyFilter } from "@/fuzzy";
import { USER } from "@/mock";
import { PromptBox } from "@/prompt-box";
import { rememberAgent } from "@/recent";
import { type FileRef, SourcePanel } from "@/source";

/** #/agents/new: an empty conversation whose first prompt creates the agent. */
export const NEW = "new";

/** `id` comes from #/agents/<id>; without one the newest agent opens. */
export const findAgent = (agents: Agent[], id?: string) => (id ? agents.find((a) => a.id === id) : agents[0]);

/** Agent list, conversation and source panel. */
export function Agents({ id }: { id?: string }) {
  const { agents: all, loaded } = useAgents();
  const agent = findAgent(all, id);
  // Only agents the user picked, not the newest opened by default.
  const opened = id && agent ? agent.id : undefined;
  useEffect(() => {
    if (opened) rememberAgent(opened);
  }, [opened]);
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
              {a.named ? (
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.title}</span>
                  <span className="mt-1 line-clamp-6">{a.description}</span>
                </span>
              ) : (
                <div className="min-w-0 flex-1">
                  <span className="sr-only">{a.title}</span>
                  <SkeletonLine className="h-4 w-3/4" />
                  <div className="mt-1">
                    <SkeletonLine className="w-full" />
                    <SkeletonLine className="w-2/3" />
                  </div>
                </div>
              )}
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

/** A line of text while the agent is being named, on any background (`bg-accent` vanishes on the open agent's row). */
function SkeletonLine({ className }: { className?: string }) {
  return (
    <div aria-hidden className="flex h-5 items-center">
      <Skeleton className={cn("h-3.5 bg-border", className)} />
    </div>
  );
}

/** The header's delete button, which asks first. */
function DeleteAgent({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setDeleting(true);
    setError(undefined);
    try {
      await deleteAgent(agent.id);
      // Replaced, so Back skips the deleted agent.
      location.replace("#/agents");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" aria-label="Delete agent" onClick={() => setOpen(true)}>
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Delete agent</TooltipContent>
      </Tooltip>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-bold tracking-tight">Delete this agent?</DialogTitle>
          <DialogDescription>
            “{agent.title}” and its conversation will be gone for good.
            {agent.status === "working" && " It’s still working, so this stops it."}
          </DialogDescription>
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
    rememberAgent(agent.id);
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
        <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
          <AgentIcon status={agent.status} />
          <h1 className={agent.named ? "truncate font-medium" : "sr-only"}>{agent.title}</h1>
          {!agent.named && <SkeletonLine className="h-4 w-48" />}
          <DeleteAgent agent={agent} />
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
