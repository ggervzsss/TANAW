import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";

export function formatTicketTime(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getTicketRequestError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail && "message" in detail && typeof detail.message === "string") return detail.message;
    if (Array.isArray(detail) && detail.length > 0 && typeof (detail[0] as { msg?: unknown }).msg === "string") return (detail[0] as { msg: string }).msg;
  }
  return fallback;
}
