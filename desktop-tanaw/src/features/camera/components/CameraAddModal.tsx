import { Check, RefreshCw, Shield, Video, X } from "lucide-react";
import type { FormEvent } from "react";
import { ModalPortal } from "../../../components/ModalPortal";
import { SelectDropdown } from "../../../components/SelectDropdown";
import type { CameraFormValues } from "../types/camera";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";
import { TapoRtspBuilder } from "./TapoRtspBuilder";

type CameraAddModalProps = {
  newCam: CameraFormValues;
  isValidating: boolean;
  errors: Partial<Record<keyof CameraFormValues, string>>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (values: CameraFormValues) => void;
};

export function CameraAddModal({ newCam, isValidating, errors, onClose, onSubmit, onChange }: CameraAddModalProps) {
  const streamPlaceholder = newCam.cameraType === "IP_WEBCAM" ? "http://192.168.1.25:8080/video" : "rtsp://192.168.1.9:554/stream2";
  const isRtspCamera = newCam.cameraType === "RTSP_CCTV" || newCam.cameraType === "ONVIF_CCTV";

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center bg-[#111827]/70 p-4 backdrop-blur-md" onPointerDown={onClose}>
        <div className="animate-in fade-in max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/80 bg-white shadow-2xl" onPointerDown={(event) => event.stopPropagation()}>
          <div className="h-1.5 rounded-t-2xl bg-linear-to-r from-[#065f46] via-emerald-500 to-[#45a549]" />
          <div className="max-h-[calc(92vh-0.375rem)] overflow-auto p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-[#111827]">
                <Video size={20} className="text-[#065f46]" /> Register Camera Node
              </h3>
              <button
                onClick={onClose}
                className="rounded-full border border-gray-200 bg-white p-2 text-gray-400 shadow-sm transition hover:bg-emerald-50 hover:text-[#065f46]"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Camera Name</label>
                  <input
                    required
                    type="text"
                    value={newCam.name}
                    onChange={(event) => onChange({ ...newCam, name: event.target.value })}
                    placeholder="e.g., Main Entrance Camera"
                    className={`w-full rounded-xl border p-3 text-sm transition outline-none focus:border-[#065f46] ${errors.name ? "border-tanaw-red" : "border-gray-300"}`}
                  />
                  {errors.name && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{errors.name}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Assigned Zone</label>
                  <input
                    required
                    type="text"
                    value={newCam.zone}
                    onChange={(event) => onChange({ ...newCam, zone: event.target.value })}
                    placeholder="e.g., Lobby"
                    className={`w-full rounded-xl border p-3 text-sm transition outline-none focus:border-[#065f46] ${errors.zone ? "border-tanaw-red" : "border-gray-300"}`}
                  />
                  {errors.zone && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{errors.zone}</p>}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Stream URL</label>
                  <input
                    required
                    type="text"
                    value={newCam.rtsp}
                    onChange={(event) => onChange({ ...newCam, rtsp: event.target.value })}
                    placeholder={streamPlaceholder}
                    className={`w-full rounded-xl border p-3 font-mono text-sm transition outline-none focus:border-[#065f46] ${errors.rtsp ? "border-tanaw-red" : "border-gray-300"}`}
                  />
                  {errors.rtsp && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{errors.rtsp}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Camera Type</label>
                  <SelectDropdown
                    value={newCam.cameraType}
                    onChange={(cameraType) => onChange({ ...newCam, cameraType: cameraType as CameraFormValues["cameraType"] })}
                    options={[
                      ["IP_WEBCAM", "IP Webcam"],
                      ["RTSP_CCTV", "RTSP CCTV"],
                      ["USB_WEBCAM", "USB Webcam"],
                      ["ONVIF_CCTV", "ONVIF CCTV"],
                    ]}
                    ariaLabel="Camera type"
                  />
                </div>
              </div>

              {isRtspCamera && <TapoRtspBuilder streamUrl={newCam.rtsp} onStreamUrlChange={(rtsp) => onChange({ ...newCam, rtsp })} />}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Username</label>
                  <input
                    type="text"
                    value={newCam.username}
                    onChange={(event) => onChange({ ...newCam, username: event.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-gray-300 p-3 text-sm transition outline-none focus:border-[#065f46]"
                  />
                  {errors.username && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{errors.username}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase">Password</label>
                  <PasswordVisibilityInput value={newCam.password} onChange={(password) => onChange({ ...newCam, password })} placeholder="Optional" variant="modal" hasError={Boolean(errors.password)} />
                  {errors.password && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{errors.password}</p>}
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/80 p-3 text-xs text-emerald-800">
                <Shield size={16} className="mt-0.5 shrink-0" />
                <p>Credentials and video processing stay on this enterprise device. RTSP credentials are passed to the local ML service without embedding them in the visible stream URL.</p>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-[#111827] transition-colors hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isValidating}
                  className="flex items-center gap-2 rounded-xl bg-[#065f46] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:bg-gray-400"
                >
                  {isValidating ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Validating Stream...
                    </>
                  ) : (
                    <>
                      <Check size={16} /> Save Configuration
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
