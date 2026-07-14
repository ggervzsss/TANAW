# TANAW target local edge ledger

The Enterprise desktop stores camera evidence in one versioned SQLite ledger per
enterprise. Schema version 5 is the target runtime schema. It contains no mutable
`report_submissions` table, raw `count_snapshots` history, or global event sync/report
markers.

## Authoritative flow

1. `local_sites` and `local_cameras` bind the device ledger to its enterprise and
   preserve the local-to-central camera identity.
2. `camera_live_state` contains one replaceable current-state row per camera. It is
   operational evidence, not historical reporting input.
3. `count_events` records each capture once with a stable event UUID, canonical Manila
   business date and reporting period, per-camera sequence, quality fields, schema
   version, and finite event attributes bounded to 64 KiB.
4. `metric_rollups` retains non-identifying hourly and daily aggregates even after raw
   identity/event retention expires.
5. `local_reports` owns the period-scoped logical report. Immutable
   `local_report_revisions`, exact source batches, event claims, and revision
   memberships freeze what each revision contains.
6. `sync_outbox_items` and `sync_attempts` are the only delivery lifecycle. Backlog and
   failure health are derived from these records; events have no global synced flag.
7. `monitoring_sessions`, `coverage_gaps`, and `local_persistence_errors` make stream
   downtime and ledger failures explicit.

## Upgrade and recovery

The v5 cutover first validates that every legacy report and submitted event has an
exact target mapping. Invalid timestamps, missing canonical periods, invalid JSON, or
missing report claims stop the upgrade. SQLite applies the schema transformation in
one transaction with foreign keys revalidated afterward.

For an existing versioned ledger, startup checkpoints WAL and creates a temporary
SQLite backup before cutover. An interrupted transaction rolls back to schema v4 and
the next startup safely retries from the same backup. After the target catalog,
foreign keys, and integrity checks pass, SQLite vacuums the live database and deletes
the temporary backup. The accepted runtime database therefore contains only target
tables and columns.

Raw report-event purging deletes exact revision members and associated identity
records while keeping immutable report facts, source lineage, delivery history,
coverage evidence, current camera state, and non-identifying rollups.
