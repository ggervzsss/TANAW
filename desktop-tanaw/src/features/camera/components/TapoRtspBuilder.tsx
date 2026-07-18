import { useEffect, useRef, useState } from "react";
import { RadioTower } from "lucide-react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { buildTapoRtspUrl, parseRtspConnection, TAPO_STREAM_OPTIONS, type TapoStreamId } from "../utils/rtsp";

type TapoRtspBuilderProps = {
  layout?: "responsive" | "stacked";
  streamUrl: string;
  onStreamUrlChange: (streamUrl: string) => void;
};

export function TapoRtspBuilder({ layout = "responsive", streamUrl, onStreamUrlChange }: TapoRtspBuilderProps) {
  const initialConnection = parseRtspConnection(streamUrl);
  const lastEmittedStreamUrl = useRef(streamUrl);
  const [host, setHost] = useState(initialConnection.host);
  const [streamId, setStreamId] = useState<TapoStreamId>(initialConnection.streamId);
  const gridClass = layout === "stacked" ? "grid gap-3" : "grid gap-3 md:grid-cols-[minmax(12rem,1fr)_190px]";

  useEffect(() => {
    if (streamUrl === lastEmittedStreamUrl.current) return;

    lastEmittedStreamUrl.current = streamUrl;
    if (!streamUrl.trim()) {
      setHost("");
      setStreamId("stream2");
      return;
    }

    const nextConnection = parseRtspConnection(streamUrl);
    if (nextConnection.host) {
      setHost(nextConnection.host);
      setStreamId(nextConnection.streamId);
    }
  }, [streamUrl]);

  const updateConnection = (nextHost: string, nextStreamId: TapoStreamId) => {
    setHost(nextHost);
    setStreamId(nextStreamId);
    const nextStreamUrl = buildTapoRtspUrl(nextHost, nextStreamId);
    lastEmittedStreamUrl.current = nextStreamUrl;
    onStreamUrlChange(nextStreamUrl);
  };

  return (
    <div className="rounded-sm border border-emerald-100 bg-emerald-50/70 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold tracking-wider text-[#065f46] uppercase">
        <RadioTower size={14} /> Tapo C310 RTSP
      </div>
      <div className={gridClass}>
        <div className="min-w-0">
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase">Camera IP / Host</label>
          <input
            type="text"
            value={host}
            onChange={(event) => updateConnection(event.target.value, streamId)}
            placeholder="192.168.1.9"
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
            className="w-full min-w-0 rounded-sm border border-emerald-200 bg-white px-2 py-2 font-mono text-[13px] text-gray-800 transition outline-none focus:border-[#065f46]"
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase">RTSP Stream</label>
          <SelectDropdown
            value={streamId}
            onChange={(nextStreamId) => updateConnection(host, nextStreamId as TapoStreamId)}
            options={TAPO_STREAM_OPTIONS.map((option) => [option.value, option.label] as const)}
            ariaLabel="RTSP stream"
            size="compact"
          />
        </div>
      </div>
    </div>
  );
}
