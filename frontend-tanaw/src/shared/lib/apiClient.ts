import axios from "axios";
import { API_BASE_URL } from "@/shared/config/api.config";

type ApiClientAuthentication = {
  getAccountId: () => string | undefined;
  getAccessToken: () => string | null;
  onAuthenticationFailure: () => void;
};

const anonymousAuthentication: ApiClientAuthentication = {
  getAccountId: () => undefined,
  getAccessToken: () => null,
  onAuthenticationFailure: () => undefined,
};
let authentication = anonymousAuthentication;

export function getApiAccountId() {
  return authentication.getAccountId();
}

export function configureApiClientAuthentication(next: ApiClientAuthentication) {
  authentication = next;
  return () => {
    if (authentication === next) authentication = anonymousAuthentication;
  };
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = authentication.getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      authentication.onAuthenticationFailure();
    }

    return Promise.reject(error);
  },
);
