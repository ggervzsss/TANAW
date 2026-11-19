import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point } from "leaflet";

export const COMPACT_MAP_MAX_WIDTH = 1100;
const EXPANDED_DIRECTORY_OCCLUSION_PX = 438;
const EXPANDED_INSIGHTS_OCCLUSION_PX = 480;
const DEFAULT_CITYWIDE_BOUNDS_PADDING = 0.04;
const DEFAULT_CITYWIDE_MAX_ZOOM = 14.35;
const BARANGAY_MAX_ZOOM = 16.75;
const ENTERPRISE_MIN_ZOOM = 15.75;
const ENTERPRISE_MAX_ZOOM = 17.25;

export type ResolvedMapCameraTarget = { type: "citywide"; bounds: LatLngBounds } | { type: "barangay"; bounds: LatLngBounds } | { type: "enterprise"; center: LatLngExpression };

export type MapCameraTransitionOptions = {
  directoryCollapsed: boolean;
  insightsOpen?: boolean;
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

export function resolveMapCameraPosition(map: LeafletMap, target: ResolvedMapCameraTarget, directoryCollapsed: boolean, insightsOpen = false): ResolvedMapCameraPosition | null {
  if (target.type === "citywide") return getDefaultCitywideCamera(map, target.bounds, directoryCollapsed, insightsOpen);
  if (target.type === "barangay") {
    return target.bounds.isValid() ? resolveBoundsCameraPosition(map, target, directoryCollapsed, insightsOpen, 0.08, BARANGAY_MAX_ZOOM) : null;
  }
  const zoom = clamp(clamp(map.getZoom(), ENTERPRISE_MIN_ZOOM, ENTERPRISE_MAX_ZOOM), map.getMinZoom(), map.getMaxZoom());
  const { left, right } = getMapPanelInsets(map.getSize().x, directoryCollapsed, insightsOpen);
  const projected = map.project(target.center, zoom);
  return {
    center: map.unproject([projected.x + (right - left) / 2, projected.y - (map.getSize().y < 480 ? 38 : 26)], zoom),
    type: target.type,
    zoom,
  };
}

export function getDefaultCitywideCamera(map: LeafletMap, bounds: LatLngBounds, directoryCollapsed: boolean, insightsOpen = false): ResolvedMapCameraPosition | null {
  if (!bounds.isValid()) return null;

  return resolveBoundsCameraPosition(map, { type: "citywide", bounds }, directoryCollapsed, insightsOpen, DEFAULT_CITYWIDE_BOUNDS_PADDING, DEFAULT_CITYWIDE_MAX_ZOOM);
}

function resolveBoundsCameraPosition(
  map: LeafletMap,
  target: Extract<ResolvedMapCameraTarget, { type: "citywide" | "barangay" }>,
  directoryCollapsed: boolean,
  insightsOpen: boolean,
  boundsPadding: number,
  maxZoom: number,
): ResolvedMapCameraPosition {
  const { paddingTopLeft, paddingBottomRight } = getBoundsPadding(map.getSize().x, directoryCollapsed, insightsOpen, target.type === "citywide" ? 48 : 56);
  const paddedBounds = target.bounds.pad(boundsPadding);
  const totalPadding = [paddingTopLeft[0] + paddingBottomRight[0], paddingTopLeft[1] + paddingBottomRight[1]] as unknown as Point;
  const zoom = clamp(map.getBoundsZoom(paddedBounds, false, totalPadding), map.getMinZoom(), Math.min(map.getMaxZoom(), maxZoom));

  return {
    center: getPaddedBoundsCenter(map, paddedBounds, zoom, paddingTopLeft, paddingBottomRight),
    type: target.type,
    zoom,
  };
}

function getBoundsPadding(width: number, directoryCollapsed: boolean, insightsOpen: boolean, edgePadding: number) {
  const { left, right } = getMapPanelInsets(width, directoryCollapsed, insightsOpen);
  const paddingTopLeft: [number, number] = [left || 42, left ? 52 : 42];
  const paddingBottomRight: [number, number] = [right || edgePadding, edgePadding];
  return { paddingTopLeft, paddingBottomRight };
}

export function getMapPanelInsets(width: number, directoryCollapsed: boolean, insightsOpen: boolean) {
  const desktop = width > COMPACT_MAP_MAX_WIDTH;
  return {
    left: desktop && !directoryCollapsed ? EXPANDED_DIRECTORY_OCCLUSION_PX : 0,
    right: desktop && insightsOpen ? EXPANDED_INSIGHTS_OCCLUSION_PX : 0,
  };
}

export class MapMotionController {
  private constraintsKey: string | null = null;
  private disposed = false;
  private durationMs = 0;
  private revision = 0;
  private target: ResolvedMapCameraPosition | null = null;
  private zooming = false;
  private moving = false;
  private pending: { target: ResolvedMapCameraTarget; options: MapCameraTransitionOptions } | null = null;
  private readonly map: LeafletMap;

  constructor(map: LeafletMap) {
    this.map = map;
    map.on("zoomstart", this.onZoomStart);
    map.on("zoomend", this.onZoomEnd);
    map.on("movestart", this.onMoveStart);
    map.on("moveend", this.onMoveEnd);
  }

  setTarget(target: ResolvedMapCameraTarget, options: MapCameraTransitionOptions) {
    if (this.disposed) return this.revision;
    const revision = ++this.revision;
    // Leaflet ignores a fresh animated zoom while an earlier one is in progress.
    if (this.zooming) {
      this.pending = { target, options };
    } else {
      this.pending = null;
      this.move(target, options);
    }
    return revision;
  }

  clearPendingSelection() {
    if (this.pending?.target.type !== "citywide") this.pending = null;
  }

  isMoving() {
    return this.moving || this.zooming || this.pending !== null;
  }

  private onMoveStart = () => { this.moving = true; };
  private onMoveEnd = () => { this.moving = false; };

  private onZoomStart = () => {
    this.zooming = true;
  };

  private onZoomEnd = () => {
    this.zooming = false;
    if (!this.pending) return;
    queueMicrotask(() => {
      if (this.disposed || this.zooming || !this.pending) return;
      const { target, options } = this.pending;
      this.pending = null;
      this.move(target, options);
    });
  };

  private move(target: ResolvedMapCameraTarget, options: MapCameraTransitionOptions) {
    if (target.type === "citywide" && target.bounds.isValid()) {
      this.configureCitywideConstraints(target.bounds);
      this.allowCitywideFit(target.bounds, options.directoryCollapsed, options.insightsOpen ?? false);
    }

    const targetPosition = resolveMapCameraPosition(this.map, target, options.directoryCollapsed, options.insightsOpen);
    if (!targetPosition) return;

    const reducedMotion = options.reducedMotion ?? prefersReducedMapMotion();
    this.target = targetPosition;

    if (options.immediate === true || reducedMotion) {
      this.durationMs = 0;
      this.map.setView(targetPosition.center, targetPosition.zoom, { animate: false });
      return;
    }

    const currentCenter = this.map.getCenter();
    const currentZoom = this.map.getZoom();
    const distancePx = this.map.project(currentCenter, currentZoom).distanceTo(this.map.project(targetPosition.center, currentZoom));
    if (targetPosition.zoom === currentZoom && distancePx <= 1) {
      this.durationMs = 0;
      return;
    }
    const durationMs = calculateAdaptiveMapDuration(distancePx, targetPosition.zoom - currentZoom, targetPosition.type);
    this.durationMs = durationMs;
    if (targetPosition.zoom === currentZoom) {
      this.map.panTo(targetPosition.center, { animate: true, duration: durationMs / 1000, easeLinearity: 0.25 });
      return;
    }

    // setView keeps the zoom bounded between the current and target values.
    // Unlike flyTo, it cannot create a lower-zoom flight arc before returning
    // to the target, and Leaflet still moves every geographic pane
    // through the same native camera lifecycle.
    this.map.setView(targetPosition.center, targetPosition.zoom, {
      animate: true,
      duration: durationMs / 1000,
      easeLinearity: 0.25,
    });
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
    this.pending = null;
    this.map.off("zoomstart", this.onZoomStart);
    this.map.off("zoomend", this.onZoomEnd);
    this.map.off("movestart", this.onMoveStart);
    this.map.off("moveend", this.onMoveEnd);
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

  private allowCitywideFit(bounds: LatLngBounds, directoryCollapsed: boolean, insightsOpen: boolean) {
    const { x: width, y: height } = this.map.getSize();
    const { paddingTopLeft, paddingBottomRight } = getBoundsPadding(width, directoryCollapsed, insightsOpen, 48);
    const zoomFloor = this.map.getMinZoom();
    const padded = bounds.pad(DEFAULT_CITYWIDE_BOUNDS_PADDING);
    const southWest = this.map.project(padded.getSouthWest(), zoomFloor);
    const northEast = this.map.project(padded.getNorthEast(), zoomFloor);
    const usableWidth = Math.max(1, width - paddingTopLeft[0] - paddingBottomRight[0]);
    const usableHeight = Math.max(1, height - paddingTopLeft[1] - paddingBottomRight[1]);
    const fitScale = Math.min(usableWidth / Math.abs(northEast.x - southWest.x), usableHeight / Math.abs(northEast.y - southWest.y));
    if (fitScale >= 1) return;

    // getBoundsZoom is clamped by Leaflet's minZoom. Allow enough room for a fit
    // between the panels without raising the floor and moving a manually panned map.
    const fitZoom = this.map.getScaleZoom(fitScale, zoomFloor);
    const snap = this.map.options.zoomSnap ?? 1;
    this.map.setMinZoom(snap ? Math.floor(fitZoom / snap) * snap : fitZoom);
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
