import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { Input, cn } from "@/shared/ui-kit";
import { PHILIPPINE_MOBILE_ERROR, toPhilippineLocalDigits } from "@/shared/utils/accountValidation";
import { PERSONNEL_ROLES, personnelRoleAbout, personnelRoleLabel, type PersonnelRole } from "../model";
import "../itPersonnel.css";

/** The chosen role's tint glides to the next choice instead of jumping. */
const GLIDE = { type: "tween", duration: 0.26, ease: [0.2, 0.8, 0.2, 1] } as const;

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

const labelClass = "mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)";

export function PersonnelTextField({ name, label, value, onChange, error, hint, type = "text", autoComplete, maxLength, optional = false }: TextFieldProps) {
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

export function PersonnelPhoneField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
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
      <div data-invalid={shownError ? "" : undefined} className="it-personnel__phone tanaw-field rounded-tanaw-md group flex h-11 overflow-hidden">
        <span
          aria-hidden="true"
          className="ease-tanaw-out flex items-center pr-2.5 pl-3.5 text-sm font-semibold text-(--tanaw-text-secondary) tabular-nums transition-colors duration-200 group-focus-within:text-(--tanaw-accent-ink)"
        >
          +63
        </span>
        <span aria-hidden="true" className="my-2.5 w-px shrink-0 bg-(--tanaw-control-border-hover)" />
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
      <p id={id} role="alert" className="mt-1.5 text-[13px] font-medium text-(--tanaw-danger-text)">
        {error}
      </p>
    );
  if (!hint) return null;
  return (
    <p id={id} className="mt-1.5 text-[13px] leading-relaxed text-(--tanaw-text-muted)">
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
  const reduceMotion = useReducedMotion();
  return (
    <fieldset data-field-name="role" className="m-0 border-0 p-0" aria-describedby={lockedReason || error ? noteId : undefined}>
      <legend className={cn(labelClass, "mb-2")}>Role</legend>
      <LayoutGroup id={name}>
        {/* The rows reach a little past the fields on both sides, so each dot lines up with the field edges above. */}
        <div className="-mx-3 grid gap-0.5">
          {PERSONNEL_ROLES.map((role) => {
            const checked = value === role;
            const disabled = Boolean(lockedReason) && !checked;
            return (
              <label
                key={role}
                data-on={checked}
                data-disabled={disabled || undefined}
                className={cn(
                  "it-personnel__role rounded-tanaw-md grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1 px-3 py-3.5",
                  disabled && "cursor-not-allowed opacity-55",
                )}
              >
                {checked && <motion.span layoutId="personnel-role-highlight" aria-hidden="true" className="it-personnel__role-highlight" transition={reduceMotion ? { duration: 0 } : GLIDE} />}
                <input
                  type="radio"
                  name={name}
                  value={role}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(role)}
                  data-form-error-focus={checked || undefined}
                  className="it-personnel__dot relative mt-0.5"
                />
                <span className={cn("ease-tanaw-out relative font-semibold transition-colors duration-200", checked ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-text)")}>
                  {personnelRoleLabel[role]}
                </span>
                <span className="relative col-start-2 text-[0.84375rem] leading-relaxed text-(--tanaw-text-secondary)">{personnelRoleAbout[role]}</span>
              </label>
            );
          })}
        </div>
      </LayoutGroup>
      <FieldNote id={noteId} error={error} hint={lockedReason} />
    </fieldset>
  );
}
