import type { components, paths } from "./generated/api";

export type ApiSchemas = components["schemas"];
export type ApiOperations = paths;

export const apiPaths = {
  authLogin: "/auth/login",
  authLogout: "/auth/logout",
  authSession: "/auth/session",
  finalReports: "/operational/reports/final",
  intakeReports: "/operational/reports/intake",
  notifications: "/operational/notifications",
  supportTickets: "/operational/tickets",
  telemetrySummary: "/operational/telemetry/summary",
} as const satisfies Record<string, keyof ApiOperations>;

export type ApiAuthUser = ApiSchemas["AuthUser"];
export type ApiLoginResponse = ApiSchemas["LoginResponse"];
export type ApiFinalReport = ApiSchemas["FinalReportSummary"];
export type ApiIntakeReport = ApiSchemas["IntakeReportSummary"];
export type ApiNotification = ApiSchemas["UserNotificationSummary"];
export type ApiSupportTicket = ApiSchemas["SupportTicketSummary"];
export type ApiSupportTicketDetail = ApiSchemas["SupportTicketDetail"];
export type ApiTelemetrySnapshot = ApiSchemas["TelemetrySnapshotSummary"];
