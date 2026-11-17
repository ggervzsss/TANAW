import { Link } from "react-router-dom";
import { routePaths } from "../../../app/router/routePaths";
import { devicePerformanceLabel, useDevicePerformanceProfile } from "../model/device-performance";

/** This computer's performance profile, shown where its speed/accuracy trade-off is visible. */
export function PerformanceStatus({ effectiveProfile, analyticsFps }: { effectiveProfile: string | null; analyticsFps: number | null }) {
  const profile = useDevicePerformanceProfile();
  const running = devicePerformanceLabel(effectiveProfile);
  const chosen = devicePerformanceLabel(profile);
  const name = profile === "auto" ? (running ? `Auto, using ${running}` : "Auto") : chosen;
  return (
    <p className="flex shrink-0 items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
      <span>
        Performance: <span className="font-semibold text-gray-700 dark:text-slate-200">{name}</span>
        {analyticsFps ? ` (${analyticsFps.toFixed(1)} AI FPS)` : null}
      </span>
      <Link
        to={routePaths.enterpriseDeveloperSettings}
        className="rounded font-semibold text-[#065f46] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:outline-none dark:text-emerald-300"
      >
        Change
      </Link>
    </p>
  );
}
