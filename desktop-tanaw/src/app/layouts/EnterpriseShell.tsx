import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { CriticalAlertToasts } from "../../features/alerts/components/CriticalAlertToasts";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, setMlEnterpriseContext } from "../../features/camera/services/ml-service";
import { getCurrentUser, logout as logoutRequest } from "../../features/login/api/login";
import { useAuthStore } from "../../features/login/stores/auth-store";
import {
  listNotifications,
  updateNotificationRead,
  type BackendNotification,
} from "../../features/notifications/services/notifications";
import { useRealtimeEvent } from "../../features/realtime/realtime-context";
import { notifySuccess } from "../../features/toasts/services/toast-service";
import { applyThemePreference, getInitialThemePreference, persistThemePreference, resolveThemePreference } from "../../features/security/utils/theme";
import { useDesktopCloudSync } from "../../features/sync/hooks/useDesktopCloudSync";
import { useSystemDisplayPreferences } from "../../features/preferences/system-display-preferences";
import { EMPTY_CAMERAS, EMPTY_REPORTS } from "../../lib/operationalDefaults";
import type { Camera as EnterpriseCamera, EnterpriseNotification, EnterpriseView, ReportRecord, ThemePreference } from "../../types/enterprise";
import { formatPhilippineDateTime, type SystemTimeFormat } from "../../utils/date-time";
import { routePaths } from "../router/routePaths";
import { EnterpriseTopbar } from "./EnterpriseTopbar";

const CameraManagementView = lazy(() =>
  import("../../features/camera/components/CameraManagementView").then((module) => ({
    default: module.CameraManagementView,
  })),
);
const DashboardView = lazy(() =>
  import("../../features/dashboard/components/DashboardView").then((module) => ({
    default: module.DashboardView,
  })),
);
const NotificationsView = lazy(() =>
  import("../../features/notifications/components/NotificationsView").then((module) => ({
    default: module.NotificationsView,
  })),
);
const ProfileView = lazy(() =>
  import("../../features/profile/components/ProfileView").then((module) => ({
    default: module.ProfileView,
  })),
);
const ReportsView = lazy(() =>
  import("../../features/reports/components/ReportsView").then((module) => ({
    default: module.ReportsView,
  })),
);
const SecurityView = lazy(() =>
  import("../../features/security/components/SecurityView").then((module) => ({
    default: module.SecurityView,
  })),
);
const TicketsView = lazy(() =>
  import("../../features/tickets/components/TicketsView").then((module) => ({
    default: module.TicketsView,
  })),
);

type EnterpriseShellProps = {
  initialView?: EnterpriseView;
};

const viewRouteById: Record<EnterpriseView, string> = {
  dashboard: routePaths.enterpriseDashboard,
  cameras: routePaths.enterpriseCameras,
  reports: routePaths.enterpriseReports,
  profile: routePaths.enterpriseProfile,
  security: routePaths.enterpriseSecurity,
  notifications: routePaths.enterpriseNotifications,
  tickets: routePaths.enterpriseTickets,
};

