import React from "react";
import { Maximize, Video } from "lucide-react";
import type { Camera } from "../../../types/enterprise";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { TapoRtspBuilder } from "./TapoRtspBuilder";

type CameraEditControlsProps = {
  editForm: Camera;
  onEditFormChange: React.Dispatch<React.SetStateAction<Camera | null>>;
};

const roiFields = [
  { label: "Top", key: "top", min: 0, max: 50 },
  { label: "Left", key: "left", min: 0, max: 50 },
  { label: "Width", key: "width", min: 20, max: 100 },
  { label: "Height", key: "height", min: 20, max: 100 },
] as const;

export function CameraEditControls({ editForm, onEditFormChange }: CameraEditControlsProps) {
  const isRtspCamera = editForm.cameraType === "RTSP_CCTV" || editForm.cameraType === "ONVIF_CCTV";
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
          <CompactField label="Node Name">
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
          <CompactField label="Stream URL">
            <input
              type="text"
              value={editForm.rtsp}
              onChange={(event) => onEditFormChange({ ...editForm, rtsp: event.target.value })}
              className="w-full rounded-sm border border-gray-300 px-2 py-1.5 font-mono text-xs text-gray-800 transition outline-none focus:border-[#065f46]"
            />
          </CompactField>
          <CompactField label="Camera Type">
            <select
              value={editForm.cameraType}
              onChange={(event) => onEditFormChange({ ...editForm, cameraType: event.target.value as Camera["cameraType"] })}
              className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
            >
              <option value="IP_WEBCAM">IP Webcam</option>
              <option value="RTSP_CCTV">RTSP CCTV</option>
              <option value="USB_WEBCAM">USB Webcam</option>
              <option value="ONVIF_CCTV">ONVIF CCTV</option>
            </select>
          </CompactField>
          <details className="rounded-sm border border-gray-200 bg-gray-50 p-2">
            <summary className="cursor-pointer text-[9px] font-bold tracking-wider text-gray-500 uppercase">Advanced Settings</summary>
            <div className="mt-2 space-y-2">
              <CompactField label="Processing Profile">
                <select
                  value={editForm.processingProfile}
                  onChange={(event) => onEditFormChange({ ...editForm, processingProfile: event.target.value as Camera["processingProfile"] })}
                  className="w-full rounded-sm border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
                >
                  <option value="auto">Auto Recommended</option>
                  <option value="compatibility">Compatibility</option>
                  <option value="balanced">Balanced</option>
                  <option value="high_accuracy">High Accuracy</option>
                  <option value="emergency">Emergency / Low Power</option>
                </select>
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
                  <select
                    value={editForm.reidMode ?? "auto"}
                    onChange={(event) => onEditFormChange({ ...editForm, reidMode: event.target.value as Camera["reidMode"] })}
                    className="w-full rounded-sm border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
                  >
                    <option value="auto">Auto</option>
                    <option value="off">Off</option>
                    <option value="fast">Fast</option>
                    <option value="quality">Quality</option>
                  </select>
                </CompactField>
                <CompactField label="Unique Mode">
                  <select
                    value={editForm.uniqueCountingMode ?? "estimated_reid"}
                    onChange={(event) => onEditFormChange({ ...editForm, uniqueCountingMode: event.target.value as Camera["uniqueCountingMode"] })}
                    className="w-full rounded-sm border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
                  >
                    <option value="estimated_reid">Estimated ReID</option>
                    <option value="entry_only">Entry Only</option>
                  </select>
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
            <CompactField label="Username">
              <input
                type="text"
                value={editForm.username ?? ""}
                onChange={(event) => onEditFormChange({ ...editForm, username: event.target.value })}
                className="w-full rounded-sm border border-gray-300 px-2 py-1.5 text-xs text-gray-800 transition outline-none focus:border-[#065f46]"
              />
            </CompactField>
            <CompactField label="Password">
              <PasswordVisibilityInput value={editForm.password ?? ""} onChange={(password) => onEditFormChange({ ...editForm, password })} />
            </CompactField>
          </div>
        </div>
        {isRtspCamera && (
          <div className="mt-2">
            <TapoRtspBuilder streamUrl={editForm.rtsp} onStreamUrlChange={(rtsp) => onEditFormChange({ ...editForm, rtsp })} layout="stacked" />
          </div>
        )}
      </section>

    </div>
  );
}

type CompactFieldProps = {
  children: React.ReactNode;
  label: string;
};

function CompactField({ children, label }: CompactFieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-bold tracking-wider text-gray-500 uppercase">{label}</span>
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
