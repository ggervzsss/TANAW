/// <reference types="node" />

import { readFileSync } from "node:fs";
import type { LatLng, LatLngBounds, LatLngExpression, Map as LeafletMap, Point, PointExpression } from "leaflet";
import { describe, expect, it, vi, type Mock } from "vitest";
import { calculateAdaptiveMapDuration, getDefaultCitywideCamera, MapMotionController, resolveMapCameraPosition, type ResolvedMapCameraTarget } from "./mapCamera";

type MapMock = LeafletMap & {
  fitBounds: Mock;
  flyTo: Mock;
  flyToBounds: Mock;
  setView: Mock;
  stop: Mock;
};

function createMap(initialCenter: LatLngExpression = [14.35, 121.05], initialZoom = 12) {
  let center = toLatLng(initialCenter);
  let zoom = initialZoom;
  let minZoom = 11.2;

  const implementation = {
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

  it("uses one closer directory-aware camera definition for every citywide target", () => {
    const map = createMap();
    const canonical = getDefaultCitywideCamera(map, citywideBounds, false);
    const resolved = resolveMapCameraPosition(map, { type: "citywide", bounds: citywideBounds }, false);
    const paddedBounds = (map.getBoundsZoom as Mock).mock.calls.at(-1)?.[0] as LatLngBounds;

    expect(canonical).toEqual(resolved);
    expect(canonical).not.toBeNull();
    expect(canonical!.center.lng).toBeLessThan(citywideBounds.getCenter().lng);
    expect(paddedBounds.getNorth() - paddedBounds.getSouth()).toBeCloseTo((citywideBounds.getNorth() - citywideBounds.getSouth()) * 1.08, 8);
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

describe("native Leaflet camera controller", () => {
  it("issues exactly one native camera command for one barangay action", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const target = { type: "barangay", bounds: pacitaBounds } as const;
    const resolved = resolveMapCameraPosition(map, target, false)!;

    controller.setTarget(target, { directoryCollapsed: false, reducedMotion: false });

    expect(map.setView).toHaveBeenCalledTimes(1);
    expect(map.setView).toHaveBeenCalledWith(
      resolved.center,
      resolved.zoom,
      expect.objectContaining({
        animate: true,
        duration: expect.any(Number),
      }),
    );
    expect(map.flyToBounds).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
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
    controller.setTarget(langgam, { directoryCollapsed: false, reducedMotion: false });

    expect(controller.getSnapshot()).toMatchObject({ revision: 2, target: { type: "barangay" } });
    expect(map.setView).toHaveBeenCalledTimes(2);
    expect(map.setView).toHaveBeenLastCalledWith(langgamPosition.center, langgamPosition.zoom, expect.anything());
  });

  it("keeps Pacita as the only final target after the screenshot regression sequence", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const sequence: ResolvedMapCameraTarget[] = [
      { type: "barangay", bounds: sanRoqueBounds },
      { type: "barangay", bounds: langgamBounds },
      { type: "barangay", bounds: landayanBounds },
      { type: "citywide", bounds: citywideBounds },
      { type: "barangay", bounds: pacitaBounds },
    ];
    const pacitaPosition = resolveMapCameraPosition(map, sequence.at(-1)!, false)!;

    sequence.forEach((target) => controller.setTarget(target, { directoryCollapsed: false, reducedMotion: false }));

    expect(controller.getSnapshot()).toMatchObject({ revision: 5, target: { type: "barangay" } });
    expect(map.setView).toHaveBeenCalledTimes(5);
    expect(map.setView).toHaveBeenLastCalledWith(pacitaPosition.center, pacitaPosition.zoom, expect.anything());
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.flyToBounds).not.toHaveBeenCalled();
  });

  it("replaces a citywide return with a new barangay camera command", () => {
    const map = createMap([14.34, 121.04], 14);
    const controller = new MapMotionController(map);
    const pacitaPosition = resolveMapCameraPosition(map, { type: "barangay", bounds: pacitaBounds }, false)!;

    controller.setTarget({ type: "citywide", bounds: citywideBounds }, { directoryCollapsed: false, reducedMotion: false });
    controller.setTarget({ type: "barangay", bounds: pacitaBounds }, { directoryCollapsed: false, reducedMotion: false });

    expect(controller.getSnapshot().revision).toBe(2);
    expect(map.setView).toHaveBeenLastCalledWith(pacitaPosition.center, pacitaPosition.zoom, expect.anything());
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("initializes the citywide camera once without exposing a provisional viewport", () => {
    const map = createMap();
    const controller = new MapMotionController(map);
    const target = { type: "citywide", bounds: citywideBounds } as const;
    const resolved = getDefaultCitywideCamera(map, citywideBounds, false)!;

    controller.setTarget(target, { directoryCollapsed: false, immediate: true });

    expect(controller.getSnapshot()).toMatchObject({ durationMs: 0, revision: 1, target: resolved });
    expect(map.setView).toHaveBeenCalledTimes(1);
    expect(map.setView).toHaveBeenCalledWith(resolved.center, resolved.zoom, { animate: false });
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
  it("contains no custom frame driver or private Leaflet movement calls", () => {
    const cameraSource = readFileSync(new URL("./mapCamera.ts", import.meta.url), "utf8");

    expect(cameraSource).not.toContain("requestAnimationFrame");
    expect(cameraSource).not.toMatch(/\._move(?:Start|End)?\(/);
    expect(cameraSource).not.toContain("latLngToContainerPoint");
    expect(cameraSource).not.toContain("this.map.flyTo(");
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

  it("does not invalidate a map whose absolute directory overlay never changes its dimensions", () => {
    const componentSource = readFileSync(new URL("../components/AdminEnterpriseMap.tsx", import.meta.url), "utf8");

    expect(componentSource).not.toContain("invalidateSize");
    expect(componentSource).not.toContain("isAnimating");
    expect(componentSource).not.toContain("isTransitioning");
  });

  it("keeps the map hidden until the canonical initial camera has been applied", () => {
    const componentSource = readFileSync(new URL("../components/AdminEnterpriseMap.tsx", import.meta.url), "utf8");

    expect(componentSource).not.toContain("sanPedroFallbackCenter");
    expect(componentSource).not.toContain("sanPedroRelaxedFallbackBounds");
    expect(componentSource).toContain("initializedMapInstanceRef.current !== map");
    expect(componentSource).toContain('visibility: isInitialCameraReady ? "visible" : "hidden"');
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
});
