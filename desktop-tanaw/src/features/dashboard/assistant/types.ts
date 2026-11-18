import type { EstablishmentHourly, EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { ReportRecord } from "../../../types/enterprise";
import type { SystemTimeFormat } from "../../../utils/date-time";

/** What a question asks about. Data intents come first; they also break scoring ties in this order. */
export const DATA_INTENTS = ["busiest", "compare", "sex", "movement", "occupancy_now", "report", "coverage", "summary", "visitors"] as const;
export const CONVERSATION_INTENTS = ["help", "greeting"] as const;

export type DataIntent = (typeof DATA_INTENTS)[number];
export type Intent = DataIntent | (typeof CONVERSATION_INTENTS)[number] | "unknown";

/** Periods follow the dashboard: today, yesterday, the past 7 days and the past 30 days. */
export type PeriodKey = "today" | "yesterday" | "week" | "month";
export type Language = "en" | "tl";
export type LanguagePreference = "auto" | Language;
/** Whether a "busiest" question asks for an hour, a day, or leaves it to the period. */
export type Granularity = "hour" | "day" | null;

export type Plan = {
  question: string;
  intent: Intent;
  period: PeriodKey;
  /** True when the question named the period; otherwise the dashboard's period is used. */
  periodStated: boolean;
  granularity: Granularity;
  language: Language;
};

export type DateRange = { start: string; end: string };

export type AssistantData = {
  summary: EstablishmentSummary | null;
  previous: EstablishmentSummary | null;
  hourly: EstablishmentHourly | null;
  live: EstablishmentLive | null;
  report: ReportRecord | null;
  /** True when a request the answer needed failed. */
  failed: boolean;
};

export type ComposeContext = { now: Date; timeFormat: SystemTimeFormat };

export type Reply = {
  language: Language;
  /** The main answer, one or two sentences. */
  text: string;
  /** Supporting facts shown as a short list. */
  details: string[];
  /** Caveats about partial, missing or low-coverage data. */
  notes: string[];
  /** Which period and time the answer is based on, for example "Today · as of 3:42 PM". */
  basis: string | null;
  /** Show the suggested questions again, for replies that could not answer. */
  suggest: boolean;
};
