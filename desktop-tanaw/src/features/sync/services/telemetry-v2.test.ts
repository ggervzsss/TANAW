import { describe, expect, it, vi } from "vitest";

import {
  DesktopTelemetryReadinessError,
  canonicalJson,
  createTelemetryV2Producer,
  type DesktopTelemetryReadiness,
  type EpochStartCommand,
  type TelemetryEvidence,
  type TelemetryObservationCommand,
} from "./telemetry-v2";
import { selectTelemetryIdentity } from "./telemetry-topology";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "99999999-9999-4999-8999-999999999999";
const ENTERPRISE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CAMERA_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SECOND_CAMERA_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OBSERVATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TELEMETRY_EPOCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("sequenced desktop telemetry v2 producer", () => {
  it("persists and acknowledges the first epoch before sequence zero", async () => {
    const harness = producerHarness();

    const result = await harness.producer.sync();

    expect(harness.posted.map((item) => item.endpoint)).toEqual(["/operational/desktop/telemetry-epochs/v2", "/operational/desktop/telemetry/v2"]);
    expect(result.epoch).toMatchObject({
      contractVersion: 2,
      expectedVersion: 0,
      payload: { deviceId: DEVICE_ID, expectedPreviousEpoch: null },
    });
    expect(result.observation).toMatchObject({
      contractVersion: 2,
      expectedVersion: 1,
      payload: {
        deviceId: DEVICE_ID,
        epochGeneration: 1,
        sequence: 0,
        metrics: [],
        syncHealth: {
          evidenceStatus: "recorded",
          pendingCount: 0,
          oldestPendingAt: null,
          lastAcknowledgedAt: null,
          lastFailureAt: null,
          lastFailureClass: null,
        },
      },
    });
    expect(result.observation.idempotencyKey).toBe(`telemetry:${DEVICE_ID}:${result.epoch?.payload.counterEpoch}:0`);
    expect(harness.persistedState()).toMatchObject({
      enterpriseId: ENTERPRISE_ID,
      siteId: SITE_ID,
      deviceId: DEVICE_ID,
      cameraIds: [CAMERA_ID],
      epochGeneration: 1,
      nextSequence: 1,
      pendingEpoch: null,
      pendingObservation: null,
    });
  });

  it("continues its durable epoch and increments sequence after a producer restart", async () => {
    const harness = producerHarness();
    const first = await harness.producer.sync();
    const restarted = harness.recreateProducer();

    const second = await restarted.sync();

    expect(second.epoch).toBeNull();
    expect(second.observation.payload.counterEpoch).toBe(first.observation.payload.counterEpoch);
    expect(second.observation.payload.epochGeneration).toBe(1);
    expect(second.observation.payload.sequence).toBe(1);
    expect(second.observation.payload.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definition: "visitor_entries", value: 3 }),
        expect.objectContaining({ definition: "visitor_exits", value: 1 }),
        expect.objectContaining({ definition: "occupancy_current", value: 5 }),
        expect.objectContaining({ definition: "venue_local_unique_estimate", value: 2 }),
      ]),
    );
    expect(second.observation.payload.deviceHealth.cameraStates).toEqual([{ cameraId: CAMERA_ID, state: "streaming" }]);
    expect(harness.posted.filter((item) => item.endpoint.includes("telemetry-epochs")).length).toBe(1);
    expect(harness.persistedState()).toMatchObject({ nextSequence: 2, pendingObservation: null });
  });

  it("never promotes one local camera session to site metrics for multi-camera topology", async () => {
    const harness = producerHarness({
      getIdentity: () => ({
        enterpriseId: ENTERPRISE_ID,
        siteId: SITE_ID,
        deviceId: DEVICE_ID,
        cameraIds: [CAMERA_ID, SECOND_CAMERA_ID],
      }),
    });
    await harness.producer.sync();

    const second = await harness.producer.sync();

    expect(second.observation.payload.metrics).toEqual([]);
    expect(second.observation.payload.deviceHealth.cameraStates).toEqual([
      { cameraId: SECOND_CAMERA_ID, state: "unknown" },
      { cameraId: CAMERA_ID, state: "unknown" },
    ]);
  });

  it("starts a new acknowledged epoch when durable counters regress", async () => {
    const harness = producerHarness({
      evidence: [officialEvidence({ entries: 12, exits: 5, uniqueCount: 9 }), officialEvidence({ entries: 2, exits: 1, uniqueCount: 2 })],
    });
    const first = await harness.producer.sync();

    const second = await harness.producer.sync();

    expect(second.epoch).toMatchObject({
      expectedVersion: 1,
      payload: {
        deviceId: DEVICE_ID,
        expectedPreviousEpoch: first.observation.payload.counterEpoch,
      },
    });
    expect(second.epoch?.payload.counterEpoch).not.toBe(first.observation.payload.counterEpoch);
    expect(second.observation).toMatchObject({
      expectedVersion: 2,
      payload: { epochGeneration: 2, sequence: 0, metrics: [] },
    });
    expect(harness.persistedState()).toMatchObject({ epochGeneration: 2, nextSequence: 1 });
  });

  it("retries the exact persisted observation identity and payload hash", async () => {
    let failObservationOnce = true;
    const harness = producerHarness({
      beforePost: (endpoint) => {
        if (endpoint.endsWith("/telemetry/v2") && failObservationOnce) {
          failObservationOnce = false;
          throw new Error("network unavailable");
        }
      },
    });

    await expect(harness.producer.sync()).rejects.toThrow("network unavailable");
    const pending = harness.persistedState().pendingObservation as {
      command: TelemetryObservationCommand;
      payloadHash: string;
    };
    const firstAttempt = harness.posted.filter((item) => item.endpoint.endsWith("/telemetry/v2"))[0];

    const result = await harness.recreateProducer().sync();
    const retry = harness.posted.filter((item) => item.endpoint.endsWith("/telemetry/v2"))[1];

    expect(retry.command).toEqual(firstAttempt.command);
    expect(result.observation).toEqual(pending.command);
    expect(await testPayloadHash(retry.command.payload)).toBe(pending.payloadHash);
    expect(harness.loadEvidence).toHaveBeenCalledTimes(1);
    expect(harness.persistedState()).toMatchObject({ nextSequence: 1, pendingObservation: null });
  });

  it("retries the exact persisted epoch after restart before sending sequence zero", async () => {
    let failEpochOnce = true;
    const harness = producerHarness({
      beforePost: (endpoint) => {
        if (endpoint.endsWith("/telemetry-epochs/v2") && failEpochOnce) {
          failEpochOnce = false;
          throw new Error("epoch acknowledgement lost");
        }
      },
    });

    await expect(harness.producer.sync()).rejects.toThrow("epoch acknowledgement lost");
    const pending = harness.persistedState().pendingEpoch as { command: EpochStartCommand; payloadHash: string };
    const firstAttempt = harness.posted[0];

    const result = await harness.recreateProducer().sync();

    expect(harness.posted[1]).toEqual(firstAttempt);
    expect(result.epoch).toEqual(pending.command);
    expect(await testPayloadHash(result.epoch?.payload ?? {})).toBe(pending.payloadHash);
    expect(result.observation.payload.sequence).toBe(0);
    expect(harness.persistedState()).toMatchObject({ epochGeneration: 1, nextSequence: 1, pendingEpoch: null });
  });

  it("publishes complete durable outbox health without using event counts", async () => {
    const evidence = officialEvidence({ entries: 10, exits: 4, uniqueCount: 7 });
    evidence.metrics.unsynced_events = 999;
    evidence.syncOutbox = {
      pending_count: 2,
      oldest_pending_at: "2026-07-13T07:30:00.123456+00:00",
      last_acknowledged_at: "2026-07-13T07:00:00+00:00",
      last_failure_at: "2026-07-13T07:45:00+00:00",
      last_failure_class: "network_error",
    };
    const harness = producerHarness({ evidence: [evidence] });

    const result = await harness.producer.sync();

    expect(result.observation.payload.syncHealth).toEqual({
      evidenceStatus: "recorded",
      pendingCount: 2,
      oldestPendingAt: "2026-07-13T07:30:00.123456+00:00",
      lastAcknowledgedAt: "2026-07-13T07:00:00+00:00",
      lastFailureAt: "2026-07-13T07:45:00+00:00",
      lastFailureClass: "network_error",
    });
    expect(result.observation.payload.syncHealth.pendingCount).not.toBe(evidence.metrics.unsynced_events);
  });

  it("fails closed instead of fabricating health when durable outbox evidence is inconsistent", async () => {
    const evidence = officialEvidence({ entries: 10, exits: 4, uniqueCount: 7 });
    evidence.syncOutbox = {
      pending_count: 0,
      oldest_pending_at: "2026-07-13T07:30:00+00:00",
      last_acknowledged_at: null,
      last_failure_at: null,
      last_failure_class: null,
    };
    const harness = producerHarness({ evidence: [evidence] });

    await expect(harness.producer.sync()).rejects.toMatchObject({ code: "TELEMETRY_SYNC_HEALTH_INVALID" });

    expect(harness.posted).toEqual([]);
  });

  it("never publishes simulation-derived evidence as official telemetry", async () => {
    const simulated = officialEvidence({ entries: 40, exits: 15, uniqueCount: 31 });
    simulated.metrics.source_kind = "mock";
    simulated.metrics.mock_run_id = "simulation-run";
    const readiness = vi.fn();
    const harness = producerHarness({ evidence: [simulated], publishReadiness: readiness });

    await expect(harness.producer.sync()).rejects.toMatchObject({ code: "SIMULATION_TELEMETRY_NOT_OFFICIAL" });

    expect(harness.posted).toEqual([]);
    expect(readiness).toHaveBeenLastCalledWith(expect.objectContaining({ status: "blocked", code: "SIMULATION_TELEMETRY_NOT_OFFICIAL" }));
  });

  it("fails closed when source classification or simulation isolation evidence is absent", async () => {
    const missingSource = officialEvidence({ entries: 1, exits: 0, uniqueCount: 1 });
    delete (missingSource.metrics as Partial<typeof missingSource.metrics>).source_kind;
    const missingSimulation = officialEvidence({ entries: 1, exits: 0, uniqueCount: 1 });
    (missingSimulation as unknown as { simulation: null }).simulation = null;

    const sourceHarness = producerHarness({ evidence: [missingSource] });
    const simulationHarness = producerHarness({ evidence: [missingSimulation] });

    await expect(sourceHarness.producer.sync()).rejects.toMatchObject({ code: "TELEMETRY_SOURCE_CLASSIFICATION_MISSING" });
    await expect(simulationHarness.producer.sync()).rejects.toMatchObject({ code: "SIMULATION_STATUS_UNAVAILABLE" });
    expect(sourceHarness.posted).toEqual([]);
    expect(simulationHarness.posted).toEqual([]);
  });

  it("canonicalizes timestamps exactly like the backend before hashing", () => {
    expect(
      canonicalJson({
        windowEnd: "2026-07-13T16:15:03.420+08:00",
        observedAt: "2026-07-13T08:15:03.000Z",
        oldestPendingAt: "2026-07-13T08:14:33.310123+00:00",
      }),
    ).toBe('{"observedAt":"2026-07-13T08:15:03Z","oldestPendingAt":"2026-07-13T08:14:33.310123Z","windowEnd":"2026-07-13T08:15:03.420000Z"}');
  });

  it("fails closed with actionable readiness when canonical topology identity is missing", async () => {
    const readiness = vi.fn();
    const harness = producerHarness({
      getIdentity: () => {
        throw new DesktopTelemetryReadinessError("TELEMETRY_TOPOLOGY_NOT_READY", "Provision one active site device, then sign in again.");
      },
      publishReadiness: readiness,
    });

    await expect(harness.producer.sync()).rejects.toMatchObject({
      code: "TELEMETRY_TOPOLOGY_NOT_READY",
    });

    expect(harness.posted).toEqual([]);
    expect(harness.loadEvidence).not.toHaveBeenCalled();
    expect(readiness).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "blocked",
        code: "TELEMETRY_TOPOLOGY_NOT_READY",
        message: expect.stringContaining("Provision one active site device"),
      }),
    );
  });

  it("selects one canonical ready topology and rejects zero or multiple ready sites", () => {
    const readySite = topologySite(SITE_ID, DEVICE_ID, CAMERA_ID);

    expect(selectTelemetryIdentity([readySite])).toEqual({
      enterpriseId: ENTERPRISE_ID,
      siteId: SITE_ID,
      deviceId: DEVICE_ID,
      cameraIds: [CAMERA_ID],
    });
    expect(() => selectTelemetryIdentity([{ ...readySite, topologyStatus: "unlinked", devices: [] }])).toThrowError(expect.objectContaining({ code: "TELEMETRY_TOPOLOGY_NOT_READY" }));
    expect(() =>
      selectTelemetryIdentity([readySite, topologySite("12121212-1212-4121-8121-121212121212", "13131313-1313-4131-8131-131313131313", "14141414-1414-4141-8141-141414141414")]),
    ).toThrowError(expect.objectContaining({ code: "TELEMETRY_TOPOLOGY_AMBIGUOUS" }));
  });
});

