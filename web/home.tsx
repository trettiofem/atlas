import { FolderCode } from "lucide-react";
import { useRef, useState } from "react";
import { type Overview, overviewCounts, useApi } from "@/api";
import logo from "@/assets/LogoLarge.svg";
import { Button } from "@/components/ui/button";
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

export function Home() {
  const [prompt, setPrompt] = useState("");
  const promptBox = useRef<HTMLDivElement>(null);
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
      <Tunnel anchor={promptBox} />
      <div className="relative m-auto flex w-full max-w-lg flex-col items-center px-4 py-16">
        <h1 className="mb-10 flex items-center gap-3 text-2xl font-bold tracking-tight">
          <img src={logo} alt="" width={39} height={27} />
          What’s up?
        </h1>
        <Project />
        <div ref={promptBox} className="w-full">
          <PromptBox
            value={prompt}
            onValueChange={setPrompt}
            // shortcut: the prompt is dropped; create an agent with it here once agents exist.
            onSubmit={() => {
              location.hash = "/agents";
            }}
            className="min-h-20"
            autoFocus
          />
        </div>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s.label} variant="outline" size="sm" onClick={() => fill(s.prompt)}>
              {s.label}
            </Button>
          ))}
        </div>
        <p className="mt-16 font-mono text-xs">Atlas -- Intelligent Code Analysis Platform</p>
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
