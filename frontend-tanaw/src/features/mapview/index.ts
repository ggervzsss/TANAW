/*
 * The admin map: San Pedro's barangay boundaries on Leaflet tiles, enterprise pins and the camera
 * that moves between the city, a barangay and an enterprise. The Admin Dashboard renders it.
 */
export { useAdminLeafletMap, useSanPedroBoundary } from "./hooks";
export {
  getBarangayLabel,
  getMapPinState,
  initialMapInteractionState,
  isBoundaryPolygonFeature,
  isPointInsideSanPedro,
  mapInteractionReducer,
  mapPinColors,
  mapPinStateLabels,
  normalizeBarangayName,
} from "./utils";
export type { GeoJsonFeatureCollection, MapInteractionState, MapPinState } from "./utils";
