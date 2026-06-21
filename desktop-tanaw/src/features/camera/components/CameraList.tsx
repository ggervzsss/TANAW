import { Video } from "lucide-react";
import { Card } from "../../../components/Card";
import type { Camera } from "../../../types/enterprise";

type CameraListProps = {
  cameras: Camera[];
  activeCamId: number | null;
  onSelect: (cameraId: number) => void;
};

export function CameraList({ cameras, activeCamId, onSelect }: CameraListProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col rounded-sm border-t-4 border-t-[#111827] bg-white p-3 shadow-md">
      <h3 className="mb-3 flex shrink-0 items-center gap-2 text-xs font-bold tracking-wider text-[#111827] uppercase">
        <Video size={16} className="text-[#065f46]" /> Configured Nodes
      </h3>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {cameras.map((camera) => {
          const isActive = activeCamId === camera.id;
          return (
            <div
              key={camera.id}
              onClick={() => onSelect(camera.id)}
              className={`cursor-pointer rounded-sm border p-2.5 transition-all ${isActive ? "border-[#065f46] bg-green-50 shadow-sm" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className={`truncate text-xs font-bold ${isActive ? "text-[#065f46]" : "text-[#111827]"}`}>{camera.name}</span>
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${["online", "running"].includes(camera.status) ? "bg-[#45a549] shadow-[0_0_4px_#45a549]" : "bg-[#a40e0e]"}`}></div>
              </div>
              <div className="grid gap-1 text-[11px] font-medium text-gray-500">
                <span className="truncate">Zone: {camera.zone}</span>
                <span className="truncate">Type: {formatCameraType(camera.cameraType)}</span>
                <span className="capitalize">Status: {camera.status}</span>
              </div>
            </div>
          );
        })}
        {cameras.length === 0 && <div className="rounded-sm border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No cameras registered.</div>}
      </div>
    </Card>
  );
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
