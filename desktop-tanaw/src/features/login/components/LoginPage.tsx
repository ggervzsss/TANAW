import { type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { isAxiosError } from "axios";
import { AlertCircle, ArrowRight, Check, Clipboard, Eye, EyeOff, ExternalLink, Headphones, LockKeyhole, MapPin, UserRound, X } from "lucide-react";
import { routePaths } from "../../../app/router/routePaths";
import { staffApi } from "../../../lib/axios";
import { cn } from "../../../utils/cn";
import { PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "../../../utils/password-policy";
import { useAuthStageGlow } from "../hooks/use-auth-stage-glow";
import { useLogin } from "../hooks/use-login";
import { loginSchema, type LoginFormValues } from "../schemas/login-schema";
import { isRememberEnabled, useAuthStore } from "../stores/auth-store";

const cityHallImage = `${import.meta.env.BASE_URL}images/dsc00386.jpg`;

const citySeal = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Seal_of_San_Pedro%2C_Laguna.png/1280px-Seal_of_San_Pedro%2C_Laguna.png";

type FormErrors = Partial<Record<keyof LoginFormValues, string>>;
type DialogMode = "forgot" | "support" | null;
type RecoveryStep = "email" | "code" | "password" | "success";
type SupportInfo = {
  supportEmail: string | null;
  supportPhone: string | null;
  message: string;
};
type ApiErrorPayload = { detail?: string | { msg?: string }[] };

const getAuthenticatedRoute = (mustChangePassword?: boolean) => (mustChangePassword ? routePaths.changePassword : routePaths.enterpriseDashboard);

type LoginLocationState = {
  from?: {
    pathname?: string;
    search?: string;
  };
};

function SampaguitaIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 18.5C18.2 14.1 18.9 9.8 20 6.7C21.1 9.8 21.8 14.1 20 18.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 20C12.8 18.3 10.3 14.7 8.9 11.7C12.2 12.1 16.3 13.6 19 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.9 23C12.5 24.8 8.3 23.9 5.4 22.7C8.4 21 12.4 19.9 16.9 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.1 20C27.5 18.3 30 14.7 31.1 11.7C27.8 12.1 23.7 13.6 21 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.1 23C27.5 24.8 31.7 23.9 34.6 22.7C31.6 21 27.6 19.9 23.1 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="21" r="2.4" fill="currentColor" />
    </svg>
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
          <button type="button" onClick={onClose} className="mt-5 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark)">
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
          <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Enter the 6-digit verification code recorded in Dev Log. The code expires in {expiresIn} minutes and can be used once.</p>
          <label htmlFor="desktop-recovery-code" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
            Verification code
          </label>
          <input
            id="desktop-recovery-code"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            className={cn(
              "h-12 w-full rounded-[22px] border bg-white px-4 text-sm tracking-[0.3em] transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
              error ? "border-(--tanaw-error)" : "border-(--tanaw-border)",
            )}
            placeholder="000000"
          />
          <RecoveryError message={error} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) disabled:cursor-not-allowed disabled:opacity-70"
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
            <RecoveryPasswordInput id="desktop-recovery-new-password" label="New password" value={password} onChange={onPasswordChange} placeholder="Enter new password" error={error} />
            <RecoveryPasswordInput
              id="desktop-recovery-confirm-password"
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
            className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) disabled:cursor-not-allowed disabled:opacity-70"
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
        <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Enter your registered email. If an account matches, a verification code is recorded in Dev Log for secure recovery.</p>
        <label htmlFor="desktop-recovery-target" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
          Registered email
        </label>
        <input
          id="desktop-recovery-target"
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          className={cn(
            "h-12 w-full rounded-[22px] border bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
            error ? "border-(--tanaw-error)" : "border-(--tanaw-border)",
          )}
          placeholder="Enter registered email"
        />
        <RecoveryError message={error} />
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) disabled:cursor-not-allowed disabled:opacity-70"
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
          className={cn(
            "h-12 w-full rounded-[22px] border bg-white px-4 pr-12 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
            error ? "border-(--tanaw-error)" : "border-(--tanaw-border)",
          )}
          placeholder={placeholder}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
        <button
          type="button"
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
    <div className="mt-2 min-h-5" aria-live="polite">
      {message ? <p className="text-sm font-medium text-(--tanaw-error)">{message}</p> : null}
    </div>
  );
}

