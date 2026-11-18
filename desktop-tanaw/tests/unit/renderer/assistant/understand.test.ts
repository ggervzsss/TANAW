import { describe, expect, it } from "vitest";
import { SUGGESTIONS } from "../../../../src/features/dashboard/assistant/suggestions";
import { understand } from "../../../../src/features/dashboard/assistant/understand";
import type { Granularity, Intent, Language, PeriodKey } from "../../../../src/features/dashboard/assistant/types";

type Case = [question: string, intent: Intent, period: PeriodKey, language: Language, granularity?: Granularity];

/**
 * Real ways people ask, in English, Tagalog and Taglish, with typos. The default
 * period is "week", so a case expecting "week" without naming it tests the fallback.
 * Add any question the assistant misreads here.
 */
const CORPUS: Case[] = [
  // Busiest time or day
  ["Pinakang busy ng establishement today?", "busiest", "today", "tl"],
  ["pinakamaraming bisita", "busiest", "week", "tl"],
  ["Pinakamaraming bisita ngayong araw?", "busiest", "today", "tl"],
  ["Anong oras pinaka-busy ngayong araw?", "busiest", "today", "tl"],
  ["anong oras pinakabusy kahapon", "busiest", "yesterday", "tl", "hour"],
  ["Anong araw pinakamaraming bisita ngayong linggo?", "busiest", "week", "tl", "day"],
  ["kailan pinaka maraming tao ngayong buwan", "busiest", "month", "tl"],
  ["kelan pinaka bc ngayon?", "busiest", "today", "tl"],
  ["siksikan ba kanina?", "busiest", "today", "tl"],
  ["anong oras dagsa ang tao?", "busiest", "week", "tl", "hour"],
  ["pinaka matao na araw this week", "busiest", "week", "tl", "day"],
  ["What was our busiest time today?", "busiest", "today", "en", "hour"],
  ["When are our busiest hours?", "busiest", "week", "en", "hour"],
  ["Which day had the most visitors this week?", "busiest", "week", "en", "day"],
  ["What was the peak hour yesterday?", "busiest", "yesterday", "en", "hour"],
  ["busiest day this month", "busiest", "month", "en", "day"],
  ["most crowded time in the past 30 days", "busiest", "month", "en", "hour"],
  ["What's the peak occupancy today?", "busiest", "today", "en"],
  ["what time do we get the most people", "busiest", "week", "en", "hour"],
  ["busiset hour tdy", "busiest", "today", "en", "hour"],
  ["When is it most crowded?", "busiest", "week", "en"],
  ["pinakamaraming tao sa loob kahapon", "busiest", "yesterday", "tl"],
  // Visitors
  ["How many visitors today?", "visitors", "today", "en"],
  ["How many visitors did we have yesterday?", "visitors", "yesterday", "en"],
  ["total visitors this month", "visitors", "month", "en"],
  ["how many people came this week", "visitors", "week", "en"],
  ["How many visotors so far?", "visitors", "today", "en"],
  ["visitor count last week", "visitors", "week", "en"],
  ["How many tourists visited today?", "visitors", "today", "en"],
  ["Ilan ang bisita ngayong araw?", "visitors", "today", "tl"],
  ["ilang bisita kahapon?", "visitors", "yesterday", "tl"],
  ["ilan ang dumating ngayon?", "visitors", "today", "tl"],
  ["ilang tao ang bumisita ngayong linggo", "visitors", "week", "tl"],
  ["kabuuang bisita ngayong buwan", "visitors", "month", "tl"],
  ["ilan po ang turista kahapon", "visitors", "yesterday", "tl"],
  ["Ilan ang visitors today?", "visitors", "today", "tl"],
  ["ilang bisita sa nakaraang 7 araw", "visitors", "week", "tl"],
  // People inside now
  ["How many people are inside right now?", "occupancy_now", "week", "en"],
  ["Who is currently inside?", "occupancy_now", "week", "en"],
  ["current occupancy", "occupancy_now", "week", "en"],
  ["ilan ang tao sa loob ngayon?", "occupancy_now", "today", "tl"],
  ["Ilan ang nasa loob?", "occupancy_now", "week", "tl"],
  ["ilan ang kasalukuyang nasa loob", "occupancy_now", "week", "tl"],
  ["how many people inside at the moment", "occupancy_now", "week", "en"],
  // Entries and exits
  ["How many entries today?", "movement", "today", "en"],
  ["entries and exits yesterday", "movement", "yesterday", "en"],
  ["How many people came in this week?", "movement", "week", "en"],
  ["how many exits this month", "movement", "month", "en"],
  ["ilan ang pumasok ngayon?", "movement", "today", "tl"],
  ["ilan ang lumabas kahapon", "movement", "yesterday", "tl"],
  ["ilan ang pumasok at lumabas ngayong linggo", "movement", "week", "tl"],
  // Male and female
  ["How many male and female visitors today?", "sex", "today", "en"],
  ["men vs women this week", "sex", "week", "en"],
  ["gender breakdown this month", "sex", "month", "en"],
  ["Ilan ang lalaki at babae ngayon?", "sex", "today", "tl"],
  ["ilang babae ang bisita kahapon", "sex", "yesterday", "tl"],
  ["kasarian ng mga bisita ngayong linggo", "sex", "week", "tl"],
  // Comparisons
  ["Compare today with yesterday", "compare", "today", "en"],
  ["compare this week with last week", "compare", "week", "en"],
  ["Did visitors increase this month?", "compare", "month", "en"],
  ["Are there more visitors than yesterday?", "compare", "today", "en"],
  ["did we drop compared to last week", "compare", "week", "en"],
  ["Ikumpara ang ngayong araw sa kahapon", "compare", "today", "tl"],
  ["mas marami ba ang bisita ngayon kaysa kahapon?", "compare", "today", "tl"],
  ["tumaas ba ang bisita ngayong linggo?", "compare", "week", "tl"],
  ["bumaba ba ang bisita ngayong buwan", "compare", "month", "tl"],
  ["kumpara sa kahapon, ilan ang bisita ngayon?", "compare", "today", "tl"],
  // Reports
  ["Explain my latest report", "report", "week", "en"],
  ["Explain my latest visitor report", "report", "week", "en"],
  ["Tell me about my reports", "report", "week", "en"],
  ["what's the status of my monthly submission", "report", "week", "en"],
  ["Did I submit the DOT report?", "report", "week", "en"],
  ["Ipaliwanag ang huling report", "report", "week", "tl"],
  ["ano ang huling ulat?", "report", "week", "tl"],
  ["naipasa na ba ang report?", "report", "week", "tl"],
  // Coverage and accuracy
  ["How accurate are these counts?", "coverage", "week", "en"],
  ["Is today's data reliable?", "coverage", "today", "en"],
  ["What's the camera coverage this week?", "coverage", "week", "en"],
  ["are any cameras offline", "coverage", "week", "en"],
  ["tumpak ba ang bilang ngayon?", "coverage", "today", "tl"],
  ["sigurado ba ang bilang kahapon?", "coverage", "yesterday", "tl"],
  // Summaries and insights
  ["What insights can you give me?", "summary", "week", "en"],
  ["Analyze visitor trends", "summary", "week", "en"],
  ["Give me a summary of this week", "summary", "week", "en"],
  ["how are we doing today", "summary", "today", "en"],
  ["overview of the past 30 days", "summary", "month", "en"],
  ["How was yesterday?", "summary", "yesterday", "en"],
  ["Ano ang buod ngayong linggo?", "summary", "week", "tl"],
  ["kumusta ang bisita ngayon?", "summary", "today", "tl"],
  ["ano ang lagay ng establishment ngayong araw", "summary", "today", "tl"],
  ["pakibuod ang nakaraang buwan", "summary", "month", "tl"],
  // Help, greetings, thanks
  ["What can you do?", "help", "week", "en"],
  ["help", "help", "week", "en"],
  ["what can I ask you", "help", "week", "en"],
  ["ano ang kaya mo?", "help", "week", "tl"],
  ["tulong po", "help", "week", "tl"],
  ["Hi", "greeting", "week", "en"],
  ["Hello there!", "greeting", "week", "en"],
  ["Good morning", "greeting", "week", "en"],
  ["Thanks!", "greeting", "week", "en"],
  ["Thank you so much", "greeting", "week", "en"],
  ["Magandang umaga po", "greeting", "week", "tl"],
  ["Salamat po", "greeting", "week", "tl"],
  ["kumusta", "greeting", "week", "tl"],
  ["Hi, how many visitors today?", "visitors", "today", "en"],
  // Not answerable, and words that only look like cues
  ["What's the weather like?", "unknown", "week", "en"],
  ["Can you book a table?", "unknown", "week", "en"],
  ["Malaki ba ang lugar?", "unknown", "week", "tl"],
  ["How do I reset my account password?", "unknown", "week", "en"],
  ["central plaza directions", "unknown", "week", "en"],
  ["Sino ang may-ari?", "unknown", "week", "tl"],
];

