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
  MAP_PIN_ICON_PATHS,
  MAP_PIN_STATES,
  mapPinColors,
  mapPinStateLabels,
  normalizeBarangayName,
} from "./utils";
export type { GeoJsonFeatureCollection, MapInteractionState, MapPinState } from "./utils";
