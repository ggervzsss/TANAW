import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, UserX } from "lucide-react";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast/headless";
import {
  createEnterpriseEditForm,
  getEnterpriseChanges,
  getInitialEnterpriseLocation,
  getInvalidEnterpriseFieldNames,
  validateEnterpriseForm,
  type EnterpriseFormErrors,
  type EnterpriseFormState,
} from "@/features/enterprise-accounts/model";
import { updateEnterpriseAccount, type UpdateEnterpriseAccountPayload } from "@/features/enterprise-accounts/services";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { Button, ConfirmDialog } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { canDeactivateAccount } from "@/shared/utils/accountState";
import { formatPhilippineDateAndTime } from "@/shared/utils/dateTime";
import { detailsPayload } from "../model/accountPayload";
import { accessText, resendLabel, type DisplayFormats, type EnterpriseAccount, type EnterpriseRow } from "../model/enterprises";
import { notifyError, notifySuccess, refreshEnterprises, useAccountStatus, usePasswordReset, useResendInvitation } from "../hooks/useEnterpriseActions";
import { AddressFields, AttractionFields, CapacityField, ContactNumberInput, EmailField, ManagerFields, NameField, type TextField } from "./EnterpriseFields";
import { useLocationDraft } from "../hooks/useLocationDraft";
import { LocationField } from "./LocationField";
import { SectionHeading, StateText } from "./StateText";

type PendingSave = { payload: UpdateEnterpriseAccountPayload; changes: string[] };

/** Details and account: the editable details, and the sign-in account panel. */
export function DetailsTab({ row, formats, onAccountUpdated }: { row: EnterpriseRow; formats: DisplayFormats; onAccountUpdated: (account: EnterpriseAccount) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-x-14 gap-y-10 max-lg:grid-cols-1">
      <DetailsForm account={row.account} onAccountUpdated={onAccountUpdated} />
      <SignInAccount row={row} formats={formats} />
    </div>
  );
}

