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
    <p className="camera-performance-status">
      <span>
        Performance: <span className="camera-performance-name">{name}</span>
        {analyticsFps ? ` (${analyticsFps.toFixed(1)} AI FPS)` : null}
      </span>
      <Link to={routePaths.enterpriseDeveloperSettings} className="camera-performance-change">
        Change
      </Link>
    </p>
  );
}
