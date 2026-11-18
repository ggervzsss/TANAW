import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { OpenSpaceSettings } from "../../../types/enterprise";
import { validateOpenSpace } from "../utils/open-space";
import { clamp, insertZonePoint, MAX_ZONE_POINTS, moveZone, withZonePolygon, type ZonePoint, type ZoneTarget } from "../utils/open-space-editor";

type Polygon = OpenSpaceSettings["polygon"];
type Gesture = {
  pointerId: number;
  start: ZonePoint;
  original: Polygon;
  latest: Polygon;
  target: ZoneTarget;
  moved: boolean;
};

type Props = {
  value: OpenSpaceSettings | null | undefined;
  editable: boolean;
  onChange: (next: OpenSpaceSettings) => void;
  onEditCheckpoint?: () => void;
  selectedPoint?: number | null;
  onSelectPoint?: (index: number | null) => void;
};

export function OpenSpaceOverlay({ value, editable, onChange, onEditCheckpoint, selectedPoint, onSelectPoint }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Polygon | null>(null);
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const points = draft ?? value?.polygon ?? [];

  useEffect(() => {
    const element = svg.current;
    if (!element || !editable) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [editable]);

  const valid = (next: Polygon) => {
    if (next.length === 2) return Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y) >= 0.005;
    return next.length < 2 || !validateOpenSpace(withZonePolygon(value, next));
  };
  const commit = (next: Polygon, original: Polygon) => {
    if (next.length === original.length && next.every((p, i) => p.x === original[i].x && p.y === original[i].y)) return;
    onEditCheckpoint?.();
    onChange(withZonePolygon(value, next));
  };

  const begin = (event: PointerEvent<SVGElement>, target: ZoneTarget) => {
    if (!editable || event.button !== 0 || gesture.current || !svg.current) return;
    event.preventDefault();
    if (target.type === "point") {
      // Expanded hit targets can overlap. Select the visible handle closest to the pointer.
      const rect = svg.current.getBoundingClientRect();
      const distance = (p: ZonePoint) => Math.hypot(rect.left + p.x * rect.width - event.clientX, rect.top + p.y * rect.height - event.clientY);
      const index = points.reduce((closest, p, i) => (distance(p) < distance(points[closest]) ? i : closest), target.index);
      target = { type: "point", index };
      svg.current.querySelector<SVGElement>(`[data-zone-point="${index}"]`)?.focus({ preventScroll: true });
      onSelectPoint?.(index);
    } else {
      svg.current.focus({ preventScroll: true });
      onSelectPoint?.(null);
    }
    setActiveEdge(target.type === "edge" ? target.index : null);
    gesture.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      original: points,
      latest: points,
      target,
      moved: false,
    };
    svg.current.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: PointerEvent<SVGSVGElement>, current: Gesture) => {
    const { width, height } = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (Math.hypot(dx, dy) >= 4) current.moved = true;
    if (!editable || !current.moved || current.target.type === "background" || width === 0 || height === 0) return;
    const next = moveZone(current.original, current.target, { x: dx / width, y: dy / height });
    if (valid(next)) current.latest = next;
    setDraft(current.latest);
  };

  const finish = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (editable && !cancelled) {
      updateDrag(event, current);
      if (current.moved) {
        commit(current.latest, current.original);
      } else if (current.original.length < MAX_ZONE_POINTS) {
        const rect = event.currentTarget.getBoundingClientRect();
        const at = { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
        if (current.target.type === "edge") {
          const next = insertZonePoint(current.original, current.target.index, at, rect.width, rect.height);
          if (next !== current.original && valid(next)) {
            commit(next, current.original);
            onSelectPoint?.(current.target.index + 1);
          }
        } else if (current.target.type === "background" && current.original.length < 3) {
          const next = [...current.original, at];
          if (valid(next)) {
            commit(next, current.original);
            onSelectPoint?.(next.length - 1);
          }
        }
      }
    }
    gesture.current = null;
    setDraft(null);
    setActiveEdge(null);
  };

  const pointsAttribute = points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
  const edges = points.slice(0, points.length === 2 ? 1 : points.length < 2 ? 0 : points.length);

  return (
    <svg
      ref={svg}
      role={editable ? "group" : "img"}
      aria-label="Monitored area polygon"
      tabIndex={editable ? -1 : undefined}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={`absolute inset-0 h-full w-full ${editable ? "touch-none overflow-visible outline-none" : "pointer-events-none"}`}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (current?.pointerId === event.pointerId) updateDrag(event, current);
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
    >
      {editable && <rect width="100" height="100" fill="transparent" className={points.length < 3 ? "cursor-crosshair" : ""} onPointerDown={(event) => begin(event, { type: "background" })} />}
      {points.length >= 3 ? (
        <polygon
          points={pointsAttribute}
          fill="rgba(34,211,238,0.13)"
          stroke="#22d3ee"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className={editable ? "cursor-move hover:fill-cyan-400/20 active:cursor-grabbing" : undefined}
          onPointerDown={(event) => begin(event, { type: "area" })}
        />
      ) : (
        <polyline points={pointsAttribute} fill="none" stroke="#22d3ee" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      )}
      {editable &&
        edges.map((start, i) => {
          const end = points[(i + 1) % points.length];
          const coordinates = { x1: start.x * 100, y1: start.y * 100, x2: end.x * 100, y2: end.y * 100 };
          return (
            <g key={i} className="open-space-edge" data-active={activeEdge === i}>
              <line {...coordinates} stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" onPointerDown={(event) => begin(event, { type: "edge", index: i })} />
              <line {...coordinates} className="open-space-edge-mark" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      {editable &&
        size &&
        points.map((p, i) => (
          <g key={i} className="open-space-point" data-selected={selectedPoint === i}>
            <ellipse
              cx={p.x * 100}
              cy={p.y * 100}
              rx={(12 / size.width) * 100}
              ry={(12 / size.height) * 100}
              fill="transparent"
              data-zone-point={i}
              role="button"
              aria-label={`Zone vertex ${i + 1}`}
              aria-pressed={selectedPoint === i}
              tabIndex={0}
              onFocus={() => onSelectPoint?.(i)}
              onPointerDown={(event) => begin(event, { type: "point", index: i })}
              onKeyDown={(event) => {
                const dx = event.key === "ArrowLeft" ? -0.005 : event.key === "ArrowRight" ? 0.005 : 0;
                const dy = event.key === "ArrowUp" ? -0.005 : event.key === "ArrowDown" ? 0.005 : 0;
                if (!dx && !dy) return;
                event.preventDefault();
                const next = moveZone(points, { type: "point", index: i }, { x: dx, y: dy });
                if (valid(next)) commit(next, points);
              }}
            />
            <ellipse cx={p.x * 100} cy={p.y * 100} rx={(5 / size.width) * 100} ry={(5 / size.height) * 100} vectorEffect="non-scaling-stroke" className="open-space-point-mark" />
          </g>
        ))}
    </svg>
  );
}
