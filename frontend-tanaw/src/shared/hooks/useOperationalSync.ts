import { QueryClient, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import toast from "react-hot-toast/headless";
import { useAuthStore } from "@/app/store/authStore";
import {
  createWebSocketAuthMessage,
  getOperationalSummary,
  getOperationalWebSocketUrl,
  listFinalReports,
  listIntakeReports,
  listLatestTelemetry,
  listOperationalMapEnterprises,
  listUserNotifications,
  type BackendNotification,
  type OperationalWebSocketEnvelope,
} from "../services/operationalSync";
import type { AuthUser, FinalReport, IntakeReport, OperationalSummary, PriorityAlert, TelemetrySnapshot } from "../types";

const RECONCILIATION_INTERVAL_MS = 30_000;

export const operationalSummaryQueryKey = ["operational", "summary"] as const;
export const operationalTelemetryQueryKey = ["operational", "telemetry", "latest"] as const;
export const operationalReportsQueryKey = ["operational", "reports", "intake"] as const;
export const operationalFinalReportsQueryKey = ["operational", "reports", "final"] as const;
export const operationalMapEnterprisesQueryKey = ["operational", "sites", "v2"] as const;
export const operationalNotificationsQueryKey = ["operational", "notifications"] as const;
const operationalAlertsQueryKey = ["operational-alerts"] as const;

type OperationalQueryKeys = {
  summary: QueryKey;
  telemetry: QueryKey;
  reports: QueryKey;
  finalReports: QueryKey;
  mapEnterprises: QueryKey;
  notifications: QueryKey;
  alerts: QueryKey;
};

/** Builds protected keys without placing the bearer token in React Query state. */
export function createOperationalQueryKeys(user: AuthUser | null): OperationalQueryKeys {
  const scope = {
    accountId: user?.id ?? "anonymous",
    role: user?.role ?? "anonymous",
    enterpriseId: user?.enterpriseId ?? null,
  } as const;

  return {
    summary: [...operationalSummaryQueryKey, scope],
    telemetry: [...operationalTelemetryQueryKey, scope],
    reports: [...operationalReportsQueryKey, scope],
    finalReports: [...operationalFinalReportsQueryKey, scope],
    mapEnterprises: [...operationalMapEnterprisesQueryKey, scope],
    notifications: [...operationalNotificationsQueryKey, scope],
    alerts: [...operationalAlertsQueryKey, scope],
  };
}

export function useOperationalSummary() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.summary, queryFn: getOperationalSummary, enabled: Boolean(token && user) });
}

export function useOperationalTelemetry() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.telemetry, queryFn: listLatestTelemetry, enabled: Boolean(token && user) });
}

export function useOperationalReports() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.reports, queryFn: listIntakeReports, enabled: Boolean(token && user) });
}

export function useOperationalFinalReports() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.finalReports, queryFn: listFinalReports, enabled: Boolean(token && user) });
}

export function useOperationalMapEnterprises() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.mapEnterprises, queryFn: listOperationalMapEnterprises, enabled: Boolean(token && user), refetchInterval: RECONCILIATION_INTERVAL_MS });
}

export function useOperationalNotifications() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const keys = createOperationalQueryKeys(user);
  return useQuery({ queryKey: keys.notifications, queryFn: listUserNotifications, enabled: Boolean(token && user), refetchInterval: RECONCILIATION_INTERVAL_MS });
}

export function OperationalSyncBridge() {
  useOperationalSyncSocket();
  return null;
}

