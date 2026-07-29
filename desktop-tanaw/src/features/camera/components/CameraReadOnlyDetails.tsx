import { AlertTriangle, CheckCircle } from "lucide-react";
import { InfoTooltip } from "../../../components/InfoTooltip";
import type { Camera } from "../../../types/enterprise";
import { maskStreamCredentials } from "../utils/rtsp";

type CameraReadOnlyDetailsProps = {
  activeCam: Camera;
};

export function CameraReadOnlyDetails({ activeCam }: CameraReadOnlyDetailsProps) {
  const verified = ["online", "running"].includes(activeCam.status);
  const streamProtocol = getStreamProtocol(activeCam.rtsp);

  return (
    <section className="rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase">Camera Connection</h4>
          <p className="mt-0.5 text-[10px] font-semibold text-gray-500">Connection and visitor-counting settings.</p>
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
        <DetailRow label="Camera Address" value={maskStreamCredentials(activeCam.rtsp)} tooltip="The connection address TANAW uses to access this camera." mono />
        <div className="grid grid-cols-2 gap-2">
          <DetailRow label="Counting Area" value={activeCam.zone} tooltip="The area monitored by this camera." />
          <DetailRow label="Counting Direction" value="Entry / Exit Lines" tooltip="Lines used to count entering and exiting visitors." />
          <DetailRow label="Counting Mode" value={formatProcessingProfile(activeCam.processingProfile)} tooltip="The visitor-counting mode selected for this camera." />
          {streamProtocol ? <DetailRow label="Stream Protocol" value={streamProtocol} tooltip="The protocol configured in this camera's stream address." /> : null}
        </div>
      </div>
    </section>
  );
}

function getStreamProtocol(streamAddress: string) {
  return /^([a-z][a-z\d+.-]*):\/\//i.exec(streamAddress)?.[1]?.toUpperCase() ?? null;
}

function formatProcessingProfile(profile: Camera["processingProfile"]) {
  const labels: Record<Camera["processingProfile"], string> = {
    auto: "Auto Recommended",
    balanced: "Balanced",
    compatibility: "Compatibility",
    emergency: "Emergency / Low Power",
    high_accuracy: "High Accuracy",
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
    <InfoTooltip content={tooltip} focusable={false}>
      <div className="min-w-0 rounded-sm border border-gray-200 bg-gray-50 px-3 py-2 transition-colors group-hover:border-[#065f46]/30 group-focus:border-[#065f46]/30">
        <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</p>
        <p className={`mt-1 text-xs leading-snug font-semibold wrap-break-word text-gray-800 ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </InfoTooltip>
  );
}
