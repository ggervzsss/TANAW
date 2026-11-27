import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import { AlertCircle, ExternalLink, Eye, EyeOff, Headphones, Lock, User } from "lucide-react";
import { Button } from "@/shared/ui-kit";
import { PASSWORD_INPUT_MAX_CODE_UNITS } from "@/shared/utils/passwordPolicy";
import { AuthActionTrail } from "./AuthActionTrail";
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

  return (
    <>
      <form className="tanaw-login-form" autoComplete="on" noValidate onSubmit={handleSubmit}>
        <div className="tanaw-auth-field-group">
          <label htmlFor="login-identifier" className="tanaw-auth-label">
            Email
          </label>
          <div className="tanaw-auth-field" data-state={identifierError ? "invalid" : identifier ? "valid" : "empty"}>
            <User className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
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
              className="tanaw-auth-input h-full w-full rounded-tanaw-md bg-transparent pr-12 pl-12 text-[0.9375rem] outline-none"
            />
            {identifierError ? <AlertCircle className="absolute right-4 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
          </div>
          <div id="login-identifier-error" className="tanaw-auth-field-message" aria-live="polite">
            {identifierError ? <p className="tanaw-auth-field-error">{identifierError}</p> : null}
          </div>
        </div>

        <div className="tanaw-auth-field-group">
          <label htmlFor="login-password" className="tanaw-auth-label">
            Password
          </label>
          <div className="tanaw-auth-field" data-state={passwordError ? "invalid" : password ? "valid" : "empty"}>
            <Lock className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
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
              className="tanaw-auth-input h-full w-full rounded-tanaw-md bg-transparent pr-22 pl-12 text-[0.9375rem] outline-none"
            />
            {passwordError ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((current) => !current)}
              className="tanaw-auth-field-action absolute right-3"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-5 w-5" strokeWidth={1.9} /> : <Eye className="h-5 w-5" strokeWidth={1.9} />}
            </button>
          </div>
          <div id="login-password-error" className="tanaw-auth-field-message" aria-live="polite">
            {passwordError ? <p className="tanaw-auth-field-error">{passwordError}</p> : null}
          </div>
        </div>

        <div className="tanaw-auth-control-gap flex items-center justify-between gap-4">
          <label htmlFor="remember-me" className="tanaw-auth-check">
            <input id="remember-me" name="rememberMe" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            Remember me
          </label>
          <button type="button" onClick={() => setActiveDialog("recovery")} className="tanaw-auth-link">
            Forgot password?
          </button>
        </div>

        {authMessage ? (
          <div className="tanaw-auth-alert mb-4" role="alert" aria-live="assertive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
            <span>{authMessage}</span>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={isSubmitting || lockoutSeconds > 0}
          aria-busy={isSubmitting || undefined}
          size="lg"
          fullWidth
          className="tanaw-auth-primary-action tanaw-auth-sheen"
          trailingIcon={<AuthActionTrail busy={isSubmitting} />}
        >
          {lockoutSeconds > 0 ? `Try again in ${formatLockout(lockoutSeconds)}` : isSubmitting ? "Signing in..." : "Sign in"}
        </Button>

        <div className="tanaw-auth-support-row">
          <Headphones className="tanaw-auth-support-icon" strokeWidth={1.9} aria-hidden="true" />
          <span className="tanaw-auth-support-row__text">
            <span className="tanaw-auth-support-row__title">Need help signing in?</span>
            <span className="tanaw-auth-support-row__copy">Contact our support team.</span>
          </span>
          <button type="button" onClick={() => setActiveDialog("support")} className="tanaw-auth-link tanaw-auth-support-row__action">
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
