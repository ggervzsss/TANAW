import type { VisitorInsightEnterprise } from "@/shared/types";

/*
 * The "More visitors than usual" alert over the map. Its data is the visitor-insights list of
 * enterprises the backend marks Busier Than Usual (people inside now well above the usual level
 * for this weekday and hour).
 */

export type BusyEnterprise = {
  enterpriseId: string;
  name: string;
  barangay: string;
  /** Percent above usual, or null when the usual level is unknown. */
  percent: number | null;
  inside: number;
  usual: number | null;
  /** True when the enterprise has a pin on the map. */
  pinned: boolean;
};

export function busyEnterprises(unusuallyBusy: readonly VisitorInsightEnterprise[], pinnedIds: ReadonlySet<string>): BusyEnterprise[] {
  return unusuallyBusy
    .filter((item) => item.activityLevel === "Busier Than Usual")
    .map((item) => ({
      enterpriseId: item.enterpriseId,
      name: item.enterpriseName,
      barangay: item.barangay,
      percent: item.differencePercent,
      inside: item.currentVisitors,
      usual: item.typicalVisitors,
      pinned: pinnedIds.has(item.enterpriseId),
    }))
    .sort((left, right) => (right.percent ?? -1) - (left.percent ?? -1) || right.inside - left.inside || left.name.localeCompare(right.name));
}

/**
 * What a dismissal remembers: each enterprise and its percent in 20-point steps. The alert comes
 * back when an enterprise joins or leaves the list or moves to another step.
 */
export function busySignature(items: readonly BusyEnterprise[]) {
  return items
    .map((item) => `${item.enterpriseId}:${item.percent === null ? "?" : Math.floor(item.percent / 20)}`)
    .sort()
    .join("|");
}

/** "More visitors than usual at 6 enterprises", or "Busier than usual across San Pedro" when more than half are busy. */
export function busyTitle(count: number, monitoredCount: number) {
  if (count <= 1) return "More visitors than usual";
  if (monitoredCount > 0 && count > monitoredCount / 2) return "Busier than usual across San Pedro";
  return `More visitors than usual at ${count} enterprises`;
}

/** "Plaza, Market and 4 more" */
export function busyNames(items: readonly BusyEnterprise[]) {
  const [first, second] = items;
  if (!first) return "";
  if (!second) return first.name;
  if (items.length === 2) return `${first.name} and ${second.name}`;
  return `${first.name}, ${second.name} and ${items.length - 2} more`;
}

/** "41% above usual" */
export function busyPercentText(item: BusyEnterprise) {
  return item.percent === null ? "above usual" : `${item.percent}% above usual`;
}

/** "60 inside, usual for this hour is 43" */
export function busyCountsText(item: BusyEnterprise, short = false) {
  const inside = `${item.inside.toLocaleString("en-US")} inside`;
  if (item.usual === null) return inside;
  return short ? `${inside}, usual ${item.usual.toLocaleString("en-US")}` : `${inside}, usual for this hour is ${item.usual.toLocaleString("en-US")}`;
}
