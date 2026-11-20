import { Check, Eye, EyeOff, Pencil } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";

type AccountFieldProps = {
  autoComplete?: string;
  defaultValue: string;
  editable?: boolean;
  error?: string;
  label: string;
  maxLength?: number;
  minLength?: number;
  name?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  preventPasswordAutofill?: boolean;
  type?: string;
  value?: string;
};

export function AccountField({
  label,
  defaultValue,
  editable = false,
  name,
  type = "text",
  placeholder,
  minLength,
  maxLength,
  onValueChange,
  value,
  autoComplete,
  preventPasswordAutofill = false,
  error,
}: AccountFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isPasswordInputActive, setIsPasswordInputActive] = useState(!preventPasswordAutofill);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const isPassword = type === "password";
  const inputType = isPassword && isPasswordVisible ? "text" : type;
  const canEdit = Boolean(name && editable && !isPassword);
  const isProfileReadOnly = !isPassword && (!name || !editable || (canEdit && !isEditing));
  const isPasswordAutofillLocked = isPassword && preventPasswordAutofill && !isPasswordInputActive;
  const isReadOnly = isProfileReadOnly || isPasswordAutofillLocked;
  const canRevealPassword = isPassword && Boolean(value);

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      name={name}
      type={inputType}
      defaultValue={value === undefined ? defaultValue : undefined}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      minLength={minLength}
      maxLength={maxLength}
      onChange={(event) => onValueChange?.(event.target.value)}
      onFocus={() => {
        if (isPasswordAutofillLocked) setIsPasswordInputActive(true);
      }}
      onPointerDown={() => {
        if (isPasswordAutofillLocked) setIsPasswordInputActive(true);
      }}
      onBlur={() => {
        if (preventPasswordAutofill && !value) setIsPasswordInputActive(false);
      }}
      required={isPassword}
      aria-invalid={Boolean(error)}
      aria-describedby={error && name ? `${name}-error` : undefined}
      data-form-error-focus={isPassword ? true : undefined}
      data-sensitive-password={isPassword ? true : undefined}
      data-1p-ignore={preventPasswordAutofill ? true : undefined}
      data-lpignore={preventPasswordAutofill ? "true" : undefined}
      data-bwignore={preventPasswordAutofill ? true : undefined}
      readOnly={isReadOnly}
      aria-readonly={isReadOnly}
      tabIndex={isProfileReadOnly ? -1 : undefined}
      className={`rounded-tanaw-sm w-full min-w-0 border px-3 py-2.5 text-sm font-medium text-(--tanaw-text) outline-none focus:border-(--tanaw-accent-ink) focus:ring-2 focus:ring-(--tanaw-focus-ring)/30 ${
        isProfileReadOnly ? "cursor-default border-(--tanaw-border-soft) bg-(--tanaw-surface-inset)" : "border-(--tanaw-control-border) bg-(--tanaw-control-bg)"
      } ${isPassword || canEdit ? "pr-12" : ""} ${isPassword ? "tanaw-sensitive-input" : ""} ${error ? "border-(--tanaw-danger)" : ""}`}
    />
  );

  return (
    <div data-field-name={name} className="block">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">
        {label}
      </label>
      <span className="relative block">
        {input}
        {isPassword ? (
          <button
            type="button"
            disabled={!canRevealPassword}
            onClick={() => {
              if (canRevealPassword) setIsPasswordVisible((current) => !current);
            }}
            className="hover:text-tanaw-green focus-visible:ring-tanaw-green/30 absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-(--tanaw-text-muted) transition hover:bg-(--tanaw-selected-bg) focus-visible:ring-2 focus-visible:outline-none"
            aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : (
          canEdit && <EditFieldButton isEditing={isEditing} label={label} onClick={() => toggleEditing(isEditing, setIsEditing, inputRef)} />
        )}
      </span>
      {error && name ? (
        <span id={`${name}-error`} role="alert" className="mt-1.5 block text-xs font-semibold text-(--tanaw-error)">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function EditFieldButton({ isEditing, label, onClick }: { isEditing: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-visible:ring-tanaw-green/30 absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition focus-visible:ring-2 focus-visible:outline-none ${
        isEditing ? "bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)" : "hover:text-tanaw-green text-(--tanaw-text-muted) hover:bg-(--tanaw-selected-bg)"
      }`}
      aria-label={isEditing ? `Lock ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
      aria-pressed={isEditing}
    >
      {isEditing ? <Check size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
    </button>
  );
}

function toggleEditing(isEditing: boolean, setIsEditing: (value: boolean) => void, inputRef: RefObject<HTMLInputElement | null>) {
  if (isEditing) {
    setIsEditing(false);
    return;
  }
  setIsEditing(true);
  window.requestAnimationFrame(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  });
}
