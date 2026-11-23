import { ArrowLeft, Layers, MapPin, Type } from "lucide-react";
import { useCallback, useMemo, useReducer, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminEnterpriseDetailsPath } from "@/app/routers/routes";
import { initialMapInteractionState, isPointInsideSanPedro, mapInteractionReducer, useAdminLeafletMap, useSanPedroBoundary } from "@/features/mapview";
import type { MapEnterprise } from "@/shared/types";
import type { BusyEnterprise } from "../model/busyAlert";
import { barangayKey, barangayLeaders, enterprisesInBarangay, pinAriaLabel, visiblePins } from "../model/mapPins";
import { BusyAlert } from "./BusyAlert";

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
  busy: readonly BusyEnterprise[];
  monitoredCount: number;
};

/** The San Pedro map: barangay boundaries, one pin per barangay (all pins inside an open barangay) and the busy alert. */
export function DashboardMap({ enterprises, isEnterpriseError, onRetry, busy, monitoredCount }: DashboardMapProps) {
  const navigate = useNavigate();
  const { boundary, isError: isBoundaryError, isLoading: isBoundaryLoading } = useSanPedroBoundary();
  const [interactionState, dispatchMapInteraction] = useReducer(mapInteractionReducer, initialMapInteractionState);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [showLabels, setShowLabels] = useState(readLabelsPreference);
  const [busyExpanded, setBusyExpanded] = useState(false);
  const openBarangay = interactionState.selectedBarangayName;

  const pinned = useMemo(() => enterprises.filter((enterprise) => isPointInsideSanPedro(boundary, enterprise.lat, enterprise.lng)), [boundary, enterprises]);
  const visible = useMemo(() => visiblePins(pinned, openBarangay), [openBarangay, pinned]);
  const leaderIds = useMemo(() => new Set(barangayLeaders(pinned).map(({ id }) => id)), [pinned]);
  const barangayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const enterprise of pinned) counts.set(barangayKey(enterprise.barangay), (counts.get(barangayKey(enterprise.barangay)) ?? 0) + 1);
    return counts;
  }, [pinned]);
  const busyIds = useMemo(() => new Set(busy.map(({ enterpriseId }) => enterpriseId)), [busy]);
  const pinnedIds = useMemo(() => new Set(pinned.map(({ id }) => id)), [pinned]);
  const busyRows = useMemo(() => busy.map((item) => ({ ...item, pinned: pinnedIds.has(item.enterpriseId) })), [busy, pinnedIds]);
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
    showBoundaries,
    showLabels,
    visibleEnterprises: visible,
  });

  const showBusyEnterprise = (enterpriseId: string) => {
    const enterprise = pinned.find(({ id }) => id === enterpriseId);
    if (!enterprise) return;
    const onScreen = visible.some(({ id }) => id === enterpriseId);
    showEnterprise(enterprise, !onScreen);
  };

  const collapseBusyPanel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && !event.target.closest(".tanaw-busy")) setBusyExpanded(false);
  };

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
        <div role="group" aria-label="Map display" className="flex items-center gap-1">
          <button type="button" aria-pressed={showBoundaries} onClick={() => setShowBoundaries((value) => !value)} className="tanaw-dashboard-toggle">
            <Layers size={16} aria-hidden="true" />
            Boundaries
          </button>
          <button
            type="button"
            aria-pressed={showLabels}
            onClick={() => {
              saveLabelsPreference(!showLabels);
              setShowLabels(!showLabels);
            }}
            className="tanaw-dashboard-toggle"
          >
            <Type size={16} aria-hidden="true" />
            Labels
          </button>
        </div>
      </div>

      <div className="tanaw-dashboard-map" onPointerDown={collapseBusyPanel}>
        <div id="admin-enterprise-map" role="region" aria-label="Map of San Pedro enterprises" style={{ visibility: isInitialCameraReady ? "visible" : "hidden" }} />
        {(isBoundaryLoading || isBoundaryError || isEnterpriseError) && (
          <div
            role="status"
            className="absolute top-3 left-3 z-1000 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-3 rounded-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface) px-4 py-3 text-sm font-semibold text-(--tanaw-text)"
          >
            {isBoundaryError ? "Barangay boundaries could not be loaded." : isBoundaryLoading ? "Loading the map of San Pedro…" : "Enterprise pins could not be loaded."}
            {isEnterpriseError && !isBoundaryLoading && (
              <button type="button" onClick={onRetry} className="tanaw-busy-button">
                Try again
              </button>
            )}
          </div>
        )}
        <BusyAlert
          items={busyRows}
          monitoredCount={monitoredCount}
          expanded={busyExpanded}
          onExpandedChange={setBusyExpanded}
          selectedEnterpriseId={selectedEnterprise?.id ?? null}
          onShow={showBusyEnterprise}
        />
      </div>
    </section>
  );
}
