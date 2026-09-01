import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ML_REPORT_LIVE_EVENT_CHANNELS } from "../../src/types/ml-report-live-events";
import { buildMlReportLiveEventUrl, MlReportLiveEventStream } from "./ml-report-live-events";

describe("ML report live-event stream", () => {
  it("keeps authentication in main and forwards each valid event once", () => {
    const sockets: FakeWebSocket[] = [];
    const subscriber = new FakeSubscriber();
    const stream = new MlReportLiveEventStream({
      accessToken: "main-only-token",
      baseUrl: "http://127.0.0.1:8765",
      createSocket: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    stream.subscribe(subscriber);
    stream.subscribe(subscriber);
    expect(sockets).toHaveLength(1);
    expect(new URL(sockets[0].url).searchParams.get("access_token")).toBe("main-only-token");

    sockets[0].open();
    sockets[0].message(JSON.stringify(cameraStatesEvent()));
    sockets[0].message('{"type":"arbitrary.command","data":{}}');

    expect(subscriber.send).toHaveBeenCalledTimes(2);
    expect(subscriber.send).toHaveBeenNthCalledWith(1, ML_REPORT_LIVE_EVENT_CHANNELS.event, { type: "connected" });
    expect(subscriber.send).toHaveBeenNthCalledWith(2, ML_REPORT_LIVE_EVENT_CHANNELS.event, cameraStatesEvent());
  });

  it("unsubscribes and removes destroyed renderers without leaving a connection", () => {
    const sockets: FakeWebSocket[] = [];
    const first = new FakeSubscriber();
    const second = new FakeSubscriber();
    const stream = createStream(sockets);

    stream.subscribe(first);
    stream.subscribe(second);
    sockets[0].open();
    first.send.mockClear();
    second.send.mockClear();
    stream.unsubscribe(first);
    sockets[0].message(JSON.stringify(cameraStatesEvent()));
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledOnce();

    second.destroy();
    expect(sockets[0].closeCalls).toBe(1);
  });

  it("reconnects with bounded backoff after transient sidecar disconnects", () => {
    const sockets: FakeWebSocket[] = [];
    const timers = new Map<number, () => void>();
    const delays: number[] = [];
    let nextTimer = 1;
    const stream = new MlReportLiveEventStream({
      accessToken: "token",
      baseUrl: "http://127.0.0.1:8765",
      createSocket: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 250,
      setTimer: (callback, delayMs) => {
        const handle = nextTimer++ as unknown as ReturnType<typeof setTimeout>;
        delays.push(delayMs);
        timers.set(Number(handle), callback);
        return handle;
      },
      clearTimer: (handle) => timers.delete(Number(handle)),
    });

    stream.subscribe(new FakeSubscriber());
    sockets[0].closeFromService(1006);
    runNextTimer(timers);
    sockets[1].closeFromService(1006);
    runNextTimer(timers);
    sockets[2].closeFromService(1006);

    expect(delays).toEqual([100, 200, 250]);
    expect(sockets).toHaveLength(3);
  });

  it("does not retry a permanent authentication or policy failure", () => {
    const sockets: FakeWebSocket[] = [];
    const setTimer = vi.fn<typeof setTimeout>();
    const stream = new MlReportLiveEventStream({
      accessToken: "token",
      baseUrl: "http://127.0.0.1:8765",
      createSocket: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      setTimer,
    });

    stream.subscribe(new FakeSubscriber());
    sockets[0].closeFromService(1008);

    expect(setTimer).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);

    stream.reconnectAfterServiceRestart();
    expect(sockets).toHaveLength(2);
  });

  it("builds only the fixed sidecar event path", () => {
    const url = new URL(buildMlReportLiveEventUrl("https://127.0.0.1:8765/ignored", "secret value"));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/camera/ws");
    expect(url.searchParams.get("access_token")).toBe("secret value");
  });
});

function createStream(sockets: FakeWebSocket[]) {
  return new MlReportLiveEventStream({
    accessToken: "token",
    baseUrl: "http://127.0.0.1:8765",
    createSocket: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
}

class FakeSubscriber extends EventEmitter {
  destroyed = false;
  send = vi.fn();

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeWebSocket extends EventTarget {
  closeCalls = 0;
  readyState: number = WebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  close() {
    this.closeCalls += 1;
    this.readyState = WebSocket.CLOSED;
  }

  closeFromService(code: number) {
    this.readyState = WebSocket.CLOSED;
    const event = new Event("close") as Event & { code: number };
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }
}

function runNextTimer(timers: Map<number, () => void>) {
  const [handle, callback] = [...timers.entries()][0];
  timers.delete(handle);
  callback();
}

function cameraStatesEvent() {
  return {
    type: "camera.states" as const,
    data: {
      enterprise_id: "enterprise-1",
      enterprise_occupancy: 1,
      active_camera_count: 1,
      max_configured_cameras: 6,
      max_concurrent_cameras: 6,
      pending_camera_ids: [],
      cameras: [
        {
          camera_id: 1,
          counts: { entry: 1, exit: 0, occupancy: 1, running: true, status: "running", error: null },
          detections: {},
          health: {
            running: true,
            model_ready: true,
            processed_frame_stale_ms: 5,
            estimated_unique_count: 1,
            confirmed_unique_count: 1,
            degraded_unique_count: 0,
          },
          session: { running: true, status: "running", error: null },
        },
      ],
    },
  };
}