function useOperationalSyncSocket() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const accountScope = getAccountScope(user);

  useEffect(() => {
    if (!token || !user || !accountScope) return undefined;

    const keys = createOperationalQueryKeys(user);
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;
    let closedByEffect = false;

    const isCurrentSession = () => {
      const current = useAuthStore.getState();
      return current.token === token && getAccountScope(current.user) === accountScope;
    };

    const reconcile = () => {
      void queryClient.invalidateQueries({ queryKey: ["operational"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: operationalAlertsQueryKey, refetchType: "active" });
    };
    const reconciliationTimer = window.setInterval(reconcile, RECONCILIATION_INTERVAL_MS);

    const clearHeartbeat = () => {
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (closedByEffect || !isCurrentSession()) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const closeSocket = () => {
      const currentSocket = socket;
      socket = null;
      if (!currentSocket) return;

      currentSocket.onmessage = null;
      currentSocket.onclose = null;
      currentSocket.onerror = null;
      if (currentSocket.readyState === WebSocket.CONNECTING) {
        currentSocket.onopen = () => currentSocket.close();
        return;
      }
      currentSocket.onopen = null;
      if (currentSocket.readyState === WebSocket.OPEN) {
        currentSocket.close();
      }
    };

    const connect = () => {
      clearHeartbeat();
      if (socket) {
        closeSocket();
      }

      socket = new WebSocket(getOperationalWebSocketUrl());

      socket.onopen = () => {
        if (!isCurrentSession()) {
          socket?.close();
          return;
        }
        reconnectAttempt = 0;
        socket?.send(createWebSocketAuthMessage(token));
        reconcile();
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 25_000);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong" || !isCurrentSession()) return;
        handleOperationalEnvelope(queryClient, keys, event.data);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        clearHeartbeat();
        reconcile();
        scheduleReconnect();
      };
    };

    const initialConnectTimer = window.setTimeout(connect, 0);

    return () => {
      closedByEffect = true;
      clearHeartbeat();
      window.clearInterval(reconciliationTimer);
      window.clearTimeout(initialConnectTimer);
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      closeSocket();
    };
  }, [accountScope, queryClient, token, user]);
}

export function handleOperationalEnvelope(queryClient: QueryClient, keys: OperationalQueryKeys, rawData: string) {
  let envelope: OperationalWebSocketEnvelope;
  try {
    envelope = JSON.parse(rawData) as OperationalWebSocketEnvelope;
  } catch {
    return;
  }

  if (envelope.type === "resource.invalidated") {
    const resourceType = envelope.data.resource.type;
    if (resourceType === "site_live_state") {
      invalidate(queryClient, keys.mapEnterprises, keys.telemetry, keys.summary);
      return;
    }
    if (resourceType === "enterprise_report" || resourceType === "final_report") {
      invalidate(queryClient, operationalReportsQueryKey, operationalFinalReportsQueryKey, operationalSummaryQueryKey);
      return;
    }
    if (resourceType === "reporting_period_compliance" || resourceType === "reporting_obligation") {
      invalidate(queryClient, operationalReportsQueryKey, operationalNotificationsQueryKey);
      return;
    }
    return;
  }

  if (envelope.type === "telemetry.snapshot") {
    const snapshot = envelope.data;
    const patchedTelemetry = patchExistingList(queryClient, keys.telemetry, snapshot, upsertTelemetrySnapshot);
    if (!patchedTelemetry) invalidate(queryClient, keys.telemetry);
    return;
  }

  if (envelope.type === "summary.updated") {
    patchSummary(queryClient, keys.summary, envelope.data);
    return;
  }

  if (envelope.type === "report.submitted" || envelope.type === "report.updated") {
    patchExistingList(queryClient, keys.reports, envelope.data, (current, report) => sortReports(upsertById(current, report, getReportTime)));
    invalidate(queryClient, operationalReportsQueryKey, operationalFinalReportsQueryKey, operationalSummaryQueryKey);
    return;
  }

  if (envelope.type === "final_report.generated" || envelope.type === "final_report.updated") {
    patchExistingList(queryClient, keys.finalReports, envelope.data, (current, report) => sortFinalReports(upsertById(current, report, getFinalReportTime)));
    invalidate(queryClient, operationalReportsQueryKey, operationalFinalReportsQueryKey, operationalSummaryQueryKey);
    return;
  }

  if (envelope.type === "alert.created" || envelope.type === "alert.updated" || envelope.type === "alert.resolved") {
    const alert = envelope.data;
    patchExistingList(queryClient, keys.alerts, alert, (current, nextAlert) => sortAlerts(upsertById(current, nextAlert, getAlertTime)));
    invalidate(queryClient, operationalAlertsQueryKey);
    if (envelope.type === "alert.created") {
      toast.error(`${alert.enterprise ?? alert.requester}: ${alert.summary}`, { id: alert.id, duration: 8000 });
    }
    return;
  }

  if (envelope.type === "notification.created" || envelope.type === "notification.updated") {
    patchExistingList(queryClient, keys.notifications, envelope.data, (current, notification) => sortNotifications(upsertById(current, notification, getNotificationTime)));
    invalidate(queryClient, operationalNotificationsQueryKey);
  }
}

