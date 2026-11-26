import { Activity, AlertTriangle, CheckCircle, CircleAlert, RefreshCw, Wifi } from "lucide-react";
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
  isTesting: boolean;
  previewState: CameraPreviewState;
  onRestartService: () => void;
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
  isTesting,
  previewState,
  onRestartService,
  onTestConnection,
}: CameraMonitoringPanelProps) {
  const isProcessingThisCamera = counts.running;
  const serviceIssueSource = serviceStatus?.error ?? serviceError;
  const serviceOnline = !serviceIssueSource && health?.status === "ok";
  const serviceLabel = serviceIssueSource ? "ML Service Needs Attention" : serviceOnline ? (health.running ? "ML Service Running" : "ML Service Ready") : "ML Service Offline";
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
  const modelStatus = formatModelStatus(health);
  const hasActiveModel = Boolean(health?.model_ready && (health.selected_model || health.model_name));
  const serviceIssue = serviceIssueSource ? getUserFacingIssueMessage(serviceIssueSource) : null;
  const serviceNeedsRecovery = Boolean(!serviceOnline && (serviceStatus?.error || serviceError));
  const cameraIssueSource = error ?? health?.error ?? counts.error;
  const cameraIssue = cameraIssueSource ? getUserFacingIssueMessage(cameraIssueSource) : null;
  const fallbackIssue = health?.fallback_reason ? "AI fallback mode is active. Visitor counts may be less accurate." : null;

  return (
    <section className="camera-system-status">
      <h4 className="camera-system-status-title">SYSTEM STATUS &amp; CONTROLS</h4>
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
      <p className="camera-system-status-meta">
        Desktop {serviceStatus?.desktopVersion ?? "unknown"} ({serviceStatus?.packaged ? "packaged" : "development"}) · ML {health?.service_version ?? "unknown"} · API{" "}
        {health?.api_contract_version ?? "unknown"}
      </p>
      <p className="camera-system-status-meta truncate" title={serviceStatus?.desktopBuild}>
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
                      className="camera-system-status-action"
                    >
                      <RefreshCw size={15} className={isRestartingService ? "animate-spin motion-reduce:animate-none" : ""} /> Service
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
              className="camera-system-status-action" data-tone="accent"
            >
              <Wifi size={15} /> {isTesting ? "Testing..." : "Test"}
            </button>
          </InfoTooltip>
        </motion.div>
      </div>
    </section>
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
    ok: "border-emerald-200 bg-emerald-50 text-tanaw-ledger dark:border-emerald-400/22 dark:bg-emerald-400/9 dark:text-emerald-300",
  }[tone];

  return (
    <div className={`camera-status-row ${toneClass}`} data-tone={tone}>
      <InfoTooltip content={tooltip} focusable={false} className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <Icon size={15} className="shrink-0" />
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
