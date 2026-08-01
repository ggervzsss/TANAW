import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { formatPhilippineDateTime } from "@/shared/utils/dateTime";

export function authorRoleLabel(role: string) {
  if (role === "it") return "IT Personnel";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  if (role === "enterprise") return "Enterprise";
  if (role === "requester") return "Requester";
  return role;
}

export function formatTicketTime(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
