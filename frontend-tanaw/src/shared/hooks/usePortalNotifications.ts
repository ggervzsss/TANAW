import { useCallback, useMemo, useState } from "react";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useOperationalNotifications } from "@/shared/hooks/useOperationalSync";
import { updateUserNotificationRead, type BackendNotification, type BackendNotificationSeverity } from "@/shared/services/operationalSync";
import type { UserRole } from "@/shared/types/role.types";
import { isStaffReportSubmissionNotification } from "@/shared/utils/notificationRules";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime, type SystemTimeFormat } from "@/shared/utils/dateTime";

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
  const { timeFormat } = useSystemDisplayPreferences();
  const authUser = useAuthStore((state) => state.user);
  const backendNotificationsQuery = useOperationalNotifications();

  const storageKey = useMemo(() => `tanaw-notifications-read:${role}:${authUser?.id ?? "anonymous"}`, [authUser?.id, role]);
  const [readState, setReadState] = useState(() => ({
    storageKey,
    ids: readStoredNotificationIds(storageKey),
  }));
  const readIds = readState.storageKey === storageKey ? readState.ids : readStoredNotificationIds(storageKey);

  const backendNotifications = backendNotificationsQuery.data ?? EMPTY_BACKEND_NOTIFICATIONS;

  const drafts = useMemo(() => buildBackendNotifications(backendNotifications, role, timeFormat), [backendNotifications, role, timeFormat]);

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
    isLoading: backendNotificationsQuery.isLoading,
    viewAllPath: viewAllPathByRole[role],
    markAsRead,
    markAllAsRead,
  };
}

function buildBackendNotifications(notifications: BackendNotification[], role: UserRole, timeFormat: SystemTimeFormat): DraftNotification[] {
  return notifications
    .filter((notification) => role !== "staff" || isStaffReportSubmissionNotification(notification))
    .map((notification) => ({
      id: `backend-notification:${notification.id}`,
      backendId: notification.id,
      title: notification.title,
      message: notification.message,
      time: formatTimestamp(notification.createdAt, timeFormat),
      source: notificationSourceLabel(notification, role),
      statusLabel: notificationStatusLabel(notification.severity, role),
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

function notificationSourceLabel(notification: BackendNotification, role: UserRole) {
  if (role === "it") {
    if (notification.sourceType === "operational.alert") return "Technical Issue";
    if (notification.sourceType === "support.ticket") return "Support Request";
    if (notification.sourceType === "email.delivery") return "Email Problem";
    if (notification.sourceType?.startsWith("enterprise.profile")) return "Account Request";
    return notification.type;
  }
  if (role !== "admin") return notification.type;
  if (notification.sourceType === "operational.alert") return "Current Situation";
  if (notification.sourceType === "support.ticket") return "Escalated Support";
  if (notification.sourceType?.startsWith("enterprise.profile")) return "Account Request";
  return notification.type;
}

function notificationStatusLabel(severity: BackendNotificationSeverity, role: UserRole) {
  if (role === "it" || role === "admin") {
    if (severity === "Critical") return "Urgent";
    if (severity === "Warning") return "Important";
    if (severity === "Success") return "Completed";
    return undefined;
  }
  return severity;
}

export function getBackendNotificationTargetPath(role: UserRole, notification: BackendNotification) {
  const text = `${notification.type} ${notification.sourceType ?? ""} ${notification.title}`.toLowerCase();
  if (role === "admin") {
    if (notification.sourceType === "operational.alert") {
      return adminOperationsPath("situations", "alert", notification.sourceId);
    }
    if (text.includes("enterprise.profile") || text.includes("profile change request")) {
      return adminOperationsPath("accounts");
    }
    if (text.includes("support") || text.includes("ticket")) {
      return adminOperationsPath("support", "ticket", notification.sourceId);
    }
    return text.includes("security") || text.includes("profile") || text.includes("password")
      ? routes.admin.activityHistory
      : routes.admin.operations;
  }
  if (role === "it") {
    if (notification.sourceType === "operational.alert") return itWorkCenterPath("issues", "alert", notification.sourceId);
    if (notification.sourceType === "email.delivery") return itWorkCenterPath("email");
    if (text.includes("enterprise.profile") || text.includes("profile change request")) {
      return itWorkCenterPath("accounts", "account", notification.sourceId);
    }
    if (text.includes("support") || text.includes("ticket")) return itWorkCenterPath("support", "ticket", notification.sourceId);
    return text.includes("security") || text.includes("password") || text.includes("startup") ? routes.it.systemLogs : itWorkCenterPath("issues");
  }
  if (role === "staff") {
    if (text.includes("report") || text.includes("batch")) return routes.staff.batchReports;
    if (text.includes("security") || text.includes("password")) return routes.staff.security;
    return routes.staff.notifications;
  }
  return undefined;
}

function adminOperationsPath(view: "situations" | "support" | "accounts", itemKey?: "alert" | "ticket", itemId?: string | null) {
  const params = new URLSearchParams({ view });
  if (itemKey && itemId) params.set(itemKey, itemId);
  return `${routes.admin.operations}?${params.toString()}`;
}

function itWorkCenterPath(view: "issues" | "support" | "accounts" | "email", itemKey?: "alert" | "ticket" | "account", itemId?: string | null) {
  const params = new URLSearchParams({ view });
  if (itemKey && itemId) params.set(itemKey, itemId);
  return `${routes.it.workCenter}?${params.toString()}`;
}

function toSortTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatTimestamp(value: string, timeFormat: SystemTimeFormat) {
  return formatPhilippineDateTime(value, timeFormat);
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
