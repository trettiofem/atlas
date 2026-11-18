import { CircleCheck, File, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Step, UserMessage } from "@/chat";
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

function ExplainChat({ name, file, text, startLine, lines }: { name: string; file: string; text: string; startLine: number; lines: LineRange }) {
  const [prompts, setPrompts] = useState(["Explain this code"]);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [prompts]);
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
        {prompts.map((prompt, i) => (
          <UserMessage key={i}>{prompt}</UserMessage>
        ))}
        {/* shortcut: nothing answers until a chat backend exists, so the chat keeps thinking. */}
        <Step icon={CircleCheck} label="Thinking…" />
        <div ref={end} />
      </div>
      <div className="border-t p-4">
        <PromptBox
          value={draft}
          onValueChange={setDraft}
          onSubmit={(prompt) => {
            setPrompts((list) => [...list, prompt]);
            setDraft("");
          }}
          className="min-h-10"
          autoFocus
        />
      </div>
    </>
  );
}
