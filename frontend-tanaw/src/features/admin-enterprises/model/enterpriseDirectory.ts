import { attractionClassifications } from "@/contracts/generated/attractions";
import type { AccountSummary, MapEnterprise } from "@/shared/types";
import { cameraStatusOf, needsAttention, plural, type CameraStatus } from "./cameraStatus";

/*
 * The Registered Enterprises list: monitored enterprises (/operational/map-enterprises) joined with
 * their enterprise accounts (/accounts/enterprises) by enterprise ID.
 *
 * The design's crossed filter labels are settled from the DOT attraction classification each
 * account stores:
 *   Attraction type      the DOT type group ("Sports and Recreational Facilities").
 *   Attraction category  the DOT category ("Parks"), the same value as the table column.
 * The design's "Open area / Public facility / Business" kind is not recorded anywhere, so the row
 * shows the DOT tourism portfolio ("Leisure and Entertainment Tourism") in its place.
 */

export type EnterpriseRow = {
  id: string;
  name: string;
  barangay: string;
  address: string | null;
  attractionCode: string | null;
  attractionCategory: string;
  attractionType: string | null;
  portfolio: string | null;
  contact: string | null;
  registeredAt: string | null;
  map: MapEnterprise | undefined;
  account: AccountSummary | undefined;
  camera: CameraStatus;
};

type Classification = (typeof attractionClassifications)[number];

const classificationsByCategory = new Map<string, Classification[]>();
for (const item of attractionClassifications) classificationsByCategory.set(item.category, [...(classificationsByCategory.get(item.category) ?? []), item]);

/** The DOT type groups in catalog order (Nature, History and Culture, ...). */
export const ATTRACTION_TYPES: readonly string[] = [...new Set(attractionClassifications.map((item) => item.type))];

/** The account's DOT classification, or the only catalog entry with the monitoring list's category name. */
function classificationOf(account: AccountSummary | undefined, category: string | undefined) {
  if (account?.attraction) return account.attraction;
  const matches = category ? classificationsByCategory.get(category) : undefined;
  return matches?.length === 1 ? matches[0] : undefined;
}

function cleanAddress(value: string | null | undefined) {
  const text = value?.trim();
  return text && text !== "Address not provided" ? text : null;
}

/** Accounts that are registered and active, the same set the monitoring list draws from. */
function isRegistered(account: AccountSummary) {
  return account.status === "active" && account.isActivated && Boolean(account.enterpriseId);
}

export function buildEnterpriseRows(mapEnterprises: readonly MapEnterprise[], accounts: readonly AccountSummary[], now: Date): EnterpriseRow[] {
  const accountsById = new Map<string, AccountSummary>();
  for (const account of accounts) if (account.enterpriseId) accountsById.set(account.enterpriseId, account);

  const rows = mapEnterprises.map((map) => toRow(map, accountsById.get(map.id), now));
  const listed = new Set(rows.map((row) => row.id));
  for (const account of accounts) {
    if (!isRegistered(account) || listed.has(account.enterpriseId as string)) continue;
    rows.push(toRow(undefined, account, now));
  }
  return rows;
}

function toRow(map: MapEnterprise | undefined, account: AccountSummary | undefined, now: Date): EnterpriseRow {
  const classification = classificationOf(account, map?.category ?? account?.category ?? undefined);
  // The backend already names a code-901 ("Others") attraction by its description; keep that name.
  const attractionCategory = account?.category?.trim() || map?.category.trim() || classification?.category || "Not classified";
  return {
    id: map?.id ?? account?.enterpriseId ?? "",
    name: map?.name ?? account?.enterpriseName ?? account?.displayName ?? "Unnamed enterprise",
    barangay: map?.barangay ?? account?.barangay ?? "Unassigned",
    address: cleanAddress(account?.address) ?? cleanAddress(map?.fullAddress),
    attractionCode: classification?.code ?? null,
    attractionCategory,
    attractionType: classification?.type ?? null,
    portfolio: classification?.portfolioCategory ?? null,
    contact: account?.phone ?? map?.contact ?? account?.email ?? null,
    registeredAt: account?.createdAt ?? null,
    map,
    account,
    camera: cameraStatusOf(map, now),
  };
}

/* Filters */

export type CameraFilter = "all" | "ok" | "issue" | "offline" | "unconfigured";

export const CAMERA_FILTER_OPTIONS: ReadonlyArray<readonly [CameraFilter, string]> = [
  ["all", "All statuses"],
  ["ok", "Monitoring"],
  ["issue", "Camera issue"],
  ["offline", "No connection"],
  ["unconfigured", "No cameras set up"],
];

export type EnterpriseFilters = {
  search: string;
  barangay: string;
  attractionType: string;
  attractionCategory: string;
  camera: CameraFilter;
  attention: boolean;
};

