import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import type { BarangayPointResolution } from "@/features/mapview/utils";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { resendAccountActivation, updateAccountStatus } from "@/shared/services/accountService";
import type { AccountSummary } from "@/shared/types";
import { canDeactivateAccount } from "@/shared/utils/accountState";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
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
import { enterpriseAccountsQueryKey, type UpdateEnterpriseAccountPayload, updateEnterpriseAccount } from "../services";
import type { LocationDraft } from "../types";

export type EnterpriseDetailsConfirmMode = null | "activation" | "save" | "status";
export type PendingEnterpriseSave = { payload: UpdateEnterpriseAccountPayload; changes: string[] };

export function useEnterpriseDetails(enterprise: AccountSummary, onEnterpriseUpdated: (enterprise: AccountSummary) => void) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const { timeFormat } = useSystemDisplayPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EnterpriseFormState>(() => createEnterpriseEditForm(enterprise));
  const [location, setLocation] = useState<LocationDraft | null>(() => getInitialEnterpriseLocation(enterprise));
  const [detectedBarangay, setDetectedBarangay] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [errors, setErrors] = useState<EnterpriseFormErrors>({});
  const [confirmMode, setConfirmMode] = useState<EnterpriseDetailsConfirmMode>(null);
  const [pendingSave, setPendingSave] = useState<PendingEnterpriseSave | null>(null);
  const nextStatus: AccountSummary["status"] = enterprise.status === "active" ? "inactive" : "active";

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateEnterpriseAccountPayload) => updateEnterpriseAccount(enterprise.id, payload),
    onSuccess: async (updatedEnterprise, payload) => {
      const activationEmailQueued = !enterprise.isActivated && updatedEnterprise.status === "active" && payload.email !== enterprise.email;
      const emailVerificationQueued = enterprise.isActivated && payload.email !== enterprise.email && updatedEnterprise.profileChangeRequests.some((request) => request.type === "businessEmail");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: enterpriseAccountsQueryKey }),
        ...(activationEmailQueued || emailVerificationQueued
          ? [queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }), queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey })]
          : []),
      ]);
      onEnterpriseUpdated(updatedEnterprise);
      resetForm(updatedEnterprise);
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
        queryClient.invalidateQueries({ queryKey: enterpriseAccountsQueryKey }),
        queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }),
        queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey }),
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
        queryClient.invalidateQueries({ queryKey: enterpriseAccountsQueryKey }),
        ...(activationEmailQueued ? [queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }), queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey })] : []),
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

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
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
  }

  function resetForm(account = enterprise) {
    setIsEditing(false);
    setForm(createEnterpriseEditForm(account));
    setLocation(getInitialEnterpriseLocation(account));
    setDetectedBarangay(null);
    setLocationError(null);
    setErrors({});
    setConfirmMode(null);
    setPendingSave(null);
  }

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

  return {
    activationPending: activationMutation.isPending,
    applyBoundaryDetection,
    applySelectedLocation,
    canChangeStatus: enterprise.status === "inactive" || canDeactivateAccount(enterprise),
    confirmMode,
    confirmSave: () => pendingSave && updateMutation.mutate(pendingSave.payload),
    details,
    detectedBarangay,
    errors,
    form,
    handleEditSubmit,
    handleLocationRejected,
    isEditing,
    location,
    locationError,
    nextStatus,
    pendingSave,
    resendActivation: () => activationMutation.mutate(),
    resetForm,
    setConfirmMode,
    setIsEditing,
    statusPending: statusMutation.isPending,
    updateField,
    updatePending: updateMutation.isPending,
    updateStatus: () => statusMutation.mutate(),
  };
}
