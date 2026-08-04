import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ContactNumberField, FormField, SearchableDropdownField, type DropdownOption } from "@/shared/components/ui";
import { normalizeMiddleInitial, PERSON_NAME_MAX_LENGTH } from "@/shared/utils/accountValidation";
import type { LguEditErrors, LguEditState, PendingLguSave } from "../model";

type Props = {
  errors: LguEditErrors;
  form: LguEditState;
  isPending: boolean;
  pendingSave: PendingLguSave | null;
  onCancel: () => void;
  onConfirm: () => void;
  onFieldChange: <K extends keyof LguEditState>(field: K, value: LguEditState[K]) => void;
  onReview: (event: FormEvent<HTMLFormElement>) => void;
  onCancelReview: () => void;
};

export function LguAccountEditForm({ errors, form, isPending, pendingSave, onCancel, onConfirm, onFieldChange, onReview, onCancelReview }: Props) {
  return (
    <form onSubmit={onReview} noValidate className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
          <FormField
            name="firstName"
            label="First Name"
            value={form.firstName}
            onChange={(value) => onFieldChange("firstName", value)}
            error={errors.firstName}
            required
            autoComplete="given-name"
            maxLength={PERSON_NAME_MAX_LENGTH}
          />
          <FormField
            name="middleInitial"
            label="Middle Initial"
            value={form.middleInitial}
            onChange={(value) => onFieldChange("middleInitial", normalizeMiddleInitial(value))}
            error={errors.middleInitial}
            autoComplete="additional-name"
            maxLength={1}
            helperText="Optional"
          />
          <FormField
            name="lastName"
            label="Last Name"
            value={form.lastName}
            onChange={(value) => onFieldChange("lastName", value)}
            error={errors.lastName}
            required
            autoComplete="family-name"
            maxLength={PERSON_NAME_MAX_LENGTH}
          />
        </div>
        <FormField name="email" label="Email Address" type="email" value={form.email} onChange={(value) => onFieldChange("email", value)} error={errors.email} required autoComplete="email" />
        <ContactNumberField name="phone" label="Contact Number" value={form.phoneLocal} onChange={(value) => onFieldChange("phoneLocal", value)} error={errors.phoneLocal} />
        <SearchableDropdownField
          name="role"
          label="Account Type"
          options={
            [
              ["staff", "LGU Staff"],
              ["it", "IT Personnel"],
              ["admin", "Admin"],
            ] satisfies DropdownOption[]
          }
          value={form.role}
          onChange={(value) => onFieldChange("role", value as LguEditState["role"])}
          error={errors.role}
          required
        />
      </div>
      {pendingSave && <ConfirmationPanel changes={pendingSave.changes} isPending={isPending} onCancel={onCancelReview} onConfirm={onConfirm} />}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="bg-tanaw-green rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-[#044a1e] disabled:opacity-70"
        >
          Review Changes
        </button>
      </div>
    </form>
  );
}

function ConfirmationPanel({ changes, isPending, onCancel, onConfirm }: { changes: string[]; isPending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="font-black text-amber-950">Are you sure you want to save these account changes?</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {changes.map((change) => (
              <li key={change} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{change}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onCancel} className="rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-900">
              Cancel
            </button>
            <button type="button" disabled={isPending} onClick={onConfirm} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-70">
              {isPending ? "Saving..." : "Confirm Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
