import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Camera } from "../../../types/enterprise";
import type { MlCounts, MlDetections, MlHealth } from "../services/ml-service";
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
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const streamIsAvailable = isProcessing && streamUrl;
  const overlayConfig = isEditMode && editForm ? editForm.config : activeCam.config;
  const shouldShowConfigOverlay = isEditMode || !streamIsAvailable;
  const frameWidth = detections.frame_width ?? 0;
  const frameHeight = detections.frame_height ?? 0;
  const visibleTracks = detections.tracks.filter((track) => track.confidence >= activeCam.confidence);
  const activeTrackCount = visibleTracks.filter((track) => track.track_id > 0).length;
  const fpsLabel = health?.analytics_fps ? `${health.analytics_fps.toFixed(1)} AI FPS` : "AI FPS Adaptive";

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
      className={`relative h-full min-h-[360px] w-full overflow-hidden rounded-sm border border-slate-800 bg-[#07110d] shadow-[0_20px_45px_rgba(15,23,42,0.22)] ${isEditMode ? "ring-2 ring-[#065f46] ring-offset-2" : ""}`}
    >
      {streamIsAvailable ? (
        <img key={streamUrl} src={streamUrl} alt={`${activeCam.name} live camera stream`} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      ) : activeCam.status === "online" || activeCam.status === "untested" || activeCam.status === "stopped" ? (
        <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg/1280px-6346Poblacion_City_Hall_San_Pedro_Laguna_27.jpg')] bg-cover bg-center opacity-40"></div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black text-sm font-bold tracking-wider text-red-500 uppercase">Stream Offline</div>
      )}
      {!streamIsAvailable && <div className="absolute inset-0 bg-black/30"></div>}

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
            const isCrossing = track.direction === "entry" || track.direction === "exit";
            const isOutsideRoi = track.inside_roi === false;
            const sourceSuffix = track.source_track_id !== track.track_id ? `/${track.source_track_id}` : "";
            const label = track.track_id > 0 ? `#${track.track_id}${sourceSuffix}` : "PERSON";
            const tone = getTrackTone(isOutsideRoi, isCrossing);

            return (
              <div key={track.track_id} className={`absolute border ${tone.boxClass}`} style={{ height: `${height}%`, left: `${left}%`, top: `${top}%`, width: `${width}%` }}>
                <span className={`absolute top-1 left-1 rounded-full border px-1.5 py-px text-[9px] leading-none font-bold whitespace-nowrap shadow-sm backdrop-blur-sm ${tone.labelClass}`}>
                  {label} - {(track.confidence * 100).toFixed(0)}%
                </span>
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
        {(streamIsAvailable || activeCam.status === "online") && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <span className="flex items-center gap-1 rounded-full border border-green-500/50 bg-black/60 px-2 py-1 text-[10px] font-bold text-green-400 shadow-sm backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400"></span> LIVE
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

function getTrackTone(isOutsideRoi: boolean, isCrossing: boolean) {
  if (isOutsideRoi) {
    return {
      boxClass: "border-slate-300/80 shadow-[0_0_10px_rgba(148,163,184,0.26)]",
      labelClass: "border-slate-200/70 bg-slate-900/65 text-slate-100",
    };
  }

  if (isCrossing) {
    return {
      boxClass: "border-yellow-300/90 shadow-[0_0_10px_rgba(250,204,21,0.38)]",
      labelClass: "border-yellow-200/60 bg-yellow-400/75 text-slate-950",
    };
  }

  return {
    boxClass: "border-emerald-400/85 shadow-[0_0_10px_rgba(34,197,94,0.3)]",
    labelClass: "border-emerald-200/60 bg-emerald-500/70 text-white",
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
