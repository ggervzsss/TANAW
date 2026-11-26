import { useId, useState, type ReactNode } from "react";
import { Input, cn } from "@/shared/ui-kit";
import { PHILIPPINE_MOBILE_ERROR, toPhilippineLocalDigits } from "@/shared/utils/accountValidation";
import { PERSONNEL_ROLES, personnelRoleAbout, personnelRoleLabel, type PersonnelRole } from "../model";

type TextFieldProps = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  type?: "text" | "email";
  autoComplete?: string;
  maxLength?: number;
  optional?: boolean;
};

const labelClass = "mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)";

export function SheetTextField({ name, label, value, onChange, error, hint, type = "text", autoComplete, maxLength, optional = false }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div data-field-name={name}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {optional && <span className="font-normal text-(--tanaw-text-muted)"> (optional)</span>}
      </label>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        invalid={Boolean(error)}
        aria-describedby={error || hint ? noteId : undefined}
        data-form-error-focus
        className="h-11"
      />
      <FieldNote id={noteId} error={error} hint={hint} />
    </div>
  );
}

export function SheetPhoneField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const id = useId();
  const noteId = `${id}-note`;
  const [typingError, setTypingError] = useState("");
  const shownError = error || typingError;
  const change = (next: string) => {
    const digits = toPhilippineLocalDigits(next);
    if ((next && !/^\d*$/.test(next)) || (digits && !digits.startsWith("9"))) {
      setTypingError(PHILIPPINE_MOBILE_ERROR);
      return;
    }
    setTypingError("");
    onChange(digits);
  };
  return (
    <div data-field-name="phone">
      <label htmlFor={id} className={labelClass}>
        Phone<span className="font-normal text-(--tanaw-text-muted)"> (optional)</span>
      </label>
      <div
        className={cn(
          "rounded-tanaw-md shadow-tanaw-resting flex h-11 overflow-hidden border bg-(--tanaw-control-bg) transition-[border-color,box-shadow] focus-within:border-(--tanaw-accent-ink) focus-within:ring-4 focus-within:ring-emerald-600/15 hover:border-(--tanaw-control-border-hover)",
          shownError ? "border-(--tanaw-error)" : "border-(--tanaw-control-border)",
        )}
      >
        <span aria-hidden="true" className="flex items-center border-r border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) px-3 text-sm font-semibold text-(--tanaw-text-secondary)">
          +63
        </span>
        <input
          id={id}
          name="phoneLocal"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={value}
          maxLength={10}
          placeholder="9171234567"
          aria-invalid={Boolean(shownError) || undefined}
          aria-describedby={noteId}
          data-form-error-focus
          onChange={(event) => change(event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            change(event.clipboardData.getData("text"));
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-(--tanaw-text) outline-none placeholder:text-(--tanaw-text-placeholder)"
        />
      </div>
      <FieldNote id={noteId} error={shownError} hint="A mobile number after +63: 10 digits starting with 9." />
    </div>
  );
}

function FieldNote({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error)
    return (
      <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-(--tanaw-danger-text)">
        {error}
      </p>
    );
  if (!hint) return null;
  return (
    <p id={id} className="mt-1.5 text-xs leading-relaxed text-(--tanaw-text-muted)">
      {hint}
    </p>
  );
}

type RoleCardsProps = {
  value: PersonnelRole;
  onChange: (role: PersonnelRole) => void;
  /** When set, only the current role can be chosen and this says why. */
  lockedReason?: string | null;
  error?: string;
};

export function RoleCards({ value, onChange, lockedReason, error }: RoleCardsProps) {
  const name = useId();
  const noteId = `${name}-note`;
  return (
    <fieldset data-field-name="role" className="m-0 border-0 p-0" aria-describedby={lockedReason || error ? noteId : undefined}>
      <legend className={labelClass}>Role</legend>
      <div className="grid gap-2">
        {PERSONNEL_ROLES.map((role) => {
          const checked = value === role;
          const disabled = Boolean(lockedReason) && !checked;
          return (
            <label
              key={role}
              data-on={checked}
              className={cn(
                "rounded-tanaw-md grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border px-4 py-3.5 transition-colors",
                checked ? "border-(--tanaw-action) bg-(--tanaw-selected-bg)" : "border-(--tanaw-control-border) hover:border-(--tanaw-accent-ink)",
                disabled && "cursor-not-allowed opacity-55 hover:border-(--tanaw-control-border)",
              )}
            >
              <input
                type="radio"
                name={name}
                value={role}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(role)}
                data-form-error-focus={checked || undefined}
                className="mt-0.5 h-4.5 w-4.5 accent-(--tanaw-action) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
              />
              <span className="font-bold text-(--tanaw-text)">{personnelRoleLabel[role]}</span>
              <span className="col-start-2 text-[0.84375rem] leading-relaxed text-(--tanaw-text-secondary)">{personnelRoleAbout[role]}</span>
            </label>
          );
        })}
      </div>
      <FieldNote id={noteId} error={error} hint={lockedReason} />
    </fieldset>
  );
}
