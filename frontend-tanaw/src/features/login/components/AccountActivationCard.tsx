import { type ChangeEvent, type FormEvent, type ReactNode, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "@/shared/utils/passwordPolicy";
import { formatActivationExpiration, formatActivationRole, type ActivationPasswordErrors, type ActivationPasswordValues, type ActivationView } from "../model";
import type { AccountActivationDetails } from "../services";
import { SAN_PEDRO_SEAL } from "../utils";

type AccountActivationCardProps = {
  details: AccountActivationDetails | null;
  errors: ActivationPasswordErrors;
  isSubmitting: boolean;
  pageMessage: string;
  values: ActivationPasswordValues;
  view: ActivationView;
  onChange: (field: keyof ActivationPasswordValues) => (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AccountActivationCard(props: AccountActivationCardProps) {
  return (
    <>
      <ActivationHeader />
      {props.view === "validating" && <ValidatingState />}
      {props.view === "invalid" && <InvalidState message={props.pageMessage} />}
      {props.view === "ready" && props.details && <ActivationForm {...props} details={props.details} />}
      {props.view === "success" && props.details && <SuccessState details={props.details} />}
    </>
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

function ActivationForm({ details, errors, isSubmitting, pageMessage, values, onChange, onSubmit }: AccountActivationCardProps & { details: AccountActivationDetails }) {
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
            <p className="tanaw-activation-banner__copy mt-1 text-sm leading-6 font-medium text-emerald-800">Create the password you will use for your {formatActivationRole(details.role)} account.</p>
            <p className="tanaw-activation-banner__copy mt-1 text-xs font-medium text-emerald-700">Link expires {formatActivationExpiration(details.expiresAt)}.</p>
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
      {pageMessage && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert" aria-live="assertive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{pageMessage}</span>
        </div>
      )}
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
  name: keyof ActivationPasswordValues;
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
        className={`tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-(--tanaw-auth-input-bg) transition duration-200 ${error ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border) shadow-[0_1px_0_rgba(15,23,42,0.02)] focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"}`}
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
        {error && <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" aria-hidden="true" />}
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
      {error && (
        <p id={errorId} className="mt-1 text-xs font-semibold text-(--tanaw-error)" role="alert">
          {error}
        </p>
      )}
      {guidance}
    </div>
  );
}
