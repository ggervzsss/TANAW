import { useEffect } from "react";
import { isAxiosError } from "axios";
import { restoreSession } from "../api/login";
import type { LoginResponse } from "../types";
import { isRememberEnabled, useAuthStore } from "../stores/auth-store";

export function AuthSessionManager() {
  const setSession = useAuthStore((state) => state.setSession);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      let savedSession: LoginResponse | null = null;
      try {
        const stored = await window.tanawAuthSession?.load();
        savedSession = readStoredSession(stored);
        const session = await restoreSession(savedSession?.token);
        if (!disposed) setSession(session);
      } catch (error) {
        if (savedSession && isRememberEnabled() && isBackendUnavailable(error)) {
          if (!disposed) setSession(savedSession);
          return;
        }
        await window.tanawAuthSession?.clear();
        if (!disposed) markAnonymous();
      }
    })();
    return () => {
      disposed = true;
    };
  }, [markAnonymous, setSession]);

  return null;
}

function readStoredSession(value: unknown): LoginResponse | null {
  if (!value || typeof value !== "object" || !("token" in value) || !("user" in value)) return null;
  const session = value as { token?: unknown; user?: unknown };
  if (typeof session.token !== "string" || !session.token || !session.user || typeof session.user !== "object") return null;
  return session as LoginResponse;
}

function isBackendUnavailable(error: unknown) {
  return isAxiosError(error) && (!error.response || error.response.status >= 500);
}
