import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import { AlertCircle, ArrowRight, ExternalLink, Eye, EyeOff, Headphones, Lock, User } from "lucide-react";
import { motion } from "motion/react";
import { PASSWORD_INPUT_MAX_CODE_UNITS } from "@/shared/utils/passwordPolicy";
import { PasswordRecoveryDialog } from "./PasswordRecoveryDialog";
import { SupportRequestDialog } from "./SupportRequestDialog";

type LoginFormProps = {
  authMessage: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onAuthMessageClear: () => void;
  lockoutSeconds: number;
};

type DialogMode = "recovery" | "support" | null;

function validateIdentifier(value: string): string {
  if (!value.trim()) return "Please enter your email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
  return "";
}

function validatePassword(value: string): string {
  return value.trim() ? "" : "Please enter your password.";
}

function formatLockout(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LoginForm({ authMessage, onSubmit, onAuthMessageClear, lockoutSeconds }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("tanaw-auth-remember") === "true");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogMode>(null);

  const handleIdentifierChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setIdentifier(value);
    if (authMessage) onAuthMessageClear();
    if (identifierError) setIdentifierError(value.trim() ? validateIdentifier(value) : "");
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setPassword(value);
    if (authMessage) onAuthMessageClear();
    if (passwordError) setPasswordError(value.trim() ? validatePassword(value) : "");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMessage) onAuthMessageClear();

    const nextIdentifierError = validateIdentifier(identifier);
    const nextPasswordError = validatePassword(password);
    setIdentifierError(nextIdentifierError);
    setPasswordError(nextPasswordError);
    if (isSubmitting || lockoutSeconds > 0 || nextIdentifierError || nextPasswordError) return;

    setIsSubmitting(true);
    try {
      await onSubmit(event);
    } finally {
      setIsSubmitting(false);
    }
  };

  const identifierShellClass = `tanaw-auth-field relative flex h-14 items-center rounded-xl border transition duration-200 ${
    identifierError
      ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]"
      : "border-(--tanaw-border) shadow-[0_1px_0_rgba(15,23,42,0.02)] focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
  }`;
  const passwordShellClass = `tanaw-auth-field relative flex h-14 items-center rounded-xl border transition duration-200 ${
    passwordError
      ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]"
      : "border-(--tanaw-border) shadow-[0_1px_0_rgba(15,23,42,0.02)] focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
  }`;

  return (
    <>
      <form autoComplete="on" noValidate onSubmit={handleSubmit}>
        <div className="mb-2">
          <label htmlFor="login-identifier" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
            Email
          </label>
          <div className={identifierShellClass} data-state={identifierError ? "invalid" : identifier ? "valid" : "empty"}>
            <User className="tanaw-auth-field-icon pointer-events-none absolute left-5 h-5 w-5" strokeWidth={1.9} />
            <input
              id="login-identifier"
              name="clientId"
              type="email"
              value={identifier}
              onChange={handleIdentifierChange}
              onBlur={() => {
                if (identifier.trim()) setIdentifierError(validateIdentifier(identifier));
              }}
              placeholder="Enter your email"
              autoComplete="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(identifierError)}
              aria-describedby={identifierError ? "login-identifier-error" : undefined}
              className="tanaw-auth-input h-full w-full rounded-xl bg-transparent px-14 pr-12 text-[15px] font-medium outline-none"
            />
            {identifierError ? <AlertCircle className="absolute right-5 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
          </div>
          <div id="login-identifier-error" className="mt-1 min-h-4" aria-live="polite">
            {identifierError ? <p className="text-xs font-medium text-(--tanaw-error)">{identifierError}</p> : null}
          </div>
        </div>

        <div className="mb-3">
          <label htmlFor="login-password" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
            Password
          </label>
          <div className={passwordShellClass} data-state={passwordError ? "invalid" : password ? "valid" : "empty"}>
            <Lock className="tanaw-auth-field-icon pointer-events-none absolute left-5 h-5 w-5" strokeWidth={1.9} />
            <input
              id="login-password"
              name="encryptionKey"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={handlePasswordChange}
              onBlur={() => {
                if (password.trim()) setPasswordError(validatePassword(password));
              }}
              placeholder="Enter your password"
              autoComplete="current-password"
              maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
              disabled={isSubmitting}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "login-password-error" : undefined}
              className="tanaw-auth-input h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium outline-none"
            />
            {passwordError ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="tanaw-auth-field-action absolute right-4 rounded-full p-1 transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-5 w-5" strokeWidth={1.9} /> : <Eye className="h-5 w-5" strokeWidth={1.9} />}
            </button>
          </div>
          <div id="login-password-error" className="mt-1 min-h-4" aria-live="polite">
            {passwordError ? <p className="text-xs font-medium text-(--tanaw-error)">{passwordError}</p> : null}
          </div>
        </div>

        <div className="tanaw-auth-control-gap mb-7 flex items-center justify-between gap-4">
          <label htmlFor="remember-me" className="flex cursor-pointer items-center gap-3 text-sm font-medium text-(--tanaw-text)">
            <input
              id="remember-me"
              name="rememberMe"
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="h-5 w-5 rounded border-(--tanaw-border) text-(--tanaw-green) accent-(--tanaw-green) focus:ring-(--tanaw-green)"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => setActiveDialog("recovery")}
            className="tanaw-soft-link -mr-2 rounded-full px-3 py-1.5 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none"
          >
            Forgot password?
          </button>
        </div>

        {authMessage ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert" aria-live="assertive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
            <span>{authMessage}</span>
          </div>
        ) : null}

        <motion.button
          type="submit"
          disabled={isSubmitting || lockoutSeconds > 0}
          className="tanaw-auth-primary-action flex h-15 w-full items-center justify-center gap-7 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px hover:shadow-[0_18px_36px_rgba(6,78,47,0.28)] focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-75"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.99 }}
          transition={{ duration: 0.2 }}
        >
          {lockoutSeconds > 0 ? `Try again in ${formatLockout(lockoutSeconds)}` : isSubmitting ? "Signing in..." : "Sign in"}
          <ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </motion.button>

        <div className="tanaw-auth-divider-row my-8 flex items-center gap-4 text-sm font-semibold text-(--tanaw-muted)">
          <span className="h-px flex-1 bg-(--tanaw-border)" />
          <span>OR</span>
          <span className="h-px flex-1 bg-(--tanaw-border)" />
        </div>

        <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-4">
            <span className="tanaw-auth-support-icon flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-(--tanaw-border) bg-white text-[#6f7785] shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
              <Headphones className="h-6 w-6" strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--tanaw-text)">Need help signing in?</span>
              <span className="block text-sm text-(--tanaw-muted)">Contact our support team.</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveDialog("support")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none"
          >
            Contact support
            <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </form>

      {activeDialog === "recovery" ? <PasswordRecoveryDialog onClose={() => setActiveDialog(null)} /> : null}
      {activeDialog === "support" ? <SupportRequestDialog onClose={() => setActiveDialog(null)} /> : null}
    </>
  );
}
