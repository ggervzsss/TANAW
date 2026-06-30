import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordVisibilityInputProps = {
  hasError?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
  variant?: "compact" | "modal";
};

export function PasswordVisibilityInput({ hasError = false, onChange, placeholder, value, variant = "compact" }: PasswordVisibilityInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;
  const inputClass =
    variant === "modal"
      ? `w-full rounded-xl border py-3 pr-10 pl-3 text-sm transition outline-none focus:border-[#065f46] ${hasError ? "border-tanaw-red" : "border-gray-300"}`
      : "w-full rounded-sm border border-gray-300 py-1.5 pr-8 pl-2 text-xs text-gray-800 transition outline-none focus:border-[#065f46]";
  const buttonClass =
    variant === "modal"
      ? "absolute top-1/2 right-2.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-emerald-50 hover:text-[#065f46] focus:bg-emerald-50 focus:text-[#065f46] focus:outline-none"
      : "absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-gray-500 transition-colors hover:bg-emerald-50 hover:text-[#065f46] focus:bg-emerald-50 focus:text-[#065f46] focus:outline-none";

  return (
    <div className="relative">
      <input
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="current-password"
        className={inputClass}
      />
      <button type="button" onClick={() => setIsVisible((current) => !current)} className={buttonClass} aria-label={isVisible ? "Hide password" : "Show password"} aria-pressed={isVisible}>
        <Icon size={variant === "modal" ? 17 : 14} />
      </button>
    </div>
  );
}
