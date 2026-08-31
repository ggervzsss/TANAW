import { normalizeIpv4Input } from "../utils/rtsp";

type CameraIpAddressFieldProps = {
  error?: string;
  host: string;
  onHostChange: (host: string) => void;
};

export function CameraIpAddressField({ error, host, onHostChange }: CameraIpAddressFieldProps) {
  return (
    <div className="min-w-0">
      <label htmlFor="camera-ip-host" className="mb-1 block text-[10px] font-bold text-gray-500 uppercase dark:text-slate-300">
        Camera IP Address
      </label>
      <input
        id="camera-ip-host"
        type="text"
        value={host}
        onChange={(event) => onHostChange(normalizeIpv4Input(event.target.value))}
        placeholder="192.168.1.9"
        autoComplete="off"
        inputMode="decimal"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "camera-ip-host-error" : undefined}
        className={`w-full min-w-0 rounded-xl border bg-white px-3 py-2.5 font-mono text-[13px] text-gray-800 transition outline-none focus:border-[#065f46] dark:bg-[#0f172a] dark:text-white ${error ? "border-red-500" : "border-emerald-200 dark:border-slate-600"}`}
      />
      {error ? (
        <p id="camera-ip-host-error" className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
