import { Activity, ArrowLeft, Building2, Map as MapIcon, MapPin, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { SelectDropdown, type SelectDropdownOption } from "@/shared/components/ui";
import type { AccountSummary } from "@/shared/services/accountManagement";
import type { MapEnterprise } from "@/shared/types";
import { getDarkMonitoringBadgeClass, getOccupancyBadgeClass, normalizeBarangayName, type MapDeselectReason } from "../utils";

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
    <>
      <AnimatePresence initial={false}>{!isCollapsed && <SpatialDirectory {...props} />}</AnimatePresence>
      {isCollapsed && (
        <motion.button
          type="button"
          aria-controls="spatial-directory-panel"
          aria-label="Expand spatial directory"
          title="Expand spatial directory"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={() => onCollapseChange(false)}
          className="focus:ring-tanaw-sky absolute top-4 left-4 z-430 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-400/35 bg-[#0b1527]/92 text-white shadow-[0_18px_46px_rgba(0,0,0,0.44)] backdrop-blur-xl transition hover:border-slate-300/45 hover:bg-[#132139] focus:ring-2 focus:outline-none"
        >
          <PanelLeftOpen size={18} />
        </motion.button>
      )}
    </>
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
    onCollapseChange,
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
    <motion.aside
      id="spatial-directory-panel"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="tanaw-map-directory absolute top-4 bottom-4 left-4 z-420 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-400/35 bg-[#0b1527]/92 shadow-[0_28px_80px_rgba(0,0,0,0.52)] ring-1 ring-white/8 backdrop-blur-xl"
    >
      <div className="tanaw-map-directory__header flex shrink-0 flex-col gap-3 border-b border-slate-500/35 bg-[#111f34]/90 px-4 py-3.5">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <span className="flex items-center gap-2 text-[10px] font-black tracking-widest text-white uppercase">
              <MapIcon size={14} className="text-tanaw-sky" /> Spatial Directory
            </span>
            <p className="mt-1 text-[9px] font-bold tracking-widest text-white/65 uppercase">
              {directoryStatus({ boundaryFeatureCount, isBoundaryError, isBoundaryLoading, isEnterpriseError, isEnterpriseLoading, selectedBarangayEnterprises, selectedBarangayName })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title={showBoundaries ? "Hide barangay boundaries" : "Show barangay boundaries"}
              aria-pressed={showBoundaries}
              onClick={() => onShowBoundariesChange(!showBoundaries)}
              className={`focus:ring-tanaw-sky rounded border px-2 py-1 text-[9px] font-black tracking-widest uppercase transition focus:ring-2 focus:outline-none ${showBoundaries ? "border-emerald-400/45 bg-emerald-500/25 text-white shadow-sm shadow-emerald-950/30" : "border-white/20 bg-white/10 text-white/75 hover:border-white/30 hover:bg-white/15 hover:text-white"}`}
            >
              Boundaries
            </button>
            <button
              type="button"
              aria-controls="spatial-directory-panel"
              aria-label="Collapse spatial directory"
              title="Collapse spatial directory"
              onClick={() => onCollapseChange(true)}
              className="focus:ring-tanaw-sky flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/20 bg-white/10 text-white/80 transition hover:border-white/30 hover:bg-white/15 hover:text-white focus:ring-2 focus:outline-none"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
        </div>
        <MonitoringLegend />
      </div>

      <div className="tanaw-map-directory__selector relative z-20 shrink-0 overflow-visible border-b border-slate-500/30 bg-[#0d192b]/92 px-4 py-3.5">
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
    </motion.aside>
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
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3"
    >
      <div className="tanaw-map-directory__card shrink-0 rounded-xl border border-slate-400/25 bg-[#15233a]/82 p-3 shadow-sm shadow-black/20">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Back to Barangay Directory"
            title="Return to all barangays"
            onClick={onBack}
            className="focus:ring-tanaw-sky inline-flex min-h-7 items-center gap-1.5 rounded-md border border-white/15 bg-slate-950/35 px-2 py-1 text-[9px] font-black tracking-widest text-white/75 uppercase transition hover:border-emerald-300/35 hover:bg-slate-950/55 hover:text-white focus:ring-2 focus:outline-none"
          >
            <ArrowLeft size={12} className="text-tanaw-sky shrink-0" /> All Barangays
          </button>
          <span className="shrink-0 rounded border border-white/15 bg-black/35 px-2 py-1 font-mono text-[9px] font-black tracking-widest text-white uppercase">{pinned.length + unpinned.length}</span>
        </div>
        <h3 className="text-sm leading-tight font-black tracking-wide text-white uppercase">Barangay {selectedBarangayName}</h3>
        <p className="mt-1 text-[9px] font-bold tracking-widest text-white/65 uppercase">Enterprises within this barangay</p>
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-3"
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
                <button
                  type="button"
                  onClick={onRetry}
                  className="focus:ring-tanaw-sky inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2 py-1 text-[9px] font-black tracking-widest text-white transition hover:bg-white/15 focus:ring-2 focus:outline-none"
                >
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

function EnterpriseList({ children, count, title }: { children: ReactNode; count: ReactNode; title: string }) {
  return (
    <div className="tanaw-map-directory__card flex min-h-0 flex-1 flex-col rounded-xl border border-slate-400/25 bg-[#111e32]/88 p-3 shadow-sm shadow-black/20">
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[9px] font-black tracking-widest text-white/80 uppercase">
          <Building2 size={13} className="text-tanaw-sky" /> {title}
        </h3>
        <span className="shrink-0 text-right text-[9px] leading-tight font-bold tracking-widest text-white/65 uppercase">{count}</span>
      </div>
      <div className="tanaw-map-directory__list min-h-0 flex-1 space-y-2 overflow-y-auto pr-1.5">{children}</div>
    </div>
  );
}

function DirectoryEmptyMessage({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-white/15 bg-black/20 p-4 text-center text-[10px] leading-relaxed font-bold tracking-widest text-white/65 uppercase">{children}</div>;
}

function EnterpriseMapCard({ enterprise, selected, onClick }: { enterprise: MapEnterprise; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus:ring-tanaw-sky w-full rounded-lg border p-2.5 text-left shadow-sm shadow-black/15 transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/10 focus:ring-2 focus:outline-none ${selected ? "border-tanaw-sky/60 bg-tanaw-sky/15" : "border-white/15 bg-slate-950/35"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.name}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">{enterprise.fullAddress}</span>
          </div>
        </div>
        <span
          className={`flex max-w-[46%] shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-center text-[9px] leading-tight font-black tracking-widest uppercase ${getDarkMonitoringBadgeClass(enterprise.monitoringStatus)}`}
        >
          {enterprise.monitoringStatus}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">
          {enterprise.cameraMonitoring ? `${enterprise.cameraMonitoring.healthyCameraCount}/${enterprise.cameraMonitoring.configuredCameraCount} cameras` : "No camera telemetry"}
        </span>
        <span className={`justify-self-end rounded border px-1.5 py-0.5 font-sans text-[8px] font-black tracking-wider uppercase ${getOccupancyBadgeClass(enterprise.occupancyStatus)}`}>
          {enterprise.occupancyStatus}
        </span>
        <span className="text-white/70">Live Occupancy</span>
        <span className="flex items-center justify-end gap-1 font-bold text-white">
          <Activity size={12} className="text-tanaw-sky" />
          {enterprise.totalLiveOccupancy.toLocaleString()}
        </span>
        <span className="text-white/70">Est. Unique</span>
        <span className="text-right font-bold text-white">{enterprise.estimatedUniqueCount.toLocaleString()}</span>
      </div>
    </button>
  );
}

function MonitoringLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[8px] font-bold tracking-wider text-white/70 uppercase">
      <LegendItem color="#16a34a" label="All Running" />
      <LegendItem color="#ea580c" label="Partial" />
      <LegendItem color="#64748b" label="Stopped" />
      <LegendItem color="#dc2626" label="Fault" />
      <span className="text-white/50">Outer ring: occupancy alert</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full ring-1 ring-white/40" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function UnpinnedEnterpriseCard({ enterprise }: { enterprise: AccountSummary }) {
  const statusLabel = enterprise.latitude === null || enterprise.longitude === null ? "Not Pinned" : "Needs Correction";
  return (
    <div className="w-full rounded-lg border border-dashed border-white/15 bg-slate-950/25 p-2.5 text-left shadow-sm shadow-black/15">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[12px] leading-tight font-bold text-white">{enterprise.enterpriseName ?? enterprise.displayName}</h4>
          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold tracking-widest text-white/70 uppercase">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">{enterprise.address ?? "Address not provided"}</span>
          </div>
        </div>
        <span className="flex max-w-[46%] shrink-0 items-center justify-center rounded border border-amber-400/30 bg-amber-900/35 px-1.5 py-0.5 text-center text-[9px] leading-tight font-black tracking-widest text-amber-100 uppercase">
          {statusLabel}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/15 pt-2 font-mono text-[10px]">
        <span className="truncate text-white/70">{enterprise.category ?? "Uncategorized"}</span>
        <span className="truncate text-right font-bold text-white">{enterprise.barangay ?? "Unassigned"}</span>
      </div>
    </div>
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