export function EnterpriseShell({ initialView = "dashboard" }: EnterpriseShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const updateUser = useAuthStore((state) => state.updateUser);
  const { timeFormat } = useSystemDisplayPreferences();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [activeView, setActiveView] = useState<EnterpriseView>(initialView);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [reportsHistory, setReportsHistory] = useState<ReportRecord[]>(EMPTY_REPORTS);
  const [cameras, setCameras] = useState<EnterpriseCamera[]>(EMPTY_CAMERAS);
  const notificationStorageKey = `tanaw-enterprise-notifications-read:${user?.id ?? "anonymous"}`;
  const [readNotificationIds, setReadNotificationIds] = useState<Set<number>>(() => readStoredNotificationIds(notificationStorageKey));
  const [toasts, setToasts] = useState<EnterpriseNotification[]>([]);
  const [theme, setTheme] = useState<ThemePreference>(getInitialThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveThemePreference(getInitialThemePreference()));
  const [mlContextReady, setMlContextReady] = useState(false);
  const [mlBaseUrl, setMlBaseUrl] = useState(DEFAULT_ML_SERVICE_BASE_URL);
  const [backendNotifications, setBackendNotifications] = useState<BackendNotification[]>([]);
  const displayName = user?.enterpriseName ?? user?.name ?? "Enterprise User";
  const initials = getInitials(displayName);
  const enterpriseCameraStorageKey = useMemo(() => getEnterpriseCameraStorageKey(user), [user]);

  useDesktopCloudSync(mlContextReady, mlBaseUrl);

  const currentUserQuery = useQuery({
    queryKey: ["enterprise-current-user", token],
    queryFn: getCurrentUser,
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (currentUserQuery.data) {
      updateUser(currentUserQuery.data);
    }
  }, [currentUserQuery.data, updateUser]);

  useEffect(() => {
    setReadNotificationIds(readStoredNotificationIds(notificationStorageKey));
  }, [notificationStorageKey]);

  useEffect(() => {
    if (
      currentUserQuery.isError &&
      isAxiosError(currentUserQuery.error) &&
      (currentUserQuery.error.response?.status === 401 || currentUserQuery.error.response?.status === 403)
    ) {
      logout();
      navigate(routePaths.login, { replace: true });
    }
  }, [currentUserQuery.error, currentUserQuery.isError, logout, navigate]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      setResolvedTheme(applyThemePreference(theme));
    };

    persistThemePreference(theme);
    applyTheme();

    if (theme !== "system") return undefined;

    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    setCameras(EMPTY_CAMERAS);
    setReportsHistory(EMPTY_REPORTS);
    setBackendNotifications([]);
  }, [enterpriseCameraStorageKey]);

  const refreshBackendNotifications = useCallback(async () => {
    if (!token) return;
    try {
      setBackendNotifications(await listNotifications());
    } catch {
      // Preserve the last successful snapshot while the connection recovers.
    }
  }, [token]);

  useEffect(() => {
    void refreshBackendNotifications();
  }, [refreshBackendNotifications]);

  useRealtimeEvent((event) => {
    if (event.event_type.startsWith("notification.")) {
      void refreshBackendNotifications();
    }
  });

  useEffect(() => {
    const enterpriseId = user?.enterpriseId || user?.id;
    if (!enterpriseId) {
      setMlContextReady(false);
      return;
    }

    let disposed = false;
    setMlContextReady(false);
    void getMlServiceStatus()
      .then((status) => {
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        setMlBaseUrl(baseUrl);
        return setMlEnterpriseContext(baseUrl, enterpriseId, user?.enterpriseName ?? user?.displayName ?? user?.name);
      })
      .then(() => {
        if (!disposed) setMlContextReady(true);
      })
      .catch(() => {
        if (!disposed) setMlContextReady(false);
      });

    return () => {
      disposed = true;
    };
  }, [user?.displayName, user?.enterpriseId, user?.enterpriseName, user?.id, user?.name]);

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeView]);

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } finally {
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      logout();
      notifySuccess("Logout complete");
      navigate(routePaths.login, { replace: true });
    }
  };

  const navigateToView = (view: EnterpriseView) => {
    setActiveView(view);
    setIsNotificationsOpen(false);
    navigate(viewRouteById[view]);
  };

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = resolveThemePreference(currentTheme) === "dark" ? "light" : "dark";
      persistThemePreference(nextTheme);
      setResolvedTheme(applyThemePreference(nextTheme));
      return nextTheme;
    });
  };

  const notifications = useMemo(
    () => buildEnterpriseNotifications(reportsHistory, readNotificationIds, backendNotifications, timeFormat),
    [backendNotifications, readNotificationIds, reportsHistory, timeFormat],
  );
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    const unreadCriticalNotifications = notifications.filter((notification) => notification.type === "critical" && !notification.read);
    if (unreadCriticalNotifications.length === 0) return;

    setToasts((currentToasts) => {
      const currentIds = new Set(currentToasts.map((toast) => toast.id));
      const nextToasts = [...currentToasts, ...unreadCriticalNotifications.filter((notification) => !currentIds.has(notification.id))];
      return nextToasts.length === currentToasts.length ? currentToasts : nextToasts;
    });
  }, [notifications]);

  const markNotificationsRead = (notificationsToMark: EnterpriseNotification[]) => {
    notificationsToMark.forEach((notification) => {
      if (!notification.backendId) return;
      void updateNotificationRead(notification.backendId, true)
        .then((updated) => setBackendNotifications((current) => upsertBackendNotification(current, updated)))
        .catch(() => undefined);
    });
    setReadNotificationIds((currentIds) => {
      const nextIds = new Set([...currentIds, ...notificationsToMark.map((notification) => notification.id)]);
      writeStoredNotificationIds(notificationStorageKey, nextIds);
      return nextIds;
    });
  };

  return (
    <div className="enterprise-shell relative flex h-screen flex-col overflow-hidden bg-[#eef5f0] font-['Montserrat'] transition-colors duration-300 dark:bg-(--enterprise-app-bg)">
      <EnterpriseTopbar
        activeView={activeView}
        displayName={displayName}
        initials={initials}
        isNotificationsOpen={isNotificationsOpen}
        notifications={notifications}
        resolvedTheme={resolvedTheme}
        unreadCount={unreadCount}
        user={user}
        onLogout={handleLogout}
        onMarkAllRead={() => markNotificationsRead(notifications)}
        onNavigate={navigateToView}
        onNotificationSelect={(notification) => {
          markNotificationsRead([notification]);
          navigateToView(notification.target);
        }}
        onNotificationsClose={() => setIsNotificationsOpen(false)}
        onNotificationsToggle={() => setIsNotificationsOpen((current) => !current)}
        onToggleTheme={toggleTheme}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={contentScrollRef}
          data-form-scroll-container
          className={`flex-1 bg-[#f4f8f5] transition-colors duration-300 dark:bg-(--enterprise-app-bg) ${activeView === "cameras" ? "overflow-hidden p-4 max-xl:p-3" : "overflow-auto p-8 max-xl:p-6 max-sm:p-4"}`}
        >
          <div className={`mx-auto max-w-470 ${activeView === "cameras" ? "h-full min-h-0" : ""}`}>
            <Suspense fallback={<EnterpriseViewLoadingFallback />}>
              {activeView === "dashboard" && mlContextReady && <DashboardView enterpriseName={displayName} />}
              {activeView === "cameras" && mlContextReady && (
                <CameraManagementView key={enterpriseCameraStorageKey} cameras={cameras} setCameras={setCameras} storageKey={enterpriseCameraStorageKey} />
              )}
              {activeView === "reports" && mlContextReady && <ReportsView enterpriseName={displayName} reportsHistory={reportsHistory} setReportsHistory={setReportsHistory} />}
              {activeView === "profile" && <ProfileView />}
              {activeView === "security" && <SecurityView />}
              {activeView === "tickets" && <TicketsView />}
              {activeView === "notifications" && (
                <NotificationsView
                  notifications={notifications}
                  unreadCount={unreadCount}
                  onMarkAllRead={() => markNotificationsRead(notifications)}
                  onSelectNotification={(notification) => {
                    markNotificationsRead([notification]);
                    navigateToView(notification.target);
                  }}
                />
              )}
            </Suspense>
          </div>
        </div>
      </main>

      <CriticalAlertToasts
        toasts={toasts}
        onReview={(toast) => {
          navigateToView(toast.target);
          setToasts(toasts.filter((current) => current.id !== toast.id));
          markNotificationsRead([toast]);
        }}
        onDismiss={(toastId) => setToasts(toasts.filter((toast) => toast.id !== toastId))}
      />
    </div>
  );
}

