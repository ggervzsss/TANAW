import type { components, paths } from "./generated/api";

export type ApiSchemas = components["schemas"];
export type ApiOperations = paths;

export const apiPaths = {
  authLogin: "/auth/login",
  authLogout: "/auth/logout",
  authSession: "/auth/session",
  desktopReportSubmissions: "/operational/desktop/report-submissions",
  desktopSamplePreparation: "/operational/desktop/sample-preparation",
  desktopTelemetry: "/operational/desktop/telemetry",
  finalReports: "/operational/reports/final",
  supportTickets: "/operational/tickets",
} as const satisfies Record<string, keyof ApiOperations>;

export type ApiAuthUser = ApiSchemas["AuthUser"];
export type ApiLoginResponse = ApiSchemas["LoginResponse"];
export type ApiDesktopReportSubmission = ApiSchemas["DesktopReportSubmissionIngest"];
export type ApiDesktopTelemetry = ApiSchemas["DesktopTelemetryIngest"];
export type ApiFinalReport = ApiSchemas["FinalReportSummary"];
export type ApiSupportTicket = ApiSchemas["SupportTicketSummary"];
export type ApiSupportTicketCreate = ApiSchemas["SupportTicketCreate"];
export type ApiSupportTicketDetail = ApiSchemas["SupportTicketDetail"];
