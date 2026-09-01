import { useAuthStore } from "@/app/store/authStore";
import { configureApiClientAuthentication } from "@/shared/lib/apiClient";
import { publishSessionEvent } from "@/shared/utils/sessionSync";

export function configureWebApiClientAuthentication() {
  return configureApiClientAuthentication({
    getAccessToken: () => useAuthStore.getState().token,
    onAuthenticationFailure: () => {
      const authState = useAuthStore.getState();
      const wasAuthenticated = authState.status === "authenticated";
      authState.logout();
      if (wasAuthenticated) {
        publishSessionEvent({ type: "logout", occurredAt: Date.now() });
      }
    },
  });
}
