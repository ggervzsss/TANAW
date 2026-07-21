import { describe, expect, it } from "vitest";
import { createReconnectingWebSocket } from "./reconnecting-websocket";

class FakeSocket {
  readyState = 0;
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("createReconnectingWebSocket", () => {
  it("defers close while a StrictMode cleanup socket is still connecting", () => {
    const socket = new FakeSocket();
    const connection = createReconnectingWebSocket({
      url: "ws://127.0.0.1/test",
      createSocket: () => socket as unknown as WebSocket,
    });

    connection.dispose();
    expect(socket.closeCalls).toBe(0);

    socket.open();
    expect(socket.closeCalls).toBe(1);
  });

  it("keeps one reconnect candidate and clears its pending retry on disposal", () => {
    const sockets: FakeSocket[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const connection = createReconnectingWebSocket({
      url: "ws://127.0.0.1/test",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      setTimer: (callback) => {
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimer: (handle) => timers.delete(Number(handle)),
    });

    sockets[0].serverClose();
    expect(timers.size).toBe(1);
    const retry = [...timers.values()][0];
    timers.clear();
    retry();
    expect(sockets).toHaveLength(2);

    connection.dispose();
    expect(timers.size).toBe(0);
  });
});