export const ALL = "all";

export const DEFAULT_FILTERS: EnterpriseFilters = { search: "", barangay: ALL, attractionType: ALL, attractionCategory: ALL, camera: "all", attention: false };

export function hasActiveFilters(filters: EnterpriseFilters) {
  return (
    filters.search.trim() !== "" ||
    filters.barangay !== ALL ||
    filters.attractionType !== ALL ||
    filters.attractionCategory !== ALL ||
    filters.camera !== "all" ||
    filters.attention
  );
}

function matchesSearch(row: EnterpriseRow, query: string) {
  if (!query) return true;
  const haystack = [row.name, row.id, row.barangay, row.attractionCategory, row.attractionType, row.attractionCode, row.portfolio, row.address]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function filterEnterpriseRows(rows: readonly EnterpriseRow[], filters: EnterpriseFilters) {
  const query = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      matchesSearch(row, query) &&
      (filters.barangay === ALL || row.barangay === filters.barangay) &&
      (filters.attractionType === ALL || row.attractionType === filters.attractionType) &&
      (filters.attractionCategory === ALL || row.attractionCategory === filters.attractionCategory) &&
      (filters.camera === "all" || row.camera.state === filters.camera) &&
      (!filters.attention || needsAttention(row.camera.state)),
  );
}

export type SortDirection = "ascending" | "descending";

export function sortEnterpriseRows(rows: readonly EnterpriseRow[], direction: SortDirection) {
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => sign * a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
}

/** Distinct values for a dropdown, sorted, with "Unassigned" and "Not classified" last. */
export function distinctValues(rows: readonly EnterpriseRow[], pick: (row: EnterpriseRow) => string | null) {
  const last = new Set(["Unassigned", "Not classified"]);
  const values = [...new Set(rows.map(pick).filter((value): value is string => Boolean(value)))];
  return values.sort((a, b) => Number(last.has(a)) - Number(last.has(b)) || a.localeCompare(b, "en", { sensitivity: "base" }));
}

/* Figures */

export type DirectorySummary = {
  enterprises: number;
  cameras: number;
  running: number;
  notReporting: number;
  attention: number;
};

export function summarizeEnterprises(rows: readonly EnterpriseRow[]): DirectorySummary {
  let cameras = 0;
  let running = 0;
  let attention = 0;
  for (const row of rows) {
    cameras += row.camera.cameraCount ?? 0;
    running += row.camera.runningCount;
    if (needsAttention(row.camera.state)) attention += 1;
  }
  return { enterprises: rows.length, cameras, running, notReporting: Math.max(0, cameras - running), attention };
}

export function camerasSubline(summary: DirectorySummary) {
  if (summary.cameras === 0) return "No cameras reported yet";
  return `${summary.running.toLocaleString("en-US")} running right now, ${summary.notReporting.toLocaleString("en-US")} not reporting`;
}

/** "12 enterprises found", or "3 of 12 enterprises need attention" while the attention filter is on. */
export function resultLine(shown: number, total: number, filters: EnterpriseFilters) {
  if (filters.attention && !hasActiveFilters({ ...filters, attention: false })) {
    return `${shown.toLocaleString("en-US")} of ${plural(total, "enterprise")} ${shown === 1 ? "needs" : "need"} attention`;
  }
  if (hasActiveFilters(filters)) return `${shown.toLocaleString("en-US")} of ${plural(total, "enterprise")} found`;
  return `${plural(total, "enterprise")} found`;
}

/* URL state: ?q=&barangay=&type=&category=&camera=&attention=1&sort=desc&page=2 */

const CAMERA_FILTERS = new Set<string>(CAMERA_FILTER_OPTIONS.map(([value]) => value));

export function filtersFromParams(params: URLSearchParams): EnterpriseFilters {
  const camera = params.get("camera") ?? "all";
  return {
    search: params.get("q") ?? "",
    barangay: params.get("barangay") || ALL,
    attractionType: params.get("type") || ALL,
    attractionCategory: params.get("category") || ALL,
    camera: (CAMERA_FILTERS.has(camera) ? camera : "all") as CameraFilter,
    attention: params.get("attention") === "1",
  };
}

export function paramsFromFilters(filters: EnterpriseFilters, extra: { sort?: SortDirection; page?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("q", filters.search);
  if (filters.barangay !== ALL) params.set("barangay", filters.barangay);
  if (filters.attractionType !== ALL) params.set("type", filters.attractionType);
  if (filters.attractionCategory !== ALL) params.set("category", filters.attractionCategory);
  if (filters.camera !== "all") params.set("camera", filters.camera);
  if (filters.attention) params.set("attention", "1");
  if (extra.sort === "descending") params.set("sort", "desc");
  if (extra.page && extra.page > 1) params.set("page", String(extra.page));
  return params;
}
