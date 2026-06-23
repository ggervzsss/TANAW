import { Activity, Cpu, LogIn, LogOut, Play, RefreshCw, Square, Users, Wifi } from "lucide-react";
import type { Camera } from "../../../types/enterprise";
import type { MlCounts, MlDetections, MlHealth, MlServiceStatus } from "../services/ml-service";

type CameraMonitoringPanelProps = {
  activeCam: Camera;
  counts: MlCounts;
  detections: MlDetections;
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
  detections,
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
  const cameraLabel = isProcessingThisCamera ? "Processing" : activeCam.status === "online" ? "Verified" : activeCam.status === "untested" ? "Untested" : "Stopped";
  const reidLabel =
    health?.reid_status === "ready" && health.quality_reid_status === "ready"
      ? `Hybrid ReID ${health.reid_gallery_size}`
      : health?.reid_status === "ready"
        ? `Fast ReID ${health.reid_gallery_size}`
        : health?.reid_status === "degraded"
          ? "Unique ReID Degraded"
          : health?.reid_model_loading || health?.quality_reid_model_loading
            ? "Unique ReID Loading"
            : "Unique ReID Pending";
  const reidTone = health?.reid_status === "ready" ? "ok" : "neutral";
  const visibleTracks = detections.tracks.filter((track) => track.confidence >= activeCam.confidence);
  const activeTrackIds = new Set(visibleTracks.filter((track) => track.track_id > 0).map((track) => track.track_id));
  const currentVisitorIds = new Set(visibleTracks.map((track) => track.visitor_id).filter((visitorId): visitorId is string => Boolean(visitorId)));
  const averageConfidence = visibleTracks.length > 0 ? visibleTracks.reduce((total, track) => total + track.confidence, 0) / visibleTracks.length : null;

  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Live Metrics</h4>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold text-gray-500">{counts.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricBox icon={LogIn} label="Entry" value={counts.entry} tone="entry" />
          <MetricBox icon={LogOut} label="Exit" value={counts.exit} tone="exit" />
          <MetricBox icon={Users} label="Occupancy" value={counts.occupancy} tone="occupancy" />
          <MetricBox icon={Users} label="Confirmed" value={health?.confirmed_unique_count ?? 0} tone="unique" />
          <MetricBox icon={Users} label="Degraded" value={health?.degraded_unique_count ?? 0} tone="exit" />
          <MetricBox icon={Activity} label="Active IDs" value={activeTrackIds.size} tone="neutral" />
          <MetricBox icon={Cpu} label="Avg Conf." value={formatAverageConfidence(averageConfidence)} tone="neutral" />
          <MetricBox icon={Activity} label="AI FPS" value={formatFps(health?.analytics_fps)} tone="neutral" />
          <MetricBox icon={Cpu} label="Frame Age" value={formatLatency(health?.processing_frame_age_ms)} tone="neutral" />
        </div>
        {currentVisitorIds.size > 0 && <p className="mt-2 truncate text-[10px] font-semibold text-gray-500">Visible unique visitors: {currentVisitorIds.size}</p>}
      </div>

      <div className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
          <StatusPill icon={Activity} label={serviceLabel} tone={serviceOnline ? "ok" : "error"} />
          <StatusPill
            icon={Wifi}
            label={`Camera ${cameraLabel}`}
            tone={isProcessingThisCamera || activeCam.status === "online" ? "ok" : activeCam.status === "error" || activeCam.status === "offline" ? "error" : "neutral"}
          />
          {health && <StatusPill icon={Cpu} label={reidLabel} tone={reidTone} />}
          {health && (
            <StatusPill
              icon={Activity}
              label={`${health.processing_profile ?? "auto"} / F${health.reid_queue_depth} Q${health.quality_reid_queue_depth}`}
              tone={health.reid_tasks_dropped > 0 || health.quality_reid_tasks_dropped > 0 ? "error" : "neutral"}
            />
          )}
          {serviceStatus?.pid && <span className="rounded-sm border border-gray-200 bg-gray-50 px-2 py-1 text-gray-500">PID {serviceStatus.pid}</span>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRestartService}
            disabled={isRestartingService}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-gray-200 bg-white px-2 py-2 text-[11px] font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={14} className={isRestartingService ? "animate-spin" : ""} /> Service
          </button>
          <button
            type="button"
            onClick={onTestConnection}
            disabled={isTesting || isProcessingThisCamera}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-[#065f46]/30 bg-white px-2 py-2 text-[11px] font-bold text-[#065f46] transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wifi size={14} /> {isTesting ? "Testing..." : "Test"}
          </button>
          <button
            type="button"
            onClick={onStartProcessing}
            disabled={isStarting || isProcessingThisCamera}
            className="flex items-center justify-center gap-1.5 rounded-sm bg-[#065f46] px-2 py-2 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            <Play size={14} /> {isStarting ? "Starting..." : "Star Processing"}
          </button>
          <button
            type="button"
            onClick={onStopProcessing}
            disabled={isStopping || !counts.running}
            className="flex items-center justify-center gap-1.5 rounded-sm border border-red-200 bg-red-50 px-2 py-2 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Square size={14} /> {isStopping ? "Stopping..." : "Stop"}
          </button>
        </div>
      </div>

      {(error || health?.error || serviceStatus?.error || counts.error) && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{error ?? health?.error ?? serviceStatus?.error ?? counts.error}</div>
      )}
    </div>
  );
}

type MetricBoxProps = {
  icon: typeof LogIn;
  label: string;
  tone: "entry" | "exit" | "neutral" | "occupancy" | "unique";
  value: number | string;
};

function MetricBox({ icon: Icon, label, tone, value }: MetricBoxProps) {
  const toneClass = {
    entry: "border-emerald-200 bg-emerald-50 text-[#065f46]",
    exit: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-gray-200 bg-gray-50 text-gray-700",
    occupancy: "border-blue-200 bg-blue-50 text-blue-700",
    unique: "border-amber-200 bg-amber-50 text-amber-800",
  }[tone];

  return (
    <div className={`rounded-sm border p-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold tracking-wider uppercase">{label}</span>
        <Icon size={13} />
      </div>
      <div className="mt-1 font-['Bai_Jamjuree'] text-xl leading-none font-bold">{value}</div>
    </div>
  );
}

type StatusPillProps = {
  icon: typeof Activity;
  label: string;
  tone: "ok" | "neutral" | "error";
};

function StatusPill({ icon: Icon, label, tone }: StatusPillProps) {
  const toneClass = {
    error: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-gray-200 bg-gray-50 text-gray-600",
    ok: "border-emerald-200 bg-emerald-50 text-[#065f46]",
  }[tone];

  return (
    <span className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 ${toneClass}`}>
      <Icon size={13} /> {label}
    </span>
  );
}

function formatAverageConfidence(value: number | null) {
  if (value === null) return "--";
  return `${Math.round(value * 100)}%`;
}

function formatFps(value: number | null | undefined) {
  if (value == null) return "--";
  return value.toFixed(1);
}

function formatLatency(value: number | null | undefined) {
  if (value == null) return "--";
  return `${Math.round(value)}ms`;
}
