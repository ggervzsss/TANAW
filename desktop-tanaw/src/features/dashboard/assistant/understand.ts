import { GRANULARITY_CUES, INTENT_CUES, LANGUAGE_MARKERS, PERIOD_CUES, PERIOD_PRIORITY } from "./lexicon";
import { countPhrase, hasPhrase, tokenize, wordMatches } from "./normalize";
import { CONVERSATION_INTENTS, DATA_INTENTS, type Granularity, type Intent, type Language, type LanguagePreference, type PeriodKey, type Plan } from "./types";
import type { TrendFilter } from "../types/dashboard";

export const PERIOD_FOR_FILTER: Record<TrendFilter, PeriodKey> = { Today: "today", Week: "week", Month: "month" };

/**
 * Each word adds the weight of the strongest single-word cue it matches, so a word
 * matching both "visitors" and, within one edit, "visitor" counts once. Each
 * multi-word phrase adds its weight on top.
 */
export function scoreIntents(words: string[]): Map<Intent, number> {
  const scores = new Map<Intent, number>();
  for (const intent of [...DATA_INTENTS, ...CONVERSATION_INTENTS]) {
    const cues = INTENT_CUES[intent];
    const single = cues.filter(([phrase]) => !phrase.includes(" "));
    let score = 0;
    for (const word of words) score += Math.max(0, ...single.filter(([phrase]) => wordMatches(word, phrase)).map(([, weight]) => weight));
    for (const [phrase, weight] of cues) if (phrase.includes(" ")) score += countPhrase(words, phrase) * weight;
    if (score > 0) scores.set(intent, score);
  }
  return scores;
}

/** ``words`` without the words of any matched phrase, so "past 30 days" is not read as "day". */
export function withoutPhrases(words: string[], phrases: readonly string[]): string[] {
  const used = new Set<number>();
  for (const phrase of phrases) {
    const parts = phrase.split(" ");
    for (let index = 0; index + parts.length <= words.length; index += 1) {
      if (parts.every((part, offset) => wordMatches(words[index + offset], part))) parts.forEach((_, offset) => used.add(index + offset));
    }
  }
  return words.filter((_, index) => !used.has(index));
}

/** The best-scoring data intent; help and greetings win only when no data intent matched. */
export function detectIntent(words: string[]): Intent {
  const scores = scoreIntents(words);
  for (const group of [DATA_INTENTS, CONVERSATION_INTENTS]) {
    let best: Intent | null = null;
    let bestScore = 0;
    for (const intent of group) {
      const score = scores.get(intent) ?? 0;
      if (score > bestScore) {
        best = intent;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return "unknown";
}

export function detectPeriods(words: string[]): PeriodKey[] {
  return PERIOD_PRIORITY.filter((period) => PERIOD_CUES[period].some((cue) => hasPhrase(words, cue)));
}

export function detectGranularity(words: string[]): Granularity {
  const hour = GRANULARITY_CUES.hour.some((cue) => hasPhrase(words, cue));
  const day = GRANULARITY_CUES.day.some((cue) => hasPhrase(words, cue));
  if (hour === day) return null;
  return hour ? "hour" : "day";
}

export function detectLanguage(words: string[], preference: LanguagePreference): Language {
  if (preference !== "auto") return preference;
  // Exact words only: markers are short function words where one edit changes the word.
  const tl = words.filter((word) => LANGUAGE_MARKERS.tl.has(word)).length;
  const en = words.filter((word) => LANGUAGE_MARKERS.en.has(word)).length;
  // Taglish with as many Tagalog as English markers is answered in Tagalog.
  return tl > 0 && tl >= en ? "tl" : "en";
}

/** Turn a question into what to answer, for which period and in which language. */
export function understand(question: string, options: { defaultPeriod: PeriodKey; language: LanguagePreference }): Plan {
  const words = tokenize(question);
  const intent = detectIntent(words);
  const periods = detectPeriods(words);
  let period = periods[0] ?? options.defaultPeriod;
  // "Compare today with yesterday" and "more than yesterday" compare today against yesterday.
  if (intent === "compare" && periods.includes("yesterday") && periods.every((item) => item === "yesterday" || item === "today")) period = "today";
  const periodWords = Object.values(PERIOD_CUES)
    .flat()
    .filter((cue) => cue.includes(" "));
  return {
    question: question.trim(),
    intent,
    period,
    periodStated: periods.length > 0,
    granularity: detectGranularity(withoutPhrases(words, periodWords)),
    language: detectLanguage(words, options.language),
  };
}
