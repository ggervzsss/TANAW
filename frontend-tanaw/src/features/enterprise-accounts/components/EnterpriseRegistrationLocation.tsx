import { AlertTriangle, CheckCircle2, Layers, MapPin, X } from "lucide-react";
import { motion } from "motion/react";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import { ModalPortal } from "@/shared/components/ui";
import type { EnterpriseLocationSuggestion, LocationDraft } from "../types";
import { LocationPicker } from "./LocationPicker";

type FullMapViewProps = LocationStatusProps & {
  showBoundaries: boolean;
  onBoundaryDetection: (location: LocationDraft, barangayDetection: BarangayPointResolution) => void;
  onChange: (location: LocationDraft, barangayDetection?: BarangayPointResolution) => void;
  onClose: () => void;
  onReject: (message: string) => void;
  onSearchResultSelect: (suggestion: EnterpriseLocationSuggestion) => void;
  onToggleBoundaries: () => void;
};

type LocationStatusProps = {
  address: string;
  barangay: string;
  detectedBarangay: string | null;
  location: LocationDraft | null;
  locationError: string | null;
  locationNotice: string | null;
};

export function EnterpriseFullMapView({
  address,
  barangay,
  detectedBarangay,
  location,
  locationError,
  locationNotice,
  showBoundaries,
  onBoundaryDetection,
  onChange,
  onClose,
  onReject,
  onSearchResultSelect,
  onToggleBoundaries,
}: FullMapViewProps) {
  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1500 flex min-h-dvh items-center justify-center bg-[rgba(3,20,12,0.72)] p-4 backdrop-blur-[7px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={onClose}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label="Full map view"
          className="relative z-1501 flex max-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.42)] ring-1 ring-black/5 dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.55)] dark:ring-white/8"
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.985 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="from-tanaw-green to-tanaw-lime h-1.5 bg-linear-to-r via-[#d9b44a]" />
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] px-5 py-4 dark:border-slate-600 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)]">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.18em] text-emerald-700/80 uppercase">Map Location</p>
              <h3 className="text-tanaw-navy mt-1 text-xl leading-tight font-bold">Full Map View</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Click inside San Pedro or drag the marker to refine the exact enterprise location.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <BoundaryToggleButton showBoundaries={showBoundaries} onClick={onToggleBoundaries} />
              <button
                type="button"
                onClick={onClose}
                className="hover:text-tanaw-green focus:ring-tanaw-green/15 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 focus:ring-4 focus:outline-none dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-[#1d2940] dark:hover:text-emerald-200"
                aria-label="Close full map view"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <LocationPicker
              location={location}
              mapId="enterprise-location-picker-full"
              mapHeightClassName="h-[min(66dvh,680px)] min-h-105"
              resizeSignal={showBoundaries ? "full-boundaries-on" : "full-boundaries-off"}
              showBoundaries={showBoundaries}
              onBoundaryDetection={onBoundaryDetection}
              onChange={onChange}
              onReject={onReject}
              onSearchResultSelect={onSearchResultSelect}
            />
            <div className="flex min-h-0 flex-col gap-3">
              <LocationStatusPanel address={address} barangay={barangay} detectedBarangay={detectedBarangay} location={location} locationError={locationError} locationNotice={locationNotice} />
              <button
                type="button"
                onClick={onClose}
                className="bg-tanaw-green mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#044a1e]"
              >
                <CheckCircle2 size={16} />
                Use Selected Location
              </button>
            </div>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}

export function LocationStatusPanel({ address, barangay, detectedBarangay, location, locationError, locationNotice }: LocationStatusProps) {
  return (
    <aside className="rounded-2xl border border-emerald-100 bg-white/86 p-4 text-sm shadow-sm ring-1 ring-white dark:border-emerald-300/20 dark:bg-[#121c31]/92 dark:ring-white/8">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          {locationError ? <AlertTriangle size={17} /> : location ? <CheckCircle2 size={17} /> : <MapPin size={17} />}
        </span>
        <div>
          <p className="text-[10px] font-black tracking-[0.18em] text-slate-500 uppercase">Location Status</p>
          <p className={`text-sm font-bold ${locationError ? "text-amber-700" : location ? "text-emerald-700" : "text-slate-700"}`}>
            {locationError ? "Needs review" : location ? "Inside San Pedro" : "Marker not set"}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <SummaryRow label="Detected Barangay" value={detectedBarangay || "Not detected yet"} />
        <SummaryRow label="Selected Barangay" value={barangay || "Not detected yet"} />
        <SummaryRow label="Block / Lot / Street" value={address || "Enter the address manually above"} />
        <SummaryRow label="Coordinates" value={location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "No coordinates yet"} />
      </div>

      {(locationNotice || locationError) && (
        <div
          className={`mt-4 rounded-xl border px-3 py-2 text-xs font-semibold ${locationError ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}
        >
          {locationError ?? locationNotice}
        </div>
      )}
    </aside>
  );
}

export function BoundaryToggleButton({ showBoundaries, onClick }: { showBoundaries: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={showBoundaries}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
    >
      <Layers size={15} />
      {showBoundaries ? "Hide Boundaries" : "Show Boundaries"}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-[#0f172a]">
      <p className="text-[10px] font-black tracking-[0.15em] text-slate-500 uppercase">{label}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold wrap-break-word text-slate-800">{value}</p>
    </div>
  );
}
