import { ArrowLeft, MapPin, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { initialMapInteractionState, isPointInsideSanPedro, mapInteractionReducer, useAdminLeafletMap, useSanPedroBoundary } from "@/features/mapview";
import { useAlerts } from "@/shared/hooks/useAlerts";
import type { MapEnterprise } from "@/shared/types";
import { barangayKey, barangayLeaders, enterprisesInBarangay, pinAriaLabel, visiblePins } from "../model/mapPins";
import { MapAlerts } from "./MapAlerts";
import { MapLegend } from "./MapLegend";

const MAP_LABELS_PREFERENCE = "tanaw-admin-map-labels";

function readLabelsPreference() {
  try {
    return window.localStorage.getItem(MAP_LABELS_PREFERENCE) !== "hidden";
  } catch {
    return true;
  }
}

function saveLabelsPreference(visible: boolean) {
  try {
    window.localStorage.setItem(MAP_LABELS_PREFERENCE, visible ? "visible" : "hidden");
  } catch {
    // The choice simply is not remembered.
  }
}

type DashboardMapProps = {
  enterprises: readonly MapEnterprise[];
  isEnterpriseError: boolean;
  onRetry: () => void;
};

/**
 * The San Pedro map: barangay boundaries (always shown), one pin per barangay (all pins inside an open
 * barangay), pins coloured by what is happening now, a legend above it, a place-names switch in its
 * top-right corner, and the live alerts floating over its bottom.
 * `?place=<enterprise id>` opens that place, which is where "Show on map" leads.
 */
export function DashboardMap({ enterprises, isEnterpriseError, onRetry }: DashboardMapProps) {
  const [searchParams] = useSearchParams();
  const focusPlace = searchParams.get("place");
  const navigate = useNavigate();
  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const [interactionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [showLabels, setShowLabels] = useState(readLabelsPreference);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const { alerts } = useAlerts();
  const openBarangay = interactionState.selectedBarangayName;

  const pinned = useMemo(() => enterprises.filter((enterprise) => isPointInsideSanPedro(boundary, enterprise.lat, enterprise.lng)), [boundary, enterprises]);
  const visible = useMemo(() => visiblePins(pinned, openBarangay), [openBarangay, pinned]);
  const leaderIds = useMemo(() => new Set(barangayLeaders(pinned).map(({ id }) => id)), [pinned]);
  const barangayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const enterprise of pinned) counts.set(barangayKey(enterprise.barangay), (counts.get(barangayKey(enterprise.barangay)) ?? 0) + 1);
    return counts;
  }, [pinned]);
  const busyIds = useMemo(() => new Set(pinned.filter((enterprise) => enterprise.pinState === "busy").map(({ id }) => id)), [pinned]);
  const pinnedIds = useMemo(() => new Set(pinned.map(({ id }) => id)), [pinned]);
  const selectedEnterprise = visible.find((enterprise) => enterprise.id === interactionState.selectedEnterpriseId) ?? null;

  const countIn = useCallback((enterprise: MapEnterprise) => barangayCounts.get(barangayKey(enterprise.barangay)) ?? 1, [barangayCounts]);
  const ariaLabelFor = useCallback(
    (enterprise: MapEnterprise) => pinAriaLabel(enterprise, { busy: busyIds.has(enterprise.id), leader: !openBarangay && leaderIds.has(enterprise.id), barangayCount: countIn(enterprise) }),
    [busyIds, countIn, leaderIds, openBarangay],
  );
  const shouldDrillInto = useCallback((enterprise: MapEnterprise) => !openBarangay && countIn(enterprise) > 1, [countIn, openBarangay]);
  const viewDetails = useCallback((enterpriseId: string) => navigate(adminEnterpriseDetailsPath(enterpriseId)), [navigate]);

  const { clearBarangaySelection, isInitialCameraReady, showEnterprise } = useAdminLeafletMap({
    ariaLabelFor,
    boundary,
    busyEnterpriseIds: busyIds,
    detailsHref: adminEnterpriseDetailsPath,
    dispatchMapInteraction,
    interactionState,
    mapEnterprises: pinned,
    selectedEnterprise,
    onViewDetails: viewDetails,
    shouldDrillInto,
    showLabels,
    visibleEnterprises: visible,
  });

  // Open the place named in the address once the map and its pins are ready.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPlace || !isInitialCameraReady || focusedRef.current === focusPlace) return;
    const enterprise = pinned.find(({ id }) => id === focusPlace);
    if (!enterprise) return;
    focusedRef.current = focusPlace;
    showEnterprise(enterprise, !visible.some(({ id }) => id === focusPlace));
  }, [focusPlace, isInitialCameraReady, pinned, showEnterprise, visible]);

  const showAlertPlace = (enterpriseId: string) => {
    const enterprise = pinned.find(({ id }) => id === enterpriseId);
    if (!enterprise) return;
    showEnterprise(enterprise, !visible.some(({ id }) => id === enterpriseId));
  };

  const collapseAlerts = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && !event.target.closest(".tanaw-map-alerts")) setAlertsExpanded(false);
  };

  const mapStatus = isBoundaryLoading || isBoundaryError || isEnterpriseError;
  const openCount = openBarangay ? enterprisesInBarangay(pinned, openBarangay).length : 0;

  return (
    <section aria-labelledby="dashboard-map" className="min-w-0">
      <div className="mb-3.5 flex min-h-10 flex-wrap items-center justify-between gap-3">
        {openBarangay ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" onClick={() => clearBarangaySelection("all-barangays")} className="tanaw-dashboard-link inline-flex min-h-9 items-center gap-1.5 font-semibold">
              <ArrowLeft size={16} aria-hidden="true" />
              All barangays
            </button>
            <h2 id="dashboard-map" className="m-0 flex min-w-0 items-baseline gap-2 text-[15px] font-bold text-(--tanaw-text)">
              <span className="truncate">Barangay {openBarangay}</span>{" "}
              <span className="shrink-0 text-sm font-medium text-(--tanaw-text-muted)">
                {openCount} {openCount === 1 ? "enterprise" : "enterprises"}
              </span>
            </h2>
          </div>
        ) : (
          <h2 id="dashboard-map" className="m-0 inline-flex items-center gap-2 text-[15px] font-bold text-(--tanaw-text)">
            <MapPin size={17} className="text-(--tanaw-accent-ink)" aria-hidden="true" />
            San Pedro, Laguna
          </h2>
        )}
      </div>

      <MapLegend />

      <div className="tanaw-dashboard-map" onPointerDown={collapseAlerts}>
        <div id="admin-enterprise-map" role="region" aria-label="Map of San Pedro enterprises" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
        <button
          type="button"
          aria-label="Map labels"
          aria-pressed={showLabels}
          title={showLabels ? "Hide place names" : "Show place names"}
          onClick={() => {
            saveLabelsPreference(!showLabels);
            setShowLabels(!showLabels);
          }}
          className="tanaw-map-control"
        >
          <Type size={18} aria-hidden="true" />
        </button>
        {mapStatus && (
          <div
            role="status"
            className="absolute top-3 left-3 z-1000 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-3 rounded-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface) px-4 py-3 text-sm font-semibold text-(--tanaw-text)"
          >
            {isBoundaryError ? "Barangay boundaries could not be loaded." : isBoundaryLoading ? "Loading the map of San Pedro…" : "Enterprise pins could not be loaded."}
            {isEnterpriseError && !isBoundaryLoading && (
              <button type="button" onClick={onRetry} className="tanaw-map-alerts-button">
                Try again
              </button>
            )}
          </div>
        )}
        <MapAlerts
          alerts={alerts}
          pinnedIds={pinnedIds}
          expanded={alertsExpanded}
          onExpandedChange={setAlertsExpanded}
          selectedEnterpriseId={selectedEnterprise?.id ?? null}
          onShow={showAlertPlace}
        />
      </div>
    </section>
  );
}
