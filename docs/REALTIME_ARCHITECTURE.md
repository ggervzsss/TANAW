# TANAW realtime architecture

TANAW uses one authenticated application WebSocket endpoint at `/realtime/ws`.
The web and desktop clients load their initial state through REST, then use this
connection for change notifications. Camera streams and the desktop ML-service
transport remain separate local channels.

The backend writes application events to the realtime outbox in the same
database transaction as the related state change. The realtime runtime claims
committed events and publishes them to authenticated clients. Clients recover
from disconnects by reconnecting and refreshing the affected REST resources,
so correctness does not depend on receiving every WebSocket message.

Deployments must proxy WebSocket upgrades for `/realtime/ws` and expose
`/ready/realtime` for readiness checks. Runtime timing and retention values are
application defaults in the codebase; environment configuration is reserved for
deployment-specific connection, credential, and API settings.
