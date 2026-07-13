# ADR-006: Electron-to-ML Capability Contract

Status: **Accepted**

## Trust boundary

The Electron main process is the only local client trusted by the ML service.
The renderer, arbitrary localhost pages, and unrelated processes are untrusted.
All REST, control, data, WebSocket, health, and video-stream access requires a
fresh per-launch capability.

## Bootstrap

1. Electron main creates a cryptographically random 256-bit capability and a
   UUID `launchId` for every ML-process launch.
2. The capability is sent once through an inherited private pipe after spawn. It
   MUST NOT be placed in command-line arguments, environment variables, URLs,
   files, logs, crash reports, analytics, or renderer state.
3. The service binds only to `127.0.0.1` on an operating-system-selected
   ephemeral port. A fixed trusted port such as 8765 is forbidden.
4. The service sends one readiness record through a separate control pipe:
   `serviceName`, local contract version, release ID, launch ID, PID, port, and
   startup nonce. It never echoes the capability.
5. Electron verifies that the readiness record came from its child PID, matches
   the launch ID/release contract, and completes an authenticated health
   challenge before declaring the service ready.

The ML service exits if bootstrap is missing, malformed, repeated, or not
received within a bounded startup timeout. Electron kills the child if identity
or health verification fails; it does not attach to another process merely
because a port answers.

## Request authentication

Electron main sends these values over loopback for every request:

```text
Authorization: TANAW-Capability <base64url capability>
X-TANAW-Launch-ID: <launch UUID>
```

The ML service performs constant-time capability comparison and exact launch-ID
matching before reading a body or exposing service details. Missing, wrong, or
stale values receive a generic `401`; WebSockets close with an authentication
code before subscribing; streams send no frame bytes.

Capabilities expire when the child exits or Electron ends the launch session.
Restart always rotates both capability and launch ID. They are never persisted.
Rate limiting and bounded request sizes apply after authentication and do not
replace it.

## Renderer and stream rules

- The capability never crosses the preload boundary.
- Preload exposes only named, validated IPC operations; no generic fetch, URL,
  header, shell, or raw ML command bridge is allowed.
- Electron main owns the ML WebSocket and sends validated, typed events to the
  renderer over narrow IPC.
- Video is proxied by Electron main through a privileged application protocol or
  equivalent controlled channel that injects authentication internally. Tokens
  in query strings, cookies, browser storage, or media URLs are forbidden.
- Camera credentials stay in the main process/secure store and are never
  returned to the renderer or ML logs.
- Renderer CSP allows only required application sources and the controlled
  media path.

## Network and logging rules

The ML service does not need browser CORS. It MUST reject browser origins rather
than allowing `null` or arbitrary localhost ports. Loopback binding is defense
in depth, not authentication.

Structured logging uses an explicit allowlist and redacts authorization headers,
bootstrap records, IPC arguments, RTSP URLs, credentials, and query values. An
authentication failure logs only a reason class, endpoint category, and bounded
metadata—never the supplied secret.

## Health response

Authenticated health returns only the verified service identity needed by
Electron:

```json
{
  "serviceName": "tanaw-ml-service",
  "localContractVersion": 2,
  "releaseId": "target-cutover-release",
  "launchId": "5df0f569-6bc5-4383-8ee4-a9f6d0b30222",
  "pid": 12345,
  "status": "ready"
}
```

The `launchId` and PID must match the process Electron started. Liveness alone
does not establish identity.

## Required tests

- Missing, wrong, and previous-launch capabilities fail for REST, health,
  WebSocket, and stream endpoints.
- A rogue service on the old fixed port is never trusted.
- A valid restart rotates capability/launch ID and reconnects.
- Renderer APIs cannot obtain a token, camera credential, arbitrary endpoint, or
  raw command bridge.
- Logs, crash output, process listings, URLs, and renderer network history
  contain no capability or camera credential.
