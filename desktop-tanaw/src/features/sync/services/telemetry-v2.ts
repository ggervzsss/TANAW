import { staffApi } from "../../../lib/axios";
import {
  DEFAULT_ML_SERVICE_BASE_URL,
  getLocalMetricsSummary,
  getMlHealth,
  getMlServiceStatus,
  getMlSession,
  getSimulationStatus,
  getSyncOutboxHealth,
  type LocalMetricsSummary,
  type LocalSyncOutboxHealth,
  type MlHealth,
  type MlServiceStatus,
  type MlSession,
  type SimulationStatus,
} from "../../camera/services/ml-service";
import { discoverAuthenticatedTelemetryIdentity } from "./telemetry-topology";
import {
  HASH_PATTERN,
  DesktopTelemetryReadinessError,
  blocked,
  canonicalJson,
  isIsoTimestamp,
  isNonNegativeSafeInteger,
  isRecord,
  isUuid,
  type DesktopTelemetryReadiness,
  type DeviceHealth,
  type EpochStartCommand,
  type MetricCoverage,
  type TelemetryIdentity,
  type TelemetryMetric,
  type TelemetryObservationCommand,
} from "./telemetry-v2-contracts";

export { DesktopTelemetryReadinessError, canonicalJson, type DesktopTelemetryReadiness, type EpochStartCommand, type TelemetryObservationCommand } from "./telemetry-v2-contracts";

const EPOCH_ENDPOINT = "/operational/desktop/telemetry-epochs/v2";
const OBSERVATION_ENDPOINT = "/operational/desktop/telemetry/v2";
const PRODUCER_STORAGE_PREFIX = "tanaw-telemetry-v2-producer";
const READINESS_STORAGE_KEY = "tanaw-telemetry-v2-readiness";

export const DESKTOP_TELEMETRY_READINESS_EVENT = "tanaw:desktop-telemetry-readiness";

type CounterBaseline = {
  observedAt: string;
  entries: number;
  exits: number;
  uniqueCount: number;
};

type PendingEpoch = {
  command: EpochStartCommand;
  payloadHash: string;
};

type PendingObservation = {
  command: TelemetryObservationCommand;
  payloadHash: string;
  nextBaseline: CounterBaseline;
};

type TelemetryProducerState = {
  schemaVersion: 1;
  enterpriseId: string;
  siteId: string;
  deviceId: string;
  cameraIds: string[];
  counterEpoch: string;
  epochGeneration: number | null;
  pendingEpoch: PendingEpoch | null;
  nextSequence: number;
  pendingObservation: PendingObservation | null;
  baseline: CounterBaseline | null;
};

export type TelemetryEvidence = {
  metrics: LocalMetricsSummary;
  session: MlSession | null;
  health: MlHealth | null;
  service: MlServiceStatus;
  simulation: SimulationStatus;
  syncOutbox: LocalSyncOutboxHealth;
};

type ProducerStorage = Pick<Storage, "getItem" | "setItem">;

type TelemetryProducerDependencies = {
  storage: ProducerStorage;
  getIdentity: () => TelemetryIdentity | Promise<TelemetryIdentity>;
  loadEvidence: () => Promise<TelemetryEvidence>;
  post: (endpoint: string, command: EpochStartCommand | TelemetryObservationCommand) => Promise<unknown>;
  now: () => Date;
  randomUuid: () => string;
  payloadHash: (payload: object) => Promise<string>;
  publishReadiness?: (readiness: DesktopTelemetryReadiness) => void;
};

export type TelemetrySyncResult = {
  epoch: EpochStartCommand | null;
  observation: TelemetryObservationCommand;
};

