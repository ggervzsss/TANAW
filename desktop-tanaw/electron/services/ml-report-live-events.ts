import { ML_REPORT_LIVE_EVENT_CHANNELS, parseMlReportLiveEvent, type MlReportLiveEvent } from "../../src/types/ml-report-live-events";

type TimerHandle = ReturnType<typeof setTimeout>;

type MlReportLiveEventStreamOptions = {
  accessToken: string;
  baseUrl: string;
  clearTimer?: (handle: TimerHandle) => void;
  createSocket?: (url: string) => WebSocket;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
};

export type ReportEventSubscriber = {
  isDestroyed: () => boolean;
  off: (event: "destroyed", listener: () => void) => unknown;
  once: (event: "destroyed", listener: () => void) => unknown;
  send: (channel: string, event: MlReportLiveEvent) => unknown;
};

export class MlReportLiveEventStream {
  readonly #accessToken: string;
  readonly #baseUrl: string;
  readonly #clearTimer: (handle: TimerHandle) => void;
  readonly #createSocket: (url: string) => WebSocket;
  readonly #initialReconnectDelayMs: number;
  readonly #maxReconnectDelayMs: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #subscribers = new Set<ReportEventSubscriber>();
  readonly #destroyListeners = new Map<ReportEventSubscriber, () => void>();
  #disposed = false;
  #permanentFailure = false;
  #reconnectAttempt = 0;
  #reconnectTimer: TimerHandle | undefined;
  #socket: WebSocket | null = null;

  constructor(options: MlReportLiveEventStreamOptions) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.#initialReconnectDelayMs = options.initialReconnectDelayMs ?? 1000;
    this.#maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.#setTimer = options.setTimer ?? setTimeout;
  }

  subscribe(subscriber: ReportEventSubscriber) {
    if (this.#disposed || subscriber.isDestroyed() || this.#subscribers.has(subscriber)) return;

    const removeDestroyedSubscriber = () => this.unsubscribe(subscriber);
    this.#subscribers.add(subscriber);
    this.#destroyListeners.set(subscriber, removeDestroyedSubscriber);
    subscriber.once("destroyed", removeDestroyedSubscriber);
    this.#connect();
  }

  unsubscribe(subscriber: ReportEventSubscriber) {
    if (!this.#subscribers.delete(subscriber)) return;
    const destroyListener = this.#destroyListeners.get(subscriber);
    if (destroyListener) {
      subscriber.off("destroyed", destroyListener);
      this.#destroyListeners.delete(subscriber);
    }
    if (this.#subscribers.size === 0) this.#disconnect();
  }

  reconnectAfterServiceRestart() {
    if (this.#disposed) return;
    this.#disconnect();
    this.#connect();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscriber of [...this.#subscribers]) this.unsubscribe(subscriber);
    this.#disconnect();
  }

  #connect() {
    if (this.#disposed || this.#permanentFailure || this.#subscribers.size === 0 || this.#socket || this.#reconnectTimer) return;

    let candidate: WebSocket;
    try {
      candidate = this.#createSocket(buildMlReportLiveEventUrl(this.#baseUrl, this.#accessToken));
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = candidate;

    candidate.addEventListener("open", () => {
      if (this.#socket !== candidate || this.#disposed) return;
      this.#reconnectAttempt = 0;
      this.#broadcast({ type: "connected" });
    });
    candidate.addEventListener("message", (event) => {
      if (this.#socket !== candidate || typeof event.data !== "string") return;
      const reportEvent = parseMlReportLiveEvent(event.data);
      if (reportEvent) this.#broadcast(reportEvent);
    });
    candidate.addEventListener("close", (event) => {
      if (this.#socket !== candidate) return;
      this.#socket = null;
      if (event.code === 1008) {
        this.#permanentFailure = true;
        return;
      }
      this.#scheduleReconnect();
    });
  }

  #broadcast(event: MlReportLiveEvent) {
    for (const subscriber of [...this.#subscribers]) {
      if (subscriber.isDestroyed()) {
        this.unsubscribe(subscriber);
        continue;
      }
      subscriber.send(ML_REPORT_LIVE_EVENT_CHANNELS.event, event);
    }
  }

  #scheduleReconnect() {
    if (this.#disposed || this.#permanentFailure || this.#subscribers.size === 0 || this.#reconnectTimer) return;
    const delayMs = Math.min(this.#initialReconnectDelayMs * 2 ** this.#reconnectAttempt, this.#maxReconnectDelayMs);
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = this.#setTimer(() => {
      this.#reconnectTimer = undefined;
      this.#connect();
    }, delayMs);
  }

  #disconnect() {
    if (this.#reconnectTimer !== undefined) {
      this.#clearTimer(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    const current = this.#socket;
    this.#socket = null;
    this.#reconnectAttempt = 0;
    this.#permanentFailure = false;
    if (!current) return;
    if (current.readyState === WebSocket.CONNECTING) {
      current.addEventListener("open", () => current.close(), { once: true });
    } else if (current.readyState === WebSocket.OPEN) {
      current.close();
    }
  }
}

export function buildMlReportLiveEventUrl(baseUrl: string, accessToken: string) {
  const url = new URL("/camera/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}
