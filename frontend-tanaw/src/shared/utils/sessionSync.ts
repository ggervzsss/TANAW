export type SessionSyncEvent = { type: "logout"; occurredAt: number };

const SESSION_CHANNEL = "tanaw-auth-session";
const SESSION_EVENT_STORAGE_KEY = "tanaw-auth-session-event";

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
  const onChannelMessage = (message: MessageEvent<unknown>) => {
    if (isSessionSyncEvent(message.data)) listener(message.data);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_EVENT_STORAGE_KEY || !event.newValue) return;
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      if (isSessionSyncEvent(parsed)) listener(parsed);
    } catch {
      // Ignore malformed values that do not match TANAW's session payload.
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

function isSessionSyncEvent(value: unknown): value is SessionSyncEvent {
  return Boolean(value && typeof value === "object" && "type" in value && value.type === "logout" && "occurredAt" in value && typeof value.occurredAt === "number");
}