export function createTelemetryV2Producer(dependencies: TelemetryProducerDependencies) {
  let activeSync: Promise<TelemetrySyncResult> | null = null;

  const sync = () => {
    if (activeSync) return activeSync;
    activeSync = runTelemetrySync(dependencies)
      .catch((error: unknown) => {
        if (error instanceof DesktopTelemetryReadinessError) publishBlocked(dependencies, error);
        throw error;
      })
      .finally(() => {
        activeSync = null;
      });
    return activeSync;
  };

  return { sync };
}

async function runTelemetrySync(dependencies: TelemetryProducerDependencies): Promise<TelemetrySyncResult> {
  const identity = await dependencies.getIdentity();
  const storageKey = producerStorageKey(identity);
  let state = await loadOrCreateState(dependencies, storageKey, identity);
  let epochCommand: EpochStartCommand | null = null;

  if (state.pendingObservation) {
    const observation = state.pendingObservation.command;
    await deliverObservation(dependencies, storageKey, state);
    publishReady(dependencies);
    return { epoch: epochCommand, observation };
  }

  const evidence = await dependencies.loadEvidence();
  assertOfficialEvidence(evidence);
  const syncHealth = recordedSyncHealth(evidence.syncOutbox);
  const observedAt = toMonotonicObservedAt(dependencies.now(), state.baseline);
  const nextBaseline = baselineFromEvidence(observedAt, evidence.metrics);

  if (state.pendingEpoch) {
    epochCommand = state.pendingEpoch.command;
    state = await deliverEpoch(dependencies, storageKey, state);
  }
  if (state.baseline && countersRegressed(state.baseline, nextBaseline)) {
    state = await prepareRotatedEpoch(dependencies, storageKey, state);
    epochCommand = state.pendingEpoch?.command ?? null;
    state = await deliverEpoch(dependencies, storageKey, state);
  }

  if (state.epochGeneration === null) {
    throw blocked("TELEMETRY_EPOCH_NOT_READY", "The device telemetry epoch has not been acknowledged.");
  }

  const observation = await buildObservationCommand(dependencies, state, evidence, syncHealth, observedAt, nextBaseline);
  state = { ...state, pendingObservation: observation };
  persistState(dependencies.storage, storageKey, state);
  await deliverObservation(dependencies, storageKey, state);
  publishReady(dependencies);
  return { epoch: epochCommand, observation: observation.command };
}

async function loadOrCreateState(dependencies: TelemetryProducerDependencies, storageKey: string, identity: TelemetryIdentity): Promise<TelemetryProducerState> {
  const storedValue = dependencies.storage.getItem(storageKey);
  if (storedValue !== null) {
    const parsed = parseStoredState(storedValue, identity);
    if (!parsed) {
      throw blocked("TELEMETRY_STATE_CORRUPT", "The durable telemetry sequence state is invalid. Preserve it for support review before reprovisioning this device.");
    }
    if (!(await storedPayloadHashesMatch(dependencies, parsed))) {
      throw blocked("TELEMETRY_STATE_INTEGRITY_FAILED", "The persisted telemetry command no longer matches its payload hash. Preserve the state for support review before reprovisioning.");
    }
    const currentCameraIds = [...identity.cameraIds].sort();
    if (canonicalJson(parsed.cameraIds) !== canonicalJson(currentCameraIds)) {
      if (parsed.pendingObservation) {
        throw blocked("TELEMETRY_CAMERA_TOPOLOGY_CHANGED", "Canonical camera topology changed while an observation was pending acknowledgement.");
      }
      const refreshed = { ...parsed, cameraIds: currentCameraIds, baseline: null };
      persistState(dependencies.storage, storageKey, refreshed);
      return refreshed;
    }
    return parsed;
  }

  const counterEpoch = requireGeneratedUuid(dependencies.randomUuid());
  const command = await buildEpochCommand(dependencies, identity.deviceId, counterEpoch, null, 0);
  const state: TelemetryProducerState = {
    schemaVersion: 1,
    enterpriseId: identity.enterpriseId,
    siteId: identity.siteId,
    deviceId: identity.deviceId,
    cameraIds: [...identity.cameraIds].sort(),
    counterEpoch,
    epochGeneration: null,
    pendingEpoch: command,
    nextSequence: 0,
    pendingObservation: null,
    baseline: null,
  };
  persistState(dependencies.storage, storageKey, state);
  return state;
}

