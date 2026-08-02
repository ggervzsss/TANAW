import type { FormEvent } from "react";
import { Pencil, RefreshCw, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { PERSON_NAME_MAX_LENGTH, type PersonNameParts } from "../../../utils/form-validation";
import type { EditableProfileField } from "../model/profile-edit";

type ProfileDisplayFieldProps = {
  label: string;
  locked?: boolean;
  onEdit?: () => void;
  prefix?: string;
  value: string;
};

export function ProfileDisplayField({ label, locked = false, onEdit, prefix, value }: ProfileDisplayFieldProps) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">{label}</label>
      <div className="flex min-h-12.5 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm text-[#111827] shadow-sm" aria-readonly="true">
        {prefix && <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 font-bold text-gray-700">{prefix}</span>}
        <div className="flex min-w-0 flex-1 items-center px-3.5 py-3">
          <span className="truncate">{value}</span>
        </div>
        {onEdit && !locked && (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onClick={onEdit}
            className="m-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-emerald-50 hover:text-[#065f46]"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

type ReadOnlyIdentityFieldProps = {
  label: string;
  value: string;
};

export function ReadOnlyIdentityField({ label, value }: ReadOnlyIdentityFieldProps) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold tracking-wider text-gray-400 uppercase">{label}</label>
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm font-semibold text-[#111827] shadow-sm">{value}</div>
    </div>
  );
}

type ProfileEditModalProps = {
  currentValue: string;
  error: string;
  field: EditableProfileField;
  isSaving: boolean;
  nameErrors: Partial<Record<keyof PersonNameParts, string>>;
  nameValue: PersonNameParts;
  onCancel: () => void;
  onNameChange: (field: keyof PersonNameParts, value: string) => void;
  onPhoneChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (value: string) => void;
  phoneLocal: string;
  value: string;
};

export function ProfileEditModal({
  currentValue,
  error,
  field,
  isSaving,
  nameErrors,
  nameValue,
  onCancel,
  onNameChange,
  onPhoneChange,
  onSubmit,
  onValueChange,
  phoneLocal,
  value,
}: ProfileEditModalProps) {
  const isPhone = field === "phone";
  const isName = field === "managerName";
  const title = field === "managerName" ? "Update Lead Admin Name" : field === "email" ? "Change Business Email" : field === "phone" ? "Change Contact Number" : "Update Building Capacity";
  const label = field === "managerName" ? "New lead admin name" : field === "email" ? "New business email" : field === "phone" ? "New contact number" : "Building capacity";
  const description =
    field === "managerName"
      ? "This updates the primary enterprise contact name after validation."
      : field === "email"
        ? "TANAW sends a single-use verification link to the proposed address and a warning to your current address. IT can approve the change only after ownership is verified."
        : field === "phone"
          ? "This sends a contact number change request to IT and Admin for review."
          : "This updates the occupancy capacity used by TANAW alerts.";

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
          className={`enterprise-profile-edit-modal w-full rounded-3xl border border-emerald-100 bg-white shadow-2xl dark:border-emerald-300/20 dark:bg-[#121c31] dark:text-slate-100 ${isName ? "max-w-2xl" : "max-w-lg"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 dark:border-slate-700">
            <div>
              <h3 id="profile-edit-title" className="text-lg font-bold text-[#111827] dark:text-slate-100">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
            </div>
            <button
              type="button"
              aria-label="Close profile edit modal"
              onClick={onCancel}
              className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-5 px-6 py-5">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-[#0f172a]">
              <p className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">Current value</p>
              <p className="mt-1 text-sm font-semibold wrap-break-word text-[#111827] dark:text-slate-100">{currentValue}</p>
            </div>

            {isName ? (
              <fieldset>
                <legend className="mb-3 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">Structured lead admin name</legend>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
                  <ProfileNameInput
                    name="firstName"
                    label="First Name"
                    value={nameValue.firstName}
                    error={nameErrors.firstName}
                    maxLength={PERSON_NAME_MAX_LENGTH}
                    autoComplete="given-name"
                    autoFocus
                    onChange={onNameChange}
                  />
                  <ProfileNameInput
                    name="middleInitial"
                    label="Middle Initial"
                    value={nameValue.middleInitial}
                    error={nameErrors.middleInitial}
                    maxLength={1}
                    autoComplete="additional-name"
                    helperText="Optional"
                    onChange={onNameChange}
                  />
                  <ProfileNameInput
                    name="lastName"
                    label="Last Name"
                    value={nameValue.lastName}
                    error={nameErrors.lastName}
                    maxLength={PERSON_NAME_MAX_LENGTH}
                    autoComplete="family-name"
                    onChange={onNameChange}
                  />
                </div>
              </fieldset>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">{label}</span>
                {isPhone ? (
                  <div
                    className={`flex overflow-hidden rounded-xl border bg-white shadow-sm transition-colors focus-within:border-[#065f46] focus-within:ring-2 focus-within:ring-[#065f46]/12 dark:bg-[#0f172a] ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
                  >
                    <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 text-sm font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      +63
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      autoFocus
                      value={phoneLocal}
                      maxLength={10}
                      pattern="9[0-9]{9}"
                      aria-invalid={Boolean(error)}
                      onChange={(event) => onPhoneChange(event.target.value)}
                      onPaste={(event) => {
                        event.preventDefault();
                        onPhoneChange(event.clipboardData.getData("text"));
                      }}
                      placeholder="9123456789"
                      className="min-w-0 flex-1 bg-transparent p-3.5 text-sm text-[#111827] outline-none dark:text-slate-100"
                    />
                  </div>
                ) : (
                  <input
                    type={field === "email" ? "email" : field === "buildingCapacity" ? "number" : "text"}
                    autoComplete={field === "email" ? "email" : field === "buildingCapacity" ? "off" : "name"}
                    autoFocus
                    value={value}
                    maxLength={field === "email" ? 254 : undefined}
                    aria-invalid={Boolean(error)}
                    onChange={(event) => onValueChange(event.target.value)}
                    className={`w-full rounded-xl border bg-white p-3.5 text-sm text-[#111827] shadow-sm transition-colors outline-none focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 dark:bg-[#0f172a] dark:text-slate-100 ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
                  />
                )}
                {(error || !isPhone) && (
                  <p className={`mt-1.5 text-xs font-semibold ${error ? "text-tanaw-red" : "text-gray-500 dark:text-slate-400"}`}>
                    {error || (field === "email" ? "Enter a valid email address." : "Use a whole number from 1 to 100,000.")}
                  </p>
                )}
              </label>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="rounded-full border border-gray-200 px-5 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex min-w-32 items-center justify-center gap-2 rounded-full bg-[#065f46] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#044a36] disabled:cursor-not-allowed disabled:bg-[#065f46]/70"
              >
                {isSaving && <RefreshCw size={15} className="animate-spin" />}
                {isSaving ? "Saving..." : field === "managerName" ? "Update Name" : field === "buildingCapacity" ? "Update Capacity" : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function ProfileNameInput({
  autoComplete,
  autoFocus = false,
  error,
  helperText,
  label,
  maxLength,
  name,
  onChange,
  value,
}: {
  autoComplete: string;
  autoFocus?: boolean;
  error?: string;
  helperText?: string;
  label: string;
  maxLength: number;
  name: keyof PersonNameParts;
  onChange: (field: keyof PersonNameParts, value: string) => void;
  value: string;
}) {
  const descriptionId = `profile-${name}-description`;
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-400">{label}</span>
      <input
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helperText ? descriptionId : undefined}
        onChange={(event) => onChange(name, event.target.value)}
        className={`w-full min-w-0 rounded-xl border bg-white p-3.5 text-sm text-[#111827] shadow-sm transition-colors outline-none focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12 dark:bg-[#0f172a] dark:text-slate-100 ${error ? "border-tanaw-red" : "border-gray-200 dark:border-slate-700"}`}
      />
      {(error || helperText) && (
        <p id={descriptionId} role={error ? "alert" : undefined} className={`mt-1.5 text-xs font-semibold ${error ? "text-tanaw-red" : "text-gray-500 dark:text-slate-400"}`}>
          {error || helperText}
        </p>
      )}
    </label>
  );
}
