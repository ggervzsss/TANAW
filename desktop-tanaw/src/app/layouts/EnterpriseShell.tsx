import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CriticalAlertToasts } from "../../features/alerts/components/CriticalAlertToasts";
import { CameraManagementView } from "../../features/camera/components/CameraManagementView";
import { SimulationLab } from "../../features/camera/components/SimulationLab";
import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, getSimulationStatus, setMlEnterpriseContext } from "../../features/camera/services/ml-service";
import { DashboardView } from "../../features/dashboard/components/DashboardView";
import { getCurrentUser, logout as logoutRequest } from "../../features/login/api/login";
import { useAuthStore } from "../../features/login/stores/auth-store";
import { createWebSocketAuthMessage, getOperationalWebSocketUrl, listNotifications, updateNotificationRead, type BackendNotification, type OperationalNotificationEnvelope } from "../../features/notifications/services/notifications";
import { NotificationsView } from "../../features/notifications/components/NotificationsView";
import { ProfileView } from "../../features/profile/components/ProfileView";
import { ReportsView } from "../../features/reports/components/ReportsView";
import { SecurityView } from "../../features/security/components/SecurityView";
import { notifySuccess } from "../../features/toasts/services/toast-service";
import { applyThemePreference, getInitialThemePreference, persistThemePreference, resolveThemePreference } from "../../features/security/utils/theme";
import { useDesktopCloudSync } from "../../features/sync/hooks/useDesktopCloudSync";
import { TicketsView } from "../../features/tickets/components/TicketsView";
import { EMPTY_CAMERAS, EMPTY_REPORTS } from "../../lib/operationalDefaults";
import type { Camera as EnterpriseCamera, EnterpriseNotification, EnterpriseView, ReportRecord, ThemePreference } from "../../types/enterprise";
import { routePaths } from "../router/routePaths";
import { EnterpriseTopbar } from "./EnterpriseTopbar";

type EnterpriseShellProps = {
  initialView?: EnterpriseView;
};

const viewRouteById: Record<EnterpriseView, string> = {
  dashboard: routePaths.enterpriseDashboard,
  cameras: routePaths.enterpriseCameras,
  reports: routePaths.enterpriseReports,
  simulation: routePaths.enterpriseSimulation,
  profile: routePaths.enterpriseProfile,
  security: routePaths.enterpriseSecurity,
  notifications: routePaths.enterpriseNotifications,
  tickets: routePaths.enterpriseTickets,
};

const SIMULATION_UNLOCK_PHRASE = "simulation";
const SIMULATION_UNLOCK_STORAGE_KEY = "tanaw:simulation-route-unlock";

