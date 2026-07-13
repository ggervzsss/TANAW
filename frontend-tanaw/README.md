# TANAW Frontend

React, TypeScript, Vite, and Tailwind web application for the TANAW LGU portal.
It gives LGU users role-specific workspaces for monitoring enterprises,
reviewing submissions, managing accounts, viewing alerts, and auditing final
tourism reports.

For installation, Docker Compose startup, local testing, and shutdown commands,
use the root [TL;DR test guide](../TLDR.md). The enterprise desktop has its own
local setup guide in [desktop-tanaw/README.md](../desktop-tanaw/README.md).

## Purpose

The frontend is the browser-based LGU application. It consumes the TANAW backend
through REST APIs and authenticated real-time updates. It does not process
camera streams directly; camera monitoring and visitor counting happen in the
enterprise desktop app.

The portal is optimized for LGU operations:

- IT personnel manage LGU and enterprise accounts, inspect operational status,
  review system logs, and maintain system settings.
- Admin users monitor enterprise locations, desktop app health, alerts, and system
  activity.
- LGU Staff review enterprise reports, inspect tourism analytics, consolidate
  accepted submissions, and audit final reports.

## Main Areas

- **Authentication**: role-aware login, protected routes, password and recovery
  flows, and authenticated API state.
- **IT workspace**: operational dashboard, LGU account management, enterprise
  account management, alerts, logs, delivery tracking, and settings.
- **Admin workspace**: enterprise map, alert monitoring, desktop app status, and
  centralized system logs.
- **Staff workspace**: analytics, batch report review, final report generation,
  final report audit, and reporting activity.
- **Shared UI**: reusable components, layout primitives, forms, tables, charts,
  maps, notifications, and API helpers.

## Project Structure

```text
src/
  app/             # App shell, routing, providers, and global stores
  components/      # Shared UI components
  features/        # Role and workflow-specific screens, services, components
  shared/          # API clients, config, hooks, utilities, and shared types
  stores/          # Client-side state stores
  types/           # Cross-feature TypeScript types
index.html         # Vite HTML entry point
vite.config.ts     # Vite configuration
```

Feature code is grouped by workflow so role-specific pages can evolve without
turning shared UI and API helpers into a dumping ground.

## Backend Relationship

The frontend expects the backend to provide:

- authentication and current-user session endpoints;
- role-specific account and enterprise APIs;
- operational telemetry and desktop app status records;
- Staff review, report submission, final report, and audit endpoints;
- activity logs and alert data;
- CORS access for the web portal origin.

Runtime API configuration is controlled through `VITE_API_BASE_URL`. The root
Docker Compose and TL;DR guide document the expected local value and startup
flow.

## Deployment Origins And CSP

The API URL is compiled into the browser bundle. Vite derives the Content
Security Policy `connect-src` entries from that same value, including the
matching `wss://` origin used by TANAW's operational and activity-log sockets.
There is no separate hard-coded Render or Vercel origin to update. The policy is
injected as an early HTML `<meta http-equiv="Content-Security-Policy">`; Vercel
and Nginx continue to provide the non-dynamic response security headers. The
static site intentionally sends no `Access-Control-Allow-Origin` header because
only the backend API is a cross-origin resource server.

The Vite development server generates a fresh CSP nonce for its injected HMR
scripts and compiled Tailwind style element. Production builds keep the stricter
external-script and external-style policy. TANAW renders notifications through
the headless toast API and maintained application CSS, so production does not
depend on runtime CSS-in-JS style injection.

Vercel sets `VERCEL=1`, which makes the build fail if `VITE_API_BASE_URL` is
missing, local/private, non-HTTPS, or malformed. For another public static or
Docker host, set `TANAW_PUBLIC_DEPLOYMENT=true` in the build environment to
enable the same guard. Local development and the production-like local Compose
stack may leave this flag false and use `http://localhost:8000`.

These values form one deployment unit and must change together:

| Configuration                 | Current hosted deployment           | Future custom-domain example    |
| ----------------------------- | ----------------------------------- | ------------------------------- |
| Portal URL                    | `https://tanaw-sanpedro.vercel.app` | `https://tanaw-sanpedro.ph`     |
| Frontend `VITE_API_BASE_URL`  | `https://tanaw.onrender.com`        | `https://api.tanaw-sanpedro.ph` |
| Backend `FRONTEND_PUBLIC_URL` | `https://tanaw-sanpedro.vercel.app` | `https://tanaw-sanpedro.ph`     |
| Backend `CORS_ORIGINS`        | `https://tanaw-sanpedro.vercel.app` | `https://tanaw-sanpedro.ph`     |
| Generated CSP sockets         | `wss://tanaw.onrender.com`          | `wss://api.tanaw-sanpedro.ph`   |

Before a deployment, validate the three operator-controlled values from this
directory:

```shell
VITE_API_BASE_URL=https://tanaw.onrender.com \
FRONTEND_PUBLIC_URL=https://tanaw-sanpedro.vercel.app \
CORS_ORIGINS=https://tanaw-sanpedro.vercel.app \
npm run deployment:validate
```

Then rebuild the frontend and redeploy the backend. `FRONTEND_PUBLIC_URL`
controls activation and email-ownership links, `CORS_ORIGINS` authorizes the
browser origin at the API, and `VITE_API_BASE_URL` controls REST, WebSocket, and
CSP destinations. A DNS change alone is therefore not sufficient.

## UI And State Model

The app uses React Router for navigation, TanStack Query for server state,
Zustand for lightweight client state, Tailwind CSS for styling, Recharts for
analytics views, and Leaflet for map-based enterprise monitoring.

User-facing terminology should stay operational and non-technical. The portal
is intended for LGU staff workflows, so screens should prioritize clear status,
review actions, auditability, and fast scanning over implementation details.

## Related Documentation

- [Root system overview](../README.md)
- [TL;DR setup and test guide](../TLDR.md)
- [Backend overview](../backend-tanaw/README.md)
- [Enterprise desktop guide](../desktop-tanaw/README.md)
