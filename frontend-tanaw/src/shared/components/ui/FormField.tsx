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
};

export function FormField({ name, label, type = "text", required = false, placeholder, value, onChange, error, autoComplete }: FormFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        autoComplete={autoComplete}
        className={[
          "focus:border-tanaw-green focus:ring-tanaw-green/15 w-full rounded-xl border bg-white px-4 py-3 text-sm font-medium text-slate-900 transition outline-none focus:ring-4",
          error ? "border-red-300" : "border-slate-300",
        ].join(" ")}
      />
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </label>
  );
}
