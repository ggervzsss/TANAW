import L, { type GeoJSONOptions, type Layer } from "leaflet";
import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import { useOperationalMapEnterprises } from "@/shared/hooks/useOperationalSync";
import type { AccountSummary, MapEnterprise, VisitorInsightRange } from "@/shared/types";
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
  initialMapInteractionState,
  MapMotionController,
  mapInteractionReducer,
  mountLeafletThemeLayer,
  normalizeBarangayName,
  shouldClearBarangayFromMapClick,
  type LeafletMapTheme,
  type MapDeselectReason,
} from "../utils";
import { useEnterpriseMarkers, useMapCameraSync, useMapDirectoryData, useSanPedroBoundary } from "../hooks";
import { AdminMapDirectory } from "./AdminMapDirectory";
import { AdminMapInsights } from "./AdminMapInsights";
import { EnterpriseDetailsModal } from "./EnterpriseDetailsModal";
import { MapToolRail } from "./MapToolRail";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_MAP_ENTERPRISES: MapEnterprise[] = [];

export function AdminEnterpriseMap() {
  const mapContainerId = "admin-enterprise-map";
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

  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const [isInitialCameraReady, setIsInitialCameraReady] = useState(false);
  const [isDirectoryCollapsed, setIsDirectoryCollapsed] = useState(false);
  const [hoveredEnterpriseId, setHoveredEnterpriseId] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [mapInteractionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<VisitorInsightRange>("7d");
  const [mapTheme, setMapTheme] = useState<LeafletMapTheme>(() => getCurrentLeafletMapTheme());
  const { cameraTarget, insightEnterpriseId, selectedBarangayName, selectedEnterpriseId } = mapInteractionState;
  const token = useAuthStore((state) => state.token);
  const enterpriseAccountsQuery = useQuery({ queryKey: [...enterpriseAccountsQueryKey, token], queryFn: listEnterpriseAccounts, enabled: Boolean(token) });
  const mapEnterprisesQuery = useOperationalMapEnterprises();
  const enterpriseAccounts = enterpriseAccountsQuery.data ?? EMPTY_ENTERPRISE_ACCOUNTS;
  const rawMapEnterprises = mapEnterprisesQuery.data ?? EMPTY_MAP_ENTERPRISES;
  const {
    barangayDropdownOptions,
    boundaryFeatureCount,
    mapEnterprises,
    selectedBarangayEnterprises,
    selectedBarangayUnpinnedEnterprises,
    selectedEnterprise,
    unpinnedEnterprises,
    visibleEnterprises,
  } = useMapDirectoryData({ boundary, enterpriseAccounts, rawMapEnterprises, selectedBarangayName, selectedEnterpriseId });

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
        const layerKey = normalizeBarangayName(getBarangayLabel(featureItem));

        if (layerKey === selectedKey) {
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

      const featureItem = layer.feature as GeoJSON.Feature | undefined;
      return normalizeBarangayName(getBarangayLabel(featureItem)) === selectedKey;
    }) as (L.Path & { feature?: GeoJSON.Feature }) | undefined;
  }, []);

  const closeBoundaryTooltips = useCallback(() => {
    boundaryLayerRef.current?.eachLayer((boundaryLayer) => {
      boundaryLayer.closeTooltip();
    });
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
    [applyBoundarySelection, closeBoundaryTooltips, findBoundaryLayerByName],
  );

  const selectEnterprise = useCallback(
    (enterprise: MapEnterprise) => {
      const targetLayer = findBoundaryLayerByName(enterprise.barangay);
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = enterprise.barangay;
      dispatchMapInteraction({
        type: "select-enterprise",
        barangayName: enterprise.barangay,
        enterpriseId: enterprise.id,
      });
      applyBoundarySelection(enterprise.barangay);
      targetLayer?.openTooltip();
    },
    [applyBoundarySelection, closeBoundaryTooltips, findBoundaryLayerByName],
  );

  const clearBarangaySelection = useCallback(
    (reason: MapDeselectReason) => {
      closeBoundaryTooltips();
      selectedBarangayNameRef.current = null;
      dispatchMapInteraction({ type: "clear-barangay", reason });
      applyBoundarySelection(null);
      mapRef.current?.closePopup();
    },
    [applyBoundarySelection, closeBoundaryTooltips],
  );

  const closeEnterpriseDetails = useCallback(() => {
    dispatchMapInteraction({ type: "close-enterprise" });
    mapRef.current?.closePopup();
  }, []);

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
    if (!selectedEnterprise) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEnterpriseDetails();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeEnterpriseDetails, selectedEnterprise]);

  useEffect(() => {
    selectedBarangayNameRef.current = selectedBarangayName;
    applyBoundarySelection(selectedBarangayName);
  }, [applyBoundarySelection, selectedBarangayName]);

  useEffect(() => {
    if (!boundary || mapRef.current) return undefined;

    const map = L.map(mapContainerId, {
      maxBoundsViscosity: 0.35,
      maxZoom: 18,
      minZoom: 11.2,
      zoomControl: false,
    });
    mapRef.current = map;
    mapMotionControllerRef.current = new MapMotionController(map);

    map.createPane("boundaryPane");
    const boundaryPane = map.getPane("boundaryPane");
    if (boundaryPane) {
      boundaryPane.style.zIndex = "410";
    }

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
      if (shouldClearBarangayFromMapClick(selectedBarangayNameRef.current, clickedBarangayName)) {
        clearBarangaySelection("map-background");
      }
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [boundary, clearBarangaySelection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;

    const previousBoundaryLayer = boundaryLayerRef.current;
    previousBoundaryLayer?.remove();
    activeBoundaryRef.current = null;

    const boundaryStyle: GeoJSONOptions["style"] = (geoFeature) => {
      const name = getBarangayLabel(geoFeature);
      return getBaseBoundaryStyle(name, mapThemeRef.current, "boundaryPane", "admin");
    };

    const onEachFeature: GeoJSONOptions["onEachFeature"] = (geoFeature, layer: Layer) => {
      const name = getBarangayLabel(geoFeature);
      layer.bindTooltip(createBoundaryTooltipHtml(name), {
        sticky: true,
        direction: "auto",
        opacity: 0.95,
      });
      layer.bindPopup(createBoundaryPopupHtml(geoFeature), {
        closeButton: false,
      });
      layer.on({
        mouseover: (event) => {
          const target = event.target as L.Path;
          const isActive = activeBoundaryRef.current === target;
          target.setStyle(isActive ? getActiveBoundaryStyle(mapThemeRef.current) : getHoverBoundaryStyle(mapThemeRef.current));
          target.bringToFront();
        },
        mouseout: (event) => {
          const target = event.target as L.Path;
          if (activeBoundaryRef.current === target) {
            target.setStyle(getActiveBoundaryStyle(mapThemeRef.current));
            return;
          }

          applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
        },
        click: (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          selectBarangayRef.current(name, event.target as L.Path);
        },
      });
    };

    const boundaryLayer = L.geoJSON(boundary, {
      style: boundaryStyle,
      onEachFeature,
    });
    boundaryLayerRef.current = boundaryLayer;
    citywideBoundsRef.current = boundaryLayer.getBounds();
    barangayBoundsRef.current = new Map(
      boundaryLayer
        .getLayers()
        .filter((layer): layer is L.Polygon & { feature?: GeoJSON.Feature } => layer instanceof L.Polygon && "feature" in layer)
        .map((layer) => [normalizeBarangayName(getBarangayLabel(layer.feature)), layer.getBounds()]),
    );

    if (showBoundariesRef.current) {
      boundaryLayer.addTo(map);
    }

    applyBoundarySelectionRef.current(selectedBarangayNameRef.current);
    if (selectedBarangayNameRef.current) {
      const selectedKey = normalizeBarangayName(selectedBarangayNameRef.current);
      boundaryLayer
        .getLayers()
        .find((layer) => {
          if (!("feature" in layer)) return false;
          return normalizeBarangayName(getBarangayLabel(layer.feature as GeoJSON.Feature | undefined)) === selectedKey;
        })
        ?.openTooltip();
    }

    return () => {
      boundaryLayer.remove();
      if (boundaryLayerRef.current === boundaryLayer) {
        boundaryLayerRef.current = null;
        citywideBoundsRef.current = null;
        barangayBoundsRef.current.clear();
      }
    };
  }, [boundary]);

  useEffect(() => {
    const map = mapRef.current;
    const boundaryLayer = boundaryLayerRef.current;
    if (!map || !boundaryLayer) return;

    if (showBoundaries) {
      if (!map.hasLayer(boundaryLayer)) boundaryLayer.addTo(map);
      return;
    }

    if (map.hasLayer(boundaryLayer)) boundaryLayer.remove();
  }, [boundary, showBoundaries]);

  useEffect(() => {
    const boundaryLayer = boundaryLayerRef.current;
    if (!boundaryLayer) return;

    if (selectedBarangayName) {
      applyBoundarySelection(selectedBarangayName);
      return;
    }

    boundaryLayer.setStyle((geoFeature) => getBaseBoundaryStyle(getBarangayLabel(geoFeature), mapTheme, "boundaryPane", "admin"));
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

  return (
    <div className="bg-tanaw-gray relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div id={mapContainerId} className="h-full w-full" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
      </div>

      <AdminMapInsights
        barangay={selectedBarangayName}
        enterpriseId={insightEnterpriseId}
        isBoundaryError={isBoundaryError}
        isBoundaryLoading={isBoundaryLoading}
        isOpen={isInsightsOpen}
        range={insightRange}
        onClose={() => setIsInsightsOpen(false)}
        onRangeChange={setInsightRange}
        onShowArea={() => dispatchMapInteraction({ type: "show-area-insights" })}
      />

      <MapToolRail isDirectoryCollapsed={isDirectoryCollapsed} isInsightsOpen={isInsightsOpen} onOpenDirectory={() => setIsDirectoryCollapsed(false)} onOpenInsights={() => setIsInsightsOpen(true)} />

      <AdminMapDirectory
        barangayDropdownOptions={barangayDropdownOptions}
        boundaryFeatureCount={boundaryFeatureCount}
        enterpriseAccounts={enterpriseAccounts}
        isBoundaryError={isBoundaryError}
        isBoundaryLoading={isBoundaryLoading}
        isCollapsed={isDirectoryCollapsed}
        isEnterpriseError={enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError}
        isEnterpriseLoading={enterpriseAccountsQuery.isLoading || mapEnterprisesQuery.isLoading}
        mapEnterprises={mapEnterprises}
        onClearBarangay={clearBarangaySelection}
        onCollapseChange={setIsDirectoryCollapsed}
        onRetry={() => {
          void enterpriseAccountsQuery.refetch();
          void mapEnterprisesQuery.refetch();
        }}
        onHoverEnterprise={setHoveredEnterpriseId}
        onSelectBarangay={selectBarangay}
        onSelectEnterprise={selectEnterprise}
        onShowBoundariesChange={setShowBoundaries}
        selectedBarangayEnterprises={selectedBarangayEnterprises}
        selectedBarangayName={selectedBarangayName}
        selectedBarangayUnpinnedEnterprises={selectedBarangayUnpinnedEnterprises}
        selectedEnterpriseId={selectedEnterpriseId}
        showBoundaries={showBoundaries}
        unpinnedEnterprises={unpinnedEnterprises}
      />

      <AnimatePresence>
        {selectedEnterprise && (
          <EnterpriseDetailsModal
            enterprise={selectedEnterprise}
            onClose={closeEnterpriseDetails}
            onOpenInsights={() => {
              dispatchMapInteraction({ type: "show-enterprise-insights", enterpriseId: selectedEnterprise.id });
              setIsInsightsOpen(true);
              closeEnterpriseDetails();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
