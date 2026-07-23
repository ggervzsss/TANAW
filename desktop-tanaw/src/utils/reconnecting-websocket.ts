type TimerHandle = number | ReturnType<typeof setTimeout>;

export type ReconnectingWebSocketOptions = {
  url: string;
  onOpen?: (socket: WebSocket) => void;
  onMessage?: (event: MessageEvent<string>, socket: WebSocket) => void;
  onClose?: () => void;
  createSocket?: (url: string) => WebSocket;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

export function createReconnectingWebSocket(options: ReconnectingWebSocketOptions) {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle as number));
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  let socket: WebSocket | null = null;
  let reconnectTimer: TimerHandle | undefined;
  let reconnectAttempt = 0;
  let disposed = false;

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== undefined) return;
    const delay = Math.min(initialDelayMs * 2 ** reconnectAttempt, maxDelayMs);
    reconnectAttempt += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (disposed || socket) return;

    let candidate: WebSocket;
    try {
      candidate = createSocket(options.url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = candidate;

    candidate.onopen = () => {
      if (disposed) {
        candidate.close();
        return;
      }
      if (socket !== candidate) return;
      reconnectAttempt = 0;
      options.onOpen?.(candidate);
    };
    candidate.onmessage = (event) => {
      if (!disposed && socket === candidate && typeof event.data === "string") {
        options.onMessage?.(event as MessageEvent<string>, candidate);
      }
    };
    candidate.onerror = () => {
      // Browsers follow errors with close. Calling close while CONNECTING creates
      // the noisy "closed before established" warning this controller prevents.
    };
    candidate.onclose = () => {
      if (socket !== candidate) return;
      socket = null;
      options.onClose?.();
      scheduleReconnect();
    };
  };

  connect();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (reconnectTimer !== undefined) {
        clearTimer(reconnectTimer);
        reconnectTimer = undefined;
      }
      const current = socket;
      socket = null;
      if (!current) return;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      if (current.readyState === 0) {
        current.onopen = () => current.close();
      } else if (current.readyState === 1) {
        current.close();
      }
    },
  };
}
