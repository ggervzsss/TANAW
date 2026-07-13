import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";
import { blocked, isIsoTimestamp, isRecord, isUuid, type EnterpriseSiteTopology, type EnterpriseSiteTopologyPage, type TelemetryIdentity } from "./telemetry-v2-contracts";

const TOPOLOGY_ENDPOINT = "/operational/desktop/sites/v2";
const TOPOLOGY_CACHE_TTL_MS = 30_000;

let topologyCache: { accountId: string; identity: TelemetryIdentity; expiresAt: number } | null = null;

export function clearTelemetryTopologyCache() {
  topologyCache = null;
}

export async function discoverAuthenticatedTelemetryIdentity(): Promise<TelemetryIdentity> {
  const user = useAuthStore.getState().user;
  if (!user || user.role !== "enterprise") {
    throw blocked("TELEMETRY_ENTERPRISE_IDENTITY_MISSING", "Sign in with an enterprise account that has an active topology membership.");
  }
  if (topologyCache?.accountId === user.id && topologyCache.expiresAt > Date.now()) {
    return topologyCache.identity;
  }

  const sites: EnterpriseSiteTopology[] = [];
  const seenCursors = new Set<string>();
  let afterSiteId: string | null = null;
  do {
    if (afterSiteId && seenCursors.has(afterSiteId)) {
      throw blocked("TELEMETRY_TOPOLOGY_PAGINATION_INVALID", "Topology discovery returned a repeated page cursor.");
    }
    if (afterSiteId) seenCursors.add(afterSiteId);
    let response: { data: unknown };
    try {
      response = await staffApi.get<unknown>(TOPOLOGY_ENDPOINT, {
        params: { limit: 50, ...(afterSiteId ? { afterSiteId } : {}) },
      });
    } catch {
      throw blocked("TELEMETRY_TOPOLOGY_DISCOVERY_FAILED", "Canonical site and device topology could not be verified. Telemetry will retry when the central service is reachable.");
    }
    const page = parseTopologyPage(response.data);
    sites.push(...page.items);
    afterSiteId = page.nextCursor;
  } while (afterSiteId !== null);

  const identity = selectTelemetryIdentity(sites);
  topologyCache = { accountId: user.id, identity, expiresAt: Date.now() + TOPOLOGY_CACHE_TTL_MS };
  return identity;
}

export function selectTelemetryIdentity(sites: EnterpriseSiteTopology[]): TelemetryIdentity {
  if (new Set(sites.map((site) => site.siteId)).size !== sites.length) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery repeated a canonical site identity.");
  }
  const enterpriseIds = new Set(sites.map((site) => site.enterpriseId));
  if (enterpriseIds.size > 1) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery crossed canonical enterprise boundaries.");
  }
  const deviceIds = sites.flatMap((site) => site.devices.map((device) => device.deviceId));
  if (new Set(deviceIds).size !== deviceIds.length) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery repeated a canonical device identity across sites.");
  }
  const readySites = sites.filter((site) => site.topologyStatus === "ready" && site.classification === "official" && site.enterpriseLifecycleState === "active" && site.devices.length === 1);
  if (readySites.length === 0) {
    throw blocked("TELEMETRY_TOPOLOGY_NOT_READY", "No official site has exactly one active edge device. Ask TANAW administration to complete site and device provisioning.");
  }
  if (readySites.length > 1) {
    throw blocked("TELEMETRY_TOPOLOGY_AMBIGUOUS", "Multiple sites are ready for this desktop account. Assign this installation to exactly one site before telemetry resumes.");
  }
  const site = readySites[0];
  const device = site.devices[0];
  return {
    enterpriseId: site.enterpriseId,
    siteId: site.siteId,
    deviceId: device.deviceId,
    cameraIds: device.cameras.map((camera) => camera.cameraId).sort(),
  };
}

function parseTopologyPage(value: unknown): EnterpriseSiteTopologyPage {
  if (!isRecord(value) || !Array.isArray(value.items) || !(value.nextCursor === null || isUuid(value.nextCursor)) || !isIsoTimestamp(value.evaluatedAt)) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery returned an invalid response envelope.");
  }
  const items = value.items.map(parseTopologySite);
  return { items, nextCursor: value.nextCursor, evaluatedAt: value.evaluatedAt };
}

function parseTopologySite(value: unknown): EnterpriseSiteTopology {
  if (
    !isRecord(value) ||
    !isUuid(value.siteId) ||
    !isUuid(value.enterpriseId) ||
    (value.enterpriseLifecycleState !== "active" && value.enterpriseLifecycleState !== "inactive") ||
    (value.classification !== "official" && value.classification !== "simulation") ||
    (value.topologyStatus !== "ready" && value.topologyStatus !== "unlinked" && value.topologyStatus !== "ambiguous") ||
    !Array.isArray(value.devices)
  ) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery returned an invalid site resource.");
  }
  const devices = value.devices.map((device) => {
    if (!isRecord(device) || !isUuid(device.deviceId) || device.lifecycleState !== "active" || !Array.isArray(device.cameras)) {
      throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery returned an invalid device resource.");
    }
    const cameras = device.cameras.map((camera) => {
      if (!isRecord(camera) || !isUuid(camera.cameraId) || camera.lifecycleState !== "active") {
        throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery returned an invalid camera resource.");
      }
      return { cameraId: camera.cameraId, lifecycleState: "active" as const };
    });
    if (new Set(cameras.map((camera) => camera.cameraId)).size !== cameras.length) {
      throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery repeated a canonical camera identity.");
    }
    return { deviceId: device.deviceId, lifecycleState: "active" as const, cameras };
  });
  if (new Set(devices.map((device) => device.deviceId)).size !== devices.length) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery repeated a canonical device identity.");
  }
  const topologyMatchesDevices =
    (value.topologyStatus === "ready" && devices.length === 1) || (value.topologyStatus === "unlinked" && devices.length === 0) || (value.topologyStatus === "ambiguous" && devices.length > 1);
  if (!topologyMatchesDevices) {
    throw blocked("TELEMETRY_TOPOLOGY_RESPONSE_INVALID", "Topology discovery returned an inconsistent readiness status.");
  }
  return {
    siteId: value.siteId,
    enterpriseId: value.enterpriseId,
    enterpriseLifecycleState: value.enterpriseLifecycleState,
    classification: value.classification,
    topologyStatus: value.topologyStatus,
    devices,
  };
}
