import axios from "axios";
import { useAuthStore } from "../features/login/stores/auth-store";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const staffApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

staffApi.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;

  // A request pinned to the session that started it keeps that session's token.
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/** Whether a failed request was sent with the session that is signed in now. */
function sentWithCurrentSession(error: { config?: { headers?: Record<string, unknown> } }) {
  const sent = error.config?.headers?.Authorization;
  const token = useAuthStore.getState().token;
  return sent === undefined || (token !== null && sent === `Bearer ${token}`);
}

staffApi.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 for an earlier session's request must not sign out the account in use now.
    if (error.response?.status === 401 && sentWithCurrentSession(error)) {
      useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  },
);
