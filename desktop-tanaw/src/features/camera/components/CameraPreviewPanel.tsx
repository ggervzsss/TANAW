import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CircleAlert, MapPin, Maximize, Minimize, Play, RefreshCw, Settings, Square, Trash2, Video } from "lucide-react";
import { Button, Card } from "../../../design-system";
import type { Camera } from "../../../types/enterprise";
import { getUserFacingIssueMessage } from "../../toasts/services/persistent-issue";
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
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const starting = isStarting || ["starting", "connecting"].includes(counts.status);
  const processBusy = starting || isStopping;
  const controlsDisabled = isRestartingService || isSaving || isTesting;
  const serviceIssue = serviceStatus?.error ?? serviceError;
  const issue = serviceIssue ?? error ?? health?.error ?? counts.error;
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
    <Card className="camera-preview-card" role="region" aria-label="Selected camera">
      <header className="camera-preview-heading">
        <span className="camera-identity-icon"><Video size={21} aria-hidden="true" /></span>
        <div className="camera-identity">
          <div className="camera-identity-title">
            <h3 title={activeCam.name}>{activeCam.name}</h3>
            <CameraStatusBadge status={isStopping ? "stopping" : starting ? "starting" : activeCam.status} />
          </div>
          <p><MapPin size={14} aria-hidden="true" /><span>{activeCam.zone} · {cameraModeName(activeCam.analysisMode)}</span></p>
        </div>
        <div className="camera-header-actions">
          <Button variant="secondary" aria-label="Edit configuration" leadingIcon={<Settings size={16} aria-hidden="true" />} onClick={onEdit}>Settings</Button>
          <Button variant="ghost" className="camera-icon-button" aria-label="Delete camera" title="Delete camera" onClick={onDelete}><Trash2 size={16} aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="camera-preview-layout">
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
        <CameraLiveMetrics activeCam={activeCam} area={area} counts={counts} health={health} runtimeReady={runtimeReady && !serviceIssue} />
      </div>
    </Card>
  );
}
