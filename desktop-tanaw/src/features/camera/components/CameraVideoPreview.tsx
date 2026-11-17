import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import type { MlAreaState, MlCounts, MlDetections, MlHealth } from "../services/ml-service";
import { canRetryPreview, getPreviewRetryDelayMs, hasRenderablePreviewFrame, isCurrentPreviewRequest, withPreviewRetryVersion } from "../utils/camera-preview-recovery";
import { OpenSpaceOverlay } from "./OpenSpaceOverlay";
import { CameraOverlayConfig } from "./CameraOverlayConfig";
import { Video, Wifi, WifiOff, CircleAlert, RefreshCw } from "lucide-react";

import { DEFAULT_CAMERA_DISPLAY, type CameraDisplayPreferences } from "../model/camera-display";
import { trackLabelLines } from "../model/track-labels";
import { useDeveloperSettings } from "../../preferences/developer-settings";

type CameraVideoPreviewProps = {
  displayPreferences?: CameraDisplayPreferences;
  onRetry?: () => void | Promise<boolean | void>;
  onEditCheckpoint?: () => void;
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
  const [previewState, setPreviewState] = useState<CameraPreviewState>("connecting");
  const streamIsAvailable = Boolean(isProcessing && streamUrl);
  const effectiveStreamUrl = useMemo(() => withPreviewRetryVersion(streamUrl, previewAttempt), [previewAttempt, streamUrl]);
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
  const shouldShowConfigOverlay = isEditMode || displayPreferences.area;
  const frameWidth = detections.frame_width ?? 0;
  const frameHeight = detections.frame_height ?? 0;
  const visibleTracks = detections.tracks.filter((track) => track.confidence >= activeCam.confidence);
  const developer = useDeveloperSettings();
  const showsTrackLabels = developer.detectionLabels || developer.demographics;
  const fpsLabel = health?.analytics_fps ? `${health.analytics_fps.toFixed(1)} AI FPS` : "AI FPS Adaptive";

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
    if (!canRetryPreview(previewAttempt)) {
      setPreviewState("failed");
      return;
    }
    setPreviewState("retrying");
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
    setPreviewState("connecting");
  }, [activeCam.id, clearPreviewTimers, streamUrl]);

  useEffect(() => {
    onPreviewStateChange?.(previewState === "live" && !isActuallyLive ? (counts.status === "reconnecting" ? "retrying" : "connecting") : previewState);
  }, [counts.status, isActuallyLive, onPreviewStateChange, previewState]);

  useEffect(() => {
    if (!streamIsAvailable) {
      clearPreviewTimers();
      return;
    }
    setPreviewState("connecting");
    const startedAt = Date.now();
    const checkForDecodedFrame = () => {
      const image = previewImageRef.current;
      if (image && hasRenderablePreviewFrame(image.naturalWidth, image.naturalHeight)) {
        connectWatchdogRef.current = null;
        setPreviewState("live");
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
    if (!container || frameWidth <= 0 || frameHeight <= 0) {
      setContentRect(null);
      return;
    }

    const updateContentRect = () => {
      const bounds = container.getBoundingClientRect();
      const frameAspect = frameWidth / frameHeight;
      const containerAspect = bounds.width / bounds.height;

      if (containerAspect > frameAspect) {
        const width = bounds.height * frameAspect;
        setContentRect({ height: bounds.height, left: (bounds.width - width) / 2, top: 0, width });
        return;
      }

      const height = bounds.width / frameAspect;
      setContentRect({ height, left: 0, top: (bounds.height - height) / 2, width: bounds.width });
    };

    updateContentRect();

    const resizeObserver = new ResizeObserver(updateContentRect);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [frameHeight, frameWidth]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-72 w-full overflow-hidden rounded-tanaw-xl border border-slate-800/90 bg-[#07110d] shadow-[0_22px_48px_rgba(2,8,18,0.32)] ${isEditMode ? "ring-2 ring-[#0b8b68] ring-offset-2 ring-offset-slate-100 dark:ring-offset-[#0d1724]" : ""}`}
    >
      {streamIsAvailable ? (
        <img
          ref={previewImageRef}
          key={effectiveStreamUrl}
          src={effectiveStreamUrl}
          alt={`${activeCam.name} live camera stream`}
          className="absolute inset-0 h-full w-full object-contain"
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
            if (connectWatchdogRef.current !== null) {
              window.clearTimeout(connectWatchdogRef.current);
              connectWatchdogRef.current = null;
            }
            setPreviewState("live");
          }}
        />
      ) : null}
      <div className={`camera-preview-state ${isActuallyLive ? "is-hidden" : ""}`} data-state={presentation} aria-hidden={isActuallyLive}>
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
          {!loading && (
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
                setPreviewAttempt((attempt) => (attempt === 0 ? 1 : 0));
                setPreviewState("connecting");
              }}
              disabled={!onRetry && !streamIsAvailable}
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

      {shouldShowConfigOverlay && isActuallyLive && (
        <div className="absolute" style={contentRect ? { height: contentRect.height, left: contentRect.left, top: contentRect.top, width: contentRect.width } : { inset: 0 }}>
          {(isEditMode && editForm ? editForm : activeCam).analysisMode === "open_space" ? (
            <OpenSpaceOverlay
              value={(isEditMode && editForm ? editForm : activeCam).openSpace}
              editable={isEditMode && Boolean(contentRect) && isActuallyLive}
              onEditCheckpoint={onEditCheckpoint}
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
                  className={`absolute bg-transparent ${displayPreferences.people || labelLines.length > 0 ? `border ${tone.boxClass}` : ""}`}
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
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0_10px_rgba(34,211,238,0.42)] transition-[left,top] duration-75 ease-linear ${tone.triggerClass}`}
                  style={{ left: `${triggerLeft}%`, top: `${triggerTop}%` }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className={`camera-preview-badges absolute top-3 right-3 left-3 flex items-start justify-between gap-3 ${!isActuallyLive ? "invisible" : ""}`}>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <PreviewBadge label="● LIVE" tone="ok" />
          <PreviewBadge label={`People in Area: ${activeCam.analysisMode === "open_space" ? (area?.available ? (area.presence ?? "—") : "—") : (counts.occupancy ?? "—")}`} tone="neutral" />
          <PreviewBadge label={health?.model_ready ? "Model Ready" : health?.model_loading ? "Model Loading" : "Model Standby"} tone={health?.model_ready ? "ok" : "neutral"} />
        </div>
        {streamIsAvailable && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <span
              className={`flex items-center gap-1 rounded-full border bg-black/60 px-2 py-1 text-[10px] font-bold shadow-sm backdrop-blur-sm ${
                previewState === "live" ? "border-green-500/50 text-green-400" : previewState === "failed" ? "border-red-400/50 text-red-200" : "border-amber-400/50 text-amber-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${previewState === "live" ? "bg-green-400" : "bg-amber-300"}`}></span>
              {previewState === "live" ? "LIVE" : previewState === "failed" ? "PREVIEW FAILED" : "RECOVERING"}
            </span>
            <span className="rounded-full border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur-sm">{fpsLabel}</span>
          </div>
        )}
      </div>
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

type PreviewBadgeProps = {
  label: string;
  tone: "ok" | "neutral";
};

function PreviewBadge({ label, tone }: PreviewBadgeProps) {
  const toneClass = tone === "ok" ? "border-emerald-400/40 bg-emerald-950/55 text-emerald-100" : "border-white/15 bg-black/45 text-white/80";

  return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold shadow-sm backdrop-blur-sm ${toneClass}`}>{label}</span>;
}
