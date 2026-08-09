import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { queryClient } from "@/shared/lib/queryClient";
import { restoreSession } from "@/shared/services/sessionService";
import { subscribeToSessionEvents } from "@/shared/utils/sessionSync";

export function AuthSessionManager() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const markAnonymous = useAuthStore((state) => state.markAnonymous);
  const logout = useAuthStore((state) => state.logout);

  const applyRemoteLogout = useCallback(() => {
    logout();
    queryClient.clear();
    navigate(routes.login, { replace: true });
  }, [logout, navigate]);

  useEffect(() => {
    let disposed = false;
    void restoreSession()
      .then((session) => {
        if (!disposed) setSession(session);
      })
      .catch(() => {
        if (!disposed) markAnonymous();
      });
    return () => {
      disposed = true;
    };
  }, [markAnonymous, setSession]);

  useEffect(() => subscribeToSessionEvents(applyRemoteLogout), [applyRemoteLogout]);

  return null;
}
