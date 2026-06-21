import { toPhilippineLocalDigits } from "@/shared/utils/accountValidation";

type ContactNumberFieldProps = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
};

export function ContactNumberField({ name, label, value, onChange, error, required = false }: ContactNumberFieldProps) {
  const normalizedValue = value ? `+63${value}` : "";

  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</span>
      <div
        className={[
          "focus-within:border-tanaw-green focus-within:ring-tanaw-green/15 flex w-full overflow-hidden rounded-xl border bg-white transition focus-within:ring-4",
          error ? "border-red-300" : "border-slate-300",
        ].join(" ")}
      >
        <span className="flex items-center border-r border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700">+63</span>
        <input
          name={`${name}Local`}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required={required}
          value={value}
          onChange={(event) => onChange(toPhilippineLocalDigits(event.target.value))}
          onPaste={(event) => {
            event.preventDefault();
            onChange(toPhilippineLocalDigits(event.clipboardData.getData("text")));
          }}
          placeholder="9171234567"
          className="min-w-0 flex-1 px-4 py-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>
      <input type="hidden" name={name} value={normalizedValue} />
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </label>
  );
}
