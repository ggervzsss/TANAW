import { AlertTriangle, CheckCircle } from "lucide-react";
import type { Camera } from "../../../types/enterprise";
import { maskStreamCredentials } from "../utils/rtsp";

type CameraReadOnlyDetailsProps = {
  activeCam: Camera;
};

export function CameraReadOnlyDetails({ activeCam }: CameraReadOnlyDetailsProps) {
  const verified = ["online", "running"].includes(activeCam.status);

  return (
    <div className="rounded-sm border border-gray-200 bg-white/85 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Stream Details</h4>
        <div className={`flex items-center gap-1.5 text-[10px] font-bold ${verified ? "text-[#065f46]" : "text-red-600"}`}>
          {verified ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {verified ? "Verified" : "Needs Check"}
        </div>
      </div>

      <div className="space-y-2">
        <DetailRow label="Stream URL" value={maskStreamCredentials(activeCam.rtsp)} mono />
        <div className="grid grid-cols-2 gap-2">
          <DetailRow label="Camera Type" value={formatCameraType(activeCam.cameraType)} />
          <DetailRow label="Assigned Zone" value={activeCam.zone} />
          <DetailRow label="Tripwire Mode" value="Entry / Exit Lines" />
          <DetailRow label="Confidence" value={activeCam.confidence.toFixed(2)} />
          <DetailRow label="Processing" value={formatProcessingProfile(activeCam.processingProfile)} />
        </div>
      </div>
    </div>
  );
}

function formatProcessingProfile(profile: Camera["processingProfile"]) {
  const labels: Record<Camera["processingProfile"], string> = {
    accelerated: "GPU Accelerated",
    auto: "Auto Detect",
    cpu: "CPU Optimized",
  };
  return labels[profile];
}

type DetailRowProps = {
  label: string;
  mono?: boolean;
  value: string;
};

function DetailRow({ label, mono = false, value }: DetailRowProps) {
  return (
    <div className="min-w-0 rounded-sm border border-gray-200 bg-gray-50 px-2 py-1.5">
      <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold text-gray-800 ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </p>
    </div>
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
