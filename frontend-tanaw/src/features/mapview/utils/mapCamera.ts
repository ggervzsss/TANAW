import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point } from "leaflet";

const DIRECTORY_BREAKPOINT_PX = 820;
const PROJECTION_ZOOM = 18;

type LeafletFrameMap = LeafletMap & {
  _move(center: LatLngExpression, zoom: number, data?: { flyTo?: boolean }): LeafletMap;
  _moveEnd(zoomChanged?: boolean): LeafletMap;
  _moveStart(zoomChanged?: boolean, noMoveStart?: boolean): LeafletMap;
};

export type ResolvedMapCameraTarget = { type: "citywide"; bounds: LatLngBounds } | { type: "barangay"; bounds: LatLngBounds } | { type: "enterprise"; center: LatLngExpression; zoom: number };

export type MapCameraTransitionOptions = {
  directoryCollapsed: boolean;
  immediate?: boolean;
  reducedMotion?: boolean;
};

export type ResolvedMapCameraPosition = {
  center: LatLng;
  type: ResolvedMapCameraTarget["type"];
  zoom: number;
};

export function prefersReducedMapMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function calculateAdaptiveMapDuration(distancePx: number, zoomDelta: number, targetType: ResolvedMapCameraTarget["type"]) {
  const normalizedDistance = Math.min(Math.max(distancePx, 0), 2200);
  const normalizedZoomDelta = Math.min(Math.max(Math.abs(zoomDelta), 0), 6);
  const baseDuration = 250 + normalizedDistance * 0.22 + normalizedZoomDelta * 70;

  if (targetType === "citywide") {
    return Math.round(clamp(baseDuration + 100, 500, 800));
  }

  return Math.round(clamp(baseDuration, 250, 900));
}

export function resolveMapCameraPosition(map: LeafletMap, target: ResolvedMapCameraTarget, directoryCollapsed: boolean): ResolvedMapCameraPosition | null {
  if (target.type === "enterprise") {
    return {
      center: map.unproject(map.project(target.center, PROJECTION_ZOOM), PROJECTION_ZOOM),
      type: target.type,
      zoom: clamp(target.zoom, map.getMinZoom(), map.getMaxZoom()),
    };
  }

  if (!target.bounds.isValid()) return null;

  const hasDirectoryOffset = !directoryCollapsed && map.getSize().x >= DIRECTORY_BREAKPOINT_PX;
  const paddingTopLeft: [number, number] = hasDirectoryOffset ? [420, target.type === "citywide" ? 48 : 52] : [42, 42];
  const paddingBottomRight: [number, number] = target.type === "citywide" ? [48, 48] : [56, 56];
  const paddedBounds = target.bounds.pad(target.type === "citywide" ? 0.18 : 0.22);
  const maxZoom = target.type === "citywide" ? 13.45 : 14.35;
  const totalPadding = [paddingTopLeft[0] + paddingBottomRight[0], paddingTopLeft[1] + paddingBottomRight[1]] as unknown as Point;
  const zoom = clamp(map.getBoundsZoom(paddedBounds, false, totalPadding), map.getMinZoom(), Math.min(map.getMaxZoom(), maxZoom));

  return {
    center: getPaddedBoundsCenter(map, paddedBounds, zoom, paddingTopLeft, paddingBottomRight),
    type: target.type,
    zoom,
  };
}

export class MapMotionController {
  private animationFrameId: number | null = null;
  private animationStartedAt = 0;
  private constraintsKey: string | null = null;
  private disposed = false;
  private durationMs = 0;
  private isMoving = false;
  private revision = 0;
  private segmentStart: ResolvedMapCameraPosition | null = null;
  private target: ResolvedMapCameraPosition | null = null;
  private readonly map: LeafletFrameMap;

  constructor(map: LeafletMap) {
    this.map = map as LeafletFrameMap;
  }

