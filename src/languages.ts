/**
 * Per-language conventions the SCIP index doesn't carry: how to recognize test files, and which descriptor
 * kinds are noise. Keys are lowercase SCIP `Language` names (`Document.language`, compared case-insensitively).
 */
export interface LanguageRules {
  /** Matched against the project-relative path. */
  tests: RegExp[];
  /** Drop `Meta` symbols. scip-typescript uses them for anonymous type-literal members. */
  dropMeta?: boolean;
}

const JS_TESTS = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)__tests__\//];

const RULES: Record<string, LanguageRules> = {
  typescript: { tests: JS_TESTS, dropMeta: true },
  typescriptreact: { tests: JS_TESTS, dropMeta: true },
  javascript: { tests: JS_TESTS, dropMeta: true },
  javascriptreact: { tests: JS_TESTS, dropMeta: true },
  python: { tests: [/(^|\/)test_[^/]*\.py$/, /_test\.py$/, /(^|\/)conftest\.py$/, /(^|\/)tests?\//] },
  go: { tests: [/_test\.go$/] },
  java: { tests: [/(^|\/)src\/test\//, /Tests?\.java$/] },
  kotlin: { tests: [/(^|\/)src\/test\//, /Tests?\.kt$/] },
  scala: { tests: [/(^|\/)src\/test\//, /(Test|Spec|Suite)\.scala$/] },
  // Inline `#[cfg(test)]` modules can't be detected from the path.
  rust: { tests: [/(^|\/)tests\//] },
  ruby: { tests: [/_(spec|test)\.rb$/, /(^|\/)(spec|test)\//] },
  csharp: { tests: [/Tests?\.cs$/, /(^|\/)[^/]*\.Tests?\//] },
};

const DEFAULT_RULES: LanguageRules = {
  tests: [/(^|\/)(tests?|__tests__|spec)\//, /[._-](test|spec)\.[^/.]+$/],
};

/** Source extensions, for documents whose indexer leaves `Document.language` empty (scip-typescript does). */
const EXTENSIONS: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  py: "python", pyi: "python",
  go: "go",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  rs: "rust",
  rb: "ruby",
  cs: "csharp",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hh: "cpp", hpp: "cpp",
  php: "php", swift: "swift", dart: "dart",
};

const extensionOf = (name: string) => /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase();

/** True when `name` ends in a known source-file extension, e.g. "a.ts" or "index.d.ts". */
export const isSourceFileName = (name: string) => {
  const ext = extensionOf(name);
  return ext !== undefined && ext in EXTENSIONS;
};

/** Lowercase language name, from `Document.language` or else the file extension; undefined if unknown. */
export function languageOf(path: string, declared?: string): string | undefined {
  if (declared) return declared.toLowerCase();
  const ext = extensionOf(path);
  return ext ? EXTENSIONS[ext] : undefined;
}

export const rulesFor = (language: string | undefined): LanguageRules =>
  (language && RULES[language]) || DEFAULT_RULES;
