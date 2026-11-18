// shortcut: hand-written agents and source for the UI; replace with the agents API once it exists.
import type { ReactNode } from "react";
import type { AgentStatus } from "@/agent-icon";

/** Inclusive, 1-based line numbers in a file. */
export type LineRange = [from: number, to: number];

/** A file the agent points at, optionally at lines it highlights. */
export interface FileRef {
  path: string;
  lines?: LineRange;
}

export type Turn =
  | { type: "user"; text: string }
  /** A tool call or thinking step; no `duration` means it is still running. */
  | { type: "step"; kind: "graph" | "thought"; label: string; duration?: string }
  | { type: "answer"; body: ReactNode }
  | ({ type: "file" } & FileRef);

export interface Agent {
  id: string;
  title: string;
  description: string;
  status: AgentStatus;
  transcript: Turn[];
}

export const AGENTS: Agent[] = [
  {
    id: "billing",
    title: "Investigation into billing logic",
    description:
      "Investigate how billing charges are calculated, identify edge cases and inconsistencies, and recommend fixes to ensure accurate, reliable invoices.",
    status: "ready",
    transcript: [
      { type: "user", text: "What calls the billing ledger reconciliation, and where is it defined?" },
      { type: "step", kind: "graph", label: "Queried code graph", duration: "52ms" },
      { type: "step", kind: "thought", label: "Thought", duration: "2s" },
      {
        type: "answer",
        body: (
          <>
            <p>
              The billing ledger reconciliation is called by <code>runBillingClose()</code> after invoice processing
              completes. It also runs nightly through the <code>billing-ledger-reconciliation</code> scheduled job.
            </p>
            <p>
              The reconciliation logic is defined in <code>reconcileBillingLedger()</code> in{" "}
              <code>src/billing/ledger/reconcile.ts</code>. The callers are:
            </p>
            <ul>
              <li>
                <code>src/billing/close.ts</code> — end-of-cycle billing close.
              </li>
              <li>
                <code>src/jobs/billing-ledger-reconciliation.ts</code> — nightly reconciliation.
              </li>
            </ul>
          </>
        ),
      },
      { type: "file", path: "src/billing/ledger/reconcile.ts" },
      {
        type: "answer",
        body: (
          <p>
            An invoice is flagged when its posted ledger entries don’t add up to the invoice total. Rounding on
            partial refunds is the likeliest source of mismatches:
          </p>
        ),
      },
      { type: "file", path: "src/billing/ledger/reconcile.ts", lines: [19, 22] },
    ],
  },
  {
    id: "engagement",
    title: "Analysis of user engagement",
    description:
      "Analyze user engagement trends, identify key behaviors and drop-off points, and recommend improvements to boost retention and activity.",
    status: "working",
    transcript: [
      { type: "user", text: "Which engagement events fire during signup, and where are they tracked?" },
      { type: "step", kind: "graph", label: "Queried code graph", duration: "140ms" },
      { type: "step", kind: "thought", label: "Thinking…" },
    ],
  },
];

/** Source shown in the side panel, keyed by the paths that `file` turns reference. */
export const SOURCES: Record<string, { startLine: number; code: string }> = {
  "src/billing/ledger/reconcile.ts": {
    startLine: 12,
    code: `export async function reconcileBillingLedger(cycle: BillingCycle): Promise<ReconcileReport> {
  const invoices = await loadInvoices(cycle);
  const entries = await ledger.entriesFor(cycle);
  const mismatches: Mismatch[] = [];

  for (const invoice of invoices) {
    const posted = entries.filter((e) => e.invoiceId === invoice.id);
    const total = posted.reduce((sum, e) => sum + e.amountCents, 0);
    if (total !== invoice.totalCents) {
      mismatches.push({ invoiceId: invoice.id, expected: invoice.totalCents, actual: total });
    }
  }

  await ledger.markReconciled(cycle, mismatches.length === 0);
  return { cycle, checked: invoices.length, mismatches };
}`,
  },
};
