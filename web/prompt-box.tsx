import { ArrowUp, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { fetchJson, type ModelInfo, useApi } from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** The model agents run on, and a switcher when `.env` sets up both a local model and Claude. */
function ModelPicker() {
  const fetched = useApi<ModelInfo>("/api/model").data;
  const [switched, setSwitched] = useState<ModelInfo>();
  const info = switched ?? fetched;
  if (!info?.model) return null;
  if (info.models.length < 2) {
    return (
      <span className="truncate font-mono text-xs font-normal" title={`Model: ${info.model}`}>
        {info.model}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 font-mono text-xs font-normal text-muted-foreground" title="Change model">
          <span className="truncate">{info.model}</span>
          <ChevronsUpDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={info.model}
          onValueChange={(model) =>
            fetchJson<ModelInfo>("/api/model", { body: { model } }).then(setSwitched, (e) => console.error("[model]", e))
          }
        >
          {info.models.map((m) => (
            <DropdownMenuRadioItem key={m.name} value={m.name}>
              <span className="font-mono text-xs">{m.name}</span>
              <span className="ml-auto pl-4 text-xs text-muted-foreground">{m.local ? "Local" : "Claude"}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The "Ask me anything" box on Home and under an agent's conversation. `className` sizes the textarea. `disabled`
 * only blocks sending (while an answer is on its way), so the next prompt can be drafted.
 */
export function PromptBox({
  value,
  onValueChange,
  onSubmit,
  disabled,
  className,
  autoFocus,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const blocked = disabled || !value.trim();
  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) onSubmit(value.trim());
      }}
    >
      <InputGroup className="rounded-xl">
        <InputGroupTextarea
          aria-label="Prompt"
          placeholder="Ask me anything about the code base…"
          className={cn("max-h-48", className)}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter adds a line; IME composition keeps its own Enter.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          autoFocus={autoFocus}
        />
        <InputGroupAddon align="block-end" className="justify-between">
          {/* shortcut: does nothing yet; will attach symbols or files as context. */}
          <InputGroupButton variant="outline" size="icon-sm" className="shadow-raised" aria-label="Add context">
            <Plus />
          </InputGroupButton>
          <div className="flex min-w-0 items-center gap-3">
            <ModelPicker />
            <InputGroupButton type="submit" variant="primary" size="icon-sm" className="shadow-raised-primary" aria-label="Send" disabled={blocked}>
              <ArrowUp />
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
