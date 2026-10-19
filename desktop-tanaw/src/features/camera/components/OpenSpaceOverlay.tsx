import { useState, type PointerEvent } from "react";
import type { OpenSpaceSettings } from "../../../types/enterprise";
import { validateOpenSpace } from "../utils/open-space";

export function OpenSpaceOverlay({ value, editable, onChange }: { value: OpenSpaceSettings | null | undefined; editable: boolean; onChange: (next: OpenSpaceSettings) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const points = value?.polygon ?? [];
  const update = (polygon: OpenSpaceSettings["polygon"]) => onChange({ zone_id: "main", zone_name: "Monitored area", ...value, polygon });
  const coordinate = (event: PointerEvent<SVGSVGElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) };
  };
  const error = value ? validateOpenSpace(value) : "Draw a zone with at least three points.";
  return (
    <div className="absolute inset-0">
      <svg
        role="img"
        aria-label="Monitored area polygon"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full ${editable ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
        onPointerDown={(event) => {
          if (editable && dragging === null && points.length < 12) update([...points, coordinate(event)]);
        }}
        onPointerMove={(event) => {
          if (editable && dragging !== null) update(points.map((p, i) => (i === dragging ? coordinate(event) : p)));
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <polygon points={points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(34,211,238,0.12)" stroke="#22d3ee" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {editable &&
          points.map((p, i) => (
            <circle
              key={i}
              cx={p.x * 100}
              cy={p.y * 100}
              r="1.2"
              fill={selected === i ? "#fbbf24" : "#fff"}
              stroke="#0891b2"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="button"
              aria-label={`Zone vertex ${i + 1}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                setSelected(i);
                setDragging(i);
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (!editable) return;
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  update(points.filter((_, j) => i !== j));
                  return;
                }
                const dx = event.key === "ArrowLeft" ? -0.005 : event.key === "ArrowRight" ? 0.005 : 0;
                const dy = event.key === "ArrowUp" ? -0.005 : event.key === "ArrowDown" ? 0.005 : 0;
                if (dx || dy) {
                  event.preventDefault();
                  update(points.map((q, j) => (j === i ? { x: Math.max(0, Math.min(1, q.x + dx)), y: Math.max(0, Math.min(1, q.y + dy)) } : q)));
                }
              }}
            />
          ))}
      </svg>
      {editable && (
        <div className="absolute inset-x-3 bottom-3 rounded-lg bg-slate-950/90 p-2 text-xs text-white">
          <p>Click to add points. Drag or use arrow keys to move a vertex; Delete removes it. Leave visible space outside the zone.</p>
          <p role={error ? "alert" : undefined} className="mt-1">
            {error ?? "Zone ready. Save Config to apply. Active observations will end as incomplete."}
          </p>
          <button type="button" className="mt-1 mr-3 underline" onClick={() => update(points.slice(0, -1))}>
            Undo point
          </button>
          <button type="button" className="underline" onClick={() => update([])}>
            Clear zone
          </button>
        </div>
      )}
    </div>
  );
}
