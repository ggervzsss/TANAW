import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { CriticalAlertToasts } from "../../features/alerts/components/CriticalAlertToasts";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, setMlEnterpriseContext } from "../../features/camera/services/ml-service";
import { getCurrentUser, logout as logoutRequest } from "../../features/login/api/login";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { listNotifications, updateNotificationRead, type BackendNotification } from "../../features/notifications/services/notifications";
import { useRealtimeEvent } from "../../features/realtime/realtime-context";
import { notifySuccess } from "../../features/toasts/services/toast-service";
import { usePersistentIssue } from "../../features/toasts/services/persistent-issue";
import { applyThemePreference, getInitialThemePreference, persistThemePreference, resolveThemePreference } from "../../features/security/utils/theme";
import { useDesktopCloudSync } from "../../features/sync/hooks/useDesktopCloudSync";
import { useSystemDisplayPreferences } from "../../features/preferences/system-display-preferences";
import { EMPTY_CAMERAS, EMPTY_REPORTS } from "../../lib/operationalDefaults";
import type { Camera as EnterpriseCamera, EnterpriseNotification, EnterpriseView, ReportRecord, ThemePreference } from "../../types/enterprise";
import { routePaths } from "../router/routePaths";
import { createPageStateKey, readPageState, writePageState } from "../../utils/page-state";
import { EnterpriseTopbar } from "./EnterpriseTopbar";
import { buildEnterpriseNotifications, readStoredNotificationIds, upsertBackendNotification, writeStoredNotificationIds } from "../../features/notifications/model/enterprise-notifications";
import {
  CameraManagementView,
  DashboardView,
  NotificationsView,
  ProfileView,
  ReportsView,
  SecurityView,
  TicketsView,
  preloadEnterpriseView,
  scheduleEnterpriseViewPreload,
} from "../router/enterprise-view-modules";

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
  const [mlContextError, setMlContextError] = useState<string | null>(null);
  const [backendNotifications, setBackendNotifications] = useState<BackendNotification[]>([]);
  const displayName = user?.enterpriseName ?? user?.name ?? "Enterprise User";
  const initials = getInitials(displayName);
  const enterpriseCameraStorageKey = useMemo(() => getEnterpriseCameraStorageKey(user), [user]);
  const scrollStateKey = useMemo(
    () => createPageStateKey({ portal: "desktop", role: user?.role ?? "enterprise", userId: user?.id ?? "anonymous" }, viewRouteById[activeView], "scroll"),
    [activeView, user?.id, user?.role],
  );

  useDesktopCloudSync(mlContextReady);
  usePersistentIssue({
    id: "ml-enterprise-context",
    message: mlContextError,
    title: "Camera service unavailable",
    tone: "error",
  });

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
    if (currentUserQuery.isError && isAxiosError(currentUserQuery.error) && currentUserQuery.error.response?.status === 401) {
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

  useEffect(() => scheduleEnterpriseViewPreload(activeView), [activeView]);

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
      setMlContextError(null);
      return;
    }

    let disposed = false;
    setMlContextReady(false);
    setMlContextError(null);
    void getMlServiceStatus()
      .then((status) => {
        const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
        return setMlEnterpriseContext(baseUrl, enterpriseId, user?.enterpriseName ?? user?.displayName ?? user?.name);
      })
      .then(() => {
        if (!disposed) {
          setMlContextReady(true);
          setMlContextError(null);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setMlContextReady(false);
          setMlContextError(error instanceof Error ? error.message : "TANAW could not initialize the local camera service.");
        }
      });

    return () => {
      disposed = true;
    };
  }, [user?.displayName, user?.enterpriseId, user?.enterpriseName, user?.id, user?.name]);

  useLayoutEffect(() => {
    const container = contentScrollRef.current;
    const restored = readPageState(scrollStateKey, 1, isScrollPosition) ?? { top: 0 };
    const restore = () => container?.scrollTo({ top: restored.top, left: 0 });
    const frame = window.requestAnimationFrame(restore);
    const settledRestore = window.setTimeout(restore, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settledRestore);
      writePageState(scrollStateKey, 1, { top: container?.scrollTop ?? 0 });
    };
  }, [scrollStateKey]);

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
    void preloadEnterpriseView(view);
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
        onNavigateIntent={(view) => void preloadEnterpriseView(view)}
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

function isScrollPosition(value: unknown): value is { top: number } {
  return Boolean(value && typeof value === "object" && "top" in value && typeof value.top === "number" && Number.isFinite(value.top));
}
