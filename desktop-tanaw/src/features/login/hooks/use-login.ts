import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { routePaths } from "../../../app/router/routePaths";
import { notifySuccess } from "../../toasts/services/toast-service";
import { login } from "../api/login";
import type { LoginFormValues } from "../schemas/login-schema";
import { useAuthStore } from "../stores/auth-store";

const getLandingRoute = () => routePaths.enterpriseDashboard;

type LoginMutationValues = LoginFormValues & {
  rememberMe?: boolean;
};

type UseLoginOptions = {
  onAuthMessage: (message: string) => void;
};

export function useLogin(redirectTo?: string, options?: UseLoginOptions) {
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
    mutationFn: (values: LoginMutationValues) => login({ username: values.username, password: values.password }, values.rememberMe ?? false),
    onSuccess: (session, values) => {
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session, values.rememberMe ?? false);
      notifySuccess("Login successful");
      navigate(redirectTo ?? getLandingRoute(), { replace: true });
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response?.status === 429) {
        const detail = error.response.data?.detail as { message?: string; retryAfterSeconds?: number } | undefined;
        setLockoutSeconds(detail?.retryAfterSeconds ?? 300);
        options?.onAuthMessage(detail?.message ?? "Account temporarily locked.");
        return;
      }
      options?.onAuthMessage("Login failed. Please check your credentials.");
    },
  });

  return { ...mutation, lockoutSeconds };
}
