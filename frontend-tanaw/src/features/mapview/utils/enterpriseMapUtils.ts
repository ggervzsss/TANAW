import L from "leaflet";
import type { AccountSummary } from "@/shared/services/accountManagement";
import type { EnterpriseStatus, GatewayStatus, MapEnterprise } from "@/shared/types";

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

export function toMapEnterprise(account: AccountSummary): MapEnterprise | null {
  if (account.latitude === null || account.longitude === null) return null;

  return {
    id: account.id,
    name: account.enterpriseName ?? account.displayName,
    barangay: account.barangay ?? "Unassigned",
    category: account.category ?? "Uncategorized",
    fullAddress: account.address ?? account.geocodedAddress ?? "Address not provided",
    lat: account.latitude,
    lng: account.longitude,
    totalLiveOccupancy: 0,
    estimatedUniqueCount: 0,
    status: getEnterpriseMapStatus(account),
    contact: account.phone ?? account.email,
    lastSync: account.locationUpdatedAt ? new Date(account.locationUpdatedAt).toLocaleString() : undefined,
    gatewayStatus: getGatewayStatus(account.gatewayStatus),
  };
}

function getEnterpriseMapStatus(account: AccountSummary): EnterpriseStatus {
  if (account.status === "inactive") return "Warning";
  return "Normal";
}

function getGatewayStatus(value: string | null): GatewayStatus {
  const statuses: GatewayStatus[] = ["Connected", "Sync Delayed", "Offline", "Not Linked", "Closed"];
  return statuses.find((status) => status === value) ?? "Not Linked";
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
  return `<div style="font-family:Bai Jamjuree,sans-serif;font-size:11px;font-weight:800;color:#2a3063;padding:2px 4px;text-transform:uppercase;">${escapeHtml(name)}</div>`;
}

export function createBoundaryPopupHtml(featureItem: GeoJSON.Feature) {
  const name = escapeHtml(getBarangayLabel(featureItem));
  const type = escapeHtml(getFeatureValue(featureItem, ["type"], "barangay"));
  const postalCode = escapeHtml(getFeatureValue(featureItem, ["postal_code", "addr:postcode"], "4023"));

  return `<div style="font-family:Bai Jamjuree,sans-serif;min-width:190px;padding:4px;"><h3 style="margin:0 0 2px;color:#2a3063;font-weight:800;font-size:13px;">${name}</h3><p style="margin:0 0 8px;font-size:9px;color:#666;text-transform:uppercase;letter-spacing:1px;">San Pedro, Laguna ${postalCode}</p><span style="font-size:9px;color:#055b25;font-weight:800;padding:2px 5px;border:1px solid #055b25;border-radius:3px;text-transform:uppercase;">${type} boundary</span></div>`;
}

export function createTooltipHtml(enterprise: MapEnterprise, color: string) {
  const occupancyShare = Math.min(100, Math.round((enterprise.totalLiveOccupancy / Math.max(1, enterprise.estimatedUniqueCount)) * 100));

  return `<div style="font-family:Bai Jamjuree,sans-serif;min-width:140px;"><h4 style="margin:0;font-size:11px;font-weight:800;color:#2a3063;">${escapeHtml(enterprise.name)}</h4><p style="margin:2px 0 0;font-size:9px;color:#666;text-transform:uppercase;">${escapeHtml(enterprise.category)} - ${escapeHtml(enterprise.barangay)}</p><div style="margin-top:5px;height:4px;background:#e5e5e5;border-radius:2px;"><div style="height:100%;width:${occupancyShare}%;background:${color};border-radius:2px;"></div></div></div>`;
}

export function createPopupHtml(enterprise: MapEnterprise, color: string) {
  return `<div style="font-family:Bai Jamjuree,sans-serif;min-width:220px;padding:4px;"><h3 style="margin:0 0 2px;color:#2a3063;font-weight:800;font-size:13px;">${escapeHtml(enterprise.name)}</h3><p style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(enterprise.category)} - ${escapeHtml(enterprise.barangay)}</p><p style="font-size:10px;color:#2a3063;font-weight:800;">${enterprise.totalLiveOccupancy.toLocaleString()} live occupancy | ${enterprise.estimatedUniqueCount.toLocaleString()} est. unique</p><span style="font-size:9px;color:${color};font-weight:800;padding:2px 4px;border:1px solid ${color};border-radius:2px;text-transform:uppercase;">${enterprise.status}</span></div>`;
}
