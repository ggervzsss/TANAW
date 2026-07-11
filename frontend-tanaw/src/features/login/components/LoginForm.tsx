import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowRight, Check, ExternalLink, Eye, EyeOff, Headphones, Lock, User, X } from "lucide-react";
import { motion } from "motion/react";
import { isAxiosError } from "axios";
import { apiClient } from "@/shared/lib/apiClient";
import { PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";

type LoginFormProps = {
  authMessage: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onAuthMessageClear: () => void;
  lockoutSeconds: number;
};

type DialogMode = "forgot" | "support" | null;
type RecoveryStep = "email" | "code" | "password" | "success";
type ApiErrorPayload = { detail?: string | { msg?: string }[] };

const validateIdentifier = (value: string) => {
  if (!value.trim()) return "Please enter your email.";

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(value)) {
    return "Enter a valid email address.";
  }

  return "";
};

const validatePassword = (value: string) => {
  if (!value.trim()) return "Please enter your password.";
  return "";
};

const validateRecoveryTarget = (value: string) => {
  if (!value.trim()) return "Please enter your registered email.";

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(value)) {
    return "Enter a valid registered email.";
  }

  return "";
};

const validateVerificationCode = (value: string) => {
  if (!value.trim()) return "Please enter the verification code.";
  if (!/^\d{6}$/.test(value.trim())) return "Enter the 6-digit verification code.";
  return "";
};

const validateNewPassword = (passwordValue: string, confirmPasswordValue: string) => {
  if (!passwordValue.trim()) return "Please enter a new password.";
  const policyError = validatePasswordPolicy(passwordValue);
  if (policyError) return policyError;
  if (passwordValue !== confirmPasswordValue) return "Passwords do not match.";
  return "";
};

const formatLockout = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

