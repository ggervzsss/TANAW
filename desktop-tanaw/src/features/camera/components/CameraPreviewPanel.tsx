import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CircleAlert, MapPin, Maximize, Minimize, Play, RefreshCw, Settings, Square, Trash2, Video } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button, Skeleton, SkeletonText } from "../../../ui-kit";
import type { Camera } from "../../../types/enterprise";
import { getUserFacingIssueMessage } from "../../toasts/services/persistent-issue";
import { useBoundedLoading } from "../hooks/useBoundedLoading";
import { CAMERA_MORPH_TRANSITION, useCameraMorph } from "../hooks/useCameraMorph";
import { CameraSettingsPanel } from "./CameraSettingsPanel";
import { cameraDisplayKey, readCameraDisplay } from "../model/camera-display";
import { cameraModeName } from "../utils/camera-mode";
import { CameraLiveMetrics } from "./CameraLiveMetrics";
import { CameraStatusBadge } from "./CameraList";
import { CameraValidationWarnings } from "./CameraValidationWarnings";
import { CameraVideoPreview, type CameraPreviewState } from "./CameraVideoPreview";
import { NoCameraSelected } from "./NoCameraSelected";
import type { MlAreaState, MlCounts, MlDetections, MlHealth, MlServiceStatus } from "../services/ml-service";

export type CameraPreviewPanelProps = {
  storageKey?: string;
  /** The saved cameras are still loading; the panel shows a placeholder in its own shape. */
  loading?: boolean;
  runtimeReady?: boolean;
  cameras?: Camera[];
  activeCam?: Camera;
  area?: MlAreaState | null;
  cameraIpError?: string;
  counts: MlCounts;
  detections: MlDetections;
  editForm: Camera | null;
  error: string | null;
  hasStoredPassword: boolean;
  health: MlHealth | null;
  isRestartingService: boolean;
  isEditMode: boolean;
  isSaving: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isTesting: boolean;
  serviceStatus: MlServiceStatus | null;
  serviceError: string | null;
  streamUrl: string;
  warnings: string[];
  onCancelEdit: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRestartService: () => void;
  onSave: (countingEnabled?: boolean) => void | Promise<boolean | undefined>;
  onStartProcessing: () => void | Promise<boolean | void>;
  onStopProcessing: () => void | Promise<boolean | undefined>;
  onTestConnection: () => void;
  onEditFormChange: Dispatch<SetStateAction<Camera | null>>;
};

export function CameraPreviewPanel(props: CameraPreviewPanelProps) {
  const { activeCam, editForm, error, isEditMode, isRestartingService, onRestartService, serviceError } = props;
  const [previewState, setPreviewState] = useState<CameraPreviewState>("connecting");

  useEffect(() => {
    setPreviewState("connecting");
  }, [activeCam?.id]);

  if (!activeCam && props.loading && !serviceError && !error) return <CameraMonitorSkeleton />;

  if (!activeCam)
    return (
      <div className="camera-empty-state">
        {(serviceError || error) && (
          <div className="camera-settings-error" role="alert">
            <p>{serviceError || error}</p>
            <button type="button" className="design-button" disabled={isRestartingService} onClick={onRestartService}>
              {isRestartingService ? "Restarting service..." : "Retry camera service"}
            </button>
          </div>
        )}
        <NoCameraSelected />
      </div>
    );

  if (isEditMode && editForm) return <CameraSettingsPanel key={activeCam.id} {...props} initialPreviewState={previewState} activeCam={activeCam} editForm={editForm} />;

  return <CameraMonitor key={activeCam.id} {...props} activeCam={activeCam} onPreviewStateChange={setPreviewState} />;
}

type CameraMonitorProps = CameraPreviewPanelProps & {
  activeCam: Camera;
  onPreviewStateChange: (state: CameraPreviewState) => void;
};

