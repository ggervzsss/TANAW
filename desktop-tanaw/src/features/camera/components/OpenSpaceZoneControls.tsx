import { MAX_ZONE_POINTS } from "../utils/open-space-editor";

type Props = {
  pointCount: number;
  previewReady: boolean;
  selectedPoint: number | null;
  canDelete: boolean;
  error: string | null;
  onDelete: () => void;
  onClear: () => void;
  onReset: () => void;
};

export function OpenSpaceZoneControls({ pointCount, previewReady, selectedPoint, canDelete, error, onDelete, onClear, onReset }: Props) {
  const buttonClass =
    "rounded-lg border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) px-3 py-1.5 font-semibold text-(--tanaw-text) hover:bg-(--tanaw-control-hover) disabled:cursor-not-allowed disabled:opacity-40";
  const status = !previewReady
    ? "Waiting for a live preview to place points."
    : pointCount === 0
      ? "Click the video to place three points, or reset to a centered box."
      : (error ?? "Use this Area, then Save Changes to apply.");

  return (
    <section aria-label="Monitored area editing tools" className="grid gap-2 rounded-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-3 text-xs text-(--tanaw-text-secondary)">
      <p className="leading-relaxed">Drag inside to move the area. Drag a corner or edge to resize it. Click an edge to add a point. Select a point and press Delete or Backspace to remove it.</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="font-semibold">
          {selectedPoint === null ? status : canDelete ? `Point ${selectedPoint + 1} selected.` : "Deleting this point would leave an invalid area."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">
            {pointCount} / {MAX_ZONE_POINTS} points
          </span>
          <button type="button" className={buttonClass} disabled={!canDelete} onClick={onDelete}>
            Delete Point
          </button>
          <button type="button" className={buttonClass} disabled={pointCount === 0} onClick={onClear}>
            Clear zone
          </button>
          <button type="button" className={buttonClass} onClick={onReset}>
            Reset box
          </button>
        </div>
      </div>
    </section>
  );
}
