import { Activity, AlertTriangle, CheckCircle, CircleAlert, LogIn, LogOut, Play, RefreshCw, Square, Users, Wifi } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { Camera } from "../../../types/enterprise";
import { getUserFacingIssueMessage } from "../../toasts/services/persistent-issue";
import type { MlCounts, MlHealth, MlServiceStatus } from "../services/ml-service";
import type { CameraPreviewState } from "./CameraVideoPreview";

type CameraMonitoringPanelProps = {
  activeCam: Camera;
  counts: MlCounts;
  health: MlHealth | null;
  serviceStatus: MlServiceStatus | null;
  serviceError: string | null;
  error: string | null;
  isRestartingService: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isTesting: boolean;
  previewState: CameraPreviewState;
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
  serviceError,
  error,
  isRestartingService,
  isStarting,
  isStopping,
  isTesting,
  previewState,
  onRestartService,
  onStartProcessing,
  onStopProcessing,
  onTestConnection,
}: CameraMonitoringPanelProps) {
  const isProcessingThisCamera = counts.running;
  const serviceOnline = health?.status === "ok";
  const serviceLabel = serviceOnline ? (health.running ? "ML Service Running" : "ML Service Ready") : "ML Service Offline";
  const cameraState = getCameraState(activeCam, counts, isStarting);
  const displayedFrameIsFresh = previewState === "live" && hasFreshPreviewFrame(health);
  const streamVerified = counts.running ? displayedFrameIsFresh : activeCam.status === "online";
  const streamLabel = streamVerified
    ? counts.running
      ? "Live Preview Verified"
      : "Stream Verified"
    : counts.running && previewState === "failed"
      ? "Live Preview Unavailable"
      : counts.running && previewState !== "live"
        ? "Restoring Live Preview"
        : "Stream Needs Check";
  const estimatedUniqueCount = health?.estimated_unique_count ?? health?.confirmed_unique_count ?? 0;
  const pendingUniqueEntries = health?.pending_unique_entries ?? 0;
  const modelStatus = formatModelStatus(health);
  const hasActiveModel = Boolean(health?.model_ready && (health.selected_model || health.model_name));
  const isProcessRunning = counts.running && !isStarting;
  const ProcessIcon = isProcessRunning ? Square : Play;
  const processButtonLabel = isProcessRunning ? (isStopping ? "Stopping..." : "Stop") : isStarting ? "Starting..." : "Start";
  const processButtonDisabled = isProcessRunning ? isStopping : isStarting;
  const processButtonClassName = isProcessRunning
    ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
    : "bg-[#065f46] text-white shadow-sm hover:bg-[#044a36] disabled:bg-gray-400 dark:bg-emerald-500/80 dark:text-emerald-950 dark:hover:bg-emerald-400";
  const processButtonTooltip = isProcessRunning ? "Stops visitor counting for this camera." : "Starts visitor counting for this camera.";
  const serviceIssueSource = serviceStatus?.error ?? serviceError;
  const serviceIssue = serviceIssueSource ? getUserFacingIssueMessage(serviceIssueSource) : null;
  const serviceNeedsRecovery = Boolean(!serviceOnline && (serviceStatus?.error || serviceError));
  const cameraIssueSource = error ?? health?.error ?? counts.error;
  const cameraIssue = cameraIssueSource ? getUserFacingIssueMessage(cameraIssueSource) : null;
  const fallbackIssue = health?.fallback_reason ? "AI fallback mode is active. Visitor counts may be less accurate." : null;

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-gray-200/90 bg-white/95 p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.055)] dark:border-white/8 dark:bg-[#142130] dark:shadow-[0_14px_32px_rgba(1,8,17,0.22)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Live Metrics</h4>
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[9px] font-bold tracking-wide text-gray-500 uppercase dark:border-white/9 dark:bg-white/4 dark:text-slate-400">
            {counts.status}
          </span>
        </div>
        <div className="grid auto-rows-fr grid-cols-2 gap-2">
          <MetricBox icon={LogIn} label="Entry" value={counts.entry} tone="entry" tooltip="Visitors counted after crossing the configured entry line." />
          <MetricBox icon={LogOut} label="Exit" value={counts.exit} tone="exit" tooltip="Visitors counted after crossing the configured exit line." />
          <MetricBox icon={Users} label="Occupancy" value={counts.occupancy} tone="occupancy" tooltip="Enterprise-wide live occupancy. This same authoritative value appears on every camera view." />
          <MetricBox
            icon={Users}
            label="Estimated Visitors"
            value={estimatedUniqueCount}
            tone="unique"
            tooltip="Confirmed and degraded unique estimates attributed to this camera. Provisional identities are excluded until TANAW gets stronger evidence."
          />
        </div>
        {pendingUniqueEntries > 0 ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-800 dark:border-amber-300/20 dark:bg-amber-300/8 dark:text-amber-200">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              {pendingUniqueEntries} provisional {pendingUniqueEntries === 1 ? "identity is" : "identities are"} excluded from the visitor estimate pending a stronger match.
            </span>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-gray-200/90 bg-white/95 p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.055)] dark:border-white/8 dark:bg-[#142130] dark:shadow-[0_14px_32px_rgba(1,8,17,0.22)]">
        <h4 className="mb-3 text-[11px] font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">SYSTEM STATUS &amp; CONTROLS</h4>
        <div className="space-y-2">
          <StatusRow
            icon={Activity}
            issue={serviceIssue ? { message: serviceIssue, tone: "error" } : null}
            label={serviceLabel}
            tone={serviceOnline ? "ok" : "error"}
            tooltip="Shows whether the local AI counting service is available."
          />
          <StatusRow
            icon={Wifi}
            issue={cameraIssue ? { message: `${activeCam.name} unavailable: ${cameraIssue}`, tone: "error" } : null}
            label={cameraState.label}
            tone={cameraState.tone}
            tooltip="Shows whether the selected camera is processing, ready, stopped, or unavailable."
          />
          <StatusRow icon={CheckCircle} label={streamLabel} tone={streamVerified ? "ok" : "neutral"} tooltip="Shows whether the stream configuration has been verified." />
          {hasActiveModel ? (
            <StatusRow
              icon={Activity}
              issue={fallbackIssue ? { message: fallbackIssue, tone: "warning" } : null}
              label={modelStatus}
              tone="ok"
              tooltip="Shows the active detector model, runtime, and tracker selected by TANAW."
            />
          ) : null}
        </div>
        <p className="mt-2 text-[9px] font-semibold tracking-wide text-gray-400 dark:text-slate-500">
          Desktop {serviceStatus?.desktopVersion ?? "unknown"} ({serviceStatus?.packaged ? "packaged" : "development"}) · ML {health?.service_version ?? "unknown"} · API{" "}
          {health?.api_contract_version ?? "unknown"}
        </p>
        <p className="truncate text-[9px] font-medium text-gray-400 dark:text-slate-500" title={serviceStatus?.desktopBuild}>
          Desktop build: {serviceStatus?.desktopBuild ?? "unknown"}
        </p>

        <div className="mt-3 space-y-2">
          <motion.div
            className="grid"
            initial={false}
            animate={{
              columnGap: serviceNeedsRecovery ? 8 : 0,
              gridTemplateColumns: serviceNeedsRecovery ? "minmax(0, 1fr) minmax(0, 1fr)" : "0fr minmax(0, 1fr)",
            }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="min-w-0 overflow-hidden">
              <AnimatePresence initial={false}>
                {serviceNeedsRecovery ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                    <InfoTooltip content="Restarts the local ML service after a service failure." focusable={false}>
                      <button
                        type="button"
                        onClick={onRestartService}
                        disabled={isRestartingService}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-[11px] font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/3 dark:text-slate-300 dark:hover:bg-white/6"
                      >
                        <RefreshCw size={14} className={isRestartingService ? "animate-spin" : ""} /> Service
                      </button>
                    </InfoTooltip>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <InfoTooltip content="Tests the selected camera stream configuration." focusable={false}>
              <button
                type="button"
                onClick={onTestConnection}
                disabled={isTesting || isProcessingThisCamera}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#065f46]/30 bg-white px-2 py-2.5 text-[11px] font-bold text-[#065f46] transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-300/20 dark:bg-emerald-300/5 dark:text-emerald-300 dark:hover:bg-emerald-300/10"
              >
                <Wifi size={14} /> {isTesting ? "Testing..." : "Test"}
              </button>
            </InfoTooltip>
          </motion.div>
          <InfoTooltip content={processButtonTooltip} focusable={false}>
            <button
              type="button"
              onClick={isProcessRunning ? onStopProcessing : onStartProcessing}
              disabled={processButtonDisabled}
              aria-pressed={isProcessRunning}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed ${processButtonClassName}`}
            >
              <ProcessIcon size={14} /> {processButtonLabel}
            </button>
          </InfoTooltip>
        </div>
      </section>
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
      <div
        className={`flex h-full min-h-22 flex-col rounded-xl border p-3 transition-[transform,box-shadow] duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-focus:-translate-y-0.5 ${toneClass}`}
      >
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
  issue?: {
    message: string;
    tone: "error" | "warning";
  } | null;
  label: string;
  tone: "ok" | "neutral" | "error";
  tooltip: string;
};

function StatusRow({ icon: Icon, issue, label, tone, tooltip }: StatusRowProps) {
  const toneClass = {
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/22 dark:bg-red-400/9 dark:text-red-200",
    neutral: "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/8 dark:bg-white/3 dark:text-slate-300",
    ok: "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-400/22 dark:bg-emerald-400/9 dark:text-emerald-300",
  }[tone];

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[11px] font-bold transition-colors ${toneClass}`}>
      <InfoTooltip content={tooltip} focusable={false} className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      </InfoTooltip>
      {issue ? <StatusIssueTooltip issue={issue} label={label} /> : null}
    </div>
  );
}

