export type SessionSyncEvent =
  | { type: "activity"; occurredAt: number }
  | { type: "logout"; occurredAt: number };

const SESSION_CHANNEL = "tanaw-auth-session";
const SESSION_EVENT_STORAGE_KEY = "tanaw-auth-session-event";
export const SESSION_LAST_ACTIVITY_KEY = "tanaw-auth-last-activity";

export function publishSessionEvent(event: SessionSyncEvent) {
  const payload = JSON.stringify({ ...event, nonce: crypto.randomUUID() });
  localStorage.setItem(SESSION_EVENT_STORAGE_KEY, payload);

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.postMessage(event);
    channel.close();
  }
}

export function subscribeToSessionEvents(listener: (event: SessionSyncEvent) => void) {
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SESSION_CHANNEL) : null;
  const onChannelMessage = (message: MessageEvent<SessionSyncEvent>) => listener(message.data);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_EVENT_STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as SessionSyncEvent;
      if (parsed.type === "activity" || parsed.type === "logout") listener(parsed);
    } catch {
      // Ignore malformed values written by other applications or old builds.
    }
  };

  channel?.addEventListener("message", onChannelMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.removeEventListener("message", onChannelMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
