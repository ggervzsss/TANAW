import L from "leaflet";
import type { EnterpriseStatus, MapEnterprise } from "@/shared/types";
import type { LeafletMapTheme } from "./leafletTheme";

export type GeoJsonFeatureCollection = GeoJSON.FeatureCollection;

export type BarangayPointResolution = {
  barangayName: string | null;
  isAmbiguous: boolean;
  matchCount: number;
};

type BarangayPointMatch = {
  area: number;
  featureItem: GeoJSON.Feature;
  index: number;
  label: string;
};

export const SAN_PEDRO_BARANGAYS_URL = "/data/san_pedro_barangays_clean_v4.geojson";

export const sanPedroFallbackCenter: L.LatLngTuple = [14.3413, 121.0446];

export const sanPedroRelaxedFallbackBounds: L.LatLngBoundsExpression = [
  [14.235, 120.945],
  [14.418, 121.131],
];

const barangayColors: Record<string, string> = {
  bagongsilang: "#C7E9F1",
  bayanbayanan: "#A6D8A8",
  calendola: "#BDE0B0",
  chrysanthemum: "#F6F1D1",
  cuyab: "#BDE0B0",
  estrella: "#C7E9F1",
  fatima: "#F6F1D1",
  gsis: "#B5D1FF",
  landayan: "#D8C9A7",
  langgam: "#FFC8A2",
  laram: "#B5D1FF",
  magsaysay: "#DCCCF5",
  maharlika: "#A2D9A1",
  narra: "#D8C9A7",
  nueva: "#C7E9F1",
  pacita1: "#DE802B",
  pacita2: "#A2D9A1",
  poblacion: "#F6F1D1",
  rosario: "#C084FC",
  riverside: "#BDE0B0",
  sampaguita: "#DCCCF5",
  sanantonio: "#5C6F2B",
  sanlorenzo: "#93C5FD",
  sanroque: "#B5D1FF",
  sanvicente: "#FFC8A2",
  santonino: "#FFD200",
  unitedbayanihan: "#A2D9A1",
  unitedbetterliving: "#B5D1FF",
};

const fallbackBarangayColors = ["#A2D9A1", "#F6F1D1", "#B5D1FF", "#FFC8A2", "#DCCCF5", "#C7E9F1"];

const barangayFilterAliases: Record<string, string> = {
  brgypacitai: "pacita1",
  brgypacitaii: "pacita2",
  pacitai: "pacita1",
  pacitaone: "pacita1",
  pacitaii: "pacita2",
  pacitatwo: "pacita2",
  sanlorenzoruiz: "sanlorenzo",
};

export const activeBoundaryStyle: L.PathOptions = {
  color: "#4f7cff",
  fillOpacity: 0.62,
  opacity: 0.94,
  weight: 2.6,
};

export const dimmedBoundaryStyle: L.PathOptions = {
  color: "#2a3063",
  fillOpacity: 0.26,
  opacity: 0.68,
  weight: 1.05,
};

export const hoverBoundaryStyle: L.PathOptions = {
  color: "#d7e4ff",
  fillOpacity: 0.58,
  opacity: 0.92,
  weight: 2,
};

export function getBaseBoundaryStyle(name: string, theme: LeafletMapTheme, pane: string, variant: "admin" | "location" = "admin"): L.PathOptions {
  const isDark = theme === "dark";
  const isAdmin = variant === "admin";

  return {
    color: isDark ? "#9ee7c0" : "#2a3063",
    weight: isAdmin ? 1.15 : 1,
    opacity: isDark ? 0.94 : isAdmin ? 0.86 : 0.78,
    fillColor: getGeoJsonColor(name),
    fillOpacity: isDark ? (isAdmin ? 0.3 : 0.24) : isAdmin ? 0.48 : 0.34,
    pane,
    className: `${isAdmin ? "tanaw-boundary-path" : "tanaw-location-boundary-path"} outline-none`,
  };
}

export function getActiveBoundaryStyle(theme: LeafletMapTheme): L.PathOptions {
  if (theme === "dark") {
    return {
      color: "#93c5fd",
      fillOpacity: 0.46,
      opacity: 0.98,
      weight: 2.6,
    };
  }

  return activeBoundaryStyle;
}

export function getDimmedBoundaryStyle(theme: LeafletMapTheme): L.PathOptions {
  if (theme === "dark") {
    return {
      color: "#64748b",
      fillOpacity: 0.12,
      opacity: 0.62,
      weight: 1.05,
    };
  }

  return dimmedBoundaryStyle;
}

export function getHoverBoundaryStyle(theme: LeafletMapTheme): L.PathOptions {
  if (theme === "dark") {
    return {
      color: "#e0f2fe",
      fillOpacity: 0.42,
      opacity: 0.96,
      weight: 2,
    };
  }

  return hoverBoundaryStyle;
}

