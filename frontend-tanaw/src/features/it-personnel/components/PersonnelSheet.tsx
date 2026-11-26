import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import toast from "react-hot-toast/headless";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { createLguUpdatePayload, getInitialLguEditState, getInvalidLguEditFieldNames, validateLguEditForm, type LguEditErrors, type LguEditState } from "@/features/lgu-accounts/model";
import { createLguAccount, lguAccountsQueryKey, updateLguAccount, type CreateLguAccountPayload } from "@/features/lgu-accounts/services";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { Alert, Button } from "@/shared/ui-kit";
import { normalizeMiddleInitial, PERSON_NAME_MAX_LENGTH } from "@/shared/utils/accountValidation";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { toastMessage } from "../hooks/usePersonnelPage";
import { emailChangeEffect, personnelChanges, roleLabelOf, type PersonnelAccount, type PersonnelChange, type PersonnelRole } from "../model";
import { RoleCards, SheetPhoneField, SheetTextField } from "./PersonnelFields";
import { SideSheet } from "./SideSheet";

type Props = {
  /** The account being edited; null to invite someone new. */
  account: PersonnelAccount | null;
  lockedRoleReason: string | null;
  onClose: () => void;
  onInvited: () => void;
};

const EMPTY_FORM: LguEditState = { firstName: "", middleInitial: "", lastName: "", email: "", phoneLocal: "", role: "staff" };

type Review = { payload: CreateLguAccountPayload; changes: PersonnelChange[] };

export function PersonnelSheet({ account, lockedRoleReason, onClose, onInvited }: Props) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const formId = useId();
  const editing = account !== null;
  const [form, setForm] = useState<LguEditState>(() => (account ? getInitialLguEditState(account) : EMPTY_FORM));
  const [errors, setErrors] = useState<LguEditErrors>({});
  const [review, setReview] = useState<Review | null>(null);
  const [nothingChanged, setNothingChanged] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: lguAccountsQueryKey }),
      queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }),
      queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey }),
    ]);

  const inviteMutation = useMutation({
    mutationFn: createLguAccount,
    onSuccess: async (created) => {
      await refresh();
      toast.success(toastMessage("Invitation sent", `${created.displayName} will get a link at ${created.email}.`));
      onInvited();
    },
    onError: (error) => toast.error(toastMessage("Invitation not sent", getApiErrorMessage(error, "The invitation could not be sent. Try again."))),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: CreateLguAccountPayload) => updateLguAccount(account?.id ?? "", payload),
    onSuccess: async (updated, payload) => {
      await refresh();
      toast.success(toastMessage("Changes saved", savedMessage(account, updated.displayName, payload)));
      onClose();
    },
    onError: (error) => {
      setReview(null);
      toast.error(toastMessage("Changes not saved", getApiErrorMessage(error, "The changes could not be saved. Try again.")));
    },
  });

  const busy = inviteMutation.isPending || saveMutation.isPending;
  const close = () => {
    if (!busy) onClose();
  };

  const update = <K extends keyof LguEditState>(field: K, value: LguEditState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setReview(null);
    setNothingChanged(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (review) {
      saveMutation.mutate(review.payload);
      return;
    }
    const nextErrors = validateLguEditForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstInvalidField(event.currentTarget, getInvalidLguEditFieldNames(nextErrors));
      return;
    }
    const payload = createLguUpdatePayload(form);
    if (!account) {
      inviteMutation.mutate(payload);
      return;
    }
    const changes = personnelChanges(account, payload);
    if (!changes.length) {
      setNothingChanged(true);
      return;
    }
    setReview({ payload, changes });
  };

  const emailEffect = account ? emailChangeEffect(account) : null;
  const emailHint =
    emailEffect === "verify"
      ? "If you change it, TANAW sends a verification link to the new address. The sign-in email changes after the new address is verified and another IT account approves it."
      : emailEffect === "immediate"
        ? "They have not set a password yet, so a new address takes effect at once and a fresh invitation link goes to it."
        : "The invitation link goes to this address.";

  return (
    <SideSheet
      title={account ? `Edit ${account.displayName}` : "Invite personnel"}
      description={account ? "Changes take effect the next time they open TANAW." : "TANAW emails them a link to set a password. If the link expires, you can send a new one from this list."}
      onClose={close}
      footer={
        <>
          <Button type="submit" form={formId} size="lg" loading={busy}>
            {!editing ? "Send invitation" : review ? "Confirm and save" : "Save changes"}
          </Button>
          <Button variant="secondary" size="lg" onClick={review ? () => setReview(null) : close} disabled={busy}>
            {review ? "Back to editing" : "Cancel"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
          <SheetTextField
            name="firstName"
            label="First name"
            value={form.firstName}
            onChange={(value) => update("firstName", value)}
            error={errors.firstName}
            autoComplete="given-name"
            maxLength={PERSON_NAME_MAX_LENGTH}
          />
          <SheetTextField
            name="middleInitial"
            label="Middle initial"
            value={form.middleInitial}
            onChange={(value) => update("middleInitial", normalizeMiddleInitial(value))}
            error={errors.middleInitial}
            autoComplete="additional-name"
            maxLength={1}
            optional
          />
        </div>
        <SheetTextField
          name="lastName"
          label="Last name"
          value={form.lastName}
          onChange={(value) => update("lastName", value)}
          error={errors.lastName}
          autoComplete="family-name"
          maxLength={PERSON_NAME_MAX_LENGTH}
        />
        <SheetTextField name="email" type="email" label="Work email" value={form.email} onChange={(value) => update("email", value)} error={errors.email} hint={emailHint} autoComplete="email" />
        <SheetPhoneField value={form.phoneLocal} onChange={(value) => update("phoneLocal", value)} error={errors.phoneLocal} />
        <RoleCards value={form.role} onChange={(role: PersonnelRole) => update("role", role)} lockedReason={lockedRoleReason} error={errors.role} />
        {nothingChanged && (
          <p role="status" className="text-sm font-semibold text-(--tanaw-text-secondary)">
            Nothing has changed yet.
          </p>
        )}
        {review && <ChangeReview changes={review.changes} />}
      </form>
    </SideSheet>
  );
}

function ChangeReview({ changes }: { changes: PersonnelChange[] }) {
  return (
    <Alert tone="warning" title="Save these changes?">
      <ul className="mt-1 grid gap-1.5">
        {changes.map((change) => (
          <li key={change.label} className="wrap-anywhere">
            <span className="font-semibold text-(--tanaw-text)">{change.label}: </span>
            {change.from}
            <ArrowRight size={13} aria-label="to" className="mx-1 inline align-[-2px]" />
            <span className="font-semibold text-(--tanaw-text)">{change.to}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function savedMessage(account: PersonnelAccount | null, name: string, payload: CreateLguAccountPayload) {
  if (!account) return `${name}'s details are up to date.`;
  if (account.email !== payload.email) {
    return account.isActivated ? `A verification link went to ${payload.email}. The sign-in email changes once it is verified and approved.` : `A new invitation link went to ${payload.email}.`;
  }
  if (account.role !== payload.role) return `${name} is now ${roleLabelOf(payload.role)}.`;
  return `${name}'s details are up to date.`;
}
