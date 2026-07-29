/// <reference types="node" />

import { readFileSync } from "node:fs";
import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point, PointExpression } from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { calculateAdaptiveMapDuration, MapMotionController, resolveMapCameraPosition, type ResolvedMapCameraTarget } from "./mapCamera";

type MapMock = LeafletMap & {
  _move: Mock;
  _moveEnd: Mock;
  _moveStart: Mock;
  fitBounds: Mock;
  flyTo: Mock;
  flyToBounds: Mock;
  setView: Mock;
  stop: Mock;
};

let animationClock = 0;
let nextAnimationFrameId = 1;
let pendingAnimationFrames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  animationClock = 0;
  nextAnimationFrameId = 1;
  pendingAnimationFrames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => animationClock);
  vi.stubGlobal("window", {
    cancelAnimationFrame: vi.fn((frameId: number) => pendingAnimationFrames.delete(frameId)),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId++;
      pendingAnimationFrames.set(frameId, callback);
      return frameId;
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderNextFrame(elapsedMs: number) {
  animationClock += elapsedMs;
  const nextFrame = pendingAnimationFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!nextFrame) throw new Error("Expected a pending animation frame.");

  pendingAnimationFrames.delete(nextFrame[0]);
  nextFrame[1](animationClock);
}

function createMap(initialCenter: LatLngExpression = [14.35, 121.05], initialZoom = 12) {
  let center = toLatLng(initialCenter);
  let zoom = initialZoom;
  let minZoom = 11.2;

  const implementation = {
    _move: vi.fn((nextCenter: LatLngExpression, nextZoom: number) => {
      center = toLatLng(nextCenter);
      zoom = nextZoom;
      return implementation;
    }),
    _moveEnd: vi.fn(() => implementation),
    _moveStart: vi.fn(() => implementation),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    flyToBounds: vi.fn(),
    getBoundsZoom: vi.fn((bounds: LatLngBounds, inside?: boolean) => {
      if (inside) return 12.4;
      return bounds.getNorth() - bounds.getSouth() > 0.07 ? 12.35 : 14.2;
    }),
    getCenter: vi.fn(() => center),
    getMaxZoom: vi.fn(() => 18),
    getMinZoom: vi.fn(() => minZoom),
    getSize: vi.fn(() => toPoint(1200, 800)),
    getZoom: vi.fn(() => zoom),
    project: vi.fn((value: LatLngExpression, targetZoom = zoom) => {
      const projected = toLatLng(value);
      const scale = 2 ** targetZoom;
      return toPoint(projected.lng * scale, projected.lat * scale);
    }),
    setMaxBounds: vi.fn(() => implementation),
    setMinZoom: vi.fn((nextZoom: number) => {
      minZoom = nextZoom;
      return implementation;
    }),
    setView: vi.fn((nextCenter: LatLngExpression, nextZoom: number) => {
      center = toLatLng(nextCenter);
      zoom = nextZoom;
      return implementation;
    }),
    stop: vi.fn(),
    unproject: vi.fn((value: PointExpression, targetZoom = zoom) => {
      const projected = toPointExpression(value);
      const scale = 2 ** targetZoom;
      return toLatLng([projected.y / scale, projected.x / scale]);
    }),
  };

  return implementation as unknown as MapMock;
}

function toLatLng(value: LatLngExpression): LatLng {
  if (Array.isArray(value)) return { lat: value[0], lng: value[1] } as LatLng;
  if ("lat" in value) return { lat: value.lat, lng: value.lng } as LatLng;
  throw new Error("Unsupported test coordinate.");
}

function toPoint(x: number, y: number): Point {
  return {
    distanceTo(other: PointExpression) {
      const resolved = toPointExpression(other);
      return Math.hypot(x - resolved.x, y - resolved.y);
    },
    x,
    y,
  } as Point;
}

function toPointExpression(value: PointExpression) {
  return Array.isArray(value) ? { x: value[0], y: value[1] } : value;
}

function createBounds(south: number, west: number, north: number, east: number): LatLngBounds {
  return {
    getCenter: () => toLatLng([(south + north) / 2, (west + east) / 2]),
    getNorth: () => north,
    getNorthEast: () => toLatLng([north, east]),
    getSouth: () => south,
    getSouthWest: () => toLatLng([south, west]),
    isValid: () => true,
    pad: (ratio: number) => {
      const latitudePadding = (north - south) * ratio;
      const longitudePadding = (east - west) * ratio;
      return createBounds(south - latitudePadding, west - longitudePadding, north + latitudePadding, east + longitudePadding);
    },
    toBBoxString: () => `${west},${south},${east},${north}`,
  } as LatLngBounds;
}

const pacitaBounds = createBounds(14.325, 121.025, 14.35, 121.055);
const landayanBounds = createBounds(14.36, 121.07, 14.385, 121.1);
const sanRoqueBounds = createBounds(14.315, 121.08, 14.34, 121.11);
const langgamBounds = createBounds(14.27, 121.0, 14.31, 121.04);
const sanAntonioBounds = createBounds(14.29, 120.99, 14.35, 121.06);
const citywideBounds = createBounds(14.29, 120.98, 14.4, 121.13);

describe("map camera target resolution", () => {
  it("computes the target center and zoom once with directory-aware padding", () => {
    const map = createMap();
    const expanded = resolveMapCameraPosition(map, { type: "barangay", bounds: pacitaBounds }, false);
    const collapsed = resolveMapCameraPosition(map, { type: "barangay", bounds: pacitaBounds }, true);

    expect(expanded).not.toBeNull();
    expect(collapsed).not.toBeNull();
    expect(expanded!.zoom).toBe(14.2);
    expect(expanded!.center.lng).not.toBeCloseTo(collapsed!.center.lng, 6);
    expect(map.getBoundsZoom).toHaveBeenCalledWith(expect.anything(), false, [476, 108]);
  });

  it("does not mutate the original geographic bounds while resolving a target", () => {
    const map = createMap();
    const before = pacitaBounds.toBBoxString();

    resolveMapCameraPosition(map, { type: "barangay", bounds: pacitaBounds }, false);

    expect(pacitaBounds.toBBoxString()).toBe(before);
  });

  it("ignores invalid replacement bounds without issuing a camera command", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const invalidBounds = { isValid: () => false } as LatLngBounds;

    controller.setTarget({ type: "barangay", bounds: invalidBounds }, { directoryCollapsed: false, reducedMotion: false });

    expect(controller.getSnapshot().revision).toBe(0);
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.setView).not.toHaveBeenCalled();
  });
});