type PostedCommand = {
  endpoint: string;
  command: EpochStartCommand | TelemetryObservationCommand;
};

function producerHarness(
  options: {
    evidence?: TelemetryEvidence[];
    beforePost?: (endpoint: string, command: EpochStartCommand | TelemetryObservationCommand) => void;
    getIdentity?: () => { enterpriseId: string; siteId: string; deviceId: string; cameraIds: string[] };
    publishReadiness?: (readiness: DesktopTelemetryReadiness) => void;
  } = {},
) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const uuidValues = [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];
  let uuidIndex = 0;
  let timeIndex = 0;
  let evidenceIndex = 0;
  const evidence = options.evidence ?? [officialEvidence({ entries: 10, exits: 4, uniqueCount: 7 }), officialEvidence({ entries: 13, exits: 5, uniqueCount: 9 })];
  const loadEvidence = vi.fn(async () => evidence[Math.min(evidenceIndex++, evidence.length - 1)]);
  const posted: PostedCommand[] = [];
  const post = async (endpoint: string, command: EpochStartCommand | TelemetryObservationCommand) => {
    posted.push({ endpoint, command: structuredClone(command) });
    options.beforePost?.(endpoint, command);
    const hash = await testPayloadHash(command.payload);
    if (endpoint.includes("telemetry-epochs")) {
      return {
        contractVersion: 2,
        commandId: command.commandId,
        disposition: "created",
        payloadHash: hash,
        acknowledgedAt: "2026-07-13T08:00:10.000Z",
        resource: {
          telemetryEpochId: TELEMETRY_EPOCH_ID,
          deviceId: command.payload.deviceId,
          counterEpoch: (command as EpochStartCommand).payload.counterEpoch,
          epochGeneration: command.expectedVersion + 1,
        },
      };
    }
    const observation = command as TelemetryObservationCommand;
    return {
      contractVersion: 2,
      commandId: command.commandId,
      disposition: "created",
      payloadHash: hash,
      acknowledgedAt: "2026-07-13T08:00:10.000Z",
      resource: {
        observationId: OBSERVATION_ID,
        siteId: SITE_ID,
        counterEpoch: observation.payload.counterEpoch,
        epochGeneration: observation.payload.epochGeneration,
        sequence: observation.payload.sequence,
        liveStateVersion: observation.payload.sequence + 1,
        becameCurrent: true,
      },
    };
  };
  const dependencies = () => ({
    storage,
    getIdentity: options.getIdentity ?? (() => ({ enterpriseId: ENTERPRISE_ID, siteId: SITE_ID, deviceId: DEVICE_ID, cameraIds: [CAMERA_ID] })),
    loadEvidence,
    post,
    now: () => new Date(Date.UTC(2026, 6, 13, 8, 0, timeIndex++)),
    randomUuid: () => uuidValues[uuidIndex++] ?? "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    payloadHash: testPayloadHash,
    publishReadiness: options.publishReadiness,
  });
  let producer = createTelemetryV2Producer(dependencies());
  return {
    producer,
    posted,
    loadEvidence,
    recreateProducer: () => {
      producer = createTelemetryV2Producer(dependencies());
      return producer;
    },
    persistedState: () => {
      const rawValue = [...values.entries()].find(([key]) => key.startsWith("tanaw-telemetry-v2-producer:"))?.[1];
      if (!rawValue) throw new Error("Expected persisted telemetry state.");
      return JSON.parse(rawValue) as Record<string, unknown>;
    },
  };
}