function SupportDialogContent({
  info,
  name,
  email,
  message,
  error,
  submitted,
  copied,
  isSubmitting,
  onNameChange,
  onEmailChange,
  onMessageChange,
  onSubmit,
  onCopy,
}: {
  info: SupportInfo | null;
  name: string;
  email: string;
  message: string;
  error: string;
  submitted: boolean;
  copied: boolean;
  isSubmitting: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCopy: () => void;
}) {
  const hasSupportContact = Boolean(info?.supportEmail || info?.supportPhone);
  const supportEmailIsUsable = Boolean(info?.supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.supportEmail));
  const mailtoHref = supportEmailIsUsable ? `mailto:${info?.supportEmail}?subject=${encodeURIComponent("TANAW login support request")}` : undefined;

  return (
    <div>
      <div className="rounded-[40px] border border-(--tanaw-border) bg-[#f8faf8] p-5">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[22px] border border-(--tanaw-border) bg-white text-(--tanaw-green)">
          <Headphones className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-(--tanaw-text)">{info?.message ?? "Checking support contact..."}</p>
        {info?.supportEmail ? <p className="mt-2 text-sm text-(--tanaw-muted)">Email: {info.supportEmail}</p> : null}
        {info?.supportPhone ? <p className="mt-1 text-sm text-(--tanaw-muted)">Phone: {info.supportPhone}</p> : null}
        {mailtoHref ? (
          <a
            href={mailtoHref}
            className="mt-4 inline-flex items-center gap-2 rounded-[20px] bg-white px-4 py-2 text-sm font-semibold text-(--tanaw-green) shadow-sm ring-1 ring-(--tanaw-border) transition hover:ring-(--tanaw-green)"
          >
            Email support
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>

      {submitted ? (
        <div className="mt-5 rounded-[28px] border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-950">Support request recorded in Dev Log.</div>
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
            className="w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Recording..." : "Record support request"}
          </button>
        </form>
      )}

      {hasSupportContact ? (
        <button
          type="button"
          onClick={onCopy}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-3xl border border-(--tanaw-border) bg-white px-4 py-3 font-semibold text-(--tanaw-green) transition hover:border-(--tanaw-green) hover:shadow-[0_12px_26px_rgba(6,78,47,0.12)]"
        >
          {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
          {copied ? "Copied" : "Copy support contact"}
        </button>
      ) : null}
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

const formatLockout = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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

export function LoginPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const locationState = location.state as LoginLocationState | null;
  const redirectTo = locationState?.from?.pathname ? `${locationState.from.pathname}${locationState.from.search ?? ""}` : undefined;
  const [authMessage, setAuthMessage] = useState("");
  const loginMutation = useLogin(redirectTo, { onAuthMessage: setAuthMessage });
  const particles = useMemo(
    () => [
      { left: "7%", top: "58%", size: 3, delay: "0s", duration: "12s" },
      { left: "18%", top: "51%", size: 2, delay: "2.6s", duration: "11s" },
      { left: "23%", top: "74%", size: 3, delay: "0.4s", duration: "14s" },
      { left: "31%", top: "61%", size: 4, delay: "3.2s", duration: "12.5s" },
      { left: "44%", top: "55%", size: 3, delay: "4.1s", duration: "13s" },
      { left: "15%", top: "84%", size: 2, delay: "5.8s", duration: "16s" },
      { left: "88%", top: "78%", size: 2, delay: "7.1s", duration: "14s" },
    ],
    [],
  );
  const [showPassword, setShowPassword] = useState(false);
  const [values, setValues] = useState<LoginFormValues>({
    username: "",
    password: "",
  });
  const [rememberMe, setRememberMe] = useState(() => isRememberEnabled());
  const [errors, setErrors] = useState<FormErrors>({});
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
  const [supportInfo, setSupportInfo] = useState<SupportInfo | null>(null);
  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportError, setSupportError] = useState("");
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [isSupportSubmitting, setIsSupportSubmitting] = useState(false);
  const [supportCopied, setSupportCopied] = useState(false);
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLDivElement>();

  if (isAuthenticated) {
    return <Navigate to={getAuthenticatedRoute(user?.mustChangePassword)} replace />;
  }

  const updateField = (field: keyof LoginFormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({
      ...current,
      [field]: event.target.value,
    }));
    if (authMessage) setAuthMessage("");
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage("");
    const parsed = loginSchema.safeParse(values);

    if (!parsed.success) {
      const nextErrors: FormErrors = {};
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof LoginFormValues;
        nextErrors[field] = issue.message;
      });
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    if (loginMutation.lockoutSeconds <= 0) loginMutation.mutate({ ...parsed.data, rememberMe });
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
    setSupportCopied(false);
    if (dialog === "support") {
      void loadSupportInfo();
    }
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
    setSupportCopied(false);
  };

  const handleRecoveryRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextError = validateRecoveryTarget(recoveryTarget);
    setRecoveryError(nextError);
    if (nextError) return;

    setIsRecoverySubmitting(true);
    try {
      const response = await staffApi.post<{ challengeId: string; expiresInMinutes: number }>("/auth/forgot-password/request", {
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
      const response = await staffApi.post<{ resetToken: string }>("/auth/forgot-password/verify", {
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
      await staffApi.post("/auth/forgot-password/reset", {
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

  const handleCopySupport = async () => {
    const supportCopy = supportInfo?.supportEmail
      ? `TANAW support email: ${supportInfo.supportEmail}`
      : supportInfo?.supportPhone
        ? `TANAW support phone: ${supportInfo.supportPhone}`
        : "Please contact the TANAW system administrator.";

    try {
      await navigator.clipboard.writeText(supportCopy);
      setSupportCopied(true);
      window.setTimeout(() => setSupportCopied(false), 2200);
    } catch {
      setSupportCopied(false);
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
      await staffApi.post("/auth/support-request", {
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

  async function loadSupportInfo() {
    setSupportInfo(null);
    try {
      const response = await staffApi.get<SupportInfo>("/auth/support-info");
      setSupportInfo(response.data);
    } catch {
      setSupportInfo({
        supportEmail: null,
        supportPhone: null,
        message: "Please contact the TANAW system administrator.",
      });
    }
  }

  return (
    <div
      ref={stageRef}
      className="tanaw-login-stage tanaw-auth-stage tanaw-auth-desktop-stage tanaw-auth-shell relative grid h-svh min-h-svh grid-cols-[minmax(0,1.04fr)_minmax(420px,0.72fr)] items-center gap-8 bg-(--tanaw-bg) px-6 py-6 text-(--tanaw-text) lg:gap-10 lg:px-10 lg:py-8"
      style={stageGlowStyle}
    >
      <div className="tanaw-login-photo absolute inset-y-0 left-0 w-[82%]" style={{ backgroundImage: `url("${cityHallImage}")` }} aria-hidden="true" />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-particles absolute inset-0" aria-hidden="true">
        {particles.map((particle, index) => (
          <span
            key={index}
            className="tanaw-hero-particle"
            style={
              {
                left: particle.left,
                top: particle.top,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                "--particle-delay": particle.delay,
                "--particle-duration": particle.duration,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <section className="tanaw-auth-hero relative z-10 flex min-h-[min(42rem,calc(100svh-2rem))] items-end overflow-visible px-2 pb-10 text-white xl:pb-14">
        <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
          <div className="tanaw-sampaguita-glow mb-5 inline-flex text-(--tanaw-gold)">
            <SampaguitaIcon className="h-8 w-8" />
          </div>
          <h1 className="tanaw-auth-hero-title font-display text-5xl leading-tight font-bold text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)]">Enterprise Portal</h1>
          <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
          <p className="tanaw-auth-hero-copy mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
            Secure access for tourism enterprise reporting, camera monitoring, and operational compliance.
          </p>
          <div className="tanaw-auth-hero-location mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
            <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
            <span>San Pedro, Laguna, Philippines</span>
          </div>
        </motion.div>
      </section>

      <motion.form
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        onSubmit={handleSubmit}
        noValidate
        className="tanaw-auth-card relative z-10 ml-auto w-full max-w-135 rounded-[30px] border border-white/80 bg-white/96 p-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl xl:p-10"
        onPointerMove={(event) => event.stopPropagation()}
      >
        <div className="tanaw-auth-card-header mb-8">
          <div className="flex items-center gap-6">
            <img src={citySeal} alt="City of San Pedro seal" className="tanaw-auth-brand-seal h-20 w-20 object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)]" />
            <div>
              <h2 className="tanaw-auth-brand-title font-display text-[2rem] leading-tight font-extrabold text-(--tanaw-green)">TANAW PORTAL</h2>
              <p className="tanaw-auth-brand-subtitle mt-2 text-base font-medium text-(--tanaw-muted)">Enterprise Tourism Management</p>
            </div>
          </div>
          <div className="tanaw-auth-divider mt-8 flex items-center gap-3 text-(--tanaw-gold)">
            <SampaguitaIcon className="h-4 w-4 flex-none" />
            <span className="tanaw-gold-shimmer h-px flex-1 bg-(--tanaw-gold)/75" />
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-(--tanaw-text)">Username</span>
            <div
              className={cn(
                "tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-white transition duration-200 focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                errors.username ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border)",
              )}
            >
              <UserRound size={19} className="absolute left-5 text-[#7b8492]" />
              <input
                className="h-full w-full rounded-xl bg-transparent px-14 pr-12 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
                placeholder="Enter your username"
                value={values.username}
                onChange={updateField("username")}
                aria-invalid={Boolean(errors.username)}
              />
              {errors.username ? <AlertCircle className="absolute right-5 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} /> : null}
            </div>
            <span className="mt-1 block min-h-4 text-xs font-medium text-(--tanaw-error)">{errors.username}</span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-(--tanaw-text)">Password</span>
            <div
              className={cn(
                "tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-white transition duration-200 focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                errors.password ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border)",
              )}
            >
              <LockKeyhole size={19} className="absolute left-5 text-[#7b8492]" />
              <input
                type={showPassword ? "text" : "password"}
                className="h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
                placeholder="Enter your password"
                value={values.password}
                onChange={updateField("password")}
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} /> : null}
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-4 rounded-full p-1 text-[#7b8492] transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <span className="mt-1 block min-h-4 text-xs font-medium text-(--tanaw-error)">{errors.password}</span>
          </label>
        </div>

        <div className="tanaw-auth-control-gap mt-1 mb-7 flex items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-(--tanaw-text)">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="h-5 w-5 rounded border-(--tanaw-border) accent-(--tanaw-green)"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => openDialog("forgot")}
            className="tanaw-soft-link -mr-2 rounded-full px-3 py-1.5 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark)"
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

        <button
          type="submit"
          disabled={loginMutation.isPending || loginMutation.lockoutSeconds > 0}
          className="tanaw-auth-primary-action flex h-15 w-full items-center justify-center gap-7 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px hover:shadow-[0_18px_36px_rgba(6,78,47,0.28)] disabled:cursor-not-allowed disabled:opacity-75"
        >
          {loginMutation.lockoutSeconds > 0 ? `Try again in ${formatLockout(loginMutation.lockoutSeconds)}` : loginMutation.isPending ? "Signing in..." : "Sign in"}
          <ArrowRight className="h-5 w-5" strokeWidth={2} />
        </button>

        <div className="tanaw-auth-divider-row my-8 flex items-center gap-4 text-sm font-semibold text-(--tanaw-muted)">
          <span className="h-px flex-1 bg-(--tanaw-border)" />
          <span>OR</span>
          <span className="h-px flex-1 bg-(--tanaw-border)" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="tanaw-auth-support-icon flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-(--tanaw-border) bg-white text-[#6f7785] shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
              <Headphones className="h-6 w-6" strokeWidth={1.9} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--tanaw-text)">Need help signing in?</span>
              <span className="block text-sm text-(--tanaw-muted)">Contact our support team.</span>
            </span>
          </div>
          <button type="button" onClick={() => openDialog("support")} className="inline-flex items-center gap-2 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark)">
            Contact support
            <ExternalLink className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </motion.form>

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
                aria-labelledby={activeDialog === "forgot" ? "desktop-forgot-password-title" : "desktop-contact-support-title"}
                className="my-auto max-h-[calc(100svh-3rem)] w-full max-w-md overflow-y-auto rounded-[36px] border border-white/80 bg-white p-6 shadow-[0_34px_100px_rgba(0,0,0,0.28)] ring-1 ring-black/3 sm:p-8"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold tracking-[0.24em] text-(--tanaw-gold) uppercase">{activeDialog === "forgot" ? "Account Recovery" : "Support Desk"}</p>
                    <h2 id={activeDialog === "forgot" ? "desktop-forgot-password-title" : "desktop-contact-support-title"} className="mt-2 text-xl font-bold text-(--tanaw-text)">
                      {activeDialog === "forgot" ? "Forgot password" : "Contact support"}
                    </h2>
                  </div>
                  <button type="button" onClick={closeDialog} className="rounded-full p-2 text-(--tanaw-muted) transition hover:bg-emerald-50 hover:text-(--tanaw-green)" aria-label="Close dialog">
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
                    info={supportInfo}
                    name={supportName}
                    email={supportEmail}
                    message={supportMessage}
                    error={supportError}
                    submitted={supportSubmitted}
                    copied={supportCopied}
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
                    onCopy={handleCopySupport}
                  />
                )}
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
