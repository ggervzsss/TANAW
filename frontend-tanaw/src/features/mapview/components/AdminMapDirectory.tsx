import { ArrowLeft, ChevronLeft, ChevronRight, MapPinned, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { SelectDropdown, type SelectDropdownOption } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/types";
import type { MapEnterprise } from "@/shared/types";
import { normalizeBarangayName, type MapDeselectReason } from "../utils";
import { DirectoryEmptyMessage, EnterpriseList, EnterpriseMapCard, MonitoringLegend, UnpinnedEnterpriseCard } from "./MapDirectoryCards";

type AdminMapDirectoryProps = {
  barangayDropdownOptions: SelectDropdownOption[];
  boundaryFeatureCount: number;
  enterpriseAccounts: AccountSummary[];
  isBoundaryError: boolean;
  isBoundaryLoading: boolean;
  isCollapsed: boolean;
  isEnterpriseError: boolean;
  isEnterpriseLoading: boolean;
  mapEnterprises: MapEnterprise[];
  onClearBarangay: (reason: MapDeselectReason) => void;
  onCollapseChange: (collapsed: boolean) => void;
  onRetry: () => void;
  onSelectBarangay: (barangayName: string) => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  onShowBoundariesChange: (show: boolean) => void;
  selectedBarangayEnterprises: MapEnterprise[];
  selectedBarangayName: string | null;
  selectedBarangayUnpinnedEnterprises: AccountSummary[];
  selectedEnterpriseId: string | null;
  showBoundaries: boolean;
  unpinnedEnterprises: AccountSummary[];
};

export function AdminMapDirectory(props: AdminMapDirectoryProps) {
  const { isCollapsed, onCollapseChange } = props;

  return (
    <aside id="spatial-directory-panel" data-directory-state={isCollapsed ? "collapsed" : "expanded"} className="tanaw-spatial-directory-frame absolute top-4 bottom-4 left-4 z-420 overflow-visible">
      <div className="tanaw-spatial-directory-shell absolute inset-y-0 left-0 overflow-hidden">
        <div inert={isCollapsed ? true : undefined} aria-hidden={isCollapsed} className="tanaw-spatial-directory-content h-full">
          <SpatialDirectory {...props} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {isCollapsed ? (
          <motion.button
            key="directory-reopen"
            type="button"
            aria-controls="spatial-directory-panel"
            aria-expanded="false"
            aria-label="Expand spatial directory"
            title="Expand spatial directory"
            initial={{ opacity: 0, x: -12, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => onCollapseChange(false)}
            className="tanaw-spatial-directory__reopen absolute top-1/2 left-0 z-430 flex min-h-12 -translate-y-1/2 items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left"
          >
            <span className="tanaw-spatial-directory__reopen-icon grid h-8 w-8 shrink-0 place-items-center rounded-xl" aria-hidden="true">
              <MapPinned size={17} />
            </span>
            <span className="text-sm font-semibold whitespace-nowrap">Spatial Directory</span>
            <ChevronRight size={17} className="shrink-0" aria-hidden="true" />
          </motion.button>
        ) : (
          <motion.button
            key="directory-collapse"
            type="button"
            aria-controls="spatial-directory-panel"
            aria-expanded="true"
            aria-label="Collapse spatial directory"
            title="Collapse spatial directory"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => onCollapseChange(true)}
            className="tanaw-spatial-directory__collapse absolute top-1/2 z-430 grid h-12 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl"
          >
            <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </aside>
  );
}

function SpatialDirectory(props: AdminMapDirectoryProps) {
  const {
    barangayDropdownOptions,
    boundaryFeatureCount,
    enterpriseAccounts,
    isBoundaryError,
    isBoundaryLoading,
    isEnterpriseError,
    isEnterpriseLoading,
    mapEnterprises,
    onClearBarangay,
    onRetry,
    onSelectBarangay,
    onSelectEnterprise,
    onShowBoundariesChange,
    selectedBarangayEnterprises,
    selectedBarangayName,
    selectedBarangayUnpinnedEnterprises,
    selectedEnterpriseId,
    showBoundaries,
    unpinnedEnterprises,
  } = props;

  return (
    <div className="tanaw-map-directory flex h-full flex-col">
      <header className="tanaw-map-directory__header shrink-0 px-5 pt-5 pb-4">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="tanaw-map-directory__title-icon grid h-10 w-10 shrink-0 place-items-center rounded-xl" aria-hidden="true">
              <MapPinned size={19} />
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 className="tanaw-map-directory__title text-sm leading-tight font-bold tracking-[0.08em] uppercase">Spatial Directory</h2>
              <p className="tanaw-map-directory__subtitle mt-1 text-[11px] leading-snug font-medium">
                {directoryStatus({ boundaryFeatureCount, isBoundaryError, isBoundaryLoading, isEnterpriseError, isEnterpriseLoading, selectedBarangayEnterprises, selectedBarangayName })}
              </p>
            </div>
          </div>
          <button
            type="button"
            title={showBoundaries ? "Hide barangay boundaries" : "Show barangay boundaries"}
            aria-pressed={showBoundaries}
            onClick={() => onShowBoundariesChange(!showBoundaries)}
            className="tanaw-map-directory__boundaries inline-flex min-h-10 shrink-0 items-center rounded-xl border px-3 text-[11px] font-bold tracking-[0.06em] uppercase"
          >
            Boundaries
          </button>
        </div>
        <MonitoringLegend />
      </header>

      <div className="tanaw-map-directory__selector relative z-20 shrink-0 overflow-visible px-5 py-4">
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {selectedBarangayName ? (
            <SelectedBarangayDirectory
              key={`barangay-enterprises-${normalizeBarangayName(selectedBarangayName)}`}
              isEnterpriseError={isEnterpriseError}
              onBack={() => onClearBarangay("back")}
              onSelectEnterprise={onSelectEnterprise}
              pinned={selectedBarangayEnterprises}
              selectedBarangayName={selectedBarangayName}
              selectedEnterpriseId={selectedEnterpriseId}
              unpinned={selectedBarangayUnpinnedEnterprises}
            />
          ) : (
            <AllEnterprisesDirectory
              key="all-enterprises-view"
              enterpriseAccounts={enterpriseAccounts}
              isEnterpriseError={isEnterpriseError}
              isEnterpriseLoading={isEnterpriseLoading}
              mapEnterprises={mapEnterprises}
              onRetry={onRetry}
              onSelectEnterprise={onSelectEnterprise}
              selectedEnterpriseId={selectedEnterpriseId}
              unpinnedEnterprises={unpinnedEnterprises}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SelectedBarangayDirectory({
  isEnterpriseError,
  onBack,
  onSelectEnterprise,
  pinned,
  selectedBarangayName,
  selectedEnterpriseId,
  unpinned,
}: {
  isEnterpriseError: boolean;
  onBack: () => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  pinned: MapEnterprise[];
  selectedBarangayName: string;
  selectedEnterpriseId: string | null;
  unpinned: AccountSummary[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3.5"
    >
      <div className="tanaw-map-directory__barangay-summary shrink-0 rounded-2xl p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Back to Barangay Directory"
            title="Return to all barangays"
            onClick={onBack}
            className="tanaw-map-directory__back inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold tracking-[0.06em] uppercase"
          >
            <ArrowLeft size={12} className="text-tanaw-sky shrink-0" /> All Barangays
          </button>
          <span className="tanaw-map-directory__count shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold">{pinned.length + unpinned.length}</span>
        </div>
        <h3 className="tanaw-map-directory__section-title text-sm leading-tight font-bold">Barangay {selectedBarangayName}</h3>
        <p className="tanaw-map-directory__section-copy mt-1 text-[11px] font-medium">Enterprises within this barangay</p>
      </div>
      <EnterpriseList title="Enterprises within this Barangay" count={pinned.length + unpinned.length}>
        {pinned.map((enterprise, index) => (
          <motion.div key={enterprise.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.12), ease: "easeOut" }}>
            <EnterpriseMapCard enterprise={enterprise} selected={selectedEnterpriseId === enterprise.id} onClick={() => onSelectEnterprise(enterprise)} />
          </motion.div>
        ))}
        {unpinned.map((enterprise) => (
          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
        ))}
        {pinned.length === 0 && unpinned.length === 0 && (
          <DirectoryEmptyMessage>{isEnterpriseError ? "Unable to load enterprise registry." : "No registered enterprises found for this barangay yet."}</DirectoryEmptyMessage>
        )}
      </EnterpriseList>
    </motion.div>
  );
}

function AllEnterprisesDirectory({
  enterpriseAccounts,
  isEnterpriseError,
  isEnterpriseLoading,
  mapEnterprises,
  onRetry,
  onSelectEnterprise,
  selectedEnterpriseId,
  unpinnedEnterprises,
}: {
  enterpriseAccounts: AccountSummary[];
  isEnterpriseError: boolean;
  isEnterpriseLoading: boolean;
  mapEnterprises: MapEnterprise[];
  onRetry: () => void;
  onSelectEnterprise: (enterprise: MapEnterprise) => void;
  selectedEnterpriseId: string | null;
  unpinnedEnterprises: AccountSummary[];
}) {
  const count = unpinnedEnterprises.length > 0 ? `${mapEnterprises.length} pinned / ${unpinnedEnterprises.length} unpinned` : enterpriseAccounts.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5"
    >
      <EnterpriseList title="All Enterprises" count={count}>
        {mapEnterprises.map((enterprise) => (
          <EnterpriseMapCard key={enterprise.id} enterprise={enterprise} selected={selectedEnterpriseId === enterprise.id} onClick={() => onSelectEnterprise(enterprise)} />
        ))}
        {unpinnedEnterprises.map((enterprise) => (
          <UnpinnedEnterpriseCard key={enterprise.id} enterprise={enterprise} />
        ))}
        {enterpriseAccounts.length === 0 && (
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
}: Pick<
  AdminMapDirectoryProps,
  "boundaryFeatureCount" | "isBoundaryError" | "isBoundaryLoading" | "isEnterpriseError" | "isEnterpriseLoading" | "selectedBarangayEnterprises" | "selectedBarangayName"
>) {
  if (selectedBarangayName) return `${selectedBarangayEnterprises.length} registered enterprises`;
  if (isBoundaryLoading) return "Loading refined boundaries";
  if (isBoundaryError) return "Boundary layer unavailable";
  if (isEnterpriseError) return "Enterprise registry unavailable";
  if (isEnterpriseLoading) return "Loading enterprises";
  return `${boundaryFeatureCount} barangay boundaries`;
}
