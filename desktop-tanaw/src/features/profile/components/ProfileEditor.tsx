import { useRef, type FormEvent } from "react";
import { Pencil, RefreshCw, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { useDialogFocus } from "../../../ui-kit";
import { PERSON_NAME_MAX_LENGTH, type PersonNameParts } from "../../../utils/form-validation";
import type { EditableProfileField } from "../model/profile-edit";

export function ProfileDisplayField({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="tanaw-settings-field">
      <div className="min-w-0">
        <p className="tanaw-settings-field-label">{label}</p>
        <p className="tanaw-settings-field-value">{value}</p>
      </div>
      <button type="button" aria-label={"Edit " + label} onClick={onEdit} className="tanaw-settings-field-edit">
        <Pencil size={14} aria-hidden="true" />
        Edit
      </button>
    </div>
  );
}

export function ReadOnlyIdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, () => {
    if (!isSaving) onCancel();
  });
  const isPhone = field === "phone";
  const isName = field === "managerName";
  const title =
    field === "managerName" ? "Update Lead Admin Name" : field === "email" ? "Change Business Email" : field === "phone" ? "Change Contact Number" : field === "enterpriseName" ? "Change Enterprise Name" : "Update Building Capacity";
  const label = field === "managerName" ? "New lead admin name" : field === "email" ? "New business email" : field === "phone" ? "New contact number" : field === "enterpriseName" ? "New enterprise name" : "Building capacity";
  const description =
    field === "managerName"
      ? "This updates the primary enterprise contact name after validation."
      : field === "email"
        ? "TANAW sends a single-use verification link to the proposed address and a warning to your current address. IT can approve the change only after ownership is verified."
        : field === "phone"
          ? "This sends IT a request to approve the new contact number. It changes once IT approves it."
          : field === "enterpriseName"
            ? "This sends IT a request to approve the new name. Reports you already sent keep the name they were sent with."
            : "This updates the occupancy capacity used by TANAW alerts.";

  return (
    <ModalPortal>
      <div className="tanaw-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-[rgb(3_20_12/0.6)] px-4 py-6 backdrop-blur-[6px]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
          ref={panelRef}
          tabIndex={-1}
          className={`enterprise-profile-edit-modal tanaw-dialog-enter w-full overflow-hidden rounded-tanaw-xl border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) text-(--tanaw-text) shadow-tanaw-raised outline-none ${isName ? "max-w-2xl" : "max-w-lg"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-(--tanaw-border-soft) px-6 pt-5 pb-4">
            <div>
              <h3 id="profile-edit-title" className="font-display text-xl leading-tight font-bold text-(--tanaw-text)">
                {title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-(--tanaw-text-muted)">{description}</p>
            </div>
            <button
              type="button"
              aria-label="Close profile edit modal"
              onClick={onCancel}
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-95"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-5 px-6 pt-5 pb-6">
            <div className="rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-4 py-3">
              <p className="text-xs font-semibold text-(--tanaw-text-muted)">Current value</p>
              <p className="mt-1 text-sm font-semibold wrap-break-word text-(--tanaw-text)">{currentValue}</p>
            </div>

            {isName ? (
              <fieldset>
                <legend className="mb-3 block text-sm font-semibold text-(--tanaw-text-secondary)">Structured lead admin name</legend>
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
                <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">{label}</span>
                {isPhone ? (
                  <div
                    className={`flex overflow-hidden rounded-tanaw-md border bg-(--tanaw-control-bg) shadow-tanaw-resting transition-[border-color,box-shadow] duration-150 ease-tanaw-out focus-within:border-(--tanaw-accent-ink) focus-within:ring-4 focus-within:ring-emerald-600/15 ${error ? "border-(--tanaw-error)" : "border-(--tanaw-control-border) hover:border-(--tanaw-control-border-hover)"}`}
                  >
                    <span className="flex items-center border-r border-(--tanaw-control-border) bg-(--tanaw-surface-inset) px-3 text-sm font-semibold text-(--tanaw-text-secondary)">
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
                      className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-sm text-(--tanaw-text) outline-none placeholder:text-(--tanaw-text-placeholder)"
                    />
                  </div>
                ) : (
                  <input
                    type={field === "email" ? "email" : field === "buildingCapacity" ? "number" : "text"}
                    autoComplete={field === "email" ? "email" : field === "buildingCapacity" ? "off" : "organization"}
                    autoFocus
                    value={value}
                    maxLength={field === "email" ? 254 : field === "enterpriseName" ? 120 : undefined}
                    aria-invalid={Boolean(error)}
                    onChange={(event) => onValueChange(event.target.value)}
                    className={`w-full rounded-tanaw-md border bg-(--tanaw-control-bg) px-3.5 py-3 text-sm text-(--tanaw-text) shadow-tanaw-resting transition-[border-color,box-shadow] duration-150 ease-tanaw-out outline-none focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15 ${error ? "border-(--tanaw-error)" : "border-(--tanaw-control-border) hover:border-(--tanaw-control-border-hover)"}`}
                  />
                )}
                {(error || !isPhone) && (
                  <p className={`mt-1.5 text-[0.8125rem] ${error ? "font-semibold text-(--tanaw-error)" : "text-(--tanaw-text-muted)"}`}>
                    {error || (field === "email" ? "Enter a valid email address." : field === "enterpriseName" ? "Use the name your visitors know you by." : "Use a whole number from 1 to 100,000.")}
                  </p>
                )}
              </label>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="h-10.5 rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-4.5 text-sm font-semibold text-(--tanaw-text) shadow-tanaw-resting transition-[background-color,border-color,translate,scale] duration-150 ease-tanaw-out hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex h-10.5 min-w-32 items-center justify-center gap-2 rounded-tanaw-md bg-(--tanaw-action) px-4.5 text-sm font-semibold text-(--tanaw-on-action) shadow-tanaw-resting transition-[background-color,box-shadow,translate,scale] duration-150 ease-tanaw-out hover:bg-(--tanaw-action-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSaving && <RefreshCw size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
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
      <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">{label}</span>
      <input
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helperText ? descriptionId : undefined}
        onChange={(event) => onChange(name, event.target.value)}
        className={`w-full min-w-0 rounded-tanaw-md border bg-(--tanaw-control-bg) px-3.5 py-3 text-sm text-(--tanaw-text) shadow-tanaw-resting transition-[border-color,box-shadow] duration-150 ease-tanaw-out outline-none focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15 ${error ? "border-(--tanaw-error)" : "border-(--tanaw-control-border) hover:border-(--tanaw-control-border-hover)"}`}
      />
      {(error || helperText) && (
        <p id={descriptionId} role={error ? "alert" : undefined} className={`mt-1.5 text-[0.8125rem] ${error ? "font-semibold text-(--tanaw-error)" : "text-(--tanaw-text-muted)"}`}>
          {error || helperText}
        </p>
      )}
    </label>
  );
}