export function EnterpriseShell({ initialView = "dashboard" }: EnterpriseShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const updateUser = useAuthStore((state) => state.updateUser);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const typedBufferRef = useRef("");
  const [activeView, setActiveView] = useState<EnterpriseView>(initialView);
  const [isSimulationUnlocked, setIsSimulationUnlocked] = useState(() => initialView === "simulation" && window.sessionStorage.getItem(SIMULATION_UNLOCK_STORAGE_KEY) === "true");
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
  const [simulationNotification, setSimulationNotification] = useState<EnterpriseNotification | null>(null);
  const [backendNotifications, setBackendNotifications] = useState<BackendNotification[]>([]);
  const displayName = user?.enterpriseName ?? user?.name ?? "Enterprise User";
  const buildingCapacity = user?.buildingCapacity ?? 100;
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
    if (currentUserQuery.isError) {
      logout();
      navigate(routePaths.login, { replace: true });
    }
  }, [currentUserQuery.isError, logout, navigate]);

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
    typedBufferRef.current = "";

    if (initialView === "simulation") {
      const hasPendingUnlock = window.sessionStorage.getItem(SIMULATION_UNLOCK_STORAGE_KEY) === "true";
      window.sessionStorage.removeItem(SIMULATION_UNLOCK_STORAGE_KEY);
      if (!hasPendingUnlock) {
        setIsSimulationUnlocked(false);
        navigate(routePaths.enterpriseCameras, { replace: true });
        return;
      }
      setIsSimulationUnlocked(true);
      return;
    }

    window.sessionStorage.removeItem(SIMULATION_UNLOCK_STORAGE_KEY);
    setIsSimulationUnlocked(false);
  }, [initialView, navigate]);

  useEffect(() => {
    const handleSimulationShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const nextBuffer = `${typedBufferRef.current}${event.key.toLowerCase()}`.slice(-SIMULATION_UNLOCK_PHRASE.length);
      typedBufferRef.current = nextBuffer;

      if (nextBuffer === SIMULATION_UNLOCK_PHRASE) {
        setIsSimulationUnlocked(true);
        window.sessionStorage.setItem(SIMULATION_UNLOCK_STORAGE_KEY, "true");
        typedBufferRef.current = "";
      }
    };

    window.addEventListener("keydown", handleSimulationShortcut);
    return () => window.removeEventListener("keydown", handleSimulationShortcut);
  }, []);

  useEffect(() => {
    setCameras(EMPTY_CAMERAS);
    setReportsHistory(EMPTY_REPORTS);
    setBackendNotifications([]);
  }, [enterpriseCameraStorageKey]);

  useEffect(() => {
    if (!token) return undefined;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const refreshNotifications = async () => {
      try {
        const nextNotifications = await listNotifications();
        if (!disposed) setBackendNotifications(nextNotifications);
      } catch {
        if (!disposed) setBackendNotifications([]);
      }
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      clearHeartbeat();
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }

      socket = new WebSocket(getOperationalWebSocketUrl());

      socket.onopen = () => {
        reconnectAttempt = 0;
        const authMessage = createWebSocketAuthMessage();
        if (authMessage) socket?.send(authMessage);
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        const envelope = parseNotificationEnvelope(event.data);
        if (!envelope) return;
        setBackendNotifications((current) => upsertBackendNotification(current, envelope.data));
      };

      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        clearHeartbeat();
        scheduleReconnect();
      };
    };

    void refreshNotifications();
    connect();
    const refreshIntervalId = window.setInterval(() => void refreshNotifications(), 30000);

    return () => {
      disposed = true;
      window.clearInterval(refreshIntervalId);
      clearHeartbeat();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token]);

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

  useEffect(() => {
    if (!mlContextReady) {
      setSimulationNotification(null);
      return undefined;
    }

    let disposed = false;
    const refreshSimulationAlert = async () => {
      try {
        const status = await getMlServiceStatus();
        const simulation = await getSimulationStatus(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
        if (disposed) return;

        const occupancyPercent = simulation.capacity > 0 ? Math.round((simulation.current_occupancy / simulation.capacity) * 100) : 0;
        if (!simulation.mock_run_id || !simulation.scenario || occupancyPercent < simulation.threshold_percent) {
          setSimulationNotification(null);
          return;
        }

        const source = `simulation:${simulation.mock_run_id}:occupancy-threshold`;
        setSimulationNotification({
          id: stableNotificationId(source),
          type: "critical",
          message: `Live occupancy reached ${simulation.current_occupancy} of ${simulation.capacity} people (${occupancyPercent}%), above the ${simulation.threshold_percent}% alert threshold.`,
          time: simulation.started_at ?? new Date().toISOString(),
          read: false,
          target: "cameras",
        });
      } catch {
        if (!disposed) setSimulationNotification(null);
      }
    };

    void refreshSimulationAlert();
    const intervalId = window.setInterval(() => void refreshSimulationAlert(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [mlContextReady]);

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } finally {
      window.sessionStorage.removeItem(SIMULATION_UNLOCK_STORAGE_KEY);
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
    setTheme((currentTheme) => (resolveThemePreference(currentTheme) === "dark" ? "light" : "dark"));
  };

  const notifications = useMemo(
    () => buildEnterpriseNotifications(reportsHistory, readNotificationIds, simulationNotification, backendNotifications),
    [backendNotifications, readNotificationIds, reportsHistory, simulationNotification],
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
    <div className="enterprise-shell relative flex h-screen flex-col overflow-hidden bg-[#eef5f0] font-['Montserrat'] transition-colors duration-300 dark:bg-[#0b1120]">
      <EnterpriseTopbar
        activeView={activeView}
        displayName={displayName}
        initials={initials}
        isNotificationsOpen={isNotificationsOpen}
        notifications={notifications}
        resolvedTheme={resolvedTheme}
        showSimulation={isSimulationUnlocked}
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
          className={`flex-1 bg-[#f4f8f5] transition-colors duration-300 dark:bg-[#0f172a] ${activeView === "cameras" || activeView === "simulation" ? "overflow-hidden p-4 max-xl:p-3" : "overflow-auto p-8 max-xl:p-6 max-sm:p-4"}`}
        >
          <div className={`mx-auto max-w-470 ${activeView === "cameras" || activeView === "simulation" ? "h-full min-h-0" : ""}`}>
            {activeView === "dashboard" && mlContextReady && <DashboardView />}
            {activeView === "cameras" && mlContextReady && <CameraManagementView key={enterpriseCameraStorageKey} cameras={cameras} setCameras={setCameras} storageKey={enterpriseCameraStorageKey} />}
            {activeView === "reports" && mlContextReady && <ReportsView reportsHistory={reportsHistory} setReportsHistory={setReportsHistory} />}
            {activeView === "simulation" && isSimulationUnlocked && mlContextReady && <SimulationLab baseUrl={mlBaseUrl} defaultBuildingCapacity={buildingCapacity} />}
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

function buildEnterpriseNotifications(
  reportsHistory: ReportRecord[],
  readNotificationIds: Set<number>,
  simulationNotification: EnterpriseNotification | null,
  backendNotifications: BackendNotification[],
) {
  const persistedNotifications = backendNotifications.map((notification) => backendNotificationToEnterpriseNotification(notification, readNotificationIds));
  return [...persistedNotifications, ...reportsHistory.flatMap((report) => buildReportNotifications(report)), ...(simulationNotification ? [simulationNotification] : [])]
    .sort((left, right) => getNotificationSortValue(right) - getNotificationSortValue(left))
    .map((notification) => ({
      ...notification,
      read: notification.read || readNotificationIds.has(notification.id),
    }));
}

function backendNotificationToEnterpriseNotification(notification: BackendNotification, readNotificationIds: Set<number>): EnterpriseNotification {
  const id = stableNotificationId(`backend-notification:${notification.id}`);
  return {
    id,
    backendId: notification.id,
    type: notificationTypeFromSeverity(notification.severity),
    message: `${notification.title}: ${notification.message}`,
    time: formatNotificationDate(notification.createdAt),
    read: Boolean(notification.readAt) || readNotificationIds.has(id),
    target: notificationTarget(notification),
  };
}

function buildReportNotifications(report: ReportRecord): EnterpriseNotification[] {
  const notifications: EnterpriseNotification[] = [];
  const deadline = getReportDeadline(report);
  const isSubmitted = ["Submitted", "Resubmitted", "Consolidated"].includes(report.status);

  if (deadline && !isSubmitted) {
    const deadlineDate = Date.parse(deadline);
    if (Number.isFinite(deadlineDate)) {
      const daysUntilDeadline = Math.ceil((deadlineDate - Date.now()) / 86_400_000);
      if (daysUntilDeadline < 0) {
        notifications.push(createReportNotification(report, "critical", `${report.id} is overdue for ${formatNotificationDate(deadline)}.`, deadline));
      } else if (daysUntilDeadline <= 3) {
        notifications.push(
          createReportNotification(report, "warning", `${report.id} is due ${daysUntilDeadline === 0 ? "today" : `in ${daysUntilDeadline} day${daysUntilDeadline === 1 ? "" : "s"}`}.`, deadline),
        );
      }
    }
  }

  if (report.status === "Returned for Revision") {
    notifications.push(createReportNotification(report, "warning", `${report.id} was returned for revision. ${report.remarks ?? "Please review the ledger remarks."}`, getLatestAuditTime(report)));
  }

  if (report.status === "Draft") {
    notifications.push(createReportNotification(report, "warning", `${report.id} is still a draft for ${report.period ?? report.date}.`, getLatestAuditTime(report)));
  }

  if (report.status === "Submitted" || report.status === "Resubmitted") {
    notifications.push(createReportNotification(report, "success", `${report.id} was ${report.status.toLowerCase()} for ${report.period ?? report.date}.`, getLatestAuditTime(report)));
  }

  return notifications;
}

function createReportNotification(report: ReportRecord, type: EnterpriseNotification["type"], message: string, timeSource?: string): EnterpriseNotification {
  const source = `report:${report.id}:${report.status}:${timeSource ?? report.date}`;
  return {
    id: stableNotificationId(source),
    type,
    message,
    time: formatNotificationDate(timeSource ?? report.date),
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
  const parsed = Date.parse(notification.time);
  return Number.isFinite(parsed) ? parsed : notification.id;
}

function formatNotificationDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function stableNotificationId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseNotificationEnvelope(value: string): OperationalNotificationEnvelope | null {
  try {
    const parsed = JSON.parse(value) as OperationalNotificationEnvelope;
    if (parsed.type === "notification.created" || parsed.type === "notification.updated") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
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
