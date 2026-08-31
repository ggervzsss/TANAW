import axios from "axios";
import { useAuthStore } from "@/app/store/authStore";
import { API_BASE_URL } from "@/shared/config/api.config";
import { publishSessionEvent } from "@/shared/utils/sessionSync";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const authState = useAuthStore.getState();
      const wasAuthenticated = authState.status === "authenticated";
      authState.logout();
      if (wasAuthenticated) {
        publishSessionEvent({ type: "logout", occurredAt: Date.now() });
      }
    }

    return Promise.reject(error);
  },
);
