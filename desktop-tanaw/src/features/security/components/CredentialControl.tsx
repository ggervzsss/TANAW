import { Check, Key, RefreshCw } from "lucide-react";
import type { FormEvent } from "react";
import { Card } from "../../../components/Card";

type CredentialControlProps = {
  isLoading: boolean;
  isSuccess: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function CredentialControl({ isLoading, isSuccess, onSubmit }: CredentialControlProps) {
  const inputClassName =
    "w-full rounded-xl border border-gray-200 bg-white p-3.5 font-mono text-sm text-[#111827] shadow-sm outline-none transition-colors focus:border-[#065f46] focus:ring-2 focus:ring-[#065f46]/12";

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
          <input name="currentPassword" type="password" placeholder="******" className={inputClassName} required />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">New Password</label>
            <input name="newPassword" type="password" minLength={6} placeholder="******" className={inputClassName} required />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase">Confirm New Password</label>
            <input name="confirmPassword" type="password" minLength={6} placeholder="******" className={inputClassName} required />
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
