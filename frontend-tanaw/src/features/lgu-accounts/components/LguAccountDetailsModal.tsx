import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { ModalFrame } from "@/shared/components/ui";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { type AccountSummary, type UpdateLguAccountPayload, resolveAccountEmailChangeRequest, updateLguAccount } from "@/shared/services/accountManagement";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { createLguUpdatePayload, getInitialLguEditState, getInvalidLguEditFieldNames, getLguChanges, type LguEditErrors, type LguEditState, type PendingLguSave, validateLguEditForm } from "../model";
import type { LguStatusFilter } from "../types";
import { lguRoleLabel } from "../utils";
import { LguAccountEditForm } from "./LguAccountEditForm";
import { LguAccountActions, LguAccountSummary, LguEmailChangeRequest } from "./LguAccountOverview";

type Props = {
  account: AccountSummary;
  onClose: () => void;
  onAccountUpdated: (account: AccountSummary) => void;
  onResendActivation: (account: AccountSummary) => void;
  onRequestStatusChange: (account: AccountSummary, nextStatus: LguStatusFilter) => void;
};

export function LguAccountDetailsModal({ account, onClose, onAccountUpdated, onResendActivation, onRequestStatusChange }: Props) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const { timeFormat } = useSystemDisplayPreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<LguEditState>(() => getInitialLguEditState(account));
  const [errors, setErrors] = useState<LguEditErrors>({});
  const [pendingSave, setPendingSave] = useState<PendingLguSave | null>(null);
  const emailChangeRequest = account.profileChangeRequests.find((request) => request.type === "businessEmail");

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateLguAccountPayload) => updateLguAccount(account.id, payload),
    onSuccess: async (updatedAccount, payload) => {
      const activationQueued = !account.isActivated && updatedAccount.status === "active" && payload.email !== account.email;
      const verificationQueued = account.isActivated && payload.email !== account.email && updatedAccount.profileChangeRequests.some((request) => request.type === "businessEmail");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }),
        ...(activationQueued || verificationQueued ? [queryClient.invalidateQueries({ queryKey: ["dev-deliveries"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })] : []),
      ]);
      onAccountUpdated(updatedAccount);
      setForm(getInitialLguEditState(updatedAccount));
      setPendingSave(null);
      setIsEditing(false);
      toast.success(activationQueued ? "LGU account updated; activation email queued" : verificationQueued ? "LGU account updated; email verification queued" : "LGU account updated");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to update LGU account")),
  });

  const emailResolutionMutation = useMutation({
    mutationFn: (action: "approve" | "decline") => resolveAccountEmailChangeRequest(account.id, action),
    onSuccess: async (updatedAccount, action) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] }), queryClient.invalidateQueries({ queryKey: ["email-deliveries"] })]);
      onAccountUpdated(updatedAccount);
      setForm(getInitialLguEditState(updatedAccount));
      toast.success(`Email change request ${action === "approve" ? "approved" : "declined"}.`);
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ["lgu-accounts"] });
      toast.error(getApiErrorMessage(error, "Unable to resolve email change request"));
    },
  });

  const details = useMemo(
    () =>
      [
        ["Name", account.displayName],
        ["Email", account.email],
        ["Account Type", lguRoleLabel[account.role] ?? account.role],
        ["Phone", account.phone ?? "Not provided"],
        ["Status", account.status],
        ["Last Login", account.lastLoginAt ? formatPhilippineDateTime(account.lastLoginAt, timeFormat) : "Never"],
        ["Created", formatPhilippineDateTime(account.createdAt, timeFormat)],
        ["Activation", account.isActivated ? "Complete" : "Pending"],
      ] as const,
    [account, timeFormat],
  );

  const reviewChanges = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateLguEditForm(form);
    setErrors(nextErrors);
    setPendingSave(null);
    if (Object.keys(nextErrors).length) {
      focusFirstInvalidField(event.currentTarget, getInvalidLguEditFieldNames(nextErrors));
      return;
    }
    const payload = createLguUpdatePayload(form);
    const changes = getLguChanges(account, payload);
    if (!changes.length) return void toast("No account changes to save.");
    setPendingSave({ payload, changes });
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setForm(getInitialLguEditState(account));
    setErrors({});
    setPendingSave(null);
  };

  const updateField = <K extends keyof LguEditState>(field: K, value: LguEditState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPendingSave(null);
  };

  return (
    <ModalFrame title="LGU Account Details" onClose={onClose} maxWidthClassName="max-w-4xl" eyebrow="Accounts Management">
      <div className="space-y-6">
        <LguAccountSummary account={account} details={details} />
        {isEditing ? (
          <LguAccountEditForm
            errors={errors}
            form={form}
            isPending={updateMutation.isPending}
            pendingSave={pendingSave}
            onCancel={cancelEdit}
            onConfirm={() => pendingSave && updateMutation.mutate(pendingSave.payload)}
            onFieldChange={updateField}
            onReview={reviewChanges}
            onCancelReview={() => setPendingSave(null)}
          />
        ) : (
          <>
            {emailChangeRequest && (
              <LguEmailChangeRequest account={account} request={emailChangeRequest} isPending={emailResolutionMutation.isPending} onResolve={(action) => emailResolutionMutation.mutate(action)} />
            )}
            <LguAccountActions
              account={account}
              onEdit={() => setIsEditing(true)}
              onResendActivation={() => onResendActivation(account)}
              onRequestStatusChange={(status) => onRequestStatusChange(account, status)}
            />
          </>
        )}
      </div>
    </ModalFrame>
  );
}
