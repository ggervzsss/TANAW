import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Building2, KeyRound, MapPin, Pencil, UserCheck, XCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import toast from "react-hot-toast/headless";
import { ModalFrame } from "@/shared/components/ui";
import { type AccountSummary, type UpdateEnterpriseAccountPayload, resendAccountActivation, updateAccountStatus, updateEnterpriseAccount } from "@/shared/services/accountManagement";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { canDeactivateAccount } from "@/shared/utils/accountState";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import type { LocationDraft } from "../types";
import {
  createEnterpriseEditForm,
  getEnterpriseChanges,
  getInitialEnterpriseLocation,
  getInvalidEnterpriseFieldNames,
  sanPedroBarangayValues,
  toUpdateEnterprisePayload,
  validateEnterpriseForm,
  type EnterpriseFormErrors,
  type EnterpriseFormState,
} from "../model";
import { EnterpriseAccountFields } from "./EnterpriseAccountFields";
import { ConfirmEnterpriseActivationModal, ConfirmEnterpriseStatusModal, EnterpriseChangesConfirmation } from "./EnterpriseAccountConfirmations";
import { LocationPicker } from "./LocationPicker";

type EnterpriseDetailsModalProps = {
  enterprise: AccountSummary;
  onClose: () => void;
  onEnterpriseUpdated: (enterprise: AccountSummary) => void;
};

type ConfirmMode = null | "activation" | "save" | "status";

type PendingSave = {
  payload: UpdateEnterpriseAccountPayload;
  changes: string[];
};

