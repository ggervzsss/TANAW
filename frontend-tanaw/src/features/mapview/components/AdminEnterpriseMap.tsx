import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { useOperationalMapEnterprises } from "@/app/hooks/useOperationalSync";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import type { AccountSummary, MapEnterprise, VisitorInsightRange } from "@/shared/types";
import { useAdminLeafletMap, useMapDirectoryData, useSanPedroBoundary } from "../hooks";
import { initialMapInteractionState, mapInteractionReducer } from "../utils";
import { AdminMapDirectory } from "./AdminMapDirectory";
import { AdminMapInsights } from "./AdminMapInsights";
import { EnterpriseDetailsModal } from "./EnterpriseDetailsModal";
import { MapToolRail } from "./MapToolRail";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_MAP_ENTERPRISES: MapEnterprise[] = [];

export function AdminEnterpriseMap() {
  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const [isDirectoryCollapsed, setIsDirectoryCollapsed] = useState(false);
  const [hoveredEnterpriseId, setHoveredEnterpriseId] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [interactionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<VisitorInsightRange>("7d");
  const { insightEnterpriseId, selectedBarangayName, selectedEnterpriseId } = interactionState;
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
  const { clearBarangaySelection, closeEnterpriseDetails, isInitialCameraReady, selectBarangay, selectEnterprise } = useAdminLeafletMap({
    boundary,
    dispatchMapInteraction,
    hoveredEnterpriseId,
    interactionState,
    isDirectoryCollapsed,
    mapEnterprises,
    showBoundaries,
    visibleEnterprises,
  });

  useEffect(() => {
    if (!selectedEnterprise) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEnterpriseDetails();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeEnterpriseDetails, selectedEnterprise]);

  return (
    <div className="bg-tanaw-gray relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div id="admin-enterprise-map" className="h-full w-full" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
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
      <MapToolRail
        isDirectoryCollapsed={isDirectoryCollapsed}
        isInsightsOpen={isInsightsOpen}
        onOpenDirectory={() => setIsDirectoryCollapsed(false)}
        onOpenInsights={() => setIsInsightsOpen(true)}
      />
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