async function prepareRotatedEpoch(dependencies: TelemetryProducerDependencies, storageKey: string, state: TelemetryProducerState) {
  if (state.epochGeneration === null || state.pendingObservation) {
    throw blocked("TELEMETRY_EPOCH_ROTATION_UNSAFE", "Telemetry cannot rotate an epoch while its prior state is unsettled.");
  }
  const previousEpoch = state.counterEpoch;
  const counterEpoch = requireGeneratedUuid(dependencies.randomUuid());
  const pendingEpoch = await buildEpochCommand(dependencies, state.deviceId, counterEpoch, previousEpoch, state.epochGeneration);
  const nextState: TelemetryProducerState = {
    ...state,
    counterEpoch,
    epochGeneration: null,
    pendingEpoch,
    nextSequence: 0,
    pendingObservation: null,
    baseline: null,
  };
  persistState(dependencies.storage, storageKey, nextState);
  return nextState;
}

async function buildEpochCommand(
  dependencies: TelemetryProducerDependencies,
  deviceId: string,
  counterEpoch: string,
  expectedPreviousEpoch: string | null,
  expectedVersion: number,
): Promise<PendingEpoch> {
  const command: EpochStartCommand = {
    contractVersion: 2,
    commandId: requireGeneratedUuid(dependencies.randomUuid()),
    idempotencyKey: `telemetry-epoch:${deviceId}:${counterEpoch}`,
    occurredAt: dependencies.now().toISOString(),
    expectedVersion,
    payload: { deviceId, counterEpoch, expectedPreviousEpoch },
  };
  return { command, payloadHash: await dependencies.payloadHash(command.payload) };
}

async function buildObservationCommand(
  dependencies: TelemetryProducerDependencies,
  state: TelemetryProducerState,
  evidence: TelemetryEvidence,
  syncHealth: TelemetryObservationCommand["payload"]["syncHealth"],
  observedAt: string,
  nextBaseline: CounterBaseline,
): Promise<PendingObservation> {
  const epochGeneration = state.epochGeneration;
  if (epochGeneration === null) {
    throw blocked("TELEMETRY_EPOCH_NOT_READY", "The device telemetry epoch has not been acknowledged.");
  }
  const command: TelemetryObservationCommand = {
    contractVersion: 2,
    commandId: requireGeneratedUuid(dependencies.randomUuid()),
    idempotencyKey: `telemetry:${state.deviceId}:${state.counterEpoch}:${state.nextSequence}`,
    occurredAt: observedAt,
    expectedVersion: epochGeneration,
    payload: {
      deviceId: state.deviceId,
      counterEpoch: state.counterEpoch,
      epochGeneration,
      sequence: state.nextSequence,
      observedAt,
      metrics: telemetryMetrics(state.baseline, nextBaseline, evidence, state.cameraIds),
      deviceHealth: deviceHealth(evidence, state.cameraIds),
      syncHealth,
    },
  };
  return { command, payloadHash: await dependencies.payloadHash(command.payload), nextBaseline };
}

async function deliverEpoch(dependencies: TelemetryProducerDependencies, storageKey: string, state: TelemetryProducerState): Promise<TelemetryProducerState> {
  const pending = state.pendingEpoch;
  if (!pending) return state;
  let acknowledgement: unknown;
  try {
    acknowledgement = await dependencies.post(EPOCH_ENDPOINT, pending.command);
  } catch (error) {
    publishDeliveryFailure(dependencies, error, "TELEMETRY_EPOCH_DELIVERY_FAILED");
    throw error;
  }
  if (!isExactEpochAcknowledgement(acknowledgement, pending)) {
    const error = blocked("TELEMETRY_EPOCH_ACKNOWLEDGEMENT_MISMATCH", "The server acknowledgement did not match the exact persisted telemetry epoch command.");
    publishBlocked(dependencies, error);
    throw error;
  }
  const generation = acknowledgement.resource.epochGeneration;
  const nextState = { ...state, epochGeneration: generation, pendingEpoch: null };
  persistState(dependencies.storage, storageKey, nextState);
  return nextState;
}

