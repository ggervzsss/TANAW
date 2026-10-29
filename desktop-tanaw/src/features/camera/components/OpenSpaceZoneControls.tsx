import type { OpenSpaceSettings } from "../../../types/enterprise";
import { validateOpenSpace } from "../utils/open-space";

export function OpenSpaceZoneControls({ value, previewReady, onChange }: { value: OpenSpaceSettings | null | undefined; previewReady: boolean; onChange: (next: OpenSpaceSettings) => void }) {
  const points = value?.polygon ?? [];
  const error = value ? validateOpenSpace(value) : "Draw a zone with at least three points.";
  const update = (polygon: OpenSpaceSettings["polygon"]) => onChange({ zone_id: "main", zone_name: "Monitored area", ...value, polygon });
  const buttonClass =
    "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/4 dark:text-slate-200 dark:hover:bg-white/8";

  return (
    <section
      aria-label="Monitored area editing tools"
      className="shrink-0 space-y-2 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600 dark:border-white/8 dark:bg-[#142130] dark:text-slate-300"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role={previewReady && error ? "alert" : "status"} className={previewReady && error ? "text-amber-700 dark:text-amber-200" : "font-semibold"}>
          {previewReady ? (error ?? "Zone ready. Save Config to apply.") : "Waiting for a live preview to place points."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] tabular-nums">{points.length} / 12 points</span>
          <button type="button" className={buttonClass} disabled={points.length === 0} onClick={() => update(points.slice(0, -1))}>
            Undo point
          </button>
          <button type="button" className={buttonClass} disabled={points.length === 0} onClick={() => update([])}>
            Clear zone
          </button>
        </div>
      </div>
      <details>
        <summary className="w-fit cursor-pointer text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Drawing help</summary>
        <p className="mt-2 leading-relaxed">
          Click the image to add points. Drag a point or focus it and use the arrow keys to move it; Delete removes it. Leave visible space outside the zone. Saving zone changes ends active
          observations as incomplete.
        </p>
      </details>
    </section>
  );
}
