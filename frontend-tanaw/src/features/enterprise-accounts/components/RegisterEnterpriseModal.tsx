import { type FormEvent, useState } from "react";
import { AlertTriangle, CheckCircle2, Maximize2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import { ModalFrame } from "@/shared/components/ui";
import { createEnterpriseAccount } from "@/shared/services/accountManagement";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import type { LocationDraft } from "../types";
import { getLocationSummary } from "../utils";
import {
  createEmptyEnterpriseForm,
  getInvalidEnterpriseFieldNames,
  sanPedroBarangayValues,
  toCreateEnterprisePayload,
  validateEnterpriseForm,
  type EnterpriseCreateFormErrors,
  type EnterpriseCreateFormState,
} from "../model";
import { EnterpriseAccountFields } from "./EnterpriseAccountFields";
import { BoundaryToggleButton, EnterpriseFullMapView, LocationStatusPanel } from "./EnterpriseRegistrationLocation";
import { LocationPicker } from "./LocationPicker";

type RegisterEnterpriseModalProps = {
  onClose: () => void;
};

export function RegisterEnterpriseModal({ onClose }: RegisterEnterpriseModalProps) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const [location, setLocation] = useState<LocationDraft | null>(null);
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [isFullMapOpen, setIsFullMapOpen] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [form, setForm] = useState<EnterpriseCreateFormState>(createEmptyEnterpriseForm);
  const [errors, setErrors] = useState<EnterpriseCreateFormErrors>({});
  const [locationError, setLocationError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createEnterpriseAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["email-deliveries"] }),
      ]);
      toast.success("Enterprise account created; activation email queued");
      onClose();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to create enterprise account")),
  });
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget, getInvalidEnterpriseFieldNames(nextErrors));
      return;
    }
    if (!location) {
      setLocationError("Choose a map location inside San Pedro before saving.");
      focusFirstInvalidField(event.currentTarget, ["location"]);
      return;
    }
    if (locationError) {
      toast.error(locationError);
      return;
    }

    createMutation.mutate(toCreateEnterprisePayload(form, location));
  };

  return (
    <>
      <ModalFrame title="Register Enterprise" onClose={isFullMapOpen ? () => setIsFullMapOpen(false) : onClose} maxWidthClassName="max-w-5xl">
        <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <EnterpriseAccountFields
            mode="create"
            form={form}
            errors={errors}
            enterpriseId={form.enterpriseId}
            onChange={updateField}
            onEnterpriseIdChange={(value) => updateField("enterpriseId", value)}
          />

          <div
            data-field-name="location"
            className="rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.68)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.7)_100%)] p-4 shadow-sm ring-1 ring-white md:col-span-2 dark:border-emerald-300/20 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)] dark:ring-white/8"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">Map Location</p>
                <p className="mt-1 text-sm text-slate-500">{location ? getLocationSummary(location) : "No marker confirmed yet. Click inside San Pedro to place it manually."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BoundaryToggleButton showBoundaries={showBoundaries} onClick={() => setShowBoundaries((current) => !current)} />
                <button
                  type="button"
                  data-form-error-focus
                  onClick={() => setIsFullMapOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                >
                  <Maximize2 size={15} />
                  Full Map View
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <LocationPicker
                location={location}
                mapId="enterprise-location-picker"
                mapHeightClassName="h-80"
                showBoundaries={showBoundaries}
                resizeSignal={showBoundaries ? "boundaries-on" : "boundaries-off"}
                onBoundaryDetection={applyBoundaryDetection}
                onChange={applySelectedLocation}
                onReject={handleLocationRejected}
              />
              <LocationStatusPanel
                address={form.address}
                barangay={form.barangay}
                detectedBarangay={detectedBarangay}
                location={location}
                locationError={locationError}
                locationNotice={locationNotice}
              />
            </div>

            {locationError && (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{locationError}</span>
              </div>
            )}
          </div>

          <div className="tanaw-information-banner flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 ring-1 ring-white md:col-span-2 dark:ring-white/5">
            <CheckCircle2 className="tanaw-information-banner__icon mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-emerald-800 dark:text-emerald-100">
              TANAW will queue a secure activation link for the registered contact email. The enterprise user will choose a private password before signing in to the TANAW Enterprise desktop
              application.
            </p>
          </div>

          <button
            disabled={createMutation.isPending}
            className="bg-tanaw-green rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(5,91,37,0.22)] transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70 md:col-span-2"
          >
            {createMutation.isPending ? "Registering..." : "Register Enterprise"}
          </button>
        </form>
      </ModalFrame>

      <AnimatePresence>
        {isFullMapOpen && (
          <EnterpriseFullMapView
            address={form.address}
            barangay={form.barangay}
            detectedBarangay={detectedBarangay}
            location={location}
            locationError={locationError}
            locationNotice={locationNotice}
            showBoundaries={showBoundaries}
            onBoundaryDetection={applyBoundaryDetection}
            onChange={applySelectedLocation}
            onClose={() => setIsFullMapOpen(false)}
            onReject={handleLocationRejected}
            onToggleBoundaries={() => setShowBoundaries((current) => !current)}
          />
        )}
      </AnimatePresence>
    </>
  );

  function updateField<FieldName extends keyof EnterpriseCreateFormState>(field: FieldName, value: EnterpriseCreateFormState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function applySelectedLocation(nextLocation: LocationDraft, barangayDetection?: BarangayPointResolution) {
    const barangayName = barangayDetection?.barangayName ?? null;
    setLocation(nextLocation);
    setDetectedBarangay(barangayName);
    setLocationError(null);
    setLocationNotice(getPolygonLocationNotice(barangayDetection));
    if (barangayName && sanPedroBarangayValues.has(barangayName)) {
      setForm((current) => ({ ...current, barangay: barangayName }));
    }
  }

  function applyBoundaryDetection(selectedLocation: LocationDraft, barangayDetection: BarangayPointResolution) {
    if (!location || !locationsMatch(location, selectedLocation)) return;

    const barangayName = barangayDetection.barangayName;
    setDetectedBarangay(barangayName);
    setLocationError(null);
    setLocationNotice(getPolygonLocationNotice(barangayDetection));
    if (barangayName && sanPedroBarangayValues.has(barangayName)) {
      setForm((current) => ({ ...current, barangay: barangayName }));
    }
  }

  function handleLocationRejected(message: string) {
    setLocationError(message);
    toast.error(message);
  }
}

function locationsMatch(left: LocationDraft, right: LocationDraft) {
  return Math.abs(left.latitude - right.latitude) < 0.000001 && Math.abs(left.longitude - right.longitude) < 0.000001;
}

function getPolygonLocationNotice(barangayDetection: BarangayPointResolution | undefined) {
  if (!barangayDetection) return "Marker placed inside San Pedro. Drag it to adjust the exact location.";
  if (!barangayDetection.barangayName) return "Marker placed inside San Pedro city bounds. Barangay boundary data is unavailable.";
  if (barangayDetection.isAmbiguous) {
    return `Multiple barangay boundaries matched this marker; using ${barangayDetection.barangayName} by polygon priority.`;
  }
  return `Barangay polygon detected: ${barangayDetection.barangayName}.`;
}
