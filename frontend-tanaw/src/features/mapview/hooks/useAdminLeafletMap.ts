import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch } from "react";
import type { MapEnterprise } from "@/shared/types";
import {
  createBoundaryTooltipHtml,
  getActiveBoundaryStyle,
  getBarangayForPoint,
  getBarangayLabel,
  getBaseBoundaryStyle,
  getCurrentLeafletMapTheme,
  getDimmedBoundaryStyle,
  getHoverBoundaryStyle,
  MapMotionController,
  normalizeBarangayName,
  shouldClearBarangayFromMapClick,
  type GeoJsonFeatureCollection,
  type LeafletMapTheme,
  type MapDeselectReason,
  type MapInteractionAction,
  type MapInteractionState,
} from "../utils";
import { mountAdminLeafletLayers } from "../utils/leafletTheme";
import { prefersReducedMapMotion } from "../utils/mapCamera";
import { useEnterpriseMarkers } from "./useEnterpriseMarkers";
import { useEnterprisePreview } from "./useEnterprisePreview";
import { useMapCameraSync } from "./useMapCameraSync";

type AdminLeafletMapOptions = {
  boundary: GeoJsonFeatureCollection | null;
  dispatchMapInteraction: Dispatch<MapInteractionAction>;
  hoveredEnterpriseId: string | null;
  interactionState: MapInteractionState;
  isDirectoryCollapsed: boolean;
  isInsightsOpen: boolean;
  mapEnterprises: MapEnterprise[];
  selectedEnterprise: MapEnterprise | null;
  onSelectLocation: (selection: "barangay" | "enterprise") => void;
  onViewDetails: (enterpriseId: string) => void;
  showBoundaries: boolean;
  showLabels: boolean;
  visibleEnterprises: MapEnterprise[];
};

