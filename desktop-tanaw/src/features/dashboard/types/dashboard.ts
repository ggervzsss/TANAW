/** The period TANAW Insights answers about when a question names none. */
export type TrendFilter = "Today" | "Week" | "Month";

export type DashboardPreset = "today" | "yesterday" | "week" | "month" | "thisMonth" | "custom";

/** Inclusive business dates (YYYY-MM-DD, Asia/Manila) shown on the dashboard. */
export type DashboardRange = { from: string; to: string; preset: DashboardPreset };

/** One bar of Visitor Traffic: a two-hour period of one day, or one day of a range. */
export type TrafficPoint = {
  key: string;
  /** Axis label, e.g. "6 PM" or "Sat 14". */
  label: string;
  /** Readout label, e.g. "6 PM to 8 PM" or "Saturday, Nov 14". */
  period: string;
  entries: number | null;
  /** The most visitors inside at once during the period; null when no camera covered it. */
  occupancy: number | null;
  usual: UsualValue | null;
};

/** What a period usually looks like, from the same weekday in earlier weeks. */
export type UsualValue = { typical: number; low: number; high: number; samples: number };
