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
      <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</span>
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
          "focus:border-tanaw-green focus:ring-tanaw-green/15 w-full rounded-xl border bg-white px-4 py-3 text-sm font-medium text-slate-900 transition outline-none focus:ring-4 dark:bg-[#0f172a] dark:text-slate-100 dark:placeholder:text-slate-500",
          error ? "border-red-300" : "border-slate-300",
        ].join(" ")}
      />
      {(error || helperText) && (
        <p id={descriptionId} role={error ? "alert" : undefined} className={`mt-1.5 text-xs font-semibold ${error ? "text-red-600" : "text-slate-500"}`}>
          {error || helperText}
        </p>
      )}
    </label>
  );
}
