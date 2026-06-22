import { staffApi } from "../../../lib/axios";

const FLEET_SIMULATION_STORAGE_KEY = "tanaw:fleet-simulation";

export type FleetSimulationLane = "normal" | "warning" | "one-minute-breach";

export type FleetSimulationEnterprise = {
  enterpriseId: string;
  enterpriseName: string;
  category?: string | null;
  barangay?: string | null;
  isCurrent: boolean;
};

export type FleetSimulationTarget = {
  enterpriseId: string;
  enterpriseName: string;
  lane: FleetSimulationLane;
  capacity: number;
  thresholdPercent: number;
};

export type FleetSimulationState = {
  runId: string;
  state: "running" | "paused" | "stopped";
  startedAt: string;
  updatedAt: string;
  targets: FleetSimulationTarget[];
  lastSyncedAt: string | null;
  lastSnapshotCount: number;
  lastAlertCount: number;
  elapsedSeconds: number;
};

type FleetSimulationTickResponse = {
  runId: string;
  snapshots: unknown[];
  alerts: unknown[];
};

export async function listFleetSimulationEnterprises() {
  const response = await staffApi.get<FleetSimulationEnterprise[]>("/operational/simulation/fleet/enterprises");
  return response.data;
}

export function getFleetSimulationState() {
  try {
    const rawValue = window.localStorage.getItem(FLEET_SIMULATION_STORAGE_KEY);
    if (!rawValue) return null;
    const state = JSON.parse(rawValue) as FleetSimulationState;
    if (!state.runId || !Array.isArray(state.targets)) return null;
    return state;
  } catch {
    return null;
  }
}

export function startFleetSimulation(targets: FleetSimulationTarget[]) {
  const now = new Date().toISOString();
  const state: FleetSimulationState = {
    runId: createFleetRunId(),
    state: "running",
    startedAt: now,
    updatedAt: now,
    targets,
    lastSyncedAt: null,
    lastSnapshotCount: 0,
    lastAlertCount: 0,
    elapsedSeconds: 0,
  };
  setFleetSimulationState(state);
  return state;
}

export function pauseFleetSimulation() {
  const state = getFleetSimulationState();
  if (!state || state.state !== "running") return state;
  const nextState = { ...state, state: "paused" as const, updatedAt: new Date().toISOString() };
  setFleetSimulationState(nextState);
  return nextState;
}

export function resumeFleetSimulation() {
  const state = getFleetSimulationState();
  if (!state || state.state !== "paused") return state;
  const now = Date.now();
  const adjustedStartedAt = new Date(now - state.elapsedSeconds * 1000).toISOString();
  const nextState = {
    ...state,
    state: "running" as const,
    startedAt: adjustedStartedAt,
    updatedAt: new Date(now).toISOString(),
  };
  setFleetSimulationState(nextState);
  return nextState;
}

export function stopFleetSimulation() {
  const state = getFleetSimulationState();
  if (!state) return null;
  const nextState = { ...state, state: "stopped" as const, updatedAt: new Date().toISOString() };
  setFleetSimulationState(nextState);
  return nextState;
}

export async function syncFleetSimulationTelemetry() {
  const state = getFleetSimulationState();
  if (!state || state.state !== "running" || state.targets.length === 0) return null;

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000));
  const response = await staffApi.post<FleetSimulationTickResponse>("/operational/simulation/fleet/tick", {
    runId: state.runId,
    startedAt: state.startedAt,
    elapsedSeconds,
    targets: state.targets.map((target) => ({
      enterpriseId: target.enterpriseId,
      lane: target.lane,
      capacity: target.capacity,
      thresholdPercent: target.thresholdPercent,
    })),
  });
  const nextState: FleetSimulationState = {
    ...state,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    lastSnapshotCount: response.data.snapshots.length,
    lastAlertCount: response.data.alerts.length,
    elapsedSeconds,
  };
  setFleetSimulationState(nextState);
  return { state: nextState, response: response.data };
}

function setFleetSimulationState(state: FleetSimulationState) {
  window.localStorage.setItem(FLEET_SIMULATION_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("tanaw:fleet-simulation-updated", { detail: state }));
}

function createFleetRunId() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `fleet-${Date.now().toString(36)}-${randomPart}`;
}
