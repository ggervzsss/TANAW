import { useEffect } from "react";
import { restoreSession } from "../api/login";
import { useAuthStore } from "../stores/auth-store";

export function AuthSessionManager() {
  const setSession = useAuthStore((state) => state.setSession);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const stored = await window.tanawAuthSession?.load();
        const token = readStoredToken(stored);
        const session = await restoreSession(token ?? undefined);
        if (!disposed) setSession(session);
      } catch {
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

function readStoredToken(value: unknown) {
  if (!value || typeof value !== "object" || !("token" in value)) return null;
  const token = (value as { token?: unknown }).token;
  return typeof token === "string" && token ? token : null;
}
