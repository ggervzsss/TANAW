import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { staffApi } from "../../lib/axios";
import { useAuthStore } from "../login/stores/auth-store";
import { RealtimeContext, type RealtimeListener } from "./realtime-context";
import { isRealtimeEnvelope, realtimeOrderingKey, type RealtimeConnectionState, type RealtimeEnvelope } from "./types";

const MAX_DEDUPLICATION_EVENTS = 2_048;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function RealtimeProvider({ children }: PropsWithChildren) {
  const authStatus = useAuthStore((state) => state.status);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeConnectionState>("closed");
  const listeners = useRef(new Set<RealtimeListener>());
  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || !token) {
      setState("closed");
      return undefined;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let disposed = false;
    let lastHeartbeatAt = Date.now();
    let heartbeatTimeoutMs = 75_000;
    const eventIds = new Set<string>();
    const eventIdOrder: string[] = [];
    const latestSequenceByEntity = new Map<string, number>();

    const closeSocket = () => {
      const current = socket;
      socket = null;
      if (!current) return;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      if (current.readyState === WebSocket.CONNECTING) {
        current.onopen = () => current.close(1000);
      } else if (current.readyState === WebSocket.OPEN) {
        current.close(1000);
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined || !navigator.onLine) return;
      const baseDelay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
      const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      reconnectAttempt += 1;
      setState("reconnecting");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const resynchronize = () => {
      setState("resynchronizing");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enterprise-current-user"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["system-settings"], refetchType: "active" }),
      ]).finally(() => {
        if (!disposed && socket?.readyState === WebSocket.OPEN) setState("connected");
      });
    };

    const applyEvent = (event: RealtimeEnvelope) => {
      if (eventIds.has(event.event_id)) return;
      const orderingKey = realtimeOrderingKey(event);
      if (event.sequence <= (latestSequenceByEntity.get(orderingKey) ?? 0)) return;
      latestSequenceByEntity.set(orderingKey, event.sequence);
      eventIds.add(event.event_id);
      eventIdOrder.push(event.event_id);
      if (eventIdOrder.length > MAX_DEDUPLICATION_EVENTS) eventIds.delete(eventIdOrder.shift()!);
      if (["account_request.", "enterprise.", "user."].some((prefix) => event.event_type.startsWith(prefix))) {
        void queryClient.invalidateQueries({ queryKey: ["enterprise-current-user"], refetchType: "active" });
      }
      if (event.event_type === "system_setting.updated") {
        void queryClient.invalidateQueries({ queryKey: ["system-settings"], refetchType: "active" });
      }
      listeners.current.forEach((listener) => listener(event));
    };

    const connect = () => {
      if (disposed || socket || !navigator.onLine) return;
      setState(reconnectAttempt ? "reconnecting" : "connecting");
      const candidate = new WebSocket(getRealtimeUrl());
      socket = candidate;
      candidate.onopen = () => {
        if (disposed || socket !== candidate) {
          candidate.close(1000);
          return;
        }
        lastHeartbeatAt = Date.now();
        candidate.send(JSON.stringify({ type: "auth", token }));
      };
      candidate.onmessage = (message) => {
        if (socket !== candidate || typeof message.data !== "string") return;
        let value: unknown;
        try {
          value = JSON.parse(message.data);
        } catch {
          return;
        }
        lastHeartbeatAt = Date.now();
        if (isRealtimeEnvelope(value)) {
          applyEvent(value);
          return;
        }
        if (!value || typeof value !== "object") return;
        const type = (value as { type?: unknown }).type;
        if (type === "realtime.ready") {
          const heartbeatSeconds = (value as { heartbeat_seconds?: unknown }).heartbeat_seconds;
          heartbeatTimeoutMs = (typeof heartbeatSeconds === "number" ? heartbeatSeconds : 30) * 2_500;
          reconnectAttempt = 0;
          resynchronize();
        } else if (type === "realtime.heartbeat") {
          candidate.send(JSON.stringify({ type: "realtime.pong" }));
        } else if (type === "realtime.resync_required") {
          resynchronize();
        }
      };
      candidate.onerror = () => undefined;
      candidate.onclose = (event) => {
        if (socket !== candidate) return;
        socket = null;
        if (disposed) return;
        if (event.code === 4401) {
          setState("unauthorized");
          useAuthStore.getState().markAnonymous();
          return;
        }
        scheduleReconnect();
      };
    };

    const handleOffline = () => {
      setState("offline");
      closeSocket();
    };
    const handleOnline = () => {
      reconnectAttempt = 0;
      connect();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    const heartbeatTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) {
        closeSocket();
        scheduleReconnect();
      }
    }, 5_000);
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      closeSocket();
    };
  }, [authStatus, queryClient, token]);

  const value = useMemo(() => ({ state, subscribe }), [state, subscribe]);
  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <RealtimeStatus state={state} />
    </RealtimeContext.Provider>
  );
}

function getRealtimeUrl() {
  const url = new URL(staffApi.defaults.baseURL ?? "http://localhost:8000");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/realtime/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function RealtimeStatus({ state }: { state: RealtimeConnectionState }) {
  if (!["offline", "reconnecting", "resynchronizing"].includes(state)) return null;
  let label = "Live updates paused. Reconnecting...";
  if (state === "offline") label = "Live updates paused while offline";
  if (state === "resynchronizing") label = "Restoring live updates...";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-2000 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/95 px-4 py-2 text-xs font-bold text-amber-800 shadow-lg backdrop-blur dark:border-amber-300/25 dark:bg-slate-900/95 dark:text-amber-200"
    >
      <WifiOff size={14} aria-hidden="true" />
      {label}
    </div>
  );
}
