import { useState } from "react";
import logo from "@/assets/LogoLarge.svg";
import { Button } from "@/components/ui/button";
import { PromptBox } from "@/prompt-box";

const SUGGESTIONS = ["Explain a module", "Find dead code", "Find callers"];

export function Home() {
  const [prompt, setPrompt] = useState("");
  return (
    <div className="m-auto flex w-full max-w-lg flex-col items-center px-4 py-16">
      <h1 className="mb-14 flex items-center gap-3 text-2xl font-bold tracking-tight">
        <img src={logo} alt="" width={39} height={27} />
        What’s up?
      </h1>
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
      <div className="mt-2.5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <Button key={s} variant="outline" size="sm" onClick={() => setPrompt(s)}>
            {s}
          </Button>
        ))}
      </div>
      <p className="mt-16 font-mono text-xs">Atlas -- Intelligent Code Analysis Platform</p>
    </div>
  );
}
