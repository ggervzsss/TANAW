import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { routePaths } from "../../../app/router/routePaths";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { login } from "../api/login";
import type { LoginFormValues } from "../schemas/login-schema";
import { useAuthStore } from "../stores/auth-store";
import type { AuthRole } from "../types";

const getLandingRoute = (role: AuthRole) => (role === "enterprise" ? routePaths.enterpriseCameras : routePaths.enterpriseCameras);

export function useLogin(redirectTo?: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    if (lockoutSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setLockoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) => login(values),
    onSuccess: (session) => {
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session);
      if (session.user.mustChangePassword) {
        notifySuccess("Temporary credentials verified.");
        navigate(routePaths.changePassword, { replace: true });
        return;
      }
      notifySuccess("Secure login successful.");
      navigate(redirectTo ?? getLandingRoute(session.user.role), { replace: true });
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response?.status === 429) {
        const detail = error.response.data?.detail as { message?: string; retryAfterSeconds?: number } | undefined;
        setLockoutSeconds(detail?.retryAfterSeconds ?? 300);
        notifyError(detail?.message ?? "Account temporarily locked.");
        return;
      }
      notifyError("Login failed. Please check your credentials.");
    },
  });

  return { ...mutation, lockoutSeconds };
}
