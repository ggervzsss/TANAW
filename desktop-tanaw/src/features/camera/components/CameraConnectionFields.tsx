import { useId, useState } from "react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { CAMERA_QUALITY_OPTIONS, isValidIpv4, type TapoStreamId } from "../utils/rtsp";
import { CAMERA_BRANDS, TENDA_PROFILES, getRtspEndpoint, getTendaProfile, updateCameraConnection, validateCameraConnection, type CameraConnection } from "../utils/camera-connection";
import { CameraIpAddressField } from "./CameraIpAddressField";

type Props = {
  value: CameraConnection;
  onChange: (value: CameraConnection) => void;
  hostError?: string;
  streamError?: string;
};

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#065f46] focus:ring-2 focus:ring-emerald-600/20 dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-100";

export function CameraConnectionFields({ value, onChange, hostError, streamError }: Props) {
  const id = useId();
  const brand = value.cameraBrand ?? "tapo";
  const profile = getTendaProfile(value);
  const host = value.cameraHost ?? "";
  const [endpointDraft, setEndpointDraft] = useState<{ source: string; port: string; path: string } | null>(null);
  const endpoint = endpointDraft?.source === value.rtsp ? endpointDraft : getRtspEndpoint(value.rtsp);
  const error = streamError ?? (value.rtsp ? validateCameraConnection(value) : undefined);
  const update: (change: Partial<CameraConnection>) => void = (change) => onChange(updateCameraConnection(value, change));
  const changeEndpoint = (port: string, path: string) => {
    const rtsp = `rtsp://${host}:${port}${path}`;
    setEndpointDraft({ source: rtsp, port, path });
    onChange({ ...value, connectionProfile: brand === "tenda" ? "manual" : undefined, rtsp });
  };

  return (
    <div className="space-y-3">
      <div>
        <p id={`${id}-brand`} className="mb-1 text-xs font-semibold text-gray-600 dark:text-slate-300">
          Camera brand / type
        </p>
        <SelectDropdown value={brand} options={CAMERA_BRANDS} ariaLabel="Camera brand / type" onChange={(cameraBrand) => update({ cameraBrand: cameraBrand as CameraConnection["cameraBrand"] })} />
      </div>
      {brand !== "custom" ? (
        <CameraIpAddressField
          host={host}
          error={hostError ?? (host && !isValidIpv4(host) ? "Enter a valid IPv4 address, such as 192.168.1.9." : undefined)}
          onHostChange={(cameraHost) => update({ cameraHost })}
        />
      ) : (
        <div>
          <label htmlFor={`${id}-url`} className="mb-1 block text-xs font-semibold text-gray-600 dark:text-slate-300">
            RTSP stream address
          </label>
          <input
            id={`${id}-url`}
            type="text"
            spellCheck={false}
            value={value.rtsp}
            placeholder="rtsp://192.168.1.20:554/live"
            aria-invalid={Boolean(error || hostError)}
            aria-describedby={`${id}-help ${id}-error`}
            onChange={(event) => update({ rtsp: event.target.value })}
            className={inputClass}
          />
          <p id={`${id}-help`} className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Paste the camera's local RTSP address. Enter its username and password separately below.
          </p>
          {hostError ? (
            <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">
              {hostError}
            </p>
          ) : null}
        </div>
      )}
      {brand === "dahua" ? (
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Use the camera's local IP address and device username and password, rather than your DMSS account login.
        </p>
      ) : null}
      {brand === "tenda" ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-slate-300">Tenda connection profile</p>
          <SelectDropdown
            value={profile}
            options={TENDA_PROFILES}
            ariaLabel="Tenda connection profile"
            onChange={(connectionProfile) => update({ connectionProfile: connectionProfile as CameraConnection["connectionProfile"] })}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">CH3 versions use different stream formats. Choose the profile verified for your camera.</p>
        </div>
      ) : null}
      {brand !== "custom" ? (
        <details open={brand === "tenda" && profile === "manual" ? true : undefined} className="rounded-xl border border-gray-200 p-3 dark:border-slate-600">
          <summary className="cursor-pointer text-xs font-semibold text-gray-600 dark:text-slate-300">Advanced connection settings</summary>
          <div className="mt-3 space-y-3">
            {brand !== "tenda" || profile !== "manual" ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-slate-300">Video Quality</p>
                <SelectDropdown
                  value={value.rtspStream ?? "stream2"}
                  options={CAMERA_QUALITY_OPTIONS.map((option) => [option.value, option.label] as const)}
                  ariaLabel="Video quality"
                  onChange={(rtspStream) => update({ rtspStream: rtspStream as TapoStreamId })}
                />
              </div>
            ) : null}
            {brand === "tenda" || brand === "dahua" ? (
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">
                RTSP port
                <input type="text" inputMode="numeric" value={endpoint.port} onChange={(event) => changeEndpoint(event.target.value, endpoint.path)} className={`${inputClass} mt-1`} />
              </label>
            ) : null}
            {brand === "tenda" ? (
              <>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">
                  Stream path and query
                  <input type="text" spellCheck={false} value={endpoint.path} onChange={(event) => changeEndpoint(endpoint.port, event.target.value)} className={`${inputClass} mt-1`} />
                </label>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Use the exact path from the camera or ONVIF client, including its leading slash. A custom path determines its own video quality.
                </p>
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