function patchExistingData<TData>(queryClient: QueryClient, queryKey: QueryKey, updater: (current: TData) => TData) {
  if (queryClient.getQueryData<TData>(queryKey) === undefined) return false;
  queryClient.setQueryData<TData>(queryKey, (current) => (current === undefined ? current : updater(current)));
  return true;
}

function patchExistingList<TItem>(queryClient: QueryClient, queryKey: QueryKey, nextItem: TItem, updater: (current: TItem[], next: TItem) => TItem[]) {
  return patchExistingData(queryClient, queryKey, (current: TItem[]) => updater(current, nextItem));
}

function invalidate(queryClient: QueryClient, ...queryKeys: QueryKey[]) {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function upsertById<TItem extends { id: string }>(items: TItem[], nextItem: TItem, getTime: (item: TItem) => number) {
  const existing = items.find((item) => item.id === nextItem.id);
  if (!existing) return [nextItem, ...items];
  if (getTime(nextItem) < getTime(existing)) return items;
  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

function upsertTelemetrySnapshot(items: TelemetrySnapshot[], nextItem: TelemetrySnapshot) {
  const existing = items.find((item) => item.enterpriseId === nextItem.enterpriseId);
  if (!existing) return [nextItem, ...items];
  if (getTelemetryTime(nextItem) < getTelemetryTime(existing)) return items;
  return items.map((item) => (item.enterpriseId === nextItem.enterpriseId ? nextItem : item));
}

function sortReports(reports: IntakeReport[]) {
  return [...reports].sort((left, right) => getReportTime(right) - getReportTime(left));
}

function sortFinalReports(reports: FinalReport[]) {
  return [...reports].sort((left, right) => getFinalReportTime(right) - getFinalReportTime(left));
}

function sortAlerts(alerts: PriorityAlert[]) {
  return [...alerts].sort((left, right) => getAlertTime(right) - getAlertTime(left));
}

function sortNotifications(notifications: BackendNotification[]) {
  return [...notifications].sort((left, right) => getNotificationTime(right) - getNotificationTime(left));
}

function getTelemetryTime(snapshot: TelemetrySnapshot) {
  return getTimestamp(snapshot.receivedAt, snapshot.capturedAt);
}

function getReportTime(report: IntakeReport) {
  return getTimestamp(report.submittedAt, report.submitted);
}

function getFinalReportTime(report: FinalReport) {
  return getTimestamp(report.generatedOn);
}

function getAlertTime(alert: PriorityAlert) {
  return getTimestamp(alert.time);
}

function getNotificationTime(notification: BackendNotification) {
  return getTimestamp(notification.createdAt);
}

function getTimestamp(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function getAccountScope(user: AuthUser | null) {
  return user ? `${user.id}:${user.role}:${user.enterpriseId ?? "-"}` : null;
}

function patchSummary(queryClient: QueryClient, queryKey: QueryKey, summary: OperationalSummary) {
  const current = queryClient.getQueryData<OperationalSummary>(queryKey);
  if (current && getTimestamp(summary.lastSyncAt) < getTimestamp(current.lastSyncAt)) return;
  queryClient.setQueryData(queryKey, summary);
}
