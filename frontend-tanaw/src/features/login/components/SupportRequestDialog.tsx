import type { FormEvent } from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Headphones } from "lucide-react";
import { apiClient } from "@/shared/lib/apiClient";
import { Spinner } from "@/shared/ui-kit";
import { getApiErrorMessage, validateRecoveryEmail } from "../utils/authDialog";
import { AuthDialogShell } from "./AuthDialogShell";

export function SupportRequestDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emailError = validateRecoveryEmail(email);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (emailError) {
      setError(emailError);
      return;
    }
    if (message.trim().length < 10) {
      setError("Please describe the support request in at least 10 characters.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      await apiClient.post("/auth/support-request", { name, email, message });
      setSubmitted(true);
      setName("");
      setEmail("");
      setMessage("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to record support request. Please contact the system administrator."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearError = () => {
    if (error) setError("");
  };

  return (
    <AuthDialogShell kind="support" onClose={onClose}>
      <div>
        <div className="tanaw-auth-dialog__intro">
          <Headphones className="tanaw-auth-dialog__intro-icon" strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0">
            <p className="tanaw-auth-dialog__intro-title">Send your sign-in concern directly to the TANAW support queue.</p>
            <p className="tanaw-auth-dialog__intro-copy">IT and Admin personnel will receive the request and use the email you provide to follow up.</p>
          </div>
        </div>

        {submitted ? (
          <div role="status" aria-live="polite" className="tanaw-auth-note tanaw-auth-note--success mt-5 font-semibold">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Support request sent to TANAW support.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <label className="block">
              <span className="sr-only">Your name</span>
              <input
                type="text"
                value={name}
                required
                autoComplete="name"
                onChange={(event) => {
                  setName(event.target.value);
                  clearError();
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "support-request-error" : undefined}
                className="tanaw-auth-control"
                placeholder="Your name"
              />
            </label>
            <label className="block">
              <span className="sr-only">Your email</span>
              <input
                type="email"
                value={email}
                required
                autoComplete="email"
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearError();
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "support-request-error" : undefined}
                className="tanaw-auth-control"
                placeholder="Your email"
              />
            </label>
            <label className="block">
              <span className="sr-only">Describe the sign-in issue</span>
              <textarea
                value={message}
                required
                minLength={10}
                onChange={(event) => {
                  setMessage(event.target.value);
                  clearError();
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "support-request-error" : undefined}
                className="tanaw-auth-control tanaw-auth-control--textarea"
                placeholder="Describe the sign-in issue"
              />
            </label>
            {error ? (
              <p
                id="support-request-error"
                role="alert"
                aria-live="assertive"
                className="tanaw-auth-field-error flex items-start gap-1.5 text-sm"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </p>
            ) : null}
            <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="tanaw-auth-button tanaw-auth-sheen mt-1 w-full">
              {isSubmitting ? <Spinner size={16} label="" /> : null}
              {isSubmitting ? "Recording..." : "Record support request"}
            </button>
          </form>
        )}
      </div>
    </AuthDialogShell>
  );
}
