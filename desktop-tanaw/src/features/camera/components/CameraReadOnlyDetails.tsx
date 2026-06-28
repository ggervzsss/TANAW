import { AlertTriangle, CheckCircle } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { Camera } from "../../../types/enterprise";
import { maskStreamCredentials } from "../utils/rtsp";

type CameraReadOnlyDetailsProps = {
  activeCam: Camera;
};

export function CameraReadOnlyDetails({ activeCam }: CameraReadOnlyDetailsProps) {
  const verified = ["online", "running"].includes(activeCam.status);

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Stream Details</h4>
          <p className="mt-0.5 text-[10px] font-semibold text-gray-500">Configuration used by local processing.</p>
        </div>
        <div
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
            verified ? "border-emerald-200 bg-emerald-50 text-[#065f46]" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {verified ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
          {verified ? "Verified" : "Needs Check"}
        </div>
      </div>

      <div className="space-y-2">
        <DetailRow label="Stream URL" value={maskStreamCredentials(activeCam.rtsp)} tooltip="RTSP or stream source used by local camera processing." mono />
        <div className="grid grid-cols-2 gap-2">
          <DetailRow label="Camera Type" value={formatCameraType(activeCam.cameraType)} tooltip="Configured camera source type for this node." />
          <DetailRow label="Assigned Zone" value={activeCam.zone} tooltip="Operational zone assigned to this camera." />
          <DetailRow label="Tripwire Mode" value="Entry / Exit Lines" tooltip="Counting mode used for entry and exit detection." />
          <DetailRow label="Confidence" value={activeCam.confidence.toFixed(2)} tooltip="Minimum detection confidence used by the AI pipeline." />
          <div className="col-span-2">
            <DetailRow label="Processing" value={formatProcessingProfile(activeCam.processingProfile)} tooltip="Processing mode selected for this camera node." />
          </div>
        </div>
      </div>
    </section>
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
  tooltip: string;
  value: string;
};

function DetailRow({ label, mono = false, tooltip, value }: DetailRowProps) {
  return (
    <InfoTooltip content={tooltip}>
      <div className="min-w-0 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 transition-colors group-hover:border-[#065f46]/30 group-focus:border-[#065f46]/30">
        <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</p>
        <p className={`mt-1 text-xs leading-snug font-semibold wrap-break-word text-gray-800 ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </InfoTooltip>
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
