import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import toast from "react-hot-toast/headless";
import { devDeliveriesQueryKey } from "@/features/dev-log";
import { emailDeliveriesQueryKey } from "@/features/email-deliveries";
import { enterpriseAccountsQueryKey } from "@/features/enterprise-accounts/services";
import { resendAccountActivation, updateAccountStatus } from "@/shared/services/accountService";
import { enterpriseHealthQueryKey } from "@/shared/services/enterpriseHealth";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { retryAfterSeconds, sendPasswordReset } from "../services/itEnterpriseService";

/** A two-line toast: a bold title and one plain sentence. */
export function notifySuccess(title: string, text: string) {
  toast.success(
    <>
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] font-normal">{text}</span>
    </>,
  );
}

export function notifyError(title: string, text: string) {
  toast.error(
    <>
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-[0.8125rem] font-normal">{text}</span>
    </>,
  );
}

/** Refreshes the enterprise lists and health; with `emails`, the email logs too. */
export function refreshEnterprises(queryClient: QueryClient, options: { emails?: boolean } = {}) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: enterpriseAccountsQueryKey }),
    queryClient.invalidateQueries({ queryKey: enterpriseHealthQueryKey }),
    ...(options.emails ? [queryClient.invalidateQueries({ queryKey: devDeliveriesQueryKey }), queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey })] : []),
  ]);
}

/** Send again / Send a new link: a fresh invitation replaces the old link. */
export function useResendInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => resendAccountActivation(accountId),
    onSuccess: async (account) => {
      await refreshEnterprises(queryClient, { emails: true });
      notifySuccess("Invitation sent", `A new sign-in link went to ${account.email}.`);
    },
    onError: (error) => notifyError("Invitation not sent", getApiErrorMessage(error, "The invitation could not be sent. Try again.")),
  });
}

/** Deactivate or activate an enterprise account. */
export function useAccountStatus(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, status }: { accountId: string; status: "active" | "inactive" }) => updateAccountStatus(accountId, status),
    onSuccess: async (account, { status }) => {
      const invitationSent = status === "active" && !account.isActivated;
      await refreshEnterprises(queryClient, { emails: invitationSent });
      onDone?.();
      if (status === "inactive") notifySuccess("Enterprise deactivated", "The desktop app was signed out and stops sending counts.");
      else if (invitationSent) notifySuccess("Enterprise activated", `A new sign-in invitation went to ${account.email}.`);
      else notifySuccess("Enterprise activated", "The desktop app can sign in again.");
    },
    onError: (error) => notifyError("Access not changed", getApiErrorMessage(error, "The enterprise's access could not be changed. Try again.")),
  });
}

/**
 * Send a password reset email. The server allows one a minute per account; a 429 says how long to
 * wait, and the button counts down until then.
 */
export function usePasswordReset(accountId: string) {
  const queryClient = useQueryClient();
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const secondsLeft = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));

  useEffect(() => {
    if (waitUntil === null) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= waitUntil) setWaitUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  const wait = (seconds: number) => {
    const current = Date.now();
    setNow(current);
    setWaitUntil(current + seconds * 1000);
  };

  const mutation = useMutation({
    mutationFn: () => sendPasswordReset(accountId),
    onSuccess: async (result) => {
      setMessage(`Sent to ${result.sentTo}. The owner chooses Forgot password on the sign-in page and enters the code.`);
      wait(60);
      await queryClient.invalidateQueries({ queryKey: emailDeliveriesQueryKey });
      notifySuccess("Password reset email sent", `It went to ${result.sentTo}.`);
    },
    onError: (error) => {
      const seconds = retryAfterSeconds(error);
      if (seconds !== null) {
        wait(seconds);
        setMessage(getApiErrorMessage(error, "A password reset email was sent moments ago. Wait before sending another."));
        return;
      }
      setMessage(null);
      notifyError("Email not sent", getApiErrorMessage(error, "The password reset email could not be sent. Try again."));
    },
  });

  return { send: () => mutation.mutate(), isPending: mutation.isPending, secondsLeft, message };
}
