import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { useOperationalMapEnterprises } from "@/app/hooks/useOperationalSync";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import type { AccountSummary, MapEnterprise, VisitorInsightRange } from "@/shared/types";
import { useAdminLeafletMap, useMapDirectoryData, useSanPedroBoundary } from "../hooks";
import { initialMapInteractionState, mapInteractionReducer } from "../utils";
import { COMPACT_MAP_MAX_WIDTH } from "../utils/mapCamera";
import { AdminMapDirectory } from "./AdminMapDirectory";
import { AdminMapInsights } from "./AdminMapInsights";
import { EnterpriseDetailsModal } from "./EnterpriseDetailsModal";
import { MapToolRail } from "./MapToolRail";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_MAP_ENTERPRISES: MapEnterprise[] = [];
const MAP_LABELS_PREFERENCE = "tanaw-admin-map-labels";
const COMPACT_MAP_QUERY = `(max-width: ${COMPACT_MAP_MAX_WIDTH}px)`;

export function AdminEnterpriseMap() {
  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const [isDirectoryCollapsed, setIsDirectoryCollapsed] = useState(() => window.matchMedia(COMPACT_MAP_QUERY).matches);
  const [hoveredEnterpriseId, setHoveredEnterpriseId] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showLabels, setShowLabels] = useState(() => window.localStorage.getItem(MAP_LABELS_PREFERENCE) !== "hidden");
  const [interactionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [detailsEnterpriseId, setDetailsEnterpriseId] = useState<string | null>(null);
  const focusInsightsOnDialogExit = useRef(false);
  const [insightRange, setInsightRange] = useState<VisitorInsightRange>("7d");
  const revealMapSelection = useCallback((selection: "barangay" | "enterprise") => {
    if (!window.matchMedia(COMPACT_MAP_QUERY).matches) return;
    setIsDirectoryCollapsed(true);
    setIsInsightsOpen(false);
    if (selection === "barangay" && !isDirectoryCollapsed) {
      requestAnimationFrame(() => document.getElementById("spatial-directory-toggle")?.focus({ preventScroll: true }));
    }
  }, [isDirectoryCollapsed]);
  const { insightEnterpriseId, selectedBarangayName, selectedEnterpriseId } = interactionState;
  const highlightedEnterprise = interactionState.cameraTarget.type === "enterprise" ? interactionState.cameraTarget : null;
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
  const detailsEnterprise = detailsEnterpriseId ? mapEnterprises.find((item) => item.id === detailsEnterpriseId) : undefined;
  const closeEnterpriseDetails = useCallback(() => {
    setDetailsEnterpriseId(null);
  }, []);
  const { clearBarangaySelection, fitCitywide, isInitialCameraReady, selectBarangay, selectEnterprise } = useAdminLeafletMap({
    boundary,
    dispatchMapInteraction,
    hoveredEnterpriseId,
    interactionState,
    isDirectoryCollapsed,
    isInsightsOpen,
    mapEnterprises,
    selectedEnterprise,
    onSelectLocation: revealMapSelection,
    onViewDetails: setDetailsEnterpriseId,
    showBoundaries,
    showLabels,
    visibleEnterprises,
  });

  useEffect(() => {
    const compact = window.matchMedia(COMPACT_MAP_QUERY);
    const keepOnePanelVisible = (event: MediaQueryListEvent) => {
      if (event.matches && isInsightsOpen) setIsDirectoryCollapsed(true);
    };
    compact.addEventListener("change", keepOnePanelVisible);
    return () => compact.removeEventListener("change", keepOnePanelVisible);
  }, [isInsightsOpen]);

  const changeDirectoryState = (collapsed: boolean) => {
    if (!collapsed && window.matchMedia(COMPACT_MAP_QUERY).matches) setIsInsightsOpen(false);
    setIsDirectoryCollapsed(collapsed);
  };
  const changeInsightsState = (open: boolean) => {
    if (open && window.matchMedia(COMPACT_MAP_QUERY).matches) setIsDirectoryCollapsed(true);
    setIsInsightsOpen(open);
  };

  return (
    <div className="tanaw-admin-map-workspace relative min-h-0 flex-1 overflow-clip bg-(--tanaw-surface-inset)" data-insights-open={isInsightsOpen}>
      <div className="absolute inset-0 z-0">
        <div id="admin-enterprise-map" className="h-full w-full" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
      </div>
      <AdminMapDirectory
        barangayDropdownOptions={barangayDropdownOptions}
        boundaryFeatureCount={boundaryFeatureCount}
        isBoundaryError={isBoundaryError}
        isBoundaryLoading={isBoundaryLoading}
        isCollapsed={isDirectoryCollapsed}
        isEnterpriseError={enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError}
        isEnterpriseLoading={enterpriseAccountsQuery.isLoading || mapEnterprisesQuery.isLoading}
        isMapReady={isInitialCameraReady}
        mapEnterprises={mapEnterprises}
        onClearBarangay={clearBarangaySelection}
        onCollapseChange={changeDirectoryState}
        onResetView={fitCitywide}
        onRetry={() => {
          void enterpriseAccountsQuery.refetch();
          void mapEnterprisesQuery.refetch();
        }}
        onHoverEnterprise={setHoveredEnterpriseId}
        onSelectBarangay={selectBarangay}
        onSelectEnterprise={selectEnterprise}
        onShowBoundariesChange={setShowBoundaries}
        onToggleLabels={() => {
          const visible = !showLabels;
          setShowLabels(visible);
          window.localStorage.setItem(MAP_LABELS_PREFERENCE, visible ? "visible" : "hidden");
        }}
        selectedBarangayEnterprises={selectedBarangayEnterprises}
        selectedBarangayName={selectedBarangayName}
        selectedBarangayUnpinnedEnterprises={selectedBarangayUnpinnedEnterprises}
        selectedEnterpriseId={highlightedEnterprise?.enterpriseId ?? null}
        showBoundaries={showBoundaries}
        showLabels={showLabels}
        unpinnedEnterprises={unpinnedEnterprises}
      />
      <MapToolRail isInsightsOpen={isInsightsOpen} onToggleInsights={() => changeInsightsState(!isInsightsOpen)} />
      <AdminMapInsights
        barangay={selectedBarangayName ?? highlightedEnterprise?.barangayName ?? null}
        enterpriseId={insightEnterpriseId}
        isBoundaryError={isBoundaryError}
        isBoundaryLoading={isBoundaryLoading}
        isOpen={isInsightsOpen}
        range={insightRange}
        onRangeChange={setInsightRange}
        onShowArea={() => dispatchMapInteraction({ type: "show-area-insights" })}
      />
      <AnimatePresence onExitComplete={() => {
        if (!focusInsightsOnDialogExit.current) return;
        focusInsightsOnDialogExit.current = false;
        requestAnimationFrame(() => document.getElementById("visitor-insights-launcher")?.focus({ preventScroll: true }));
      }}>
        {detailsEnterprise && (
          <EnterpriseDetailsModal
            enterprise={detailsEnterprise}
            onClose={closeEnterpriseDetails}
            onOpenInsights={() => {
              dispatchMapInteraction({ type: "show-enterprise-insights", enterpriseId: detailsEnterprise.id });
              changeInsightsState(true);
              focusInsightsOnDialogExit.current = true;
              setDetailsEnterpriseId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
