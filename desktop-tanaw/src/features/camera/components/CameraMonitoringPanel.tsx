import { Activity, CheckCircle, LogIn, LogOut, Play, RefreshCw, Square, Users, Wifi } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { Camera } from "../../../types/enterprise";
import type { MlCounts, MlHealth, MlServiceStatus } from "../services/ml-service";

type CameraMonitoringPanelProps = {
  activeCam: Camera;
  counts: MlCounts;
  health: MlHealth | null;
  serviceStatus: MlServiceStatus | null;
  error: string | null;
  isRestartingService: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isTesting: boolean;
  onRestartService: () => void;
  onStartProcessing: () => void;
  onStopProcessing: () => void;
  onTestConnection: () => void;
};

export function CameraMonitoringPanel({
  activeCam,
  counts,
  health,
  serviceStatus,
  error,
  isRestartingService,
  isStarting,
  isStopping,
  isTesting,
  onRestartService,
  onStartProcessing,
  onStopProcessing,
  onTestConnection,
}: CameraMonitoringPanelProps) {
  const isProcessingThisCamera = counts.running;
  const serviceOnline = health?.status === "ok";
  const serviceLabel = serviceOnline ? (health.running ? "ML Service Running" : "ML Service Ready") : "ML Service Offline";
  const cameraState = getCameraState(activeCam, counts, isStarting);
  const streamVerified = ["online", "running"].includes(activeCam.status);
  const streamLabel = streamVerified ? "Stream Verified" : "Stream Needs Check";
  const estimatedUniqueCount = health?.estimated_unique_count ?? health?.confirmed_unique_count ?? 0;
  const modelStatus = formatModelStatus(health);
  const performanceStatus = formatPerformanceStatus(health);
  const isProcessRunning = counts.running && !isStarting;
  const ProcessIcon = isProcessRunning ? Square : Play;
  const processButtonLabel = isProcessRunning ? (isStopping ? "Stopping..." : "Stop") : isStarting ? "Starting..." : "Start";
  const processButtonDisabled = isProcessRunning ? isStopping : isStarting;
  const processButtonClassName = isProcessRunning
    ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
    : "bg-[#065f46] text-white shadow-sm hover:bg-[#044a36] disabled:bg-gray-400 dark:bg-emerald-500/80 dark:text-emerald-950 dark:hover:bg-emerald-400";
  const processButtonTooltip = isProcessRunning ? "Stops visitor counting for this camera." : "Starts visitor counting for this camera.";

  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Live Metrics</h4>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold text-gray-500">{counts.status}</span>
        </div>
        <div className="grid auto-rows-fr grid-cols-2 gap-2">
          <MetricBox icon={LogIn} label="Entry" value={counts.entry} tone="entry" tooltip="Visitors counted after crossing the configured entry line." />
          <MetricBox icon={LogOut} label="Exit" value={counts.exit} tone="exit" tooltip="Visitors counted after crossing the configured exit line." />
          <MetricBox icon={Users} label="Occupancy" value={counts.occupancy} tone="occupancy" tooltip="Enterprise-wide live occupancy. This same authoritative value appears on every camera view." />
          <MetricBox icon={Users} label="Estimated Visitors" value={estimatedUniqueCount} tone="unique" tooltip="Estimated visitors attributed to this camera in the current open reporting period." />
        </div>
      </section>

      <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <h4 className="mb-3 text-[11px] font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">SYSTEM STATUS &amp; CONTROLS</h4>
        <div className="space-y-2">
          <StatusRow icon={Activity} label={serviceLabel} tone={serviceOnline ? "ok" : "error"} tooltip="Shows whether the local AI counting service is available." />
          <StatusRow icon={Wifi} label={cameraState.label} tone={cameraState.tone} tooltip="Shows whether the selected camera is processing, ready, stopped, or unavailable." />
          <StatusRow icon={CheckCircle} label={streamLabel} tone={streamVerified ? "ok" : "neutral"} tooltip="Shows whether the stream configuration has been verified." />
          <StatusRow icon={Activity} label={modelStatus} tone={health?.model_ready ? "ok" : "neutral"} tooltip="Shows the active detector model, runtime, and tracker selected by TANAW." />
          <StatusRow icon={Activity} label={performanceStatus} tone="neutral" tooltip="Shows current detector latency and analytics throughput." />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <InfoTooltip content="Refreshes or checks the local service connection." focusable={false}>
            <button
              type="button"
              onClick={onRestartService}
              disabled={isRestartingService}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-gray-200 bg-white px-2 py-2 text-[11px] font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={14} className={isRestartingService ? "animate-spin" : ""} /> Service
            </button>
          </InfoTooltip>
          <InfoTooltip content="Tests the selected camera stream configuration." focusable={false}>
            <button
              type="button"
              onClick={onTestConnection}
              disabled={isTesting || isProcessingThisCamera}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-[#065f46]/30 bg-white px-2 py-2 text-[11px] font-bold text-[#065f46] transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Wifi size={14} /> {isTesting ? "Testing..." : "Test"}
            </button>
          </InfoTooltip>
          <InfoTooltip content={processButtonTooltip} focusable={false} className="col-span-2">
            <button
              type="button"
              onClick={isProcessRunning ? onStopProcessing : onStartProcessing}
              disabled={processButtonDisabled}
              aria-pressed={isProcessRunning}
              className={`flex w-full items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed ${processButtonClassName}`}
            >
              <ProcessIcon size={14} /> {processButtonLabel}
            </button>
          </InfoTooltip>
        </div>
      </section>

      {(error || health?.error || serviceStatus?.error || counts.error) && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{error ?? health?.error ?? serviceStatus?.error ?? counts.error}</div>
      )}
      {health?.fallback_reason && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">AI fallback mode is active. Counts may be less accurate.</div>
      )}
    </div>
  );
}

