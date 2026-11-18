import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { dropRunningSteps, nameAgent, runAgent, type Turn } from "./agent.js";
import { type AgentRecord, AgentsDb } from "./agents-db.js";
import { NOT_LOADED, reader } from "./db.js";
import { getProject, isIndexedFile } from "./queries.js";
import { resolveInRoot } from "./source.js";

/** An agent as the web UI sees it: everything but the Anthropic history. */
export type Agent = Omit<AgentRecord, "history">;

const NOTIFY_MS = 100;
const MAX_TITLE = 60;

const publicAgent = ({ history: _history, ...agent }: AgentRecord): Agent => agent;

let state: { db: AgentsDb; agents: Map<string, AgentRecord> } | undefined;

/** Opens the agents store on first use, and recovers agents a previous server left working. */
function store() {
  if (state) return state;
  const db = AgentsDb.open();
  const agents = new Map(db.load().map((a) => [a.id, a]));
  for (const agent of agents.values()) {
    if (agent.status !== "working") continue;
    settle(agent);
    agent.turns.push({ type: "error", text: "Interrupted: the server stopped while this agent was working." });
    db.save(agent);
  }
  state = { db, agents };
  return state;
}

/**
 * After a run: unfinished steps are gone, the agent is ready, and the history ends on an assistant message without tool
 * calls, so a follow-up is valid. After an interruption or error, unanswered messages and dangling tool calls are
 * dropped; the text Claude already wrote stays (and the transcript keeps everything).
 */
function settle(agent: AgentRecord) {
  dropRunningSteps(agent.turns);
  agent.status = "ready";
  const h = agent.history;
  for (let last = h.at(-1); last; last = h.at(-1)) {
    if (last.role === "assistant") {
      if (typeof last.content === "string" || !last.content.some((b) => b.type === "tool_use")) return;
      const text = last.content.filter((b) => b.type === "text");
      if (text.length > 0) return void (last.content = text);
    }
    h.pop();
  }
}

type Listener = (agent: Agent) => void;
const listeners = new Set<Listener>();
const pending = new Set<string>();
let timer: NodeJS.Timeout | undefined;

/** Streams agent changes, at most one per agent every 100ms. Returns the unsubscribe function. */
export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(agent: AgentRecord) {
  agent.updatedAt = Date.now();
  pending.add(agent.id);
  timer ??= setTimeout(() => {
    timer = undefined;
    for (const id of pending) {
      const changed = state?.agents.get(id);
      if (changed) for (const listener of listeners) listener(publicAgent(changed));
    }
    pending.clear();
  }, NOTIFY_MS);
}

export const listAgents = (): Agent[] => [...store().agents.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicAgent);

async function run(agent: AgentRecord, prompt: string) {
  const { db } = store();
  agent.turns.push({ type: "user", text: prompt });
  agent.history.push({ role: "user", content: prompt });
  agent.status = "working";
  db.save(agent);
  notify(agent);
  try {
    await runAgent({
      history: agent.history,
      turns: agent.turns,
      onChange: (settled) => {
        if (settled) db.save(agent);
        notify(agent);
      },
    });
  } finally {
    settle(agent);
    db.save(agent);
    db.checkpoint();
    notify(agent);
  }
}

/** Creates an agent and starts it on `prompt`. It's named from the prompt until Claude names it. */
export function createAgent(prompt: string): Agent {
  const now = Date.now();
  const title = prompt.length > MAX_TITLE ? `${prompt.slice(0, MAX_TITLE - 1).trimEnd()}…` : prompt;
  const agent: AgentRecord = { id: randomUUID(), title, description: prompt, status: "working", createdAt: now, updatedAt: now, turns: [], history: [] };
  store().agents.set(agent.id, agent);
  void run(agent, prompt);
  void nameAgent(prompt).then((named) => {
    if (!named) return;
    Object.assign(agent, named);
    store().db.save(agent);
    notify(agent);
  });
  return publicAgent(agent);
}

/** Sends a follow-up. `undefined` for an unknown agent, false while it's still working. */
export function sendMessage(id: string, prompt: string): boolean | undefined {
  const agent = store().agents.get(id);
  if (!agent) return undefined;
  if (agent.status === "working") return false;
  void run(agent, prompt);
  return true;
}

export interface ExplainRequest {
  file: string;
  lines: [number, number];
  name?: string;
  /** The chat so far, starting and ending with the user. The first message is about the lines. */
  messages: { role: "user" | "assistant"; text: string }[];
}

const MAX_EXPLAIN_LINES = 400;

/** Checks an /api/explain body. Returns an error message for a bad one. */
export function parseExplain(body: unknown): ExplainRequest | string {
  const b = body as Partial<ExplainRequest> | undefined;
  const lines = b?.lines;
  if (typeof b?.file !== "string") return "Expected a `file`";
  if (!Array.isArray(lines) || lines.length !== 2 || !lines.every(Number.isInteger) || lines[0] < 1 || lines[1] < lines[0]) {
    return "Expected `lines` as [from, to]";
  }
  if (lines[1] - lines[0] >= MAX_EXPLAIN_LINES) return `Explain at most ${MAX_EXPLAIN_LINES} lines`;
  const messages = b.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 100 ||
    !messages.every((m, i) => m && m.role === (i % 2 ? "assistant" : "user") && typeof m.text === "string") ||
    messages.length % 2 === 0
  ) {
    return "Expected `messages` alternating user and assistant, ending with the user";
  }
  return { file: b.file, lines: [lines[0], lines[1]], name: typeof b.name === "string" ? b.name : undefined, messages };
}

/** Runs one reply of the Explain chat. Nothing is kept: the client sends the whole chat each time. */
export async function explain(req: ExplainRequest, onChange: (turns: Turn[]) => void, signal: AbortSignal) {
  const conn = reader();
  const root = (await getProject(conn))?.root;
  if (!root) throw new Error(NOT_LOADED);
  if (!(await isIndexedFile(conn, req.file))) throw new Error(`${req.file} is not in the graph`);
  const [from, to] = req.lines;
  const code = (await readFile(resolveInRoot(root, req.file), "utf8"))
    .split("\n")
    .slice(from - 1, to)
    .map((line, i) => `${from + i}: ${line}`)
    .join("\n");
  const context =
    `The user highlighted lines ${from}-${to} of \`${req.file}\`${req.name ? ` (${req.name})` : ""}. ` +
    `They see these lines already, so don't repeat them with show_code:\n\n${code}\n\n`;
  const history: MessageParam[] = req.messages.map((m, i) => ({
    role: m.role,
    content: i === 0 ? context + m.text : m.text || "(no answer)",
  }));
  const turns: Turn[] = [];
  await runAgent({ history, turns, onChange: () => onChange(turns), signal });
}
