import { loadCameraCredentialMetadata } from "../../features/camera/services/camera-credentials";
import { applyStoredCameraMetadata, normalizeCamera } from "../../features/camera/model/camera-management";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { CriticalAlertToasts } from "../../features/alerts/components/CriticalAlertToasts";
import { CameraServiceStartupCard } from "../../features/camera/components/CameraServiceStartupCard";
import { DEFAULT_ML_SERVICE_BASE_URL, MlServiceRequestError, getMlServiceStatus, listLocalCameras, resetUnreadableLocalData, setMlEnterpriseContext } from "../../features/camera/services/ml-service";
import { getCurrentUser, logout as logoutRequest } from "../../features/login/api/login";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { listNotifications, updateNotificationRead, type BackendNotification } from "../../features/notifications/services/notifications";
import { useRealtimeEvent } from "../../features/realtime/realtime-context";
import { notifySuccess, notifyWarning } from "../../features/toasts/services/toast-service";
import { useBackupRestoreGeneration } from "../../features/sync/hooks/useBackupRestoreGeneration";
import { useDesktopCloudSync } from "../../features/sync/hooks/useDesktopCloudSync";
import { reportDesktopEvent } from "../../features/sync/services/connection-gap";
import { useSystemDisplayPreferences } from "../../features/preferences/system-display-preferences";
import { EMPTY_CAMERAS, EMPTY_REPORTS } from "../../lib/operationalDefaults";
import type { Camera as EnterpriseCamera, EnterpriseNotification, EnterpriseView, ReportRecord } from "../../types/enterprise";
import { routePaths } from "../router/routePaths";
import { createPageStateKey, readPageState, writePageState } from "../../utils/page-state";
import { ThemedEnterpriseTopbar } from "./ThemedEnterpriseTopbar";
import { usePageEnter } from "../../ui-kit/lib/page-enter";
import { ViewSkeleton, type ViewSkeletonVariant } from "../../ui-kit/patterns/ViewSkeleton";
import { buildEnterpriseNotifications, readStoredNotificationIds, upsertBackendNotification, writeStoredNotificationIds } from "../../features/notifications/model/enterprise-notifications";
import {
  CameraManagementView,
  DashboardView,
  NotificationsView,
  ReportsView,
  GeneralSettingsView,
  HelpCenterView,
  preloadEnterpriseView,
  scheduleEnterpriseViewPreload,
} from "../router/enterprise-view-modules";

type EnterpriseShellProps = {
  activeView: EnterpriseView;
};

const viewRouteById: Record<EnterpriseView, string> = {
  dashboard: routePaths.enterpriseDashboard,
  cameras: routePaths.enterpriseCameras,
  reports: routePaths.enterpriseReports,
  profile: routePaths.enterpriseProfile,
  security: routePaths.enterpriseSecurity,
  notifications: routePaths.enterpriseNotifications,
  tickets: routePaths.enterpriseTickets,
  settings: routePaths.enterpriseSettings,
  help: routePaths.enterpriseHelp,
};

