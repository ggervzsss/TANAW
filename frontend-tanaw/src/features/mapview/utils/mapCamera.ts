import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point } from "leaflet";

const DIRECTORY_BREAKPOINT_PX = 820;
const PROJECTION_ZOOM = 18;

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
  private constraintsKey: string | null = null;
  private disposed = false;
  private durationMs = 0;
  private revision = 0;
  private target: ResolvedMapCameraPosition | null = null;
  private readonly map: LeafletMap;

  constructor(map: LeafletMap) {
    this.map = map;
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
      this.map.setView(targetPosition.center, targetPosition.zoom, { animate: false });
      return nextRevision;
    }

    // Leaflet flyTo cancels its own obsolete fly frame before starting the
    // replacement transition. Keeping that lifecycle native guarantees that
    // tiles, SVG paths, markers, tooltips, and popups share one pane transform.
    this.map.flyTo(targetPosition.center, targetPosition.zoom, {
      animate: true,
      duration: durationMs / 1000,
      easeLinearity: 0.25,
    });
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
    this.target = null;
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
