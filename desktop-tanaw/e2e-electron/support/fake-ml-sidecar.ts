import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class FakeMlSidecar {
  readonly requestPaths: string[] = [];
  readonly requestTokens: string[] = [];
  readonly webSocketTokens: string[] = [];
  rejectWebSockets = false;
  webSocketAttempts = 0;
  #connections = new Set<Duplex>();
  #sockets = new Set<Duplex>();
  #port = 0;
  #server: Server | null = null;

  get activeWebSockets() {
    return this.#connections.size;
  }

  get port() {
    if (!this.#port) throw new Error("The fake sidecar has not started.");
    return this.#port;
  }

  async start(port = 0) {
    if (this.#server) return;
    const server = createServer((request, response) => this.#handleRequest(request, response));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    server.on("upgrade", (request, socket) => this.#handleUpgrade(request, socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.#server = server;
    this.#port = (server.address() as AddressInfo).port;
  }

  async restart() {
    const port = this.port;
    await this.stop();
    await this.start(port);
  }

  async stop() {
    const server = this.#server;
    if (!server) return;
    this.disconnectWebSockets();
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    this.#server = null;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  disconnectWebSockets() {
    for (const socket of this.#connections) socket.destroy();
    this.#connections.clear();
  }

  sendReportEvent(payload = cameraStatesEvent()) {
    const frame = encodeWebSocketFrame(JSON.stringify(payload));
    for (const socket of this.#connections) socket.write(frame);
  }

  #handleRequest(request: IncomingMessage, response: import("node:http").ServerResponse) {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    this.requestPaths.push(path);
    const token = request.headers["x-tanaw-ml-token"];
    if (typeof token === "string") this.requestTokens.push(token);

    const payload = responseForPath(path);
    response.writeHead(payload.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload.body));
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/camera/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    this.webSocketAttempts += 1;
    this.webSocketTokens.push(url.searchParams.get("access_token") ?? "");
    const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "\r\n"].join("\r\n"));

    if (this.rejectWebSockets) {
      socket.end(encodeWebSocketCloseFrame(1008, "Invalid desktop service token."));
      return;
    }

    this.#connections.add(socket);
    const remove = () => this.#connections.delete(socket);
    socket.on("close", remove);
    socket.on("error", remove);
    socket.on("data", (data) => {
      if ((data[0] & 0x0f) === 0x08) socket.end();
    });
  }
}

function responseForPath(path: string): { body: unknown; status: number } {
  if (path === "/health") {
    return {
      status: 200,
      body: {
        api_contract_version: 1,
        max_configured_cameras: 6,
        max_concurrent_cameras: 6,
        tripwire_hot_update: true,
        running: false,
        model_ready: true,
      },
    };
  }
  if (path === "/cameras/runtime") return { status: 200, body: cameraStatesEvent().data };
  if (path === "/context/enterprise") {
    return { status: 200, body: { enterprise_id: "enterprise-1", enterprise_name: "Electron Test Enterprise", changed: true, session_restored: false } };
  }
  if (path === "/metrics/summary") {
    return {
      status: 200,
      body: {
        entries: 0,
        exits: 0,
        peak_occupancy: 0,
        current_occupancy: 0,
        unique_count: 0,
        estimated_unique_count: 0,
        confirmed_unique_count: 0,
        degraded_unique_count: 0,
        pending_unique_entries: 0,
        repeat_entry_count: 0,
        occupancy_correction_delta: 0,
        total_events: 0,
        unsubmitted_events: 0,
        unsynced_events: 0,
        first_event_at: null,
        last_event_at: null,
        period: null,
      },
    };
  }
  if (path === "/session") {
    return { status: 200, body: { running: false, status: "stopped", error: null, camera_id: null, camera_name: null, updated_at: null } };
  }
  if (path === "/cameras" || path === "/reports/local") return { status: 200, body: [] };
  if (path === "/metrics/mark-synced") return { status: 200, body: { updated: 0 } };
  return { status: 404, body: { detail: "Not found" } };
}

function encodeWebSocketFrame(payload: string) {
  const data = Buffer.from(payload, "utf8");
  if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  if (data.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }
  throw new Error("The fake sidecar payload is unexpectedly large.");
}

function encodeWebSocketCloseFrame(code: number, reason: string) {
  const reasonBytes = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
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
