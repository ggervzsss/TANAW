export const ALL_BARANGAYS_FILTER = "all";
const MONTHS = new Set(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);

export type BatchReportsPageState = { barangay: string; month: string; query: string; year: string };

export function hasBatchReportsUrlState(searchParams: URLSearchParams) {
  return ["q", "barangay", "month", "year"].some((key) => searchParams.has(key));
}

export function parseBatchReportsUrlState(searchParams: URLSearchParams, fallback: BatchReportsPageState): BatchReportsPageState {
  const month = searchParams.get("month");
  const year = searchParams.get("year");
  return {
    barangay: searchParams.get("barangay")?.trim() || fallback.barangay,
    month: month && MONTHS.has(month) ? month : fallback.month,
    query: searchParams.get("q") ?? fallback.query,
    year: year && /^\d{4}$/.test(year) ? year : fallback.year,
  };
}

export function batchReportsSearchParams(state: BatchReportsPageState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.barangay !== ALL_BARANGAYS_FILTER) params.set("barangay", state.barangay);
  params.set("month", state.month);
  params.set("year", state.year);
  return params;
}

export function isBatchReportsPageState(value: unknown): value is BatchReportsPageState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BatchReportsPageState>;
  return (
    typeof state.query === "string" &&
    state.query.length <= 200 &&
    typeof state.barangay === "string" &&
    state.barangay.length <= 120 &&
    typeof state.month === "string" &&
    MONTHS.has(state.month) &&
    typeof state.year === "string" &&
    /^\d{4}$/.test(state.year)
  );
}

export function sameBatchReportsPageState(left: BatchReportsPageState, right: BatchReportsPageState) {
  return left.query === right.query && left.barangay === right.barangay && left.month === right.month && left.year === right.year;
}
