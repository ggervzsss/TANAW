# TANAW realtime architecture

TANAW uses one multiplexed application WebSocket per authenticated web or Enterprise Desktop renderer. REST remains authoritative for initial reads, secure mutations, attachment downloads, and reconnect resynchronization. Camera streams and the local ML service keep their existing independent transports.

## Data flow

1. A normal API command commits a domain row.
2. PostgreSQL triggers insert a minimal versioned event into `realtime_outbox` in the same transaction.
3. A backend outbox worker claims unpublished rows with `FOR UPDATE SKIP LOCKED`, calls transactional `pg_notify`, and marks them published in the same commit.
4. Every API worker listens on `tanaw_application_realtime_v1`, reloads the durable row, validates its envelope, filters recipients by role and tenant, and places it in bounded per-connection queues.
5. `/realtime/ws` delivers the event. Clients deduplicate by `event_id`, reject older per-entity sequences, and invalidate only affected active query families.

This design is multi-worker safe without adding Redis. PostgreSQL does not notify listeners until the publishing transaction commits, and domain rollbacks also roll back their outbox rows. Telemetry events are coalesced while pending; correctness-critical ticket, notification, account, report, alert, activity, and email events are not.

## Event contract

Schema version 1 contains:

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "event_type": "support_ticket.message.created",
  "occurred_at": "2026-07-23T12:00:00Z",
  "sequence": 42,
  "scope": {
    "enterprise_id": "optional",
    "enterprise_account_id": "optional",
    "recipient_account_id": "optional",
    "ticket_id": "optional",
    "report_id": "optional"
  },
  "actor": { "user_id": "optional", "role": "optional" },
  "payload": { "message_id": "minimal committed-state identifiers" }
}
```

Supported domains are support tickets, notifications, alerts, account requests, users, enterprises, activity logs, report lifecycle, email delivery/dev log, telemetry, and system settings. Events do not carry access tokens, passwords, message bodies, email bodies, attachment bytes, or other secrets. Clients retrieve full authorized state through REST.

## Authentication and authorization

The socket accepts the bearer token only in the first WebSocket message; tokens are not placed in URLs. The same signed access-token, activation, account-status, and revocation checks used by HTTP authentication are enforced on connection and rechecked throughout the session. Invalid or revoked sessions close with code `4401`.

Server-side filtering is mandatory:

- Enterprise users receive only exact recipient or enterprise-scoped events.
- Staff, IT, and Admin receive only role-authorized event families.
- Admin ticket delivery is limited to High/Urgent tickets, matching its Operations Center scope.
- Notification delivery requires an exact recipient account match.
- Activity-log rules mirror the existing role-specific audit visibility.

Client filtering is never treated as a security boundary.

## Lifecycle and recovery

The gateway sends `realtime.ready`, periodic `realtime.heartbeat`, and, when delivery continuity cannot be guaranteed, `realtime.resync_required`. Clients:

- reconnect with exponential backoff and jitter, capped at 30 seconds;
- pause while the browser reports offline;
- detect silent half-open connections using the heartbeat watchdog;
- invalidate active realtime queries once after ready/reconnect;
- retain a bounded set of event IDs and the latest sequence per entity;
- show a subtle accessible offline/reconnecting/resynchronizing status;
- preserve open modals and unsent drafts during refetches.

Each client instance has its own socket, which is expected for multiple tabs or Electron windows. React effect cleanup prevents persistent duplicate connections under Strict Mode.

Backend readiness is exposed at `/ready/realtime`. It reports runtime status, broker status, active connections, and role counts. Queue capacity is bounded; a slow client is disconnected with `1013` and recovers through reconnect resynchronization.

## Configuration

Safe environment variables:

```dotenv
REALTIME_ENABLED=true
REALTIME_HEARTBEAT_SECONDS=30
REALTIME_OUTBOX_POLL_SECONDS=0.5
REALTIME_OUTBOX_BATCH_SIZE=100
REALTIME_BROKER_RECONNECT_SECONDS=1
```

Apply the database migration before starting the API:

```bash
cd backend-tanaw
uv run alembic upgrade head
```

## Reverse proxy

Production proxies must preserve WebSocket upgrade semantics for `/realtime/ws`, use HTTP/1.1 upstream, disable response buffering, and allow connections to remain open longer than two heartbeat intervals. Example:

```nginx
location /realtime/ws {
    proxy_pass http://tanaw_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
    proxy_send_timeout 90s;
    proxy_buffering off;
}
```

TLS terminates as `wss://`. The API continues to validate the browser `Origin`; configure the deployed frontend origin in CORS settings. The repository's frontend container serves static files and does not itself proxy the separately configured API URL, so the edge proxy/load balancer owns this route.

## Testing and troubleshooting

Run the backend, web, and desktop quality gates from `AGENTS.md`, plus:

```bash
cd backend-tanaw && uv run pytest
cd frontend-tanaw && npm test && npm run build
cd desktop-tanaw && npm test && npm run build
```

For a stale client:

1. Check `/ready/realtime`.
2. Confirm the database is at Alembic revision `20260723_0002`.
3. Confirm the client opens only `/realtime/ws` and sends its auth message.
4. Confirm the proxy returns `101 Switching Protocols`.
5. Inspect structured backend connection/disconnection logs without enabling payload or token logging.
6. Reconnect; the ready/resync path should refetch active REST queries without a page reload.
