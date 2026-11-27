import { useState } from "react";
import { reportingDateKey, type ReportDay } from "../model/daily-origins";

export type SelectedReportDay = { day: ReportDay; select: (date: string) => void };

/**
 * The day shown in Visitor Details. Until the user picks a day or edits one, it follows the first
 * day that needs them (else today), so it stays put while they type.
 */
export function useSelectedReportDay(days: ReportDay[], period: string): SelectedReportDay | null {
  const [selection, setSelection] = useState<{ period: string; date: string } | null>(null);
  const pinned = selection?.period === period ? days.find((day) => day.date === selection.date) : undefined;
  const day = pinned ?? defaultDay(days);
  if (!day) return null;
  return { day, select: (date: string) => setSelection({ period, date }) };
}

/** The day shown first: one that needs fixing, else the latest day with visitors, else today. */
function defaultDay(days: ReportDay[]) {
  const today = reportingDateKey();
  const reached = days.filter((day) => day.status !== "upcoming");
  const latestVisited = [...reached].reverse().find((day) => Boolean(day.unique));
  return days.find((day) => day.status === "missing") ?? latestVisited ?? reached.find((day) => day.date === today) ?? reached[reached.length - 1] ?? days[0];
}
