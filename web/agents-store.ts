import { useSyncExternalStore } from "react";
import { type Agent, fetchJson } from "@/api";

// Every agent, kept live by one EventSource on /api/agents/events: a snapshot on (re)connect, then each change.
let agents: Agent[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let source: EventSource | undefined;

const emit = () => listeners.forEach((l) => l());

function connect() {
  source = new EventSource("/api/agents/events");
  source.addEventListener("snapshot", (e) => {
    agents = JSON.parse(e.data);
    loaded = true;
    emit();
  });
  source.addEventListener("agent", (e) => upsert(JSON.parse(e.data)));
  source.addEventListener("delete", (e) => remove(JSON.parse(e.data).id));
}

function remove(id: string) {
  if (!agents.some((a) => a.id === id)) return;
  agents = agents.filter((a) => a.id !== id);
  emit();
}

function upsert(agent: Agent) {
  if ((agents.find((a) => a.id === agent.id)?.updatedAt ?? -1) > agent.updatedAt) return;
  const rest = agents.filter((a) => a.id !== agent.id);
  agents = [agent, ...rest].sort((a, b) => b.createdAt - a.createdAt);
  emit();
}

function subscribe(listener: () => void) {
  if (!source) connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every agent, newest first; `loaded` turns true with the first snapshot. */
export function useAgents() {
  const list = useSyncExternalStore(subscribe, () => agents);
  const ready = useSyncExternalStore(subscribe, () => loaded);
  return { agents: list, loaded: ready };
}

/** Starts an agent on `prompt` and returns it. */
export async function createAgent(prompt: string): Promise<Agent> {
  const agent = await fetchJson<Agent>("/api/agents", { body: { prompt } });
  // Shown right away, before the stream catches up.
  upsert(agent);
  return agent;
}

/** Deletes an agent, stopping it if it's working. */
export async function deleteAgent(id: string) {
  await fetchJson(`/api/agents/${id}`, { method: "DELETE" });
  remove(id);
}

export const sendMessage = (id: string, prompt: string) => fetchJson(`/api/agents/${id}/messages`, { body: { prompt } });
