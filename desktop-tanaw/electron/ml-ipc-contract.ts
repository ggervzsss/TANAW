export const ML_OPERATION_NAMES = [
  "camera.health",
  "camera.test",
  "camera.start",
  "camera.stop",
  "camera.counts",
  "camera.detections",
  "camera.session",
  "context.enterprise",
  "metrics.summary",
  "metrics.history",
  "occupancy.correction",
  "reports.submit",
  "reports.list",
  "reports.purgeRaw",
  "sync.outbox.health",
  "sync.outbox.ready",
  "sync.outbox.acknowledge",
  "sync.outbox.failure",
  "session.restore",
  "simulation.prepare",
  "simulation.start",
  "simulation.pause",
  "simulation.resume",
  "simulation.stop",
  "simulation.event",
  "simulation.reset",
  "simulation.status",
] as const;

export type MlOperation = (typeof ML_OPERATION_NAMES)[number];

export type ResolvedMlRequest = {
  body?: string;
  credentialRef?: { cameraId: string; scope: string };
  method: "GET" | "POST";
  path: string;
};

type BodyOperation = {
  allowedKeys: readonly string[];
  method: "POST";
  path: string;
  payload: "body" | "camera-body";
};

type NoPayloadOperation = {
  method: "GET" | "POST";
  path: string;
  payload: "none";
};

type SpecialOperation = {
  method: "GET" | "POST";
  payload: "include-submitted" | "limit" | "mock-run-id" | "report-id-purge" | "sync-outbox-acknowledgement" | "sync-outbox-failure" | "sync-outbox-limit";
};

type OperationSpec = BodyOperation | NoPayloadOperation | SpecialOperation;

const operationSpecs: Record<MlOperation, OperationSpec> = {
  "camera.health": { method: "GET", path: "/camera/health", payload: "none" },
  "camera.test": {
    method: "POST",
    path: "/camera/test",
    payload: "camera-body",
    allowedKeys: ["camera_type", "stream_url"],
  },
  "camera.start": {
    method: "POST",
    path: "/camera/start",
    payload: "camera-body",
    allowedKeys: [
      "camera_name",
      "camera_id",
      "camera_type",
      "confidence",
      "counting_confidence",
      "entry_line",
      "event_cooldown_seconds",
      "exit_line",
      "paired_line_max_gap_seconds",
      "processing_profile",
      "runtime_backend",
      "tracker_profile",
      "pending_reid_wait_seconds",
      "reid_mode",
      "reverse_direction",
      "roi",
      "stream_fps",
      "stream_url",
      "tracking_confidence",
      "track_ttl_seconds",
      "tripwire_position",
      "unique_counting_mode",
    ],
  },
  "camera.stop": { method: "POST", path: "/camera/stop", payload: "none" },
  "camera.counts": { method: "GET", path: "/counts", payload: "none" },
  "camera.detections": { method: "GET", path: "/detections", payload: "none" },
  "camera.session": { method: "GET", path: "/session", payload: "none" },
  "context.enterprise": {
    method: "POST",
    path: "/context/enterprise",
    payload: "body",
    allowedKeys: ["enterprise_id", "enterprise_name"],
  },
  "metrics.summary": { method: "GET", payload: "include-submitted" },
  "metrics.history": { method: "GET", payload: "include-submitted" },
  "occupancy.correction": {
    method: "POST",
    path: "/occupancy/correction",
    payload: "body",
    allowedKeys: ["new_occupancy", "reason", "actor_id", "actor_name", "camera_id"],
  },
  "reports.submit": {
    method: "POST",
    path: "/reports/local-submit",
    payload: "body",
    allowedKeys: ["metrics", "notes", "payload", "period", "report_id"],
  },
  "reports.list": { method: "GET", payload: "limit" },
  "reports.purgeRaw": { method: "POST", payload: "report-id-purge" },
  "sync.outbox.health": { method: "GET", path: "/sync/outbox/health", payload: "none" },
  "sync.outbox.ready": { method: "GET", payload: "sync-outbox-limit" },
  "sync.outbox.acknowledge": { method: "POST", payload: "sync-outbox-acknowledgement" },
  "sync.outbox.failure": { method: "POST", payload: "sync-outbox-failure" },
  "session.restore": { method: "POST", path: "/session/restore", payload: "none" },
  "simulation.prepare": {
    method: "POST",
    path: "/mock/prepare",
    payload: "body",
    allowedKeys: ["mock_run_id", "enterprise_id", "enterprise_name", "entries", "exits", "unique_count", "peak_occupancy", "period"],
  },
  "simulation.start": {
    method: "POST",
    path: "/mock/start",
    payload: "body",
    allowedKeys: ["mock_run_id", "mode", "scenario", "events_per_minute", "capacity", "starting_occupancy", "duration_minutes", "threshold_percent", "entry_probability", "unique_entry_rate"],
  },
  "simulation.pause": { method: "POST", path: "/mock/pause", payload: "none" },
  "simulation.resume": { method: "POST", path: "/mock/resume", payload: "none" },
  "simulation.stop": { method: "POST", path: "/mock/stop", payload: "none" },
  "simulation.event": {
    method: "POST",
    path: "/mock/event",
    payload: "body",
    allowedKeys: ["direction"],
  },
  "simulation.reset": { method: "POST", payload: "mock-run-id" },
  "simulation.status": { method: "GET", path: "/mock/status", payload: "none" },
};

