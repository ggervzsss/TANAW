import type { OpenSpaceSettings } from "../../../types/enterprise";

export function validateOpenSpace(value: OpenSpaceSettings): string | null {
  if (!value.zone_name.trim()) return "Name the monitored area.";
  const points = value.polygon;
  if (points.length < 3 || points.length > 12) return "Draw a zone with 3 to 12 vertices on the live preview.";
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return "Zone points must be inside the video.";
  const cross = (a: (typeof points)[number], b: (typeof points)[number], c: (typeof points)[number]) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.005) return "Keep zone vertices distinct.";
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      )
        return "Zone edges must not cross.";
    }
  }
  return Math.abs(area) < 0.005 ? "Draw a larger monitored area." : null;
}

export function formatDwell(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
