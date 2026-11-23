import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import type { MlAreaState, MlCounts, MlDetections, MlHealth } from "../services/ml-service";
import { canRetryPreview, getPreviewRetryDelayMs, hasRenderablePreviewFrame, isCurrentPreviewRequest, withPreviewRetryVersion } from "../utils/camera-preview-recovery";
import { OpenSpaceOverlay } from "./OpenSpaceOverlay";
import { CameraOverlayConfig } from "./CameraOverlayConfig";
import { Video, Wifi, WifiOff, CircleAlert, RefreshCw } from "lucide-react";

import { DEFAULT_CAMERA_DISPLAY, type CameraDisplayPreferences } from "../model/camera-display";
import { trackLabelLines } from "../model/track-labels";
import { useHeldTracks } from "../hooks/useHeldTracks";
import { detectionsAreFresh, type DisplayedTrack } from "../model/track-hold";
import { useDeveloperSettings } from "../../preferences/developer-settings";

const NO_TRACKS: MlDetections["tracks"] = [];
const NO_DISPLAYED_TRACKS: DisplayedTrack[] = [];

type CameraVideoPreviewProps = {
  displayPreferences?: CameraDisplayPreferences;
  onRetry?: () => void | Promise<boolean | void>;
  onEditCheckpoint?: () => void;
  selectedZonePoint?: number | null;
  onSelectZonePoint?: (index: number | null) => void;
  activeCam: Camera;
  area?: MlAreaState | null;
  counts: MlCounts;
  detections: MlDetections;
  editForm: Camera | null;
  health: MlHealth | null;
  isProcessing: boolean;
  isEditMode: boolean;
  onEditFormChange: Dispatch<SetStateAction<Camera | null>>;
  onPreviewStateChange?: (state: CameraPreviewState) => void;
  streamUrl: string;
};

export type CameraPreviewState = "connecting" | "failed" | "live" | "retrying";

type ContentRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function CameraVideoPreview({
  displayPreferences = DEFAULT_CAMERA_DISPLAY,
  onRetry,
  onEditCheckpoint,
  selectedZonePoint,
  onSelectZonePoint,
  area,
  activeCam,
  counts,
  detections,
  editForm,
  health,
  isProcessing,
  isEditMode,
  onEditFormChange,
  onPreviewStateChange,
  streamUrl,
}: CameraVideoPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewSourceRef = useRef(streamUrl);
  previewSourceRef.current = streamUrl;
  const connectWatchdogRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [connectionState, setConnectionState] = useState<Exclude<CameraPreviewState, "live">>("connecting");
  const [decodedStreamUrl, setDecodedStreamUrl] = useState<string | null>(null);
  const [decodedAspectRatio, setDecodedAspectRatio] = useState<number | null>(null);
  const streamIsAvailable = Boolean(isProcessing && streamUrl);
  const effectiveStreamUrl = useMemo(() => withPreviewRetryVersion(streamUrl, previewAttempt), [previewAttempt, streamUrl]);
  const previewState = streamIsAvailable && decodedStreamUrl === effectiveStreamUrl ? "live" : connectionState;
  const isStarting = counts.status === "starting" || counts.status === "connecting" || activeCam.status === "starting";
  const hasFreshFrame = health?.raw_frame_id !== 0 && (health?.raw_frame_stale_ms == null || health.raw_frame_stale_ms < 5000);
  const isActuallyLive = streamIsAvailable && previewState === "live" && hasFreshFrame && ["running", "degraded"].includes(counts.status);
  const presentation = isStarting
    ? "starting"
    : counts.status === "reconnecting" || previewState === "retrying"
      ? "reconnecting"
      : counts.error || ["failed", "error", "offline"].includes(activeCam.status) || previewState === "failed"
        ? "error"
        : isProcessing
          ? "connecting"
          : "offline";
  const loading = presentation === "starting" || presentation === "connecting" || presentation === "reconnecting";
  const statusHeading = {
    starting: "Preparing your camera",
    connecting: "Connecting to camera",
    reconnecting: "Restoring connection",
    error: "Camera needs attention",
    offline: "Camera preview is paused",
  }[presentation];
  const statusDescription = {
    starting: health?.model_loading ? "Loading the counting model. Video will appear when it is ready." : "Starting the secure video connection. This may take a moment.",
    connecting: "Waiting for a live video frame from this camera.",
    reconnecting: "The video connection was interrupted. TANAW is working to restore it.",
    error: "Check the camera connection and local service, then try again.",
    offline: "Start this camera to view its video and visitor counts.",
  }[presentation];
  const StatusIcon = loading ? Wifi : presentation === "error" ? CircleAlert : WifiOff;
  const overlayConfig = isEditMode && editForm ? editForm.config : activeCam.config;
  const isZoneEditor = isEditMode && editForm?.analysisMode === "open_space";
  const shouldShowConfigOverlay = isEditMode || displayPreferences.area;
  const frameWidth = detections.frame_width ?? 0;
  const frameHeight = detections.frame_height ?? 0;
  const imageAspectRatio = decodedAspectRatio ?? (frameWidth > 0 && frameHeight > 0 ? frameWidth / frameHeight : null);
  // Boxes from stalled processing would sit still over live video, so they are hidden.
  const freshDetections = detectionsAreFresh(health?.processed_frame_stale_ms, health?.analytics_fps ?? health?.target_processing_fps);
  const confidentTracks = useMemo(() => (freshDetections ? detections.tracks.filter((track) => track.confidence >= activeCam.confidence) : NO_TRACKS), [activeCam.confidence, detections.tracks, freshDetections]);
  // Boxes glide between detection updates and survive a brief miss instead of jumping or blinking.
  const heldTracks = useHeldTracks(confidentTracks, activeCam.id);
  const visibleTracks = freshDetections ? heldTracks : NO_DISPLAYED_TRACKS;
  const developer = useDeveloperSettings();
  const showsTrackLabels = developer.detectionLabels || developer.demographics;

  const clearPreviewTimers = useCallback(() => {
    if (connectWatchdogRef.current !== null) {
      window.clearTimeout(connectWatchdogRef.current);
      connectWatchdogRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const schedulePreviewRetry = useCallback(() => {
    if (previewSourceRef.current !== streamUrl) return;
    if (retryTimerRef.current !== null) return;
    setDecodedStreamUrl(null);
    if (!canRetryPreview(previewAttempt)) {
      setConnectionState("failed");
      return;
    }
    setConnectionState("retrying");
    const retrySource = streamUrl;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      if (previewSourceRef.current !== retrySource) return;
      setPreviewAttempt((attempt) => attempt + 1);
    }, getPreviewRetryDelayMs(previewAttempt));
  }, [previewAttempt, streamUrl]);

  useEffect(() => {
    clearPreviewTimers();
    setPreviewAttempt(0);
    setDecodedStreamUrl(null);
    setDecodedAspectRatio(null);
    setConnectionState("connecting");
  }, [activeCam.id, clearPreviewTimers, streamUrl]);

  useEffect(() => {
    onPreviewStateChange?.(previewState === "live" && !isActuallyLive ? (counts.status === "reconnecting" ? "retrying" : "connecting") : previewState);
  }, [counts.status, isActuallyLive, onPreviewStateChange, previewState]);

  useEffect(() => {
    if (!streamIsAvailable) {
      clearPreviewTimers();
      return;
    }
    setConnectionState("connecting");
    const startedAt = Date.now();
    const checkForDecodedFrame = () => {
      const image = previewImageRef.current;
      if (image && hasRenderablePreviewFrame(image.naturalWidth, image.naturalHeight)) {
        connectWatchdogRef.current = null;
        setDecodedAspectRatio(image.naturalWidth / image.naturalHeight);
        setDecodedStreamUrl(effectiveStreamUrl);
        return;
      }
      if (Date.now() - startedAt >= 10_000) {
        connectWatchdogRef.current = null;
        schedulePreviewRetry();
        return;
      }
      connectWatchdogRef.current = window.setTimeout(checkForDecodedFrame, 250);
    };
    connectWatchdogRef.current = window.setTimeout(checkForDecodedFrame, 250);
    return clearPreviewTimers;
  }, [clearPreviewTimers, effectiveStreamUrl, schedulePreviewRetry, streamIsAvailable]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || imageAspectRatio === null) {
      setContentRect(null);
      return;
    }

    const updateContentRect = () => {
      // The image fills the padding box, so the overlay must exclude the preview border too.
      const bounds = { width: container.clientWidth, height: container.clientHeight };
      const containerAspect = bounds.width / bounds.height;

      if (containerAspect > imageAspectRatio) {
        const width = bounds.height * imageAspectRatio;
        setContentRect({ height: bounds.height, left: (bounds.width - width) / 2, top: 0, width });
        return;
      }

      const height = bounds.width / imageAspectRatio;
      setContentRect({ height, left: 0, top: (bounds.height - height) / 2, width: bounds.width });
    };

    updateContentRect();

    const resizeObserver = new ResizeObserver(updateContentRect);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [imageAspectRatio]);

  return (
    <div
      ref={containerRef}
      className={`camera-video-preview relative h-full min-h-72 w-full rounded-tanaw-xl border border-slate-800/90 bg-[#07110d] shadow-[0_22px_48px_rgba(2,8,18,0.32)] ${isZoneEditor ? "" : "overflow-hidden"} ${isEditMode ? "ring-2 ring-[#0b8b68] ring-offset-2 ring-offset-slate-100 dark:ring-offset-[#0d1724]" : ""}`}
    >
      {streamIsAvailable ? (
        <img
          ref={previewImageRef}
          key={effectiveStreamUrl}
          src={effectiveStreamUrl}
          alt={`${activeCam.name} live camera stream`}
          className={`absolute inset-0 h-full w-full rounded-[inherit] object-contain ${isActuallyLive ? "" : "invisible"}`}
          draggable={false}
          onError={(event) => {
            if (!isCurrentPreviewRequest(previewSourceRef.current, streamUrl, previewImageRef.current, event.currentTarget)) return;
            if (connectWatchdogRef.current !== null) {
              window.clearTimeout(connectWatchdogRef.current);
              connectWatchdogRef.current = null;
            }
            schedulePreviewRetry();
          }}
          onLoad={(event) => {
            if (!isCurrentPreviewRequest(previewSourceRef.current, streamUrl, previewImageRef.current, event.currentTarget)) return;
            if (!hasRenderablePreviewFrame(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) return;
            if (connectWatchdogRef.current !== null) {
              window.clearTimeout(connectWatchdogRef.current);
              connectWatchdogRef.current = null;
            }
            setDecodedAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight);
            setDecodedStreamUrl(effectiveStreamUrl);
          }}
        />
      ) : null}
      <div className={`camera-preview-state rounded-[inherit] ${isActuallyLive ? "is-hidden" : ""}`} data-state={presentation} aria-hidden={isActuallyLive}>
        <div className="camera-preview-state-brand">
          <Video size={18} />
          <span>
            TANAW <span>CAMERA MONITORING</span>
          </span>
        </div>
        <div className="camera-preview-state-message" role="status" aria-live="polite">
          <div className={`camera-preview-state-icon ${loading ? "is-loading" : ""}`}>
            <StatusIcon size={30} />
          </div>
          <h3>{statusHeading}</h3>
          <p>{statusDescription}</p>
          {loading && (
            <div className="camera-preview-progress" aria-label="Connecting">
              <span />
            </div>
          )}
          {!loading && onRetry && (
            <button
              type="button"
              className="camera-preview-retry"
              tabIndex={isActuallyLive ? -1 : 0}
              onClick={() => {
                if (!streamIsAvailable) {
                  void onRetry?.();
                  return;
                }
                clearPreviewTimers();
                setDecodedStreamUrl(null);
                setPreviewAttempt((attempt) => (attempt === 0 ? 1 : 0));
                setConnectionState("connecting");
              }}
            >
              <RefreshCw size={16} />
              {presentation === "offline" ? "Start camera" : "Retry connection"}
            </button>
          )}
        </div>
        <div className="camera-preview-state-footer">
          <span>{activeCam.name}</span>
          <span>{activeCam.cameraHost || "RTSP camera"}</span>
        </div>
      </div>

      {shouldShowConfigOverlay && isActuallyLive && contentRect && (
        <div className={`absolute ${isZoneEditor ? "z-20" : ""}`} style={{ height: contentRect.height, left: contentRect.left, top: contentRect.top, width: contentRect.width }}>
          {(isEditMode && editForm ? editForm : activeCam).analysisMode === "open_space" ? (
            <OpenSpaceOverlay
              value={(isEditMode && editForm ? editForm : activeCam).openSpace}
              editable={isEditMode && Boolean(contentRect) && isActuallyLive}
              onEditCheckpoint={onEditCheckpoint}
              selectedPoint={selectedZonePoint}
              onSelectPoint={onSelectZonePoint}
              onChange={(openSpace) => onEditFormChange((current) => (current?.analysisMode === "open_space" ? { ...current, openSpace } : current))}
            />
          ) : (
            <CameraOverlayConfig
              config={overlayConfig}
              onEditCheckpoint={onEditCheckpoint}
              isEditMode={isEditMode && Boolean(contentRect) && isActuallyLive}
              onConfigChange={
                isEditMode
                  ? (config) => {
                      onEditFormChange((current) => (current ? { ...current, config } : current));
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
      {(displayPreferences.people || showsTrackLabels) && isActuallyLive && contentRect && frameWidth > 0 && frameHeight > 0 && (
        <div className="pointer-events-none absolute" style={{ height: contentRect.height, left: contentRect.left, top: contentRect.top, width: contentRect.width }}>
          {visibleTracks.map((track) => {
            const [x1, y1, x2, y2] = track.bbox;
            const left = clampPercent((Math.min(x1, x2) / frameWidth) * 100);
            const right = clampPercent((Math.max(x1, x2) / frameWidth) * 100);
            const top = clampPercent((Math.min(y1, y2) / frameHeight) * 100);
            const bottom = clampPercent((Math.max(y1, y2) / frameHeight) * 100);
            const width = Math.max(0, right - left);
            const height = Math.max(0, bottom - top);
            const triggerPoint = track.trigger_point ?? track.centroid ?? getBboxCenter(track.bbox);
            const triggerLeft = clampPercent((triggerPoint[0] / frameWidth) * 100);
            const triggerTop = clampPercent((triggerPoint[1] / frameHeight) * 100);
            const isCrossing = track.direction === "entry" || track.direction === "exit";
            const isOutsideRoi = track.inside_roi === false;
            const labelLines = showsTrackLabels
              ? trackLabelLines(track, {
                  analysisMode: activeCam.analysisMode ?? "entrance_exit",
                  inMonitoredArea: Boolean(area?.active_visits.some((visit) => visit.track_generation === track.track_id)),
                  developer,
                })
              : [];
            const tone = getTrackTone(isOutsideRoi, isCrossing);

            return (
              <div key={track.track_id} className="contents">
                <div
                  data-track-id={track.track_id}
                  data-track-held={track.held ? "true" : undefined}
                  className={`absolute bg-transparent ${track.track_id > 0 ? "transition-[left,top,width,height,opacity] duration-200 ease-linear motion-reduce:transition-none" : ""} ${track.held ? "opacity-60" : ""} ${displayPreferences.people || labelLines.length > 0 ? `border ${tone.boxClass}` : ""}`}
                  style={{ height: `${height}%`, left: `${left}%`, top: `${top}%`, width: `${width}%` }}
                >
                  {labelLines.length > 0 && (
                    <span
                      data-testid="track-developer-label"
                      className={`absolute top-1 left-1 grid gap-0.5 rounded-md border px-1.5 py-1 text-[9px] leading-none font-bold whitespace-nowrap shadow-sm backdrop-blur-md ${tone.labelClass}`}
                    >
                      {labelLines.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                    </span>
                  )}
                </div>
                <span
                  hidden={!displayPreferences.people}
                  aria-hidden="true"
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0_10px_rgba(34,211,238,0.42)] transition-[left,top] duration-200 ease-linear motion-reduce:transition-none ${tone.triggerClass}`}
                  style={{ left: `${triggerLeft}%`, top: `${triggerTop}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getBboxCenter(bbox: [number, number, number, number]): [number, number] {
  const [x1, y1, x2, y2] = bbox;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function getTrackTone(isOutsideRoi: boolean, isCrossing: boolean) {
  if (isOutsideRoi) {
    return {
      boxClass: "rounded-[3px] border-slate-300/75 shadow-[0_0_12px_rgba(148,163,184,0.2)] ring-1 ring-slate-950/35",
      labelClass: "border-slate-300/25 bg-slate-950/80 text-slate-100 ring-1 ring-white/10",
      triggerClass: "border-slate-950/70 bg-slate-100 ring-1 ring-white/35",
    };
  }

  if (isCrossing) {
    return {
      boxClass: "rounded-[3px] border-yellow-300/90 shadow-[0_0_14px_rgba(250,204,21,0.34)] ring-1 ring-slate-950/35",
      labelClass: "border-yellow-200/45 bg-slate-950/82 text-yellow-100 ring-1 ring-yellow-300/20",
      triggerClass: "border-slate-950/75 bg-yellow-200 ring-1 ring-white/45",
    };
  }

  return {
    boxClass: "rounded-[3px] border-emerald-300/85 shadow-[0_0_14px_rgba(16,185,129,0.3)] ring-1 ring-slate-950/35",
    labelClass: "border-emerald-200/35 bg-slate-950/82 text-emerald-100 ring-1 ring-emerald-300/20",
    triggerClass: "border-slate-950/75 bg-cyan-300 ring-1 ring-white/45",
  };
}
