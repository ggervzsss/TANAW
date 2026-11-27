import { MAP_PIN_ICON_PATHS, MAP_PIN_STATES, mapPinColors, mapPinStateLabels } from "@/features/mapview/utils/mapStatusStyles";

/**
 * What each pin colour and icon means, in a row above the map so it never covers pins.
 * Colour is never the only signal: each state has an icon.
 */
export function MapLegend() {
  return (
    <ul aria-label="Map legend" className="m-0 mb-3 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-[13px] text-(--tanaw-text-secondary)">
      {MAP_PIN_STATES.map((state) => (
        <li key={state} className="inline-flex items-center gap-1.5" data-legend-state={state}>
          <span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded-full text-white" style={{ background: mapPinColors[state], opacity: state === "closed" ? 0.45 : 1 }}>
            <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d={MAP_PIN_ICON_PATHS[state]} />
            </svg>
          </span>
          {mapPinStateLabels[state]}
        </li>
      ))}
    </ul>
  );
}