describe("understanding questions", () => {
  it("has a large mixed-language corpus", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(100);
    expect(CORPUS.filter(([, , , language]) => language === "tl").length).toBeGreaterThanOrEqual(40);
  });

  it("reads every corpus question correctly", () => {
    const misread = CORPUS.flatMap(([question, intent, period, language, granularity]) => {
      const plan = understand(question, { defaultPeriod: "week", language: "auto" });
      const expected = { intent, period, language, ...(granularity !== undefined ? { granularity } : {}) };
      const actual = { intent: plan.intent, period: plan.period, language: plan.language, ...(granularity !== undefined ? { granularity: plan.granularity } : {}) };
      return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [{ question, expected, actual }];
    });
    const accuracy = Math.round(((CORPUS.length - misread.length) / CORPUS.length) * 1000) / 10;
    expect({ accuracy, misread }).toEqual({ accuracy: 100, misread: [] });
  });

  it("understands every suggested question in both languages", () => {
    for (const language of ["en", "tl"] as const) {
      for (const question of SUGGESTIONS[language]) {
        const plan = understand(question, { defaultPeriod: "today", language: "auto" });
        expect(plan.intent, question).not.toBe("unknown");
        expect(plan.language, question).toBe(language);
      }
    }
  });

  it("uses the dashboard period only when the question names none", () => {
    expect(understand("How many visitors?", { defaultPeriod: "month", language: "auto" })).toMatchObject({ period: "month", periodStated: false });
    expect(understand("How many visitors yesterday?", { defaultPeriod: "month", language: "auto" })).toMatchObject({ period: "yesterday", periodStated: true });
  });

  it("lets the language switch override detection", () => {
    expect(understand("Ilan ang bisita ngayon?", { defaultPeriod: "today", language: "en" }).language).toBe("en");
    expect(understand("How many visitors today?", { defaultPeriod: "today", language: "tl" }).language).toBe("tl");
  });

  it("keeps the question text for the conversation", () => {
    expect(understand("  Ilan ang bisita?  ", { defaultPeriod: "today", language: "auto" }).question).toBe("Ilan ang bisita?");
  });
});