export function normalizeGeoJson(payload: GeoJsonFeatureCollection): GeoJsonFeatureCollection {
  return {
    ...payload,
    features: payload.features.map((featureItem) => {
      if (featureItem.geometry?.type !== "MultiPolygon" || !isPolygonCoordinates(featureItem.geometry.coordinates)) {
        return featureItem;
      }

      const coordinates = (featureItem.geometry.coordinates as unknown as GeoJSON.Position[][]).map((ring): GeoJSON.Position[][] => [ring]);

      return {
        ...featureItem,
        geometry: {
          ...featureItem.geometry,
          coordinates,
        },
      };
    }),
  };
}

function isPosition(value: unknown): value is GeoJSON.Position {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

function isPolygonCoordinates(coordinates: unknown): coordinates is GeoJSON.Position[][] {
  return Array.isArray(coordinates) && coordinates.length > 0 && Array.isArray(coordinates[0]) && isPosition(coordinates[0][0]);
}

export function isBoundaryPolygonFeature(featureItem: GeoJSON.Feature) {
  return featureItem.geometry?.type === "Polygon" || featureItem.geometry?.type === "MultiPolygon";
}

export function normalizeBarangayName(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bbarangay\b/g, "")
    .replace(/\bbrgy\b/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]/g, "");

  return barangayFilterAliases[normalized] ?? normalized;
}

export function getGeoJsonColor(name: string) {
  const normalized = normalizeBarangayName(name);
  const mappedColor = barangayColors[normalized];
  if (mappedColor) return mappedColor;

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }

  return fallbackBarangayColors[Math.abs(hash) % fallbackBarangayColors.length];
}

export function getFeatureValue(featureItem: GeoJSON.Feature | undefined, keys: string[], fallback = "") {
  const properties = featureItem?.properties;
  if (!properties) return fallback;

  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

export function getBarangayLabel(featureItem: GeoJSON.Feature | undefined) {
  return getFeatureValue(featureItem, ["display_name", "official_barangay", "name", "alt_name"], "Unnamed Barangay");
}

export function getEnterprisesByBarangay(enterprises: MapEnterprise[], barangayName: string) {
  const selectedKey = normalizeBarangayName(barangayName);
  return enterprises.filter((enterprise) => normalizeBarangayName(enterprise.barangay) === selectedKey);
}

export function isPointInsideRelaxedSanPedroBounds(latitude: number, longitude: number) {
  const [[south, west], [north, east]] = sanPedroRelaxedFallbackBounds as [L.LatLngTuple, L.LatLngTuple];
  return Number.isFinite(latitude) && Number.isFinite(longitude) && south <= latitude && latitude <= north && west <= longitude && longitude <= east;
}

export function getBarangayFeatureForPoint(boundary: GeoJsonFeatureCollection | null | undefined, latitude: number, longitude: number) {
  return getBarangayMatchesForPoint(boundary, latitude, longitude)[0]?.featureItem ?? null;
}

export function getBarangayForPoint(boundary: GeoJsonFeatureCollection | null | undefined, latitude: number, longitude: number) {
  return getBarangayPointResolution(boundary, latitude, longitude).barangayName;
}

export function getBarangayPointResolution(boundary: GeoJsonFeatureCollection | null | undefined, latitude: number, longitude: number): BarangayPointResolution {
  const matches = getBarangayMatchesForPoint(boundary, latitude, longitude);
  return {
    barangayName: matches[0]?.label ?? null,
    isAmbiguous: matches.length > 1,
    matchCount: matches.length,
  };
}

export function isPointInsideSanPedro(boundary: GeoJsonFeatureCollection | null | undefined, latitude: number, longitude: number) {
  if (!isPointInsideRelaxedSanPedroBounds(latitude, longitude)) return false;
  if (!boundary) return true;
  return Boolean(getBarangayFeatureForPoint(boundary, latitude, longitude));
}

function featureContainsPoint(featureItem: GeoJSON.Feature, latitude: number, longitude: number) {
  const geometry = featureItem.geometry;
  if (!geometry) return false;

  const point: [number, number] = [longitude, latitude];

  if (geometry.type === "Polygon") {
    return polygonContainsPoint(geometry.coordinates, point);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point));
  }

  return false;
}

function getBarangayMatchesForPoint(boundary: GeoJsonFeatureCollection | null | undefined, latitude: number, longitude: number) {
  if (!boundary || !isPointInsideRelaxedSanPedroBounds(latitude, longitude)) return [];

  return boundary.features
    .map((featureItem, index): BarangayPointMatch | null => {
      if (!isBoundaryPolygonFeature(featureItem) || !featureContainsPoint(featureItem, latitude, longitude)) return null;
      return {
        area: featureArea(featureItem),
        featureItem,
        index,
        label: getFeatureValue(featureItem, ["display_name", "name", "official_barangay", "alt_name"], getBarangayLabel(featureItem)),
      };
    })
    .filter((match): match is BarangayPointMatch => match !== null)
    .sort((left, right) => left.area - right.area || left.label.localeCompare(right.label) || left.index - right.index);
}

