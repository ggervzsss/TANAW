import { QueryClient, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { createWebSocketAuthMessage, getOperationalWebSocketUrl, listOperationalMapEnterprises, listUserNotifications, type OperationalWebSocketEnvelope } from "../services/operationalSync";
import { reportWorkflowQueryKey } from "../services/reporting";
import type { AuthUser } from "../types";

const RECONCILIATION_INTERVAL_MS = 30_000;

export const operationalMapEnterprisesQueryKey = ["operational", "sites", "v2"] as const;
export const operationalNotificationsQueryKey = ["operational", "notifications"] as const;
const operationalAlertsQueryKey = ["operational-alerts"] as const;

type OperationalQueryKeys = {
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
    mapEnterprises: [...operationalMapEnterprisesQueryKey, scope],
    notifications: [...operationalNotificationsQueryKey, scope],
    alerts: [...operationalAlertsQueryKey, scope],
  };
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
    if (envelope.data.contractVersion !== 2 || envelope.data.refetchRequired !== true || envelope.data.scope.classification !== "official") return;
    const resourceType = envelope.data.resource.type;
    if (resourceType === "site_live_state") {
      invalidate(queryClient, keys.mapEnterprises);
      return;
    }
    if (resourceType === "operational_alert") {
      invalidate(queryClient, keys.alerts);
      return;
    }
    if (resourceType === "user_notification") {
      invalidate(queryClient, keys.notifications, operationalNotificationsQueryKey);
      return;
    }
    if (resourceType === "enterprise_report" || resourceType === "final_report" || resourceType === "reporting_period_compliance" || resourceType === "reporting_obligation") {
      invalidate(queryClient, reportWorkflowQueryKey, operationalNotificationsQueryKey);
      return;
    }
  }
}

function invalidate(queryClient: QueryClient, ...queryKeys: QueryKey[]) {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function getAccountScope(user: AuthUser | null) {
  return user ? `${user.id}:${user.role}:${user.enterpriseId ?? "-"}` : null;
}
