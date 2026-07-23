import { RadioTower } from "lucide-react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { normalizeIpv4Input, TAPO_STREAM_OPTIONS, type TapoStreamId } from "../utils/rtsp";

type TapoRtspBuilderProps = {
  error?: string;
  host: string;
  layout?: "responsive" | "stacked";
  onHostChange: (host: string) => void;
  onStreamChange: (streamId: TapoStreamId) => void;
  showHeading?: boolean;
  streamId: TapoStreamId;
};

export function TapoRtspBuilder({ error, host, layout = "responsive", onHostChange, onStreamChange, showHeading = true, streamId }: TapoRtspBuilderProps) {
  const gridClass = layout === "stacked" ? "grid gap-3" : "grid gap-3 md:grid-cols-[minmax(12rem,1fr)_190px]";

  return (
    <div className={showHeading ? "rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-300/20 dark:bg-emerald-400/8" : "mt-3"}>
      {showHeading && (
        <div className="mb-3 flex items-center gap-2 text-xs font-bold tracking-wider text-[#065f46] uppercase dark:text-emerald-300">
          <RadioTower size={14} /> Camera Source Configuration
        </div>
      )}
      <div className={gridClass}>
        <div className="min-w-0">
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase dark:text-slate-300">Camera IP / Host</label>
          <input
            type="text"
            value={host}
            onChange={(event) => onHostChange(normalizeIpv4Input(event.target.value))}
            placeholder="192.168.1.9"
            autoComplete="off"
            inputMode="decimal"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            className={`w-full min-w-0 rounded-xl border bg-white px-3 py-2.5 font-mono text-[13px] text-gray-800 transition outline-none focus:border-[#065f46] dark:bg-[#0f172a] dark:text-white ${error ? "border-red-500" : "border-emerald-200 dark:border-slate-600"}`}
          />
          {error && <p className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-300">{error}</p>}
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase dark:text-slate-300">RTSP Stream</label>
          <SelectDropdown
            value={streamId}
            onChange={(nextStreamId) => onStreamChange(nextStreamId as TapoStreamId)}
            options={TAPO_STREAM_OPTIONS.map((option) => [option.value, option.label] as const)}
            ariaLabel="RTSP stream"
            size="compact"
          />
        </div>
      </div>
    </div>
  );
}
