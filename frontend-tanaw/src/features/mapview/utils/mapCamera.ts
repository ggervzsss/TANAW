import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point, PointTuple } from "leaflet";

const DEFAULT_CITYWIDE_BOUNDS_PADDING = 0.04;
const DEFAULT_CITYWIDE_MAX_ZOOM = 14.35;
const BARANGAY_MAX_ZOOM = 16.75;
const ENTERPRISE_MIN_ZOOM = 15.75;
const ENTERPRISE_MAX_ZOOM = 17.25;

export type ResolvedMapCameraTarget = { type: "citywide"; bounds: LatLngBounds } | { type: "barangay"; bounds: LatLngBounds } | { type: "enterprise"; center: LatLngExpression };

export type MapCameraTransitionOptions = {
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

export function resolveMapCameraPosition(map: LeafletMap, target: ResolvedMapCameraTarget): ResolvedMapCameraPosition | null {
  if (target.type === "citywide") return getDefaultCitywideCamera(map, target.bounds);
  if (target.type === "barangay") {
    return target.bounds.isValid() ? resolveBoundsCameraPosition(map, target, 0.08, BARANGAY_MAX_ZOOM) : null;
  }
  const zoom = clamp(clamp(map.getZoom(), ENTERPRISE_MIN_ZOOM, ENTERPRISE_MAX_ZOOM), map.getMinZoom(), map.getMaxZoom());
  const projected = map.project(target.center, zoom);
  return {
    center: map.unproject([projected.x, projected.y - (map.getSize().y < 480 ? 38 : 26)], zoom),
    type: target.type,
    zoom,
  };
}

export function getDefaultCitywideCamera(map: LeafletMap, bounds: LatLngBounds): ResolvedMapCameraPosition | null {
  if (!bounds.isValid()) return null;

  return resolveBoundsCameraPosition(map, { type: "citywide", bounds }, DEFAULT_CITYWIDE_BOUNDS_PADDING, DEFAULT_CITYWIDE_MAX_ZOOM);
}

function resolveBoundsCameraPosition(map: LeafletMap, target: Extract<ResolvedMapCameraTarget, { type: "citywide" | "barangay" }>, boundsPadding: number, maxZoom: number): ResolvedMapCameraPosition {
  const paddedBounds = target.bounds.pad(boundsPadding);
  const padding = getFitPadding(map);
  const zoom = clamp(map.getBoundsZoom(paddedBounds, false, padding as unknown as Point), map.getMinZoom(), Math.min(map.getMaxZoom(), maxZoom));
  const southWest = map.project(paddedBounds.getSouthWest(), zoom);
  const northEast = map.project(paddedBounds.getNorthEast(), zoom);

  return { center: map.unproject([(southWest.x + northEast.x) / 2, (southWest.y + northEast.y) / 2], zoom), type: target.type, zoom };
}

function getFitPadding(map: LeafletMap): PointTuple {
  const { x, y } = map.getSize();
  return [Math.min(72, x * 0.12), Math.min(72, y * 0.14)];
}

export class MapMotionController {
  private constraintsKey: string | null = null;
  private disposed = false;
  private durationMs = 0;
  private revision = 0;
  private target: ResolvedMapCameraPosition | null = null;
  private boundsTarget: Extract<ResolvedMapCameraTarget, { bounds: LatLngBounds }> | null = null;
  private zooming = false;
  private moving = false;
  private movingToTarget = false;
  private pending: { target: ResolvedMapCameraTarget; options: MapCameraTransitionOptions } | null = null;
  private readonly map: LeafletMap;

  constructor(map: LeafletMap) {
    this.map = map;
    map.on("zoomstart", this.onZoomStart);
    map.on("zoomend", this.onZoomEnd);
    map.on("movestart", this.onMoveStart);
    map.on("moveend", this.onMoveEnd);
    map.on("dragstart", this.onDragStart);
  }

  setTarget(target: ResolvedMapCameraTarget, options: MapCameraTransitionOptions = {}) {
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
    this.boundsTarget = null;
    if (this.pending?.target.type !== "citywide") this.pending = null;
  }

  isMoving() {
    return this.moving || this.zooming || this.pending !== null;
  }

  resize() {
    const size = this.map.getSize();
    const container = this.map.getContainer();
    if (size.x === container.clientWidth && size.y === container.clientHeight) return;

    const target = this.boundsTarget;
    const position = this.target;
    const keepFit = target && position && (this.movingToTarget || (this.map.getZoom() === position.zoom && this.map.getCenter().equals(position.center, 0.0001)));
    this.map.invalidateSize();
    if (keepFit && !this.pending) this.setTarget(target, { immediate: true });
  }

  private onMoveStart = () => {
    this.moving = true;
  };
  private onMoveEnd = () => {
    this.moving = false;
    this.movingToTarget = false;
  };
  private onDragStart = () => {
    this.movingToTarget = false;
  };

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
      this.allowCitywideFit(target.bounds);
    }

    const targetPosition = resolveMapCameraPosition(this.map, target);
    if (!targetPosition) return;

    const reducedMotion = options.reducedMotion ?? prefersReducedMapMotion();
    this.target = targetPosition;
    this.boundsTarget = target.type === "enterprise" ? null : target;

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
    this.movingToTarget = true;
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
    this.map.off("dragstart", this.onDragStart);
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

  private allowCitywideFit(bounds: LatLngBounds) {
    const { x: width, y: height } = this.map.getSize();
    const [paddingX, paddingY] = getFitPadding(this.map);
    const zoomFloor = this.map.getMinZoom();
    const padded = bounds.pad(DEFAULT_CITYWIDE_BOUNDS_PADDING);
    const southWest = this.map.project(padded.getSouthWest(), zoomFloor);
    const northEast = this.map.project(padded.getNorthEast(), zoomFloor);
    const usableWidth = Math.max(1, width - paddingX);
    const usableHeight = Math.max(1, height - paddingY);
    const fitScale = Math.min(usableWidth / Math.abs(northEast.x - southWest.x), usableHeight / Math.abs(northEast.y - southWest.y));
    if (fitScale >= 1) return;

    // getBoundsZoom is clamped by Leaflet's minZoom. Allow enough room for a fit
    // between the panels without raising the floor and moving a manually panned map.
    const fitZoom = this.map.getScaleZoom(fitScale, zoomFloor);
    const snap = this.map.options.zoomSnap ?? 1;
    this.map.setMinZoom(snap ? Math.floor(fitZoom / snap) * snap : fitZoom);
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
