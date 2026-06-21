import { isAxiosError } from "axios";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/shared/utils/routeUtils";
import { loginService } from "../services";

export function useLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  useEffect(() => {
    if (lockoutSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setLockoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const clientId = String(formData.get("clientId") ?? "");
    const encryptionKey = String(formData.get("encryptionKey") ?? "");
    const rememberMe = formData.get("rememberMe") === "on";

    try {
      const session = await loginService({ clientId, encryptionKey });
      queryClient.removeQueries({ queryKey: ["current-user"] });
      setSession(session, rememberMe);
      if (session.user.mustChangePassword) {
        toast.success("Temporary credentials verified");
        navigate("/change-password", { replace: true });
        return;
      }
      toast.success("Portal Initialized Successfully");
      navigate(getRoleDashboardPath(session.user.role), { replace: true });
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 429) {
        const detail = error.response.data?.detail as { message?: string; retryAfterSeconds?: number } | undefined;
        setLockoutSeconds(detail?.retryAfterSeconds ?? 300);
        toast.error(detail?.message ?? "Account temporarily locked.");
        return;
      }
      toast.error("Invalid email or password");
      return;
    }
  };

  return {
    handleLoginSubmit,
    lockoutSeconds,
  };
}
