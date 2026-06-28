import { Check, Eye, EyeOff, Key, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Card } from "../../../components/Card";
import { PASSWORD_MIN_LENGTH } from "../../../utils/password-policy";

type CredentialControlProps = {
  isLoading: boolean;
  isSuccess: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function CredentialControl({ isLoading, isSuccess, onSubmit }: CredentialControlProps) {
  const [visiblePasswords, setVisiblePasswords] = useState({
    confirm: false,
    current: false,
    next: false,
  });
  const inputClassName =
    "w-full rounded-xl border border-gray-200 bg-white p-3.5 pr-12 font-mono text-sm text-[#111827] shadow-sm outline-none transition-colors focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12";

  return (
    <Card className="rounded-[28px] border-emerald-100/80 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.07)]">
      <h3 className="mb-5 flex items-center gap-2 border-b border-emerald-100 pb-3 text-sm font-bold tracking-wider text-[#111827] uppercase">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-[#065f46]">
          <Key size={16} />
        </span>
        Credential Control
      </h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">Current Password</label>
          <PasswordInput
            ariaLabel={visiblePasswords.current ? "Hide current password" : "Show current password"}
            className={inputClassName}
            isVisible={visiblePasswords.current}
            name="currentPassword"
            onToggle={() => setVisiblePasswords((current) => ({ ...current, current: !current.current }))}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">New Password</label>
            <PasswordInput
              ariaLabel={visiblePasswords.next ? "Hide new password" : "Show new password"}
              className={inputClassName}
              isVisible={visiblePasswords.next}
              minLength={PASSWORD_MIN_LENGTH}
              name="newPassword"
              onToggle={() => setVisiblePasswords((current) => ({ ...current, next: !current.next }))}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">Confirm New Password</label>
            <PasswordInput
              ariaLabel={visiblePasswords.confirm ? "Hide confirm new password" : "Show confirm new password"}
              className={inputClassName}
              isVisible={visiblePasswords.confirm}
              minLength={PASSWORD_MIN_LENGTH}
              name="confirmPassword"
              onToggle={() => setVisiblePasswords((current) => ({ ...current, confirm: !current.confirm }))}
            />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="flex min-w-45 items-center justify-center gap-2 rounded-full bg-[#065f46] px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_24px_rgba(6,95,70,0.2)] transition-colors hover:bg-[#044a36] disabled:bg-[#065f46]/70"
          >
            {isLoading ? <RefreshCw size={16} className="animate-spin" /> : isSuccess ? <Check size={16} /> : <Key size={16} />}
            {isLoading ? "Updating..." : isSuccess ? "Password Updated" : "Update Password"}
          </button>
        </div>
      </form>
    </Card>
  );
}

type PasswordInputProps = {
  ariaLabel: string;
  className: string;
  isVisible: boolean;
  minLength?: number;
  name: string;
  onToggle: () => void;
};

function PasswordInput({ ariaLabel, className, isVisible, minLength, name, onToggle }: PasswordInputProps) {
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <input name={name} type={isVisible ? "text" : "password"} minLength={minLength} placeholder="******" className={className} required />
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onToggle}
        className="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-emerald-50 hover:text-[#065f46] focus-visible:ring-2 focus-visible:ring-[#065f46]/30 focus-visible:outline-none"
      >
        <Icon size={16} />
      </button>
    </div>
  );
}
