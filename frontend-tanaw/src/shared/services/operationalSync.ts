import { apiClient } from "../lib/apiClient";
import { getWebSocketUrl } from "../config/api.config";
import { appendClientGeneration } from "../config/client-generation";
import type { GatewayStatus, MapEnterprise, MapSite } from "../types";
import { collectCursorPages, type CursorPage } from "./cursorPagination";

export type BackendNotificationSeverity = "Info" | "Warning" | "Critical" | "Success";

export type BackendNotification = {
  id: string;
  recipientAccountId: string;
  title: string;
  message: string;
  type: string;
  severity: BackendNotificationSeverity;
  sourceType: string | null;
  sourceId: string | null;
  createdBy: string | null;
  recipientRole: string;
  recipientEnterpriseId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type OperationalWebSocketEnvelope = {
  type: "resource.invalidated";
  data: {
    contractVersion: 2;
    eventId: string;
    eventKey: string;
    eventType: string;
    resource: {
      type: "site_live_state" | "operational_alert" | "user_notification" | "activity_log" | "enterprise_report" | "final_report" | "reporting_period_compliance" | "reporting_obligation";
      id: string;
      version: number;
    };
    scope: {
      classification: "official" | "simulation";
      enterpriseId: string | null;
      siteId: string | null;
      recipientAccountId: string | null;
    };
    invalidates: string[];
    audienceRoles: string[];
    occurredAt: string;
    refetchRequired: true;
  };
};

type SiteLiveStateResponse = {
  freshnessState: "fresh" | "stale" | "offline";
  currentOccupancy: number | null;
  venueLocalUniqueEstimateWindow: number | null;
  observedAt: string;
  receivedAt: string;
  serviceState: "healthy" | "degraded" | "unavailable" | "unknown";
  syncHealth: {
    pendingCount: number | null;
  };
};

type EnterpriseSiteResponse = {
  siteId: string;
  enterpriseId: string;
  enterpriseName: string;
  enterpriseCategory: string | null;
  enterpriseLifecycleState: "active" | "inactive";
  classification: "official" | "simulation";
  siteName: string;
  barangay: string | null;
  address: string | null;
  geocodedAddress: string | null;
  locationSource: string | null;
  locationConfidence: number | null;
  coordinatesUpdatedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  topologyStatus: "ready" | "unlinked" | "ambiguous";
  liveState: SiteLiveStateResponse | null;
};

type EnterpriseSitePageResponse = {
  items: EnterpriseSiteResponse[];
  nextCursor: string | null;
  evaluatedAt: string;
};

export async function listOperationalMapEnterprises() {
  const resources: EnterpriseSiteResponse[] = [];
  const observedCursors = new Set<string>();
  let afterSiteId: string | undefined;

  do {
    const response = await apiClient.get<EnterpriseSitePageResponse>("/operational/sites/v2", {
      params: { limit: 200, ...(afterSiteId ? { afterSiteId } : {}) },
    });
    resources.push(...response.data.items);
    const nextCursor = response.data.nextCursor;
    if (!nextCursor) break;
    if (observedCursors.has(nextCursor)) {
      throw new Error("The site registry returned a repeated pagination cursor.");
    }
    observedCursors.add(nextCursor);
    afterSiteId = nextCursor;
  } while (afterSiteId);

  return resources.filter((resource) => resource.classification === "official").map(toMapSite);
}

export async function listUserNotifications() {
  return collectCursorPages(async (cursor) => {
    const response = await apiClient.get<CursorPage<BackendNotification>>("/operational/notifications", {
      params: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  }, "notification");
}

export async function updateUserNotificationRead(notificationId: string, read: boolean) {
  const response = await apiClient.patch<BackendNotification>(`/operational/notifications/${notificationId}`, { read });
  return response.data;
}

export function getOperationalWebSocketUrl() {
  return appendClientGeneration(new URL(getWebSocketUrl("/operational/ws"))).toString();
}

export function createWebSocketAuthMessage(token: string) {
  return JSON.stringify({ type: "auth", token });
}

function toMapSite(resource: EnterpriseSiteResponse): MapSite {
  const liveState = resource.liveState;
  return {
    id: resource.siteId,
    enterpriseId: resource.enterpriseId,
    name: displaySiteName(resource.enterpriseName, resource.siteName),
    barangay: resource.barangay ?? "Unassigned",
    category: resource.enterpriseCategory ?? "Uncategorized",
    fullAddress: resource.address ?? resource.geocodedAddress ?? "Address not provided",
    lat: finiteCoordinate(resource.latitude),
    lng: finiteCoordinate(resource.longitude),
    totalLiveOccupancy: liveState?.currentOccupancy ?? null,
    estimatedUniqueCount: liveState?.venueLocalUniqueEstimateWindow ?? null,
    status: mapStatus(resource),
    lastSync: liveState?.receivedAt,
    gatewayStatus: gatewayStatus(resource),
    freshnessState: liveState?.freshnessState,
    topologyStatus: resource.topologyStatus,
    locationWarning: getLocationEvidenceWarning(resource),
  };
}

export function getLocationEvidenceWarning(resource: {
  address: string | null;
  geocodedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  locationConfidence?: number | null;
  topologyStatus?: "ready" | "unlinked" | "ambiguous";
}) {
  if (resource.topologyStatus === "ambiguous") return "Multiple topology candidates exist; verify the site and map pin before relying on this location.";
  if (resource.latitude === null || resource.longitude === null) return "This site has no verified map coordinates.";
  if (resource.locationConfidence !== null && resource.locationConfidence !== undefined && resource.locationConfidence < 0.65) {
    return "The saved map coordinates have low geocoding confidence and should be reviewed.";
  }
  if (resource.address && resource.geocodedAddress && addressesMateriallyDiffer(resource.address, resource.geocodedAddress)) {
    return "The registered address and geocoded map address differ; verify the pin before using it operationally.";
  }
  return null;
}

function addressesMateriallyDiffer(left: string, right: string) {
  const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((token) => token.length > 2));
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) < 0.6;
}

function displaySiteName(enterpriseName: string, siteName: string) {
  return enterpriseName.trim().localeCompare(siteName.trim(), undefined, { sensitivity: "base" }) === 0 ? enterpriseName : `${enterpriseName} — ${siteName}`;
}

function finiteCoordinate(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapStatus(resource: EnterpriseSiteResponse): MapEnterprise["status"] {
  if (resource.topologyStatus === "ambiguous") return "Critical";
  if (resource.enterpriseLifecycleState === "inactive") return "Warning";
  if (resource.topologyStatus === "unlinked" || resource.liveState === null) return "No Data";
  if (resource.liveState.freshnessState === "offline" || resource.liveState.serviceState === "unavailable") return "Critical";
  if (resource.liveState.freshnessState === "stale" || resource.liveState.serviceState !== "healthy" || (resource.liveState.syncHealth.pendingCount ?? 0) > 0) {
    return "Warning";
  }
  return "Normal";
}

function gatewayStatus(resource: EnterpriseSiteResponse): GatewayStatus {
  if (resource.enterpriseLifecycleState === "inactive") return "Closed";
  if (resource.topologyStatus === "unlinked") return "Not Linked";
  if (resource.topologyStatus === "ambiguous" || resource.liveState === null) return "Offline";
  if (resource.liveState.freshnessState === "offline" || resource.liveState.serviceState === "unavailable") return "Offline";
  if (resource.liveState.freshnessState === "stale" || resource.liveState.serviceState !== "healthy" || (resource.liveState.syncHealth.pendingCount ?? 0) > 0) {
    return "Sync Delayed";
  }
  return "Connected";
}
