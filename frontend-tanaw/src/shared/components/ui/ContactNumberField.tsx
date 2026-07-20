import { useState } from "react";
import { PHILIPPINE_MOBILE_ERROR, toPhilippineLocalDigits } from "@/shared/utils/accountValidation";

type ContactNumberFieldProps = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
};

export function ContactNumberField({ name, label, value, onChange, error, required = false }: ContactNumberFieldProps) {
  const [inputError, setInputError] = useState("");
  const normalizedValue = value ? `+63${value}` : "";
  const descriptionId = `${name}-description`;
  const displayedError = error || inputError;

  const handleValueChange = (nextValue: string) => {
    const nextLocalDigits = toPhilippineLocalDigits(nextValue);
    if ((nextValue && !/^\d*$/.test(nextValue)) || (nextLocalDigits && !nextLocalDigits.startsWith("9"))) {
      setInputError(PHILIPPINE_MOBILE_ERROR);
      return;
    }
    setInputError("");
    onChange(nextLocalDigits);
  };

  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</span>
      <div
        className={[
          "focus-within:border-tanaw-green focus-within:ring-tanaw-green/15 flex w-full overflow-hidden rounded-xl border bg-white transition focus-within:ring-4 dark:bg-[#0f172a]",
          displayedError ? "border-red-300" : "border-slate-300",
        ].join(" ")}
      >
        <span className="flex items-center border-r border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">+63</span>
        <input
          name={`${name}Local`}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required={required}
          value={value}
          maxLength={10}
          pattern="9[0-9]{9}"
          aria-invalid={Boolean(displayedError)}
          aria-describedby={displayedError ? descriptionId : undefined}
          onChange={(event) => handleValueChange(event.target.value)}
          onPaste={(event) => {
            event.preventDefault();
            handleValueChange(event.clipboardData.getData("text"));
          }}
          placeholder="9171234567"
          className="min-w-0 flex-1 px-4 py-3 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>
      <input type="hidden" name={name} value={normalizedValue} />
      {displayedError && (
        <p id={descriptionId} role="alert" className="mt-1.5 text-xs font-semibold text-red-600">
          {displayedError}
        </p>
      )}
    </label>
  );
}
