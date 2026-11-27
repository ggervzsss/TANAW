type FormFieldProps = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  autoComplete?: string;
  maxLength?: number;
  helperText?: string;
};

export function FormField({ name, label, type = "text", required = false, placeholder, value, onChange, error, autoComplete, maxLength, helperText }: FormFieldProps) {
  const descriptionId = error || helperText ? `${name}-description` : undefined;
  return (
    <label data-field-name={name} className="block">
      <span className="mb-1.5 block text-[0.8125rem] font-semibold text-(--tanaw-text-secondary)">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        data-form-error-focus
        className={[
          "tanaw-control w-full rounded-tanaw-md border bg-(--tanaw-control-bg) px-4 py-3 text-sm text-(--tanaw-text) transition-[border-color,box-shadow,background-color] duration-200 ease-tanaw-out outline-none placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-bg-hover) focus:border-(--tanaw-accent-ink) focus:bg-(--tanaw-control-bg-focus) focus:shadow-(--tanaw-field-ring)",
          error ? "border-(--tanaw-error)" : "border-(--tanaw-control-border)",
        ].join(" ")}
      />
      {(error || helperText) && (
        <p id={descriptionId} role={error ? "alert" : undefined} className={`mt-1.5 text-xs font-semibold ${error ? "text-(--tanaw-error)" : "text-(--tanaw-text-muted)"}`}>
          {error || helperText}
        </p>
      )}
    </label>
  );
}