export function EnterpriseShell({ activeView }: EnterpriseShellProps) {
  const navigate = useNavigate();
  const { pathname, search, hash, state } = useLocation();
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const updateUser = useAuthStore((state) => state.updateUser);
  const { timeFormat } = useSystemDisplayPreferences();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // A gentle fade (and a slight rise outside Settings, whose workspace must fill the page) on each
  // change of page, so the switch reads as a change of place rather than a flash.
  usePageEnter(mainRef, activeView, { rise: activeView === "settings" ? 0 : 4 });
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [reportsHistory, setReportsHistory] = useState<ReportRecord[]>(EMPTY_REPORTS);
  const [cameras, setCameras] = useState<EnterpriseCamera[]>(EMPTY_CAMERAS);
  const notificationStorageKey = `tanaw-enterprise-notifications-read:${user?.id ?? "anonymous"}`;
  const [readNotificationIds, setReadNotificationIds] = useState<Set<number>>(() => readStoredNotificationIds(notificationStorageKey));
  const [dismissedCriticalIds, setDismissedCriticalIds] = useState<ReadonlySet<number>>(() => new Set());
  const [mlContextReady, setMlContextReady] = useState(false);
  const [mlContextError, setMlContextError] = useState<string | null>(null);
  const [mlContextResetRequired, setMlContextResetRequired] = useState(false);
  const [mlContextAttempt, setMlContextAttempt] = useState(0);
  const [backendNotifications, setBackendNotifications] = useState<BackendNotification[]>([]);
  const displayName = user?.enterpriseName ?? user?.name ?? "Enterprise User";
  const enterpriseCameraStorageKey = useMemo(() => getEnterpriseCameraStorageKey(user), [user]);
  const scrollPath = activeView === "settings" ? pathname : viewRouteById[activeView];
  const scrollStateKey = useMemo(
    () => createPageStateKey({ portal: "desktop", role: user?.role ?? "enterprise", userId: user?.id ?? "anonymous" }, scrollPath, "scroll"),
    [scrollPath, user?.id, user?.role],
  );

  useDesktopCloudSync(mlContextReady);
  const backupRestoreGeneration = useBackupRestoreGeneration();

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
    setDismissedCriticalIds(new Set());
  }, [notificationStorageKey]);

  useEffect(() => {
    if (currentUserQuery.isError && isAxiosError(currentUserQuery.error) && currentUserQuery.error.response?.status === 401) {
      logout();
      navigate(routePaths.login, { replace: true });
    }
  }, [currentUserQuery.error, currentUserQuery.isError, logout, navigate]);

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
    setMlContextResetRequired(false);
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
          setMlContextResetRequired(error instanceof MlServiceRequestError && error.code === "local_database_reset_required");
        }
      });

    return () => {
      disposed = true;
    };
  }, [mlContextAttempt, user?.displayName, user?.enterpriseId, user?.enterpriseName, user?.id, user?.name]);

  const resetLocalData = useCallback(async () => {
    const enterpriseId = user?.enterpriseId || user?.id;
    if (!enterpriseId) return;
    const status = await getMlServiceStatus();
    await resetUnreadableLocalData(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL, enterpriseId);
    notifySuccess("Local data was reset. TANAW is starting with fresh local data.");
    void reportDesktopEvent("local_data_reset");
    setMlContextAttempt((attempt) => attempt + 1);
  }, [user?.enterpriseId, user?.id]);

  useEffect(() => {
    if (!mlContextReady) return;
    let disposed = false;
    void getMlServiceStatus()
      .then((status) => Promise.all([listLocalCameras(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL), loadCameraCredentialMetadata(enterpriseCameraStorageKey)]))
      .then(([profiles, metadata]) => {
        if (!disposed && activeViewRef.current !== "cameras") {
          setCameras(profiles.map((profile) => applyStoredCameraMetadata(normalizeCamera(profile), metadata)));
        }
      })
      .catch(() => {
        /* Camera Setup provides the detailed connection recovery controls. */
      });
    return () => {
      disposed = true;
    };
  }, [mlContextReady, enterpriseCameraStorageKey, backupRestoreGeneration]);

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
      notifySuccess("Signed out of TANAW.");
    } catch {
      notifyWarning("Signed out on this device. TANAW could not confirm sign-out with the server.");
    } finally {
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      logout();
      navigate(routePaths.login, { replace: true });
    }
  };

  const navigateToView = (view: EnterpriseView) => {
    setIsNotificationsOpen(false);
    void preloadEnterpriseView(view);
    const path = viewRouteById[view];
    if (path.startsWith(routePaths.enterpriseSettings)) {
      navigate(path, { state: activeView === "settings" ? state : { returnTo: pathname + search + hash } });
    } else {
      navigate(path);
    }
  };

  const notifications = useMemo(
    () => buildEnterpriseNotifications(reportsHistory, readNotificationIds, backendNotifications, timeFormat),
    [backendNotifications, readNotificationIds, reportsHistory, timeFormat],
  );
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const criticalToasts = notifications.filter((notification) => notification.type === "critical" && !notification.read && !dismissedCriticalIds.has(notification.id));

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
    <div className="enterprise-shell relative flex h-screen flex-col overflow-hidden bg-[#eef5f0] transition-colors duration-300 dark:bg-(--enterprise-app-bg)">
      <ThemedEnterpriseTopbar
        activeView={activeView}
        displayName={displayName}
        isNotificationsOpen={isNotificationsOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        user={user}
        onLogout={handleLogout}
        onMarkAllRead={() => markNotificationsRead(notifications)}
        onNavigate={navigateToView}
        onOpenSettings={(profile) => navigateToView(profile ? "profile" : "settings")}
        onNavigateIntent={(view) => void preloadEnterpriseView(view)}
        onNotificationSelect={(notification) => {
          markNotificationsRead([notification]);
          navigateToView(notification.target);
        }}
        onNotificationsClose={() => setIsNotificationsOpen(false)}
        onNotificationsToggle={() => setIsNotificationsOpen((current) => !current)}
      />

      <main ref={mainRef} className={activeView === "settings" ? "tanaw-settings-page overflow-auto" : "flex min-h-0 flex-1 flex-col overflow-hidden"}>
        {activeView === "settings" ? (
          <Suspense fallback={<EnterpriseViewLoadingFallback view="settings" />}>
            {user?.role === "enterprise" && <GeneralSettingsView />}
          </Suspense>
        ) : (
          <div
            ref={contentScrollRef}
            data-form-scroll-container
            className={`enterprise-content flex-1 transition-colors duration-300 dark:bg-(--enterprise-app-bg) ${activeView === "cameras" ? "overflow-hidden p-4 max-xl:p-3" : "overflow-auto p-8 max-xl:p-6 max-sm:p-4"}`}
          >
            <div className={`mx-auto max-w-470 ${activeView === "cameras" ? "h-full min-h-0" : ""}`}>
              {!mlContextReady && (activeView === "dashboard" || activeView === "cameras" || activeView === "reports") && (
                <CameraServiceStartupCard
                  error={mlContextError}
                  resetRequired={mlContextResetRequired}
                  onRetry={() => setMlContextAttempt((attempt) => attempt + 1)}
                  onResetLocalData={resetLocalData}
                />
              )}
              <Suspense fallback={<EnterpriseViewLoadingFallback view={activeView} />}>
                {activeView === "dashboard" && mlContextReady && <DashboardView enterpriseName={displayName} cameras={cameras} />}
                {activeView === "cameras" && mlContextReady && (
                  <CameraManagementView key={enterpriseCameraStorageKey} cameras={cameras} setCameras={setCameras} storageKey={enterpriseCameraStorageKey} />
                )}
                {activeView === "reports" && mlContextReady && <ReportsView cameras={cameras} enterpriseName={displayName} reportsHistory={reportsHistory} setReportsHistory={setReportsHistory} />}
                {activeView === "help" && <HelpCenterView />}
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
        )}
      </main>

      <CriticalAlertToasts
        toasts={criticalToasts}
        onReview={(toast) => {
          navigateToView(toast.target);
          markNotificationsRead([toast]);
        }}
        onDismiss={(toastId) => setDismissedCriticalIds((current) => new Set([...current, toastId]))}
      />
    </div>
  );
}

