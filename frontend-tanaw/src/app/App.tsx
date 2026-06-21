import { useEffect } from "react";
import { AppProviders } from "./providers/AppProviders";
import { AppRouter } from "./routers/AppRouter";
import { useReportStore } from "./store/reportStore";

function App() {
  const syncCurrentSubmissionPeriod = useReportStore((state) => state.syncCurrentSubmissionPeriod);

  useEffect(() => {
    syncCurrentSubmissionPeriod();
    const intervalId = window.setInterval(syncCurrentSubmissionPeriod, 60_000);

    return () => window.clearInterval(intervalId);
  }, [syncCurrentSubmissionPeriod]);

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export default App;