function DetailsForm({ account, onAccountUpdated }: { account: EnterpriseAccount; onAccountUpdated: (account: EnterpriseAccount) => void }) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const [form, setForm] = useState<EnterpriseFormState>(() => createEnterpriseEditForm(account));
  const [errors, setErrors] = useState<EnterpriseFormErrors>({});
  const [pending, setPending] = useState<PendingSave | null>(null);
  const draft = useLocationDraft(
    getInitialEnterpriseLocation(account),
    (barangay) => update("barangay", barangay),
    (address) => update("address", address),
  );

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const save = useMutation({
    mutationFn: (payload: UpdateEnterpriseAccountPayload) => updateEnterpriseAccount(account.id, payload),
    onSuccess: async (updated, payload) => {
      const invitationSent = !account.isActivated && payload.email !== account.email;
      await refreshEnterprises(queryClient, { emails: invitationSent });
      const next = updated as EnterpriseAccount;
      onAccountUpdated(next);
      setForm(createEnterpriseEditForm(next));
      draft.reset(getInitialEnterpriseLocation(next));
      setPending(null);
      notifySuccess("Details saved", invitationSent ? `A new invitation went to ${next.email}.` : "Changes show on the Admin map and on reports from now on.");
    },
    onError: (error) => {
      setPending(null);
      notifyError("Details not saved", getApiErrorMessage(error, "The details could not be saved. Try again."));
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseForm(form);
    delete nextErrors.openingHours;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget, getInvalidEnterpriseFieldNames(nextErrors));
      return;
    }
    if (draft.error) {
      focusFirstInvalidField(event.currentTarget, ["location"], draft.error);
      return;
    }
    if (draft.detectedBarangay && draft.detectedBarangay !== form.barangay) {
      draft.setError(`The pin is in Brgy. ${draft.detectedBarangay}. Choose that barangay or move the pin.`);
      focusFirstInvalidField(event.currentTarget, ["barangay"], "The pin and the barangay do not match.");
      return;
    }
    const payload = detailsPayload(form, draft.location, account);
    const changes = getEnterpriseChanges(account, payload);
    if (changes.length === 0) {
      toast("There are no changes to save.");
      return;
    }
    setPending({ payload, changes });
  };

  const fieldProps = { form, errors, onChange: update };

  return (
    <section aria-labelledby="ite-details">
      <SectionHeading id="ite-details">Details</SectionHeading>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Changes show on the Admin map and on reports sent after today.</p>
      <form noValidate onSubmit={submit} className="mt-4 grid gap-4">
        <NameField {...fieldProps} />
        <AttractionFields {...fieldProps} />
        <LocationField draft={draft} mapId={`it-enterprise-map-${account.id}`} hint="No map pin yet. Search above, or click the map to pin the entrance." />
        <AddressFields {...fieldProps} />
        <ManagerFields {...fieldProps} />
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <ContactNumberInput {...fieldProps} />
          <CapacityField {...fieldProps} />
        </div>
        {!account.isActivated && <EmailField {...fieldProps} hint="The owner has not signed in yet. Changing the email sends a new invitation to the new address." />}
        <div>
          <Button type="submit" loading={save.isPending}>
            Save details
          </Button>
        </div>
      </form>

      {pending && (
        <ConfirmDialog
          title="Save these changes?"
          confirmLabel="Save details"
          busy={save.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => save.mutate(pending.payload)}
          icon={<CheckCircle2 size={20} />}
        >
          <ul className="list-disc space-y-1 pl-5">
            {pending.changes.map((change) => (
              <li key={change}>{change.replace(" -> ", " → ")}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </section>
  );
}

function SignInAccount({ row, formats }: { row: EnterpriseRow; formats: DisplayFormats }) {
  const { account } = row;
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const reset = usePasswordReset(account.id);
  const resend = useResendInvitation();
  const status = useAccountStatus(() => setConfirmDeactivate(false));
  const access = accessText(row, formats);
  const resendText = account.status === "active" ? resendLabel(row) : null;
  const canReset = row.accountState === "active";
  const canDeactivate = canDeactivateAccount(account);
  const emailRequest = account.profileChangeRequests?.find((request) => request.type === "businessEmail" && request.status !== "expired");
  const term = "text-[12.5px] text-(--tanaw-text-muted)";

  return (
    <section aria-labelledby="ite-account">
      <SectionHeading id="ite-account">Sign-in account</SectionHeading>
      <dl className="mt-3 border-t border-(--tanaw-border-soft)">
        <div className="border-b border-(--tanaw-border-soft) py-3">
          <dt className={term}>Owner email</dt>
          <dd className="mt-0.5 font-bold break-all text-(--tanaw-text)">{account.email}</dd>
        </div>
        <div className="border-b border-(--tanaw-border-soft) py-3">
          <dt className={term}>Access</dt>
          <dd className="mt-0.5">
            <StateText tone={access.tone} className="font-bold">
              {access.text}
            </StateText>
          </dd>
        </div>
        <div className="border-b border-(--tanaw-border-soft) py-3">
          <dt className={term}>Last signed in</dt>
          <dd className="mt-0.5 font-bold text-(--tanaw-text)">{account.lastLoginAt ? formatPhilippineDateAndTime(account.lastLoginAt, formats.dateFormat, formats.timeFormat) : "Never"}</dd>
        </div>
      </dl>
      <p className="mt-3.5 text-[13.5px] text-(--tanaw-text-secondary)">To change the owner email, the enterprise sends an account change request from the desktop app. You approve it in Requests.</p>
      {emailRequest && (
        <p className="mt-2 text-[13.5px] font-semibold text-(--tanaw-warn-ink)">
          An email change to {emailRequest.requestedValue} is waiting {emailRequest.status === "pending_verification" ? "for the owner to verify it" : "for approval in Requests"}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2.5">
        {canReset && (
          <Button variant="secondary" size="sm" loading={reset.isPending} disabled={reset.secondsLeft > 0} onClick={reset.send}>
            {reset.secondsLeft > 0 ? `Send again in ${reset.secondsLeft} s` : "Send a password reset email"}
          </Button>
        )}
        {resendText && (
          <Button variant="secondary" size="sm" loading={resend.isPending} onClick={() => resend.mutate(account.id)}>
            {resendText === "Send again" ? "Send invitation again" : "Send a new invitation link"}
          </Button>
        )}
        {canDeactivate && (
          <Button variant="danger" size="sm" onClick={() => setConfirmDeactivate(true)}>
            Deactivate enterprise
          </Button>
        )}
        {account.status === "inactive" && (
          <Button variant="secondary" size="sm" loading={status.isPending} onClick={() => status.mutate({ accountId: account.id, status: "active" })}>
            Activate enterprise
          </Button>
        )}
      </div>
      {reset.message && (
        <p role="status" className="mt-2.5 text-[13px] text-(--tanaw-text-secondary)">
          {reset.message}
        </p>
      )}
      {canDeactivate && <p className="mt-2.5 text-[13px] text-(--tanaw-text-muted)">Deactivating signs the desktop app out and stops its counts. Past reports stay.</p>}
      {account.status === "inactive" && !account.isActivated && <p className="mt-2.5 text-[13px] text-(--tanaw-text-muted)">Activating sends the owner a new sign-in invitation.</p>}

      {confirmDeactivate && (
        <ConfirmDialog
          title="Deactivate this enterprise?"
          tone="danger"
          confirmLabel="Deactivate enterprise"
          busy={status.isPending}
          icon={<UserX size={20} />}
          onCancel={() => setConfirmDeactivate(false)}
          onConfirm={() => status.mutate({ accountId: account.id, status: "inactive" })}
        >
          <p>{row.name} is signed out of the desktop app and its cameras stop counting. Past reports stay. You can activate it again later.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
