import { CheckCircle2, Circle, Info, XCircle } from "lucide-react";
import { cn } from "../lib/cn";

type RequirementState = "idle" | "met" | "unmet";

/** What the app's password policy says about the typed password. */
export type PasswordRequirementStatus = { characterCount: number; hasValue: boolean; isLengthValid: boolean; isNotCommon: boolean };

export type PasswordRequirementsProps = {
  /** From the app's password policy (getPasswordRequirementStatus). */
  status: PasswordRequirementStatus;
  minLength: number;
  maxLength: number;
  className?: string;
};

/**
 * The live checklist under a new-password field. The app supplies the policy's verdict, so the
 * rules stay with the app (and match the backend) while the look is shared.
 */
export function PasswordRequirements({ status, minLength, maxLength, className = "mt-2" }: PasswordRequirementsProps) {
  const requirements = [
    {
      key: "length",
      label: `Between ${minLength} and ${maxLength} characters`,
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
      className={cn("tanaw-password-requirements rounded-tanaw-lg border border-(--tanaw-success-line) bg-(--tanaw-success-surface) px-4 py-3", className)}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-label text-(--tanaw-label) uppercase">Password requirements</p>
        <span className="text-xs font-semibold text-(--tanaw-accent-ink) tabular-nums">
          {status.characterCount} {status.characterCount === 1 ? "character" : "characters"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {requirements.map((requirement) => (
          <RequirementItem key={requirement.key} label={requirement.label} state={requirement.state} />
        ))}
      </ul>
      <p className="mt-2 flex items-start gap-2 text-xs leading-5 font-medium text-(--tanaw-text-muted)">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>Passwords, spaces, Unicode, and password managers are supported. No special-character mix is required.</span>
      </p>
      <span className="sr-only" aria-live="polite">
        {status.hasValue ? `${metCount} of ${requirements.length} password requirements met.` : "Enter a new password to check its requirements."}
      </span>
    </section>
  );
}

export type PasswordMatchIndicatorProps = {
  password: string;
  confirmation: string;
  /** Unicode normalisation used by the app's policy; defaults to NFC. */
  normalize?: (value: string) => string;
  className?: string;
  id?: string;
};

/** Says whether the confirmation field matches the new password. */
export function PasswordMatchIndicator({ password, confirmation, normalize = (value) => value.normalize("NFC"), className = "mt-2", id }: PasswordMatchIndicatorProps) {
  const hasConfirmation = confirmation.length > 0;
  const matches = hasConfirmation && password.length > 0 && normalize(password) === normalize(confirmation);
  const state = toRequirementState(hasConfirmation, matches);
  const label = state === "idle" ? "Re-enter the new password to confirm it." : state === "met" ? "Passwords match" : "Passwords do not match";

  return (
    <ul id={id} className={className} aria-live="polite">
      <RequirementItem label={label} state={state} />
    </ul>
  );
}

function RequirementItem({ label, state }: { label: string; state: RequirementState }) {
  const Icon = state === "met" ? CheckCircle2 : state === "unmet" ? XCircle : Circle;
  const stateLabel = state === "met" ? "met" : state === "unmet" ? "not met" : "not checked";
  const colorClass = state === "met" ? "text-(--tanaw-accent-ink)" : state === "unmet" ? "text-(--tanaw-error)" : "text-(--tanaw-text-muted)";

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
