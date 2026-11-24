import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { reader } from "./db.js";
import { getProject, isIndexedFile } from "./queries.js";
import { resolveInRoot, toProjectRelative } from "./source.js";

/** One entry of an agent's or the Explain chat's transcript, as the web UI renders it. */
export type Turn =
  | { type: "user"; text: string }
  /** A tool call or thinking step; no `durationMs` means it is still running. */
  | { type: "step"; kind: "graph" | "thought"; label: string; durationMs?: number }
  /** Markdown. */
  | { type: "answer"; text: string }
  | { type: "file"; path: string; lines?: [number, number] }
  | { type: "error"; text: string };

export const NO_MODEL = "Set CLAUDE_API_KEY or OLLAMA_MODEL in .env to use agents.";

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 8192;
const MAX_ROUNDS = 20;
const MAX_TOOL_RESULT = 20_000;
const MAX_SHOWN_LINES = 80;
// A wait shorter than this isn't worth a "Thought" row.
const MIN_THOUGHT_MS = 1000;

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const agentsEnabled = () => !!process.env.OLLAMA_MODEL || !!process.env.CLAUDE_API_KEY;

export interface ModelOption {
  name: string;
  /** Runs on Ollama rather than the Anthropic API. */
  local: boolean;
}

/** The models `.env` sets up, the local one first (it's the default). */
export function availableModels(): ModelOption[] {
  const models: ModelOption[] = [];
  if (process.env.OLLAMA_MODEL) models.push({ name: process.env.OLLAMA_MODEL, local: true });
  if (process.env.CLAUDE_API_KEY) models.push({ name: process.env.CLAUDE_MODEL || DEFAULT_MODEL, local: false });
  return models;
}

// Server-wide and in memory: every tab shares it, and a restart goes back to the default.
let chosen: string | undefined;
const current = (): ModelOption | undefined => {
  const models = availableModels();
  return models.find((m) => m.name === chosen) ?? models[0];
};

/** The model agents run on, or null when they're off. */
export const currentModel = () => current()?.name ?? null;

/** Switches the model new runs use; false if `.env` doesn't set it up. */
export function chooseModel(name: string): boolean {
  if (!availableModels().some((m) => m.name === name)) return false;
  chosen = name;
  return true;
}

// The local model goes through Ollama's Anthropic-compatible endpoint (Ollama 0.14+), with the same SDK.
const clients: { local?: Anthropic; claude?: Anthropic } = {};
function llm() {
  const option = current();
  if (!option) throw new Error(NO_MODEL);
  const client = option.local
    ? (clients.local ??= new Anthropic({ baseURL: process.env.OLLAMA_HOST || "http://localhost:11434", apiKey: "ollama" }))
    : (clients.claude ??= new Anthropic({ apiKey: process.env.CLAUDE_API_KEY }));
  return { client, model: option.name };
}

// The same server and command as .mcp.json, so agents see exactly the tools Claude Code does.
let mcp: Promise<{ client: Client; tools: Tool[] }> | undefined;
function codeGraph() {
  mcp ??= (async () => {
    const client = new Client({ name: "atlas", version: "0.1.0" });
    client.onclose = () => (mcp = undefined);
    await client.connect(
      new StdioClientTransport({ command: `${REPO_ROOT}node_modules/.bin/tsx`, args: ["src/mcp.ts"], cwd: REPO_ROOT, stderr: "inherit" }),
    );
    const { tools } = await client.listTools();
    return {
      client,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Tool.InputSchema })),
    };
  })().catch((e) => {
    mcp = undefined;
    throw e;
  });
  return mcp;
}

const SHOW_CODE: Tool = {
  name: "show_code",
  description:
    "Show the user lines of a project file, inline in the conversation right after your text so far, with a link " +
    "that opens the whole file. Use it whenever you point at code, instead of pasting the code into your answer. " +
    `Keep it to the lines that matter (at most ${MAX_SHOWN_LINES}); leave out \`from\` to link the whole file.`,
  input_schema: {
    type: "object",
    properties: {
      file: { type: "string", description: "File path, project-relative or absolute" },
      from: { type: "integer", minimum: 1, description: "First line to show (1-based)" },
      to: { type: "integer", minimum: 1, description: "Last line to show, inclusive (default: from)" },
    },
    required: ["file"],
  },
};

