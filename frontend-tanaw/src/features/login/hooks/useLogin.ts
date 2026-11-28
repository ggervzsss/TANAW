import { isAxiosError } from "axios";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/app/routers/roleRoutes";
import { isTwoFactorLoginChallenge, loginService, verifyTwoFactorLogin, type LoginServiceResponse } from "../services";

type PendingTwoFactor = { challengeToken: string; rememberMe: boolean };
type ApiErrorDetail = { code?: string; message?: string; retryAfterSeconds?: number };

export type TwoFactorAnswer = { code: string } | { recoveryCode: string };

const CHALLENGE_EXPIRED = "two_factor_challenge_expired";

function errorDetail(error: unknown): ApiErrorDetail | undefined {
  if (!isAxiosError(error)) return undefined;
  const detail: unknown = error.response?.data?.detail;
  return detail && typeof detail === "object" ? (detail as ApiErrorDetail) : undefined;
}

export function useLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [loginMessage, setLoginMessage] = useState("");
  const [twoFactor, setTwoFactor] = useState<PendingTwoFactor | null>(null);
  const [twoFactorMessage, setTwoFactorMessage] = useState("");

  useEffect(() => {
    if (lockoutSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setLockoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const completeSignIn = (session: LoginServiceResponse, rememberMe: boolean) => {
    queryClient.clear();
    setSession(session, rememberMe);
    toast.success("Login successful");
    navigate(getRoleDashboardPath(session.user.role), { replace: true });
  };

  const showLockout = (detail: ApiErrorDetail | undefined, show: (message: string) => void) => {
    setLockoutSeconds(detail?.retryAfterSeconds ?? 300);
    show(detail?.message ?? "Account temporarily locked.");
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const clientId = String(formData.get("clientId") ?? "");
    const encryptionKey = String(formData.get("encryptionKey") ?? "");
    const rememberMe = formData.get("rememberMe") === "on";
    setLoginMessage("");

    try {
      const result = await loginService({ clientId, encryptionKey, rememberMe });
      if (isTwoFactorLoginChallenge(result)) {
        setTwoFactorMessage("");
        setTwoFactor({ challengeToken: result.challengeToken, rememberMe });
        return;
      }
      completeSignIn(result, rememberMe);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        showLockout(errorDetail(error), setLoginMessage);
        return;
      }
      setLoginMessage("Invalid email or password");
      return;
    }
  };

  /** Sends the code; resolves false when it was not accepted, so the form can let the person retry. */
  const submitTwoFactor = async (answer: TwoFactorAnswer): Promise<boolean> => {
    if (!twoFactor) return false;
    setTwoFactorMessage("");
    try {
      const session = await verifyTwoFactorLogin({ challengeToken: twoFactor.challengeToken, ...answer });
      completeSignIn(session, twoFactor.rememberMe);
      return true;
    } catch (error) {
      const detail = errorDetail(error);
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429) {
        showLockout(detail, setTwoFactorMessage);
      } else if (status === 401 && detail?.code === CHALLENGE_EXPIRED) {
        setTwoFactor(null);
        setLoginMessage(detail.message ?? "This sign-in has expired. Sign in again.");
      } else if (status === 401 && detail?.message) {
        setTwoFactorMessage(detail.message);
      } else {
        setTwoFactorMessage("Unable to verify the code right now. Check your connection and try again.");
      }
      return false;
    }
  };

  return {
    handleLoginSubmit,
    loginMessage,
    lockoutSeconds,
    clearLoginMessage: () => setLoginMessage(""),
    twoFactorPending: twoFactor !== null,
    twoFactorMessage,
    submitTwoFactor,
    clearTwoFactorMessage: () => setTwoFactorMessage(""),
    cancelTwoFactor: () => {
      setTwoFactor(null);
      setTwoFactorMessage("");
    },
  };
}
