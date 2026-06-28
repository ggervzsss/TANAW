import { AlertTriangle, CheckCircle, Power, RefreshCw } from "lucide-react";
import { Card } from "../../../components/Card";

export type StartupFeedback = {
  message: string;
  tone: "success" | "warning" | "error";
};

type BackgroundMonitoringPanelProps = {
  feedback: StartupFeedback | null;
  isAvailable: boolean;
  isLoading: boolean;
  openAtLogin: boolean;
  onToggleStartup: (enabled: boolean) => void;
};

export function BackgroundMonitoringPanel({ feedback, isAvailable, isLoading, openAtLogin, onToggleStartup }: BackgroundMonitoringPanelProps) {
  const FeedbackIcon = feedback?.tone === "success" ? CheckCircle : AlertTriangle;
  const feedbackClassName = {
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-950/35 dark:text-red-200",
    success: "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-400/30 dark:bg-emerald-500/12 dark:text-emerald-200",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/12 dark:text-amber-200",
  }[feedback?.tone ?? "success"];

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
          disabled={!isAvailable || isLoading}
          onClick={() => onToggleStartup(!openAtLogin)}
          className={`tanaw-switch relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-55 ${openAtLogin ? "tanaw-switch--on" : "tanaw-switch--off"}`}
          aria-pressed={openAtLogin}
          aria-label="Toggle start at sign-in"
        >
          <span className={`tanaw-switch-thumb absolute top-1 left-1 h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${openAtLogin ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>
      {isLoading && (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-500">
          <RefreshCw size={13} className="animate-spin" /> Updating background settings...
        </p>
      )}
      {feedback && !isLoading && (
        <p role="status" className={`mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold ${feedbackClassName}`}>
          <FeedbackIcon size={14} className="shrink-0" />
          {feedback.message}
        </p>
      )}
    </Card>
  );
}
