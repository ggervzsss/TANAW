import type { OpenSpaceSettings } from "../../../types/enterprise";
import { validateOpenSpace } from "./open-space";

type Polygon = OpenSpaceSettings["polygon"];
export type ZonePoint = Polygon[number];
export type ZoneTarget = { type: "point" | "edge"; index: number } | { type: "area" | "background" };

export const MAX_ZONE_POINTS = 12;
const MIN_BOX_SIDE = 0.06;

export function withZonePolygon(value: OpenSpaceSettings | null | undefined, polygon: Polygon): OpenSpaceSettings {
  return { zone_id: "main", zone_name: "Monitored area", ...value, polygon };
}

export function centeredZone(value?: OpenSpaceSettings | null): OpenSpaceSettings {
  return withZonePolygon(value, [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 },
  ]);
}

export function deleteZonePoint(value: OpenSpaceSettings, index: number): OpenSpaceSettings | null {
  if (!value.polygon[index]) return null;
  const next = withZonePolygon(
    value,
    value.polygon.filter((_, i) => i !== index),
  );
  return validateOpenSpace(next) ? null : next;
}

export function insertZonePoint(points: Polygon, index: number, at: ZonePoint, width: number, height: number): Polygon {
  const start = points[index];
  const end = points[(index + 1) % points.length];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx * width, dy * height);
  if (length <= 24) return points;
  // Project in screen space so the inserted point follows the visible edge in any aspect ratio.
  const fraction = ((at.x - start.x) * dx * width ** 2 + (at.y - start.y) * dy * height ** 2) / length ** 2;
  const margin = 12 / length;
  const t = clamp(fraction, margin, 1 - margin);
  return [...points.slice(0, index + 1), { x: start.x + dx * t, y: start.y + dy * t }, ...points.slice(index + 1)];
}

export function moveZone(points: Polygon, target: ZoneTarget, delta: ZonePoint): Polygon {
  if (target.type === "point") return movePoint(points, target.index, delta);
  if (target.type === "edge") {
    const end = (target.index + 1) % points.length;
    const startPoint = points[target.index];
    const endPoint = points[end];
    const opposite = points[(target.index + 2) % points.length];
    let movement = delta;
    if (isRectangle(points)) {
      movement = startPoint.y === endPoint.y ? { x: 0, y: resizeSide(startPoint.y, opposite.y, delta.y) - startPoint.y } : { x: resizeSide(startPoint.x, opposite.x, delta.x) - startPoint.x, y: 0 };
    }
    return translate(points, [target.index, end], movement);
  }
  return target.type === "area"
    ? translate(
        points,
        points.map((_, i) => i),
        delta,
      )
    : points;
}

function movePoint(points: Polygon, index: number, delta: ZonePoint): Polygon {
  const point = points[index];
  if (!isRectangle(points)) {
    const next = { x: clamp(point.x + delta.x), y: clamp(point.y + delta.y) };
    return points.map((p, i) => (i === index ? next : p));
  }

  const opposite = points[(index + 2) % 4];
  const corner = { x: resizeSide(point.x, opposite.x, delta.x), y: resizeSide(point.y, opposite.y, delta.y) };
  return points.map((p) => ({ x: p.x === point.x ? corner.x : p.x, y: p.y === point.y ? corner.y : p.y }));
}

function resizeSide(start: number, opposite: number, delta: number): number {
  const gap = Math.min(MIN_BOX_SIDE, Math.abs(start - opposite));
  return start < opposite ? clamp(start + delta, 0, opposite - gap) : clamp(start + delta, opposite + gap, 1);
}

function isRectangle(points: Polygon): boolean {
  return (
    points.length === 4 &&
    points.every((p, i) => {
      const next = points[(i + 1) % 4];
      const opposite = points[(i + 2) % 4];
      return (p.x === next.x || p.y === next.y) && p.x !== opposite.x && p.y !== opposite.y;
    })
  );
}

function translate(points: Polygon, indices: number[], delta: ZonePoint): Polygon {
  const active = indices.map((i) => points[i]);
  const dx = clamp(delta.x, -Math.min(...active.map((p) => p.x)), 1 - Math.max(...active.map((p) => p.x)));
  const dy = clamp(delta.y, -Math.min(...active.map((p) => p.y)), 1 - Math.max(...active.map((p) => p.y)));
  return points.map((p, i) => (indices.includes(i) ? { x: clamp(p.x + dx), y: clamp(p.y + dy) } : p));
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}