async function deliverObservation(dependencies: TelemetryProducerDependencies, storageKey: string, state: TelemetryProducerState) {
  const pending = state.pendingObservation;
  if (!pending) {
    throw blocked("TELEMETRY_OBSERVATION_NOT_READY", "No persisted telemetry observation is ready for delivery.");
  }
  let acknowledgement: unknown;
  try {
    acknowledgement = await dependencies.post(OBSERVATION_ENDPOINT, pending.command);
  } catch (error) {
    publishDeliveryFailure(dependencies, error, "TELEMETRY_OBSERVATION_DELIVERY_FAILED");
    throw error;
  }
  if (!isExactObservationAcknowledgement(acknowledgement, pending, state.siteId)) {
    const error = blocked("TELEMETRY_OBSERVATION_ACKNOWLEDGEMENT_MISMATCH", "The server acknowledgement did not match the exact persisted telemetry observation command.");
    publishBlocked(dependencies, error);
    throw error;
  }
  const nextState: TelemetryProducerState = {
    ...state,
    nextSequence: pending.command.payload.sequence + 1,
    pendingObservation: null,
    baseline: pending.nextBaseline,
  };
  persistState(dependencies.storage, storageKey, nextState);
}

function telemetryMetrics(baseline: CounterBaseline | null, nextBaseline: CounterBaseline, evidence: TelemetryEvidence, cameraIds: string[]): TelemetryMetric[] {
  if (cameraIds.length !== 1 || !baseline || !evidence.session?.running || !evidence.health?.model_ready) return [];
  const coverage: MetricCoverage = {
    evidenceStatus: "not_recorded",
    monitoredSeconds: null,
    expectedSeconds: null,
    gapCount: null,
  };
  const common = {
    definitionVersion: 1 as const,
    grain: "site" as const,
    cameraId: null,
    windowStart: baseline.observedAt,
    windowEnd: nextBaseline.observedAt,
    timezone: "Asia/Manila" as const,
    provenance: "camera_derived" as const,
    quality: "estimated" as const,
    coverage,
  };
  return [
    {
      ...common,
      definition: "visitor_entries",
      value: nextBaseline.entries - baseline.entries,
      unit: "crossings",
    },
    {
      ...common,
      definition: "visitor_exits",
      value: nextBaseline.exits - baseline.exits,
      unit: "crossings",
    },
    {
      ...common,
      definition: "occupancy_current",
      value: requireCounter(evidence.metrics.current_occupancy),
      unit: "people",
    },
    {
      ...common,
      definition: "venue_local_unique_estimate",
      value: nextBaseline.uniqueCount - baseline.uniqueCount,
      unit: "estimated_visitors",
    },
  ];
}

function deviceHealth(evidence: TelemetryEvidence, cameraIds: string[]): DeviceHealth {
  const health = evidence.health;
  const session = evidence.session;
  let service: DeviceHealth["service"] = "unknown";
  if (evidence.service.error || session?.error || health?.error) service = "unavailable";
  else if (!evidence.service.running || session?.status === "stopped") service = "unavailable";
  else if (session?.running && health?.model_ready) service = "healthy";
  else if (evidence.service.running) service = "degraded";

  const analyticsFps = health?.analytics_fps;
  return {
    service,
    cameraStates: cameraHealthStates(cameraIds, evidence),
    analyticsFps: typeof analyticsFps === "number" && Number.isFinite(analyticsFps) && analyticsFps >= 0 ? analyticsFps : null,
  };
}

