import type { LiveAlert } from "@/shared/types";
import { alertKindLabel, alertPlace } from "../model/liveAlerts";

/** A camera pop-up's message: "Camera not counting: Sampaguita Gardens · Gate A", since when, and "View on map". */
export function CameraAlertToastMessage({ alert, since, onViewOnMap }: { alert: LiveAlert; since: string; onViewOnMap: () => void }) {
  return (
    <>
      <span className="block font-semibold">
        {alertKindLabel(alert)}: {alertPlace(alert)}
      </span>
      {since && <span className="mt-0.5 block text-[0.8125rem] font-normal tabular-nums">{since}</span>}
      <button
        type="button"
        onClick={onViewOnMap}
        className="mt-1 inline-flex min-h-7 items-center rounded-sm text-[0.8125rem] font-semibold text-(--tanaw-accent-ink) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
      >
        View on map
      </button>
    </>
  );
}