export function EnterpriseDetailsModal({ enterprise, onClose, onEnterpriseUpdated }: EnterpriseDetailsModalProps) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const { timeFormat } = useSystemDisplayPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EnterpriseFormState>(() => createEnterpriseEditForm(enterprise));
  const [location, setLocation] = useState<LocationDraft | null>(() => getInitialEnterpriseLocation(enterprise));
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [errors, setErrors] = useState<EnterpriseFormErrors>({});
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const nextStatus = enterprise.status === "active" ? "inactive" : "active";

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateEnterpriseAccountPayload) => updateEnterpriseAccount(enterprise.id, payload),
    onSuccess: async (updatedEnterprise, payload) => {
      const activationEmailQueued = !enterprise.isActivated && updatedEnterprise.status === "active" && payload.email !== enterprise.email;
      const emailVerificationQueued = enterprise.isActivated && payload.email !== enterprise.email && updatedEnterprise.profileChangeRequests.some((request) => request.type === "businessEmail");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }),
        ...(activationEmailQueued || emailVerificationQueued
          ? [queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })]
          : []),
      ]);
      onEnterpriseUpdated(updatedEnterprise);
      setForm(createEnterpriseEditForm(updatedEnterprise));
      setLocation(getInitialEnterpriseLocation(updatedEnterprise));
      setDetectedBarangay(null);
      setLocationError(null);
      setConfirmMode(null);
      setPendingSave(null);
      setIsEditing(false);
      toast.success(
        activationEmailQueued
          ? "Enterprise account updated; activation email queued"
          : emailVerificationQueued
            ? "Enterprise account updated; email verification queued"
            : "Enterprise account updated",
      );
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update enterprise account")),
  });

  const activationMutation = useMutation({
    mutationFn: () => resendAccountActivation(enterprise.id),
    onSuccess: async (updatedEnterprise) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }),
        queryClient.invalidateQueries({ queryKey: ["email-deliveries"] }),
      ]);
      onEnterpriseUpdated(updatedEnterprise);
      setConfirmMode(null);
      toast.success("Activation email queued");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to resend activation email")),
  });

  const statusMutation = useMutation({
    mutationFn: () => updateAccountStatus(enterprise.id, nextStatus),
    onSuccess: async (updatedEnterprise) => {
      const activationEmailQueued = nextStatus === "active" && !updatedEnterprise.isActivated;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-accounts"] }),
        ...(activationEmailQueued ? [queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })] : []),
      ]);
      onEnterpriseUpdated(updatedEnterprise);
      setConfirmMode(null);
      toast.success(activationEmailQueued ? "Enterprise reactivated; activation email queued" : "Enterprise account status updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update enterprise status")),
  });

  const details = useMemo(
    () => [
      ["Enterprise", enterprise.enterpriseName ?? enterprise.displayName],
      ["Contact Email", enterprise.email],
      ["Contact Number", enterprise.phone ?? "Not provided"],
      ["Contact Manager", enterprise.managerName ?? "Not provided"],
      ["Category", enterprise.category ?? "Not provided"],
      ["Barangay", enterprise.barangay ?? "Not provided"],
      ["Building Capacity", `${enterprise.buildingCapacity.toLocaleString()} people`],
      ["Enterprise ID", enterprise.enterpriseId ?? "Pending"],
      ["Registered Address", enterprise.address ?? "Not provided"],
      ["Map Location", enterprise.latitude !== null && enterprise.longitude !== null ? `${enterprise.latitude.toFixed(6)}, ${enterprise.longitude.toFixed(6)}` : "Not pinned"],
      ["Status", enterprise.status],
      ["Created", formatPhilippineDateTime(enterprise.createdAt, timeFormat)],
      ["Activation", enterprise.isActivated ? "Complete" : "Pending"],
    ],
    [enterprise, timeFormat],
  );

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseForm(form);
    setErrors(nextErrors);
    setConfirmMode(null);
    setPendingSave(null);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget, getInvalidEnterpriseFieldNames(nextErrors));
      return;
    }
    if (location && detectedBarangay && detectedBarangay !== form.barangay) {
      setLocationError(`The selected pin is in ${detectedBarangay}. Use the detected barangay before saving.`);
      document.querySelector<HTMLElement>('[data-field-name="location"]')?.focus();
      return;
    }

    const payload = toUpdateEnterprisePayload(form, location);
    const changes = getEnterpriseChanges(enterprise, payload);
    if (changes.length === 0) {
      toast("No enterprise changes to save.");
      return;
    }
    setPendingSave({ payload, changes });
    setConfirmMode("save");
  };

  return (
    <>
      <ModalFrame title="Enterprise Details" onClose={onClose} maxWidthClassName="max-w-5xl" eyebrow="Accounts Management">
        <div className="space-y-6">
          <section className="rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <span className="bg-tgreen-dark/10 text-tgreen-dark flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
                  <Building2 size={24} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold tracking-wide text-emerald-700 uppercase">{enterprise.category ?? "Enterprise Account"}</p>
                  <h3 className="mt-1 truncate text-2xl font-black text-slate-950">{enterprise.enterpriseName ?? enterprise.displayName}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">{enterprise.email}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                  enterprise.status === "inactive" ? "bg-slate-100 text-slate-600" : enterprise.isActivated ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {enterprise.status === "inactive" ? "inactive" : enterprise.isActivated ? "active" : "pending activation"}
              </span>
            </div>
          </section>

          {!isEditing ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {details.map(([label, value]) => (
                  <DetailCard key={label} label={label} value={value} />
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-black tracking-wide text-slate-500 uppercase">Enterprise Actions</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="bg-tanaw-green focus:ring-tanaw-green/15 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 focus:ring-4 focus:outline-none"
                  >
                    <Pencil size={16} />
                    Edit account information
                  </button>
                  {!enterprise.isActivated && enterprise.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => setConfirmMode("activation")}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-bold text-amber-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-amber-100 focus:outline-none"
                    >
                      <KeyRound size={16} />
                      Resend activation email
                    </button>
                  ) : null}
                  {enterprise.status === "inactive" || canDeactivateAccount(enterprise) ? (
                    <button
                      type="button"
                      onClick={() => setConfirmMode("status")}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 focus:ring-4 focus:ring-slate-100 focus:outline-none"
                    >
                      {enterprise.status === "active" ? <XCircle size={16} /> : <UserCheck size={16} />}
                      {enterprise.status === "active" ? "Deactivate enterprise" : "Reactivate enterprise"}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={handleEditSubmit} noValidate className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <EnterpriseAccountFields mode="edit" form={form} errors={errors} onChange={updateField} />
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
                    mapId={`enterprise-edit-location-${enterprise.id}`}
                    mapHeightClassName="h-80"
                    onBoundaryDetection={applyBoundaryDetection}
                    onChange={applySelectedLocation}
                    onReject={handleLocationRejected}
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

              {confirmMode === "save" && pendingSave && (
                <EnterpriseChangesConfirmation
                  title="Are you sure you want to save these enterprise account changes?"
                  changes={pendingSave.changes}
                  confirmLabel="Confirm Save"
                  isPending={updateMutation.isPending}
                  onCancel={() => {
                    setConfirmMode(null);
                    setPendingSave(null);
                  }}
                  onConfirm={() => updateMutation.mutate(pendingSave.payload)}
                />
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setForm(createEnterpriseEditForm(enterprise));
                    setLocation(getInitialEnterpriseLocation(enterprise));
                    setDetectedBarangay(null);
                    setLocationError(null);
                    setErrors({});
                    setConfirmMode(null);
                    setPendingSave(null);
                  }}
                  className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="bg-tanaw-green rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:translate-y-0 disabled:opacity-70"
                >
                  Review Changes
                </button>
              </div>
            </form>
          )}
        </div>
      </ModalFrame>
      <AnimatePresence>
        {confirmMode === "activation" && (
          <ConfirmEnterpriseActivationModal
            key={`enterprise-activation-${enterprise.id}`}
            enterprise={enterprise}
            isPending={activationMutation.isPending}
            onClose={() => setConfirmMode(null)}
            onConfirm={() => activationMutation.mutate()}
          />
        )}
        {confirmMode === "status" && (
          <ConfirmEnterpriseStatusModal
            key={`enterprise-status-${enterprise.id}`}
            enterprise={enterprise}
            nextStatus={nextStatus}
            isPending={statusMutation.isPending}
            onClose={() => setConfirmMode(null)}
            onConfirm={() => statusMutation.mutate()}
          />
        )}
      </AnimatePresence>
    </>
  );

  function updateField<FieldName extends keyof EnterpriseFormState>(field: FieldName, value: EnterpriseFormState[FieldName]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setConfirmMode(null);
    setPendingSave(null);
  }

  function applySelectedLocation(nextLocation: LocationDraft, resolution?: BarangayPointResolution) {
    setLocation(nextLocation);
    setDetectedBarangay(resolution?.barangayName ?? null);
    setLocationError(resolution?.isAmbiguous ? "This pin touches multiple barangay boundaries. Move it farther inside the intended barangay." : null);
    if (resolution?.barangayName && sanPedroBarangayValues.has(resolution.barangayName)) {
      setForm((current) => ({ ...current, barangay: resolution.barangayName ?? current.barangay }));
      setErrors((current) => ({ ...current, barangay: undefined }));
    }
  }

  function applyBoundaryDetection(selectedLocation: LocationDraft, resolution: BarangayPointResolution) {
    if (!location || location.latitude !== selectedLocation.latitude || location.longitude !== selectedLocation.longitude) return;
    applySelectedLocation(selectedLocation, resolution);
  }

  function handleLocationRejected(message: string) {
    setLocationError(message);
    toast.error(message);
  }
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-black tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-sm font-bold wrap-break-word text-slate-900">{value}</p>
    </div>
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
