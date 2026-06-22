import { Power, RefreshCw } from "lucide-react";
import { Card } from "../../../components/Card";

type BackgroundMonitoringPanelProps = {
  isElectron: boolean;
  isLoading: boolean;
  openAtLogin: boolean;
  onToggleStartup: (enabled: boolean) => void;
};

export function BackgroundMonitoringPanel({ isElectron, isLoading, openAtLogin, onToggleStartup }: BackgroundMonitoringPanelProps) {
  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <h3 className="mb-4 flex items-center gap-2 border-b border-emerald-100 pb-3 text-sm font-bold tracking-wider text-[#111827] uppercase">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
          <Power size={16} />
        </span>
        Background Monitoring
      </h3>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-gray-50/80 p-4">
        <div>
          <p className="text-sm font-bold text-[#111827]">Start at sign-in</p>
          <p className="mt-1 text-xs font-medium text-gray-500">Launch TANAW in the tray and resume active monitoring sessions.</p>
        </div>
        <button
          type="button"
          disabled={!isElectron || isLoading}
          onClick={() => onToggleStartup(!openAtLogin)}
          className={`relative h-7 w-12 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${openAtLogin ? "bg-[#065f46]" : "bg-gray-300"}`}
          aria-pressed={openAtLogin}
          aria-label="Toggle start at sign-in"
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${openAtLogin ? "translate-x-5" : "translate-x-1"}`} />
        </button>
      </div>
      {!isElectron && <p className="mt-3 text-xs font-semibold text-gray-500">This setting is available in the desktop app.</p>}
      {isLoading && (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-500">
          <RefreshCw size={13} className="animate-spin" /> Updating background settings...
        </p>
      )}
    </Card>
  );
}
