import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Building2, Pause, Play, RadioTower, RotateCcw, Square, Users } from "lucide-react";
import { ConfirmationDialog } from "../../../components/ConfirmationDialog";
import {
  getFleetSimulationState,
  listFleetSimulationEnterprises,
  pauseFleetSimulation,
  resumeFleetSimulation,
  startFleetSimulation,
  stopFleetSimulation,
  type FleetSimulationEnterprise,
  type FleetSimulationLane,
  type FleetSimulationState,
  type FleetSimulationTarget,
} from "../../sync/services/fleet-simulation";
import {
  appendSimulationEvent,
  getSimulationStatus,
  pauseSimulation,
  resetSimulation,
  resumeSimulation,
  startSimulation,
  stopSimulation,
  type SimulationScenario,
  type SimulationStatus,
} from "../services/ml-service";

type SimulationLabProps = {
  baseUrl: string;
  defaultThresholdPercent: number;
};

type ScenarioPreset = {
  label: string;
  description: string;
  eventsPerMinute: number;
  entryProbability: number | null;
};

const scenarioPresets: Record<SimulationScenario, ScenarioPreset> = {
  normal: {
    label: "Normal Business Day",
    description: "Balanced entries and exits with moderate changes in occupancy.",
    eventsPerMinute: 12,
    entryProbability: null,
  },
  "morning-rush": {
    label: "Morning Rush",
    description: "A strong arrival period that gradually settles as the venue fills.",
    eventsPerMinute: 30,
    entryProbability: null,
  },
  "event-opening": {
    label: "Event Opening",
    description: "Rapid arrivals designed to fill an event venue quickly.",
    eventsPerMinute: 45,
    entryProbability: null,
  },
  overcrowding: {
    label: "Overcrowding",
    description: "Entries continue past the alert threshold to exercise critical alerts.",
    eventsPerMinute: 60,
    entryProbability: null,
  },
  evacuation: {
    label: "Evacuation",
    description: "Occupancy falls rapidly through a sustained stream of exits.",
    eventsPerMinute: 60,
    entryProbability: null,
  },
  custom: {
    label: "Custom",
    description: "Choose the event rate and entry-to-exit balance yourself.",
    eventsPerMinute: 20,
    entryProbability: 0.6,
  },
};

