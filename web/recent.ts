import { useSyncExternalStore } from "react";
import type { SymbolRef } from "@/symbol";

export interface RecentSymbol extends SymbolRef {
  kind: string | null;
}

const KEY = "atlas.recentSymbols";
const CHANGE = "atlas:recent-symbols";
const MAX = 5;

const parse = (raw: string | null): RecentSymbol[] => {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

/** Puts the symbol first in the sidebar's Latest list. */
export function rememberSymbol(symbol: RecentSymbol) {
  const same = (s: RecentSymbol) => s.name === symbol.name && s.file === symbol.file && s.line === symbol.line;
  const list = [symbol, ...parse(localStorage.getItem(KEY)).filter((s) => !same(s))].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(list));
  dispatchEvent(new Event(CHANGE));
}

// useSyncExternalStore compares snapshots by identity, so reparse only when the stored string changes.
let raw: string | null = null;
let snapshot: RecentSymbol[] = [];
const getSnapshot = () => {
  const next = localStorage.getItem(KEY);
  if (next !== raw) [raw, snapshot] = [next, parse(next)];
  return snapshot;
};

// `storage` fires for changes made in other tabs.
const subscribe = (onChange: () => void) => {
  addEventListener(CHANGE, onChange);
  addEventListener("storage", onChange);
  return () => {
    removeEventListener(CHANGE, onChange);
    removeEventListener("storage", onChange);
  };
};

/** The symbols last opened in Search, newest first. */
export const useRecentSymbols = () => useSyncExternalStore(subscribe, getSnapshot);
