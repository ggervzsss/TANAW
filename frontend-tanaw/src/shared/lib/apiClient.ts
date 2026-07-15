import axios from "axios";
import { useAuthStore } from "@/app/store/authStore";
import { API_BASE_URL } from "@/shared/config/api.config";
import { CLIENT_GENERATION_HEADERS } from "@/shared/config/client-generation";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    ...CLIENT_GENERATION_HEADERS,
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
    if (error.response?.status === 401 || error.response?.status === 403) {
      useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  },
);
