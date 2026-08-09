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
        <div className="rounded-[40px] border border-(--tanaw-border) bg-[#f8faf8] p-5 dark:border-slate-600 dark:bg-[#0f172a]">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[22px] border border-(--tanaw-border) bg-white text-(--tanaw-green) dark:border-emerald-300/25 dark:bg-[#172033] dark:text-emerald-300">
            <Headphones className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-(--tanaw-text) dark:text-slate-100">Send your sign-in concern directly to the TANAW support queue.</p>
          <p className="mt-2 text-sm text-(--tanaw-muted) dark:text-slate-300">IT and Admin personnel will receive the request and use the email you provide to follow up.</p>
        </div>

        {submitted ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-5 rounded-[28px] border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-950 dark:border-emerald-300/30 dark:bg-emerald-500/12 dark:text-emerald-100"
          >
            Support request sent to TANAW support.
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
                className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm text-(--tanaw-text) transition outline-none placeholder:text-(--tanaw-muted) focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-emerald-300"
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
                className="h-11 w-full rounded-[20px] border border-(--tanaw-border) bg-white px-4 text-sm text-(--tanaw-text) transition outline-none placeholder:text-(--tanaw-muted) focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-emerald-300"
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
                className="min-h-24 w-full resize-none rounded-[22px] border border-(--tanaw-border) bg-white px-4 py-3 text-sm text-(--tanaw-text) transition outline-none placeholder:text-(--tanaw-muted) focus:border-(--tanaw-green) focus:shadow-[0_0_0_4px_rgba(6,78,47,0.13)] dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-emerald-300"
                placeholder="Describe the sign-in issue"
              />
            </label>
            {error ? (
              <p
                id="support-request-error"
                role="alert"
                aria-live="assertive"
                className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:border-red-400/30 dark:bg-red-500/12 dark:text-red-100"
              >
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="w-full rounded-3xl bg-(--tanaw-green) px-4 py-3 font-semibold text-white transition hover:bg-(--tanaw-green-dark) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:focus-visible:ring-emerald-300 dark:focus-visible:ring-offset-[#121c31] dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
            >
              {isSubmitting ? "Recording..." : "Record support request"}
            </button>
          </form>
        )}
      </div>
    </AuthDialogShell>
  );
}
