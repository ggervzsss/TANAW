import { useId } from "react";
import { isValidIpv4 } from "../utils/rtsp";
import { updateCameraConnection, validateCameraConnection, type CameraConnection } from "../utils/camera-connection";
import { CameraIpAddressField } from "./CameraIpAddressField";

type Props = {
  value: CameraConnection;
  onChange: (value: CameraConnection) => void;
  hostError?: string;
  streamError?: string;
};

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#065f46] focus:ring-2 focus:ring-emerald-600/20 dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-100";

/**
 * The camera's address. Supported brands need only the IP address; TANAW finds a working
 * stream when the connection is tested. Custom RTSP is the one case where an address is typed.
 */
export function CameraConnectionFields({ value, onChange, hostError, streamError }: Props) {
  const id = useId();
  const brand = value.cameraBrand ?? "tapo";
  const host = value.cameraHost ?? "";
  const update = (change: Partial<CameraConnection>) => onChange(updateCameraConnection(value, change));

  if (brand !== "custom") {
    return (
      <div className="space-y-1">
        <CameraIpAddressField
          host={host}
          error={hostError ?? (host && !isValidIpv4(host) ? "Enter a valid IPv4 address, such as 192.168.1.9." : undefined)}
          onHostChange={(cameraHost) => update({ cameraHost })}
        />
        {brand === "dahua" ? <p className="text-xs text-gray-500 dark:text-slate-400">Use the camera's own username and password, not your DMSS app login.</p> : null}
        {streamError ? (
          <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-300">
            {streamError}
          </p>
        ) : null}
      </div>
    );
  }

  const error = streamError ?? hostError ?? (value.rtsp ? validateCameraConnection(value) : undefined);
  return (
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
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help ${id}-error`}
        onChange={(event) => update({ rtsp: event.target.value })}
        className={inputClass}
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        For cameras without a listed brand. Enter the username and password separately below.
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-semibold text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
