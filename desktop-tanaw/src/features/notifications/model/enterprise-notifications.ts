import type { BackendNotification } from "../services/notifications";
import type { EnterpriseNotification, EnterpriseView, ReportRecord } from "../../../types/enterprise";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../../utils/date-time";

export function buildEnterpriseNotifications(reportsHistory: ReportRecord[], readNotificationIds: Set<number>, backendNotifications: BackendNotification[], timeFormat: SystemTimeFormat) {
  const persistedNotifications = backendNotifications.map((notification) => backendNotificationToEnterpriseNotification(notification, readNotificationIds, timeFormat));
  return [...persistedNotifications, ...reportsHistory.flatMap((report) => buildReportNotifications(report, timeFormat))]
    .sort((left, right) => getNotificationSortValue(right) - getNotificationSortValue(left))
    .map((notification) => ({
      ...notification,
      read: notification.read || readNotificationIds.has(notification.id),
    }));
}

function backendNotificationToEnterpriseNotification(notification: BackendNotification, readNotificationIds: Set<number>, timeFormat: SystemTimeFormat): EnterpriseNotification {
  const id = stableNotificationId(`backend-notification:${notification.id}`);
  return {
    id,
    backendId: notification.id,
    type: notificationTypeFromSeverity(notification.severity),
    message: `${notification.title}: ${notification.message}`,
    time: formatNotificationDate(notification.createdAt, timeFormat),
    sortTime: toTimestamp(notification.createdAt),
    read: Boolean(notification.readAt) || readNotificationIds.has(id),
    target: notificationTarget(notification),
  };
}

function buildReportNotifications(report: ReportRecord, timeFormat: SystemTimeFormat): EnterpriseNotification[] {
  const notifications: EnterpriseNotification[] = [];
  const deadline = getReportDeadline(report);
  const isSubmitted = ["Submitted", "Resubmitted", "Consolidated"].includes(report.status);

  if (deadline && !isSubmitted) {
    const deadlineDate = Date.parse(deadline);
    if (Number.isFinite(deadlineDate)) {
      const daysUntilDeadline = Math.ceil((deadlineDate - Date.now()) / 86_400_000);
      if (daysUntilDeadline < 0) {
        notifications.push(createReportNotification(report, "critical", `${report.id} is overdue for ${formatNotificationDate(deadline, timeFormat)}.`, timeFormat, deadline));
      } else if (daysUntilDeadline <= 3) {
        notifications.push(
          createReportNotification(
            report,
            "warning",
            `${report.id} is due ${daysUntilDeadline === 0 ? "today" : `in ${daysUntilDeadline} day${daysUntilDeadline === 1 ? "" : "s"}`}.`,
            timeFormat,
            deadline,
          ),
        );
      }
    }
  }

  if (report.status === "Returned for Revision") {
    notifications.push(
      createReportNotification(report, "warning", `${report.id} was returned for revision. ${report.remarks ?? "Please review the report remarks."}`, timeFormat, getLatestAuditTime(report)),
    );
  }

  if (report.status === "Draft") {
    notifications.push(createReportNotification(report, "warning", `${report.id} is still a draft for ${report.period ?? report.date}.`, timeFormat, getLatestAuditTime(report)));
  }

  if (report.status === "Submitted" || report.status === "Resubmitted") {
    notifications.push(createReportNotification(report, "success", `${report.id} was ${report.status.toLowerCase()} for ${report.period ?? report.date}.`, timeFormat, getLatestAuditTime(report)));
  }

  return notifications;
}

function createReportNotification(report: ReportRecord, type: EnterpriseNotification["type"], message: string, timeFormat: SystemTimeFormat, timeSource?: string): EnterpriseNotification {
  const source = `report:${report.id}:${report.status}:${timeSource ?? report.date}`;
  return {
    id: stableNotificationId(source),
    type,
    message,
    time: formatNotificationDate(timeSource ?? report.date, timeFormat),
    sortTime: toTimestamp(timeSource ?? report.date),
    read: false,
    target: "reports",
  };
}

function notificationTypeFromSeverity(severity: BackendNotification["severity"]) {
  if (severity === "Critical") return "critical";
  if (severity === "Warning") return "warning";
  if (severity === "Success") return "success";
  return "info";
}

function notificationTarget(notification: BackendNotification): EnterpriseView {
  const text = `${notification.type} ${notification.sourceType ?? ""} ${notification.title}`.toLowerCase();
  if (text.includes("profile")) {
    return "profile";
  }
  if (text.includes("password") || text.includes("security")) {
    return "security";
  }
  if (text.includes("camera") || text.includes("gateway") || text.includes("sync") || text.includes("threshold")) {
    return "cameras";
  }
  if (text.includes("support") || text.includes("ticket")) {
    return "tickets";
  }
  return "reports";
}

function getReportDeadline(report: ReportRecord) {
  return report.submissionDeadline ?? report.deadline ?? report.dueDate ?? null;
}

function getLatestAuditTime(report: ReportRecord) {
  const auditTrail = report.auditTrail ?? [];
  return auditTrail.length > 0 ? auditTrail[auditTrail.length - 1].time : report.date;
}

function getNotificationSortValue(notification: EnterpriseNotification) {
  return notification.sortTime ?? notification.id;
}

function formatNotificationDate(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
}

function toTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function stableNotificationId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function upsertBackendNotification(notifications: BackendNotification[], nextNotification: BackendNotification) {
  if (notifications.some((notification) => notification.id === nextNotification.id)) {
    return notifications.map((notification) => (notification.id === nextNotification.id ? nextNotification : notification));
  }
  return [nextNotification, ...notifications].slice(0, 100);
}

export function readStoredNotificationIds(key: string) {
  if (typeof window === "undefined") return new Set<number>();

  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : []);
  } catch {
    return new Set<number>();
  }
}

export function writeStoredNotificationIds(key: string, ids: Set<number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-500)));
}