function StatusIssueTooltip({ issue, label }: { issue: NonNullable<StatusRowProps["issue"]>; label: string }) {
  const isError = issue.tone === "error";
  const Icon = isError ? CircleAlert : AlertTriangle;

  return (
    <InfoTooltip
      align="right"
      ariaLabel={`${label} details`}
      className={`shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
        isError
          ? "text-red-600 hover:text-red-800 focus-visible:outline-red-600 dark:text-red-300 dark:hover:text-red-100"
          : "text-amber-600 hover:text-amber-800 focus-visible:outline-amber-600 dark:text-amber-300 dark:hover:text-amber-100"
      }`}
      content={issue.message}
    >
      <Icon size={15} aria-hidden="true" />
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
  const profile = health?.effective_processing_profile ?? health?.processing_profile;
  const model = health?.selected_model ?? health?.model_name;
  return [profile ? formatProfile(profile) : null, model ? formatModelName(model) : null, health?.selected_runtime?.toUpperCase() ?? null, formatTracker(health?.effective_tracker)]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function hasFreshPreviewFrame(health: MlHealth | null) {
  const ages = [health?.raw_frame_stale_ms, health?.processed_frame_stale_ms, health?.stream_frame_stale_ms].filter((age): age is number => typeof age === "number");
  return ages.length === 0 || Math.max(...ages) < 3000;
}

function formatProfile(profile: string) {
  const labels: Record<string, string> = {
    auto: "Auto",
    balanced: "Balanced",
    compatibility: "Compatibility",
    emergency: "Emergency",
    high_accuracy: "High Accuracy",
  };
  return labels[profile] ?? profile.replace(/_/g, " ");
}

function formatModelName(model: string) {
  return model.toUpperCase();
}

function formatTracker(tracker: string | null | undefined) {
  if (tracker === "botsort") return "BoT-SORT";
  if (tracker === "bytetrack") return "ByteTrack";
  return tracker;
}
