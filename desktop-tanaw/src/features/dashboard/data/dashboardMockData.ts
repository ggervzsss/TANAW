import { SAMPLE_REPORT_PREVIEWS } from "../../reports/data/reportsMockData";
import type { TrendFilter } from "../types/dashboard";

/** FRONTEND VISUALIZATION ONLY. Set VITE_USE_MOCK_DATA=false and restart/rebuild
 * to restore real Dashboard and Reports sources. Samples never reach persistence. */
export const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA !== "false";

export type DashboardSampleReport = {
  kind: "dashboard-sample";
  id: string;
  title: string;
  date: string;
  period: string;
  status: string;
  description: string;
};
export type DashboardSampleMessage = { question: string; answer: string };
export type DashboardMockData = {
  date: string;
  stats: { occupancy: number; entries: number; exits: number; unique: number };
  traffic: Array<{ label: string; entries: number; exits: number }>;
  occupancy: Array<{ label: string; occupancy: number }>;
  demographics: {
    total: number;
    description: string;
    gender: Array<{ label: string; percent: number }>;
    residence: Array<{ label: string; percent: number }>;
  };
  peak: { busiestHour: string; highestOccupancy: number; caption: string };
  reports: DashboardSampleReport[];
  assistant: {
    welcome: string;
    description: string;
    disclosure: string;
    messages: DashboardSampleMessage[];
    suggestions: Array<{ question: string; keywords: string[]; answer: string }>;
    fallback: string;
  };
};

// Preserve the supplied Figma reference values exactly. The residence labels
// total 102.5%, and the reference peak (156) is below current occupancy (462).
// These deliberately independent visual examples are NOT validated analytics.
export const DASHBOARD_MOCK_DATA: DashboardMockData = {
  date: "2026-11-16T12:00:00+08:00",
  stats: { occupancy: 462, entries: 1248, exits: 786, unique: 1112 },
  // Hourly entries/exits total 1,248 / 786. 10–11 AM has the busiest combined flow.
  traffic: [
    { label: "8–9 AM", entries: 100, exits: 60 },
    { label: "9–10 AM", entries: 150, exits: 72 },
    { label: "10–11 AM", entries: 185, exits: 115 },
    { label: "11–12 PM", entries: 165, exits: 100 },
    { label: "12–1 PM", entries: 190, exits: 85 },
    { label: "1–2 PM", entries: 135, exits: 92 },
    { label: "2–3 PM", entries: 125, exits: 96 },
    { label: "3–4 PM", entries: 110, exits: 86 },
    { label: "4–5 PM", entries: 88, exits: 80 },
  ],
  occupancy: [
    { label: "8–9 AM", occupancy: 92 },
    { label: "10–11 AM", occupancy: 156 },
    { label: "12–1 PM", occupancy: 121 },
    { label: "2–3 PM", occupancy: 38 },
    { label: "4–5 PM", occupancy: 106 },
    { label: "6–7 PM", occupancy: 109 },
    { label: "8–9 PM", occupancy: 92 },
  ],
  demographics: {
    total: 462,
    description: "Visitor distribution · reference sample",
    gender: [
      { label: "Female", percent: 50.2 },
      { label: "Male", percent: 48.5 },
      { label: "Others", percent: 1.3 },
    ],
    residence: [
      { label: "This City", percent: 62.7 },
      { label: "Other City", percent: 27.1 },
      { label: "Other Provinces", percent: 9.5 },
      { label: "Foreign", percent: 3.2 },
    ],
  },
  peak: { busiestHour: "10–11 AM", highestOccupancy: 156, caption: "Reference sample" },
  reports: SAMPLE_REPORT_PREVIEWS,
  assistant: {
    welcome: "Hello! I'm TANAW AI, your assistant for understanding visitor activity and tourism reports. You're viewing frontend sample data.",
    description: "I can help you explore visitor trends, compare your counts, understand peak hours, and explain your sample tourism reports.",
    disclosure: "Sample conversation · no AI or backend requests",
    messages: [
      {
        question: "What insights can you give me?",
        answer:
          "In this sample, today's entries total 1,248 and exits total 786, leaving a net flow of 462 people. Estimated unique visitors total 1,112. The busiest combined entry/exit flow is 10–11 AM. Consider scheduling staff ahead of that period. The demographic labels and 156-person peak reproduce separate design examples; they are not a reconciled visitor ledger.",
      },
    ],
    suggestions: [
      {
        question: "Analyze today's visitor trends",
        keywords: ["trend", "entries", "exits", "count", "traffic"],
        answer:
          "The sample shows 1,248 entries, 786 exits, and 1,112 estimated unique visitors. Entries exceed exits by 462. Traffic is strongest in the late morning and around midday, then decreases toward 5 PM.",
      },
      {
        question: "When are our busiest hours?",
        keywords: ["busiest", "busy", "hour", "peak"],
        answer:
          "10–11 AM is the busiest sample hour by combined flow: 185 entries and 115 exits. The illustrative occupancy series also peaks at 156 people in that interval. That series is a separate design example from the 462 current-occupancy card.",
      },
      {
        question: "Explain my latest visitor report",
        keywords: ["report", "monthly", "submission"],
        answer:
          "Tourism Report - Nov 7, 2026 is the newest sample record and displays a Submitted status. It illustrates a weekly visitor summary with demographic and peak-activity information. It exists only in this Dashboard preview; it has not been saved or submitted to the reporting system.",
      },
      {
        question: "What insights can you give me?",
        keywords: ["insight", "visitor", "demographic", "recommend"],
        answer:
          "The sample gender mix is 50.2% female, 48.5% male, and 1.3% others. Residence labels show 62.7% This City, 27.1% Other City, 9.5% Other Provinces, and 3.2% Foreign. Those requested residence percentages total 102.5%, so they are illustrative labels rather than a validated demographic allocation. Plan additional staffing before the sample 10–11 AM busy period.",
      },
    ],
    fallback: "This is an offline sample conversation. Try a suggested question about visitor trends, busiest hours, demographics, or the latest sample report. No message is sent to an AI service.",
  },
};

