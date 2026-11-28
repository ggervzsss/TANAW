import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/shared/ui-kit";
import { isCompleteAuthenticatorCode, isCompleteRecoveryCode, normalizeAuthenticatorCode, normalizeRecoveryCodeInput } from "@/shared/utils/twoFactorCodes";
import type { TwoFactorAnswer } from "../hooks/useLogin";
import { AuthActionTrail } from "./AuthActionTrail";

type TwoFactorLoginFormProps = {
  message: string;
  lockoutSeconds: number;
  onSubmit: (answer: TwoFactorAnswer) => Promise<boolean>;
  onMessageClear: () => void;
  onBack: () => void;
};

type CodeMode = "authenticator" | "recovery";

const copy: Record<CodeMode, { line: string; label: string; placeholder: string; toggle: string; missing: string }> = {
  authenticator: {
    line: "Enter the 6-digit code from your authenticator app.",
    label: "Verification code",
    placeholder: "123456",
    toggle: "Use a recovery code instead",
    missing: "Enter the 6-digit code.",
  },
  recovery: {
    line: "Enter one of the recovery codes you saved when you turned on two-step verification.",
    label: "Recovery code",
    placeholder: "XXXXX-XXXXX",
    toggle: "Use your authenticator app instead",
    missing: "Enter a recovery code, such as ABCDE-23456.",
  },
};

function formatLockout(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The second sign-in step, shown in the same glass panel once the password is accepted. */
export function TwoFactorLoginForm({ message, lockoutSeconds, onSubmit, onMessageClear, onBack }: TwoFactorLoginFormProps) {
  const [mode, setMode] = useState<CodeMode>("authenticator");
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const text = copy[mode];

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = mode === "authenticator" ? normalizeAuthenticatorCode(event.target.value) : normalizeRecoveryCodeInput(event.target.value);
    setValue(next);
    if (fieldError) setFieldError("");
    if (message) onMessageClear();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || lockoutSeconds > 0) return;
    const complete = mode === "authenticator" ? isCompleteAuthenticatorCode(value) : isCompleteRecoveryCode(value);
    if (!complete) {
      setFieldError(text.missing);
      inputRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    const accepted = await onSubmit(mode === "authenticator" ? { code: value } : { recoveryCode: value });
    if (accepted) return;
    setIsSubmitting(false);
    setValue("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const switchMode = () => {
    setMode((current) => (current === "authenticator" ? "recovery" : "authenticator"));
    setValue("");
    setFieldError("");
    if (message) onMessageClear();
  };

  const FieldIcon = mode === "authenticator" ? ShieldCheck : KeyRound;
  const busyOrLocked = isSubmitting || lockoutSeconds > 0;

  return (
    <form className="tanaw-login-form tanaw-auth-two-factor" autoComplete="off" noValidate onSubmit={handleSubmit} aria-labelledby="two-factor-title" aria-describedby="two-factor-line">
      <div className="tanaw-auth-two-factor__intro">
        <h2 id="two-factor-title" className="tanaw-auth-two-factor__title">
          Two-step verification
        </h2>
        <p id="two-factor-line" className="tanaw-auth-two-factor__line">
          {text.line}
        </p>
      </div>

      <div className="tanaw-auth-field-group">
        <label htmlFor="two-factor-code" className="tanaw-auth-label">
          {text.label}
        </label>
        <div className="tanaw-auth-field" data-state={fieldError ? "invalid" : value ? "valid" : "empty"}>
          <FieldIcon className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
          <input
            ref={inputRef}
            key={mode}
            id="two-factor-code"
            name={mode === "authenticator" ? "code" : "recoveryCode"}
            type="text"
            value={value}
            onChange={handleChange}
            inputMode={mode === "authenticator" ? "numeric" : "text"}
            autoComplete={mode === "authenticator" ? "one-time-code" : "off"}
            autoCapitalize={mode === "authenticator" ? "off" : "characters"}
            spellCheck={false}
            pattern={mode === "authenticator" ? "[0-9]*" : undefined}
            placeholder={text.placeholder}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "two-factor-code-error" : undefined}
            className="tanaw-auth-input tanaw-auth-two-factor__input rounded-tanaw-md h-full w-full bg-transparent pr-12 pl-12 outline-none"
          />
          {fieldError ? <AlertCircle className="absolute right-4 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
        </div>
        <div id="two-factor-code-error" className="tanaw-auth-field-message" aria-live="polite">
          {fieldError ? <p className="tanaw-auth-field-error">{fieldError}</p> : null}
        </div>
      </div>

      <div className="tanaw-auth-control-gap flex items-center justify-between gap-4">
        <button type="button" onClick={switchMode} className="tanaw-auth-link" disabled={isSubmitting}>
          {text.toggle}
        </button>
      </div>

      {message ? (
        <div className="tanaw-auth-alert mb-4" role="alert" aria-live="assertive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
          <span>{message}</span>
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={busyOrLocked}
        aria-busy={isSubmitting || undefined}
        size="lg"
        fullWidth
        className="tanaw-auth-primary-action tanaw-auth-sheen"
        trailingIcon={<AuthActionTrail busy={isSubmitting} />}
      >
        {lockoutSeconds > 0 ? `Try again in ${formatLockout(lockoutSeconds)}` : isSubmitting ? "Verifying..." : "Verify"}
      </Button>

      <div className="tanaw-auth-two-factor__back">
        <button type="button" onClick={onBack} className="tanaw-auth-link tanaw-auth-link--back" disabled={isSubmitting}>
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Back to sign in
        </button>
      </div>
    </form>
  );
}