function cameraHealthStates(cameraIds: string[], evidence: TelemetryEvidence): DeviceHealth["cameraStates"] {
  if (cameraIds.length !== 1) {
    return cameraIds.map((cameraId) => ({ cameraId, state: "unknown" }));
  }
  const session = evidence.session;
  const normalizedStatus = `${session?.status ?? ""} ${session?.error ?? ""}`.toLowerCase();
  let state: DeviceHealth["cameraStates"][number]["state"] = "unknown";
  if (normalizedStatus.includes("credential") || normalizedStatus.includes("unauthorized")) state = "credential_error";
  else if (normalizedStatus.includes("reconnect")) state = "reconnecting";
  else if (session?.running) state = "streaming";
  else if (session?.status === "stopped") state = "stopped";
  else if (evidence.service.error || session?.error) state = "unavailable";
  return [{ cameraId: cameraIds[0], state }];
}

function recordedSyncHealth(health: LocalSyncOutboxHealth): TelemetryObservationCommand["payload"]["syncHealth"] {
  const value = health as unknown;
  if (!isRecord(value)) {
    throw blocked("TELEMETRY_SYNC_HEALTH_INVALID", "The durable report outbox returned invalid sync-health evidence.");
  }
  const pendingCount = value.pending_count;
  const oldestPendingAt = optionalTimestamp(value.oldest_pending_at);
  const lastAcknowledgedAt = optionalTimestamp(value.last_acknowledged_at);
  const lastFailureAt = optionalTimestamp(value.last_failure_at);
  const lastFailureClass = value.last_failure_class;
  if (
    !isNonNegativeSafeInteger(pendingCount) ||
    (pendingCount === 0) !== (oldestPendingAt === null) ||
    (lastFailureAt === null) !== (lastFailureClass === null) ||
    (lastFailureClass !== null && (typeof lastFailureClass !== "string" || !lastFailureClass.trim() || lastFailureClass.length > 120))
  ) {
    throw blocked("TELEMETRY_SYNC_HEALTH_INVALID", "The durable report outbox returned invalid sync-health evidence.");
  }
  return {
    evidenceStatus: "recorded",
    pendingCount,
    oldestPendingAt,
    lastAcknowledgedAt,
    lastFailureAt,
    lastFailureClass,
  };
}

function optionalTimestamp(value: unknown) {
  if (value === null) return null;
  if (!isIsoTimestamp(value)) {
    throw blocked("TELEMETRY_SYNC_HEALTH_INVALID", "The durable report outbox returned an invalid sync-health timestamp.");
  }
  return value;
}

function baselineFromEvidence(observedAt: string, metrics: LocalMetricsSummary): CounterBaseline {
  return {
    observedAt,
    entries: requireCounter(metrics.entries),
    exits: requireCounter(metrics.exits),
    uniqueCount: requireCounter(metrics.unique_count),
  };
}

function countersRegressed(previous: CounterBaseline, next: CounterBaseline) {
  return next.entries < previous.entries || next.exits < previous.exits || next.uniqueCount < previous.uniqueCount;
}

function requireCounter(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw blocked("TELEMETRY_COUNTER_INVALID", "The local telemetry ledger returned a counter that is not a non-negative safe integer.");
  }
  return value;
}

function toMonotonicObservedAt(now: Date, baseline: CounterBaseline | null) {
  const observedAt = now.toISOString();
  if (baseline && Date.parse(observedAt) <= Date.parse(baseline.observedAt)) {
    throw blocked("TELEMETRY_CLOCK_REGRESSION", "The device clock has not advanced since the last acknowledged observation. Correct the system clock before telemetry resumes.");
  }
  return observedAt;
}

