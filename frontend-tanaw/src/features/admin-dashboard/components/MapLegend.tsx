import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { MAP_PIN_ICON_PATHS, MAP_PIN_STATES, mapPinColors, mapPinStateLabels } from "@/features/mapview/utils/mapStatusStyles";

/**
 * What each pin colour and icon means, in a row above the map so it never covers pins.
 * Colour is never the only signal: each state has an icon. On phones the key folds behind a
 * "Map key" button (dashboard.css), so the map comes up sooner; from 48rem up it is always shown.
 */
export function MapLegend() {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="tanaw-map-legend" data-open={open || undefined}>
      <button type="button" className="tanaw-map-legend__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true" className="tanaw-map-legend__swatches">
          {MAP_PIN_STATES.slice(0, 4).map((state) => (
            <span key={state} style={{ background: mapPinColors[state] }} />
          ))}
        </span>
        Map key
        <ChevronDown size={16} aria-hidden="true" className="tanaw-map-legend__chevron" />
      </button>
      <ul id={listId} aria-label="Map legend" className="tanaw-map-legend__list m-0 mb-3 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-[13px] text-(--tanaw-text-secondary)">
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
    </div>
  );
}
