import { FolderCode } from "lucide-react";
import { useRef, useState } from "react";
import { createAgent } from "@/agents-store";
import { type Overview, overviewCounts, useApi } from "@/api";
import logo from "@/assets/LogoLarge.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PromptBox } from "@/prompt-box";
import { Tunnel } from "@/tunnel";

// A [bracketed] part is a blank for the user: filling the prompt selects it, so typing replaces it.
const SUGGESTIONS = [
  {
    label: "Explain a module",
    prompt:
      "Explain how the [module name] module works: what it's for, its main entry points, how data flows through it, and which parts of the code base depend on it.",
  },
  {
    label: "Find dead code",
    prompt:
      "Find dead code: functions, types and variables that nothing references. Leave out tests and public entry points, and list each one with its file and line so I can check it before deleting.",
  },
  {
    label: "Find callers",
    prompt:
      "Who calls [function name]? List every caller with its file and line, grouped by module, and point out any that would break if its signature changed.",
  },
];

// The entrance runs top to bottom, one step apart, so the logo lands first.
const INTRO = "motion-safe:animate-intro";
const introDelay = (step: number) => ({ animationDelay: `${step * 80}ms` });

export function Home() {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const promptBox = useRef<HTMLDivElement>(null);
  const send = async (text: string) => {
    setSending(true);
    setError(undefined);
    try {
      const agent = await createAgent(text);
      location.hash = `/agents/${agent.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  };
  const fill = (text: string) => {
    setPrompt(text);
    // After React has written the value into the textarea.
    requestAnimationFrame(() => {
      const textarea = promptBox.current?.querySelector("textarea");
      if (!textarea) return;
      const start = text.indexOf("[");
      textarea.focus();
      if (start < 0) textarea.setSelectionRange(text.length, text.length);
      else textarea.setSelectionRange(start, text.indexOf("]", start) + 1);
    });
  };
  return (
    <div className="relative flex flex-1">
      <Tunnel anchor={promptBox} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000" />
      <div className="relative m-auto flex w-full max-w-lg flex-col items-center px-4 py-16">
        <h1 className="mb-10 flex items-center gap-3 text-2xl font-bold tracking-tight">
          <img src={logo} alt="" width={39} height={27} className={INTRO} style={introDelay(0)} />
          <span className={INTRO} style={introDelay(1)}>
            What’s up?
          </span>
        </h1>
        <div className={cn("w-full", INTRO)} style={introDelay(2)}>
          <Project />
        </div>
        <div ref={promptBox} className="w-full">
          {/* Animated inside the measured box: the tunnel reads its position, transform included. */}
          <div className={INTRO} style={introDelay(3)}>
            <PromptBox
              value={prompt}
              onValueChange={setPrompt}
              onSubmit={send}
              disabled={sending}
              className="min-h-20"
              autoFocus
            />
          </div>
        </div>
        <div className={cn("mt-2.5 flex flex-wrap justify-center gap-2", INTRO)} style={introDelay(4)}>
          {SUGGESTIONS.map((s) => (
            <Button key={s.label} variant="outline" size="sm" onClick={() => fill(s.prompt)}>
              {s.label}
            </Button>
          ))}
        </div>
        {error && <p className="mt-4 text-center text-muted-foreground">{error}</p>}
      </div>
    </div>
  );
}

/** The loaded project's folder name and size, so prompts aren't sent to the wrong code base. */
function Project() {
  const overview = useApi<Overview>("/api/overview");
  const root = overview.data?.project.root;
  const counts = overview.data && overviewCounts(overview.data);
  return (
    // Fixed height, so the prompt box doesn't jump once the overview loads.
    <div className="mb-2 flex h-5 w-full items-center gap-2 px-1">
      {overview.error ? (
        <span className="text-muted-foreground">{overview.error.notLoaded ? "No project loaded." : "Couldn’t reach the graph."}</span>
      ) : (
        root &&
        counts && (
          <>
            <FolderCode className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono font-medium" title={root}>
              {root.split(/[\\/]/).filter(Boolean).pop()}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {counts.files.toLocaleString()} files · {counts.testFiles.toLocaleString()} tests · {counts.symbols.toLocaleString()} symbols
            </span>
          </>
        )
      )}
    </div>
  );
}
