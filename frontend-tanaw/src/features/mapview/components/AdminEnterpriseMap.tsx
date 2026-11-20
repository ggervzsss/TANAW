import { AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useOperationalMapEnterprises } from "@/app/hooks/useOperationalSync";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import type { AccountSummary, MapEnterprise } from "@/shared/types";
import { useAdminLeafletMap, useMapDirectoryData, useSanPedroBoundary } from "../hooks";
import { initialMapInteractionState, mapInteractionReducer } from "../utils";
import { useBarangayInactivity } from "../hooks/useBarangayInactivity";
import { AdminMapDirectory } from "./AdminMapDirectory";
import { EnterpriseDetailsModal } from "./EnterpriseDetailsModal";

const EMPTY_ENTERPRISE_ACCOUNTS: AccountSummary[] = [];
const EMPTY_MAP_ENTERPRISES: MapEnterprise[] = [];
const MAP_LABELS_PREFERENCE = "tanaw-admin-map-labels";

export function AdminEnterpriseMap() {
  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const navigate = useNavigate();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [hoveredEnterpriseId, setHoveredEnterpriseId] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showLabels, setShowLabels] = useState(() => window.localStorage.getItem(MAP_LABELS_PREFERENCE) !== "hidden");
  const [interactionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [detailsEnterpriseId, setDetailsEnterpriseId] = useState<string | null>(null);
  const { selectedBarangayName, selectedEnterpriseId } = interactionState;
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
    mapEnterprises,
    selectedEnterprise,
    onViewDetails: setDetailsEnterpriseId,
    showBoundaries,
    showLabels,
    visibleEnterprises,
  });

  const resetInactiveBarangay = useCallback(() => clearBarangaySelection("inactive"), [clearBarangaySelection]);
  useBarangayInactivity(workspaceRef, selectedBarangayName, Boolean(detailsEnterprise), resetInactiveBarangay);

  return (
    <div ref={workspaceRef} className="tanaw-admin-map-workspace min-h-0 flex-1">
      <AdminMapDirectory
        barangayDropdownOptions={barangayDropdownOptions}
        boundaryFeatureCount={boundaryFeatureCount}
        isBoundaryError={isBoundaryError}
        isBoundaryLoading={isBoundaryLoading}
        isEnterpriseError={enterpriseAccountsQuery.isError || mapEnterprisesQuery.isError}
        isEnterpriseLoading={enterpriseAccountsQuery.isLoading || mapEnterprisesQuery.isLoading}
        isMapReady={isInitialCameraReady}
        mapEnterprises={mapEnterprises}
        onClearBarangay={clearBarangaySelection}
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
      <div className="tanaw-admin-map-viewport relative isolate min-h-0 min-w-0 overflow-hidden">
        <div id="admin-enterprise-map" className="h-full w-full" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
        {(isBoundaryLoading || isBoundaryError) && (
          <p role="status" className="tanaw-map-load-status absolute top-4 left-4 z-415 rounded-xl border px-4 py-3 text-sm font-semibold">
            {isBoundaryError ? "Barangay boundaries are temporarily unavailable." : "Loading barangay boundaries..."}
          </p>
        )}
      </div>
      <AnimatePresence>
        {detailsEnterprise && (
          <EnterpriseDetailsModal
            enterprise={detailsEnterprise}
            onClose={closeEnterpriseDetails}
            onOpenInsights={() => {
              const params = new URLSearchParams({ enterprise: detailsEnterprise.id, barangay: detailsEnterprise.barangay });
              navigate(`${routes.admin.visitorInsights}?${params}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
