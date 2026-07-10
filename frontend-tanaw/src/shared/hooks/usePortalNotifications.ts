import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { routes } from "@/app/routers/routes";
import { useAuthStore, useReportStore, useSystemLogStore } from "@/app/store";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey, useOperationalNotifications } from "@/shared/hooks/useOperationalSync";
import { listFinalReports, listIntakeReports, listReportEnterprises } from "@/shared/services/reporting";
import { updateUserNotificationRead, type BackendNotification, type BackendNotificationSeverity } from "@/shared/services/operationalSync";
import type { FinalReport, IntakeReport, LogSeverity, PriorityAlert, ReportEnterprise, ReportStatus, SystemLog } from "@/shared/types";
import type { UserRole } from "@/shared/types/role.types";
import { useActivityLogs } from "./useActivityLogs";
import { useAlerts } from "./useAlerts";

export type PortalNotificationTone = "critical" | "warning" | "success" | "info";

export type PortalNotification = {
  id: string;
  backendId?: string;
  title: string;
  message: string;
  time: string;
  source: string;
  statusLabel?: string;
  tone: PortalNotificationTone;
  targetPath?: string;
  read: boolean;
  sortTime: number;
};

type DraftNotification = Omit<PortalNotification, "read"> & { read?: boolean };

const MAX_VISIBLE_NOTIFICATIONS = 18;
const READ_STORAGE_LIMIT = 500;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EMPTY_REPORT_ENTERPRISES: ReportEnterprise[] = [];
const EMPTY_BACKEND_NOTIFICATIONS: BackendNotification[] = [];

const viewAllPathByRole: Record<UserRole, string | undefined> = {
  admin: routes.admin.notifications,
  it: routes.it.notifications,
  staff: routes.staff.notifications,
  enterprise: undefined,
};