  setTarget(target: ResolvedMapCameraTarget, options: MapCameraTransitionOptions) {
    if (this.disposed) return this.revision;

    if (target.type === "citywide" && target.bounds.isValid()) {
      this.configureCitywideConstraints(target.bounds);
    }

    const targetPosition = resolveMapCameraPosition(this.map, target, options.directoryCollapsed);
    if (!targetPosition) return this.revision;

    const currentCenter = this.map.getCenter();
    const currentZoom = this.map.getZoom();
    const distancePx = this.map.project(currentCenter, currentZoom).distanceTo(this.map.project(targetPosition.center, currentZoom));
    const durationMs = calculateAdaptiveMapDuration(distancePx, targetPosition.zoom - currentZoom, targetPosition.type);
    const reducedMotion = options.reducedMotion ?? prefersReducedMapMotion();
    const nextRevision = ++this.revision;

    this.durationMs = durationMs;
    this.target = targetPosition;

    if (options.immediate === true || reducedMotion) {
      this.cancelScheduledFrame();
      this.isMoving = false;
      this.map.setView(targetPosition.center, targetPosition.zoom, { animate: false });
      return nextRevision;
    }

    this.cancelScheduledFrame();
    this.segmentStart = {
      center: this.map.getCenter(),
      type: targetPosition.type,
      zoom: this.map.getZoom(),
    };
    this.animationStartedAt = performance.now();

    if (!this.isMoving) {
      this.map._moveStart(true);
      this.isMoving = true;
    }

    this.animationFrameId = window.requestAnimationFrame(this.renderFrame);
    return nextRevision;
  }

  getSnapshot() {
    return {
      durationMs: this.durationMs,
      revision: this.revision,
      target: this.target,
    };
  }

  dispose() {
    this.disposed = true;
    this.cancelScheduledFrame();
    this.target = null;
    this.segmentStart = null;
    this.isMoving = false;
  }

  private configureCitywideConstraints(bounds: LatLngBounds) {
    const key = bounds.toBBoxString();
    if (this.constraintsKey === key) return;

    const interactionBounds = bounds.pad(1.05);
    const minZoomReferenceBounds = bounds.pad(0.62);
    this.map.setMaxBounds(interactionBounds);
    this.map.setMinZoom(Math.max(11.2, this.map.getBoundsZoom(minZoomReferenceBounds, true) - 0.72));
    this.constraintsKey = key;
  }

  private cancelScheduledFrame() {
    if (this.animationFrameId === null) return;

    window.cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private readonly renderFrame = (timestamp: number) => {
    if (this.disposed || !this.segmentStart || !this.target) return;

    const progress = clamp((timestamp - this.animationStartedAt) / this.durationMs, 0, 1);
    const easedProgress = easeOutCubic(progress);
    const startPoint = this.map.project(this.segmentStart.center, PROJECTION_ZOOM);
    const targetPoint = this.map.project(this.target.center, PROJECTION_ZOOM);
    const center = this.map.unproject(
      [startPoint.x + (targetPoint.x - startPoint.x) * easedProgress, startPoint.y + (targetPoint.y - startPoint.y) * easedProgress],
      PROJECTION_ZOOM,
    );
    const zoom = this.segmentStart.zoom + (this.target.zoom - this.segmentStart.zoom) * easedProgress;

    // This is the same frame metadata Leaflet's native flyTo uses. It keeps
    // GridLayer, SVG, marker, tooltip, and popup panes on one geographic frame
    // while the bounded zoom interpolation avoids flyTo's wide zoom-out arc.
    this.map._move(center, zoom, { flyTo: true });

    if (progress < 1) {
      this.animationFrameId = window.requestAnimationFrame(this.renderFrame);
      return;
    }

    this.animationFrameId = null;
    this.segmentStart = null;
    this.isMoving = false;
    this.map._moveEnd(true);
  };
}

function getPaddedBoundsCenter(map: LeafletMap, bounds: LatLngBounds, zoom: number, paddingTopLeft: [number, number], paddingBottomRight: [number, number]) {
  if (zoom === Infinity) return bounds.getCenter();

  const southWest = map.project(bounds.getSouthWest(), zoom);
  const northEast = map.project(bounds.getNorthEast(), zoom);
  const centerX = (southWest.x + northEast.x) / 2 + (paddingBottomRight[0] - paddingTopLeft[0]) / 2;
  const centerY = (southWest.y + northEast.y) / 2 + (paddingBottomRight[1] - paddingTopLeft[1]) / 2;
  return map.unproject([centerX, centerY], zoom);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3;
}