async function systemPrompt(mcpInstructions: string | undefined) {
  const root = (await getProject(reader()).catch(() => undefined))?.root;
  return `You are Atlas, an agent that answers questions about one code base by querying its code graph.
${root ? `The project is at ${root}.` : "No graph is loaded yet: tell the user to run `pnpm graph sync -p <project dir>`."}

${mcpInstructions ?? ""}

How to work:
- Look things up before answering. Don't guess names, files or behavior; use the tools, and get_source to read code.
- Answer in concise markdown: short paragraphs and bullet lists, with symbol names and file paths in inline code. No headings, tables or code blocks.
- Use project-relative paths.
- Show the code you talk about: when the answer rests on a definition or a few lines, call show_code with the file and those lines. It appears in the conversation right after the text you've written so far, so write the sentence that introduces it first, then call it, then continue.`;
}

const STEP_LABELS: Record<string, (a: Record<string, unknown>) => string> = {
  overview: () => "Read the project overview",
  search_symbols: (a) => `Searched symbols for “${a.query}”`,
  find_symbol: (a) => `Found ${a.name}`,
  get_source: (a) => `Read the source of ${a.name}`,
  outline: (a) => `Outlined ${a.file}`,
  references: (a) => `Found references to ${a.name}`,
  callers: (a) => `Found callers of ${a.name}`,
  callees: (a) => `Found what ${a.name} uses`,
  file_dependencies: (a) => `Found what ${a.file} imports`,
  file_dependents: (a) => `Found what imports ${a.file}`,
  tests_for: (a) => `Found tests for ${a.name}`,
  impact: (a) => `Checked the impact of changing ${a.name}`,
  find_notes: (a) => (a.query || a.symbol || a.file ? `Looked for field notes on ${a.query || a.symbol || a.file}` : "Looked for field notes"),
  save_note: (a) => `Saved the field note “${a.topic}”`,
};
const stepLabel = (name: string, input: Record<string, unknown>) => STEP_LABELS[name]?.(input) ?? `Queried code graph (${name})`;

/**
 * The history without thinking blocks before `runStart`. Their signatures are bound to the system prompt and tools
 * they were made with, which change when another project is loaded, and only the current run's tool loop needs them.
 */
const withoutEarlierThinking = (history: MessageParam[], runStart: number): MessageParam[] =>
  history.map((m, i) => {
    if (i >= runStart || m.role !== "assistant" || typeof m.content === "string") return m;
    const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return { ...m, content: content.length > 0 ? content : "(no answer)" };
  });

const truncate = (text: string) =>
  text.length > MAX_TOOL_RESULT ? `${text.slice(0, MAX_TOOL_RESULT)}\n[cut at ${MAX_TOOL_RESULT} characters]` : text;

export interface RunOptions {
  /** The Anthropic conversation so far, ending with the new user message. The run appends to it. */
  history: MessageParam[];
  /** The transcript the run appends turns to and updates in place. */
  turns: Turn[];
  /** Called after every change; `settled` when a turn finished (worth saving), not for streamed text. */
  onChange: (settled: boolean) => void;
  signal?: AbortSignal;
}

/** Runs Claude with the code-graph tools until it answers, adding steps, answers and code to `turns`. */
export async function runAgent({ history, turns, onChange, signal }: RunOptions): Promise<void> {
  const push = <T extends Turn>(turn: T) => (turns.push(turn), turn);
  const runStart = history.length - 1;
  try {
    // Fixed for the whole run, since its thinking blocks only work with the model that made them.
    const { client, model } = llm();
    const graph = await codeGraph();
    const tools = [...graph.tools, SHOW_CODE];
    const system = await systemPrompt(graph.client.getInstructions());

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const started = performance.now();
      const thought = push({ type: "step", kind: "thought", label: "Thinking…" } as Extract<Turn, { type: "step" }>);
      onChange(true);
      const settleThought = () => {
        if (thought.durationMs !== undefined || !turns.includes(thought)) return;
        const elapsed = Math.round(performance.now() - started);
        if (elapsed < MIN_THOUGHT_MS) turns.splice(turns.indexOf(thought), 1);
        else Object.assign(thought, { label: "Thought", durationMs: elapsed });
      };

      let answer: Extract<Turn, { type: "answer" }> | undefined;
      const messages = withoutEarlierThinking(history, runStart);
      const stream = client.messages.stream({ model, max_tokens: MAX_TOKENS, system, tools, messages }, { signal });
      stream.on("text", (delta) => {
        settleThought();
        answer ??= push({ type: "answer", text: "" });
        answer.text += delta;
        onChange(false);
      });
      stream.on("contentBlock", (block) => {
        if (block.type !== "text") return;
        answer = undefined;
        onChange(true);
      });
      const message = await stream.finalMessage();
      settleThought();
      history.push({ role: "assistant", content: message.content });

      const uses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      // A tool call cut off by max_tokens has incomplete input, so it isn't run.
      if (message.stop_reason === "max_tokens") {
        push({ type: "error", text: "The answer was cut off at the length limit." });
        return;
      }
      if (uses.length === 0) {
        if (message.stop_reason === "refusal") push({ type: "error", text: "The model declined to answer." });
        return;
      }
      if (message.stop_reason !== "tool_use") console.warn(`[agent] tool calls with stop reason ${message.stop_reason}`);
      const results: ToolResultBlockParam[] = [];
      for (const use of uses) results.push(await runTool(use, graph.client, push, onChange, signal));
      history.push({ role: "user", content: results });
    }
    push({ type: "error", text: `Stopped after ${MAX_ROUNDS} rounds of tool calls.` });
  } catch (e) {
    if (signal?.aborted) return;
    console.error("[agent]", e);
    push({ type: "error", text: e instanceof Error ? e.message : String(e) });
  } finally {
    dropRunningSteps(turns);
    onChange(true);
  }
}

