import { ArrowLeft, Layers2, PanelLeftClose, PanelLeftOpen, RefreshCw, RotateCcw, Type } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { SearchField } from "@/design-system";
import { SelectDropdown, type SelectDropdownOption } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { normalizeBarangayName, type MapDeselectReason } from "../utils";
import { DirectoryEmptyMessage, EnterpriseList, EnterpriseMapCard, MonitoringLegend, UnpinnedEnterpriseCard } from "./MapDirectoryCards";

type AdminMapDirectoryProps = {
  barangayDropdownOptions: SelectDropdownOption[];
  boundaryFeatureCount: number;
  isBoundaryError: boolean;
  isBoundaryLoading: boolean;
  isCollapsed: boolean;
  isEnterpriseError: boolean;
  isEnterpriseLoading: boolean;
  isMapReady: boolean;
  mapEnterprises: MapEnterprise[];
  onClearBarangay: (reason: MapDeselectReason) => void;
  onCollapseChange: (collapsed: boolean) => void;
  onResetView: () => void;
  onRetry: () => void;
  onHoverEnterprise: (enterpriseId: string | null) => void;
  onSelectBarangay: (barangayName: string) => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  onShowBoundariesChange: (show: boolean) => void;
  onToggleLabels: () => void;
  selectedBarangayEnterprises: MapEnterprise[];
  selectedBarangayName: string | null;
  selectedBarangayUnpinnedEnterprises: AccountSummary[];
  selectedEnterpriseId: string | null;
  showBoundaries: boolean;
  showLabels: boolean;
  unpinnedEnterprises: AccountSummary[];
};

export function AdminMapDirectory(props: AdminMapDirectoryProps) {
  const { isCollapsed, onCollapseChange } = props;
  const toggleLabel = isCollapsed ? "Expand spatial directory" : "Collapse spatial directory";
  const ToggleIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <>
      <button
        id="spatial-directory-toggle"
        type="button"
        aria-controls="spatial-directory-panel"
        aria-expanded={!isCollapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => onCollapseChange(!isCollapsed)}
        className="tanaw-map-panel-toggle absolute top-8 left-8 z-445 grid size-11 place-items-center rounded-[14px] border"
      >
        <ToggleIcon size={20} strokeWidth={1.85} aria-hidden="true" />
      </button>
      <aside
        id="spatial-directory-panel"
        aria-labelledby="spatial-directory-title"
        aria-hidden={isCollapsed}
        data-directory-state={isCollapsed ? "collapsed" : "expanded"}
        className="tanaw-spatial-directory-frame absolute top-4 bottom-4 left-4 z-420 overflow-visible"
      >
        <div className="tanaw-map-panel tanaw-spatial-directory-shell absolute inset-y-0 left-0 overflow-hidden">
          <div inert={isCollapsed ? true : undefined} className="tanaw-spatial-directory-content h-full">
            <SpatialDirectory {...props} />
          </div>
        </div>
      </aside>
    </>
  );
}

