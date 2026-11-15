import type { DemoBreakdown, Metrics, ReportRecord } from "../../../types/enterprise";
import type { Var1DailyAllocation } from "../model/var1";

/** FRONTEND ONLY. Never pass these records to persistence, IPC, sync or submission. */
export type ReportsSampleRecord = ReportRecord & {
  kind: "reports-sample";
  title: string;
  description: string;
  daily: Var1DailyAllocation[];
  demo: DemoBreakdown;
};

function partition(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  return weights.map((_, index) => {
    const cumulative = Math.round((total * weights.slice(0, index + 1).reduce((a, b) => a + b, 0)) / sum);
    const value = cumulative - allocated;
    allocated = cumulative;
    return value;
  });
}

function sample(period: string, month: number, total: number, status: string, submittedAt?: string, id = `MOCK-TOURISM-2026-${String(month).padStart(2, "0")}`): ReportsSampleRecord {
  const days = new Date(Date.UTC(2026, month, 0)).getUTCDate();
  const weights = Array.from({ length: days }, (_, index) => [24, 19, 20, 22, 28, 39, 35][new Date(Date.UTC(2026, month - 1, index + 1)).getUTCDay()]);
  const daily = partition(total, weights).map((count, index) => {
    const [city, province, other, foreign] = partition(count, [63, 24, 9, 4]);
    // Alternate rounding of odd counts so low-volume categories include both sexes.
    const genderSplit = (count: number) => {
      const male = Math.floor(count / 2) + (count % 2 && index % 2 === 0 ? 1 : 0);
      return [male, count - male];
    };
    const [cm, cf] = genderSplit(city);
    const [pm, pf] = genderSplit(province);
    const [om, of] = genderSplit(other);
    const [fm, ff] = genderSplit(foreign);
    return {
      date: `2026-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      demo: {
        thisCityMale: String(cm),
        thisCityFemale: String(cf),
        thisProvMale: String(cm + pm),
        thisProvFemale: String(cf + pf),
        otherProvMale: String(om),
        otherProvFemale: String(of),
        foreignMale: String(fm),
        foreignFemale: String(ff),
      },
    };
  });
  const demo = Object.fromEntries(Object.keys(daily[0].demo).map((key) => [key, String(daily.reduce((sum, day) => sum + Number(day.demo[key as keyof DemoBreakdown]), 0))])) as DemoBreakdown;
  return {
    kind: "reports-sample",
    id,
    period,
    date: submittedAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Asia/Manila" }).format(new Date(submittedAt)) : period,
    title: id.endsWith("1107") ? "Tourism Report - Nov 7, 2026" : `Tourism Report - ${period}`,
    description: "Frontend sample monthly tourism report. Visualization only; never saved or submitted to the LGU.",
    status,
    submittedAt,
    unique: total,
    entries: total + Math.round(total * 0.08),
    exits: total + Math.round(total * 0.06),
    peak: Math.round((total / days) * 0.7),
    demo,
    daily,
    notes: "Frontend visualization only. Sample daily visitor records and residence allocations; not an official submission.",
  };
}

export const REPORTS_MOCK_DATA = {
  enterpriseName: "Lolo Uweng Shrine",
  attractionType: "Cultural Tourism",
  disclosure: "Mock data · Frontend visualization only. No reports are saved or submitted.",
  current: sample("November 2026", 11, 617, "Draft", undefined, "MOCK-DRAFT-2026-11"),
  reports: [
    sample("October 2026", 10, 3756, "Submitted", "2026-11-07T02:00:00+08:00", "MOCK-TOURISM-2026-1107"),
    sample("September 2026", 9, 4061, "Pending Submission"),
    sample("August 2026", 8, 9873, "Consolidated", "2026-09-04T12:54:00+08:00"),
    sample("July 2026", 7, 7923, "Consolidated", "2026-08-03T13:06:00+08:00"),
    sample("June 2026", 6, 6492, "Submitted", "2026-07-02T09:20:00+08:00"),
    sample("May 2026", 5, 7218, "Returned for Revision", "2026-06-03T14:15:00+08:00"),
    sample("April 2026", 4, 5846, "Consolidated", "2026-05-04T11:40:00+08:00"),
  ],
};

export function sampleMetrics(report: ReportsSampleRecord): Metrics {
  return { entries: report.entries, exits: report.exits ?? null, peak: report.peak ?? null, unique: report.unique };
}

// Lightweight shared previews keep backend-shaped records out of Dashboard props.
export const SAMPLE_REPORT_PREVIEWS = REPORTS_MOCK_DATA.reports.map((report) => ({
  kind: "dashboard-sample" as const,
  id: report.id,
  title: report.title,
  date: report.date,
  period: report.period!,
  status: report.status,
  description: report.description,
}));