const MAX_IPC_PAYLOAD_BYTES = 1_048_576;
const MAX_IDENTIFIER_LENGTH = 240;

export function isMlOperation(value: unknown): value is MlOperation {
  return typeof value === "string" && (ML_OPERATION_NAMES as readonly string[]).includes(value);
}

export function resolveMlOperationRequest(operationInput: unknown, payload: unknown): ResolvedMlRequest {
  if (!isMlOperation(operationInput)) {
    throw new Error("Unsupported ML service operation.");
  }

  const spec = operationSpecs[operationInput];
  if (spec.payload === "none") {
    assertNoPayload(payload);
    return { method: spec.method, path: spec.path };
  }
  if (spec.payload === "body") {
    const body = validateBody(payload, spec.allowedKeys);
    return { method: spec.method, path: spec.path, body };
  }
  if (spec.payload === "camera-body") {
    if (!isObjectRecord(payload) || Object.keys(payload).some((key) => key !== "body" && key !== "credentialScope" && key !== "cameraId")) {
      throw new Error("Invalid camera credential reference payload.");
    }
    const scope = getBoundedString(payload.credentialScope, "camera credential scope");
    const cameraId = getCameraId(payload.cameraId);
    assertNoEmbeddedStreamCredentials(payload.body);
    const body = validateBody(payload.body, spec.allowedKeys);
    return { method: spec.method, path: spec.path, body, credentialRef: { cameraId, scope } };
  }
  if (spec.payload === "include-submitted") {
    const includeSubmitted = getOptionalBoolean(payload, "includeSubmitted");
    const path = operationInput === "metrics.summary" ? "/metrics/summary" : "/metrics/history";
    return { method: spec.method, path: includeSubmitted ? `${path}?include_submitted=true` : path };
  }
  if (spec.payload === "limit") {
    const limit = getBoundedInteger(payload, "limit", 1, 500, 100);
    return { method: spec.method, path: `/reports/local?limit=${limit}` };
  }
  if (spec.payload === "sync-outbox-limit") {
    const limit = getBoundedInteger(payload, "limit", 1, 500, 100);
    return { method: spec.method, path: `/sync/outbox/ready?limit=${limit}` };
  }
  if (spec.payload === "mock-run-id") {
    const mockRunId = getIdentifier(payload, "mockRunId");
    return { method: spec.method, path: `/mock/reset?mock_run_id=${encodeURIComponent(mockRunId)}` };
  }
  if (spec.payload === "sync-outbox-acknowledgement") {
    const outboxItemId = getOutboxItemId(payload);
    const body = validateExactNestedBody(payload, "acknowledgement", ["outboxItemId", "acknowledgement"]);
    return { method: spec.method, path: `/sync/outbox/${outboxItemId}/acknowledge`, body };
  }
  if (spec.payload === "sync-outbox-failure") {
    const outboxItemId = getOutboxItemId(payload);
    const body = validateBodyWithoutKey(payload, "outboxItemId", ["error_class", "error_message", "retryable", "http_status"]);
    return { method: spec.method, path: `/sync/outbox/${outboxItemId}/failure`, body };
  }

  const reportId = getIdentifier(payload, "reportId");
  return { method: spec.method, path: `/reports/local/${encodeURIComponent(reportId)}/purge-raw` };
}

