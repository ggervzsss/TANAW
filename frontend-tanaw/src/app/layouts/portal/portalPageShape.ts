import type { ViewSkeletonProps } from "@/shared/ui-kit/patterns/ViewSkeleton";

export type PageShape = Omit<ViewSkeletonProps, "label" | "className">;

/** Each portal page's skeleton shape, by its path after the role (":id" stands for one record). */
const shapes: Record<string, PageShape> = {
  "admin/dashboard": { variant: "dashboard" },
  "admin/enterprises": { variant: "page", action: "text", figures: 3, filters: 5, rows: 10 },
  "admin/enterprises/:id": { variant: "detail", back: true },
  "admin/reports": { variant: "page", lede: 2, action: "field", filters: 3, rows: 10 },
  "admin/activity": { variant: "page", back: true, lede: 2, filters: 3, filterLabels: false, rows: 8 },
  "admin/requests": { variant: "split", back: true, lede: 2, action: "text", filters: 3 },
  "it/requests": { variant: "page", lede: 2, filters: 3, filterWidths: "compact", statusLine: false, rows: 8 },
  "it/enterprises": { variant: "page", lede: 2, action: "button", figures: 3, filters: 1, rows: 8 },
  "it/enterprises/:id": { variant: "page", back: true, action: "text", tabs: 3, rows: 4 },
  "it/personnel": { variant: "page", lede: 2, action: "button", filters: 2, rows: 8 },
  "it/system": { variant: "page", tabs: 3, rows: 8 },
  "it/notifications": { variant: "list" },
  "it/dev-log": { variant: "page", lede: 2, filters: 1, filterLabels: false, rows: 4 },
  "staff/reports": { variant: "page", action: "field", filters: 4, rows: 10 },
  "staff/consolidated-reports": { variant: "page", action: "field", tabs: 2, rows: 12 },
  "staff/notifications": { variant: "list" },
};

/**
 * The shape of the portal page at `pathname`, so the placeholder shown while that page's code (or
 * the session) loads has the same sections in the same places as the page that replaces it.
 */
export function portalPageShape(pathname: string): PageShape {
  const [role = "", page = "", detail, ...rest] = pathname.split("/").filter(Boolean);
  if (page === "settings") return { variant: "settings" };
  if (page === "help") return { variant: "help" };
  const key = detail && rest.length === 0 ? `${role}/${page}/:id` : `${role}/${page}`;
  return shapes[key] ?? { variant: "page" };
}

