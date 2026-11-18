const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Edits (insert, delete, substitute) to turn a into b. */
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

const isSubsequence = (q: string, word: string) => {
  let i = 0;
  for (const c of word) if (c === q[i]) i++;
  return i === q.length;
};

/** 3 for a prefix, 2 inside the word, 1 with letters missing or a typo or two, 0 for no match. */
function wordScore(q: string, word: string) {
  if (word.startsWith(q)) return 3;
  if (word.includes(q)) return 2;
  if (q.length < 3 || q[0] !== word[0]) return 0;
  if (isSubsequence(q, word)) return 1;
  const typos = q.length < 7 ? 1 : 2;
  // The word's start too, so a half-typed word can have a typo.
  return Math.min(distance(q, word), distance(q, word.slice(0, q.length))) <= typos ? 1 : 0;
}

/**
 * The items that match every word of `query`, best first. `fields` gives each item's text,
 * most important first: a match in an earlier field ranks higher.
 */
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  const qs = words(query);
  if (qs.length === 0) return items;
  const scored = items.map((item) => {
    const texts = fields(item).map(words);
    let total = 0;
    for (const q of qs) {
      const best = Math.max(0, ...texts.flatMap((ws, i) => ws.map((w) => wordScore(q, w) * (texts.length - i))));
      if (best === 0) return { item, total: 0 };
      total += best;
    }
    return { item, total };
  });
  return scored.filter((s) => s.total > 0).sort((a, b) => b.total - a.total).map((s) => s.item);
}