export function usePortalNotifications(role: UserRole) {
  const authUser = useAuthStore((state) => state.user);
  const shouldLoadAlerts = role === "admin" || role === "it";
  const { alerts, isLoading: alertsLoading } = useAlerts(shouldLoadAlerts);
  const localLogs = useSystemLogStore((state) => state.logs);
  const localReports = useReportStore((state) => state.reports);
  const finalReports = useReportStore((state) => state.finalReports);
  const { logs: activityLogs } = useActivityLogs();
  const reportsQuery = useQuery({
    queryKey: operationalReportsQueryKey,
    queryFn: listIntakeReports,
    enabled: role === "staff",
    refetchInterval: role === "staff" ? 30_000 : false,
  });
  const finalReportsQuery = useQuery({
    queryKey: operationalFinalReportsQueryKey,
    queryFn: listFinalReports,
    enabled: role === "staff",
    refetchInterval: role === "staff" ? 30_000 : false,
  });
  const reportEnterprisesQuery = useQuery({
    queryKey: ["report-enterprises"],
    queryFn: listReportEnterprises,
    enabled: role === "staff",
    refetchInterval: role === "staff" ? 30_000 : false,
  });
  const backendNotificationsQuery = useOperationalNotifications();

  const storageKey = useMemo(() => `tanaw-notifications-read:${role}:${authUser?.id ?? "anonymous"}`, [authUser?.id, role]);
  const [readState, setReadState] = useState(() => ({
    storageKey,
    ids: readStoredNotificationIds(storageKey),
  }));
  const readIds = readState.storageKey === storageKey ? readState.ids : readStoredNotificationIds(storageKey);

  const mergedLogs = useMemo(() => mergeLogs(activityLogs, localLogs), [activityLogs, localLogs]);
  const reportEnterprises = reportEnterprisesQuery.data ?? EMPTY_REPORT_ENTERPRISES;
  const reports = reportsQuery.data ?? localReports;
  const effectiveFinalReports = finalReportsQuery.data ?? finalReports;
  const backendNotifications = backendNotificationsQuery.data ?? EMPTY_BACKEND_NOTIFICATIONS;

  const drafts = useMemo(() => {
    const persistedNotifications = buildBackendNotifications(backendNotifications, role);
    const backendReportSourceIds = getBackendReportNotificationSourceIds(backendNotifications);

    if (role === "admin") {
      return [...persistedNotifications, ...buildAlertNotifications(alerts, "admin"), ...buildLogNotifications(mergedLogs, "admin")];
    }

    if (role === "it") {
      return [...persistedNotifications, ...buildAlertNotifications(alerts, "it"), ...buildLogNotifications(mergedLogs, "it")];
    }

    if (role === "staff") {
      return [
        ...persistedNotifications,
        ...buildStaffReportNotifications(reports, effectiveFinalReports, reportEnterprises, backendReportSourceIds),
        ...buildLogNotifications(mergedLogs, "staff", backendReportSourceIds),
      ];
    }

    return persistedNotifications;
  }, [alerts, backendNotifications, effectiveFinalReports, mergedLogs, reportEnterprises, reports, role]);

  const allNotifications = useMemo(
    () =>
      [...drafts]
        .sort((left, right) => right.sortTime - left.sortTime)
        .map((notification) => ({
          ...notification,
          read: Boolean(notification.read) || readIds.has(notification.id),
        })),
    [drafts, readIds],
  );
  const notifications = useMemo(() => allNotifications.slice(0, MAX_VISIBLE_NOTIFICATIONS), [allNotifications]);

  const persistReadIds = useCallback(
    (nextIds: Set<string>) => {
      const limitedIds = Array.from(nextIds).slice(-READ_STORAGE_LIMIT);
      const limitedSet = new Set(limitedIds);
      setReadState({ storageKey, ids: limitedSet });
      writeStoredNotificationIds(storageKey, limitedIds);
    },
    [storageKey],
  );

  const markAsRead = useCallback(
    (notificationId: string) => {
      const backendId = allNotifications.find((notification) => notification.id === notificationId)?.backendId;
      if (backendId) {
        void updateUserNotificationRead(backendId, true);
      }
      persistReadIds(new Set(readIds).add(notificationId));
    },
    [allNotifications, persistReadIds, readIds],
  );

  const markAllAsRead = useCallback(() => {
    allNotifications
      .filter((notification): notification is PortalNotification & { backendId: string } => Boolean(notification.backendId) && !notification.read)
      .forEach((notification) => {
        void updateUserNotificationRead(notification.backendId, true);
      });
    persistReadIds(new Set([...readIds, ...allNotifications.map((notification) => notification.id)]));
  }, [allNotifications, persistReadIds, readIds]);

  return {
    notifications,
    allNotifications,
    unreadCount: allNotifications.filter((notification) => !notification.read).length,
    isLoading: alertsLoading || backendNotificationsQuery.isLoading || reportEnterprisesQuery.isLoading || reportsQuery.isLoading || finalReportsQuery.isLoading,
    viewAllPath: viewAllPathByRole[role],
    markAsRead,
    markAllAsRead,
  };
}

function buildBackendNotifications(notifications: BackendNotification[], role: UserRole): DraftNotification[] {
  return notifications.map((notification) => ({
    id: `backend-notification:${notification.id}`,
    backendId: notification.id,
    title: notification.title,
    message: notification.message,
    time: formatTimestamp(notification.createdAt),
    source: notification.type,
    statusLabel: notification.severity,
    tone: toneFromNotificationSeverity(notification.severity),
    targetPath: getBackendNotificationTargetPath(role, notification),
    read: Boolean(notification.readAt),
    sortTime: toSortTime(notification.createdAt),
  }));
}

function toneFromNotificationSeverity(severity: BackendNotificationSeverity): PortalNotificationTone {
  if (severity === "Critical") return "critical";
  if (severity === "Warning") return "warning";
  if (severity === "Success") return "success";
  return "info";
}

function getBackendNotificationTargetPath(role: UserRole, notification: BackendNotification) {
  const text = `${notification.type} ${notification.sourceType ?? ""} ${notification.title}`.toLowerCase();
  if (role === "admin") {
    if (text.includes("enterprise.profile") || text.includes("profile change request")) return routes.admin.alertsMonitor;
    if (text.includes("support") || text.includes("ticket")) return routes.admin.supportTickets;
    return text.includes("security") || text.includes("profile") || text.includes("password") ? routes.admin.systemLogs : routes.admin.alertsMonitor;
  }
  if (role === "it") {
    if (text.includes("enterprise.profile") || text.includes("profile change request")) return routes.it.enterpriseAccounts;
    if (text.includes("support") || text.includes("ticket")) return routes.it.supportTickets;
    return text.includes("security") || text.includes("password") || text.includes("startup") ? routes.it.systemLogs : routes.it.alerts;
  }
  if (role === "staff") {
    return text.includes("report") || text.includes("batch") ? routes.staff.batchReports : routes.staff.systemLogs;
  }
  return undefined;
}

