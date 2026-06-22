import { useEffect, useState } from "react";
import { RadioTower } from "lucide-react";
import { buildTapoRtspUrl, parseRtspConnection, TAPO_STREAM_OPTIONS, type TapoStreamId } from "../utils/rtsp";

type TapoRtspBuilderProps = {
  streamUrl: string;
  onStreamUrlChange: (streamUrl: string) => void;
};

export function TapoRtspBuilder({ streamUrl, onStreamUrlChange }: TapoRtspBuilderProps) {
  const initialConnection = parseRtspConnection(streamUrl);
  const [host, setHost] = useState(initialConnection.host);
  const [streamId, setStreamId] = useState<TapoStreamId>(initialConnection.streamId);

  useEffect(() => {
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
    onStreamUrlChange(buildTapoRtspUrl(nextHost, nextStreamId));
  };

  return (
    <div className="rounded-sm border border-emerald-100 bg-emerald-50/70 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold tracking-wider text-[#065f46] uppercase">
        <RadioTower size={14} /> Tapo C310 RTSP
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_190px]">
        <div>
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase">Camera IP / Host</label>
          <input
            type="text"
            value={host}
            onChange={(event) => updateConnection(event.target.value, streamId)}
            placeholder="192.168.1.9"
            className="w-full rounded-sm border border-emerald-200 bg-white p-2 font-mono text-sm text-gray-800 transition outline-none focus:border-[#065f46]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold text-gray-500 uppercase">RTSP Stream</label>
          <select
            value={streamId}
            onChange={(event) => updateConnection(host, event.target.value as TapoStreamId)}
            className="w-full rounded-sm border border-emerald-200 bg-white p-2 text-sm font-semibold text-gray-800 transition outline-none focus:border-[#065f46]"
          >
            {TAPO_STREAM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
