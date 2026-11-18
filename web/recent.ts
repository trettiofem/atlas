import { useSyncExternalStore } from "react";
import type { SymbolRef } from "@/symbol";

/** How many entries the sidebar's Recent list shows, and so how many each kind keeps. */
export const RECENT_LIMIT = 8;

/** `at` is when it was last touched, in milliseconds; entries saved before it existed have none. */
export type Touched<T> = T & { at?: number };

/** A newest-first list of the items last touched, in localStorage under `key`, for the sidebar's Recent list. */
function recentList<T extends object>(key: string, same: (a: T, b: T) => boolean) {
  const change = `atlas:${key}`;
  const parse = (raw: string | null): Touched<T>[] => {
    try {
      const list = JSON.parse(raw ?? "[]");
      return Array.isArray(list) ? list.filter((x) => x && typeof x === "object") : [];
    } catch {
      return [];
    }
  };
  const read = () => parse(localStorage.getItem(key));
  const write = (list: Touched<T>[]) => {
    localStorage.setItem(key, JSON.stringify(list));
    dispatchEvent(new Event(change));
  };

  // useSyncExternalStore compares snapshots by identity, so reparse only when the stored string changes.
  let raw: string | null = null;
  let snapshot: Touched<T>[] = [];
  const getSnapshot = () => {
    const next = localStorage.getItem(key);
    if (next !== raw) [raw, snapshot] = [next, parse(next)];
    return snapshot;
  };

  // `storage` fires for changes made in other tabs.
  const subscribe = (onChange: () => void) => {
    addEventListener(change, onChange);
    addEventListener("storage", onChange);
    return () => {
      removeEventListener(change, onChange);
      removeEventListener("storage", onChange);
    };
  };

  return {
    /** Puts the item first, touched now. */
    remember: (item: T) => write([{ ...item, at: Date.now() }, ...read().filter((x) => !same(x, item))].slice(0, RECENT_LIMIT)),
    forget: (item: T) => write(read().filter((x) => !same(x, item))),
    use: () => useSyncExternalStore(subscribe, getSnapshot),
  };
}

export interface RecentSymbol extends SymbolRef {
  kind: string | null;
}

const symbols = recentList<RecentSymbol>("atlas.recentSymbols", (a, b) => a.name === b.name && a.file === b.file && a.line === b.line);

export const rememberSymbol = symbols.remember;

/** The symbols last opened in Search, newest first. */
export const useRecentSymbols = symbols.use;

const artifacts = recentList<{ topic: string }>("atlas.recentArtifacts", (a, b) => a.topic === b.topic);

export const rememberArtifact = (topic: string) => artifacts.remember({ topic });

/** Drops a deleted artifact. */
export const forgetArtifact = (topic: string) => artifacts.forget({ topic });

/** The artifacts last opened, newest first. */
export const useRecentArtifacts = artifacts.use;

const agents = recentList<{ id: string }>("atlas.recentAgents", (a, b) => a.id === b.id);

/** When the user opens an agent or sends it a message. */
export const rememberAgent = (id: string) => agents.remember({ id });

/** The agents last opened or messaged, newest first. */
export const useRecentAgents = agents.use;
