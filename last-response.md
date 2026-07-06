I’d make the biggest improvement in the CCTV/local ML area, but I would not send video frames over WebSockets.

**Best Direction**

Keep WebSockets for event/state updates. Keep HTTP for transactional writes. Keep streaming/video separate.

For the CCTV feature, the best next step is:

1. Keep `/stream` as MJPEG for the actual camera preview for now.
2. Replace the 250ms/1s/4s polling with a local ML WebSocket for JSON events.
3. Send `counts`, `detections`, `health`, `session`, and maybe `simulation.status` over that socket.
4. Include a `frameId` or timestamp so overlays line up with the current video frame.

Right now CCTV does this:

- Video: multipart MJPEG stream.
- Detections: HTTP polling every 250ms.
- Counts: HTTP polling every 1s.
- Session/health: HTTP polling every 4s.

That works, but the detection polling is the noisy part. A local WebSocket from `ml-service` to the Electron renderer would be cleaner and more responsive.

**What Should Use WebSockets**

Good candidates:

- ML detections and tracking boxes.
- Live count changes.
- Camera session state changes.
- ML health/status changes.
- Simulation status changes.
- Support ticket create/update/message events.
- Dev delivery log updates.
- Report workflow status changes, which mostly already ride the operational WebSocket.

These are state/event streams where the UI benefits from immediate updates.

**What Should Stay Polling Or HTTP**

Keep these as HTTP:

- Desktop telemetry upload to cloud every 5s.
- Report submission sync.
- Mark notification read.
- Account/profile/security mutations.
- Camera start/stop/test commands.
- Local report ledger fetches unless they need to be truly live.
- Periodic “safety fallback” refetches every 30s or so.

Those are transactional operations. HTTP is simpler, easier to retry, and easier to reason about offline.

**For CCTV Specifically**

Best practical architecture:

- `/camera/start`, `/camera/stop`, `/camera/test`: HTTP.
- `/stream`: keep MJPEG now; later consider WebRTC if you need lower latency or multiple viewers.
- `/events` or `/camera/ws`: WebSocket for JSON:
  - `counts.updated`
  - `detections.updated`
  - `session.updated`
  - `health.updated`
  - `camera.error`
  - `simulation.updated`

I would avoid putting video frames in WebSockets. It is tempting, but it usually becomes heavier than MJPEG/WebRTC and makes backpressure, dropped frames, browser rendering, and reconnection more annoying.

**Priority Order**

1. Add local ML WebSocket for CCTV metadata and remove 250ms detection polling.
2. Add support ticket WebSocket events or operational WS envelopes like `ticket.created`, `ticket.updated`, `ticket.message.created`.
3. Reduce duplicate notification polling once WS delivery is reliable, but keep a slow fallback refetch.
4. Keep cloud telemetry/report sync as HTTP interval-based sync because offline retry matters more than instant delivery there.

So the short version: WebSocket the live metadata, not the video. Keep HTTP for commands and durable sync.