export function LoginForm({ authMessage, onSubmit, onAuthMessageClear, lockoutSeconds }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("tanaw-auth-remember") === "true");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogMode>(null);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>("email");
  const [recoveryTarget, setRecoveryTarget] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryChallengeId, setRecoveryChallengeId] = useState("");
  const [recoveryResetToken, setRecoveryResetToken] = useState("");
  const [recoveryExpiresIn, setRecoveryExpiresIn] = useState(10);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [isRecoverySubmitting, setIsRecoverySubmitting] = useState(false);
  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportError, setSupportError] = useState("");
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [isSupportSubmitting, setIsSupportSubmitting] = useState(false);

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

  const validateForm = () => {
    const nextIdentifierError = validateIdentifier(identifier);
    const nextPasswordError = validatePassword(password);

    setIdentifierError(nextIdentifierError);
    setPasswordError(nextPasswordError);

    return !nextIdentifierError && !nextPasswordError;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (authMessage) onAuthMessageClear();
    if (isSubmitting || lockoutSeconds > 0 || !validateForm()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(event);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDialog = (dialog: Exclude<DialogMode, null>) => {
    setActiveDialog(dialog);
    setRecoveryStep("email");
    setRecoveryTarget("");
    setRecoveryCode("");
    setRecoveryChallengeId("");
    setRecoveryResetToken("");
    setRecoveryExpiresIn(10);
    setRecoveryPassword("");
    setRecoveryPasswordConfirm("");
    setRecoveryError("");
    setIsRecoverySubmitting(false);
    setSupportName("");
    setSupportEmail("");
    setSupportMessage("");
    setSupportError("");
    setSupportSubmitted(false);
    setIsSupportSubmitting(false);
  };

  const closeDialog = () => {
    setActiveDialog(null);
    setRecoveryStep("email");
    setRecoveryTarget("");
    setRecoveryCode("");
    setRecoveryChallengeId("");
    setRecoveryResetToken("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirm("");
    setRecoveryError("");
    setIsRecoverySubmitting(false);
    setSupportError("");
    setSupportSubmitted(false);
    setIsSupportSubmitting(false);
  };

  const handleRecoveryRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateRecoveryTarget(recoveryTarget);
    setRecoveryError(nextError);

    if (nextError) return;

    setIsRecoverySubmitting(true);
    try {
      const response = await apiClient.post<{ challengeId: string; expiresInMinutes: number }>("/auth/forgot-password/request", {
        email: recoveryTarget,
      });
      setRecoveryChallengeId(response.data.challengeId);
      setRecoveryExpiresIn(response.data.expiresInMinutes);
      setRecoveryStep("code");
      setRecoveryError("");
    } catch (error) {
      setRecoveryError(getApiErrorMessage(error, "Unable to start account recovery. Please try again."));
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const handleRecoveryVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateVerificationCode(recoveryCode);
    setRecoveryError(nextError);

    if (nextError) return;

    setIsRecoverySubmitting(true);
    try {
      const response = await apiClient.post<{ resetToken: string }>("/auth/forgot-password/verify", {
        challengeId: recoveryChallengeId,
        code: recoveryCode,
      });
      setRecoveryResetToken(response.data.resetToken);
      setRecoveryStep("password");
      setRecoveryError("");
    } catch (error) {
      setRecoveryError(getApiErrorMessage(error, "Invalid or expired verification code."));
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const handleRecoveryReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateNewPassword(recoveryPassword, recoveryPasswordConfirm);
    setRecoveryError(nextError);

    if (nextError) return;

    setIsRecoverySubmitting(true);
    try {
      await apiClient.post("/auth/forgot-password/reset", {
        challengeId: recoveryChallengeId,
        resetToken: recoveryResetToken,
        newPassword: recoveryPassword,
      });
      setRecoveryStep("success");
      setRecoveryError("");
      setRecoveryPassword("");
      setRecoveryPasswordConfirm("");
    } catch (error) {
      setRecoveryError(getApiErrorMessage(error, "Unable to reset password. Please restart account recovery."));
    } finally {
      setIsRecoverySubmitting(false);
    }
  };

  const handleSupportRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emailError = validateRecoveryTarget(supportEmail);
    if (!supportName.trim()) {
      setSupportError("Please enter your name.");
      return;
    }
    if (emailError) {
      setSupportError(emailError);
      return;
    }
    if (supportMessage.trim().length < 10) {
      setSupportError("Please describe the support request in at least 10 characters.");
      return;
    }

    setIsSupportSubmitting(true);
    setSupportError("");
    try {
      await apiClient.post("/auth/support-request", {
        name: supportName,
        email: supportEmail,
        message: supportMessage,
      });
      setSupportSubmitted(true);
      setSupportName("");
      setSupportEmail("");
      setSupportMessage("");
    } catch (error) {
      setSupportError(getApiErrorMessage(error, "Unable to record support request. Please contact the system administrator."));
    } finally {
      setIsSupportSubmitting(false);
    }
  };

  const identifierShellClass = `tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-white transition duration-200 ${
    identifierError
      ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]"
      : "border-(--tanaw-border) shadow-[0_1px_0_rgba(15,23,42,0.02)] focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
  }`;

  const passwordShellClass = `tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-white transition duration-200 ${
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
          <div className={identifierShellClass}>
            <User className="pointer-events-none absolute left-5 h-5 w-5 text-[#7b8492]" strokeWidth={1.9} />
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
              aria-invalid={Boolean(identifierError)}
              aria-describedby={identifierError ? "login-identifier-error" : undefined}
              className="h-full w-full rounded-xl bg-transparent px-14 pr-12 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
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
          <div className={passwordShellClass}>
            <Lock className="pointer-events-none absolute left-5 h-5 w-5 text-[#7b8492]" strokeWidth={1.9} />
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
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "login-password-error" : undefined}
              className="h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
            />
            {passwordError ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((currentValue) => !currentValue)}
              className="absolute right-4 rounded-full p-1 text-[#7b8492] transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
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
            onClick={() => openDialog("forgot")}
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

        <p className="mt-4 text-center text-xs leading-5 font-medium text-(--tanaw-muted)">New TANAW accounts must be activated using the secure link sent to the registered email.</p>

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
            onClick={() => openDialog("support")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none"
          >
            Contact support
            <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </form>

      {activeDialog
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(3,20,12,0.54)] px-5 py-6 backdrop-blur-md sm:items-center sm:py-8"
              role="presentation"
              onMouseDown={closeDialog}
              onPointerMove={(event) => event.stopPropagation()}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby={activeDialog === "forgot" ? "forgot-password-title" : "contact-support-title"}
                className="my-auto max-h-[calc(100svh-3rem)] w-full max-w-md overflow-y-auto rounded-[36px] border border-white/80 bg-white p-6 shadow-[0_34px_100px_rgba(0,0,0,0.28)] ring-1 ring-black/3 sm:p-8"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold tracking-[0.24em] text-(--tanaw-gold) uppercase">{activeDialog === "forgot" ? "Account Recovery" : "Support Desk"}</p>
                    <h2 id={activeDialog === "forgot" ? "forgot-password-title" : "contact-support-title"} className="mt-2 text-xl font-bold text-(--tanaw-text)">
                      {activeDialog === "forgot" ? "Forgot password" : "Contact support"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="rounded-full p-2 text-(--tanaw-muted) transition hover:bg-emerald-50 hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
                    aria-label="Close dialog"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {activeDialog === "forgot" ? (
                  <RecoveryDialogContent
                    step={recoveryStep}
                    email={recoveryTarget}
                    code={recoveryCode}
                    password={recoveryPassword}
                    confirmPassword={recoveryPasswordConfirm}
                    expiresIn={recoveryExpiresIn}
                    error={recoveryError}
                    isSubmitting={isRecoverySubmitting}
                    onEmailChange={(value) => {
                      setRecoveryTarget(value);
                      if (recoveryError) setRecoveryError("");
                    }}
                    onCodeChange={(value) => {
                      setRecoveryCode(value.replace(/\D/g, "").slice(0, 6));
                      if (recoveryError) setRecoveryError("");
                    }}
                    onPasswordChange={(value) => {
                      setRecoveryPassword(value);
                      if (recoveryError) setRecoveryError("");
                    }}
                    onConfirmPasswordChange={(value) => {
                      setRecoveryPasswordConfirm(value);
                      if (recoveryError) setRecoveryError("");
                    }}
                    onRequest={handleRecoveryRequest}
                    onVerify={handleRecoveryVerify}
                    onReset={handleRecoveryReset}
                    onClose={closeDialog}
                  />
                ) : (
                  <SupportDialogContent
                    name={supportName}
                    email={supportEmail}
                    message={supportMessage}
                    error={supportError}
                    submitted={supportSubmitted}
                    isSubmitting={isSupportSubmitting}
                    onNameChange={(value) => {
                      setSupportName(value);
                      if (supportError) setSupportError("");
                    }}
                    onEmailChange={(value) => {
                      setSupportEmail(value);
                      if (supportError) setSupportError("");
                    }}
                    onMessageChange={(value) => {
                      setSupportMessage(value);
                      if (supportError) setSupportError("");
                    }}
                    onSubmit={handleSupportRequest}
                  />
                )}
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function RecoveryDialogContent({
  step,
  email,
  code,
  password,
  confirmPassword,
  expiresIn,
  error,
  isSubmitting,
  onEmailChange,
  onCodeChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onRequest,
  onVerify,
  onReset,
  onClose,
}: {
  step: RecoveryStep;
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
  expiresIn: number;
  error: string;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onRequest: (event: FormEvent<HTMLFormElement>) => void;
  onVerify: (event: FormEvent<HTMLFormElement>) => void;
  onReset: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  if (step === "success") {
    return (
      <RecoveryStepFrame key="success" title="Password Updated">
        <div className="rounded-[40px] border border-emerald-100 bg-emerald-50 p-5 text-sm leading-6 text-emerald-950">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-(--tanaw-green) shadow-sm">
            <Check className="h-5 w-5" />
          </div>
          <p className="font-semibold">Password updated.</p>
          <p className="mt-2">You can now sign in with your new password.</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Return to login
          </button>
        </div>
      </RecoveryStepFrame>
    );
  }

  if (step === "code") {
    return (
      <RecoveryStepFrame key="code" title="Verification Code">
        <form onSubmit={onVerify}>
          <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Enter the 6-digit verification code sent to your registered email. The code expires in {expiresIn} minutes and can be used once.</p>
          <label htmlFor="recovery-code" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
            Verification code
          </label>
          <input
            id="recovery-code"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            className={`h-12 w-full rounded-[22px] border bg-white px-4 text-sm tracking-[0.3em] transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] ${
              error ? "border-(--tanaw-error)" : "border-(--tanaw-border)"
            }`}
            placeholder="000000"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "recovery-error" : undefined}
          />
          <RecoveryError message={error} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Verifying..." : "Verify code"}
          </button>
        </form>
      </RecoveryStepFrame>
    );
  }

  if (step === "password") {
    return (
      <RecoveryStepFrame key="password" title="Set New Password">
        <form onSubmit={onReset}>
          <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Create a new private password for {email}.</p>
          <div className="space-y-4">
            <RecoveryPasswordInput id="recovery-new-password" label="New password" value={password} onChange={onPasswordChange} placeholder="Enter new password" error={error} />
            <RecoveryPasswordInput
              id="recovery-confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={onConfirmPasswordChange}
              placeholder="Confirm new password"
              error={error}
            />
          </div>
          <RecoveryError message={error} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Updating..." : "Reset password"}
          </button>
        </form>
      </RecoveryStepFrame>
    );
  }

  return (
    <RecoveryStepFrame key="email" title="Account Recovery">
      <form onSubmit={onRequest}>
        <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Enter your registered email. If an account matches, a verification code will be sent there for secure recovery.</p>
        <label htmlFor="recovery-target" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
          Registered email
        </label>
        <input
          id="recovery-target"
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          className={`h-12 w-full rounded-[22px] border bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] ${
            error ? "border-(--tanaw-error)" : "border-(--tanaw-border)"
          }`}
          placeholder="Enter registered email"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "recovery-error" : undefined}
        />
        <RecoveryError message={error} />
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Preparing..." : "Continue"}
        </button>
      </form>
    </RecoveryStepFrame>
  );
}

function RecoveryPasswordInput({
  error,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  error: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPasswordVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-12 w-full rounded-[22px] border bg-white px-4 pr-12 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] ${
            error ? "border-(--tanaw-error)" : "border-(--tanaw-border)"
          }`}
          placeholder={placeholder}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "recovery-error" : undefined}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsPasswordVisible((current) => !current)}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-[#7b8492] transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {isPasswordVisible ? <EyeOff className="h-5 w-5" strokeWidth={1.9} /> : <Eye className="h-5 w-5" strokeWidth={1.9} />}
        </button>
      </div>
    </div>
  );
}

function RecoveryStepFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
      <div className="mb-5">
        <p className="text-sm font-bold text-(--tanaw-text)">{title}</p>
        <span className="mt-2 block h-1 w-12 rounded-full bg-(--tanaw-gold)/75" aria-hidden="true" />
      </div>
      {children}
    </motion.div>
  );
}

function RecoveryError({ message }: { message: string }) {
  return (
    <div id="recovery-error" className="mt-2 min-h-5" aria-live="polite">
      {message ? <p className="text-sm font-medium text-(--tanaw-error)">{message}</p> : null}
    </div>
  );
}

function SupportDialogContent({
  name,
  email,
  message,
  error,
  submitted,
  isSubmitting,
  onNameChange,
  onEmailChange,
  onMessageChange,
  onSubmit,
}: {
  name: string;
  email: string;
  message: string;
  error: string;
  submitted: boolean;
  isSubmitting: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div>
      <div className="rounded-[40px] border border-(--tanaw-border) bg-[#f8faf8] p-5">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[22px] border border-(--tanaw-border) bg-white text-(--tanaw-green)">
          <Headphones className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-(--tanaw-text)">Send your sign-in concern directly to the TANAW support queue.</p>
        <p className="mt-2 text-sm text-(--tanaw-muted)">IT and Admin personnel will receive the request and use your registered email to follow up.</p>
      </div>

      {submitted ? (
        <div className="mt-5 rounded-[28px] border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-950">Support request sent to TANAW support.</div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
            placeholder="Your name"
          />
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
            placeholder="Your email"
          />
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            className="min-h-24 w-full resize-none rounded-[22px] border border-(--tanaw-border) bg-white px-4 py-3 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
            placeholder="Describe the sign-in issue"
          />
          {error ? <p className="text-sm font-medium text-(--tanaw-error)">{error}</p> : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Recording..." : "Record support request"}
          </button>
        </form>
      )}
    </div>
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<ApiErrorPayload>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail[0]?.msg ?? fallback;
  }
  return fallback;
}
