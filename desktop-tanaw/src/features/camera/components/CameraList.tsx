import { Plus, Video } from "lucide-react";
import { Card } from "../../../components/Card";
import type { Camera } from "../../../types/enterprise";

type CameraListProps = {
  cameras: Camera[];
  activeCamId: number | null;
  onSelect: (cameraId: number) => void;
  onAdd: () => void;
};

export function CameraList({ cameras, activeCamId, onAdd, onSelect }: CameraListProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col rounded-sm border-t-4 border-t-[#111827] bg-white p-3 shadow-md dark:border-slate-700 dark:border-t-emerald-500 dark:bg-[#121c2a]">
      <h3 className="mb-3 flex shrink-0 items-center gap-2 text-xs font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">
        <Video size={16} className="text-[#065f46]" /> Configured Cameras
      </h3>
      <button
        type="button"
        onClick={onAdd}
        className="mb-3 flex w-full shrink-0 items-center justify-center gap-2 rounded-sm border border-emerald-700/25 bg-emerald-50/70 px-3 py-2 text-xs font-bold text-[#065f46] transition-colors hover:border-emerald-700/40 hover:bg-emerald-100/70 focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:outline-none dark:border-emerald-300/20 dark:bg-emerald-400/8 dark:text-emerald-300 dark:hover:border-emerald-300/35 dark:hover:bg-emerald-400/14"
      >
        <Plus size={15} /> Add Camera
      </button>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cameras.map((camera) => {
          const isActive = activeCamId === camera.id;
          return (
            <div
              key={camera.id}
              onClick={() => onSelect(camera.id)}
              className={`cursor-pointer rounded-sm border p-2.5 transition-[background-color,border-color,box-shadow] ${isActive ? "border-[#065f46] bg-green-50 shadow-sm dark:border-emerald-500/60 dark:bg-emerald-500/12" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/70"}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className={`truncate text-xs font-bold ${isActive ? "text-[#065f46] dark:text-emerald-300" : "text-[#111827] dark:text-slate-100"}`}>{camera.name}</span>
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(camera.status)}`} />
              </div>
              <div className="grid gap-1 text-[11px] font-medium text-gray-500 dark:text-slate-400">
                <span className="truncate">Zone: {camera.zone}</span>
                <span className="truncate">Type: {formatCameraType(camera.cameraType)}</span>
                <span className="capitalize">Status: {camera.status}</span>
              </div>
            </div>
          );
        })}
        {cameras.length === 0 && <div className="rounded-sm border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-slate-600 dark:text-slate-400">No cameras registered.</div>}
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

function formatCameraType(cameraType: Camera["cameraType"]) {
  const labels: Record<Camera["cameraType"], string> = {
    IP_WEBCAM: "IP Webcam",
    ONVIF_CCTV: "ONVIF CCTV",
    RTSP_CCTV: "RTSP CCTV",
    USB_WEBCAM: "USB Webcam",
  };

  return labels[cameraType];
}
