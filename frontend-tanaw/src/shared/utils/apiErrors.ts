import { isAxiosError } from "axios";

type ValidationErrorDetail = { msg?: string };
type ApiErrorPayload = { detail?: string | ValidationErrorDetail[] };

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError<ApiErrorPayload>(error)) return fallback;

  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.find((item) => item.msg)?.msg ?? fallback;
  }

  return fallback;
}
