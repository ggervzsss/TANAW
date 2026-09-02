import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { MapEnterprise } from "@/shared/types";
import {
  createBoundaryPopupHtml,
  createBoundaryTooltipHtml,
  getActiveBoundaryStyle,
  getBarangayForPoint,
  getBarangayLabel,
  getBaseBoundaryStyle,
  getCurrentLeafletMapTheme,
  getDimmedBoundaryStyle,
  getHoverBoundaryStyle,
  MapMotionController,
  mountLeafletThemeLayer,
  normalizeBarangayName,
  shouldClearBarangayFromMapClick,
  type GeoJsonFeatureCollection,
  type LeafletMapTheme,
  type MapDeselectReason,
  type MapInteractionAction,
  type MapInteractionState,
} from "../utils";
import { useEnterpriseMarkers } from "./useEnterpriseMarkers";
import { useMapCameraSync } from "./useMapCameraSync";

type AdminLeafletMapOptions = {
  boundary: GeoJsonFeatureCollection | null;
  dispatchMapInteraction: Dispatch<MapInteractionAction>;
  hoveredEnterpriseId: string | null;
  interactionState: MapInteractionState;
  isDirectoryCollapsed: boolean;
  mapEnterprises: MapEnterprise[];
  showBoundaries: boolean;
  visibleEnterprises: MapEnterprise[];
};