function topologySite(siteId: string, deviceId: string, cameraId: string) {
  return {
    siteId,
    enterpriseId: ENTERPRISE_ID,
    enterpriseLifecycleState: "active" as const,
    classification: "official" as const,
    topologyStatus: "ready" as const,
    devices: [
      {
        deviceId,
        lifecycleState: "active" as const,
        cameras: [{ cameraId, lifecycleState: "active" as const }],
      },
    ],
  };
}

function officialEvidence(counters: { entries: number; exits: number; uniqueCount: number }): TelemetryEvidence {
  return {
    metrics: {
      entries: counters.entries,
      exits: counters.exits,
      peak_occupancy: 8,
      current_occupancy: 5,
      unique_count: counters.uniqueCount,
      estimated_unique_count: counters.uniqueCount,
      confirmed_unique_count: counters.uniqueCount,
      degraded_unique_count: 0,
      pending_unique_entries: 0,
      repeat_entry_count: 0,
      occupancy_correction_delta: 0,
      total_events: counters.entries + counters.exits,
      unsubmitted_events: 0,
      unsynced_events: 0,
      first_event_at: "2026-07-13T07:00:00.000Z",
      last_event_at: "2026-07-13T08:00:00.000Z",
      source_kind: "real",
      mock_run_id: null,
      period: "Jul 1 - Jul 31, 2026",
    },
    session: {
      running: true,
      status: "running",
      error: null,
      camera_id: 17,
      camera_name: "Local camera",
      counts: {
        entry: counters.entries,
        exit: counters.exits,
        occupancy: 5,
        running: true,
        status: "running",
        started_at: "2026-07-13T07:00:00.000Z",
        error: null,
      },
      updated_at: "2026-07-13T08:00:00.000Z",
    },
    health: {
      status: "ok",
      running: true,
      error: null,
      model_ready: true,
      analytics_fps: 24,
    } as TelemetryEvidence["health"],
    service: { baseUrl: "tanaw-ml://local", error: null, pid: 12, running: true },
    simulation: {
      running: false,
      paused: false,
      state: "idle",
      mode: null,
      scenario: null,
      mock_run_id: null,
      events_generated: 0,
      events_per_minute: 0,
      requires_real_camera: false,
      enterprise_id: null,
      enterprise_name: null,
      capacity: 0,
      threshold_percent: 90,
      duration_minutes: null,
      started_at: null,
      completed_at: null,
      entries: 0,
      exits: 0,
      current_occupancy: 0,
      peak_occupancy: 0,
      unique_count: 0,
      unsubmitted_events: 0,
    },
    syncOutbox: {
      pending_count: 0,
      oldest_pending_at: null,
      last_acknowledged_at: null,
      last_failure_at: null,
      last_failure_class: null,
    },
  };
}

async function testPayloadHash(payload: object) {
  const value = canonicalJson(payload);
  let accumulator = 0n;
  for (const character of value) {
    accumulator = (accumulator * 131n + BigInt(character.codePointAt(0) ?? 0)) % (1n << 256n);
  }
  return `sha256:${accumulator.toString(16).padStart(64, "0")}`;
}
