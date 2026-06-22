import { toPhilippineLocalDigits } from "../utils/form-validation";

type ContactNumberInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
};

export function ContactNumberInput({ label, value, onChange, error, required = false }: ContactNumberInputProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">{label}</span>
      <div
        className={`flex overflow-hidden rounded-xl border bg-white shadow-sm transition-colors focus-within:border-[#065f46] focus-within:ring-2 focus-within:ring-[#065f46]/12 ${error ? "border-tanaw-red" : "border-gray-200"}`}
      >
        <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 text-sm font-bold text-gray-700">+63</span>
        <input
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
          className="min-w-0 flex-1 p-3.5 text-sm text-[#111827] outline-none"
        />
      </div>
      {error && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{error}</p>}
    </label>
  );
}
