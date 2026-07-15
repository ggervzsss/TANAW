# TANAW Target Cutover Rehearsal

- Status: **Engineering rehearsal passed; release sign-off pending**
- Rehearsed at: **2026-07-15T08:49:34Z**
- Source revision: **`20260712_0019`**
- Target revision: **`20260714_0036`**
- Contract generation: **2**

This record proves the central PostgreSQL hard-cutover mechanics against a
representative pre-target dataset. It does not authorize a production cutover.
Production still requires its own backup checksum, input reconciliation,
target-only smoke tests, coordinator approval, and independent review recorded
in `ZERO_LEGACY_MANIFEST.md`.

## Representative source inventory

The source database contained one official enterprise/account and the following
linked historical records:

| Source object | Stable rehearsal identity | Count |
| --- | --- | ---: |
| `enterprise_report_submissions` | `22222222-2222-4222-8222-222222222222` | 1 |
| `enterprise_telemetry_snapshots` | `33333333-3333-4333-8333-333333333333` | 1 |
| `final_reports` | `44444444-4444-4444-8444-444444444444` | 1 |
| `final_report_sources` | `55555555-5555-4555-8555-555555555555` | 1 |

The report carried 120 entries, 100 exits, peak occupancy 30, unique estimate
110, and six demographic counts totaling 110. The final report referenced that
exact source report.

## External recovery checkpoint

The pre-target database was exported in PostgreSQL custom format outside the
live database:

```text
Artifact: /tmp/tanaw_cutover_source_corrected.dump
Size: 70317 bytes
SHA-256: b7b2d63fe3ded31021fdf1108fd8be1eb4bbce62d3870d3149fb6cc8d4a1d87b
```

Restoring that artifact into an empty database produced revision
`20260712_0019` and restored the exact account, submission, telemetry snapshot,
final report, final source link, and demographic payload. This establishes the
pre-acceptance rollback mechanism: stop services, restore the complete external
checkpoint, and deploy the matching pre-target application generation. No
backup or compatibility table is retained in the upgraded database.

## Migration exception disposition

The migration stopped at revision `20260714_0032` for operator review. The
allowlist was asserted as an exact set before any row was waived.

| Ledger | Exact exception code | Count | Disposition |
| --- | --- | ---: | --- |
| Report | `incomplete_review_history` | 1 | Waived; target revision remains acceptance-blocked |
| Report | `missing_coverage_evidence` | 1 | Waived; target revision remains acceptance-blocked |
| Report | `missing_source_lineage` | 1 | Waived; target revision remains acceptance-blocked |
| Report | `unverified_historical_obligation` | 1 | Waived; target revision remains acceptance-blocked |
| Telemetry | `missing_camera_lineage` | 1 | Waived; observation excluded from current projection |
| Telemetry | `missing_epoch_sequence_evidence` | 1 | Waived; observation excluded from current projection |
| Telemetry | `missing_metric_coverage` | 1 | Waived; observation excluded from current projection |

No unexpected exception was waived. Unknown historical evidence was not
fabricated. The temporary exception ledgers were subsequently removed by the
target finalization migration.

## Defects found by the rehearsal

The rehearsal exposed and fixed two migration-order defects that fresh empty
database tests could not reveal:

1. Alembic previously wrapped all revisions in one transaction. Revision
   `20260713_0024` backfilled rows whose pending trigger events then prevented an
   index operation in `20260713_0025`. `alembic/env.py` now commits each
   irreversible revision atomically with `transaction_per_migration=True`.
2. Revision `20260714_0034` attempted to normalize imported labels after
   append-only/immutable triggers were active. The migration now drops only the
   four affected guards inside its transaction, performs the fixed one-time
   relabeling, and restores the exact guards before completing. The restored
   telemetry-observation trigger is explicitly bound to
   `tanaw_guard_telemetry_observation_update`, preserving the one-way atomic
   downsampling marker while rejecting every other update. Any failure rolls
   the complete revision back.

The first failed attempt rolled back to revision `20260712_0019` without losing
source data. The second failed attempt left the database cleanly at revision
`20260714_0033`. Both were resumed only after correcting the migration.

## Target reconciliation result

An uninterrupted restored-database replay from `20260712_0019` to
`20260714_0036` produced:

| Target evidence | Result |
| --- | --- |
| Matching `report_revisions` row | 1 |
| `visitor_entries` | `120.000000` |
| `visitor_exits` | `100.000000` |
| `occupancy_peak` | `30.000000` |
| `venue_local_unique_estimate` | `110.000000` |
| Demographic facts | 6, total 110 |
| Matching `telemetry_observations` row | 1 |
| Matching final report/source claim | 1 / 1 |
| Final report content hash | `sha256:b02d1e5499407a572c0e48e8340519d3bcc289c50ba669537a381df6db132edf` |
| Superseded source/exception relations remaining | 0 |

The exact target-catalog test passed all five checks against both the first
upgraded database and the independently restored/full-replay database. It
compared tables, columns, indexes, sequences, triggers, functions, partitions,
and native foreign-key types against the target model and allowlists.

An immediate second `alembic upgrade head` was a no-op, and `alembic check`
reported `No new upgrade operations detected.`

## Target release verification

The completed target-only engineering release produced this deterministic
inventory:

```text
Files scanned: 573
Contract version: 2
Release ID: target-cutover-release
Portal version: 2.0.0
Desktop version: 2.0.0
Inventory SHA-256: sha256:d4ddf654df618108db547ef865829fb9450fadb75a986e3108a65431b9e590ff
Forbidden source/build findings: 0
```

The final quality evidence was:

| Project/gate | Result |
| --- | --- |
| Backend PostgreSQL/unit suite | 481 passed |
| Backend Ruff/format/mypy/Pyright | Passed |
| ML-service suite | 193 passed |
| ML-service Ruff/format/mypy/Pyright | Passed |
| Portal unit suite | 64 passed |
| Portal lint/type/build | Passed |
| Portal Playwright | 13 passed; 1 credential-gated real-backend scenario skipped |
| Desktop unit suite | 87 passed |
| Desktop lint/type/build | Passed |
| Desktop Playwright | 7 passed |

The portal Playwright suite includes target report/map workflows: Staff
finalization submits only the accepted immutable revision selected from frozen
compliance, and Admin Map renders fresh target live-state values while stale
values remain unavailable and visibly degraded.

## Production execution gate

Before production is reopened, repeat this procedure with the production
snapshot and record:

1. the external backup location, byte size, checksum, restore result, and exact
   matching pre-cutover application release;
2. source and target counts/hashes for every production classification and
   exception disposition approved by a named operator;
3. target-only backend, portal, desktop, ML-service, report, map, artifact, and
   outdated-client smoke results;
4. the final release inventory hash from `scripts/verify_target_release.py`;
5. coordinator and independent-reviewer approval in the zero-legacy manifest.

Production must remain closed if any exception is unexplained, reconciliation
differs, a superseded object remains, or target-only smoke tests fail.
