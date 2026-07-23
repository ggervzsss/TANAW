import React from "react";
import { Maximize, Video } from "lucide-react";
import type { Camera } from "../../../types/enterprise";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { TapoRtspBuilder } from "./TapoRtspBuilder";
import { buildTapoRtspUrl, isValidIpv4, parseRtspConnection, type TapoStreamId } from "../utils/rtsp";

type CameraEditControlsProps = {
  cameraIpError?: string;
  editForm: Camera;
  hasExistingPassword: boolean;
  onEditFormChange: React.Dispatch<React.SetStateAction<Camera | null>>;
};

const roiFields = [
  { label: "Top", key: "top", min: 0, max: 50 },
  { label: "Left", key: "left", min: 0, max: 50 },
  { label: "Width", key: "width", min: 20, max: 100 },
  { label: "Height", key: "height", min: 20, max: 100 },
] as const;

export function CameraEditControls({ cameraIpError, editForm, hasExistingPassword, onEditFormChange }: CameraEditControlsProps) {
  const isRtspCamera = editForm.cameraType === "RTSP_CCTV" || editForm.cameraType === "ONVIF_CCTV";
  const parsedRtsp = parseRtspConnection(editForm.rtsp);
  const cameraHost = editForm.cameraHost ?? parsedRtsp.host;
  const rtspStream = editForm.rtspStream ?? parsedRtsp.streamId;
  const updateRtspSource = (nextHost: string, nextStream: TapoStreamId) => {
    onEditFormChange({
      ...editForm,
      cameraHost: nextHost,
      rtsp: buildTapoRtspUrl(nextHost, nextStream),
      rtspStream: nextStream,
    });
  };
  const updateRoi = (key: keyof Camera["config"]["roi"], value: number) => {
    onEditFormChange({
      ...editForm,
      config: {
        ...editForm.config,
        roi: clampRoi(
          {
            ...editForm.config.roi,
            [key]: value,
          },
          key,
        ),
      },
    });
  };

  return (
    <div className="space-y-3 rounded-sm border border-gray-200 bg-white p-3 shadow-sm">
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-wider text-[#111827] uppercase">
          <Video size={14} className="text-[#065f46]" /> Camera Stream
        </h4>
        <div className="space-y-2">
          <CompactField label="Camera Name">
            <input
              type="text"
              value={editForm.name}
              onChange={(event) => onEditFormChange({ ...editForm, name: event.target.value })}
              className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
            />
          </CompactField>
          <CompactField label="Assigned Zone">
            <input
              type="text"
              value={editForm.zone}
              onChange={(event) => onEditFormChange({ ...editForm, zone: event.target.value })}
              className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
            />
          </CompactField>
          {!isRtspCamera && (
            <CompactField label={editForm.cameraType === "USB_WEBCAM" ? "Camera Device Index" : "Camera Stream Address"}>
              <input
                type="text"
                value={editForm.rtsp}
                onChange={(event) => onEditFormChange({ ...editForm, rtsp: event.target.value })}
                className="w-full rounded-sm border border-gray-300 px-2 py-1.5 font-mono text-xs text-gray-800 transition outline-none focus:border-[#065f46]"
              />
            </CompactField>
          )}
          <CompactField label="Camera Type">
            <SelectDropdown
              value={editForm.cameraType}
              onChange={(cameraType) => {
                const nextCameraType = cameraType as Camera["cameraType"];
                const nextIsRtsp = nextCameraType === "RTSP_CCTV" || nextCameraType === "ONVIF_CCTV";
                onEditFormChange({
                  ...editForm,
                  cameraType: nextCameraType,
                  rtsp: nextIsRtsp ? buildTapoRtspUrl(cameraHost, rtspStream) : editForm.rtsp,
                });
              }}
              options={[
                ["IP_WEBCAM", "IP Webcam"],
                ["RTSP_CCTV", "RTSP CCTV"],
                ["USB_WEBCAM", "USB Webcam"],
                ["ONVIF_CCTV", "ONVIF CCTV"],
              ]}
              ariaLabel="Camera type"
              size="compact"
            />
          </CompactField>
          <details className="rounded-sm border border-gray-200 bg-gray-50 p-2">
            <summary className="cursor-pointer text-[9px] font-bold tracking-wider text-gray-500 uppercase">Advanced Settings</summary>
            <div className="mt-2 space-y-2">
              <CompactField label="Processing Profile">
                <SelectDropdown
                  value={editForm.processingProfile}
                  onChange={(processingProfile) => onEditFormChange({ ...editForm, processingProfile: processingProfile as Camera["processingProfile"] })}
                  options={[
                    ["auto", "Auto Recommended"],
                    ["compatibility", "Compatibility"],
                    ["balanced", "Balanced"],
                    ["high_accuracy", "High Accuracy"],
                    ["emergency", "Emergency / Low Power"],
                  ]}
                  ariaLabel="Processing profile"
                  size="compact"
                />
              </CompactField>
              <div className="grid grid-cols-2 gap-2">
                <CompactField label="Counting Confidence">
                  <input
                    type="number"
                    min="0.05"
                    max="0.95"
                    step="0.05"
                    value={editForm.confidence}
                    onChange={(event) => onEditFormChange({ ...editForm, confidence: Number(event.target.value) })}
                    className="w-full rounded-sm border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
                  />
                </CompactField>
                <CompactField label="Tracking Confidence">
                  <input
                    type="number"
                    min="0.01"
                    max={editForm.confidence}
                    step="0.01"
                    value={editForm.trackingConfidence ?? 0.15}
                    onChange={(event) => onEditFormChange({ ...editForm, trackingConfidence: Number(event.target.value) })}
                    className="w-full rounded-sm border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
                  />
                </CompactField>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CompactField label="ReID Mode">
                  <SelectDropdown
                    value={editForm.reidMode ?? "auto"}
                    onChange={(reidMode) => onEditFormChange({ ...editForm, reidMode: reidMode as Camera["reidMode"] })}
                    options={[
                      ["auto", "Auto"],
                      ["off", "Off"],
                      ["fast", "Fast"],
                      ["quality", "Quality"],
                    ]}
                    ariaLabel="Re-identification mode"
                    size="compact"
                  />
                </CompactField>
                <CompactField label="Unique Mode">
                  <SelectDropdown
                    value={editForm.uniqueCountingMode ?? "estimated_reid"}
                    onChange={(uniqueCountingMode) => onEditFormChange({ ...editForm, uniqueCountingMode: uniqueCountingMode as Camera["uniqueCountingMode"] })}
                    options={[
                      ["estimated_reid", "Estimated ReID"],
                      ["entry_only", "Entry Only"],
                    ]}
                    ariaLabel="Unique counting mode"
                    size="compact"
                  />
                </CompactField>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h5 className="flex items-center gap-1.5 text-[9px] font-bold tracking-wider text-gray-500 uppercase">
                    <Maximize size={12} className="text-[#2d5eff]" /> Region Of Interest
                  </h5>
                  <button
                    type="button"
                    onClick={() =>
                      onEditFormChange({
                        ...editForm,
                        config: {
                          ...editForm.config,
                          roi: { top: 0, left: 0, width: 100, height: 100 },
                        },
                      })
                    }
                    className="rounded-sm border border-gray-200 bg-white px-2 py-1 text-[9px] font-bold text-gray-600 transition-colors hover:border-[#065f46]/40 hover:text-[#065f46]"
                  >
                    Full Frame
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {roiFields.map(({ label, key, min, max }) => (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</label>
                        <span className="text-[10px] font-bold text-gray-500">{editForm.config.roi[key]}%</span>
                      </div>
                      <input type="range" min={min} max={max} value={editForm.config.roi[key]} onChange={(event) => updateRoi(key, parseInt(event.target.value, 10))} className="w-full accent-[#2d5eff]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
          <div className="grid grid-cols-2 gap-2">
            <CompactField label="Username" required={isRtspCamera}>
              <input
                type="text"
                required={isRtspCamera}
                aria-required={isRtspCamera}
                autoComplete="username"
                value={editForm.username ?? ""}
                onChange={(event) => onEditFormChange({ ...editForm, username: event.target.value })}
                className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-xs text-gray-800 transition outline-none focus:border-[#065f46]"
              />
            </CompactField>
            <CompactField label="Password" required={isRtspCamera}>
              <PasswordVisibilityInput
                value={editForm.password ?? ""}
                onChange={(password) => onEditFormChange({ ...editForm, password })}
                autoComplete="new-password"
              />
              {hasExistingPassword && !editForm.password ? (
                <span className="mt-1 block text-[9px] font-semibold text-gray-500">Password configured. Leave blank to keep it unchanged.</span>
              ) : null}
            </CompactField>
          </div>
          {isRtspCamera && (
            <TapoRtspBuilder
              host={cameraHost}
              streamId={rtspStream}
              error={cameraIpError ?? (cameraHost && !isValidIpv4(cameraHost) ? "Enter a valid IPv4 address, such as 192.168.1.9." : undefined)}
              onHostChange={(host) => updateRtspSource(host, rtspStream)}
              onStreamChange={(stream) => updateRtspSource(cameraHost, stream)}
              layout="stacked"
            />
          )}
          <CompactField label="Stream URL">
            <input
              readOnly
              aria-readonly="true"
              value={editForm.rtsp}
              className="w-full cursor-default rounded-sm border border-gray-200 bg-gray-100 px-2 py-1.5 font-mono text-xs text-gray-600 outline-none"
            />
          </CompactField>
        </div>
      </section>

    </div>
  );
}

type CompactFieldProps = {
  children: React.ReactNode;
  label: string;
  required?: boolean;
};

function CompactField({ children, label, required = false }: CompactFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-bold tracking-wider text-gray-500 uppercase">
        {label}
        {required ? <span className="ml-1 text-red-600" aria-hidden="true">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function clampRoi(roi: Camera["config"]["roi"], changedKey: keyof Camera["config"]["roi"]) {
  const next = {
    top: clampNumber(roi.top, 0, 100),
    left: clampNumber(roi.left, 0, 100),
    width: clampNumber(roi.width, 20, 100),
    height: clampNumber(roi.height, 20, 100),
  };

  if (next.left + next.width > 100) {
    if (changedKey === "left") {
      next.left = Math.max(0, 100 - next.width);
    } else {
      next.width = Math.max(20, 100 - next.left);
    }
  }
  if (next.top + next.height > 100) {
    if (changedKey === "top") {
      next.top = Math.max(0, 100 - next.height);
    } else {
      next.height = Math.max(20, 100 - next.top);
    }
  }

  return next;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
