import { type PropsWithChildren, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useAuthStore } from "@/app/store/authStore";
import { getWebSocketUrl } from "@/shared/config/api.config";
import { resynchronizeActiveRealtimeQueries, routeRealtimeEvent } from "./eventRouter";
import { isRealtimeEnvelope, realtimeOrderingKey, type RealtimeConnectionState, type RealtimeEnvelope } from "./types";

const MAX_DEDUPLICATION_EVENTS = 2_048;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_WATCH_INTERVAL_MS = 5_000;

export function RealtimeProvider({ children }: PropsWithChildren) {
  const authStatus = useAuthStore((state) => state.status);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeConnectionState>("closed");

  useEffect(() => {
    if (authStatus !== "authenticated" || !token) {
      return undefined;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatWatchTimer: number | undefined;
    let reconnectAttempt = 0;
    let disposed = false;
    let intentionalClose = false;
    let lastHeartbeatAt = Date.now();
    let heartbeatTimeoutMs = 75_000;
    const eventIds = new Set<string>();
    const eventIdOrder: string[] = [];
    const latestSequenceByEntity = new Map<string, number>();

    const clearTimers = () => {
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (heartbeatWatchTimer !== undefined) window.clearInterval(heartbeatWatchTimer);
      reconnectTimer = undefined;
      heartbeatWatchTimer = undefined;
    };

    const closeCurrentSocket = () => {
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
      if (disposed || intentionalClose || reconnectTimer !== undefined || !navigator.onLine) return;
      const baseDelay = Math.min(1000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
      const jitteredDelay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      reconnectAttempt += 1;
      setState("reconnecting");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, jitteredDelay);
    };

    const applyEvent = (event: RealtimeEnvelope) => {
      if (eventIds.has(event.event_id)) return;
      const orderingKey = realtimeOrderingKey(event);
      const latestSequence = latestSequenceByEntity.get(orderingKey) ?? 0;
      if (event.sequence <= latestSequence) return;
      latestSequenceByEntity.set(orderingKey, event.sequence);
      eventIds.add(event.event_id);
      eventIdOrder.push(event.event_id);
      if (eventIdOrder.length > MAX_DEDUPLICATION_EVENTS) {
        eventIds.delete(eventIdOrder.shift()!);
      }
      void routeRealtimeEvent(queryClient, event);
    };

    const handleProtocolMessage = (value: unknown, currentSocket: WebSocket) => {
      if (!value || typeof value !== "object") return;
      const type = (value as { type?: unknown }).type;
      if (type === "realtime.ready") {
        const heartbeatSeconds = (value as { heartbeat_seconds?: unknown }).heartbeat_seconds;
        heartbeatTimeoutMs = (typeof heartbeatSeconds === "number" ? heartbeatSeconds : 30) * 2_500;
        lastHeartbeatAt = Date.now();
        reconnectAttempt = 0;
        setState("resynchronizing");
        void resynchronizeActiveRealtimeQueries(queryClient).finally(() => {
          if (!disposed && socket === currentSocket) setState("connected");
        });
        return;
      }
      if (type === "realtime.heartbeat") {
        lastHeartbeatAt = Date.now();
        if (currentSocket.readyState === WebSocket.OPEN) {
          currentSocket.send(JSON.stringify({ type: "realtime.pong" }));
        }
        return;
      }
      if (type === "realtime.resync_required") {
        setState("resynchronizing");
        void resynchronizeActiveRealtimeQueries(queryClient).finally(() => {
          if (!disposed && socket === currentSocket) setState("connected");
        });
      }
    };

    const connect = () => {
      if (disposed || socket || !navigator.onLine) return;
      setState(reconnectAttempt > 0 ? "reconnecting" : "connecting");
      const candidate = new WebSocket(getWebSocketUrl("/realtime/ws"));
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
        } else {
          handleProtocolMessage(value, candidate);
        }
      };
      candidate.onerror = () => {
        // The close event owns retry behavior and normalized user-facing state.
      };
      candidate.onclose = (event) => {
        if (socket !== candidate) return;
        socket = null;
        if (disposed || intentionalClose) return;
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
      closeCurrentSocket();
    };
    const handleOnline = () => {
      reconnectAttempt = 0;
      connect();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) {
        closeCurrentSocket();
        scheduleReconnect();
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    heartbeatWatchTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) {
        closeCurrentSocket();
        scheduleReconnect();
      }
    }, HEARTBEAT_WATCH_INTERVAL_MS);
    connect();

    return () => {
      disposed = true;
      intentionalClose = true;
      clearTimers();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeCurrentSocket();
    };
  }, [authStatus, queryClient, token]);

  return (
    <>
      {children}
      <RealtimeStatus state={authStatus === "authenticated" ? state : "closed"} />
    </>
  );
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