const viewSkeletons: Record<EnterpriseView, { variant: ViewSkeletonVariant; label: string }> = {
  dashboard: { variant: "dashboard", label: "Loading dashboard" },
  cameras: { variant: "cameras", label: "Loading camera setup" },
  reports: { variant: "reports", label: "Loading reports" },
  notifications: { variant: "list", label: "Loading notifications" },
  help: { variant: "help", label: "Loading Help Center" },
  profile: { variant: "settings", label: "Loading settings" },
  security: { variant: "settings", label: "Loading settings" },
  tickets: { variant: "settings", label: "Loading settings" },
  settings: { variant: "settings", label: "Loading settings" },
};

/** A skeleton in the shape of the page that is loading, so the layout never jumps when it arrives. */
function EnterpriseViewLoadingFallback({ view }: { view: EnterpriseView }) {
  const { variant, label } = viewSkeletons[view];
  return <ViewSkeleton variant={variant} label={label} />;
}

function getEnterpriseCameraStorageKey(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  const scope = user?.enterpriseId || user?.id || user?.email || "anonymous";
  return `tanaw.enterprise.camera-configs:${scope.replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
}

function isScrollPosition(value: unknown): value is { top: number } {
  return Boolean(value && typeof value === "object" && "top" in value && typeof value.top === "number" && Number.isFinite(value.top));
}
