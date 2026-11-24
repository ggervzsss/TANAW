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
  requests: "/operational/requests",
  alerts: "/operational/alerts",
  telemetrySummary: "/operational/telemetry/summary",
  visitorRanking: "/operational/visitor-insights/ranking",
} as const satisfies Record<string, keyof ApiOperations>;

export type ApiAuthUser = ApiSchemas["AuthUser"];
export type ApiLoginResponse = ApiSchemas["LoginResponse"];
export type ApiFinalReport = ApiSchemas["FinalReportSummary"];
export type ApiIntakeReport = ApiSchemas["IntakeReportSummary"];
export type ApiNotification = ApiSchemas["UserNotificationSummary"];
export type ApiRequest = ApiSchemas["RequestSummary"];
export type ApiRequestDetail = ApiSchemas["RequestDetail"];
export type ApiTelemetrySnapshot = ApiSchemas["TelemetrySnapshotSummary"];
export type ApiVisitorRanking = ApiSchemas["VisitorRankingSummary"];
