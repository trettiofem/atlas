import { useSyncExternalStore } from "react";
import type { SymbolRef } from "@/symbol";

const MAX = 5;

/** A newest-first list of the last 5 items opened, in localStorage under `key`, for the sidebar's Recent list. */
function recentList<T>(key: string, same: (a: T, b: T) => boolean) {
  const change = `atlas:${key}`;
  const parse = (raw: string | null): T[] => {
    try {
      const list = JSON.parse(raw ?? "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const write = (list: T[]) => {
    localStorage.setItem(key, JSON.stringify(list));
    dispatchEvent(new Event(change));
  };

  // useSyncExternalStore compares snapshots by identity, so reparse only when the stored string changes.
  let raw: string | null = null;
  let snapshot: T[] = [];
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
    /** Puts the item first. */
    remember: (item: T) => write([item, ...parse(localStorage.getItem(key)).filter((x) => !same(x, item))].slice(0, MAX)),
    forget: (item: T) => write(parse(localStorage.getItem(key)).filter((x) => !same(x, item))),
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

const artifacts = recentList<string>("atlas.recentArtifacts", (a, b) => a === b);

export const rememberArtifact = artifacts.remember;

/** Drops a deleted artifact. */
export const forgetArtifact = artifacts.forget;

/** The topics of the artifacts last opened, newest first. */
export const useRecentArtifacts = artifacts.use;
