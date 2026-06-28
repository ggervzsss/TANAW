import { Pencil } from "lucide-react";
import { forwardRef } from "react";
import { toPhilippineLocalDigits } from "../utils/form-validation";

type ContactNumberInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  isEditing?: boolean;
  onEdit?: () => void;
  readOnly?: boolean;
  required?: boolean;
  showEditIcon?: boolean;
};

export const ContactNumberInput = forwardRef<HTMLInputElement, ContactNumberInputProps>(function ContactNumberInput(
  { label, value, onChange, error, isEditing = false, onEdit, readOnly = false, required = false, showEditIcon = false },
  ref,
) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">{label}</span>
      <div
        className={`relative flex overflow-hidden rounded-xl border bg-white shadow-sm transition-colors focus-within:border-[#065f46] focus-within:ring-2 focus-within:ring-[#065f46]/12 ${isEditing ? "border-[#065f46] ring-2 ring-[#065f46]/12" : ""} ${error ? "border-tanaw-red" : "border-gray-200"}`}
      >
        <span className="flex items-center border-r border-gray-200 bg-emerald-50/70 px-3 text-sm font-bold text-gray-700">+63</span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          ref={ref}
          required={required}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(toPhilippineLocalDigits(event.target.value))}
          onPaste={(event) => {
            event.preventDefault();
            onChange(toPhilippineLocalDigits(event.clipboardData.getData("text")));
          }}
          placeholder="9171234567"
          className={`min-w-0 flex-1 p-3.5 text-sm text-[#111827] outline-none read-only:cursor-default ${showEditIcon ? "pr-10" : ""}`}
        />
        {showEditIcon && (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onClick={onEdit}
            className={`absolute top-1/2 right-2.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${isEditing ? "bg-emerald-50 text-[#065f46]" : "text-gray-400 hover:bg-emerald-50 hover:text-[#065f46]"}`}
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
      {error && <p className="text-tanaw-red mt-1.5 text-xs font-semibold">{error}</p>}
    </label>
  );
});
