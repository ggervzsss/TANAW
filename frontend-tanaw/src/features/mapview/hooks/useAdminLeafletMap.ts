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
  MapMotionController,
  normalizeBarangayName,
  shouldClearBarangayFromMapClick,
  type GeoJsonFeatureCollection,
  type LeafletMapTheme,
  type MapDeselectReason,
  type MapInteractionAction,
  type MapInteractionState,
} from "../utils";
import { getAdminBoundaryCasingStyle } from "../utils/enterpriseMapUtils";
import { mountAdminLeafletLayers } from "../utils/leafletTheme";
import { bindMapWheelZoom } from "../utils/mapWheelZoom";
import { prefersReducedMapMotion } from "../utils/mapCamera";
import { useEnterpriseMarkers } from "./useEnterpriseMarkers";
import { useEnterprisePreview } from "./useEnterprisePreview";
import { useMapCameraSync } from "./useMapCameraSync";

type AdminLeafletMapOptions = {
  boundary: GeoJsonFeatureCollection | null;
  dispatchMapInteraction: Dispatch<MapInteractionAction>;
  hoveredEnterpriseId: string | null;
  interactionState: MapInteractionState;
  mapEnterprises: MapEnterprise[];
  selectedEnterprise: MapEnterprise | null;
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
  mapEnterprises,
  selectedEnterprise,
  onViewDetails,
  showBoundaries,
  showLabels,
  visibleEnterprises,
}: AdminLeafletMapOptions) {
  const { cameraTarget, selectedBarangayName } = interactionState;
  const highlightedBarangay = selectedBarangayName ?? (cameraTarget.type === "enterprise" ? cameraTarget.barangayName : null);
  const mapRef = useRef<L.Map | null>(null);
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const boundaryCasingRef = useRef<L.GeoJSON | null>(null);
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
      boundaryCasingRef.current?.setStyle(getAdminBoundaryCasingStyle(mapTheme));

      const boundaryLayer = boundaryLayerRef.current;
      boundaryLayer?.getLayers().forEach((layer) => {
        if (!(layer instanceof L.Path)) return;
        const featureItem = "feature" in layer ? (layer.feature as GeoJSON.Feature | undefined) : undefined;
        const selected = selectedKey !== "" && normalizeBarangayName(getBarangayLabel(featureItem)) === selectedKey;
        layer.getElement()?.setAttribute("data-boundary-state", selected ? "selected" : selectedKey ? "muted" : "default");
        boundaryLayer.resetStyle(layer);
        if (selected) {
          layer.setStyle(getActiveBoundaryStyle(mapTheme));
          layer.bringToFront();
        } else if (selectedKey) {
          layer.setStyle(getDimmedBoundaryStyle(mapTheme));
        }
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
      targetLayer?.openTooltip();
    },
    [closeBoundaryTooltips, dispatchMapInteraction, findBoundaryLayerByName],
  );

  const selectEnterprise = useCallback(
    (enterprise: MapEnterprise) => {
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = enterprise.barangay;
      dispatchMapInteraction({ type: "select-enterprise", barangayName: enterprise.barangay, enterpriseId: enterprise.id });
    },
    [closeBoundaryTooltips, dispatchMapInteraction],
  );

  const clearBarangaySelection = useCallback(
    (reason: MapDeselectReason) => {
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = null;
      dispatchMapInteraction({ type: "clear-barangay", reason });
    },
    [closeBoundaryTooltips, dispatchMapInteraction],
  );

  const dismissEnterprisePreview = useCallback(
    (enterpriseId: string) => {
      dispatchMapInteraction({ type: "close-enterprise", enterpriseId });
      markersRef.current[enterpriseId]?.getElement()?.focus({ preventScroll: true });
    },
    [dispatchMapInteraction],
  );

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
      trackResize: false,
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      scrollWheelZoom: false,
      wheelPxPerZoomLevel: 120,
      zoomAnimation: !reducedMotion,
      zoomAnimationThreshold: 7,
      markerZoomAnimation: !reducedMotion,
      // Completed tile sets crossfade with the portal instead of fading in tile by tile.
      fadeAnimation: false,
    });
    mapRef.current = map;
    const motion = new MapMotionController(map);
    mapMotionControllerRef.current = motion;
    const unbindWheelZoom = bindMapWheelZoom(map, motion);
    map.createPane("boundaryPane");
    const boundaryPane = map.getPane("boundaryPane");
    if (boundaryPane) boundaryPane.style.zIndex = "410";
    const tileLayers = mountAdminLeafletLayers(map, setMapTheme);
    tileLayersRef.current = tileLayers;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const resize = new ResizeObserver(() => mapMotionControllerRef.current?.resize());
    resize.observe(map.getContainer());

    return () => {
      resize.disconnect();
      unbindWheelZoom();
      tileLayers.dispose();
      tileLayersRef.current = null;
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      citywideBoundsRef.current = null;
      barangayBoundsRef.current.clear();
      boundaryLayerRef.current?.remove();
      boundaryCasingRef.current?.remove();
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
    const boundaryStyle: GeoJSONOptions["style"] = (feature) => getBaseBoundaryStyle(getBarangayLabel(feature), mapThemeRef.current, "boundaryPane", "admin");
    const onEachFeature: GeoJSONOptions["onEachFeature"] = (feature, layer: Layer) => {
      const name = getBarangayLabel(feature);
      layer.bindTooltip(createBoundaryTooltipHtml(name), { sticky: true, direction: "auto", opacity: 0.95, className: "tanaw-barangay-tooltip" });
      layer.on({
        click: (event: L.LeafletMouseEvent) => {
          selectBarangayRef.current(name, event.target as L.Path);
        },
      });
    };
    const boundaryLayer = L.geoJSON(boundary, { style: boundaryStyle, onEachFeature, bubblingMouseEvents: false });
    // Both sets of paths belong to the same Leaflet SVG renderer and share its camera and clipping.
    const boundaryCasing = L.geoJSON(boundary, {
      pane: "boundaryPane",
      interactive: false,
      style: () => getAdminBoundaryCasingStyle(mapThemeRef.current),
    });
    boundaryLayerRef.current = boundaryLayer;
    boundaryCasingRef.current = boundaryCasing;
    citywideBoundsRef.current = boundaryLayer.getBounds();
    barangayBoundsRef.current = new Map(
      boundaryLayer
        .getLayers()
        .filter((layer): layer is L.Polygon & { feature?: GeoJSON.Feature } => layer instanceof L.Polygon && "feature" in layer)
        .map((layer) => [normalizeBarangayName(getBarangayLabel(layer.feature)), layer.getBounds()]),
    );
    if (showBoundariesRef.current) {
      boundaryCasing.addTo(map);
      boundaryLayer.addTo(map);
    }
    const styleMountedBoundaries = () => {
      applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
      if (selectedBarangayNameRef.current) findBoundaryLayerByName(selectedBarangayNameRef.current)?.openTooltip();
    };
    map.whenReady(styleMountedBoundaries);

    return () => {
      map.off("load", styleMountedBoundaries);
      boundaryLayer.remove();
      boundaryCasing.remove();
      if (boundaryLayerRef.current === boundaryLayer) {
        boundaryLayerRef.current = null;
        boundaryCasingRef.current = null;
        citywideBoundsRef.current = null;
        barangayBoundsRef.current.clear();
      }
    };
  }, [boundary, findBoundaryLayerByName]);

  useEffect(() => {
    const map = mapRef.current;
    const boundaryLayer = boundaryLayerRef.current;
    const boundaryCasing = boundaryCasingRef.current;
    if (!map || !boundaryLayer) return;
    if (showBoundaries) {
      if (!map.hasLayer(boundaryLayer)) {
        boundaryCasing?.addTo(map);
        boundaryLayer.addTo(map);
        applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
      }
    } else if (map.hasLayer(boundaryLayer)) {
      boundaryLayer.remove();
      boundaryCasing?.remove();
    }
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
    onDismiss: dismissEnterprisePreview,
    onViewDetails,
  });

  const fitCitywide = () => {
    const bounds = citywideBoundsRef.current;
    if (bounds) mapMotionControllerRef.current?.setTarget({ type: "citywide", bounds });
  };
  return { clearBarangaySelection, fitCitywide, isInitialCameraReady, selectBarangay, selectEnterprise };
}
