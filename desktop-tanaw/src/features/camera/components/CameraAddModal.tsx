import { Check, RefreshCw, Video, X } from "lucide-react";
import type { FormEvent } from "react";
import { ModalPortal } from "../../../components/ModalPortal";
import { SelectDropdown } from "../../../components/SelectDropdown";
import type { CameraFormValues } from "../types/camera";
import { buildTapoRtspUrl, isValidIpv4, type TapoStreamId } from "../utils/rtsp";
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
  const isRtspCamera = newCam.cameraType === "RTSP_CCTV" || newCam.cameraType === "ONVIF_CCTV";
  const hostError = errors.cameraHost ?? (newCam.cameraHost && !isValidIpv4(newCam.cameraHost) ? "Enter a valid IPv4 address, such as 192.168.1.9." : undefined);
  const updateRtspSource = (cameraHost: string, rtspStream: TapoStreamId) => {
    onChange({
      ...newCam,
      cameraHost,
      rtsp: buildTapoRtspUrl(cameraHost, rtspStream),
      rtspStream,
    });
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-1100 flex items-center justify-center bg-[#111827]/70 p-4 backdrop-blur-md" onPointerDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-camera-node-title"
          className="animate-in fade-in max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/80 bg-white shadow-2xl dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_28px_80px_rgba(0,0,0,0.58)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="h-1.5 rounded-t-2xl bg-linear-to-r from-[#065f46] via-emerald-500 to-[#45a549]" />
          <div className="max-h-[calc(92vh-0.375rem)] overflow-auto p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 id="register-camera-node-title" className="flex items-center gap-2 text-lg font-bold text-[#111827] dark:text-white">
                <Video size={20} className="text-[#065f46] dark:text-emerald-300" /> Add Camera
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-gray-200 bg-white p-2 text-gray-400 shadow-sm transition-colors hover:bg-emerald-50 hover:text-[#065f46] dark:border-slate-600 dark:bg-[#172033] dark:text-slate-300 dark:hover:bg-[#1d2940] dark:hover:text-emerald-200"
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <ModalField label="Camera Name" error={errors.name}>
                  <input required type="text" value={newCam.name} onChange={(event) => onChange({ ...newCam, name: event.target.value })} className={inputClass(Boolean(errors.name))} />
                </ModalField>
                <ModalField label="Assigned Zone" error={errors.zone}>
                  <input required type="text" value={newCam.zone} onChange={(event) => onChange({ ...newCam, zone: event.target.value })} className={inputClass(Boolean(errors.zone))} />
                </ModalField>
              </div>

              <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-300/20 dark:bg-emerald-400/8">
                <h4 className="mb-3 text-xs font-bold tracking-wider text-[#065f46] uppercase dark:text-emerald-300">Camera Source Configuration</h4>
                <ModalField label="Camera Type">
                  <SelectDropdown
                    value={newCam.cameraType}
                    onChange={(cameraType) => {
                      const nextCameraType = cameraType as CameraFormValues["cameraType"];
                      const nextRtsp = nextCameraType === "RTSP_CCTV" || nextCameraType === "ONVIF_CCTV" ? buildTapoRtspUrl(newCam.cameraHost, newCam.rtspStream) : "";
                      onChange({ ...newCam, cameraType: nextCameraType, rtsp: nextRtsp });
                    }}
                    options={[
                      ["RTSP_CCTV", "RTSP CCTV"],
                      ["ONVIF_CCTV", "ONVIF CCTV"],
                      ["IP_WEBCAM", "IP Webcam"],
                      ["USB_WEBCAM", "USB Webcam"],
                    ]}
                    ariaLabel="Camera type"
                  />
                </ModalField>

                {isRtspCamera ? (
                  <TapoRtspBuilder
                    host={newCam.cameraHost}
                    streamId={newCam.rtspStream}
                    error={hostError}
                    showHeading={false}
                    onHostChange={(cameraHost) => updateRtspSource(cameraHost, newCam.rtspStream)}
                    onStreamChange={(rtspStream) => updateRtspSource(newCam.cameraHost, rtspStream)}
                  />
                ) : (
                  <div className="mt-3">
                    <ModalField label={newCam.cameraType === "USB_WEBCAM" ? "Camera Device Index" : "Camera Stream Address"} error={errors.rtsp}>
                      <input required type="text" value={newCam.rtsp} onChange={(event) => onChange({ ...newCam, rtsp: event.target.value })} className={`${inputClass(Boolean(errors.rtsp))} font-mono`} />
                    </ModalField>
                  </div>
                )}
              </section>

              <div className="grid gap-4 md:grid-cols-2">
                <ModalField label="Username" error={errors.username}>
                  <input type="text" autoComplete="username" value={newCam.username} onChange={(event) => onChange({ ...newCam, username: event.target.value })} className={inputClass(Boolean(errors.username))} />
                </ModalField>
                <ModalField label="Password" error={errors.password}>
                  <PasswordVisibilityInput value={newCam.password} onChange={(password) => onChange({ ...newCam, password })} variant="modal" hasError={Boolean(errors.password)} />
                </ModalField>
              </div>

              <ModalField label="Stream URL" error={errors.rtsp}>
                <input readOnly aria-readonly="true" value={newCam.rtsp} className="w-full cursor-default rounded-xl border border-gray-200 bg-gray-100 p-3 font-mono text-sm text-gray-600 outline-none dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300" />
              </ModalField>

              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-slate-700">
                <button type="button" onClick={onClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-[#111827] transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-[#1d2940]">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isValidating || (isRtspCamera && !isValidIpv4(newCam.cameraHost))}
                  className="flex items-center gap-2 rounded-xl bg-[#065f46] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {isValidating ? <><RefreshCw size={16} className="animate-spin" /> Validating Stream...</> : <><Check size={16} /> Save Configuration</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function ModalField({ children, error, label }: { children: React.ReactNode; error?: string; label: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-300">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return `w-full rounded-xl border bg-white p-3 text-sm text-[#111827] transition-colors outline-none focus:border-[#065f46] dark:bg-[#0f172a] dark:text-white ${hasError ? "border-red-500" : "border-gray-300 dark:border-slate-600"}`;
}