function EnterpriseViewLoadingFallback() {
  return (
    <div className="grid min-h-64 place-items-center text-sm font-semibold text-[#047857] dark:text-emerald-300" role="status">
      Loading view…
    </div>
  );
}

function buildEnterpriseNotifications(
  reportsHistory: ReportRecord[],
  readNotificationIds: Set<number>,
  backendNotifications: BackendNotification[],
  timeFormat: SystemTimeFormat,
) {
  const persistedNotifications = backendNotifications.map((notification) => backendNotificationToEnterpriseNotification(notification, readNotificationIds, timeFormat));
  return [...persistedNotifications, ...reportsHistory.flatMap((report) => buildReportNotifications(report, timeFormat))]
    .sort((left, right) => getNotificationSortValue(right) - getNotificationSortValue(left))
    .map((notification) => ({
      ...notification,
      read: notification.read || readNotificationIds.has(notification.id),
    }));
}

function backendNotificationToEnterpriseNotification(
  notification: BackendNotification,
  readNotificationIds: Set<number>,
  timeFormat: SystemTimeFormat,
): EnterpriseNotification {
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
      createReportNotification(
        report,
        "warning",
        `${report.id} was returned for revision. ${report.remarks ?? "Please review the report remarks."}`,
        timeFormat,
        getLatestAuditTime(report),
      ),
    );
  }

  if (report.status === "Draft") {
    notifications.push(createReportNotification(report, "warning", `${report.id} is still a draft for ${report.period ?? report.date}.`, timeFormat, getLatestAuditTime(report)));
  }

  if (report.status === "Submitted" || report.status === "Resubmitted") {
    notifications.push(
      createReportNotification(report, "success", `${report.id} was ${report.status.toLowerCase()} for ${report.period ?? report.date}.`, timeFormat, getLatestAuditTime(report)),
    );
  }

  return notifications;
}

function createReportNotification(
  report: ReportRecord,
  type: EnterpriseNotification["type"],
  message: string,
  timeFormat: SystemTimeFormat,
  timeSource?: string,
): EnterpriseNotification {
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

function upsertBackendNotification(notifications: BackendNotification[], nextNotification: BackendNotification) {
  if (notifications.some((notification) => notification.id === nextNotification.id)) {
    return notifications.map((notification) => (notification.id === nextNotification.id ? nextNotification : notification));
  }
  return [nextNotification, ...notifications].slice(0, 100);
}

function readStoredNotificationIds(key: string) {
  if (typeof window === "undefined") return new Set<number>();

  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : []);
  } catch {
    return new Set<number>();
  }
}

function writeStoredNotificationIds(key: string, ids: Set<number>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-500)));
}

function getInitials(value: string) {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "EU";
}

function getEnterpriseCameraStorageKey(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  const scope = user?.enterpriseId || user?.id || user?.email || "anonymous";
  return `tanaw.enterprise.camera-configs:${scope.replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
}
