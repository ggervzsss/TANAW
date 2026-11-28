import { ArrowRight, CameraOff, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { LiveAlert } from "@/shared/types";
import { cn } from "@/shared/ui-kit";
import { alertKindLabel, alertMapPath, alertPlace, alertSince, alertTone } from "../model/liveAlerts";

const toneClass = {
  busy: { icon: "bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)", label: "text-(--tanaw-warning-text)" },
  camera: { icon: "bg-(--tanaw-danger-bg) text-(--tanaw-danger-text)", label: "text-(--tanaw-danger-text)" },
} as const;

/**
 * One row per live alert: its kind, the place and camera, since when, the plain sentence, IT's
 * details when the server sent them, and "Show on map".
 */
export function LiveAlertList({ alerts, dashboardPath, emptyText = "Nothing needs attention right now.", onNavigate }: { alerts: readonly LiveAlert[]; /** The page with the map, or null where there is no map. */ dashboardPath: string | null; emptyText?: string; onNavigate?: () => void }) {
  const { timeFormat } = useSystemDisplayPreferences();
  const now = new Date();
  if (alerts.length === 0) return <p className="py-4 text-sm text-(--tanaw-text-secondary)">{emptyText}</p>;
  return (
    <ul className="m-0 list-none divide-y divide-(--tanaw-border-soft) p-0" aria-label="Live alerts">
      {alerts.map((alert) => {
        const tone = alertTone(alert);
        const Icon = tone === "camera" ? CameraOff : TrendingUp;
        return (
          <li key={alert.id} data-alert-tone={tone} className="flex gap-3 py-3.5">
            <span aria-hidden="true" className={cn("mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full", toneClass[tone].icon)}>
              <Icon size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className={cn("text-[13px] font-semibold", toneClass[tone].label)}>{alertKindLabel(alert)}</span>
                <span className="text-[13px] text-(--tanaw-text-muted) tabular-nums">{alertSince(alert.startedAt, now, timeFormat)}</span>
              </p>
              <p className="mt-0.5 font-semibold wrap-break-word text-(--tanaw-text)">{alertPlace(alert)}</p>
              <p className="mt-1 text-sm leading-relaxed text-(--tanaw-text-secondary)">{alert.summary}</p>
              {alert.detail && <p className="mt-2 border-l-2 border-(--tanaw-border) py-0.5 pl-3 text-[13px] wrap-break-word text-(--tanaw-text-secondary)">{alert.detail}</p>}
              {dashboardPath && (
                <Link
                  to={alertMapPath(alert, dashboardPath)}
                  onClick={onNavigate}
                  className="group mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold max-md:min-h-11 text-(--tanaw-accent-ink) underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
                >
                  Show on map
                  <ArrowRight size={15} aria-hidden="true" className="transition-transform duration-200 ease-tanaw-out group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
