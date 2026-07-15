import { useCallback, useMemo, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { routes } from "@/app/routers/routes";
import { useAuthStore, useSystemLogStore } from "@/app/store";
import { createOperationalQueryKeys, useOperationalNotifications } from "@/shared/hooks/useOperationalSync";
import { updateUserNotificationRead, type BackendNotification, type BackendNotificationSeverity } from "@/shared/services/operationalSync";
import type { LogSeverity, PriorityAlert, SystemLog } from "@/shared/types";
import type { UserRole } from "@/shared/types/role.types";
import { useActivityLogs } from "./useActivityLogs";
import { useAlerts } from "./useAlerts";
import { runOptimisticRead } from "./optimisticRead";

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
const EMPTY_BACKEND_NOTIFICATIONS: BackendNotification[] = [];

const viewAllPathByRole: Record<UserRole, string | undefined> = {
  admin: routes.admin.notifications,
  it: routes.it.notifications,
  staff: routes.staff.notifications,
  enterprise: undefined,
};

export function usePortalNotifications(role: UserRole) {
  const authUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const shouldLoadAlerts = role === "admin" || role === "it";
  const { alerts, isLoading: alertsLoading } = useAlerts(shouldLoadAlerts);
  const localLogs = useSystemLogStore((state) => state.logs);
  const { logs: activityLogs } = useActivityLogs();
  const backendNotificationsQuery = useOperationalNotifications();

  const storageKey = useMemo(() => `tanaw-notifications-read:${role}:${authUser?.id ?? "anonymous"}`, [authUser?.id, role]);
  const [readState, setReadState] = useState(() => ({
    storageKey,
    ids: readStoredNotificationIds(storageKey),
  }));
  const [readError, setReadError] = useState<string | null>(null);
  const readIds = readState.storageKey === storageKey ? readState.ids : readStoredNotificationIds(storageKey);

  const mergedLogs = useMemo(() => mergeLogs(activityLogs, localLogs), [activityLogs, localLogs]);
  const backendNotifications = backendNotificationsQuery.data ?? EMPTY_BACKEND_NOTIFICATIONS;

  const drafts = useMemo(() => {
    const persistedNotifications = buildBackendNotifications(backendNotifications, role);

    if (role === "admin") {
      return [...persistedNotifications, ...buildAlertNotifications(alerts, "admin"), ...buildLogNotifications(mergedLogs, "admin")];
    }

    if (role === "it") {
      return [...persistedNotifications, ...buildAlertNotifications(alerts, "it"), ...buildLogNotifications(mergedLogs, "it")];
    }

    if (role === "staff") {
      return [...persistedNotifications, ...buildLogNotifications(mergedLogs, "staff", getBackendReportNotificationSourceIds(backendNotifications))];
    }

    return persistedNotifications;
  }, [alerts, backendNotifications, mergedLogs, role]);

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
      const previousIds = new Set(readIds);
      persistReadIds(new Set(previousIds).add(notificationId));
      setReadError(null);
      if (!backendId || !authUser) return;

      const queryKey = createOperationalQueryKeys(authUser).notifications;
      const previousBackend = optimisticallyMarkBackendNotifications(queryClient, queryKey, [backendId]);
      void runOptimisticRead({
        request: () => updateUserNotificationRead(backendId, true),
        onSuccess: (updated) => replaceBackendNotification(queryClient, queryKey, updated),
        onFailure: () => {
          persistReadIds(previousIds);
          queryClient.setQueryData(queryKey, previousBackend);
          setReadError("The notification could not be marked as read. Your previous state was restored.");
        },
        onSettled: () => void queryClient.invalidateQueries({ queryKey }),
      });
    },
    [allNotifications, authUser, persistReadIds, queryClient, readIds],
  );

  const markAllAsRead = useCallback(() => {
    const unreadBackendIds = allNotifications
      .filter((notification): notification is PortalNotification & { backendId: string } => Boolean(notification.backendId) && !notification.read)
      .map((notification) => notification.backendId);
    const previousIds = new Set(readIds);
    persistReadIds(new Set([...previousIds, ...allNotifications.map((notification) => notification.id)]));
    setReadError(null);
    if (!authUser || unreadBackendIds.length === 0) return;

    const queryKey = createOperationalQueryKeys(authUser).notifications;
    const previousBackend = optimisticallyMarkBackendNotifications(queryClient, queryKey, unreadBackendIds);
    void runOptimisticRead({
      request: () => Promise.all(unreadBackendIds.map((id) => updateUserNotificationRead(id, true))),
      onSuccess: (updated) => updated.forEach((notification) => replaceBackendNotification(queryClient, queryKey, notification)),
      onFailure: () => {
        persistReadIds(previousIds);
        queryClient.setQueryData(queryKey, previousBackend);
        setReadError("Not all notifications could be marked as read. Your previous state was restored.");
      },
      onSettled: () => void queryClient.invalidateQueries({ queryKey }),
    });
  }, [allNotifications, authUser, persistReadIds, queryClient, readIds]);

  return {
    notifications,
    allNotifications,
    unreadCount: allNotifications.filter((notification) => !notification.read).length,
    isLoading: alertsLoading || backendNotificationsQuery.isLoading,
    viewAllPath: viewAllPathByRole[role],
    markAsRead,
    markAllAsRead,
    readError,
  };
}

function optimisticallyMarkBackendNotifications(queryClient: ReturnType<typeof useQueryClient>, queryKey: QueryKey, ids: string[]) {
  const previous = queryClient.getQueryData<BackendNotification[]>(queryKey);
  const marked = new Set(ids);
  queryClient.setQueryData<BackendNotification[]>(queryKey, (current) =>
    current?.map((notification) =>
      marked.has(notification.id) ? { ...notification, readAt: notification.readAt ?? new Date().toISOString() } : notification,
    ),
  );
  return previous;
}

function replaceBackendNotification(queryClient: ReturnType<typeof useQueryClient>, queryKey: QueryKey, updated: BackendNotification) {
  queryClient.setQueryData<BackendNotification[]>(queryKey, (current) =>
    current?.map((notification) => (notification.id === updated.id ? updated : notification)),
  );
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
    if (notification.sourceType === "operational.alert") return routes.admin.alertsMonitor;
    if (text.includes("enterprise.profile") || text.includes("profile change request")) return routes.admin.alertsMonitor;
    if (text.includes("support") || text.includes("ticket")) return routes.admin.supportTickets;
    return text.includes("security") || text.includes("profile") || text.includes("password") ? routes.admin.systemLogs : routes.admin.alertsMonitor;
  }
  if (role === "it") {
    if (notification.sourceType === "operational.alert") return routes.it.alerts;
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