export function useAdminLeafletMap({
  boundary,
  dispatchMapInteraction,
  hoveredEnterpriseId,
  interactionState,
  isDirectoryCollapsed,
  mapEnterprises,
  showBoundaries,
  visibleEnterprises,
}: AdminLeafletMapOptions) {
  const { cameraTarget, selectedBarangayName, selectedEnterpriseId } = interactionState;
  const mapRef = useRef<L.Map | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const activeBoundaryRef = useRef<L.Path | null>(null);
  const citywideBoundsRef = useRef<L.LatLngBounds | null>(null);
  const barangayBoundsRef = useRef<Map<string, L.LatLngBounds>>(new Map());
  const mapMotionControllerRef = useRef<MapMotionController | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const selectedBarangayNameRef = useRef<string | null>(null);
  const initializedMapInstanceRef = useRef<L.Map | null>(null);
  const lastCameraCommandKeyRef = useRef<string | null>(null);
  const [isInitialCameraReady, setIsInitialCameraReady] = useState(false);
  const [mapTheme, setMapTheme] = useState<LeafletMapTheme>(() => getCurrentLeafletMapTheme());

  const applyBoundarySelection = useCallback(
    (barangayName: string | null) => {
      const selectedKey = barangayName ? normalizeBarangayName(barangayName) : "";
      activeBoundaryRef.current = null;

      boundaryLayerRef.current?.getLayers().forEach((layer) => {
        if (!(layer instanceof L.Path)) return;
        if (!barangayName) {
          boundaryLayerRef.current?.resetStyle(layer);
          return;
        }

        const featureItem = "feature" in layer ? (layer.feature as GeoJSON.Feature | undefined) : undefined;
        if (normalizeBarangayName(getBarangayLabel(featureItem)) === selectedKey) {
          layer.setStyle(getActiveBoundaryStyle(mapTheme));
          activeBoundaryRef.current = layer;
          layer.bringToFront();
          return;
        }
        layer.setStyle(getDimmedBoundaryStyle(mapTheme));
      });
    },
    [mapTheme],
  );

  const findBoundaryLayerByName = useCallback((barangayName: string) => {
    const selectedKey = normalizeBarangayName(barangayName);
    return boundaryLayerRef.current?.getLayers().find((layer) => {
      if (!("feature" in layer)) return false;
      return normalizeBarangayName(getBarangayLabel(layer.feature as GeoJSON.Feature | undefined)) === selectedKey;
    }) as (L.Path & { feature?: GeoJSON.Feature }) | undefined;
  }, []);

  const closeBoundaryTooltips = useCallback(() => {
    boundaryLayerRef.current?.eachLayer((layer) => layer.closeTooltip());
  }, []);

  const selectBarangay = useCallback(
    (barangayName: string, layer?: L.Path) => {
      const targetLayer = layer ?? findBoundaryLayerByName(barangayName);
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = barangayName;
      dispatchMapInteraction({ type: "select-barangay", barangayName });
      applyBoundarySelection(barangayName);
      mapRef.current?.closePopup();
      targetLayer?.openTooltip();
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction, findBoundaryLayerByName],
  );

  const selectEnterprise = useCallback(
    (enterprise: MapEnterprise) => {
      const targetLayer = findBoundaryLayerByName(enterprise.barangay);
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = enterprise.barangay;
      dispatchMapInteraction({ type: "select-enterprise", barangayName: enterprise.barangay, enterpriseId: enterprise.id });
      applyBoundarySelection(enterprise.barangay);
      targetLayer?.openTooltip();
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction, findBoundaryLayerByName],
  );

  const clearBarangaySelection = useCallback(
    (reason: MapDeselectReason) => {
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = null;
      dispatchMapInteraction({ type: "clear-barangay", reason });
      applyBoundarySelection(null);
      mapRef.current?.closePopup();
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction],
  );

  const closeEnterpriseDetails = useCallback(() => {
    dispatchMapInteraction({ type: "close-enterprise" });
    mapRef.current?.closePopup();
  }, [dispatchMapInteraction]);

  const mapThemeRef = useRef(mapTheme);
  const showBoundariesRef = useRef(showBoundaries);
  const applyBoundarySelectionRef = useRef(applyBoundarySelection);
  const selectBarangayRef = useRef(selectBarangay);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
    showBoundariesRef.current = showBoundaries;
    applyBoundarySelectionRef.current = applyBoundarySelection;
    selectBarangayRef.current = selectBarangay;
  }, [applyBoundarySelection, mapTheme, selectBarangay, showBoundaries]);

  useEffect(() => {
    selectedBarangayNameRef.current = selectedBarangayName;
    applyBoundarySelection(selectedBarangayName);
  }, [applyBoundarySelection, selectedBarangayName]);

  useEffect(() => {
    if (!boundary || mapRef.current) return undefined;
    const map = L.map("admin-enterprise-map", { maxBoundsViscosity: 0.35, maxZoom: 18, minZoom: 11.2, zoomControl: false });
    mapRef.current = map;
    mapMotionControllerRef.current = new MapMotionController(map);
    map.createPane("boundaryPane");
    const boundaryPane = map.getPane("boundaryPane");
    if (boundaryPane) boundaryPane.style.zIndex = "410";
    const cleanupTileLayer = mountLeafletThemeLayer(map, setMapTheme);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    return () => {
      cleanupTileLayer();
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      activeBoundaryRef.current = null;
      citywideBoundsRef.current = null;
      barangayBoundsRef.current.clear();
      boundaryLayerRef.current?.remove();
      mapMotionControllerRef.current?.dispose();
      mapMotionControllerRef.current = null;
      initializedMapInstanceRef.current = null;
      lastCameraCommandKeyRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [boundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return undefined;
    const handleMapClick = (event: L.LeafletMouseEvent) => {
      const clickedBarangayName = getBarangayForPoint(boundary, event.latlng.lat, event.latlng.lng);
      if (shouldClearBarangayFromMapClick(selectedBarangayNameRef.current, clickedBarangayName)) clearBarangaySelection("map-background");
    };
    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [boundary, clearBarangaySelection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;
    boundaryLayerRef.current?.remove();
    activeBoundaryRef.current = null;
    const boundaryStyle: GeoJSONOptions["style"] = (feature) => getBaseBoundaryStyle(getBarangayLabel(feature), mapThemeRef.current, "boundaryPane", "admin");
    const onEachFeature: GeoJSONOptions["onEachFeature"] = (feature, layer: Layer) => {
      const name = getBarangayLabel(feature);
      layer.bindTooltip(createBoundaryTooltipHtml(name), { sticky: true, direction: "auto", opacity: 0.95 });
      layer.bindPopup(createBoundaryPopupHtml(feature), { closeButton: false });
      layer.on({
        mouseover: (event) => {
          const target = event.target as L.Path;
          target.setStyle(activeBoundaryRef.current === target ? getActiveBoundaryStyle(mapThemeRef.current) : getHoverBoundaryStyle(mapThemeRef.current));
          target.bringToFront();
        },
        mouseout: (event) => {
          const target = event.target as L.Path;
          if (activeBoundaryRef.current === target) target.setStyle(getActiveBoundaryStyle(mapThemeRef.current));
          else applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
        },
        click: (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          selectBarangayRef.current(name, event.target as L.Path);
        },
      });
    };
    const boundaryLayer = L.geoJSON(boundary, { style: boundaryStyle, onEachFeature });
    boundaryLayerRef.current = boundaryLayer;
    citywideBoundsRef.current = boundaryLayer.getBounds();
    barangayBoundsRef.current = new Map(
      boundaryLayer
        .getLayers()
        .filter((layer): layer is L.Polygon & { feature?: GeoJSON.Feature } => layer instanceof L.Polygon && "feature" in layer)
        .map((layer) => [normalizeBarangayName(getBarangayLabel(layer.feature)), layer.getBounds()]),
    );
    if (showBoundariesRef.current) boundaryLayer.addTo(map);
    applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
    if (selectedBarangayNameRef.current) findBoundaryLayerByName(selectedBarangayNameRef.current)?.openTooltip();

    return () => {
      boundaryLayer.remove();
      if (boundaryLayerRef.current === boundaryLayer) {
        boundaryLayerRef.current = null;
        citywideBoundsRef.current = null;
        barangayBoundsRef.current.clear();
      }
    };
  }, [boundary, findBoundaryLayerByName]);

  useEffect(() => {
    const map = mapRef.current;
    const boundaryLayer = boundaryLayerRef.current;
    if (!map || !boundaryLayer) return;
    if (showBoundaries) {
      if (!map.hasLayer(boundaryLayer)) boundaryLayer.addTo(map);
    } else if (map.hasLayer(boundaryLayer)) boundaryLayer.remove();
  }, [boundary, showBoundaries]);

  useEffect(() => {
    const boundaryLayer = boundaryLayerRef.current;
    if (!boundaryLayer) return;
    if (selectedBarangayName) applyBoundarySelection(selectedBarangayName);
    else boundaryLayer.setStyle((feature) => getBaseBoundaryStyle(getBarangayLabel(feature), mapTheme, "boundaryPane", "admin"));
  }, [applyBoundarySelection, boundary, mapTheme, selectedBarangayName]);

  const handleInitialCameraReady = useCallback(() => setIsInitialCameraReady(true), []);
  useMapCameraSync({
    barangayBoundsRef,
    boundary,
    boundaryLayerRef,
    cameraTarget,
    citywideBoundsRef,
    findBoundaryLayerByName,
    initializedMapInstanceRef,
    isDirectoryCollapsed,
    lastCameraCommandKeyRef,
    mapEnterprises,
    mapMotionControllerRef,
    mapRef,
    onReady: handleInitialCameraReady,
  });
  useEnterpriseMarkers({ hoveredEnterpriseId, mapRef, markersRef, mapTheme, onSelect: selectEnterprise, selectedEnterpriseId, visibleEnterprises });

  return { clearBarangaySelection, closeEnterpriseDetails, isInitialCameraReady, selectBarangay, selectEnterprise };
}
