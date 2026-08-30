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
    <section className="rounded-2xl border border-gray-200/90 bg-white/95 p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.055)] dark:border-white/8 dark:bg-[#142130] dark:shadow-[0_14px_32px_rgba(1,8,17,0.22)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-bold tracking-wider text-[#111827] uppercase dark:text-slate-100">Camera Connection</h4>
          <p className="mt-0.5 text-[10px] font-semibold text-gray-500 dark:text-slate-400">Connection and visitor-counting settings.</p>
        </div>
        <div
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
            verified
              ? "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-400/22 dark:bg-emerald-400/9 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-400/22 dark:bg-red-400/9 dark:text-red-200"
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
      <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 transition-colors group-hover:border-[#065f46]/30 group-focus:border-[#065f46]/30 dark:border-white/8 dark:bg-white/3 dark:group-hover:border-emerald-300/22">
        <p className="text-[9px] font-bold tracking-wider text-gray-500 uppercase dark:text-slate-500">{label}</p>
        <p className={`mt-1 text-xs leading-snug font-semibold wrap-break-word text-gray-800 dark:text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </InfoTooltip>
  );
}
