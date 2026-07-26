import { type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { useFocusFirstInvalidField } from "@/shared/hooks/useFocusFirstInvalidField";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH, normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";
import { AuthParticles, AuthThemeToggle } from "../components";
import { useAuthStageGlow } from "../hooks";
import { completeAccountActivation, type AccountActivationDetails, validateAccountActivation } from "../services";
import { SAN_PEDRO_GATEWAY_IMAGE, SAN_PEDRO_GATEWAY_NIGHT_IMAGE, SAN_PEDRO_SEAL } from "../utils";

type ActivationView = "validating" | "ready" | "invalid" | "success";

type PasswordValues = {
  newPassword: string;
  confirmPassword: string;
};

type PasswordErrors = Partial<Record<keyof PasswordValues, string>>;

const authBackgroundImageStyle = {
  "--tanaw-auth-day-image": `url(${SAN_PEDRO_GATEWAY_IMAGE})`,
  "--tanaw-auth-night-image": `url(${SAN_PEDRO_GATEWAY_NIGHT_IMAGE})`,
} as CSSProperties;

export function ActivateAccountPage() {
  const clearLocalSession = useAuthStore((state) => state.logout);
  const focusFirstInvalidField = useFocusFirstInvalidField();
  const [activationToken] = useState(readActivationToken);
  const [view, setView] = useState<ActivationView>(activationToken ? "validating" : "invalid");
  const [details, setDetails] = useState<AccountActivationDetails | null>(null);
  const [pageMessage, setPageMessage] = useState(activationToken ? "" : "This activation link is missing its security token.");
  const [values, setValues] = useState<PasswordValues>({ newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLElement>();

  useEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    if (!activationToken) return undefined;

    let isCurrent = true;
    void validateAccountActivation(activationToken)
      .then((activationDetails) => {
        if (!isCurrent) return;
        setDetails(activationDetails);
        setPageMessage("");
        setView("ready");
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setPageMessage(getApiErrorMessage(error, "This activation link is invalid, expired, or has already been used."));
        setView("invalid");
      });

    return () => {
      isCurrent = false;
    };
  }, [activationToken]);

  const updateField = (field: keyof PasswordValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (pageMessage) setPageMessage("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validatePasswordValues(values);
    setErrors(nextErrors);
    setPageMessage("");
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalidField(event.currentTarget, ["newPassword", "confirmPassword"].filter((fieldName) => nextErrors[fieldName as keyof PasswordErrors]));
      return;
    }
    if (!activationToken) return;

    setIsSubmitting(true);
    try {
      await completeAccountActivation(activationToken, values.newPassword);
      clearLocalSession();
      setValues({ newPassword: "", confirmPassword: "" });
      setView("success");
    } catch (error) {
      setPageMessage(getApiErrorMessage(error, "Unable to activate this account. Request a new activation email and try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section ref={stageRef} className="tanaw-login-stage tanaw-auth-stage relative min-h-svh w-full bg-(--tanaw-bg) font-['Bai_Jamjuree'] text-(--tanaw-text)" style={stageGlowStyle}>
      <div className="tanaw-login-photo absolute inset-y-0 left-0 w-full lg:w-[82%]" style={authBackgroundImageStyle} aria-hidden="true" />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true" />
      <AuthParticles />
      <AuthThemeToggle />

      <div className="tanaw-auth-shell relative z-10 grid min-h-svh items-center gap-8 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(420px,0.82fr)] lg:gap-10 lg:px-12 xl:px-20">
        <section className="tanaw-auth-hero relative hidden min-h-[min(42rem,calc(100svh-2rem))] items-end px-2 pb-10 text-white lg:flex xl:pb-14">
          <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
            <ShieldCheck className="mb-5 h-9 w-9 text-(--tanaw-gold)" aria-hidden="true" />
            <h2 className="tanaw-auth-hero-title font-['Montserrat'] text-5xl leading-tight font-bold tracking-normal text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)] xl:text-6xl">
              Secure your TANAW account
            </h2>
            <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
            <p className="tanaw-auth-hero-copy mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
              Confirm your registered email and create a private password before accessing TANAW.
            </p>
            <div className="tanaw-auth-hero-location mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
              <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </motion.div>
        </section>

        <main className="flex min-h-0 items-center justify-center lg:justify-end">
          <motion.section
            className="tanaw-auth-card tanaw-activation-card relative z-10 w-full max-w-145 rounded-[30px] border border-white/80 bg-(--tanaw-card)/96 px-6 py-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl sm:px-9 sm:py-9 xl:px-10"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <ActivationHeader />
            {view === "validating" ? <ValidatingState /> : null}
            {view === "invalid" ? <InvalidState message={pageMessage} /> : null}
            {view === "ready" && details ? (
              <ActivationForm details={details} errors={errors} isSubmitting={isSubmitting} pageMessage={pageMessage} values={values} onChange={updateField} onSubmit={handleSubmit} />
            ) : null}
            {view === "success" && details ? <SuccessState details={details} /> : null}
          </motion.section>
        </main>
      </div>
    </section>
  );
}

function ActivationHeader() {
  return (
    <header className="mb-7">
      <div className="flex items-center gap-5 sm:gap-7">
        <img src={SAN_PEDRO_SEAL} alt="City of San Pedro seal" className="tanaw-auth-brand-seal h-16 w-16 flex-none object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)] sm:h-21.5 sm:w-21.5" />
        <div className="min-w-0">
          <h1 className="tanaw-auth-brand-title font-['Montserrat'] text-2xl leading-tight font-extrabold tracking-normal text-(--tanaw-green) sm:text-[2.35rem]">TANAW PORTAL</h1>
          <p className="tanaw-auth-brand-subtitle mt-2 text-sm leading-6 font-medium text-(--tanaw-muted) sm:text-lg">Account Activation</p>
        </div>
      </div>
      <div className="tanaw-auth-divider mt-8 h-px bg-(--tanaw-gold)/75" />
    </header>
  );
}

function ValidatingState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center text-center" aria-live="polite">
      <LoaderCircle className="h-10 w-10 animate-spin text-(--tanaw-green)" aria-hidden="true" />
      <h2 className="mt-5 font-['Montserrat'] text-xl font-extrabold text-(--tanaw-text)">Checking your activation link</h2>
      <p className="mt-2 text-sm leading-6 font-medium text-(--tanaw-muted)">Please wait while TANAW verifies that this link is valid and unused.</p>
    </div>
  );
}

function InvalidState({ message }: { message: string }) {
  return (
    <div className="py-5 text-center" role="alert">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertCircle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 className="mt-5 font-['Montserrat'] text-xl font-extrabold text-(--tanaw-text)">Activation link unavailable</h2>
      <p className="mt-3 text-sm leading-6 font-medium text-(--tanaw-muted)">{message}</p>
      <p className="mt-2 text-sm leading-6 text-(--tanaw-muted)">Ask TANAW IT personnel to resend the activation email from Accounts Management.</p>
      <Link to={routes.login} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-(--tanaw-green) px-5 py-3 text-sm font-bold text-white transition hover:bg-(--tanaw-green-dark)">
        Return to sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function ActivationForm({
  details,
  errors,
  isSubmitting,
  pageMessage,
  values,
  onChange,
  onSubmit,
}: {
  details: AccountActivationDetails;
  errors: PasswordErrors;
  isSubmitting: boolean;
  pageMessage: string;
  values: PasswordValues;
  onChange: (field: keyof PasswordValues) => (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="tanaw-activation-banner mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
        <div className="flex items-start gap-3">
          <span className="tanaw-activation-banner__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--tanaw-green) text-white dark:bg-emerald-400/15">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="tanaw-activation-banner__label text-xs font-bold tracking-wide text-emerald-700 uppercase">Verified activation link</p>
            <h2 className="tanaw-activation-banner__title mt-1 font-['Montserrat'] text-xl font-extrabold text-(--tanaw-text)">Welcome, {details.displayName}</h2>
            <p className="tanaw-activation-banner__copy mt-1 text-sm leading-6 font-medium text-emerald-800">Create the password you will use for your {formatRole(details.role)} account.</p>
            <p className="tanaw-activation-banner__copy mt-1 text-xs font-medium text-emerald-700">Link expires {formatExpiration(details.expiresAt)}.</p>
          </div>
        </div>
      </div>

      <div className="tanaw-activation-password-fields grid gap-4">
        <PasswordField label="New Password" name="newPassword" value={values.newPassword} error={errors.newPassword} onChange={onChange("newPassword")} />
        <PasswordField
          label="Confirm Password"
          name="confirmPassword"
          value={values.confirmPassword}
          error={errors.confirmPassword}
          onChange={onChange("confirmPassword")}
          guidance={
            <PasswordMatchIndicator
              id="confirm-password-guidance"
              password={values.newPassword}
              confirmation={values.confirmPassword}
              className={`mt-1.5 ${errors.confirmPassword ? "opacity-70" : ""}`}
            />
          }
          guidanceId="confirm-password-guidance"
        />
      </div>
      <PasswordRequirements password={values.newPassword} className="mt-3 mb-4" />

      {pageMessage ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert" aria-live="assertive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{pageMessage}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="tanaw-auth-primary-action flex h-15 w-full items-center justify-center gap-4 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-75"
      >
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        {isSubmitting ? "Activating..." : "Activate Account"}
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </form>
  );
}

function SuccessState({ details }: { details: AccountActivationDetails }) {
  const isEnterprise = details.role === "enterprise";
  return (
    <div className="py-5 text-center" aria-live="polite">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
      </span>
      <h2 className="mt-5 font-['Montserrat'] text-2xl font-extrabold text-(--tanaw-text)">Account activated</h2>
      <p className="mt-3 text-sm leading-6 font-medium text-(--tanaw-muted)">
        {isEnterprise
          ? "Your password is ready. Return to the TANAW Enterprise desktop application and sign in with your Enterprise ID or registered email."
          : "Your password is ready. You can now sign in to the TANAW portal using your registered email and new password."}
      </p>
      {isEnterprise ? (
        <p className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">You may safely close this browser tab.</p>
      ) : (
        <Link to={routes.login} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-(--tanaw-green) px-5 py-3 text-sm font-bold text-white transition hover:bg-(--tanaw-green-dark)">
          Continue to sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function PasswordField({
  label,
  name,
  value,
  error,
  onChange,
  guidance,
  guidanceId,
}: {
  label: string;
  name: keyof PasswordValues;
  value: string;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  guidance?: ReactNode;
  guidanceId?: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const errorId = `${name}-error`;
  return (
    <div data-field-name={name}>
      <label htmlFor={name} className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
        {label}
      </label>
      <div
        className={`tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-(--tanaw-auth-input-bg) transition duration-200 ${
          error
            ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]"
            : "border-(--tanaw-border) shadow-[0_1px_0_rgba(15,23,42,0.02)] focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
        }`}
      >
        <LockKeyhole className="pointer-events-none absolute left-5 h-5 w-5 text-[#7b8492]" aria-hidden="true" />
        <input
          id={name}
          name={name}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={label}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={[error ? errorId : null, guidanceId].filter(Boolean).join(" ") || undefined}
          data-form-error-focus
          className="h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
        />
        {error ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" aria-hidden="true" /> : null}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsVisible((current) => !current)}
          className="absolute right-4 rounded-full p-1 text-[#7b8492] transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {isVisible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-semibold text-(--tanaw-error)" role="alert">
          {error}
        </p>
      ) : null}
      {guidance}
    </div>
  );
}

function validatePasswordValues(values: PasswordValues) {
  const errors: PasswordErrors = {};
  const policyError = validatePasswordPolicy(values.newPassword);
  if (policyError) errors.newPassword = policyError;
  if (!values.confirmPassword) errors.confirmPassword = "Please confirm your password.";
  else if (normalizePassword(values.confirmPassword) !== normalizePassword(values.newPassword)) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

function readActivationToken() {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")?.trim() ?? "";
}

function formatRole(role: AccountActivationDetails["role"]) {
  if (role === "it") return "IT personnel";
  if (role === "admin") return "administrator";
  if (role === "staff") return "LGU staff";
  return "enterprise";
}

function formatExpiration(expiresAt: string) {
  const value = new Date(expiresAt);
  return Number.isNaN(value.getTime()) ? "at the time stated in your email" : formatPhilippineDateTime(value, "12-hour");
}
