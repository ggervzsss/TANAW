import { AlertTriangle, MapPin } from "lucide-react";
import type { FormEvent } from "react";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import type { EnterpriseFormErrors, EnterpriseFormState } from "../model";
import type { PendingEnterpriseSave } from "../hooks";
import type { LocationDraft } from "../types";
import { EnterpriseChangesConfirmation } from "./EnterpriseAccountConfirmations";
import { EnterpriseAccountFields } from "./EnterpriseAccountFields";
import { LocationPicker } from "./LocationPicker";

type Props = {
  detectedBarangay: string | null;
  enterpriseId: string;
  errors: EnterpriseFormErrors;
  form: EnterpriseFormState;
  isPending: boolean;
  location: LocationDraft | null;
  locationError: string | null;
  pendingSave: PendingEnterpriseSave | null;
  reviewingSave: boolean;
  onBoundaryDetection: (location: LocationDraft, resolution: BarangayPointResolution) => void;
  onCancel: () => void;
  onCancelReview: () => void;
  onConfirmSave: () => void;
  onFieldChange: <FieldName extends keyof EnterpriseFormState>(field: FieldName, value: EnterpriseFormState[FieldName]) => void;
  onLocationChange: (location: LocationDraft, resolution?: BarangayPointResolution) => void;
  onLocationReject: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function EnterpriseDetailsEditForm(props: Props) {
  const {
    detectedBarangay,
    enterpriseId,
    errors,
    form,
    isPending,
    location,
    locationError,
    pendingSave,
    reviewingSave,
    onBoundaryDetection,
    onCancel,
    onCancelReview,
    onConfirmSave,
    onFieldChange,
    onLocationChange,
    onLocationReject,
    onSubmit,
  } = props;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <EnterpriseAccountFields mode="edit" form={form} errors={errors} onChange={onFieldChange} />
        <section
          data-field-name="location"
          tabIndex={-1}
          className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/20 md:col-span-2 dark:border-emerald-300/20 dark:bg-emerald-400/6"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-wide text-slate-600 uppercase">Map Location</p>
              <p className="mt-1 text-sm text-slate-500">Click or drag the current pin. Only locations inside San Pedro can be saved.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm">
              <MapPin size={14} />
              {location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "Not pinned"}
            </span>
          </div>
          <LocationPicker
            location={location}
            mapId={`enterprise-edit-location-${enterpriseId}`}
            mapHeightClassName="h-80"
            onBoundaryDetection={onBoundaryDetection}
            onChange={onLocationChange}
            onReject={onLocationReject}
            onSearchResultSelect={(suggestion) => onFieldChange("address", suggestion.addressLine)}
          />
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <LocationDetail label="Detected Barangay" value={detectedBarangay ?? (location ? "Detecting boundary..." : "No pin selected")} />
            <LocationDetail label="Selected Barangay" value={form.barangay || "Not selected"} />
            <LocationDetail label="Registered Address" value={form.address.trim() || "Not provided"} />
          </dl>
          {locationError && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{locationError}</span>
            </div>
          )}
        </section>
      </div>
      {reviewingSave && pendingSave && (
        <EnterpriseChangesConfirmation
          title="Are you sure you want to save these enterprise account changes?"
          changes={pendingSave.changes}
          confirmLabel="Confirm Save"
          isPending={isPending}
          onCancel={onCancelReview}
          onConfirm={onConfirmSave}
        />
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="bg-tanaw-green rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70"
        >
          Review Changes
        </button>
      </div>
    </form>
  );
}

function LocationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-[#121c31]">
      <dt className="text-[10px] font-black tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-bold wrap-break-word text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}
