/*
 * Links for the IT Enterprises screens. The orchestrator adds `routes.it.enterprises` and
 * `itEnterprisePath` to the app router; until then these literal paths keep the feature
 * self-contained, and they match the paths the router will use.
 */

export const ENTERPRISES_PATH = "/it/enterprises";
export const REQUESTS_PATH = "/it/requests";

export type ManageTab = "connection" | "details" | "hours";
export const MANAGE_TABS: readonly ManageTab[] = ["connection", "details", "hours"];

export function parseManageTab(value: string | null): ManageTab {
  return MANAGE_TABS.find((tab) => tab === value) ?? "connection";
}

/** Manage an enterprise, by its enterprise ID (as on the map) or account ID. */
export function manageEnterprisePath(enterpriseId: string, tab?: ManageTab) {
  const path = `${ENTERPRISES_PATH}/${encodeURIComponent(enterpriseId)}`;
  return tab && tab !== "connection" ? `${path}?tab=${tab}` : path;
}

/** One request opened in IT Requests. */
export function requestPath(requestId: string) {
  return `${REQUESTS_PATH}?request=${encodeURIComponent(requestId)}`;
}
