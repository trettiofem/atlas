import { ArrowRight, Plus } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

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
          <InputGroupButton type="submit" variant="primary" size="icon-sm" className="shadow-raised-primary" aria-label="Send" disabled={blocked}>
            <ArrowRight />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