/** Removes steps that never finished, so nothing keeps spinning once a run has ended. */
export function dropRunningSteps(turns: Turn[]) {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.type === "step" && turn.durationMs === undefined) turns.splice(i, 1);
  }
}

async function runTool(
  use: ToolUseBlock,
  client: Client,
  push: <T extends Turn>(turn: T) => T,
  onChange: (settled: boolean) => void,
  signal?: AbortSignal,
): Promise<ToolResultBlockParam> {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const result = (content: string, isError?: boolean): ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: use.id,
    content: truncate(content),
    ...(isError && { is_error: true }),
  });
  if (use.name === SHOW_CODE.name) {
    const shown = await showCode(input);
    if (typeof shown === "string") return result(shown, true);
    push(shown);
    onChange(true);
    return result("Shown to the user.");
  }

  const step = push({ type: "step", kind: "graph", label: stepLabel(use.name, input) } as Extract<Turn, { type: "step" }>);
  onChange(true);
  const started = performance.now();
  try {
    const res = await client.callTool({ name: use.name, arguments: input }, undefined, { signal });
    const content = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? `[${c.type}]`).join("\n");
    return result(content, !!res.isError);
  } catch (e) {
    return result(`Tool failed: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    step.durationMs = Math.round(performance.now() - started);
    onChange(true);
  }
}

/** The `file` turn for show_code's input, or an error message for the model. */
async function showCode(input: Record<string, unknown>): Promise<Extract<Turn, { type: "file" }> | string> {
  const conn = reader();
  const root = (await getProject(conn))?.root;
  if (!root) return "The graph is not loaded.";
  if (typeof input.file !== "string") return "Expected `file`.";
  const path = toProjectRelative(root, input.file);
  if (!(await isIndexedFile(conn, path))) return `${path} is not in the graph; use a project-relative path from a tool result.`;
  if (input.from === undefined) return { type: "file", path };

  const from = Number(input.from);
  const to = input.to === undefined ? from : Number(input.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return "Expected 1 <= from <= to.";
  if (to - from + 1 > MAX_SHOWN_LINES) return `Show at most ${MAX_SHOWN_LINES} lines; pick the part that matters.`;
  const lineCount = (await readFile(resolveInRoot(root, path), "utf8")).split("\n").length;
  if (from > lineCount) return `${path} has only ${lineCount} lines.`;
  return { type: "file", path, lines: [from, Math.min(to, lineCount)] };
}

/** A short title and one-line description for an agent, from its first prompt. */
export async function nameAgent(prompt: string): Promise<{ title: string; description: string } | undefined> {
  const tool: Tool = {
    name: "name_agent",
    description: "Name the agent that will work on this request.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Sentence case, at most 6 words, no trailing period, e.g. “Investigation into billing logic”" },
        description: { type: "string", description: "One sentence on what the agent will find out" },
      },
      required: ["title", "description"],
    },
  };
  try {
    const { client, model } = llm();
    const message = await client.messages.create({
      model,
      // Room for local models that think before calling the tool.
      max_tokens: 2048,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: `Name an agent for this request about a code base:\n\n${prompt}` }],
    });
    const use = message.content.find((b): b is ToolUseBlock => b.type === "tool_use");
    const { title, description } = (use?.input ?? {}) as Record<string, unknown>;
    return typeof title === "string" && typeof description === "string" ? { title, description } : undefined;
  } catch (e) {
    console.error("[agent] naming failed", e);
    return undefined;
  }
}