type MetricBoxProps = {
  icon: typeof LogIn;
  label: string;
  tone: "entry" | "exit" | "occupancy" | "unique";
  tooltip: string;
  value: number | string;
};

function MetricBox({ icon: Icon, label, tone, tooltip, value }: MetricBoxProps) {
  const toneClass = {
    entry: "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-300",
    exit: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/25 dark:bg-red-400/12 dark:text-red-200",
    occupancy: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-400/12 dark:text-blue-200",
    unique: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200",
  }[tone];

  return (
    <InfoTooltip content={tooltip} className="h-full" focusable={false}>
      <div className={`flex h-full min-h-21 flex-col rounded-sm border p-2.5 transition-transform duration-150 group-hover:-translate-y-0.5 group-focus:-translate-y-0.5 ${toneClass}`}>
        <div className="flex min-h-7 items-start justify-between gap-2">
          <span className="text-[9px] leading-tight font-bold tracking-wider uppercase">{label}</span>
          <Icon size={13} className="shrink-0" />
        </div>
        <div className="mt-auto pt-1.5 font-['Bai_Jamjuree'] text-2xl leading-none font-bold">{value}</div>
      </div>
    </InfoTooltip>
  );
}

type StatusRowProps = {
  icon: typeof Activity;
  label: string;
  tone: "ok" | "neutral" | "error";
  tooltip: string;
};

function StatusRow({ icon: Icon, label, tone, tooltip }: StatusRowProps) {
  const toneClass = {
    error: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-gray-200 bg-gray-50 text-gray-600",
    ok: "border-emerald-200 bg-emerald-50 text-[#065f46]",
  }[tone];

  return (
    <InfoTooltip content={tooltip} focusable={false}>
      <div className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-[11px] font-bold transition-colors ${toneClass}`}>
        <span className="flex min-w-0 items-center gap-2">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </div>
    </InfoTooltip>
  );
}

function getCameraState(activeCam: Camera, counts: MlCounts, isStarting: boolean): { label: string; tone: "ok" | "neutral" | "error" } {
  if (counts.status === "connecting") return { label: "Camera Connecting", tone: "neutral" };
  if (counts.status === "starting" || (isStarting && !counts.running)) return { label: "Camera Starting", tone: "neutral" };
  if (counts.status === "reconnecting") return { label: "Camera Reconnecting", tone: "neutral" };
  if (counts.status === "degraded") return { label: "Camera Degraded", tone: "neutral" };
  if (counts.running) return { label: "Camera Processing", tone: "ok" };
  if (["online", "running"].includes(activeCam.status)) return { label: "Camera Ready", tone: "ok" };
  if (activeCam.status === "error" || activeCam.status === "failed" || activeCam.status === "offline") return { label: "Camera Failed", tone: "error" };
  return { label: "Camera Stopped", tone: "neutral" };
}

function formatModelStatus(health: MlHealth | null) {
  const profile = formatProfile(health?.effective_processing_profile ?? health?.processing_profile);
  const model = formatModelName(health?.selected_model ?? health?.model_name);
  const runtime = (health?.selected_runtime ?? "runtime").toUpperCase();
  const tracker = formatTracker(health?.effective_tracker);
  return `${profile} / ${model} / ${runtime} / ${tracker}`;
}

function formatPerformanceStatus(health: MlHealth | null) {
  const fps = typeof health?.analytics_fps === "number" ? `${health.analytics_fps.toFixed(1)} FPS` : "FPS adaptive";
  const p95 = typeof health?.detector_p95_ms === "number" ? `${Math.round(health.detector_p95_ms)} ms p95` : "p95 pending";
  return `${fps} / ${p95}`;
}

function formatProfile(profile: string | null | undefined) {
  const labels: Record<string, string> = {
    auto: "Auto",
    balanced: "Balanced",
    compatibility: "Compatibility",
    emergency: "Emergency",
    high_accuracy: "High Accuracy",
  };
  return labels[profile ?? ""] ?? "Profile pending";
}

function formatModelName(model: string | null | undefined) {
  if (!model) return "Model pending";
  return model.toUpperCase();
}

function formatTracker(tracker: string | null | undefined) {
  if (tracker === "botsort") return "BoT-SORT";
  if (tracker === "bytetrack") return "ByteTrack";
  return "Tracker auto";
}
