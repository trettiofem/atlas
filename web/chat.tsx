import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A user's message: a right-aligned raised bubble. */
export function UserMessage({ children }: { children: ReactNode }) {
  return <p className="ml-auto w-fit max-w-[80%] rounded-md border px-2.5 py-1.5 whitespace-pre-wrap shadow-raised">{children}</p>;
}

/** A tool call or thinking step, e.g. "Queried code graph · 52ms". Without a `duration` it is still running. */
export function Step({ icon, label, duration }: { icon: LucideIcon; label: string; duration?: string }) {
  const Icon = duration ? icon : LoaderCircle;
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Icon className={cn("size-4 shrink-0", !duration && "motion-safe:animate-spin")} />
      {label}
      {duration && ` · ${duration}`}
    </p>
  );
}