export function useAdminLeafletMap({
  boundary,
  dispatchMapInteraction,
  hoveredEnterpriseId,
  interactionState,
  isDirectoryCollapsed,
  isInsightsOpen,
  mapEnterprises,
  selectedEnterprise,
  onSelectLocation,
  onViewDetails,
  showBoundaries,
  showLabels,
  visibleEnterprises,
}: AdminLeafletMapOptions) {
  const { cameraTarget, selectedBarangayName } = interactionState;
  const highlightedBarangay = selectedBarangayName ?? (cameraTarget.type === "enterprise" ? cameraTarget.barangayName : null);
  const mapRef = useRef<L.Map | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const activeBoundaryRef = useRef<L.Path | null>(null);
  const citywideBoundsRef = useRef<L.LatLngBounds | null>(null);
  const barangayBoundsRef = useRef<Map<string, L.LatLngBounds>>(new Map());
  const mapMotionControllerRef = useRef<MapMotionController | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const selectedBarangayNameRef = useRef<string | null>(null);
  const initializedMapInstanceRef = useRef<L.Map | null>(null);
  const lastCameraTargetRef = useRef<MapInteractionState["cameraTarget"] | null>(null);
  const tileLayersRef = useRef<ReturnType<typeof mountAdminLeafletLayers> | null>(null);
  const [isInitialCameraReady, setIsInitialCameraReady] = useState(false);
  const [mapTheme, setMapTheme] = useState<LeafletMapTheme>(() => getCurrentLeafletMapTheme());

  const applyBoundarySelection = useCallback(
    (barangayName: string | null) => {
      const selectedKey = barangayName ? normalizeBarangayName(barangayName) : "";
      activeBoundaryRef.current = null;

      const boundaryLayer = boundaryLayerRef.current;
      boundaryLayer?.getLayers().forEach((layer) => {
        if (!(layer instanceof L.Path)) return;
        boundaryLayer.resetStyle(layer);
        if (!barangayName) return;

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
      onSelectLocation("barangay");
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = barangayName;
      dispatchMapInteraction({ type: "select-barangay", barangayName });
      applyBoundarySelection(barangayName);
      targetLayer?.openTooltip();
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction, findBoundaryLayerByName, onSelectLocation],
  );

  const selectEnterprise = useCallback(
    (enterprise: MapEnterprise) => {
      onSelectLocation("enterprise");
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = enterprise.barangay;
      dispatchMapInteraction({ type: "select-enterprise", barangayName: enterprise.barangay, enterpriseId: enterprise.id });
      applyBoundarySelection(enterprise.barangay);
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction, onSelectLocation],
  );

  const clearBarangaySelection = useCallback(
    (reason: MapDeselectReason) => {
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = null;
      dispatchMapInteraction({ type: "clear-barangay", reason });
      applyBoundarySelection(null);
    },
    [applyBoundarySelection, closeBoundaryTooltips, dispatchMapInteraction],
  );

  const dismissEnterprisePreview = useCallback((enterpriseId: string) => {
    dispatchMapInteraction({ type: "close-enterprise", enterpriseId });
    markersRef.current[enterpriseId]?.getElement()?.focus({ preventScroll: true });
  }, [dispatchMapInteraction]);

  const mapThemeRef = useRef(mapTheme);
  const showBoundariesRef = useRef(showBoundaries);
  const applyBoundarySelectionRef = useRef(applyBoundarySelection);
  const selectBarangayRef = useRef(selectBarangay);

  useLayoutEffect(() => {
    mapThemeRef.current = mapTheme;
    showBoundariesRef.current = showBoundaries;
    applyBoundarySelectionRef.current = applyBoundarySelection;
    selectBarangayRef.current = selectBarangay;
  }, [applyBoundarySelection, mapTheme, selectBarangay, showBoundaries]);

  useLayoutEffect(() => {
    if (!boundary || mapRef.current) return undefined;
    const reducedMotion = prefersReducedMapMotion();
    const map = L.map("admin-enterprise-map", {
      maxBoundsViscosity: 0.35,
      maxZoom: 18,
      minZoom: 11.2,
      zoomControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      wheelPxPerZoomLevel: 90,
      zoomAnimation: !reducedMotion,
      zoomAnimationThreshold: 7,
      markerZoomAnimation: !reducedMotion,
      // Completed tile sets crossfade with the portal instead of fading in tile by tile.
      fadeAnimation: false,
    });
    mapRef.current = map;
    mapMotionControllerRef.current = new MapMotionController(map);
    map.createPane("boundaryPane");
    const boundaryPane = map.getPane("boundaryPane");
    if (boundaryPane) boundaryPane.style.zIndex = "410";
    const tileLayers = mountAdminLeafletLayers(map, setMapTheme);
    tileLayersRef.current = tileLayers;
    L.control.zoom({ position: "bottomright" }).addTo(map);

    return () => {
      tileLayers.dispose();
      tileLayersRef.current = null;
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      activeBoundaryRef.current = null;
      citywideBoundsRef.current = null;
      barangayBoundsRef.current.clear();
      boundaryLayerRef.current?.remove();
      mapMotionControllerRef.current?.dispose();
      mapMotionControllerRef.current = null;
      initializedMapInstanceRef.current = null;
      lastCameraTargetRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [boundary]);

  useLayoutEffect(() => {
    tileLayersRef.current?.setLabelsVisible(showLabels);
  }, [boundary, showLabels]);

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
      layer.bindTooltip(createBoundaryTooltipHtml(name), { sticky: true, direction: "auto", opacity: 0.95, className: "tanaw-barangay-tooltip" });
      layer.on({
        mouseover: (event) => {
          const target = event.target as L.Path;
          target.setStyle(activeBoundaryRef.current === target ? getActiveBoundaryStyle(mapThemeRef.current) : getHoverBoundaryStyle(mapThemeRef.current));
          target.bringToFront();
        },
        mouseout: (event) => {
          const target = event.target as L.Path;
          const theme = mapThemeRef.current;
          if (activeBoundaryRef.current === target) {
            target.setStyle(getActiveBoundaryStyle(theme));
          } else {
            boundaryLayerRef.current?.resetStyle(target);
            if (selectedBarangayNameRef.current) target.setStyle(getDimmedBoundaryStyle(theme));
            activeBoundaryRef.current?.bringToFront();
          }
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

  useLayoutEffect(() => {
    selectedBarangayNameRef.current = highlightedBarangay;
    applyBoundarySelection(highlightedBarangay);
  }, [applyBoundarySelection, highlightedBarangay]);

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
    isInsightsOpen,
    lastCameraTargetRef,
    mapEnterprises,
    mapMotionControllerRef,
    mapRef,
    onReady: handleInitialCameraReady,
  });
  useEnterpriseMarkers({
    focusedEnterpriseId: cameraTarget.type === "enterprise" ? cameraTarget.enterpriseId : null,
    hoveredEnterpriseId,
    mapRef,
    markersRef,
    onSelect: selectEnterprise,
    visibleEnterprises,
  });
  useEnterprisePreview({
    enterprise: selectedEnterprise,
    mapRef,
    motionRef: mapMotionControllerRef,
    directoryCollapsed: isDirectoryCollapsed,
    insightsOpen: isInsightsOpen,
    onDismiss: dismissEnterprisePreview,
    onViewDetails,
  });

  const fitCitywide = () => {
    const bounds = citywideBoundsRef.current;
    if (bounds) mapMotionControllerRef.current?.setTarget({ type: "citywide", bounds }, { directoryCollapsed: isDirectoryCollapsed, insightsOpen: isInsightsOpen });
  };
  return { clearBarangaySelection, fitCitywide, isInitialCameraReady, selectBarangay, selectEnterprise };
}
