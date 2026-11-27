import type { ReactNode } from "react";
import { useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { PasswordMatchIndicator, PasswordRequirements } from "@/shared/components/PasswordRequirements";
import { Spinner } from "@/shared/ui-kit";
import { usePasswordRecoveryFlow } from "../hooks/usePasswordRecoveryFlow";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "@/shared/utils/passwordPolicy";
import { AuthDialogShell } from "./AuthDialogShell";

export function PasswordRecoveryDialog({ onClose }: { onClose: () => void }) {
  const flow = usePasswordRecoveryFlow();

  return (
    <AuthDialogShell kind="recovery" onClose={onClose}>
      {flow.step === "success" ? (
        <RecoveryStepFrame title="Password Updated">
          <div className="tanaw-auth-dialog__result">
            <span className="tanaw-auth-state__mark tanaw-auth-state__mark--success">
              <Check className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-[0.9375rem] font-semibold text-(--tanaw-text)">Password updated.</p>
            <p className="mt-1 text-sm leading-6 text-(--tanaw-text-secondary)">You can now sign in with your new password.</p>
          </div>
          <button type="button" onClick={onClose} className="tanaw-auth-button tanaw-auth-sheen mt-6 w-full">
            Return to login
          </button>
        </RecoveryStepFrame>
      ) : null}

      {flow.step === "code" ? (
        <RecoveryStepFrame title="Verification Code">
          <form onSubmit={flow.verifyCode}>
            <p className="tanaw-auth-dialog__lead">
              If an account matches this email, enter the 6-digit verification code sent to its registered inbox. Any issued code expires in {flow.expiresIn} minutes and can be used once.
            </p>
            {flow.notice ? (
              <div className="tanaw-auth-note tanaw-auth-note--warning mb-5" role="status" aria-live="polite">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{flow.notice}</span>
              </div>
            ) : null}
            <label htmlFor="recovery-code" className="tanaw-auth-label">
              Verification code
            </label>
            <input
              id="recovery-code"
              type="text"
              inputMode="numeric"
              value={flow.code}
              onChange={(event) => flow.updateCode(event.target.value)}
              className="tanaw-auth-control tracking-[0.3em] tabular-nums"
              data-invalid={flow.error ? "true" : undefined}
              placeholder="000000"
              aria-invalid={Boolean(flow.error)}
              aria-describedby={flow.error ? "recovery-error" : undefined}
            />
            <RecoveryError message={flow.error} />
            <RecoverySubmitButton busy={flow.isSubmitting} busyLabel="Verifying...">
              Verify code
            </RecoverySubmitButton>
          </form>
        </RecoveryStepFrame>
      ) : null}

      {flow.step === "password" ? (
        <RecoveryStepFrame title="Set New Password">
          <form onSubmit={flow.resetPassword}>
            <p className="tanaw-auth-dialog__lead">Create a new private password for {flow.email}.</p>
            <div className="space-y-4">
              <div>
                <RecoveryPasswordInput id="recovery-new-password" label="New password" value={flow.password} onChange={flow.updatePassword} placeholder="Enter new password" error={flow.error} />
                <PasswordRequirements password={flow.password} />
              </div>
              <div>
                <RecoveryPasswordInput
                  id="recovery-confirm-password"
                  label="Confirm password"
                  value={flow.confirmation}
                  onChange={flow.updateConfirmation}
                  placeholder="Confirm new password"
                  error={flow.error}
                />
                <PasswordMatchIndicator password={flow.password} confirmation={flow.confirmation} />
              </div>
            </div>
            <RecoveryError message={flow.error} />
            <RecoverySubmitButton busy={flow.isSubmitting} busyLabel="Updating...">
              Reset password
            </RecoverySubmitButton>
          </form>
        </RecoveryStepFrame>
      ) : null}

      {flow.step === "email" ? (
        <RecoveryStepFrame title="Account Recovery">
          <form onSubmit={flow.requestCode}>
            <p className="tanaw-auth-dialog__lead">Enter your registered email. If an account matches, a verification code will be sent there for secure recovery.</p>
            <label htmlFor="recovery-target" className="tanaw-auth-label">
              Registered email
            </label>
            <input
              id="recovery-target"
              type="email"
              value={flow.email}
              onChange={(event) => flow.updateEmail(event.target.value)}
              className="tanaw-auth-control"
              data-invalid={flow.error ? "true" : undefined}
              placeholder="Enter registered email"
              aria-invalid={Boolean(flow.error)}
              aria-describedby={flow.error ? "recovery-error" : undefined}
            />
            <RecoveryError message={flow.error} />
            <RecoverySubmitButton busy={flow.isSubmitting} busyLabel="Preparing...">
              Continue
            </RecoverySubmitButton>
          </form>
        </RecoveryStepFrame>
      ) : null}
    </AuthDialogShell>
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
      <label htmlFor={id} className="tanaw-auth-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPasswordVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="tanaw-auth-control pr-12"
          data-invalid={error ? "true" : undefined}
          placeholder={placeholder}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "recovery-error" : undefined}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsPasswordVisible((current) => !current)}
          className="tanaw-auth-field-action absolute top-1/2 right-3 -translate-y-1/2"
          aria-label={isPasswordVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {isPasswordVisible ? <EyeOff className="h-5 w-5" strokeWidth={1.9} /> : <Eye className="h-5 w-5" strokeWidth={1.9} />}
        </button>
      </div>
    </div>
  );
}

function RecoveryStepFrame({ title, children }: { title: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
      <p className="tanaw-auth-dialog__step">{title}</p>
      {children}
    </motion.div>
  );
}

function RecoveryError({ message }: { message: string }) {
  return (
    <div id="recovery-error" className="tanaw-auth-field-message mt-2" aria-live="polite">
      {message ? (
        <p className="tanaw-auth-field-error flex items-start gap-1.5 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

function RecoverySubmitButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} aria-busy={busy || undefined} className="tanaw-auth-button tanaw-auth-sheen mt-4 w-full">
      {busy ? <Spinner size={16} label="" /> : null}
      {busy ? busyLabel : children}
    </button>
  );
}
