# TANAW target local edge ledger

The Enterprise desktop stores camera evidence in one versioned SQLite ledger per
enterprise. Schema version 8 is the only runtime schema. It contains no mutable
`report_submissions` table, raw `count_snapshots` history, global event sync markers,
or pre-v8 classification columns.

## Authoritative flow

1. `local_sites` binds the ledger to one enterprise. `local_cameras.camera_key` is a
   stable device-local identity; nullable, unique `central_camera_id` is a separate
   binding. Assigning a central UUID therefore does not create a second local camera
   or detach pre-binding history.
2. `camera_runtime_state` and `camera_live_state` hold bounded, credential-free current
   state. They are not historical report input.
3. `count_events` records each observation once with a stable event UUID, canonical
   Manila period, immutable per-camera sequence, bounded attributes, and exactly one
   classification: `official` with no simulation run, or `simulation` with a required
   `simulation_run_id`. Hybrid is a capture mode, never a third data classification.
4. `metric_rollups` retains non-identifying hourly and daily aggregates with the same
   classification boundary after raw identity/event retention expires.
5. `local_reports` owns the period-scoped logical report. Immutable revisions, source
   batches, event claims, and memberships enforce the same period, local camera,
   classification, simulation run, sequence interval, row count, and membership hash.
6. `sync_outbox_items` and `sync_attempts` are the only delivery lifecycle. The target
   schema pins the v2 endpoint and contract, validates JSON/hash shape, makes delivery
   identity immutable, and requires explicit acknowledgement or dead-letter evidence.
7. `monitoring_sessions`, `coverage_gaps`, and `local_persistence_errors` make stream
   downtime and persistence failures explicit. Only one session may be open per camera;
   a gap references the exact `(monitoring_session_id, camera_key)` pair.

## Durable outbox recovery

The Reports workspace exposes only official failed, retryable, and dead-letter
items through the authenticated Electron-to-ML channel. The list contains safe
operational summaries—revision identity, state, attempt count, timing, and
failure class/reason—but never the canonical payload or idempotency key. A
deliberate detail read is subject to the same restriction.

An operator may requeue the exact immutable command after entering a reason.
The action does not rewrite the revision, payload, hash, endpoint, command ID,
or idempotency identity. It records a durable `sync_attempts` audit row before
returning the item to the ready state. Official revisions cannot be discarded
from the recovery UI. Concurrent duplicate requeue requests cannot create two
ready transitions.

The Electron end-to-end release scenario must prove that a failed item remains
visible across ML-service restart, that list/detail/log output contains no
payload or capability/camera credential, and that the same revision can be
retried and acknowledged exactly once.

## External v5/v6/v7 to v8 cutover

The target runtime creates v8 directly and accepts only v8. It has no compatibility
reader, dual-read path, or opportunistic migration. Existing v5, v6, or v7 stores must
be replaced before the target desktop is installed:

```bash
cd /path/to/TANAW
python scripts/migrate_local_edge_ledger_v8.py \
  /path/to/tanaw_metrics.sqlite3
```

The external tool:

- accepts only `PRAGMA user_version` 5, 6, or 7;
- checkpoints the source, writes
  `tanaw_metrics.sqlite3.pre-v8.backup`, and reports its SHA-256 checksum;
- builds v8 in a separate hidden replacement file inside one SQLite transaction;
- maps `real` to `official` and `mock`/`hybrid` to `simulation`, failing if run identity
  is missing or an official record carries simulation identity;
- consolidates equivalent pre-binding/bound camera identities only when their central
  binding and sequence histories do not conflict;
- reconciles report/event/outbox/session/gap row counts, exact source-batch membership
  hashes, `foreign_key_check`, and `integrity_check`; and
- atomically replaces the original path only after every check passes.

If the command is interrupted or any reconciliation fails, the original database is
not replaced, the incomplete replacement is removed on a handled failure, and the
complete pre-v8 backup remains available for the cutover operator. Verify the reported
checksum and rerun only after correcting the stated data conflict. Never open a
partially produced replacement manually.

After migration, start the target build once and confirm:

```bash
sqlite3 /path/to/tanaw_metrics.sqlite3 \
  "pragma user_version; pragma integrity_check; pragma foreign_key_check;"
```

Expected evidence is schema version `8`, `ok`, and no foreign-key rows. Reconcile the
device inventory, official report revisions, source-batch counts/hashes, outbox status,
monitoring sessions, and coverage gaps against the cutover output. Once the deployment
is accepted, delete the temporary `.pre-v8.backup`; it is a rollback checkpoint, not a
retained legacy store or runtime fallback.

## Runtime exclusion proof

The migrator lives at repository root under `scripts/`, outside
`desktop-tanaw/ml-service`. Electron packages only the ML-service resource tree, so the
v5-v7 readers are absent from target resources. No module under `ml-service/app` imports
the migrator. `test_local_ledger_v8_cutover.py` verifies both properties and rehearses
all three supported source versions plus failure rollback.

Recovery before cutover acceptance restores the complete external checkpoint and the
matching pre-cutover application. After acceptance, recovery uses v8 backups or a clean
v8 enrollment—never an old table, compatibility reader, or parallel legacy component.

Raw report-event purging deletes exact revision members and associated identity records
while retaining immutable report facts, source lineage, delivery history, coverage
evidence, current camera state, and non-identifying rollups.
