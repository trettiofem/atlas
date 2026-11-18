import { useSyncExternalStore } from "react";
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";

export type { ThemedToken };

/** Extensions Shiki has no alias for. The rest (ts, py, rs, kt…) are Shiki language ids or aliases already. */
const EXTENSIONS: Record<string, string> = { pyi: "python", h: "c", cc: "cpp", cxx: "cpp", hh: "cpp", hpp: "cpp" };

/** Token colors are `var(--syntax-token-*)`, defined in style.css. */
const THEME = createCssVariablesTheme({ name: "atlas", variablePrefix: "--syntax-", fontStyle: false });

let highlighter: Promise<HighlighterCore> | undefined;
const getHighlighter = () =>
  (highlighter ??= createHighlighterCore({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }));

/** Shiki language for a path, from its extension (or its name, as in "Dockerfile"); undefined if Shiki has none. */
export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const lang = EXTENSIONS[ext] ?? ext;
  return lang in bundledLanguages ? lang : undefined;
}

interface Entry {
  ready: Promise<void>;
  /** One token list per line; null if the grammar failed. Unset until `ready`. */
  tokens?: ThemedToken[][] | null;
}

/** Recent files, so reopening one (or a snippet of an open one) doesn't tokenize it again. */
const cache = new Map<string, Entry>();
const CACHE_SIZE = 20;

function tokenize(text: string, lang: string): Entry {
  const key = `${lang}\n${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const entry: Entry = {
    ready: getHighlighter()
      .then(async (h) => {
        await h.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
        // Minified lines would stall the tokenizer; they stay plain.
        entry.tokens = h.codeToTokensBase(text, { lang, theme: THEME.name, tokenizeMaxLineLength: 1000 });
      })
      .catch(() => {
        entry.tokens = null;
      }),
  };
  cache.set(key, entry);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return entry;
}

/** Syntax tokens per line of `text`, or undefined while loading and for unknown languages (show it plain). */
export function useTokens(text: string, path: string | undefined): ThemedToken[][] | undefined {
  const lang = path && languageOf(path);
  const entry = lang ? tokenize(text, lang) : undefined;
  // The cache fills in outside React. An effect misses a result that lands after this render and before the effect.
  const tokens = () => entry?.tokens ?? undefined;
  return useSyncExternalStore(
    (notify) => {
      if (!entry || entry.tokens !== undefined) return () => {};
      let live = true;
      entry.ready.then(() => live && notify());
      return () => {
        live = false;
      };
    },
    tokens,
    tokens,
  );
}
