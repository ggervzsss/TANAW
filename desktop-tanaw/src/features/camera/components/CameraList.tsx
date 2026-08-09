import { Plus, Video } from "lucide-react";
import { Card } from "../../../components/Card";
import type { Camera } from "../../../types/enterprise";

type CameraListProps = {
  cameras: Camera[];
  activeCamId: number | null;
  cameraLimit: number;
  onSelect: (cameraId: number) => void;
  onAdd: () => void;
};

export function CameraList({ cameras, activeCamId, cameraLimit, onAdd, onSelect }: CameraListProps) {
  const cameraLimitReached = cameras.length >= cameraLimit;
  return (
    <Card className="flex h-full min-h-0 flex-col rounded-[18px] border border-slate-200/80 bg-white/95 p-3.5 shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/8 dark:bg-[#121d2b]/96 dark:shadow-[0_20px_48px_rgba(2,8,18,0.3)]">
      <h3 className="mb-3 flex shrink-0 items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-[#111827] uppercase dark:text-slate-100">
        <Video size={16} className="text-[#065f46]" /> Configured Cameras
      </h3>
      <button
        type="button"
        onClick={onAdd}
        disabled={cameraLimitReached}
        aria-describedby={cameraLimitReached ? "camera-configuration-limit" : undefined}
        className="mb-3 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-700/25 bg-emerald-50/70 px-3 py-2.5 text-xs font-bold text-[#065f46] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-all hover:-translate-y-px hover:border-emerald-700/40 hover:bg-emerald-100/70 focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500 dark:border-emerald-300/20 dark:bg-emerald-400/8 dark:text-emerald-300 dark:hover:border-emerald-300/35 dark:hover:bg-emerald-400/14 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
      >
        <Plus size={15} /> Add Camera
      </button>
      {cameraLimitReached && (
        <p id="camera-configuration-limit" className="mb-3 text-[10px] leading-relaxed font-semibold text-amber-700 dark:text-amber-200">
          This Enterprise account can register up to {cameraLimit} cameras.
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cameras.map((camera) => {
          const isActive = activeCamId === camera.id;
          return (
            <div
              key={camera.id}
              onClick={() => onSelect(camera.id)}
              className={`cursor-pointer rounded-xl border p-3 transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px ${isActive ? "border-[#08775b]/70 bg-emerald-50/90 shadow-[0_10px_24px_rgba(6,95,70,0.1)] ring-1 ring-emerald-700/8 dark:border-emerald-400/45 dark:bg-emerald-400/11 dark:shadow-[0_12px_26px_rgba(1,10,18,0.26)]" : "border-gray-200/90 bg-white/60 hover:border-emerald-700/25 hover:bg-gray-50 dark:border-white/8 dark:bg-white/2 dark:hover:border-emerald-300/20 dark:hover:bg-white/5"}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className={`truncate text-xs font-bold ${isActive ? "text-[#065f46] dark:text-emerald-300" : "text-[#111827] dark:text-slate-100"}`}>{camera.name}</span>
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(camera.status)}`} />
              </div>
              <div className="grid gap-1 text-[11px] font-medium text-gray-500 dark:text-slate-400">
                <span className="truncate">Zone: {camera.zone}</span>
                <span className="capitalize">Status: {camera.status}</span>
              </div>
            </div>
          );
        })}
        {cameras.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500 dark:border-slate-600 dark:text-slate-400">No cameras registered.</div>
        )}
      </div>
    </Card>
  );
}

function statusDotClass(status: Camera["status"]) {
  if (status === "online" || status === "running") return "bg-[#45a549] shadow-[0_0_4px_#45a549]";
  if (status === "starting" || status === "connecting" || status === "degraded" || status === "reconnecting") return "bg-amber-400 shadow-[0_0_4px_#fbbf24]";
  if (status === "offline" || status === "failed" || status === "error") return "bg-tanaw-red";
  return "bg-slate-400";
}
