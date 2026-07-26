import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import type { MlCounts, MlDetections, MlHealth } from "../services/ml-service";
import { getPreviewRetryDelayMs, withPreviewRetryVersion } from "../utils/camera-preview-recovery";
import { CameraOverlayConfig } from "./CameraOverlayConfig";

type CameraVideoPreviewProps = {
  activeCam: Camera;
  counts: MlCounts;
  detections: MlDetections;
  editForm: Camera | null;
  health: MlHealth | null;
  isProcessing: boolean;
  isEditMode: boolean;
  onEditFormChange: Dispatch<SetStateAction<Camera | null>>;
  streamUrl: string;
};

type ContentRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function CameraVideoPreview({ activeCam, counts, detections, editForm, health, isProcessing, isEditMode, onEditFormChange, streamUrl }: CameraVideoPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const connectWatchdogRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewState, setPreviewState] = useState<"connecting" | "live" | "retrying">("connecting");
  const streamIsAvailable = Boolean(isProcessing && streamUrl);
  const effectiveStreamUrl = useMemo(() => withPreviewRetryVersion(streamUrl, previewAttempt), [previewAttempt, streamUrl]);
  const isStarting = counts.status === "starting" || counts.status === "connecting" || activeCam.status === "starting";
  const overlayConfig = isEditMode && editForm ? editForm.config : activeCam.config;
  const shouldShowConfigOverlay = true;
  const frameWidth = detections.frame_width ?? 0;
  const frameHeight = detections.frame_height ?? 0;
  const visibleTracks = detections.tracks.filter((track) => track.confidence >= activeCam.confidence);
  const activeTrackCount = visibleTracks.filter((track) => track.track_id > 0).length;
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
    if (retryTimerRef.current !== null) return;
    setPreviewState("retrying");
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setPreviewAttempt((attempt) => attempt + 1);
    }, getPreviewRetryDelayMs(previewAttempt));
  }, [previewAttempt]);

  useEffect(() => {
    clearPreviewTimers();
    setPreviewAttempt(0);
    setPreviewState("connecting");
  }, [activeCam.id, clearPreviewTimers, streamUrl]);

  useEffect(() => {
    if (!streamIsAvailable) {
      clearPreviewTimers();
      return;
    }
    setPreviewState("connecting");
    connectWatchdogRef.current = window.setTimeout(() => {
      connectWatchdogRef.current = null;
      schedulePreviewRetry();
    }, 10_000);
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
      className={`relative h-full min-h-90 w-full overflow-hidden rounded-sm border border-slate-800 bg-[#07110d] shadow-[0_20px_45px_rgba(15,23,42,0.22)] ${isEditMode ? "ring-2 ring-[#065f46] ring-offset-2" : ""}`}
    >
      {streamIsAvailable ? (
        <img
          key={effectiveStreamUrl}
          src={effectiveStreamUrl}
          alt={`${activeCam.name} live camera stream`}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
          onError={() => {
            if (connectWatchdogRef.current !== null) {
              window.clearTimeout(connectWatchdogRef.current);
              connectWatchdogRef.current = null;
            }
            schedulePreviewRetry();
          }}
          onLoad={() => {
            if (connectWatchdogRef.current !== null) {
              window.clearTimeout(connectWatchdogRef.current);
              connectWatchdogRef.current = null;
            }
            setPreviewState("live");
          }}
        />
      ) : isStarting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-sm font-bold tracking-wider text-emerald-300 uppercase">Starting camera stream…</div>
      ) : activeCam.status === "online" || activeCam.status === "untested" || activeCam.status === "stopped" ? (
        <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg/1280px-6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg')] bg-cover bg-center opacity-40"></div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-sm font-bold tracking-wider text-red-500 uppercase">Stream Offline</div>
      )}
      {!streamIsAvailable && <div className="absolute inset-0 bg-black/30"></div>}
      {streamIsAvailable && previewState !== "live" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full border border-amber-300/40 bg-black/75 px-3 py-1 text-[10px] font-bold tracking-wide text-amber-200 uppercase shadow-sm backdrop-blur-sm">
            {previewState === "retrying" ? "Reconnecting preview…" : "Connecting preview…"}
          </span>
        </div>
      )}

      {shouldShowConfigOverlay && (
        <div className="absolute" style={contentRect ? { height: contentRect.height, left: contentRect.left, top: contentRect.top, width: contentRect.width } : { inset: 0 }}>
          <CameraOverlayConfig
            config={overlayConfig}
            isEditMode={isEditMode}
            onConfigChange={
              isEditMode
                ? (config) => {
                    onEditFormChange((current) => (current ? { ...current, config } : current));
                  }
                : undefined
            }
          />
        </div>
      )}
      {streamIsAvailable && contentRect && frameWidth > 0 && frameHeight > 0 && (
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
            const sourceSuffix = track.source_track_id !== track.track_id ? ` | src ${track.source_track_id}` : "";
            const label = track.track_id > 0 ? `#${track.track_id}${sourceSuffix}` : "Person";
            const tone = getTrackTone(isOutsideRoi, isCrossing);

            return (
              <div key={track.track_id} className="contents">
                <div className={`absolute border bg-transparent ${tone.boxClass}`} style={{ height: `${height}%`, left: `${left}%`, top: `${top}%`, width: `${width}%` }}>
                  <span className={`absolute top-1 left-1 rounded-md border px-1.5 py-1 text-[9px] leading-none font-bold whitespace-nowrap shadow-sm backdrop-blur-md ${tone.labelClass}`}>
                    {label} | {(track.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-[0_0_10px_rgba(34,211,238,0.42)] transition-[left,top] duration-75 ease-linear ${tone.triggerClass}`}
                  style={{ left: `${triggerLeft}%`, top: `${triggerTop}%` }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="absolute top-3 right-3 left-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <PreviewBadge label={counts.running ? "AI Processing" : "Preview"} tone={counts.running ? "ok" : "neutral"} />
          <PreviewBadge label={`${activeTrackCount} Tracks`} tone={activeTrackCount > 0 ? "ok" : "neutral"} />
          <PreviewBadge label={health?.model_ready ? "Model Ready" : health?.model_loading ? "Model Loading" : "Model Standby"} tone={health?.model_ready ? "ok" : "neutral"} />
        </div>
        {streamIsAvailable && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <span
              className={`flex items-center gap-1 rounded-full border bg-black/60 px-2 py-1 text-[10px] font-bold shadow-sm backdrop-blur-sm ${
                previewState === "live" ? "border-green-500/50 text-green-400" : "border-amber-400/50 text-amber-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${previewState === "live" ? "bg-green-400" : "bg-amber-300"}`}></span>
              {previewState === "live" ? "LIVE" : "RECOVERING"}
            </span>
            <span className="rounded-full border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur-sm">{fpsLabel}</span>
            <span className="rounded-full border border-white/20 bg-black/60 px-2 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur-sm">{activeCam.resolution}</span>
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
