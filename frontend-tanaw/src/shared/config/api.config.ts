const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const API_BASE_URL = configuredApiBaseUrl ?? (import.meta.env.PROD ? "https://tanaw.onrender.com" : "http://localhost:8000");

export function getWebSocketUrl(path: string) {
  const url = new URL(path, API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
