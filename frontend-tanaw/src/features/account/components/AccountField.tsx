import { Eye, EyeOff, Pencil } from "lucide-react";
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
      className={`focus:ring-tanaw-green/20 w-full rounded-lg border p-3 text-sm font-semibold text-slate-900 transition outline-none focus:ring-2 dark:text-slate-100 ${
        isProfileReadOnly ? "cursor-default border-slate-200 bg-slate-50" : "border-tanaw-green bg-white shadow-sm dark:bg-(--tanaw-control-bg)"
      } ${isPassword || canEdit ? "pr-12" : ""} ${isPassword ? "tanaw-sensitive-input" : ""} ${error ? "border-red-400" : ""}`}
    />
  );

  return (
    <div data-field-name={name} className="block">
      <label htmlFor={inputId} className="mb-2 block text-xs font-bold tracking-wide text-slate-500 uppercase">
        {label}
      </label>
      <span className="relative block">
        {input}
        {isPassword ? (
          <button
            type="button"
            tabIndex={-1}
            disabled={!canRevealPassword}
            onClick={() => {
              if (canRevealPassword) setIsPasswordVisible((current) => !current);
            }}
            className="hover:text-tanaw-green focus-visible:ring-tanaw-green/30 absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-emerald-50 focus-visible:ring-2 focus-visible:outline-none"
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
        isEditing ? "text-tanaw-green bg-emerald-50" : "hover:text-tanaw-green text-slate-400 hover:bg-emerald-50"
      }`}
      aria-label={isEditing ? `Lock ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}
      aria-pressed={isEditing}
    >
      <Pencil size={16} />
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
