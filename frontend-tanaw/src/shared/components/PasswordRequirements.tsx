import { CheckCircle2, Circle, Info, XCircle } from "lucide-react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, getPasswordRequirementStatus, normalizePassword } from "@/shared/utils/passwordPolicy";

type RequirementState = "idle" | "met" | "unmet";

export function PasswordRequirements({ password }: { password: string }) {
  const status = getPasswordRequirementStatus(password);
  const requirements = [
    {
      key: "length",
      label: `Between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      state: toRequirementState(status.hasValue, status.isLengthValid),
    },
    {
      key: "common",
      label: "Not a common or easily guessed password",
      state: toRequirementState(status.hasValue, status.isNotCommon),
    },
  ] as const;
  const metCount = requirements.filter((requirement) => requirement.state === "met").length;

  return (
    <section
      aria-label="Password requirements"
      className="tanaw-password-requirements mt-2 mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/55 px-4 py-3 shadow-inner shadow-emerald-950/3 dark:border-emerald-400/20 dark:bg-(--tanaw-success-surface) dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-wide text-emerald-900 uppercase dark:text-emerald-200">Password requirements</p>
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {status.characterCount} {status.characterCount === 1 ? "character" : "characters"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {requirements.map((requirement) => (
          <RequirementItem key={requirement.key} label={requirement.label} state={requirement.state} />
        ))}
      </ul>
      <p className="mt-2 flex items-start gap-2 text-xs leading-5 font-medium text-(--tanaw-muted) dark:text-slate-300">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>Passwords, spaces, Unicode, and password managers are supported. No special-character mix is required.</span>
      </p>
      <span className="sr-only" aria-live="polite">
        {status.hasValue ? `${metCount} of ${requirements.length} password requirements met.` : "Enter a new password to check its requirements."}
      </span>
    </section>
  );
}

export function PasswordMatchIndicator({ password, confirmation }: { password: string; confirmation: string }) {
  const hasConfirmation = confirmation.length > 0;
  const matches = hasConfirmation && password.length > 0 && normalizePassword(password) === normalizePassword(confirmation);
  const state = toRequirementState(hasConfirmation, matches);
  const label = state === "idle" ? "Re-enter the new password to confirm it." : state === "met" ? "Passwords match" : "Passwords do not match";

  return (
    <ul className="mt-2" aria-live="polite">
      <RequirementItem label={label} state={state} />
    </ul>
  );
}

function RequirementItem({ label, state }: { label: string; state: RequirementState }) {
  const Icon = state === "met" ? CheckCircle2 : state === "unmet" ? XCircle : Circle;
  const stateLabel = state === "met" ? "met" : state === "unmet" ? "not met" : "not checked";
  const colorClass = state === "met" ? "text-emerald-700 dark:text-emerald-300" : state === "unmet" ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400";

  return (
    <li className={`flex items-start gap-2 text-xs leading-5 font-semibold ${colorClass}`} data-state={state} aria-label={`${label}: ${stateLabel}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}

function toRequirementState(hasValue: boolean, isMet: boolean): RequirementState {
  if (!hasValue) return "idle";
  return isMet ? "met" : "unmet";
}