function getBackendReportNotificationSourceIds(notifications: BackendNotification[]) {
  return new Set(
    notifications.flatMap((notification) => {
      if (!notification.sourceId || !isBackendReportNotification(notification)) return [];
      return [notification.sourceId];
    }),
  );
}

function isBackendReportNotification(notification: BackendNotification) {
  const text = `${notification.type} ${notification.sourceType ?? ""} ${notification.title}`.toLowerCase();
  return text.includes("enterprise report") || text.includes("enterprise.report") || text.includes("batch reports");
}

function buildAlertNotifications(alerts: PriorityAlert[], role: "admin" | "it"): DraftNotification[] {
  return alerts
    .filter((alert) => alert.status !== "Resolved")
    .filter((alert) => (role === "admin" ? alert.owner === "Admin" || alert.owner === "System" || alert.severity === "Critical" : alert.owner === "IT"))
    .map((alert) => ({
      id: `alert:${alert.id}:${alert.status}`,
      title: `${alert.severity} ${alert.type}`,
      message: `${alert.enterprise ?? alert.requester}: ${alert.summary}`,
      time: alert.time,
      source: "Alerts",
      statusLabel: alert.status,
      tone: toneFromSeverity(alert.severity),
      targetPath: role === "admin" ? routes.admin.alertsMonitor : routes.it.alerts,
      sortTime: toSortTime(alert.time),
    }));
}

function buildLogNotifications(logs: SystemLog[], role: "admin" | "it" | "staff", backendReportSourceIds = new Set<string>()): DraftNotification[] {
  return logs
    .filter((log) => isRoleRelevantLog(log, role))
    .filter((log) => !isDuplicateStaffReportSubmissionLog(log, role, backendReportSourceIds))
    .map((log) => ({
      id: `activity-log:${log.id}:${log.severity}`,
      title: `${log.severity} ${log.action}`,
      message: log.summary,
      time: formatTimestamp(log.timestamp),
      source: log.category,
      statusLabel: log.actorRole,
      tone: toneFromSeverity(log.severity),
      targetPath: getLogTargetPath(role),
      sortTime: toSortTime(log.timestamp),
    }));
}

function buildStaffReportNotifications(reports: IntakeReport[], finalReports: FinalReport[], enterprises: ReportEnterprise[], backendReportSourceIds = new Set<string>()): DraftNotification[] {
  const currentPeriod = getCurrentSubmissionPeriod();
  const currentReports = reports.filter((report) => report.month === currentPeriod.month && getReportYear(report) === currentPeriod.year);
  const enterpriseMissingNotifications = enterprises
    .filter((enterprise) => !currentReports.some((report) => report.enterpriseId === enterprise.id))
    .map<DraftNotification>((enterprise) => ({
      id: `report-missing:${enterprise.id}:${currentPeriod.month}:${currentPeriod.year}`,
      title: "Missing Enterprise Submission",
      message: `${enterprise.name} has no report for ${currentPeriod.month} ${currentPeriod.year}.`,
      time: `${currentPeriod.month} ${currentPeriod.year}`,
      source: "Batch Reports",
      statusLabel: "Missing",
      tone: "warning",
      targetPath: routes.staff.batchReports,
      sortTime: 0,
    }));

  const reportNotifications = reports
    .filter((report) => shouldNotifyStaffAboutReport(report, backendReportSourceIds))
    .map<DraftNotification>((report) => {
      const submittedKey = report.submittedAt ?? report.submitted;
      return {
        id: `report:${report.id}:${report.status}:${submittedKey}`,
        title: getReportNotificationTitle(report.status),
        message: `${report.enterprise} submitted ${report.code} for ${report.period}. Status: ${report.status}.`,
        time: report.submitted,
        source: "Batch Reports",
        statusLabel: report.status,
        tone: toneFromReportStatus(report.status),
        targetPath: routes.staff.batchReports,
        sortTime: toSortTime(submittedKey),
      };
    });

  const finalReportNotifications = finalReports
    .filter((report) => report.status === "Draft")
    .map<DraftNotification>((report) => ({
      id: `final-report:${report.id}:${report.status}`,
      title: "Final Report Ready for Audit",
      message: `${report.title} ${report.id} is a draft for ${report.period}.`,
      time: formatTimestamp(report.generatedOn),
      source: "Final Reports Audit",
      statusLabel: report.status,
      tone: "info",
      targetPath: routes.staff.finalReportsAudit,
      sortTime: toSortTime(report.generatedOn),
    }));

  return [...reportNotifications, ...enterpriseMissingNotifications, ...finalReportNotifications];
}

