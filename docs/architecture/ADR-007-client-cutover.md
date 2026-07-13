# ADR-007: Client Compatibility and Hard Cutover

Status: **Accepted**

## Compatible generation

The target system supports one contract generation after cutover:

| Surface                             | Required target                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Central REST, WebSocket, and events | Contract version `2` only                                                         |
| Desktop application                 | Semantic version `>=2.0.0 <3.0.0`, contract version `2`                           |
| Bundled ML service                  | Local contract version `2` and an Electron-approved release ID                    |
| Web portal                          | The backend-matched target deployment; stale cached assets are rejected/refreshed |

The current placeholder desktop version `0.0.0` is not a production-compatible
version and MUST be replaced before the target release is built. Each release
inventory records exact backend, portal, desktop, ML, migration, OpenAPI, and
schema hashes.

The backend deployment config holds the exact minimum desktop version and
allowed contract generation. Desktop requests identify their version,
contract, release ID, and registered device through authenticated metadata.
Headers or payload values are useful compatibility signals but do not replace
authentication.

An unsupported client receives HTTP `426 Upgrade Required` before a business
write is parsed:

```json
{
  "contractVersion": 2,
  "error": {
    "code": "CLIENT_UPGRADE_REQUIRED",
    "message": "Update TANAW Desktop before synchronizing.",
    "retryable": false,
    "minimumClientVersion": "2.0.0",
    "requiredContractVersion": 2
  }
}
```

WebSocket and device connections use the same compatibility policy and close
with a distinct mandatory-upgrade reason. The desktop preserves its durable
outbox and shows the upgrade action; it MUST NOT discard or translate pending
commands through a v1 fallback.

## Hard-cutover policy

Development and rehearsal MAY use temporary readers, dual writers, comparison
jobs, or aliases only when each is listed in the zero-legacy manifest. Production
acceptance follows this sequence:

1. Stop and drain writes in a maintenance window.
2. Take and verify external PostgreSQL and enterprise-local backups.
3. Run resumable target transformations and reconcile period, lineage, workflow,
   artifact, topology, asset, telemetry, and outbox evidence.
4. Deploy the target-only application generation.
5. Physically drop superseded tables, columns, views, routes, DTOs, event types,
   stores, components, jobs, flags, and migration-only adapters.
6. Run catalog, OpenAPI, repository, build, and end-to-end absence proofs with
   the legacy objects unavailable.
7. Reopen only when the signed manifest has no unresolved entry.

There is no production v1 endpoint, route alias, legacy DTO parser, old desktop
compatibility path, fallback store, or retained backup table. Backups live
outside the running databases and application tree.

If verification fails before acceptance, all services stop and the complete
external backup plus its matching pre-cutover applications are restored. A
partially migrated database and mixed client generation are never served. After
acceptance, incidents are fixed forward on the target architecture or restored
from target-schema backups; removed legacy objects are not reintroduced.

## Required release proof

- The version policy rejects desktop `0.0.0`, v1 REST, v1 WebSocket, and v1
  event payloads with a clear upgrade result.
- Target clients successfully complete capture, telemetry, submission, review,
  scoped finalization, PDF/artifact, notification, and map freshness flows.
- Migration rerun/resume and complete external restore are rehearsed.
- PostgreSQL/SQLite catalogs, OpenAPI, repository searches, and packaged builds
  match the signed zero-legacy manifest.
- No compatibility flag or dual path exists in the production build.
