import { type ChangeEvent, type FormEvent, type ReactNode, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { Skeleton } from "@/shared/ui-kit";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "@/shared/utils/passwordPolicy";
import { formatActivationExpiration, formatActivationRole, type ActivationPasswordErrors, type ActivationPasswordValues, type ActivationView } from "../model";
import type { AccountActivationDetails } from "../services";
import { AuthActionTrail } from "./AuthActionTrail";
import { AuthBrandHeader } from "./AuthStageLayout";

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
      <AuthBrandHeader subtitle="Account Activation" />
      {props.view === "validating" && <ValidatingState />}
      {props.view === "invalid" && <InvalidState message={props.pageMessage} />}
      {props.view === "ready" && props.details && <ActivationForm {...props} details={props.details} />}
      {props.view === "success" && props.details && <SuccessState details={props.details} />}
    </>
  );
}

function ValidatingState() {
  return (
    <div className="tanaw-auth-state" aria-live="polite" aria-busy="true">
      <h2 className="tanaw-auth-state__title">Checking your activation link</h2>
      <p className="tanaw-auth-state__copy">Please wait while TANAW verifies that this link is valid and unused.</p>
      {/* The password form's shape: two labelled 52px fields, 16px apart, then the 48px action. */}
      <div className="mt-6 grid gap-4" aria-hidden="true">
        {[0, 1].map((field) => (
          <span key={field} className="block">
            <span className="mb-2 flex h-[1.225rem] items-center">
              <Skeleton className="h-4 w-2/5" />
            </span>
            <Skeleton className="h-13 w-full" />
          </span>
        ))}
        <Skeleton className="mt-2 h-12 w-full" />
      </div>
    </div>
  );
}

function InvalidState({ message }: { message: string }) {
  return (
    <div className="tanaw-auth-state" role="alert">
      <span className="tanaw-auth-state__mark tanaw-auth-state__mark--danger">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="tanaw-auth-state__title">Activation link unavailable</h2>
      <p className="tanaw-auth-state__copy">{message}</p>
      <p className="tanaw-auth-state__copy">Ask TANAW IT personnel to resend the activation email from Accounts Management.</p>
      <Link to={routes.login} className="tanaw-auth-button tanaw-auth-sheen mt-6">
        Return to sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function ActivationForm({ details, errors, isSubmitting, pageMessage, values, onChange, onSubmit }: AccountActivationCardProps & { details: AccountActivationDetails }) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="tanaw-activation-banner">
        <span className="tanaw-activation-banner__icon">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="tanaw-activation-banner__label">Verified activation link</p>
          <h2 className="tanaw-activation-banner__title">Welcome, {details.displayName}</h2>
          <p className="tanaw-activation-banner__copy">Create the password you will use for your {formatActivationRole(details.role)} account.</p>
          <p className="tanaw-activation-banner__meta">Link expires {formatActivationExpiration(details.expiresAt)}.</p>
        </div>
      </div>
      <div className="tanaw-activation-password-fields grid gap-4">
        <PasswordField label="New Password" name="newPassword" value={values.newPassword} error={errors.newPassword} onChange={onChange("newPassword")} guidanceId="activation-password-tip" />
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
      <PasswordRequirements password={values.newPassword} className="mt-3" showTip={false} />
      <p id="activation-password-tip" className="mt-2 mb-6 text-[0.8125rem] leading-5 text-(--tanaw-text-muted)">
        <strong className="font-semibold text-(--tanaw-text-secondary)">Tip:</strong> Spaces and Unicode characters are allowed. Password managers are supported. Special characters are optional.
      </p>
      {pageMessage && (
        <div className="tanaw-auth-alert mb-4" role="alert" aria-live="assertive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
          <span>{pageMessage}</span>
        </div>
      )}
      <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting || undefined} className="tanaw-auth-button tanaw-auth-sheen tanaw-auth-primary-action w-full">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        {isSubmitting ? "Activating..." : "Activate Account"}
        <AuthActionTrail busy={isSubmitting} />
      </button>
    </form>
  );
}

function SuccessState({ details }: { details: AccountActivationDetails }) {
  const isEnterprise = details.role === "enterprise";
  return (
    <div className="tanaw-auth-state" aria-live="polite">
      <span className="tanaw-auth-state__mark tanaw-auth-state__mark--success">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="tanaw-auth-state__title">Account activated</h2>
      <p className="tanaw-auth-state__copy">
        {isEnterprise
          ? "Your password is ready. Return to the TANAW Enterprise desktop application and sign in with your Enterprise ID or registered email."
          : "Your password is ready. You can now sign in to the TANAW portal using your registered email and new password."}
      </p>
      {isEnterprise ? (
        <p className="tanaw-auth-note tanaw-auth-note--success tanaw-auth-note--ruled mt-6 font-semibold">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>You may safely close this browser tab.</span>
        </p>
      ) : (
        <Link to={routes.login} className="tanaw-auth-button tanaw-auth-sheen mt-6">
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
      <label htmlFor={name} className="tanaw-auth-label">
        {label}
      </label>
      <div className="tanaw-auth-field" data-state={error ? "invalid" : value ? "valid" : "empty"}>
        <LockKeyhole className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
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
          className="tanaw-auth-input h-full w-full rounded-tanaw-md bg-transparent pr-22 pl-12 text-[0.9375rem] outline-none"
        />
        {error && <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" />}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsVisible((current) => !current)}
          className="tanaw-auth-field-action absolute right-3"
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {isVisible ? <EyeOff className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" /> : <Eye className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="tanaw-auth-field-error" role="alert">
          {error}
        </p>
      )}
      {guidance}
    </div>
  );
}
