# TANAW local edge ledger

The Enterprise desktop stores camera evidence in one versioned SQLite ledger per
enterprise. Schema version 8 defines the runtime catalog.

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
6. `sync_outbox_items` and `sync_attempts` are the only delivery lifecycle. The
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

## Schema initialization

The runtime creates schema 8 directly and accepts only schema 8. To clear disposable
or invalid local state, run:

```bash
cd /path/to/TANAW
./scripts/local-data-reset
```

On Windows PowerShell, use `./scripts/local-data-reset.ps1`. Start the desktop once,
then confirm:

```bash
sqlite3 /path/to/tanaw_metrics.sqlite3 \
  "pragma user_version; pragma integrity_check; pragma foreign_key_check;"
```

Expected evidence is schema version `8`, `ok`, and no foreign-key rows. Any other
version is rejected with a reset instruction.

## Catalog verification

The catalog verifier accepts the exact schema-8 object set and rejects extra or changed
objects. Recovery uses a database backup from the same schema version or a clean
schema-8 enrollment.

Raw report-event purging deletes exact revision members and associated identity records
while retaining immutable report facts, source lineage, delivery history, coverage
evidence, current camera state, and non-identifying rollups.
