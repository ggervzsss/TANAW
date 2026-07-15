# TANAW Report Workflow and Data Architecture Implementation Plan

- **Status:** Current architecture
- **Primary timezone:** `Asia/Manila`
- **API contract:** Version 2
- **Central schema revision:** `20260715_0001`
- **Local ledger schema:** Version 8

## Purpose

This plan defines TANAW's report and operational data flow from CCTV capture to
Enterprise reporting, Staff review, final reports, and the Admin Map. It is the
implementation contract for the backend, web portal, desktop application, and
local ML service.

## Architecture principles

- Camera frames, credentials, appearance data, and local visitor evidence stay
  on the enterprise device.
- PostgreSQL receives bounded operational facts, immutable report revisions,
  workflow events, and current-state projections.
- Unknown evidence remains unknown; it is never converted to zero or a healthy
  status.
- Official and simulation data have separate classification and lineage.
- Commands are idempotent and retries converge on one business result.
- Accepted revisions, final report versions, and source membership are
  immutable and reproducible.
- Current-state tables are bounded projections, not reporting history.

## End-to-end data flow

### 1. CCTV capture and local persistence

1. The ML service processes configured streams locally.
2. Each count observation receives a stable event identifier, camera sequence,
   capture timestamp, canonical reporting period, and classification.
3. SQLite stores raw count evidence, monitoring sessions, coverage gaps,
   rollups, report revisions, and delivery commands atomically.
4. Frames, stream URLs, credentials, and identity-bearing media are excluded
   from report payloads and logs.

### 2. Enterprise reports

1. A logical report is identified by enterprise, site, reporting period, and
   classification.
2. Preparing a report freezes exact source batches and event memberships.
3. Every submission creates an immutable revision with canonical hashes and
   bounded metric/demographic facts.
4. The durable local outbox retries the exact command until the backend returns
   an explicit acknowledgement or dead-letter result.

### 3. Central intake

1. The backend authenticates the device and derives enterprise/site scope.
2. Contract version, command identity, idempotency key, hashes, sequence ranges,
   period identity, classification, and source membership are validated.
3. Intake writes the logical report, immutable revision, facts, source claims,
   receipt, workflow event, domain event, and acknowledgement in one
   transaction.
4. Replays return the existing result; conflicting reuse is rejected.

### 4. Staff workflow

1. Staff reads immutable revisions and explicit coverage/quality evidence.
2. Return, accept, reopen, and consolidate actions require an expected workflow
   version and create immutable review events.
3. Acceptance records the exact accepted revision and is blocked when required
   evidence or reporting obligations are unresolved.
4. Staff never edits submitted facts in place.

### 5. Final reports

1. Finalization uses an explicit site/barangay/city scope and frozen obligation
   membership.
2. The service claims exact accepted revisions and creates an immutable final
   version, facts, source items, lifecycle event, and command receipt.
3. Artifacts are generated from the stored version graph and verified against
   its content hash.
4. A correction creates another version; prior versions remain reproducible.

### 6. Admin Map

1. Sequenced telemetry observations update `site_live_state` only when they are
   newer than the stored device epoch and sequence.
2. Freshness deadlines derive fresh, stale, offline, or never-observed state.
3. Realtime events invalidate/refetch the same authoritative projection used by
   normal API reads.
4. The map never uses report rows as live telemetry and never presents expired
   evidence as current.

## Database boundaries

| Domain | Responsibilities |
| --- | --- |
| Topology | Enterprises, memberships, sites, location versions, devices, cameras |
| Reporting | Periods, obligations, logical reports, revisions, facts, source batches, review events, intake receipts |
| Final reporting | Scope, source claims, immutable versions/items/facts, artifacts, lifecycle events |
| Telemetry | Device epochs, observations, metric facts, health samples, live-state projection, hourly rollups |
| Events and delivery | Domain events, delivery attempts, consumer receipts, notifications, alerts |
| Security and support | Accounts, sessions, email delivery, assets, tickets, attachments, activity records |
| Simulation | Explicitly isolated runs and ownership |

High-volume telemetry rollups are partitioned by UTC month. Repeating attempts,
attachments, facts, memberships, and events are child tables. Mutable current
state is separated from immutable history.

## Reliability requirements

- Database foreign keys include enterprise/site/classification scope where
  cross-scope linkage would be unsafe.
- Structural identifiers use PostgreSQL UUID types.
- Append-only and immutable records are guarded by constraints and triggers.
- Outbox payload and idempotency identity cannot change during retry.
- Report and telemetry commands require monotonic versions or sequences.
- Retention removes identity-bearing raw evidence only after protected report
  memberships and durable rollups are accounted for.

## Verification gates

Every implementation change must run the applicable lint, formatting, and type
checks. Schema changes also require:

- installation of the initial revision in an empty PostgreSQL database;
- `alembic check` with no generated operations;
- exact catalog comparison against SQLAlchemy metadata;
- validation of declared functions, triggers, sequences, and partitions;
- regeneration and verification of `shared-contracts/operational-v2.openapi.json`;
- `python3 scripts/verify_release.py`.

Manual acceptance follows [docs/architecture/DEPLOYMENT.md](docs/architecture/DEPLOYMENT.md)
and exercises capture, report synchronization, Staff review, finalization,
Admin Map freshness, delivery retry, and simulation isolation.
