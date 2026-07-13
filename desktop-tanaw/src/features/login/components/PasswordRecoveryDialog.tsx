import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";
import { PasswordMatchIndicator, PasswordRequirements } from "../../../components/PasswordRequirements";
import { PASSWORD_INPUT_MAX_CODE_UNITS, PASSWORD_MIN_LENGTH } from "../../../utils/password-policy";
import { cn } from "../../../utils/cn";
import { usePasswordRecoveryFlow } from "../hooks/use-password-recovery-flow";
import { AuthDialogShell } from "./AuthDialogShell";

export function PasswordRecoveryDialog({ onClose }: { onClose: () => void }) {
  const flow = usePasswordRecoveryFlow();

  return (
    <AuthDialogShell kind="recovery" onClose={onClose}>
      {flow.step === "success" ? (
        <RecoveryStepFrame title="Password Updated">
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
      ) : null}

      {flow.step === "code" ? (
        <RecoveryStepFrame title="Verification Code">
          <form onSubmit={flow.verifyCode}>
            <p className={flow.notice ? "mb-3 text-sm leading-6 text-(--tanaw-muted)" : "mb-5 text-sm leading-6 text-(--tanaw-muted)"}>
              If an account matches this email, enter the 6-digit verification code sent to its registered inbox. Any issued code expires in {flow.expiresIn} minutes and can be used once.
            </p>
            {flow.notice ? (
              <div className="mb-5 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950" role="status" aria-live="polite">
                {flow.notice}
              </div>
            ) : null}
            <label htmlFor="desktop-recovery-code" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
              Verification code
            </label>
            <input
              id="desktop-recovery-code"
              type="text"
              inputMode="numeric"
              value={flow.code}
              onChange={(event) => flow.updateCode(event.target.value)}
              className={cn(
                "h-12 w-full rounded-[22px] border bg-white px-4 text-sm tracking-[0.3em] transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                flow.error ? "border-(--tanaw-error)" : "border-(--tanaw-border)",
              )}
              placeholder="000000"
              aria-invalid={Boolean(flow.error)}
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
            <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Create a new private password for {flow.email}.</p>
            <div className="space-y-4">
              <div>
                <RecoveryPasswordInput
                  id="desktop-recovery-new-password"
                  label="New password"
                  value={flow.password}
                  onChange={flow.updatePassword}
                  placeholder="Enter new password"
                  error={flow.error}
                />
                <PasswordRequirements password={flow.password} />
              </div>
              <div>
                <RecoveryPasswordInput
                  id="desktop-recovery-confirm-password"
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
            <p className="mb-5 text-sm leading-6 text-(--tanaw-muted)">Enter your registered email. If an account matches, a verification code will be sent there for secure recovery.</p>
            <label htmlFor="desktop-recovery-target" className="mb-2 block text-sm font-semibold text-(--tanaw-text)">
              Registered email
            </label>
            <input
              id="desktop-recovery-target"
              type="email"
              value={flow.email}
              onChange={(event) => flow.updateEmail(event.target.value)}
              className={cn(
                "h-12 w-full rounded-[22px] border bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                flow.error ? "border-(--tanaw-error)" : "border-(--tanaw-border)",
              )}
              placeholder="Enter registered email"
              aria-invalid={Boolean(flow.error)}
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
          maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
          required
          aria-invalid={Boolean(error)}
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
    <div className="mt-2 min-h-5" aria-live="polite">
      {message ? <p className="text-sm font-medium text-(--tanaw-error)">{message}</p> : null}
    </div>
  );
}

function RecoverySubmitButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-4 w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) disabled:cursor-not-allowed disabled:opacity-70"
    >
      {busy ? busyLabel : children}
    </button>
  );
}
