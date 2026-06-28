import type { TripwireCurveMode, TripwireLine, TripwirePoint } from "../../../types/enterprise";

const DEFAULT_CURVE: TripwireCurveMode = "smooth";
const DEFAULT_SAMPLES_PER_SEGMENT = 12;

export function createTripwireLine(points: TripwirePoint[], curve: TripwireCurveMode = DEFAULT_CURVE): TripwireLine {
  const anchors = normalizeAnchors(points);
  const sampledPoints = sampleTripwirePoints(anchors, curve);

  return {
    start: anchors[0],
    end: anchors[anchors.length - 1],
    points: anchors,
    curve,
    sampledPoints,
  };
}

export function normalizeTripwireLine(line: TripwireLine): TripwireLine {
  const points = line.points && line.points.length >= 2 ? line.points : [line.start, line.end];
  return createTripwireLine(points, line.curve ?? DEFAULT_CURVE);
}

export function getTripwireAnchors(line: TripwireLine): TripwirePoint[] {
  return normalizeTripwireLine(line).points ?? [line.start, line.end];
}

export function getTripwireSampledPoints(line: TripwireLine): TripwirePoint[] {
  const normalized = normalizeTripwireLine(line);
  return normalized.sampledPoints ?? normalized.points ?? [normalized.start, normalized.end];
}

export function buildTripwireSvgPath(line: TripwireLine): string {
  const normalized = normalizeTripwireLine(line);
  const anchors = normalized.points ?? [normalized.start, normalized.end];

  if (anchors.length === 0) return "";
  if ((normalized.curve ?? DEFAULT_CURVE) !== "smooth" || anchors.length < 3) {
    return anchors.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }

  const commands = [`M ${anchors[0].x} ${anchors[0].y}`];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const previous = anchors[index - 1] ?? anchors[index];
    const current = anchors[index];
    const next = anchors[index + 1];
    const afterNext = anchors[index + 2] ?? next;
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    };
    commands.push(`C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${next.x} ${next.y}`);
  }

  return commands.join(" ");
}

export function tripwirePathLength(line: TripwireLine): number {
  const points = getTripwireSampledPoints(line);
  return points.reduce((total, point, index) => {
    const previous = points[index - 1];
    return previous ? total + pointDistance(previous, point) : total;
  }, 0);
}

export function tripwirePathsOverlap(first: TripwireLine, second: TripwireLine, tolerance: number): boolean {
  const firstPoints = getTripwireSampledPoints(first);
  const secondPoints = getTripwireSampledPoints(second);
  if (firstPoints.length < 2 || secondPoints.length < 2) return false;

  const comparablePoints = Math.min(firstPoints.length, secondPoints.length);
  let totalDistance = 0;

  for (let index = 0; index < comparablePoints; index += 1) {
    const firstIndex = Math.round((index / Math.max(1, comparablePoints - 1)) * (firstPoints.length - 1));
    const secondIndex = Math.round((index / Math.max(1, comparablePoints - 1)) * (secondPoints.length - 1));
    totalDistance += pointDistance(firstPoints[firstIndex], secondPoints[secondIndex]);
  }

  return totalDistance / comparablePoints < tolerance;
}

export function sampleTripwirePoints(points: TripwirePoint[], curve: TripwireCurveMode = DEFAULT_CURVE, samplesPerSegment = DEFAULT_SAMPLES_PER_SEGMENT): TripwirePoint[] {
  const anchors = normalizeAnchors(points);
  if (curve !== "smooth" || anchors.length < 3) return anchors;

  const sampled: TripwirePoint[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const previous = anchors[index - 1] ?? anchors[index];
    const current = anchors[index];
    const next = anchors[index + 1];
    const afterNext = anchors[index + 2] ?? next;

    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      sampled.push(clampPoint(catmullRomPoint(previous, current, next, afterNext, t)));
    }
  }

  sampled.push(anchors[anchors.length - 1]);
  return sampled;
}

export function clampPoint(point: TripwirePoint): TripwirePoint {
  return {
    x: clampPercent(point.x),
    y: clampPercent(point.y),
  };
}

export function pointDistance(first: TripwirePoint, second: TripwirePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeAnchors(points: TripwirePoint[]): TripwirePoint[] {
  const anchors = points.map(clampPoint);
  if (anchors.length >= 2) return anchors;

  const fallback = anchors[0] ?? { x: 50, y: 50 };
  return [fallback, { x: clampPercent(fallback.x + 1), y: clampPercent(fallback.y + 1) }];
}

function catmullRomPoint(p0: TripwirePoint, p1: TripwirePoint, p2: TripwirePoint, p3: TripwirePoint, t: number): TripwirePoint {
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