// Additional date-range examples stay in this file; no random data or persistence.
const dailyExamples = [
  { label: "Nov 10", entries: 876, exits: 654, unique: 791, occupancy: 124 },
  { label: "Nov 11", entries: 945, exits: 710, unique: 852, occupancy: 132 },
  { label: "Nov 12", entries: 1086, exits: 796, unique: 966, occupancy: 148 },
  { label: "Nov 13", entries: 1175, exits: 842, unique: 1048, occupancy: 151 },
  { label: "Nov 14", entries: 1420, exits: 1094, unique: 1260, occupancy: 156 },
  { label: "Nov 15", entries: 1364, exits: 1008, unique: 1221, occupancy: 149 },
  { label: "Nov 16", entries: 1248, exits: 786, unique: 1112, occupancy: 156 },
];
export function getDashboardMockData(filter: TrendFilter): DashboardMockData {
  if (filter === "Today") return DASHBOARD_MOCK_DATA;
  const days =
    filter === "Week"
      ? dailyExamples
      : Array.from({ length: 30 }, (_, index) => ({
          ...dailyExamples[index % dailyExamples.length],
          label: new Date(Date.UTC(2026, 9, 18 + index)).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }),
        }));
  return {
    ...DASHBOARD_MOCK_DATA,
    stats: {
      occupancy: DASHBOARD_MOCK_DATA.stats.occupancy,
      entries: days.reduce((sum, day) => sum + day.entries, 0),
      exits: days.reduce((sum, day) => sum + day.exits, 0),
      unique: days.reduce((sum, day) => sum + day.unique, 0),
    },
    traffic: days.map(({ label, entries, exits }) => ({ label, entries, exits })),
    occupancy: days.map(({ label, occupancy }) => ({ label, occupancy })),
    assistant: { ...DASHBOARD_MOCK_DATA.assistant, disclosure: "Sample conversation · examples refer to the sample day" },
  };
}

export function getDashboardMockReply(question: string, assistant = DASHBOARD_MOCK_DATA.assistant) {
  const query = question.trim().toLowerCase();
  return (
    assistant.suggestions.find((suggestion) => suggestion.question.toLowerCase() === query)?.answer ??
    assistant.suggestions.find((suggestion) => suggestion.keywords.some((keyword) => query.includes(keyword)))?.answer ??
    assistant.fallback
  );
}
