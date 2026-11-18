/** Spelling variants and common chat shorthand, mapped to one lexicon form. */
const VARIANTS: Record<string, string> = {
  bc: "busy",
  bz: "busy",
  bizy: "busy",
  ngayong: "ngayon",
  ngaun: "ngayon",
  ngyon: "ngayon",
  nyon: "ngayon",
  ilang: "ilan",
  ilng: "ilan",
  maraming: "marami",
  madaming: "marami",
  madami: "marami",
  dami: "marami",
  rami: "marami",
  bumisita: "bisita",
  bisitang: "bisita",
  bisitante: "bisita",
  taong: "tao",
  anung: "anong",
  orasan: "oras",
  arawan: "araw",
  kahapong: "kahapon",
  lingo: "linggo",
  buwang: "buwan",
  ung: "yung",
  yong: "yung",
  pls: "please",
  plz: "please",
  u: "you",
  ur: "your",
  r: "are",
  tnx: "thanks",
  thx: "thanks",
  ty: "thanks",
  hlo: "hello",
  helo: "hello",
  musta: "kumusta",
  kamusta: "kumusta",
  kmusta: "kumusta",
  todays: "today",
  "2day": "today",
  tdy: "today",
  ystrdy: "yesterday",
  yday: "yesterday",
  wk: "week",
  vs: "versus",
};

/** Tagalog superlative prefix, for example "pinakamarami", "pinakang busy" and "pinaka-busy". */
const SUPERLATIVE = /^pinaka(?:ng)?(.*)$/;
/** Tagalog "please" prefix: "pakibuod" asks for a "buod" (summary). */
const REQUEST = /^paki(?:ng)?([a-z]{3,})$/;

/**
 * Lower-case, strip accents and punctuation, split the superlative prefix and map
 * spelling variants. Returns the question's words.
 */
export function tokenize(question: string): string[] {
  const plain = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
  const words: string[] = [];
  for (const raw of plain.split(/\s+/)) {
    if (!raw) continue;
    const request = REQUEST.exec(raw);
    const base = request ? request[1] : raw;
    const mapped = VARIANTS[base] ?? base;
    for (const word of mapped.split(" ")) {
      const superlative = SUPERLATIVE.exec(word);
      if (superlative) {
        words.push("pinaka");
        const rest = superlative[1];
        if (rest) words.push(VARIANTS[rest] ?? rest);
      } else {
        words.push(word);
      }
    }
  }
  return words;
}

/**
 * Edit distance counting insertions, deletions, substitutions and swaps of two
 * neighbouring letters ("busiset" is one edit from "busiest"). Stops early once it
 * exceeds ``limit``.
 */
export function editDistance(a: string, b: string, limit = 1): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, index) => index)];
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/** Real words one edit away from a lexicon word, which must not be read as that word. */
const NEAR_MISSES = new Set(["malaki", "house", "mouth", "lingon"]);

/** A word matches a lexicon word exactly, or within one edit when both have five or more letters. */
export function wordMatches(word: string, target: string): boolean {
  if (word === target) return true;
  if (word.length < 5 || target.length < 5 || NEAR_MISSES.has(word)) return false;
  return editDistance(word, target, 1) <= 1;
}

/** Number of times a phrase of one or more words occurs in ``words``, as whole words. */
export function countPhrase(words: string[], phrase: string): number {
  const parts = phrase.split(" ");
  let count = 0;
  for (let index = 0; index + parts.length <= words.length; index += 1) {
    if (parts.every((part, offset) => wordMatches(words[index + offset], part))) count += 1;
  }
  return count;
}

export function hasPhrase(words: string[], phrase: string): boolean {
  return countPhrase(words, phrase) > 0;
}
