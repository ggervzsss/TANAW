import { isAxiosError } from "axios";

type ValidationErrorDetail = { msg?: string };
type DomainErrorDetail = { code?: string; message?: string };
type ApiErrorPayload = { detail?: string | ValidationErrorDetail[] | DomainErrorDetail };

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError<ApiErrorPayload>(error)) return fallback;

  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.find((item) => item.msg)?.msg ?? fallback;
  }
  if (detail && typeof detail.message === "string") return detail.message;

  return fallback;
}
