import type { EstablishmentHourly, EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { ReportRecord } from "../../../types/enterprise";
import { periodRange, previousRange } from "./periods";
import type { AssistantData, DateRange, PeriodKey, Plan } from "./types";

export type DataNeeds = {
  summary: DateRange | null;
  previous: DateRange | null;
  hourly: DateRange | null;
  live: boolean;
  report: boolean;
  /** Which requests the answer cannot do without; a failure of any of them fails the reply. */
  required: Array<"summary" | "previous" | "live">;
};

const NOTHING: DataNeeds = { summary: null, previous: null, hourly: null, live: false, report: false, required: [] };

function includesToday(period: PeriodKey) {
  return period !== "yesterday";
}

/** The local data a plan needs. Nothing is requested for help, greetings or unknown questions. */
export function dataNeeds(plan: Plan, now: Date): DataNeeds {
  const range = periodRange(plan.period, now);
  const live = includesToday(plan.period);
  switch (plan.intent) {
    case "busiest":
      return { ...NOTHING, summary: range, hourly: range, required: ["summary"] };
    case "compare":
      return { ...NOTHING, summary: range, previous: previousRange(range), live, required: ["summary", "previous"] };
    case "summary":
      return { ...NOTHING, summary: range, previous: previousRange(range), hourly: range, live, required: ["summary"] };
    case "occupancy_now":
      return { ...NOTHING, summary: periodRange("today", now), live: true, required: ["live"] };
    case "coverage":
    case "sex":
    case "movement":
    case "visitors":
      return { ...NOTHING, summary: range, live, required: ["summary"] };
    case "report":
      return { ...NOTHING, report: true };
    default:
      return NOTHING;
  }
}

export type AssistantDataSource = {
  baseUrl: () => Promise<string>;
  summary: (baseUrl: string, range: DateRange) => Promise<EstablishmentSummary>;
  hourly: (baseUrl: string, range: DateRange) => Promise<EstablishmentHourly>;
  live: (baseUrl: string) => Promise<EstablishmentLive>;
  /** The signed-in establishment; data for any other establishment is rejected. */
  enterpriseId: string | null | undefined;
  report: ReportRecord | null;
};

async function attempt<T extends { enterprise_id: string }>(enterpriseId: string | null | undefined, request: (() => Promise<T>) | null) {
  if (!request) return { value: null, failed: false };
  try {
    const value = await request();
    if (enterpriseId && value.enterprise_id !== enterpriseId) return { value: null, failed: true };
    return { value, failed: false };
  } catch {
    return { value: null, failed: true };
  }
}

/** Fetch what ``needs`` asks for from the local ML service, in parallel. */
export async function loadAssistantData(needs: DataNeeds, source: AssistantDataSource): Promise<AssistantData> {
  const report = needs.report ? source.report : null;
  if (!needs.summary && !needs.previous && !needs.hourly && !needs.live) return { summary: null, previous: null, hourly: null, live: null, report, failed: false };
  let baseUrl: string;
  try {
    baseUrl = await source.baseUrl();
  } catch {
    return { summary: null, previous: null, hourly: null, live: null, report, failed: needs.required.length > 0 };
  }
  const { summary: summaryRange, previous: previousPeriod, hourly: hourlyRange } = needs;
  const [summary, previous, hourly, live] = await Promise.all([
    attempt(source.enterpriseId, summaryRange ? () => source.summary(baseUrl, summaryRange) : null),
    attempt(source.enterpriseId, previousPeriod ? () => source.summary(baseUrl, previousPeriod) : null),
    attempt(source.enterpriseId, hourlyRange ? () => source.hourly(baseUrl, hourlyRange) : null),
    attempt(source.enterpriseId, needs.live ? () => source.live(baseUrl) : null),
  ]);
  const results = { summary, previous, live };
  return {
    summary: summary.value,
    previous: previous.value,
    hourly: hourly.value,
    live: live.value,
    report,
    failed: needs.required.some((name) => results[name].failed),
  };
}
