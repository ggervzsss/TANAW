const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
export const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

type EvidenceStatus = "recorded" | "not_recorded";
type MetricQuality = "confirmed" | "degraded" | "estimated" | "unknown";
type DeviceServiceState = "healthy" | "degraded" | "unavailable" | "unknown";

export type MetricCoverage = {
  evidenceStatus: EvidenceStatus;
  monitoredSeconds: number | null;
  expectedSeconds: number | null;
  gapCount: number | null;
};

export type TelemetryMetric = {
  definition: "visitor_entries" | "visitor_exits" | "occupancy_current" | "venue_local_unique_estimate";
  definitionVersion: 1;
  value: number | null;
  unit: "crossings" | "people" | "estimated_visitors";
  grain: "site";
  cameraId: null;
  windowStart: string;
  windowEnd: string;
  timezone: "Asia/Manila";
  provenance: "camera_derived";
  quality: MetricQuality;
  coverage: MetricCoverage;
};

export type CameraHealthState = {
  cameraId: string;
  state: "streaming" | "reconnecting" | "unavailable" | "credential_error" | "stopped" | "unknown";
};

export type DeviceHealth = {
  service: DeviceServiceState;
  cameraStates: CameraHealthState[];
  analyticsFps: number | null;
};

type SyncHealth = {
  evidenceStatus: EvidenceStatus;
  pendingCount: number | null;
  oldestPendingAt: string | null;
  lastAcknowledgedAt: string | null;
  lastFailureAt: string | null;
  lastFailureClass: string | null;
};

export type EpochStartCommand = {
  contractVersion: 2;
  commandId: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedVersion: number;
  payload: {
    deviceId: string;
    counterEpoch: string;
    expectedPreviousEpoch: string | null;
  };
};

export type TelemetryObservationCommand = {
  contractVersion: 2;
  commandId: string;
  idempotencyKey: string;
  occurredAt: string;
  expectedVersion: number;
  payload: {
    deviceId: string;
    counterEpoch: string;
    epochGeneration: number;
    sequence: number;
    observedAt: string;
    metrics: TelemetryMetric[];
    deviceHealth: DeviceHealth;
    syncHealth: SyncHealth;
  };
};

export type DesktopTelemetryReadiness = {
  status: "ready" | "blocked";
  code: string | null;
  message: string;
  checkedAt: string;
};

export class DesktopTelemetryReadinessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopTelemetryReadinessError";
    this.code = code;
  }
}

export type TelemetryIdentity = {
  enterpriseId: string;
  siteId: string;
  deviceId: string;
  cameraIds: string[];
};

export type EnterpriseSiteTopology = {
  siteId: string;
  enterpriseId: string;
  enterpriseLifecycleState: "active" | "inactive";
  classification: "official" | "simulation";
  topologyStatus: "ready" | "unlinked" | "ambiguous";
  devices: Array<{
    deviceId: string;
    lifecycleState: "active";
    cameras: Array<{ cameraId: string; lifecycleState: "active" }>;
  }>;
};

export type EnterpriseSiteTopologyPage = {
  items: EnterpriseSiteTopology[];
  nextCursor: string | null;
  evaluatedAt: string;
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  if (typeof value === "string") {
    const timestamp = canonicalUtcTimestamp(value);
    if (timestamp) return timestamp;
    if (isUuid(value)) return value.toLowerCase();
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw blocked("TELEMETRY_VALUE_INVALID", "Telemetry values must be finite.");
  }
  return value;
}

function canonicalUtcTimestamp(value: string): string | null {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zoneText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const microseconds = (fractionText ?? "").padEnd(6, "0");
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number(microseconds.slice(0, 3) || "0"));
  if (
    year < 1 ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }
  let offsetMinutes = 0;
  if (zoneText !== "Z") {
    const offsetHours = Number(zoneText.slice(1, 3));
    const offsetMinutePart = Number(zoneText.slice(4, 6));
    if (offsetHours > 23 || offsetMinutePart > 59) return null;
    offsetMinutes = (offsetHours * 60 + offsetMinutePart) * (zoneText.startsWith("+") ? 1 : -1);
  }
  const utc = new Date(local.getTime() - offsetMinutes * 60_000);
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) return null;
  const fraction = microseconds && microseconds !== "000000" ? `.${microseconds}` : "";
  return `${utc.toISOString().slice(0, 19)}${fraction}Z`;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && canonicalUtcTimestamp(value) !== null;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function blocked(code: string, message: string) {
  return new DesktopTelemetryReadinessError(code, message);
}
