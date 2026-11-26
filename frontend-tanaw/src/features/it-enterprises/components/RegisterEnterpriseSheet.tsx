import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import toast from "react-hot-toast/headless";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { OpeningHoursField } from "@/features/enterprise-accounts/components/OpeningHoursField";
import {
  createEmptyEnterpriseForm,
  getInvalidEnterpriseFieldNames,
  toCreateEnterprisePayload,
  validateEnterpriseForm,
  type EnterpriseCreateFormErrors,
  type EnterpriseCreateFormState,
} from "@/features/enterprise-accounts/model";
import { WEEKDAYS, dayHours, describeDay, type OpeningHours } from "@/features/enterprise-accounts/model/openingHours";
import { createEnterpriseAccount, enterpriseAccountsQueryKey } from "@/features/enterprise-accounts/services";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { enterpriseHealthQueryKey } from "@/shared/services/enterpriseHealth";
import { Button } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { AddressFields, AttractionFields, CapacityField, ContactNumberInput, EmailField, ManagerFields, NameField, type TextField } from "./EnterpriseFields";
import { useLocationDraft } from "../hooks/useLocationDraft";
import { LocationField } from "./LocationField";
import { SideSheet } from "./SideSheet";

/** "Daily, 8:00 AM – 5:00 PM" when every day is the same, else null. */
function sameEveryDay(hours: OpeningHours) {
  const days = WEEKDAYS.map((day) => describeDay(dayHours(hours, day)));
  return days.every((text) => text === days[0]) ? `Daily, ${days[0]}` : null;
}

/** Register enterprise: every detail the backend needs, then the owner gets a sign-in invitation. */
export function RegisterEnterpriseSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const formId = useId();
  const [form, setForm] = useState<EnterpriseCreateFormState>(createEmptyEnterpriseForm);
  const [errors, setErrors] = useState<EnterpriseCreateFormErrors>({});
  const [editHours, setEditHours] = useState(false);
  const draft = useLocationDraft(
    null,
    (barangay) => update("barangay", barangay),
    (address) => update("address", address),
  );

  const create = useMutation({
    mutationFn: createEnterpriseAccount,
    onSuccess: async (account) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: enterpriseAccountsQueryKey }),
        queryClient.invalidateQueries({ queryKey: enterpriseHealthQueryKey }),
        queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }),
        queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey }),
      ]);
      toast.success(
        <>
          <span className="block font-bold">Enterprise registered</span>
          <span className="mt-0.5 block text-[0.8125rem] font-normal">The invitation went to {account.email}.</span>
        </>,
      );
      onClose();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "The enterprise could not be registered. Try again.")),
  });

  function update(field: keyof EnterpriseCreateFormState, value: EnterpriseCreateFormState[keyof EnterpriseCreateFormState]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEnterpriseForm(form);
    setErrors(nextErrors);
    if (nextErrors.openingHours) setEditHours(true);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget, getInvalidEnterpriseFieldNames(nextErrors));
      return;
    }
    if (!draft.location) {
      draft.setError("Place the pin on the map inside San Pedro before registering.");
      focusFirstInvalidField(event.currentTarget, ["location"], "Place the map pin first.");
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
    create.mutate(toCreateEnterprisePayload(form, draft.location));
  };

  const fieldProps = { form, errors, onChange: (field: TextField, value: string) => update(field, value) };
  const hoursSummary = sameEveryDay(form.openingHours);

  return (
    <SideSheet
      title="Register enterprise"
      description="TANAW emails the owner a link to set a password and install the desktop app."
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form={formId} size="lg" loading={create.isPending}>
            Register and send invitation
          </Button>
          <Button variant="secondary" size="lg" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-5 pt-1">
        <NameField {...fieldProps} />
        <AttractionFields {...fieldProps} />
        <LocationField draft={draft} mapId="it-register-enterprise-map" hint="Search above, or click the map to pin the entrance so the place shows in the right spot on the Admin map." />
        <AddressFields {...fieldProps} />
        <ManagerFields {...fieldProps} />
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <ContactNumberInput {...fieldProps} />
          <CapacityField {...fieldProps} />
        </div>
        <EmailField {...fieldProps} />
        <div data-field-name="openingHours">
          <p className="mb-1.5 text-xs font-semibold text-(--tanaw-text-secondary)">Opening hours</p>
          {editHours ? (
            <OpeningHoursField value={form.openingHours} onChange={(value) => update("openingHours", value)} error={errors.openingHours} />
          ) : (
            <p className="text-sm text-(--tanaw-text)">
              {hoursSummary ?? "Custom hours."} <span className="text-(--tanaw-text-secondary)">You can change hours and add closed days after registering.</span>{" "}
              <button type="button" onClick={() => setEditHours(true)} className="font-semibold text-(--tanaw-accent-ink) underline underline-offset-4">
                Change hours now
              </button>
            </p>
          )}
        </div>
      </form>
    </SideSheet>
  );
}
