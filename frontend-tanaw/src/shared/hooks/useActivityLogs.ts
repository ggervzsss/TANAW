import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "@/app/store/authStore";
import { MANDATORY_UPGRADE_WEBSOCKET_CODE } from "../config/client-generation";
import { createWebSocketAuthMessage, getActivityLogsWebSocketUrl, listActivityLogs } from "../services/activityLogs";
import type { SystemLog } from "../types";

export const activityLogsQueryKey = ["activity-logs"];

export function useActivityLogs() {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: activityLogsQueryKey, queryFn: listActivityLogs, enabled: Boolean(token) });

  useEffect(() => {
    if (!token) return undefined;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;
    let closedByEffect = false;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (closedByEffect) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
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
      socket = new WebSocket(getActivityLogsWebSocketUrl());

      socket.onopen = () => {
        reconnectAttempt = 0;
        socket?.send(createWebSocketAuthMessage(token));
        void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 25000);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") return;

        const log = JSON.parse(event.data) as SystemLog;
        queryClient.setQueryData<SystemLog[]>(activityLogsQueryKey, (current = []) => {
          if (current.some((item) => item.id === log.id)) return current;
          return [log, ...current];
        });
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = (event) => {
        clearHeartbeat();
        void queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
        if (event.code === MANDATORY_UPGRADE_WEBSOCKET_CODE) {
          window.location.reload();
          return;
        }
        scheduleReconnect();
      };
    };

    const initialConnectTimer = window.setTimeout(connect, 0);

    return () => {
      closedByEffect = true;
      clearHeartbeat();
      window.clearTimeout(initialConnectTimer);
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      closeSocket();
    };
  }, [queryClient, token]);

  return {
    ...query,
    logs: query.data ?? [],
  };
}
