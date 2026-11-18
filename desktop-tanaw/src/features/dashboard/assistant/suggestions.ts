import type { Language } from "./types";

/** Suggested questions. Each must be understood by ``understand`` (see the unit tests). */
export const SUGGESTIONS: Record<Language, readonly string[]> = {
  en: [
    "How many visitors today?",
    "What was our busiest time today?",
    "Which day had the most visitors this week?",
    "Compare today with yesterday",
    "Give me a summary of this week",
    "Explain my latest report",
  ],
  tl: [
    "Ilan ang bisita ngayong araw?",
    "Anong oras pinaka-busy ngayong araw?",
    "Anong araw pinakamaraming bisita ngayong linggo?",
    "Ikumpara ang ngayong araw sa kahapon",
    "Ano ang buod ngayong linggo?",
    "Ipaliwanag ang huling report",
  ],
};