function featureArea(featureItem: GeoJSON.Feature) {
  const geometry = featureItem.geometry;
  if (!geometry) return Number.POSITIVE_INFINITY;

  if (geometry.type === "Polygon") {
    return polygonArea(geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((total, polygon) => total + polygonArea(polygon), 0);
  }

  return Number.POSITIVE_INFINITY;
}

function polygonArea(polygon: GeoJSON.Position[][]) {
  const [outerRing, ...holes] = polygon;
  if (!outerRing) return Number.POSITIVE_INFINITY;
  const holeArea = holes.reduce((total, hole) => total + ringArea(hole), 0);
  return Math.max(0, ringArea(outerRing) - holeArea);
}

function ringArea(ring: GeoJSON.Position[]) {
  let area = 0;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (!isPosition(current) || !isPosition(previous)) continue;

    area += previous[0] * current[1] - current[0] * previous[1];
  }

  return Math.abs(area) / 2;
}

function polygonContainsPoint(polygon: GeoJSON.Position[][], point: [number, number]) {
  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(point, outerRing)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function pointInRing([pointLng, pointLat]: [number, number], ring: GeoJSON.Position[]) {
  let inside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (!isPosition(current) || !isPosition(previous)) continue;

    const [currentLng, currentLat] = current;
    const [previousLng, previousLat] = previous;
    const crossesLatitude = currentLat > pointLat !== previousLat > pointLat;
    const intersectionLng = ((previousLng - currentLng) * (pointLat - currentLat)) / (previousLat - currentLat || Number.EPSILON) + currentLng;

    if (crossesLatitude && pointLng < intersectionLng) {
      inside = !inside;
    }
  }

  return inside;
}

export function fitMapToSanPedroBounds(map: L.Map, layer: L.GeoJSON | null) {
  if (!layer) return;

  const bounds = layer.getBounds();
  if (!bounds.isValid()) return;

  const initialViewBounds = bounds.pad(0.36);
  const interactionBounds = bounds.pad(1.05);
  const minZoomReferenceBounds = bounds.pad(0.62);

  map.setMaxBounds(interactionBounds);
  map.setMinZoom(Math.max(11.2, map.getBoundsZoom(minZoomReferenceBounds, true) - 0.72));
  map.fitBounds(initialViewBounds, {
    maxZoom: 13.45,
    padding: [48, 48],
  });
}

export function getEnterpriseStatusColor(status: EnterpriseStatus | "No Data") {
  if (status === "Critical") return "#a40e0e";
  if (status === "Warning") return "#ff6204";
  if (status === "Normal") return "#055b25";
  return "#64748b";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

export function createBoundaryTooltipHtml(name: string) {
  return `<div class="tanaw-map-tooltip tanaw-map-tooltip--boundary">${escapeHtml(name)}</div>`;
}

export function createBoundaryPopupHtml(featureItem: GeoJSON.Feature) {
  const name = escapeHtml(getBarangayLabel(featureItem));
  const type = escapeHtml(getFeatureValue(featureItem, ["type"], "barangay"));
  const postalCode = escapeHtml(getFeatureValue(featureItem, ["postal_code", "addr:postcode"], "4023"));

  return `<div class="tanaw-map-popup"><h3 class="tanaw-map-popup__title">${name}</h3><p class="tanaw-map-popup__meta">San Pedro, Laguna ${postalCode}</p><span class="tanaw-map-popup__badge">${type} boundary</span></div>`;
}

export function createTooltipHtml(enterprise: MapEnterprise, color: string) {
  const occupancyShare =
    enterprise.totalLiveOccupancy === null || enterprise.estimatedUniqueCount === null
      ? 0
      : Math.min(100, Math.round((enterprise.totalLiveOccupancy / Math.max(1, enterprise.estimatedUniqueCount)) * 100));

  return `<div class="tanaw-map-tooltip"><h4 class="tanaw-map-tooltip__title">${escapeHtml(enterprise.name)}</h4><p class="tanaw-map-tooltip__meta">${escapeHtml(enterprise.category)} - ${escapeHtml(enterprise.barangay)}</p><div class="tanaw-map-tooltip__meter"><div class="tanaw-map-tooltip__meter-fill" style="width:${occupancyShare}%;background:${color};"></div></div></div>`;
}

export function createPopupHtml(enterprise: MapEnterprise, color: string) {
  const occupancy = enterprise.totalLiveOccupancy === null ? "Not available" : enterprise.totalLiveOccupancy.toLocaleString();
  const unique = enterprise.estimatedUniqueCount === null ? "Not available" : enterprise.estimatedUniqueCount.toLocaleString();
  return `<div class="tanaw-map-popup"><h3 class="tanaw-map-popup__title">${escapeHtml(enterprise.name)}</h3><p class="tanaw-map-popup__meta">${escapeHtml(enterprise.category)} - ${escapeHtml(enterprise.barangay)}</p><p class="tanaw-map-popup__metric">${occupancy} live occupancy | ${unique} est. unique</p><span class="tanaw-map-popup__status" style="color:${color};border-color:${color};">${enterprise.status}</span></div>`;
}
