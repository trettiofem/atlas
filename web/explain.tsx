import { CircleCheck, File, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/api";
import { Step, Transcript, UserMessage } from "@/chat";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PromptBox } from "@/prompt-box";
import { CodeLines, type LineRange } from "@/source";

/**
 * The "Explain" tip for `CodeLines`' highlightAction: tooltip-styled, shown while the highlight is hovered or the tip
 * has keyboard focus. It sits on top of the highlight, or under it when the highlight starts at the first line (the
 * code's top padding is too short for it there).
 */
export function ExplainTip({ below, onClick }: { below?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute left-12.5 z-10 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 font-sans text-xs font-medium text-background outline-none",
        "pointer-events-none opacity-0 transition-opacity group-hover/highlight:pointer-events-auto group-hover/highlight:opacity-100",
        "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        below ? "top-full" : "bottom-full",
      )}
    >
      <Sparkles className="size-3.5" />
      Explain
      {/* The tooltip arrow, pointing at the highlight. */}
      <span
        aria-hidden
        className={cn("absolute left-4 size-2.5 rotate-45 rounded-[2px] bg-foreground", below ? "bottom-full translate-y-1/2" : "top-full -translate-y-1/2")}
      />
    </button>
  );
}

/** A one-time chat about some lines of a file. Nothing is kept: closing it ends the chat, and it isn't an agent. */
export function ExplainDialog({
  open,
  onOpenChange,
  name,
  file,
  text,
  startLine = 1,
  lines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  file: string;
  /** The file from `startLine` on; `lines` picks the code to explain. */
  text: string;
  startLine?: number;
  lines: LineRange;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(40rem,85svh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* Dialog content unmounts on close, so every open starts a fresh chat. */}
        <ExplainChat name={name} file={file} text={text} startLine={startLine} lines={lines} />
      </DialogContent>
    </Dialog>
  );
}

interface Exchange {
  prompt: string;
  reply: Turn[];
  done: boolean;
}

/** The reply's answer text, as the assistant's side of the chat history sent back with follow-ups. */
const answerText = (reply: Turn[]) =>
  reply
    .filter((t) => t.type === "answer")
    .map((t) => t.text)
    .join("\n\n");

/** POSTs the chat to /api/explain and calls `onTurns` with each NDJSON snapshot of the reply. */
async function streamReply(body: unknown, onTurns: (turns: Turn[]) => void, signal: AbortSignal) {
  const res = await fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const error = await res.json().catch(() => undefined);
    throw new Error(error?.error ?? res.statusText);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    if (lines.length > 0) onTurns(JSON.parse(lines[lines.length - 1]));
  }
}

function ExplainChat({ name, file, text, startLine, lines }: { name: string; file: string; text: string; startLine: number; lines: LineRange }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([{ prompt: "Explain this code", reply: [], done: false }]);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [exchanges]);

  // Each new prompt asks for one reply, sending the chat so far. Closing the dialog unmounts this and aborts it.
  const latest = useRef(exchanges);
  latest.current = exchanges;
  const count = exchanges.length;
  useEffect(() => {
    const abort = new AbortController();
    const i = count - 1;
    const update = (change: (x: Exchange) => Partial<Exchange>) => setExchanges((list) => list.map((x, j) => (j === i ? { ...x, ...change(x) } : x)));
    const messages = latest.current
      .slice(0, i)
      .flatMap((x) => [
        { role: "user", text: x.prompt },
        { role: "assistant", text: answerText(x.reply) },
      ])
      .concat({ role: "user", text: latest.current[i].prompt });
    update(() => ({ reply: [], done: false }));
    streamReply({ file, lines, name, messages }, (reply) => update(() => ({ reply })), abort.signal).then(
      () => update(() => ({ done: true })),
      (e) => {
        if (abort.signal.aborted) return;
        update((x) => ({ done: true, reply: [...x.reply, { type: "error", text: e instanceof Error ? e.message : String(e) }] }));
      },
    );
    return () => abort.abort();
  }, [count, file, lines, name]);
  const answering = !exchanges[count - 1].done;
  return (
    <>
      {/* pr-12 leaves room for the dialog's close button. */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-12 pl-4">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <DialogTitle className="truncate text-sm font-medium">
          Explain <span className="font-mono">{name}</span>
        </DialogTitle>
        <DialogDescription className="sr-only">A one-time chat about the highlighted code. It isn’t saved as an agent.</DialogDescription>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-muted-foreground">
            <File className="size-4 shrink-0" />
            <span className="truncate font-mono">
              {file}:{lines[0] === lines[1] ? lines[0] : lines.join("-")}
            </span>
          </p>
          <CodeLines text={text} path={file} startLine={startLine} only={lines} highlight={lines} className="max-h-60 rounded-md border py-1.5" />
        </div>
        {exchanges.map((x, i) => (
          <div key={i} className="space-y-4">
            <UserMessage>{x.prompt}</UserMessage>
            {x.reply.length === 0 && !x.done && <Step icon={CircleCheck} label="Thinking…" />}
            <Transcript turns={x.reply} />
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="border-t p-4">
        <PromptBox
          value={draft}
          onValueChange={setDraft}
          onSubmit={(prompt) => {
            setExchanges((list) => [...list, { prompt, reply: [], done: false }]);
            setDraft("");
          }}
          disabled={answering}
          className="min-h-10"
          autoFocus
        />
      </div>
    </>
  );
}