function assertOfficialEvidence(evidence: TelemetryEvidence) {
  const simulation = evidence.simulation as unknown;
  const metrics = evidence.metrics as unknown;
  if (!isRecord(simulation) || !("mock_run_id" in simulation) || !("scenario" in simulation)) {
    throw blocked("SIMULATION_STATUS_UNAVAILABLE", "Simulation isolation could not be verified, so official site telemetry is paused.");
  }
  if (!isRecord(metrics) || !("source_kind" in metrics) || !("mock_run_id" in metrics)) {
    throw blocked("TELEMETRY_SOURCE_CLASSIFICATION_MISSING", "The local telemetry ledger did not provide explicit source classification, so official telemetry is paused.");
  }
  if (
    simulation.state !== "idle" ||
    simulation.running !== false ||
    simulation.paused !== false ||
    simulation.mode !== null ||
    simulation.mock_run_id !== null ||
    simulation.scenario !== null ||
    metrics.source_kind !== "real" ||
    metrics.mock_run_id !== null
  ) {
    throw blocked("SIMULATION_TELEMETRY_NOT_OFFICIAL", "Simulation-derived camera metrics are isolated locally and cannot be published as official site telemetry.");
  }
}

function parseStoredState(rawValue: string, identity: TelemetryIdentity): TelemetryProducerState | null {
  try {
    const value: unknown = JSON.parse(rawValue);
    if (!isRecord(value)) return null;
    if (
      value.schemaVersion !== 1 ||
      value.enterpriseId !== identity.enterpriseId ||
      value.siteId !== identity.siteId ||
      value.deviceId !== identity.deviceId ||
      !isUuidArray(value.cameraIds) ||
      !isUuid(value.counterEpoch) ||
      !(value.epochGeneration === null || (Number.isInteger(value.epochGeneration) && Number(value.epochGeneration) >= 1)) ||
      !Number.isSafeInteger(value.nextSequence) ||
      Number(value.nextSequence) < 0 ||
      !isBaselineOrNull(value.baseline) ||
      !isPendingEpochOrNull(value.pendingEpoch, identity.deviceId, value.counterEpoch) ||
      !isPendingObservationOrNull(value.pendingObservation, identity.deviceId, value.counterEpoch)
    ) {
      return null;
    }
    if ((value.epochGeneration === null) !== (value.pendingEpoch !== null)) return null;
    if (value.pendingObservation !== null && value.epochGeneration === null) return null;
    if (value.pendingObservation !== null) {
      const pending = value.pendingObservation as PendingObservation;
      if (
        pending.command.expectedVersion !== value.epochGeneration ||
        pending.command.payload.epochGeneration !== value.epochGeneration ||
        pending.command.payload.sequence !== value.nextSequence ||
        pending.command.payload.observedAt !== pending.nextBaseline.observedAt
      ) {
        return null;
      }
    }
    return value as TelemetryProducerState;
  } catch {
    return null;
  }
}

function isUuidArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isUuid) && new Set(value).size === value.length;
}

async function storedPayloadHashesMatch(dependencies: TelemetryProducerDependencies, state: TelemetryProducerState) {
  if (state.pendingEpoch) {
    const epochHash = await dependencies.payloadHash(state.pendingEpoch.command.payload);
    if (epochHash !== state.pendingEpoch.payloadHash) return false;
  }
  if (state.pendingObservation) {
    const observationHash = await dependencies.payloadHash(state.pendingObservation.command.payload);
    if (observationHash !== state.pendingObservation.payloadHash) return false;
  }
  return true;
}

function isPendingEpochOrNull(value: unknown, deviceId: string, counterEpoch: unknown): value is PendingEpoch | null {
  if (value === null) return true;
  if (!isRecord(value) || !HASH_PATTERN.test(String(value.payloadHash)) || !isRecord(value.command)) return false;
  const command = value.command;
  return (
    command.contractVersion === 2 &&
    isUuid(command.commandId) &&
    isIsoTimestamp(command.occurredAt) &&
    Number.isInteger(command.expectedVersion) &&
    isRecord(command.payload) &&
    command.payload.deviceId === deviceId &&
    command.payload.counterEpoch === counterEpoch &&
    command.idempotencyKey === `telemetry-epoch:${deviceId}:${String(counterEpoch)}`
  );
}