export function SimulationLab({ baseUrl, defaultThresholdPercent }: SimulationLabProps) {
  const [scenario, setScenario] = useState<SimulationScenario>("normal");
  const [capacity, setCapacity] = useState(100);
  const [startingOccupancy, setStartingOccupancy] = useState(10);
  const [eventsPerMinute, setEventsPerMinute] = useState(scenarioPresets.normal.eventsPerMinute);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [thresholdPercent, setThresholdPercent] = useState(defaultThresholdPercent);
  const [entryPercent, setEntryPercent] = useState(60);
  const [uniqueEntryPercent, setUniqueEntryPercent] = useState(88);
  const [status, setStatus] = useState<SimulationStatus | null>(null);
  const [fleetEnterprises, setFleetEnterprises] = useState<FleetSimulationEnterprise[]>([]);
  const [fleetState, setFleetState] = useState<FleetSimulationState | null>(null);
  const [fleetEnterpriseCount, setFleetEnterpriseCount] = useState(6);
  const [fleetWarningCount, setFleetWarningCount] = useState(2);
  const [fleetBreachCount, setFleetBreachCount] = useState(1);
  const [fleetCapacity, setFleetCapacity] = useState(100);
  const [fleetThresholdPercent, setFleetThresholdPercent] = useState(defaultThresholdPercent);
  const [error, setError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isFleetBusy, setIsFleetBusy] = useState(false);
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getSimulationStatus(baseUrl));
      setError(null);
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    }
  }, [baseUrl]);

  useEffect(() => {
    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), 1000);
    return () => window.clearInterval(intervalId);
  }, [refreshStatus]);

  useEffect(() => {
    setThresholdPercent(defaultThresholdPercent);
    setFleetThresholdPercent(defaultThresholdPercent);
  }, [defaultThresholdPercent]);

  useEffect(() => {
    let disposed = false;
    const refreshFleetState = () => setFleetState(getFleetSimulationState());

    const loadFleetEnterprises = async () => {
      try {
        const enterprises = await listFleetSimulationEnterprises();
        if (disposed) return;
        setFleetEnterprises(enterprises);
        setFleetEnterpriseCount((current) => clampNumber(current, 1, Math.max(1, enterprises.length)));
        setFleetError(null);
      } catch (requestError) {
        if (!disposed) {
          setFleetError(toErrorMessage(requestError));
        }
      }
    };

    refreshFleetState();
    void loadFleetEnterprises();
    const intervalId = window.setInterval(refreshFleetState, 1000);
    window.addEventListener("tanaw:fleet-simulation-updated", refreshFleetState);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("tanaw:fleet-simulation-updated", refreshFleetState);
    };
  }, []);

  const occupancyPercent = useMemo(() => {
    if (!status?.capacity) return 0;
    return Math.round((status.current_occupancy / status.capacity) * 100);
  }, [status]);
  const thresholdBreached = Boolean(status?.capacity && occupancyPercent >= status.threshold_percent);
  const isActive = status?.state === "running" || status?.state === "paused";
  const isFleetActive = fleetState?.state === "running" || fleetState?.state === "paused";
  const availableFleetCount = Math.max(1, fleetEnterprises.length);
  const fleetLaneCounts = useMemo(() => countFleetLanes(fleetState?.targets ?? []), [fleetState]);

  const chooseScenario = (nextScenario: SimulationScenario) => {
    const preset = scenarioPresets[nextScenario];
    setScenario(nextScenario);
    setEventsPerMinute(preset.eventsPerMinute);
    if (preset.entryProbability !== null) {
      setEntryPercent(Math.round(preset.entryProbability * 100));
    }
  };

  const runAction = async (action: () => Promise<SimulationStatus>) => {
    setIsBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleStart = () => {
    if (startingOccupancy > capacity) {
      setError("Starting occupancy cannot exceed venue capacity.");
      return;
    }

    const runId = createSimulationRunId();
    void runAction(() =>
      startSimulation(baseUrl, {
        runId,
        scenario,
        eventsPerMinute,
        capacity,
        startingOccupancy,
        durationMinutes: durationMinutes > 0 ? durationMinutes : null,
        thresholdPercent,
        entryProbability: scenario === "custom" ? entryPercent / 100 : null,
        uniqueEntryRate: uniqueEntryPercent / 100,
      }),
    );
  };

  const handleReset = async () => {
    if (!status?.mock_run_id) return;
    setShowResetConfirmation(false);
    setIsBusy(true);
    setError(null);
    try {
      await resetSimulation(baseUrl, status.mock_run_id);
      await refreshStatus();
    } catch (requestError) {
      setError(toErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartFleet = () => {
    setIsFleetBusy(true);
    setFleetError(null);
    try {
      const targets = buildFleetTargets({
        enterprises: fleetEnterprises,
        enterpriseCount: fleetEnterpriseCount,
        warningCount: fleetWarningCount,
        breachCount: fleetBreachCount,
        capacity: fleetCapacity,
        thresholdPercent: fleetThresholdPercent,
      });
      if (targets.length === 0) {
        throw new Error("No registered enterprises are available for fleet simulation.");
      }
      setFleetState(startFleetSimulation(targets));
    } catch (requestError) {
      setFleetError(toErrorMessage(requestError));
    } finally {
      setIsFleetBusy(false);
    }
  };

  const handleFleetAction = (action: () => FleetSimulationState | null) => {
    setFleetError(null);
    setFleetState(action());
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-gray-200 bg-white shadow-md">
      {showResetConfirmation && (
        <ConfirmationDialog
          cancelLabel="Keep Simulation Data"
          confirmLabel="Reset Simulation"
          onCancel={() => setShowResetConfirmation(false)}
          onConfirm={() => void handleReset()}
          title="Reset Live Simulation"
          variant="danger"
        >
          <p>This removes the events generated by the current simulation run. Real camera events and submitted reports are preserved.</p>
        </ConfirmationDialog>
      )}

      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-[#065f46]" />
            <h3 className="text-base font-black text-[#111827]">Simulation Lab</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black tracking-wider text-amber-800 uppercase">Virtual Sensor</span>
          </div>
          <p className="mt-1 text-xs font-medium text-gray-500">Generate live entry and exit events without starting a CCTV camera.</p>
        </div>
        <SimulationStateBadge status={status} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-5 overflow-y-auto bg-gray-50 p-5 max-lg:grid-cols-1">
        <section className="space-y-4 rounded-sm border border-gray-200 bg-white p-4 shadow-sm">
          <div>
            <label className="text-[11px] font-black tracking-wider text-gray-500 uppercase">Scenario</label>
            <select
              value={scenario}
              disabled={isActive}
              onChange={(event) => chooseScenario(event.target.value as SimulationScenario)}
              className="mt-1.5 w-full rounded-sm border border-gray-300 px-3 py-2 text-sm font-bold text-[#111827] outline-none focus:border-[#065f46] disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              {Object.entries(scenarioPresets).map(([value, preset]) => (
                <option key={value} value={value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">{scenarioPresets[scenario].description}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Venue Capacity" value={capacity} min={1} max={100000} disabled={isActive} onChange={setCapacity} />
            <NumberField label="Starting Occupancy" value={startingOccupancy} min={0} max={5000} disabled={isActive} onChange={setStartingOccupancy} />
            <NumberField label="Events / Minute" value={eventsPerMinute} min={1} max={120} disabled={isActive} onChange={setEventsPerMinute} />
            <NumberField label="Duration (Minutes)" value={durationMinutes} min={0} max={1440} disabled={isActive} onChange={setDurationMinutes} />
            <NumberField label="Alert Threshold %" value={thresholdPercent} min={1} max={100} disabled={isActive} onChange={setThresholdPercent} />
            <NumberField label="Unique Entry %" value={uniqueEntryPercent} min={0} max={100} disabled={isActive} onChange={setUniqueEntryPercent} />
          </div>

          {scenario === "custom" && <NumberField label="Entry Probability %" value={entryPercent} min={0} max={100} disabled={isActive} onChange={setEntryPercent} />}

          <p className="rounded-sm border border-emerald-100 bg-emerald-50 p-3 text-[11px] leading-relaxed font-medium text-emerald-900">
            A duration of 0 runs until you stop it. Events are stored in the normal local ledger and synchronize through TANAW’s existing five-second telemetry cycle.
          </p>

          {error && <p className="rounded-sm border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}

          <div className="flex flex-wrap gap-2">
            {!isActive && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleStart}
                className="flex items-center gap-2 rounded-sm bg-[#065f46] px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Play size={15} /> Start Simulation
              </button>
            )}
            {status?.state === "running" && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction(() => pauseSimulation(baseUrl))}
                className="flex items-center gap-2 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black text-amber-800"
              >
                <Pause size={15} /> Pause
              </button>
            )}
            {status?.state === "paused" && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction(() => resumeSimulation(baseUrl))}
                className="flex items-center gap-2 rounded-sm bg-[#065f46] px-4 py-2 text-xs font-black text-white"
              >
                <Play size={15} /> Resume
              </button>
            )}
            {isActive && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction(() => stopSimulation(baseUrl))}
                className="flex items-center gap-2 rounded-sm border border-gray-300 bg-white px-4 py-2 text-xs font-black text-gray-700"
              >
                <Square size={14} /> Stop
              </button>
            )}
            {status?.mock_run_id && status.scenario && (
              <button
                type="button"
                disabled={isBusy || isActive}
                onClick={() => setShowResetConfirmation(true)}
                className="flex items-center gap-2 rounded-sm border border-red-200 bg-white px-4 py-2 text-xs font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} /> Reset Data
              </button>
            )}
          </div>

          <div className="rounded-sm border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[#065f46]">
                  <Building2 size={17} />
                  <p className="text-sm font-black text-[#111827]">Fleet Simulation</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-emerald-900">
                  Include registered enterprises in one citywide test: normal lanes, warning lanes, and one-minute threshold breach lanes that recover automatically.
                </p>
              </div>
              <FleetStateBadge state={fleetState?.state ?? "stopped"} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <NumberField label="Enterprises" value={fleetEnterpriseCount} min={1} max={availableFleetCount} disabled={isFleetActive} onChange={setFleetEnterpriseCount} />
              <NumberField label="Warning Lanes" value={fleetWarningCount} min={0} max={availableFleetCount} disabled={isFleetActive} onChange={setFleetWarningCount} />
              <NumberField label="Breach Lanes" value={fleetBreachCount} min={0} max={availableFleetCount} disabled={isFleetActive} onChange={setFleetBreachCount} />
              <NumberField label="Fleet Capacity" value={fleetCapacity} min={1} max={100000} disabled={isFleetActive} onChange={setFleetCapacity} />
              <NumberField label="Fleet Threshold %" value={fleetThresholdPercent} min={1} max={100} disabled={isFleetActive} onChange={setFleetThresholdPercent} />
            </div>

            <p className="mt-3 text-[11px] leading-relaxed font-medium text-emerald-900">
              The current desktop enterprise is skipped when enough other enterprises exist, so this can run beside the local virtual sensor without fighting over the same telemetry.
            </p>

            {fleetError && <p className="mt-3 rounded-sm border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{fleetError}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              {!isFleetActive && (
                <button
                  type="button"
                  disabled={isFleetBusy || fleetEnterprises.length === 0}
                  onClick={handleStartFleet}
                  className="flex items-center gap-2 rounded-sm bg-[#065f46] px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  <RadioTower size={15} /> Start Fleet Test
                </button>
              )}
              {fleetState?.state === "running" && (
                <button
                  type="button"
                  disabled={isFleetBusy}
                  onClick={() => handleFleetAction(pauseFleetSimulation)}
                  className="flex items-center gap-2 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black text-amber-800"
                >
                  <Pause size={15} /> Pause Fleet
                </button>
              )}
              {fleetState?.state === "paused" && (
                <button
                  type="button"
                  disabled={isFleetBusy}
                  onClick={() => handleFleetAction(resumeFleetSimulation)}
                  className="flex items-center gap-2 rounded-sm bg-[#065f46] px-4 py-2 text-xs font-black text-white"
                >
                  <Play size={15} /> Resume Fleet
                </button>
              )}
              {isFleetActive && (
                <button
                  type="button"
                  disabled={isFleetBusy}
                  onClick={() => handleFleetAction(stopFleetSimulation)}
                  className="flex items-center gap-2 rounded-sm border border-gray-300 bg-white px-4 py-2 text-xs font-black text-gray-700"
                >
                  <Square size={14} /> Stop Fleet
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard label="Entries" value={status?.entries ?? 0} icon={<ArrowDownToLine size={18} />} />
            <MetricCard label="Exits" value={status?.exits ?? 0} icon={<ArrowUpFromLine size={18} />} />
            <MetricCard label="Live Occupancy" value={status?.current_occupancy ?? 0} icon={<Users size={18} />} critical={thresholdBreached} />
            <MetricCard label="Peak Occupancy" value={status?.peak_occupancy ?? 0} icon={<Activity size={18} />} />
          </div>

          <div className={`rounded-sm border bg-white p-5 shadow-sm ${thresholdBreached ? "border-red-300" : "border-gray-200"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black tracking-wider text-gray-500 uppercase">Capacity Monitor</p>
                <p className="mt-1 text-3xl font-black text-[#111827]">{occupancyPercent}%</p>
                <p className="mt-1 text-xs font-medium text-gray-500">
                  {status?.current_occupancy ?? 0} of {status?.capacity || capacity} people · alert at {status?.threshold_percent || thresholdPercent}%
                </p>
              </div>
              {thresholdBreached && (
                <div className="flex items-center gap-2 rounded-sm bg-red-50 px-3 py-2 text-xs font-black text-red-700">
                  <AlertTriangle size={16} /> Threshold Breached
                </div>
              )}
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full rounded-full transition-all duration-500 ${thresholdBreached ? "bg-red-600" : "bg-[#45a549]"}`} style={{ width: `${Math.min(100, occupancyPercent)}%` }} />
            </div>
          </div>

          <div className="rounded-sm border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#111827]">Manual Crossing Controls</p>
                <p className="mt-1 text-xs text-gray-500">Add a precise entry or exit during demos. Controls remain available while paused.</p>
              </div>
              <span className="text-xs font-bold text-gray-500">{status?.events_generated ?? 0} generated events</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!isActive || isBusy}
                onClick={() => void runAction(() => appendSimulationEvent(baseUrl, "entry"))}
                className="flex items-center justify-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowDownToLine size={18} /> Add Entry
              </button>
              <button
                type="button"
                disabled={!isActive || isBusy || (status?.current_occupancy ?? 0) <= 0}
                onClick={() => void runAction(() => appendSimulationEvent(baseUrl, "exit"))}
                className="flex items-center justify-center gap-2 rounded-sm border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUpFromLine size={18} /> Add Exit
              </button>
            </div>
          </div>

          <div className="rounded-sm border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#111827]">Fleet Run Monitor</p>
                <p className="mt-1 text-xs text-gray-500">Background citywide telemetry simulation for the admin dashboard and operational map.</p>
              </div>
              <RadioTower size={18} className={fleetState?.state === "running" ? "text-[#065f46]" : "text-gray-400"} />
            </div>

            {fleetState ? (
              <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricCard label="Enterprises" value={fleetState.targets.length} icon={<Building2 size={18} />} />
                <MetricCard label="Normal" value={fleetLaneCounts.normal} icon={<Activity size={18} />} />
                <MetricCard label="Warnings" value={fleetLaneCounts.warning} icon={<AlertTriangle size={18} />} />
                <MetricCard
                  label="Breach Lanes"
                  value={fleetLaneCounts["one-minute-breach"]}
                  icon={<RadioTower size={18} />}
                  critical={fleetLaneCounts["one-minute-breach"] > 0 && fleetState.state === "running"}
                />
              </div>
            ) : (
              <p className="mt-4 rounded-sm border border-dashed border-gray-300 bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
                No fleet simulation is running. Start one from the Fleet Simulation settings to make multiple enterprises appear normal, warning, and threshold-breached in real time.
              </p>
            )}

            {fleetState && (
              <div className="mt-4 rounded-sm bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
                <p>
                  Run <span className="font-black text-gray-800">{fleetState.runId}</span> · {formatElapsed(fleetState.elapsedSeconds)} elapsed · last synced{" "}
                  {fleetState.lastSyncedAt ? new Date(fleetState.lastSyncedAt).toLocaleTimeString() : "waiting for next sync"}
                </p>
                <p className="mt-1">One-minute breach lanes cycle through ramp-up, 60 seconds over threshold, then recovery below the alert threshold.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <label className="text-[11px] font-black tracking-wider text-gray-500 uppercase">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        className="mt-1.5 w-full rounded-sm border border-gray-300 px-3 py-2 text-sm font-bold text-[#111827] outline-none focus:border-[#065f46] disabled:cursor-not-allowed disabled:bg-gray-100"
      />
    </label>
  );
}

function MetricCard({ label, value, icon, critical = false }: { label: string; value: number; icon: React.ReactNode; critical?: boolean }) {
  return (
    <div className={`rounded-sm border bg-white p-4 shadow-sm ${critical ? "border-red-300" : "border-gray-200"}`}>
      <div className={`flex items-center gap-2 ${critical ? "text-red-700" : "text-[#065f46]"}`}>
        {icon}
        <p className="text-[10px] font-black tracking-wider uppercase">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-black ${critical ? "text-red-700" : "text-[#111827]"}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function SimulationStateBadge({ status }: { status: SimulationStatus | null }) {
  const state = status?.state ?? "idle";
  const classes = state === "running" ? "bg-emerald-100 text-emerald-800" : state === "paused" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600";
  return <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-wider uppercase ${classes}`}>{state}</span>;
}

function FleetStateBadge({ state }: { state: FleetSimulationState["state"] }) {
  const classes = state === "running" ? "bg-emerald-100 text-emerald-800" : state === "paused" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600";
  return <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-wider uppercase ${classes}`}>{state}</span>;
}

function buildFleetTargets({
  enterprises,
  enterpriseCount,
  warningCount,
  breachCount,
  capacity,
  thresholdPercent,
}: {
  enterprises: FleetSimulationEnterprise[];
  enterpriseCount: number;
  warningCount: number;
  breachCount: number;
  capacity: number;
  thresholdPercent: number;
}): FleetSimulationTarget[] {
  const nonCurrentEnterprises = enterprises.filter((enterprise) => !enterprise.isCurrent);
  const pool = nonCurrentEnterprises.length >= enterpriseCount ? nonCurrentEnterprises : enterprises;
  const selectedEnterprises = pool.slice(0, enterpriseCount);
  const safeBreachCount = clampNumber(breachCount, 0, selectedEnterprises.length);
  const safeWarningCount = clampNumber(warningCount, 0, Math.max(0, selectedEnterprises.length - safeBreachCount));

  return selectedEnterprises.map((enterprise, index) => {
    const lane: FleetSimulationLane = index < safeBreachCount ? "one-minute-breach" : index < safeBreachCount + safeWarningCount ? "warning" : "normal";
    return {
      enterpriseId: enterprise.enterpriseId,
      enterpriseName: enterprise.enterpriseName,
      lane,
      capacity: capacity + (index % 3) * 20,
      thresholdPercent,
    };
  });
}

function countFleetLanes(targets: FleetSimulationTarget[]) {
  return targets.reduce<Record<FleetSimulationLane, number>>(
    (counts, target) => ({
      ...counts,
      [target.lane]: counts[target.lane] + 1,
    }),
    { normal: 0, warning: 0, "one-minute-breach": 0 },
  );
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function createSimulationRunId() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `sim-${Date.now().toString(36)}-${randomPart}`;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Simulation Lab request failed.";
}
