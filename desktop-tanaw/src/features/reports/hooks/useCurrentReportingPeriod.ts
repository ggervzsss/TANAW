import { useEffect, useState } from "react";
import { getCurrentReportingPeriod } from "../model/reporting-calendar";

const REPORTING_PERIOD_REFRESH_INTERVAL_MS = 60_000;

export function useCurrentReportingPeriod() {
  const [period, setPeriod] = useState(getCurrentReportingPeriod);

  useEffect(() => {
    const refresh = () => {
      const current = getCurrentReportingPeriod();
      setPeriod((previous) => (previous === current ? previous : current));
    };
    const intervalId = window.setInterval(refresh, REPORTING_PERIOD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return period;
}