function isPendingObservationOrNull(value: unknown, deviceId: string, counterEpoch: unknown): value is PendingObservation | null {
  if (value === null) return true;
  if (!isRecord(value) || !HASH_PATTERN.test(String(value.payloadHash)) || !isBaselineOrNull(value.nextBaseline) || !value.nextBaseline) return false;
  if (!isRecord(value.command)) return false;
  const command = value.command;
  const payload = command.payload;
  if (!isRecord(payload)) return false;
  return (
    command.contractVersion === 2 &&
    isUuid(command.commandId) &&
    isIsoTimestamp(command.occurredAt) &&
    payload.deviceId === deviceId &&
    payload.counterEpoch === counterEpoch &&
    Number.isSafeInteger(payload.sequence) &&
    command.idempotencyKey === `telemetry:${deviceId}:${String(counterEpoch)}:${String(payload.sequence)}`
  );
}

function isBaselineOrNull(value: unknown): value is CounterBaseline | null {
  return (
    value === null ||
    (isRecord(value) && isIsoTimestamp(value.observedAt) && isNonNegativeSafeInteger(value.entries) && isNonNegativeSafeInteger(value.exits) && isNonNegativeSafeInteger(value.uniqueCount))
  );
}

function isExactEpochAcknowledgement(
  value: unknown,
  pending: PendingEpoch,
): value is {
  resource: { epochGeneration: number };
} {
  if (!isBaseAcknowledgement(value, pending.command.commandId, pending.payloadHash) || !isRecord(value.resource)) return false;
  return (
    isUuid(value.resource.telemetryEpochId) &&
    value.resource.deviceId === pending.command.payload.deviceId &&
    value.resource.counterEpoch === pending.command.payload.counterEpoch &&
    Number.isInteger(value.resource.epochGeneration) &&
    Number(value.resource.epochGeneration) === pending.command.expectedVersion + 1
  );
}

function isExactObservationAcknowledgement(value: unknown, pending: PendingObservation, expectedSiteId: string) {
  if (!isBaseAcknowledgement(value, pending.command.commandId, pending.payloadHash) || !isRecord(value.resource)) return false;
  const becameCurrent = value.resource.becameCurrent;
  const liveStateVersion = value.resource.liveStateVersion;
  return (
    isUuid(value.resource.observationId) &&
    value.resource.siteId === expectedSiteId &&
    value.resource.counterEpoch === pending.command.payload.counterEpoch &&
    value.resource.epochGeneration === pending.command.payload.epochGeneration &&
    value.resource.sequence === pending.command.payload.sequence &&
    typeof becameCurrent === "boolean" &&
    ((becameCurrent && Number.isInteger(liveStateVersion) && Number(liveStateVersion) >= 1) || (!becameCurrent && liveStateVersion === null))
  );
}

function isBaseAcknowledgement(value: unknown, commandId: string, payloadHash: string): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.contractVersion === 2 &&
    value.commandId === commandId &&
    (value.disposition === "created" || value.disposition === "replayed") &&
    value.payloadHash === payloadHash &&
    isIsoTimestamp(value.acknowledgedAt)
  );
}

function persistState(storage: ProducerStorage, storageKey: string, state: TelemetryProducerState) {
  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch (cause) {
    throw new DesktopTelemetryReadinessError(
      "TELEMETRY_STATE_PERSISTENCE_FAILED",
      `The durable telemetry sequence state could not be saved: ${cause instanceof Error ? cause.message : "unknown storage error"}`,
    );
  }
}