function assertNoPayload(payload: unknown) {
  if (payload !== undefined && payload !== null) {
    throw new Error("This ML service operation does not accept a payload.");
  }
}

function validateBody(payload: unknown, allowedKeys: readonly string[]) {
  if (!isObjectRecord(payload)) {
    throw new Error("A validated ML service payload is required.");
  }
  const unexpectedKey = Object.keys(payload).find((key) => !allowedKeys.includes(key));
  if (unexpectedKey) {
    throw new Error("The ML service payload contains an unsupported field.");
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_IPC_PAYLOAD_BYTES) {
    throw new Error("The ML service payload is too large.");
  }
  return body;
}

function assertNoEmbeddedStreamCredentials(payload: unknown) {
  if (!isObjectRecord(payload) || typeof payload.stream_url !== "string" || /^\d+$/.test(payload.stream_url.trim())) return;
  try {
    const streamUrl = new URL(payload.stream_url);
    if (streamUrl.username || streamUrl.password) throw new Error("Camera credentials must not be embedded in a stream URL.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not be embedded")) throw error;
  }
}

function validateExactNestedBody(payload: unknown, nestedKey: string, allowedKeys: readonly string[]) {
  if (!isObjectRecord(payload) || Object.keys(payload).some((key) => !allowedKeys.includes(key)) || !isObjectRecord(payload[nestedKey])) {
    throw new Error("Invalid ML service outbox payload.");
  }
  return validateBody({ [nestedKey]: payload[nestedKey] }, [nestedKey]);
}

function validateBodyWithoutKey(payload: unknown, excludedKey: string, allowedBodyKeys: readonly string[]) {
  if (!isObjectRecord(payload) || Object.keys(payload).some((key) => key !== excludedKey && !allowedBodyKeys.includes(key))) {
    throw new Error("Invalid ML service outbox payload.");
  }
  return validateBody(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== excludedKey)), allowedBodyKeys);
}

function getOptionalBoolean(payload: unknown, key: string) {
  if (payload === undefined || payload === null) return false;
  if (!isObjectRecord(payload) || Object.keys(payload).some((candidate) => candidate !== key)) {
    throw new Error("Invalid ML service query payload.");
  }
  const value = payload[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("Invalid ML service query payload.");
  return value;
}

function getBoundedInteger(payload: unknown, key: string, minimum: number, maximum: number, defaultValue: number) {
  if (payload === undefined || payload === null) return defaultValue;
  if (!isObjectRecord(payload) || Object.keys(payload).some((candidate) => candidate !== key)) {
    throw new Error("Invalid ML service query payload.");
  }
  const value = payload[key] ?? defaultValue;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error("Invalid ML service query payload.");
  }
  return Number(value);
}

function getIdentifier(payload: unknown, key: string) {
  if (!isObjectRecord(payload) || Object.keys(payload).some((candidate) => candidate !== key)) {
    throw new Error("Invalid ML service identifier payload.");
  }
  const value = payload[key];
  if (typeof value !== "string" || !value.trim() || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error("Invalid ML service identifier payload.");
  }
  return value;
}

function getBoundedString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`Invalid ML service ${label}.`);
  }
  return value.trim();
}

function getCameraId(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new Error("Invalid ML service camera identifier.");
  }
  return String(value);
}

function getOutboxItemId(payload: unknown) {
  if (!isObjectRecord(payload)) throw new Error("Invalid ML service outbox payload.");
  const value = payload.outboxItemId;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Invalid ML service outbox identifier.");
  }
  return value.toLowerCase();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
