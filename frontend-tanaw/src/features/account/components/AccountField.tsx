import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

type AccountFieldProps = {
  autoComplete?: string;
  defaultValue: string;
  error?: string;
  /** Short guidance shown under the field, such as "Optional". */
  hint?: string;
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

/**
 * A labelled settings input. Fields are always editable; the form's save bar decides when
 * changes are kept, so there is no per-field edit toggle. Read-only account facts belong in a
 * definition list, not in a disabled input.
 */
export function AccountField({
  label,
  defaultValue,
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
  hint,
}: AccountFieldProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isPasswordInputActive, setIsPasswordInputActive] = useState(!preventPasswordAutofill);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const isPassword = type === "password";
  const inputType = isPassword && isPasswordVisible ? "text" : type;
  // Password managers fill read-only inputs less eagerly; unlock as soon as the person reaches the field.
  const isPasswordAutofillLocked = isPassword && preventPasswordAutofill && !isPasswordInputActive;
  const canRevealPassword = isPassword && Boolean(value);
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div data-field-name={name} className="tanaw-account-field">
      <label htmlFor={inputId} className="tanaw-account-field-label">
        {label}
      </label>
      <span className="relative block">
        <input
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
          aria-describedby={describedBy}
          data-form-error-focus={isPassword ? true : undefined}
          data-sensitive-password={isPassword ? true : undefined}
          data-1p-ignore={preventPasswordAutofill ? true : undefined}
          data-lpignore={preventPasswordAutofill ? "true" : undefined}
          data-bwignore={preventPasswordAutofill ? true : undefined}
          readOnly={isPasswordAutofillLocked}
          className={isPassword ? "tanaw-account-field-input tanaw-sensitive-input" : "tanaw-account-field-input"}
        />
        {isPassword && (
          <button
            type="button"
            disabled={!canRevealPassword}
            onClick={() => {
              if (canRevealPassword) setIsPasswordVisible((current) => !current);
            }}
            className="tanaw-account-field-reveal"
            aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {isPasswordVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        )}
      </span>
      {error ? (
        <span id={errorId} role="alert" className="tanaw-account-field-error">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="tanaw-account-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
