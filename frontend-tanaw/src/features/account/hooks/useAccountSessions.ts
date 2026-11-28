import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { describeUserAgent, signedInLabel } from "../model";
import { currentSessionQueryKey, getCurrentSession, signOutOtherSessions } from "../services";

const PHONE_PATTERN = /\b(?:iPhone|Android.+Mobile|Mobile Safari)\b/;

/** This device's session and the action that signs every other device out. */
export function useAccountSessions() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const accountId = useAuthStore((state) => state.user?.id);
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const session = useQuery({
    queryKey: [...currentSessionQueryKey, accountId],
    queryFn: getCurrentSession,
    enabled: Boolean(accountId),
    staleTime: 60_000,
  });
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;

  const signOutOthers = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      setSession(await signOutOtherSessions());
      await queryClient.invalidateQueries({ queryKey: currentSessionQueryKey });
      setConfirmingSignOut(false);
      toast.success("Signed out of every other device.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to sign out other devices. Try again."));
    } finally {
      setIsSigningOut(false);
    }
  };

  return {
    deviceLabel: describeUserAgent(userAgent),
    isPhone: PHONE_PATTERN.test(userAgent),
    signedInText: session.isPending && session.fetchStatus !== "idle" ? null : signedInLabel(session.data?.signedInAt, dateFormat, timeFormat),
    confirmingSignOut,
    isSigningOut,
    askToSignOutOthers: () => setConfirmingSignOut(true),
    cancelSignOutOthers: () => {
      if (!isSigningOut) setConfirmingSignOut(false);
    },
    signOutOthers,
  };
}