function CameraMonitor({
  activeCam, area, counts, detections, error, health, isRestartingService, isSaving, isStarting, isStopping, isTesting,
  onDelete, onEdit, onEditFormChange, onPreviewStateChange, onRestartService, onStartProcessing, onStopProcessing,
  runtimeReady = true, serviceError, serviceStatus, storageKey, streamUrl, warnings,
}: CameraMonitorProps) {
  const previewRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const iconRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useCameraMorph(iconRef, `camera-icon-${activeCam.id}`);
  useCameraMorph(titleRef, `camera-title-${activeCam.id}`);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const starting = isStarting || ["starting", "connecting"].includes(counts.status);
  const processBusy = starting || isStopping;
  const controlsDisabled = isRestartingService || isSaving || isTesting;
  const serviceIssue = serviceStatus?.error ?? serviceError;
  const issue = serviceIssue ?? error ?? health?.error ?? counts.error;
  const metricsLoading = useBoundedLoading(!runtimeReady && !serviceIssue);
  const displayPreferences = readCameraDisplay(cameraDisplayKey(storageKey ?? "tanaw-camera", activeCam.id));
  const canRefresh = Boolean(counts.running && streamUrl);
  const processLabel = starting ? "Starting Camera…" : isStopping ? "Stopping Camera…" : counts.running ? "Stop Camera" : "Start Camera";
  const fullscreenLabel = fullscreen ? "Exit Fullscreen" : "Fullscreen";
  const FullscreenIcon = fullscreen ? Minimize : Maximize;
  const ProcessIcon = counts.running ? Square : Play;

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === previewRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const handlePreviewStateChange = useCallback((state: CameraPreviewState) => {
    onPreviewStateChange(state);
    if (state === "live" || state === "failed") setRefreshing(false);
  }, [onPreviewStateChange]);

  async function toggleFullscreen() {
    const preview = previewRef.current;
    if (!preview) return;
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === preview) await document.exitFullscreen();
      else await preview.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  let previewUrl = streamUrl;
  if (streamUrl && refreshVersion > 0) {
    const url = new URL(streamUrl);
    url.searchParams.set("refresh", String(refreshVersion));
    previewUrl = url.href;
  }

  return (
    <div className="camera-preview-card" role="region" aria-label="Selected camera">
      <header className="camera-preview-heading">
        <span ref={iconRef} className="camera-identity-icon"><Video size={20} aria-hidden="true" /></span>
        <div className="camera-identity">
          <div className="camera-identity-title">
            <h3 ref={titleRef} title={activeCam.name}>{activeCam.name}</h3>
            <CameraStatusBadge status={isStopping ? "stopping" : starting ? "starting" : activeCam.status} />
          </div>
          <p><MapPin size={14} aria-hidden="true" /><span>{activeCam.zone} · {cameraModeName(activeCam.analysisMode)}</span></p>
        </div>
        <div className="camera-header-actions">
          <Button variant="secondary" aria-label="Edit configuration" leadingIcon={<Settings size={16} aria-hidden="true" />} onClick={onEdit}>Settings</Button>
          <Button variant="ghost" className="camera-icon-button" aria-label="Delete camera" title="Delete camera" onClick={onDelete}><Trash2 size={16} aria-hidden="true" /></Button>
        </div>
      </header>

      <motion.div
        className="camera-preview-layout"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : CAMERA_MORPH_TRANSITION}
      >
        <section ref={previewRef} className="camera-preview-surface" aria-labelledby="camera-preview-heading">
          <div className="camera-preview-toolbar">
            <h4 id="camera-preview-heading"><Video size={17} aria-hidden="true" />Camera Preview</h4>
            <div className="camera-preview-actions" role="group" aria-label="Camera preview controls">
              <Button size="sm" variant={counts.running ? "secondary" : "primary"} title={processLabel} loading={processBusy}
                disabled={controlsDisabled || Boolean(serviceIssue && !counts.running)} leadingIcon={<ProcessIcon size={15} aria-hidden="true" />}
                onClick={() => counts.running ? void onStopProcessing() : void onStartProcessing()}>
                {processLabel}
              </Button>
              {canRefresh && (
                <Button size="sm" variant="secondary" className="camera-icon-button" aria-label={refreshing ? "Refreshing Preview" : "Refresh Preview"}
                  title="Reload the video preview" disabled={controlsDisabled || processBusy} loading={refreshing}
                  onClick={() => {
                    setRefreshing(true);
                    setRefreshVersion((version) => version + 1);
                  }}>
                  {!refreshing && <RefreshCw size={16} aria-hidden="true" />}
                </Button>
              )}
              {typeof document !== "undefined" && document.fullscreenEnabled && (
                <Button size="sm" variant="secondary" className="camera-icon-button" aria-label={fullscreenLabel}
                  title={fullscreen ? "Exit fullscreen (Esc)" : "View the camera preview fullscreen"} onClick={() => void toggleFullscreen()}>
                  <FullscreenIcon size={16} aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
          {(issue || warnings.length > 0) && (
            <div className="camera-preview-notices">
              {issue && (
                <div className="camera-preview-feedback" role="alert">
                  <CircleAlert size={17} aria-hidden="true" />
                  <span>{getUserFacingIssueMessage(issue)}</span>
                  {serviceIssue && (
                    <Button variant="secondary" size="sm" loading={isRestartingService} onClick={onRestartService}>Retry camera service</Button>
                  )}
                </div>
              )}
              <CameraValidationWarnings warnings={warnings} />
            </div>
          )}
          <div className="camera-preview-frame">
            <CameraVideoPreview displayPreferences={displayPreferences} area={area} activeCam={activeCam} counts={counts}
              detections={detections} editForm={null} health={health} isProcessing={counts.running} isEditMode={false}
              onEditFormChange={onEditFormChange} streamUrl={previewUrl} onPreviewStateChange={handlePreviewStateChange} />
          </div>
          {fullscreenError && <p className="camera-preview-feedback" role="alert">Fullscreen is unavailable. Try again.</p>}
        </section>
        <CameraLiveMetrics activeCam={activeCam} area={area} counts={counts} health={health} runtimeReady={runtimeReady && !serviceIssue} loading={metricsLoading} />
      </motion.div>
    </div>
  );
}

/** The monitoring layout in outline while the saved cameras load. */
function CameraMonitorSkeleton() {
  return (
    <div className="camera-preview-card camera-preview-card--loading" role="status" aria-label="Loading camera">
      <div className="camera-preview-heading" aria-hidden="true">
        <Skeleton className="camera-skeleton-icon" />
        <span className="camera-identity">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3.5 w-32" />
        </span>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="camera-preview-layout" aria-hidden="true">
        <div className="camera-preview-surface">
          <div className="camera-preview-toolbar">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-36" />
          </div>
          <div className="camera-preview-frame">
            <Skeleton className="camera-skeleton-stage" />
          </div>
        </div>
        <div className="camera-live-metrics">
          <div className="camera-metrics-heading">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="camera-metrics-grid" data-mode="entrance-exit">
            {(["entry", "exit", "occupancy", "visitors"] as const).map((tone) => (
              <div key={tone} className="camera-metric camera-metric--placeholder" data-tone={tone}>
                <SkeletonText lines={1} />
                <Skeleton className="camera-metric-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