function producerStorageKey(identity: TelemetryIdentity) {
  return `${PRODUCER_STORAGE_PREFIX}:${encodeURIComponent(identity.enterpriseId)}:${identity.deviceId}`;
}

function requireGeneratedUuid(value: string) {
  if (!isUuid(value)) throw blocked("TELEMETRY_UUID_UNAVAILABLE", "A secure UUID generator is required for telemetry commands.");
  return value;
}

function publishDeliveryFailure(dependencies: TelemetryProducerDependencies, error: unknown, code: string) {
  dependencies.publishReadiness?.({
    status: "blocked",
    code,
    message: error instanceof Error ? error.message : "The telemetry command could not be delivered.",
    checkedAt: dependencies.now().toISOString(),
  });
}

function publishBlocked(dependencies: TelemetryProducerDependencies, error: unknown) {
  dependencies.publishReadiness?.({
    status: "blocked",
    code: error instanceof DesktopTelemetryReadinessError ? error.code : "TELEMETRY_NOT_READY",
    message: error instanceof Error ? error.message : "Desktop telemetry is not ready.",
    checkedAt: dependencies.now().toISOString(),
  });
}

function publishReady(dependencies: TelemetryProducerDependencies) {
  dependencies.publishReadiness?.({
    status: "ready",
    code: null,
    message: "Sequenced telemetry v2 is acknowledged and ready.",
    checkedAt: dependencies.now().toISOString(),
  });
}

async function loadProductionEvidence(): Promise<TelemetryEvidence> {
  const service = await getMlServiceStatus();
  const baseUrl = service.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
  const [metrics, session, health, simulation, syncOutbox] = await Promise.all([
    getLocalMetricsSummary(baseUrl, { includeSubmitted: true }),
    resolveOptional(() => getMlSession(baseUrl)),
    resolveOptional(() => getMlHealth(baseUrl)),
    getSimulationStatus(baseUrl),
    getSyncOutboxHealth(baseUrl),
  ]);
  return { metrics, session, health, service, simulation, syncOutbox };
}

async function resolveOptional<T>(loader: () => Promise<T>) {
  try {
    return await loader();
  } catch {
    return null;
  }
}

async function payloadHash(payload: object) {
  const canonical = canonicalJson(payload);
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function publishProductionReadiness(readiness: DesktopTelemetryReadiness) {
  try {
    window.localStorage.setItem(READINESS_STORAGE_KEY, JSON.stringify(readiness));
  } catch {
    // Durable sequence persistence is authoritative; readiness publication is best effort.
  }
  window.dispatchEvent(new CustomEvent(DESKTOP_TELEMETRY_READINESS_EVENT, { detail: readiness }));
}

export function getDesktopTelemetryReadiness(): DesktopTelemetryReadiness | null {
  const rawValue = window.localStorage.getItem(READINESS_STORAGE_KEY);
  if (!rawValue) return null;
  try {
    const value: unknown = JSON.parse(rawValue);
    if (
      !isRecord(value) ||
      (value.status !== "ready" && value.status !== "blocked") ||
      (value.status === "ready" ? value.code !== null : typeof value.code !== "string") ||
      typeof value.message !== "string" ||
      !isIsoTimestamp(value.checkedAt)
    ) {
      return null;
    }
    return value as DesktopTelemetryReadiness;
  } catch {
    return null;
  }
}

let productionProducer: ReturnType<typeof createTelemetryV2Producer> | null = null;

export const syncDesktopTelemetryV2 = () => {
  productionProducer ??= createTelemetryV2Producer({
    storage: window.localStorage,
    getIdentity: discoverAuthenticatedTelemetryIdentity,
    loadEvidence: loadProductionEvidence,
    post: async (endpoint, command) => (await staffApi.post(endpoint, command)).data,
    now: () => new Date(),
    randomUuid: () => window.crypto.randomUUID(),
    payloadHash,
    publishReadiness: publishProductionReadiness,
  });
  return productionProducer.sync();
};
