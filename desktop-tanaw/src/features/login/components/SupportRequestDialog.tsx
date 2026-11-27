import type { FormEvent } from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Headphones } from "lucide-react";
import { staffApi } from "../../../lib/axios";
import { Spinner } from "../../../ui-kit";
import { getApiErrorMessage, validateRecoveryEmail } from "../utils/auth-dialog";
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
      await staffApi.post("/auth/support-request", { name, email, message });
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
            <p className="tanaw-auth-dialog__intro-title">Tell IT what is stopping you from signing in. IT gets a Sign-in help request and replies by email.</p>
            <p className="tanaw-auth-dialog__intro-copy">IT and Admin personnel will receive the request and use your registered email to follow up.</p>
          </div>
        </div>

        {submitted ? (
          <div className="tanaw-auth-note tanaw-auth-note--success mt-5 font-semibold">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Request sent. IT will reply to your email.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clearError();
              }}
              className="tanaw-auth-control"
              placeholder="Your name"
            />
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearError();
              }}
              className="tanaw-auth-control"
              placeholder="Your email"
            />
            <textarea
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                clearError();
              }}
              className="tanaw-auth-control tanaw-auth-control--textarea"
              placeholder="Describe the sign-in issue"
            />
            {error ? (
              <p className="tanaw-auth-field-error flex items-start gap-1.5 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </p>
            ) : null}
            <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting || undefined} className="tanaw-auth-button tanaw-auth-sheen mt-1 w-full">
              {isSubmitting ? <Spinner size={16} label="" /> : null}
              {isSubmitting ? "Sending..." : "Send request"}
            </button>
          </form>
        )}
      </div>
    </AuthDialogShell>
  );
}
