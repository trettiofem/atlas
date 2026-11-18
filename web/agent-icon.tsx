import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStatus = "ready" | "working";

const STATUS_DOT: Record<AgentStatus, string> = { ready: "bg-blue", working: "bg-salmon" };

/** Bot icon with a dot for the agent's state: blue is ready for a prompt, salmon is working. */
export function AgentIcon({ status }: { status: AgentStatus }) {
  return (
    <span className="relative shrink-0">
      <Bot className="size-4 text-muted-foreground" />
      <span className={cn("absolute -top-0.5 -right-0.5 size-1.5 rounded-full", STATUS_DOT[status])} />
      <span className="sr-only">{status}</span>
    </span>
  );
}