function SpatialDirectory(props: AdminMapDirectoryProps) {
  const [enterpriseSearch, setEnterpriseSearch] = useState("");
  const {
    barangayDropdownOptions,
    boundaryFeatureCount,
    isBoundaryError,
    isBoundaryLoading,
    isEnterpriseError,
    isEnterpriseLoading,
    mapEnterprises,
    onClearBarangay,
    onResetView,
    onRetry,
    onHoverEnterprise,
    onSelectBarangay,
    onSelectEnterprise,
    onShowBoundariesChange,
    onToggleLabels,
    selectedBarangayEnterprises,
    selectedBarangayName,
    selectedBarangayUnpinnedEnterprises,
    selectedEnterpriseId,
    showBoundaries,
    showLabels,
    unpinnedEnterprises,
  } = props;
  const query = enterpriseSearch.trim().toLocaleLowerCase();
  const matches = (...fields: (string | null | undefined)[]) => fields.some((field) => field?.toLocaleLowerCase().includes(query));
  const filterPinned = (enterprises: MapEnterprise[]) => enterprises.filter(({ name, fullAddress, barangay }) => !query || matches(name, fullAddress, barangay));
  const filterUnpinned = (enterprises: AccountSummary[]) =>
    enterprises.filter(({ enterpriseName, displayName, address, barangay }) => !query || matches(enterpriseName, displayName, address, barangay));

  return (
    <div className="tanaw-map-directory flex h-full flex-col">
      <header className="tanaw-map-directory__header shrink-0 px-4 pt-4 pb-2">
        <div className="flex min-h-11 flex-col justify-center pl-14">
          <h2 id="spatial-directory-title" className="tanaw-map-directory__title text-lg leading-tight font-bold">Spatial Directory</h2>
          <p className="tanaw-map-directory__subtitle mt-1 text-xs leading-snug font-medium">
            {directoryStatus({
              boundaryFeatureCount,
              isBoundaryError,
              isBoundaryLoading,
              isEnterpriseError,
              isEnterpriseLoading,
              selectedBarangayEnterprises,
              selectedBarangayName,
              selectedBarangayUnpinnedEnterprises,
            })}
          </p>
        </div>
      </header>
      <div className="tanaw-map-directory__options shrink-0 px-4 pt-1.5 pb-3.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Map display">
          <button
            type="button"
            title={showBoundaries ? "Hide barangay boundaries" : "Show barangay boundaries"}
            aria-pressed={showBoundaries}
            onClick={() => onShowBoundariesChange(!showBoundaries)}
            className="tanaw-map-directory__toggle inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold"
          >
            <Layers2 size={14} aria-hidden="true" /> Boundaries
          </button>
          <button
            type="button"
            aria-label="Show Map Labels"
            title={showLabels ? "Hide map labels" : "Show map labels"}
            aria-pressed={showLabels}
            onClick={onToggleLabels}
            className="tanaw-map-directory__toggle inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold"
          >
            <Type size={14} aria-hidden="true" /> Labels
          </button>
          <button
            type="button"
            aria-label="Reset map view"
            title="Fit all barangays"
            disabled={!props.isMapReady}
            onClick={onResetView}
            className="tanaw-map-directory__toggle ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold"
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset view
          </button>
        </div>
        <MonitoringLegend />
      </div>

      <div className="tanaw-map-directory__selector relative z-20 grid shrink-0 gap-2.5 overflow-visible px-4 py-3">
        <SelectDropdown
          label="Select Barangay"
          ariaLabel="Select barangay"
          value={selectedBarangayName ?? ""}
          options={barangayDropdownOptions}
          onChange={(name) => (name ? onSelectBarangay(name) : onClearBarangay("all-barangays"))}
          searchable
          searchPlaceholder="Search barangay..."
          variant="directory"
        />
        <SearchField value={enterpriseSearch} onChange={setEnterpriseSearch} label="Search enterprises" placeholder="Search enterprises" />
      </div>

      <div className="tanaw-map-directory__body flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {selectedBarangayName ? (
            <SelectedBarangayDirectory
              key={`barangay-enterprises-${normalizeBarangayName(selectedBarangayName)}`}
              isEnterpriseError={isEnterpriseError}
              onBack={() => onClearBarangay("back")}
              onSelectEnterprise={onSelectEnterprise}
              onHoverEnterprise={onHoverEnterprise}
              pinned={filterPinned(selectedBarangayEnterprises)}
              selectedBarangayName={selectedBarangayName}
              selectedEnterpriseId={selectedEnterpriseId}
              unpinned={filterUnpinned(selectedBarangayUnpinnedEnterprises)}
              isSearching={Boolean(query)}
            />
          ) : (
            <AllEnterprisesDirectory
              key="all-enterprises-view"
              isEnterpriseError={isEnterpriseError}
              isEnterpriseLoading={isEnterpriseLoading}
              mapEnterprises={filterPinned(mapEnterprises)}
              onRetry={onRetry}
              onHoverEnterprise={onHoverEnterprise}
              onSelectEnterprise={onSelectEnterprise}
              selectedEnterpriseId={selectedEnterpriseId}
              unpinnedEnterprises={filterUnpinned(unpinnedEnterprises)}
              isSearching={Boolean(query)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SelectedBarangayDirectory({
  isEnterpriseError,
  isSearching,
  onBack,
  onSelectEnterprise,
  onHoverEnterprise,
  pinned,
  selectedBarangayName,
  selectedEnterpriseId,
  unpinned,
}: {
  isEnterpriseError: boolean;
  isSearching: boolean;
  onBack: () => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  onHoverEnterprise: (enterpriseId: string | null) => void;
  pinned: MapEnterprise[];
  selectedBarangayName: string;
  selectedEnterpriseId: string | null;
  unpinned: AccountSummary[];
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.19, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3.5"
    >
      <div className="tanaw-map-directory__barangay-summary flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl p-2.5">
        <h3 className="tanaw-map-directory__section-title px-1 text-sm leading-tight font-bold">Barangay {selectedBarangayName}</h3>
        <button
          type="button"
          aria-label="Back to Barangay Directory"
          title="Return to all barangays"
          onClick={onBack}
          className="tanaw-map-directory__back inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold"
        >
          <ArrowLeft size={12} className="shrink-0" aria-hidden="true" /> All Barangays
        </button>
      </div>
      <EnterpriseList title="Enterprises within this Barangay" count={pinned.length + unpinned.length}>
        {pinned.map((enterprise, index) => (
          <motion.div key={enterprise.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18, delay: reduceMotion ? 0 : Math.min(index * 0.025, 0.12), ease: "easeOut" }}>
            <EnterpriseMapCard enterprise={enterprise} selected={selectedEnterpriseId === enterprise.id} onClick={() => onSelectEnterprise(enterprise)} onHoverChange={onHoverEnterprise} />
          </motion.div>
        ))}
        {unpinned.map((enterprise) => (
          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
        ))}
        {pinned.length === 0 && unpinned.length === 0 && (
          <DirectoryEmptyMessage>
            {isEnterpriseError ? "Unable to load enterprise registry." : isSearching ? "No enterprises match your search." : "No registered enterprises found for this barangay yet."}
          </DirectoryEmptyMessage>
        )}
      </EnterpriseList>
    </motion.div>
  );
}

function AllEnterprisesDirectory({
  isEnterpriseError,
  isSearching,
  isEnterpriseLoading,
  mapEnterprises,
  onRetry,
  onHoverEnterprise,
  onSelectEnterprise,
  selectedEnterpriseId,
  unpinnedEnterprises,
}: {
  isEnterpriseError: boolean;
  isSearching: boolean;
  isEnterpriseLoading: boolean;
  mapEnterprises: MapEnterprise[];
  onRetry: () => void;
  onHoverEnterprise: (enterpriseId: string | null) => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  selectedEnterpriseId: string | null;
  unpinnedEnterprises: AccountSummary[];
}) {
  const reduceMotion = useReducedMotion();
  const count = unpinnedEnterprises.length > 0 ? `${mapEnterprises.length} pinned / ${unpinnedEnterprises.length} unpinned` : mapEnterprises.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: reduceMotion ? 0 : 0.19, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5"
    >
      <EnterpriseList title="All Enterprises" count={count}>
        {mapEnterprises.map((enterprise) => (
          <EnterpriseMapCard
            key={enterprise.id}
            enterprise={enterprise}
            selected={selectedEnterpriseId === enterprise.id}
            onClick={() => onSelectEnterprise(enterprise)}
            onHoverChange={onHoverEnterprise}
          />
        ))}
        {unpinnedEnterprises.map((enterprise) => (
          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
        ))}
        {mapEnterprises.length === 0 && unpinnedEnterprises.length === 0 && (
          <DirectoryEmptyMessage>
            {isEnterpriseError ? (
              <span className="flex flex-col items-center gap-3">
                <span>Unable to load enterprise registry.</span>
                <button type="button" onClick={onRetry} className="tanaw-map-directory__retry inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold">
                  <RefreshCw size={11} /> Retry
                </button>
              </span>
            ) : isEnterpriseLoading ? (
              "Loading enterprises..."
            ) : isSearching ? (
              "No enterprises match your search."
            ) : (
              "No pinned enterprise locations yet."
            )}
          </DirectoryEmptyMessage>
        )}
      </EnterpriseList>
    </motion.div>
  );
}

function directoryStatus({
  boundaryFeatureCount,
  isBoundaryError,
  isBoundaryLoading,
  isEnterpriseError,
  isEnterpriseLoading,
  selectedBarangayEnterprises,
  selectedBarangayName,
  selectedBarangayUnpinnedEnterprises,
}: Pick<
  AdminMapDirectoryProps,
  | "boundaryFeatureCount"
  | "isBoundaryError"
  | "isBoundaryLoading"
  | "isEnterpriseError"
  | "isEnterpriseLoading"
  | "selectedBarangayEnterprises"
  | "selectedBarangayName"
  | "selectedBarangayUnpinnedEnterprises"
>) {
  if (selectedBarangayName) return `${selectedBarangayEnterprises.length + selectedBarangayUnpinnedEnterprises.length} registered enterprises`;
  if (isBoundaryLoading) return "Loading refined boundaries";
  if (isBoundaryError) return "Boundary layer unavailable";
  if (isEnterpriseError) return "Enterprise registry unavailable";
  if (isEnterpriseLoading) return "Loading enterprises";
  return `${boundaryFeatureCount} barangay boundaries`;
}