function isRoleRelevantLog(log: SystemLog, role: "admin" | "it" | "staff") {
  if (role === "admin") {
    return log.severity === "Critical" || (log.severity === "Warning" && (log.category === "System" || log.action.toLowerCase().includes("alert")));
  }

  if (role === "it") {
    return (
      (log.severity === "Critical" || log.severity === "Warning") &&
      (log.category === "System" || log.category === "IT Activity" || log.category === "Enterprise Activity" || log.action.toLowerCase().includes("alert"))
    );
  }

  return (log.category === "Staff Submission" || log.category === "Staff Operation") && (log.action.toLowerCase().includes("report") || log.severity === "Warning");
}

function isDuplicateStaffReportSubmissionLog(log: SystemLog, role: "admin" | "it" | "staff", backendReportSourceIds: Set<string>) {
  return role === "staff" && log.category === "Staff Submission" && Boolean(log.sourceId && backendReportSourceIds.has(log.sourceId));
}

function shouldNotifyStaffAboutReport(report: IntakeReport, backendReportSourceIds: Set<string>) {
  if (report.status === "Pending Review" && backendReportSourceIds.has(report.id)) return false;
  return report.status === "Pending Review" || report.status === "Ready to Consolidate" || report.status === "Returned" || report.status === "Missing";
}

function getReportNotificationTitle(status: ReportStatus) {
  if (status === "Pending Review") return "Report Awaiting Review";
  if (status === "Ready to Consolidate") return "Report Ready to Consolidate";
  if (status === "Returned") return "Report Returned for Revision";
  if (status === "Missing") return "Missing Enterprise Submission";
  return "Report Workflow Update";
}

function toneFromReportStatus(status: ReportStatus): PortalNotificationTone {
  if (status === "Missing" || status === "Returned") return "warning";
  if (status === "Ready to Consolidate") return "success";
  return "info";
}

function toneFromSeverity(severity: LogSeverity): PortalNotificationTone {
  if (severity === "Critical") return "critical";
  if (severity === "Warning") return "warning";
  if (severity === "Success") return "success";
  return "info";
}

function getLogTargetPath(role: "admin" | "it" | "staff") {
  if (role === "admin") return routes.admin.systemLogs;
  if (role === "it") return routes.it.systemLogs;
  return routes.staff.systemLogs;
}

function mergeLogs(primaryLogs: SystemLog[], secondaryLogs: SystemLog[]) {
  const merged = new Map<string, SystemLog>();
  [...primaryLogs, ...secondaryLogs].forEach((log) => merged.set(log.id, log));
  return Array.from(merged.values());
}

function getCurrentSubmissionPeriod(date = new Date()) {
  return {
    month: MONTHS[date.getMonth()],
    year: String(date.getFullYear()),
  };
}

function getReportYear(report: IntakeReport) {
  const periodYear = report.period.match(/\d{4}/)?.[0];
  if (periodYear) return periodYear;

  const submittedAtYear = getDateYear(report.submittedAt);
  if (submittedAtYear) return submittedAtYear;

  return getDateYear(report.submitted);
}

function getDateYear(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getFullYear()) : null;
}

function toSortTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function readStoredNotificationIds(key: string) {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writeStoredNotificationIds(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(ids));
}
