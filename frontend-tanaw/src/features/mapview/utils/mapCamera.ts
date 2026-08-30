import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point } from "leaflet";

const DIRECTORY_BREAKPOINT_PX = 820;
const EXPANDED_DIRECTORY_OCCLUSION_PX = 448;
const DEFAULT_CITYWIDE_BOUNDS_PADDING = 0.04;
const DEFAULT_CITYWIDE_MAX_ZOOM = 14.35;
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

  if (target.type === "citywide") {
    return getDefaultCitywideCamera(map, target.bounds, directoryCollapsed);
  }

  return resolveBoundsCameraPosition(map, target, directoryCollapsed, 0.22, 14.35);
}

export function getDefaultCitywideCamera(map: LeafletMap, bounds: LatLngBounds, directoryCollapsed: boolean): ResolvedMapCameraPosition | null {
  if (!bounds.isValid()) return null;

  return resolveBoundsCameraPosition(map, { type: "citywide", bounds }, directoryCollapsed, DEFAULT_CITYWIDE_BOUNDS_PADDING, DEFAULT_CITYWIDE_MAX_ZOOM);
}

function resolveBoundsCameraPosition(
  map: LeafletMap,
  target: Extract<ResolvedMapCameraTarget, { type: "citywide" | "barangay" }>,
  directoryCollapsed: boolean,
  boundsPadding: number,
  maxZoom: number,
): ResolvedMapCameraPosition {
  const hasDirectoryOffset = !directoryCollapsed && map.getSize().x >= DIRECTORY_BREAKPOINT_PX;
  const paddingTopLeft: [number, number] = hasDirectoryOffset ? [EXPANDED_DIRECTORY_OCCLUSION_PX, target.type === "citywide" ? 48 : 52] : [42, 42];
  const paddingBottomRight: [number, number] = target.type === "citywide" ? [48, 48] : [56, 56];
  const paddedBounds = target.bounds.pad(boundsPadding);
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

    const reducedMotion = options.reducedMotion ?? prefersReducedMapMotion();
    const nextRevision = ++this.revision;

    this.target = targetPosition;

    if (options.immediate === true || reducedMotion) {
      this.durationMs = 0;
      this.map.setView(targetPosition.center, targetPosition.zoom, { animate: false });
      return nextRevision;
    }

    const currentCenter = this.map.getCenter();
    const currentZoom = this.map.getZoom();
    const distancePx = this.map.project(currentCenter, currentZoom).distanceTo(this.map.project(targetPosition.center, currentZoom));
    const durationMs = calculateAdaptiveMapDuration(distancePx, targetPosition.zoom - currentZoom, targetPosition.type);
    this.durationMs = durationMs;

    // setView keeps the zoom bounded between the current and target values.
    // Unlike flyTo, it cannot create a lower-zoom flight arc before returning
    // to the citywide target, and Leaflet still moves every geographic pane
    // through the same native camera lifecycle.
    this.map.setView(targetPosition.center, targetPosition.zoom, {
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
