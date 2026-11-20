import { Layers2, MapPinned, RefreshCw, RotateCcw, Type } from "lucide-react";
import { useState } from "react";
import { SearchField } from "@/design-system";
import { SelectDropdown, type SelectDropdownOption } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import type { MapDeselectReason } from "../utils";
import { DirectoryEmptyMessage, EnterpriseList, EnterpriseMapCard, MonitoringLegend, UnpinnedEnterpriseCard } from "./MapDirectoryCards";

type AdminMapDirectoryProps = {
  barangayDropdownOptions: SelectDropdownOption[];
  boundaryFeatureCount: number;
  isBoundaryError: boolean;
  isBoundaryLoading: boolean;
  isEnterpriseError: boolean;
  isEnterpriseLoading: boolean;
  isMapReady: boolean;
  mapEnterprises: MapEnterprise[];
  onClearBarangay: (reason: MapDeselectReason) => void;
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
  return (
    <aside id="spatial-directory-panel" aria-labelledby="spatial-directory-title" className="tanaw-spatial-directory-shell min-h-0 min-w-0">
      <SpatialDirectory {...props} />
    </aside>
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
  const matches = (...fields: (string | null | undefined)[]) => !query || fields.some((field) => field?.toLocaleLowerCase().includes(query));
  const pinned = (selectedBarangayName ? selectedBarangayEnterprises : mapEnterprises).filter(({ name, fullAddress, barangay }) => matches(name, fullAddress, barangay));
  const unpinned = (selectedBarangayName ? selectedBarangayUnpinnedEnterprises : unpinnedEnterprises).filter(({ enterpriseName, displayName, address, barangay }) =>
    matches(enterpriseName, displayName, address, barangay),
  );
  const count = pinned.length + unpinned.length;
  const boundarySummary = isBoundaryLoading ? "Loading boundaries" : isBoundaryError ? "Boundaries unavailable" : "Barangays";
  const emptyMessage = query ? "No enterprises match your search." : selectedBarangayName ? "No registered enterprises in this barangay." : "No registered enterprises yet.";

  return (
    <div className="tanaw-map-directory @container flex h-full flex-col">
      <header className="tanaw-map-directory__header flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="tanaw-map-directory__place">
            <MapPinned size={14} aria-hidden="true" /> San Pedro, Laguna
          </p>
          <h2 id="spatial-directory-title" className="tanaw-map-directory__title font-display font-bold">
            Spatial Directory
          </h2>
        </div>
        <div className="tanaw-map-directory__coverage">
          {boundaryFeatureCount > 0 && <strong>{boundaryFeatureCount}</strong>}
          <span>{boundarySummary}</span>
        </div>
      </header>

      <section className="tanaw-map-directory__controls shrink-0" aria-label="Directory filters and map controls">
        <div className="tanaw-map-directory__selector relative z-20 grid items-end gap-3 @min-[27rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
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
          <div className="grid min-w-0 gap-2">
            <label htmlFor="directory-enterprise-search" className="tanaw-directory-select-label tracking-label text-xs font-bold uppercase">
              Enterprise search
            </label>
            <SearchField id="directory-enterprise-search" value={enterpriseSearch} onChange={setEnterpriseSearch} label="Search enterprises" placeholder="Name or address" className="[&_input]:h-11" />
          </div>
        </div>

        <div className="tanaw-map-directory__toolbar" role="group" aria-label="Map display">
          <button
            type="button"
            title={showBoundaries ? "Hide barangay boundaries" : "Show barangay boundaries"}
            aria-pressed={showBoundaries}
            onClick={() => onShowBoundariesChange(!showBoundaries)}
            className="tanaw-map-directory__toggle"
          >
            <Layers2 size={15} aria-hidden="true" /> Boundaries
          </button>
          <button
            type="button"
            aria-label="Show Map Labels"
            title={showLabels ? "Hide map labels" : "Show map labels"}
            aria-pressed={showLabels}
            onClick={onToggleLabels}
            className="tanaw-map-directory__toggle"
          >
            <Type size={15} aria-hidden="true" /> Labels
          </button>
          <button
            type="button"
            title="Fit all barangays"
            disabled={!props.isMapReady}
            onClick={onResetView}
            className="tanaw-map-directory__toggle tanaw-map-directory__reset"
          >
            <RotateCcw size={14} aria-hidden="true" /> Reset map view
          </button>
        </div>

        <MonitoringLegend />
      </section>

      <div className="tanaw-map-directory__body flex min-h-0 flex-1 flex-col">
        <EnterpriseList
          key={selectedBarangayName ?? "all"}
          title={selectedBarangayName ? `Barangay ${selectedBarangayName}` : "All Enterprises"}
          count={count}
          onBack={selectedBarangayName ? () => onClearBarangay("back") : undefined}
        >
          {pinned.map((enterprise) => (
            <li key={enterprise.id}>
              <EnterpriseMapCard enterprise={enterprise} selected={selectedEnterpriseId === enterprise.id} onClick={() => onSelectEnterprise(enterprise)} onHoverChange={onHoverEnterprise} />
            </li>
          ))}
          {unpinned.map((enterprise) => (
            <li key={enterprise.id}>
              <UnpinnedEnterpriseCard enterprise={enterprise} />
            </li>
          ))}
          {count === 0 && (
            <DirectoryEmptyMessage>
              {isEnterpriseError ? (
                <span className="flex flex-col items-center gap-3">
                  <span>Unable to load enterprise registry.</span>
                  <button type="button" onClick={onRetry} className="tanaw-map-directory__retry">
                    <RefreshCw size={13} aria-hidden="true" /> Retry
                  </button>
                </span>
              ) : isEnterpriseLoading ? (
                "Loading enterprises..."
              ) : (
                emptyMessage
              )}
            </DirectoryEmptyMessage>
          )}
        </EnterpriseList>
      </div>
    </div>
  );
}