describe("adaptive native transition timing", () => {
  it("uses moderate short, medium, and long durations", () => {
    const short = calculateAdaptiveMapDuration(50, 0.1, "barangay");
    const medium = calculateAdaptiveMapDuration(700, 0.8, "barangay");
    const long = calculateAdaptiveMapDuration(1800, 1.6, "barangay");

    expect(short).toBeGreaterThanOrEqual(250);
    expect(short).toBeLessThanOrEqual(400);
    expect(medium).toBeGreaterThanOrEqual(400);
    expect(medium).toBeLessThanOrEqual(650);
    expect(long).toBeGreaterThanOrEqual(600);
    expect(long).toBeLessThanOrEqual(900);
  });

  it("keeps citywide returns in the 500-800ms range", () => {
    expect(calculateAdaptiveMapDuration(0, 0, "citywide")).toBe(500);
    expect(calculateAdaptiveMapDuration(5000, 8, "citywide")).toBe(800);
  });
});

describe("bounded Leaflet camera controller", () => {
  it("uses one Leaflet movement lifecycle for one barangay action", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const target = { type: "barangay", bounds: pacitaBounds } as const;
    const resolved = resolveMapCameraPosition(map, target, false)!;

    controller.setTarget(target, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(controller.getSnapshot().durationMs);

    expect(map._moveStart).toHaveBeenCalledTimes(1);
    expect(map._move).toHaveBeenCalledTimes(1);
    expect(map._move).toHaveBeenLastCalledWith(expect.objectContaining({ lat: resolved.center.lat, lng: resolved.center.lng }), resolved.zoom, { flyTo: true });
    expect(map._moveEnd).toHaveBeenCalledTimes(1);
    expect(map.flyToBounds).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.stop).not.toHaveBeenCalled();
  });

  it("accepts San Roque to Langgam immediately and leaves Langgam as the latest target", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const sanRoque = { type: "barangay", bounds: sanRoqueBounds } as const;
    const langgam = { type: "barangay", bounds: langgamBounds } as const;
    const langgamPosition = resolveMapCameraPosition(map, langgam, false)!;

    controller.setTarget(sanRoque, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(120);
    controller.setTarget(langgam, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(controller.getSnapshot().durationMs);

    expect(controller.getSnapshot()).toMatchObject({ revision: 2, target: { type: "barangay" } });
    expect(map._moveStart).toHaveBeenCalledTimes(1);
    expect(map._moveEnd).toHaveBeenCalledTimes(1);
    expect(map._move).toHaveBeenLastCalledWith(expect.objectContaining({ lat: langgamPosition.center.lat, lng: langgamPosition.center.lng }), langgamPosition.zoom, { flyTo: true });
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("keeps Pacita as the only final target after the required rapid barangay sequence", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const sequence: ResolvedMapCameraTarget[] = [
      { type: "barangay", bounds: sanAntonioBounds },
      { type: "barangay", bounds: landayanBounds },
      { type: "barangay", bounds: sanRoqueBounds },
      { type: "barangay", bounds: langgamBounds },
      { type: "barangay", bounds: pacitaBounds },
    ];
    const pacitaPosition = resolveMapCameraPosition(map, sequence.at(-1)!, false)!;

    sequence.forEach((target) => {
      controller.setTarget(target, { directoryCollapsed: false, reducedMotion: false });
      renderNextFrame(45);
    });
    renderNextFrame(controller.getSnapshot().durationMs);

    expect(controller.getSnapshot()).toMatchObject({ revision: 5, target: { type: "barangay" } });
    expect(map._move).toHaveBeenLastCalledWith(expect.objectContaining({ lat: pacitaPosition.center.lat, lng: pacitaPosition.center.lng }), pacitaPosition.zoom, { flyTo: true });
    expect(map.flyToBounds).not.toHaveBeenCalled();
    expect(map._moveEnd).toHaveBeenCalledTimes(1);
    expect(map.setMaxBounds).not.toHaveBeenCalled();
  });

  it("replaces a citywide return with a new barangay camera command", () => {
    const map = createMap([14.34, 121.04], 14);
    const controller = new MapMotionController(map);
    const pacitaPosition = resolveMapCameraPosition(map, { type: "barangay", bounds: pacitaBounds }, false)!;

    controller.setTarget({ type: "citywide", bounds: citywideBounds }, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(100);
    controller.setTarget({ type: "barangay", bounds: pacitaBounds }, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(controller.getSnapshot().durationMs);

    expect(controller.getSnapshot().revision).toBe(2);
    expect(map._move).toHaveBeenLastCalledWith(expect.objectContaining({ lat: pacitaPosition.center.lat, lng: pacitaPosition.center.lng }), pacitaPosition.zoom, { flyTo: true });
    expect(map._moveEnd).toHaveBeenCalledTimes(1);
  });

  it("never drops below the canonical citywide destination zoom", () => {
    const map = createMap([14.34, 121.04], 14.2);
    const controller = new MapMotionController(map);
    const target = { type: "citywide", bounds: citywideBounds } as const;
    const citywidePosition = resolveMapCameraPosition(map, target, false)!;

    controller.setTarget(target, { directoryCollapsed: false, reducedMotion: false });
    renderNextFrame(150);
    renderNextFrame(150);
    renderNextFrame(150);
    renderNextFrame(controller.getSnapshot().durationMs);

    const renderedZooms = map._move.mock.calls.map((call) => call[1] as number);
    const destinationFrames = renderedZooms.filter((zoom) => zoom === citywidePosition.zoom);
    expect(renderedZooms.every((zoom) => zoom >= citywidePosition.zoom)).toBe(true);
    expect(renderedZooms.at(-1)).toBe(citywidePosition.zoom);
    expect(destinationFrames).toHaveLength(1);
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("uses an immediate native setView for reduced motion", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const target = { type: "barangay", bounds: pacitaBounds } as const;
    const resolved = resolveMapCameraPosition(map, target, true)!;

    controller.setTarget(target, { directoryCollapsed: true, reducedMotion: true });

    expect(map.setView).toHaveBeenCalledTimes(1);
    expect(map.setView).toHaveBeenCalledWith(resolved.center, resolved.zoom, { animate: false });
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("configures stable citywide constraints only once for the same bounds", () => {
    const map = createMap();
    const controller = new MapMotionController(map);

    controller.setTarget({ type: "citywide", bounds: citywideBounds }, { directoryCollapsed: false, reducedMotion: false });
    controller.setTarget({ type: "citywide", bounds: citywideBounds }, { directoryCollapsed: true, reducedMotion: false });

    expect(map.setMaxBounds).toHaveBeenCalledTimes(1);
    expect(map.setMinZoom).toHaveBeenCalledTimes(1);
  });
});

describe("geographic layer integrity safeguards", () => {
  it("uses one frame driver and Leaflet fly metadata for synchronized geographic panes", () => {
    const cameraSource = readFileSync(new URL("./mapCamera.ts", import.meta.url), "utf8");

    expect(cameraSource.match(/requestAnimationFrame/g)).toHaveLength(2);
    expect(cameraSource).toContain("this.map._move(center, zoom, { flyTo: true })");
    expect(cameraSource).toContain("this.map._moveStart(true)");
    expect(cameraSource).toContain("this.map._moveEnd(true)");
    expect(cameraSource).not.toContain("latLngToContainerPoint");
  });

  it("does not add positional transitions to Leaflet panes, paths, markers, or popups", () => {
    const stylesheet = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
    const geographicTransitionRule = stylesheet.match(/#admin-enterprise-map \.leaflet-marker-icon,\s*#admin-enterprise-map \.leaflet-popup\s*\{([^}]*)\}/);
    const unsafePaneTransform = /\.leaflet-(?:map|tile|overlay|marker|tooltip|popup)-pane[^{]*\{[^}]*(?:transition\s*:[^;}]*transform|will-change\s*:[^;}]*transform)/s;

    expect(stylesheet).not.toMatch(unsafePaneTransform);
    expect(geographicTransitionRule).not.toBeNull();
    expect(geographicTransitionRule![1]).toContain("transition: opacity");
    expect(geographicTransitionRule![1]).not.toContain("transform");
  });

  it("keeps invalidateSize limited to the real directory layout change", () => {
    const componentSource = readFileSync(new URL("../components/AdminEnterpriseMap.tsx", import.meta.url), "utf8");

    expect(componentSource.match(/invalidateSize/g)).toHaveLength(1);
    expect(componentSource).toContain("}, [isDirectoryCollapsed]);");
    expect(componentSource).not.toContain("isAnimating");
    expect(componentSource).not.toContain("isTransitioning");
  });

  it("creates the GeoJSON layer only when boundary data changes", () => {
    const componentSource = readFileSync(new URL("../components/AdminEnterpriseMap.tsx", import.meta.url), "utf8");
    const creationEffect = componentSource.match(/const boundaryLayer = L\.geoJSON[\s\S]*?if \(boundaryLayerRef\.current === boundaryLayer\)[\s\S]*?\n\s{2}}, \[boundary\]\);/);

    expect(creationEffect).not.toBeNull();
    expect(creationEffect![0]).not.toContain("[boundary, mapTheme");
    expect(creationEffect![0]).not.toContain("[boundary, showBoundaries");
    expect(componentSource).toContain("citywideBoundsRef.current = boundaryLayer.getBounds()");
    expect(componentSource).toContain("barangayBoundsRef.current = new Map");
  });

  it("retains marker instances while selection visibility changes", () => {
    const componentSource = readFileSync(new URL("../components/AdminEnterpriseMap.tsx", import.meta.url), "utf8");

    expect(componentSource).toContain("const enterpriseIds = new Set(mapEnterprises.map");
    expect(componentSource).toContain("if (!map.hasLayer(marker)) marker.addTo(map)");
    expect(componentSource).not.toContain("Object.values(markersRef.current).forEach((marker) => marker.remove());\n    markersRef.current = {};\n\n    visibleEnterprises.forEach");
  });
});
