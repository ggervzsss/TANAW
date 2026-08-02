import type { MouseEvent, PointerEvent } from "react";
import type { Camera, TripwirePoint } from "../../../types/enterprise";
import { clampPoint, createTripwireLine, normalizeTripwireLine, pointDistance } from "../utils/tripwire-path";

export function getPointerPercent(event: PointerEvent<SVGElement> | MouseEvent<SVGElement>) {
  const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
  const bounds = svg?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }

  return clampPoint({
    x: ((event.clientX - bounds.left) / bounds.width) * 100,
    y: ((event.clientY - bounds.top) / bounds.height) * 100,
  });
}

export function getDefaultTripwires(centerX: number) {
  return normalizeTripwires({
    entry: createTripwireLine([
      { x: Math.max(5, centerX - 8), y: 12 },
      { x: Math.max(5, centerX - 8), y: 88 },
    ]),
    exit: createTripwireLine([
      { x: Math.min(95, centerX + 8), y: 12 },
      { x: Math.min(95, centerX + 8), y: 88 },
    ]),
  });
}

export function isFullFrameRoi(roi: Camera["config"]["roi"]) {
  return roi.top === 0 && roi.left === 0 && roi.width === 100 && roi.height === 100;
}

export function normalizeTripwires(tripwires: Camera["config"]["tripwires"]) {
  return {
    entry: normalizeTripwireLine(tripwires.entry),
    exit: normalizeTripwireLine(tripwires.exit),
  };
}

export function insertPointAtNearestSegment(points: TripwirePoint[], point: TripwirePoint) {
  const segmentIndex = nearestSegmentIndex(points, point);
  return [...points.slice(0, segmentIndex + 1), point, ...points.slice(segmentIndex + 1)];
}

function nearestSegmentIndex(points: TripwirePoint[], point: TripwirePoint) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(point, points[index], points[index + 1]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

export function midpointOfLongestSegment(points: TripwirePoint[]) {
  let segmentIndex = 0;
  let segmentLength = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const length = pointDistance(points[index], points[index + 1]);
    if (length > segmentLength) {
      segmentLength = length;
      segmentIndex = index;
    }
  }

  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  return {
    point: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    segmentIndex,
  };
}

export function findNearestPointIndex(points: TripwirePoint[], point: TripwirePoint) {
  return points.reduce((closestIndex, currentPoint, currentIndex) => {
    return pointDistance(currentPoint, point) < pointDistance(points[closestIndex], point) ? currentIndex : closestIndex;
  }, 0);
}

function distanceToSegment(point: TripwirePoint, start: TripwirePoint, end: TripwirePoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared <= 1e-9) return pointDistance(point, start);

  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return pointDistance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY,
  });
}
