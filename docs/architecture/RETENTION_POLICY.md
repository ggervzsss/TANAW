# TANAW Data Retention Policy

Status: target policy for contract version 2

This policy defines which TANAW records are permanent business evidence, which
records are operationally purgeable, and the conditions that must be true before
deletion. A shorter retention period must be approved by the LGU records owner
before deployment because completed cleanup is intentionally irreversible.

## Permanent business evidence

The following records have no age-based purge. They remain for the lifetime of
their owning official report or final report and are restored from the same
target-schema backup:

| Evidence | Target records | Rule |
| --- | --- | --- |
| Enterprise report identity and exact source lineage | `enterprise_reports`, `report_revisions`, facts, coverage, source batches, intake receipts | Permanent; immutable revision lineage is the report of record. |
| Staff review history | `report_review_events` | Permanent and append-only. General activity logs are never used to reconstruct it. |
| Final report versions, scope, sources, and facts | `report_finalizations`, `final_report_versions`, scope members, items, facts, source claims | Permanent; superseded versions remain reproducible. |
| Finalization and artifact audit | `final_report_events`, command receipts | Permanent and append-only. |
| Official rendered artifacts | `final_report_artifacts` and verified object bytes | Retained with the owning immutable final version. Failed/pending rows remain retryable rather than being age-deleted. |
| Reporting periods and obligations | `reporting_periods`, `reporting_obligations` | Permanent compliance history. |

Database mutation guards protect the append-only workflow tables. Tests purge an
old `activity_logs` record after report acceptance and finalization and prove that
the dedicated report/final event chains remain complete.

## Central operational retention

The backend retention worker runs immediately at startup and every
`RETENTION_CLEANUP_INTERVAL_SECONDS`. Each database family uses
`FOR UPDATE SKIP LOCKED` with `RETENTION_CLEANUP_BATCH_SIZE`; a failed family is
retried and is visible through `/maintenance/retention`.

| Data family | Default | Deletion guard |
| --- | ---: | --- |
| Consumed/invalid/expired activation tokens | 30 days | Only terminal tokens. |
| Used/invalid/expired password reset challenges | 30 days | Only terminal challenges. |
| Password-reset rate buckets | 2 days | Inactive buckets only. |
| Resolved email ownership changes | 180 days | Active requests are first expired and queued verification mail is cancelled. |
| Development delivery bodies | 7 days | Development-only terminal records; these may contain local test secrets. |
| Ordinary terminal email outbox records | 180 days | Queued, leased, retry-scheduled, failed-review, and reconciliation-required work is protected. |
| Terminal failed/reconciliation email records | 365 days | Longer failure audit window. |
| General activity logs | 180 days by default | Convenience audit only; configurable to 90/180/365 days. Official workflow audit is independent. |
| Read user notifications | 180 days | Unread notifications are never age-deleted. |
| Generic resolved operational alerts | 365 days | Active alerts and alerts referenced by durable condition state are protected. |
| Domain events | Per-record `retention_expires_at` | The event is deleted only when every delivery is `delivered`; pending, leased, retry-scheduled, and dead-letter events remain. Attempts, receipts, and deliveries are removed atomically with the event. A null expiry is permanent. |
| Raw telemetry observations | 14 days | Downsampling must settle first; retained rollups are created before raw deletion. |
| Telemetry metric facts and device-health samples | 7 days | Only explicit expired rows; required hourly rollups remain. |
| Hourly telemetry rollups | 730 days | Expired partitions are dropped only after the configured horizon. |

## Profile and support assets

Profile and ticket images are immutable objects addressed by metadata rows and a
SHA-256 hash. Active profile objects have no age expiry. Replacing or deleting a
profile marks the old metadata deleted and attempts immediate object removal.

When a support ticket becomes `Resolved`, each active attachment receives an
expiry of `SUPPORT_ATTACHMENT_RETENTION_DAYS` (365 days by default). Reopening
the ticket before expiry clears that deadline. At expiry the worker:

1. marks the attachment metadata deleted;
2. deletes the immutable object, retrying storage failures while the metadata key remains;
3. retains deleted metadata for `ASSET_DELETED_METADATA_RETENTION_DAYS` (30 days);
4. removes metadata only after object deletion succeeds;
5. after `ASSET_ORPHAN_GRACE_HOURS`, scans the bounded asset namespace for
   unreferenced objects and deletes them without racing in-flight metadata transactions;
6. removes interrupted temporary objects older than `STALE_ASSET_TEMPORARY_RETENTION_HOURS`.

The inventory scan fails visibly if it exceeds `ASSET_ORPHAN_SCAN_MAX_OBJECTS`;
it never silently skips a tail of the namespace. Active metadata whose object is
missing is an availability/integrity fault and is not disguised as retention.

## Desktop and ML local data

The local ledger keeps report identity, immutable local revisions, exact source
batch membership, sync acknowledgements, and non-identifying hourly/daily
rollups. Raw count events, snapshots, sightings, identities, and embeddings are
purged only after the exact central revision is consolidated. The retained
rollups and coverage gaps preserve dashboard/report meaning after raw deletion.
Unique-visitor identity expires after the business-day boundary plus the
configured grace window. Local target-only schema rebuilding and final removal
of migration readers are tracked separately in the zero-legacy manifest.

## Recovery and verification

Retention is not an in-place rollback mechanism. Recovery uses a verified
external backup and the matching target application generation. Before changing
any horizon, rehearse the cleanup on a restored production-like snapshot and
verify report/final hashes, event chains, dead letters, object checksums, and
rollup totals.
