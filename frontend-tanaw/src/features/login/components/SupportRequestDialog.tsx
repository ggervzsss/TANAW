import type { FormEvent } from "react";
import { useState } from "react";
import { Headphones } from "lucide-react";
import { apiClient } from "@/shared/lib/apiClient";
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
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clearError();
              }}
              className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
              placeholder="Your name"
            />
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearError();
              }}
              className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm transition outline-none focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]"
              placeholder="Your email"
            />
            <textarea
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                clearError();
              }}
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
    </AuthDialogShell>
  );
}
