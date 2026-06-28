import { Activity, CheckCircle, LogIn, LogOut, Play, RefreshCw, Square, Users, Wifi } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { Camera } from "../../../types/enterprise";
import type { MlCounts, MlHealth, MlServiceStatus } from "../services/ml-service";

type CameraMonitoringPanelProps = {
  activeCam: Camera;
  counts: MlCounts;
  health: MlHealth | null;
  processingCameraId: number | null;
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
  processingCameraId,
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
  const isProcessingThisCamera = processingCameraId === activeCam.id && counts.running;
  const serviceOnline = health?.status === "ok";
  const serviceLabel = serviceOnline ? (health.running ? "ML Service Running" : "ML Service Ready") : "ML Service Offline";
  const cameraState = getCameraState(activeCam, isProcessingThisCamera);
  const streamVerified = ["online", "running"].includes(activeCam.status);
  const streamLabel = streamVerified ? "Stream Verified" : "Stream Needs Check";
  const uniqueCount = health?.confirmed_unique_count ?? 0;

  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Live Metrics</h4>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold text-gray-500">{counts.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricBox icon={LogIn} label="Entry" value={counts.entry} tone="entry" tooltip="Visitors counted after crossing the configured entry line." />
          <MetricBox icon={LogOut} label="Exit" value={counts.exit} tone="exit" tooltip="Visitors counted after crossing the configured exit line." />
          <MetricBox icon={Users} label="Occupancy" value={counts.occupancy} tone="occupancy" tooltip="Current live occupancy, calculated from entries and exits." />
          <MetricBox icon={Users} label="Unique" value={uniqueCount} tone="unique" tooltip="Estimated unique visitors counted for this node or reporting period." />
        </div>
      </section>

      <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <div className="space-y-2">
          <StatusRow icon={Activity} label={serviceLabel} tone={serviceOnline ? "ok" : "error"} tooltip="Shows whether the local AI counting service is available." />
          <StatusRow icon={Wifi} label={cameraState.label} tone={cameraState.tone} tooltip="Shows whether the selected camera is processing, ready, stopped, or unavailable." />
          <StatusRow icon={CheckCircle} label={streamLabel} tone={streamVerified ? "ok" : "neutral"} tooltip="Shows whether the stream configuration has been verified." />
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
          <InfoTooltip content="Starts live camera processing for this node." focusable={false}>
            <button
              type="button"
              onClick={onStartProcessing}
              disabled={isStarting || isProcessingThisCamera}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-[#065f46] px-2 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              <Play size={14} /> {isStarting ? "Starting..." : "Start Processing"}
            </button>
          </InfoTooltip>
          <InfoTooltip content="Stops live camera processing for this node." focusable={false}>
            <button
              type="button"
              onClick={onStopProcessing}
              disabled={isStopping || !counts.running}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-red-200 bg-red-50 px-2 py-2 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Square size={14} /> {isStopping ? "Stopping..." : "Stop"}
            </button>
          </InfoTooltip>
        </div>
      </section>

      {(error || health?.error || serviceStatus?.error || counts.error) && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{error ?? health?.error ?? serviceStatus?.error ?? counts.error}</div>
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
    entry: "border-emerald-200 bg-emerald-50 text-[#065f46]",
    exit: "border-red-200 bg-red-50 text-red-700",
    occupancy: "border-blue-200 bg-blue-50 text-blue-700",
    unique: "border-amber-200 bg-amber-50 text-amber-800",
  }[tone];

  return (
    <InfoTooltip content={tooltip}>
      <div className={`rounded-sm border p-2.5 transition-transform duration-150 group-hover:-translate-y-0.5 group-focus:-translate-y-0.5 ${toneClass}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-bold tracking-wider uppercase">{label}</span>
          <Icon size={13} />
        </div>
        <div className="mt-1.5 font-['Bai_Jamjuree'] text-2xl leading-none font-bold">{value}</div>
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
    <InfoTooltip content={tooltip}>
      <div className={`flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-[11px] font-bold transition-colors ${toneClass}`}>
        <span className="flex min-w-0 items-center gap-2">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </div>
    </InfoTooltip>
  );
}

function getCameraState(activeCam: Camera, isProcessing: boolean): { label: string; tone: "ok" | "neutral" | "error" } {
  if (isProcessing) return { label: "Camera Processing", tone: "ok" };
  if (["online", "running"].includes(activeCam.status)) return { label: "Camera Ready", tone: "ok" };
  if (activeCam.status === "error" || activeCam.status === "offline") return { label: "Camera Stopped", tone: "error" };
  return { label: "Camera Stopped", tone: "neutral" };
}
