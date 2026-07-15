# TANAW target local edge ledger

The Enterprise desktop stores camera evidence in one versioned SQLite ledger per
enterprise. Schema version 7 is the target-only runtime schema. It contains no mutable
`report_submissions` table, raw `count_snapshots` history, or global event sync/report
markers.

## Authoritative flow

1. `local_sites` and `local_cameras` bind the device ledger to its enterprise and
   preserve the local-to-central camera identity.
2. `camera_runtime_state` and `camera_live_state` are updated in one transaction.
   The former holds the bounded, credential-free restart snapshot and the latter
   contains typed current camera state. Neither is historical reporting input and
   there is no duplicate active-session JSON file.
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

## Cutover and recovery

The coordinated pre-cutover build transforms and reconciles existing device data,
then removes its temporary backup only after target catalog, foreign-key, and integrity
checks pass. The released target runtime does not package those transformation readers.
It creates schema v7 directly for a new device and accepts only v7 thereafter. Any
older or foreign catalog fails closed with an instruction to run the coordinated
cutover; it is never upgraded opportunistically during normal camera operation.

Recovery before acceptance restores the complete external local-data checkpoint and
matching pre-cutover application. After acceptance, recovery uses target-schema backups
or a clean v6 device enrollment—never a compatibility reader or retained old table.

Raw report-event purging deletes exact revision members and associated identity
records while keeping immutable report facts, source lineage, delivery history,
coverage evidence, current camera state, and non-identifying rollups.
