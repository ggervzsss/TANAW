# TANAW target cutover rehearsal

- Evidence updated: **2026-07-15T13:01:00Z**
- Source revision: **`20260712_0019`**
- Target revision: **`20260715_0041`**
- Central target contract: **2.0.0 / generation 2**
- Local target schema: **8**
- Engineering status: **central migration and external restore rehearsal passed**
- Release status: **local target-only full-suite/build verification passed**
- Production W8-C: **not executed**
- Independent W8-D approval: **not signed**

This is engineering evidence for the repeatable hard-cutover mechanism. It is
not production acceptance. TANAW production must remain closed during W8-C
until the production snapshot is backed up, migrated, reconciled, deployed, and
smoke-tested, and an independent reviewer signs the exact W8-D inventory.

## Representative source checkpoint

The representative PostgreSQL source was exported in custom format outside the
database. It was restored into an empty database and confirmed at revision
`20260712_0019` before migration.

```text
Artifact: /tmp/tanaw_cutover_expanded_source_v2.dump
Size: 71547 bytes
SHA-256: 753df5fb7d83cbe27908a8d024b782c1099c19b7e419aac0a677dcc3953fb32b
```

The source contains one official enterprise/account and one linked example of
each superseded reporting path:

| Source object | Stable rehearsal identity | Count |
| --- | --- | ---: |
| `enterprise_report_submissions` | `22222222-2222-4222-8222-222222222222` | 1 |
| `enterprise_telemetry_snapshots` | `33333333-3333-4333-8333-333333333333` | 1 |
| `final_reports` | `44444444-4444-4444-8444-444444444444` | 1 |
| `final_report_sources` | `55555555-5555-4555-8555-555555555555` | 1 |

The source report carries 120 entries, 100 exits, peak occupancy 30, venue-local
unique estimate 110, and six demographic facts totaling 110. Its final report
references that exact source report.

## Migration and exception control

The restored database migrated to revision `20260714_0032` and stopped for
operator review. The open exception set was compared for exact equality before
the engineering-only waiver was applied:

| Ledger | Exact exception code | Count | Engineering disposition |
| --- | --- | ---: | --- |
| Report | `incomplete_review_history` | 1 | Waived; imported revision remains acceptance-blocked |
| Report | `missing_coverage_evidence` | 1 | Waived; imported revision remains acceptance-blocked |
| Report | `missing_source_lineage` | 1 | Waived; imported revision remains acceptance-blocked |
| Report | `unverified_historical_obligation` | 1 | Waived; imported revision remains acceptance-blocked |
| Telemetry | `missing_camera_lineage` | 1 | Waived; observation is not projected as current |
| Telemetry | `missing_epoch_sequence_evidence` | 1 | Waived; observation is not projected as current |
| Telemetry | `missing_metric_coverage` | 1 | Waived; observation is not projected as current |

There were no additional exceptions. No period, lineage, coverage, actor,
camera, epoch, sequence, or quality fact was guessed. A production dataset may
use a waiver only after a named operator approves the exact evidence; any
unknown or additional exception blocks W8-C acceptance.

After the exact engineering waiver, the database migrated through
`20260715_0041`. The temporary exception ledgers and every superseded source
relation were removed. An immediate second `alembic upgrade head` was a no-op,
and `alembic check` reported no new upgrade operations.

The same migration chain also passed against a fresh empty database from
revision 0001 through `20260715_0041`, followed by a clean `alembic check`.

## Target reconciliation

The restored-source replay at `20260715_0041` produced:

| Target evidence | Result |
| --- | --- |
| Matching `report_revisions` row | 1 |
| Report revision identity | `5410967d-37d9-5a14-bb1e-858c6263b050` |
| Preserved local revision identity | `legacy:22222222-2222-4222-8222-222222222222` |
| Canonical report payload hash | `sha256:d8c30dc454e1b7b3ef4a9cc3eb414396a8f2734bcc1f4e740b4c6d63fe32196d` |
| Accepted pointer / workflow state | Exact revision / `consolidated` |
| `visitor_entries` | `120.000000` |
| `visitor_exits` | `100.000000` |
| `occupancy_peak` | `30.000000` |
| `venue_local_unique_estimate` | `110.000000` |
| Demographic facts | 6, total 110 |
| Matching `telemetry_observations` row | 1 |
| Matching `report_finalizations` row | 1 |
| Finalization identity / exact items | `234bd1d5-871a-506c-b1ce-54fac406ead4` / 1 |
| `enterprise_sites` / `site_location_versions` | 1 / 1 |
| Final report content hash | `sha256:b02d1e5499407a572c0e48e8340519d3bcc289c50ba669537a381df6db132edf` |
| Superseded source/exception relations remaining | 0 |

The expanded source also reconciled nonzero topology, asset, preference,
profile-change, activity, device-health, email-outbox, seed-state, support,
system-setting, and notification records. The target contains one row in each
corresponding core/ownership table, five telemetry metric facts, one telemetry
observation, six report demographic facts, and the expected immutable report
review/final hierarchy. All four superseded source relations resolve absent
(`to_regclass(...) IS NULL`) after cutover.

Migration and exact catalog coverage passed 33 tests on the migrated database.
The catalog proof compares target tables and columns, indexes, sequences,
triggers, functions, partitions, native structural UUIDs, and absence of views
or foreign tables against the SQLAlchemy target model and explicit allowlists.

## External target restore drill

The migrated target was exported, restored into a second empty PostgreSQL
database, and validated independently:

```text
Artifact: /tmp/tanaw_rehearsal_target0041.dump
Size: 361652 bytes
SHA-256: 1fecc6fffd342b60f98e4b8f0820493eb18919dbc3aae03f92be61de3e4bb4a5
Restored revision: 20260715_0041
```

The restored target contains one report revision, one telemetry observation,
one report finalization, one enterprise site, and one immutable site-location
version. All five exact catalog tests passed against the restored database.
This proves that recovery uses a complete external checkpoint, not retained
legacy relations in the upgraded database.

## Application and release verification

The authoritative current commands are listed in
[`IMPLEMENTATION_COMPLETION_EVIDENCE.md`](IMPLEMENTATION_COMPLETION_EVIDENCE.md).
The final local record includes the fresh-0041 backend suite, all four static
gate groups, portal and desktop production builds, portal Playwright, Electron
Playwright no-secret/recovery/restart proof, and target source/build inspection.

The deterministic release inventory is generated with:

```shell
python3 scripts/verify_target_release.py --require-builds
```

Its inventory hash identifies the exact scanned source and build bytes; it is
not a cryptographic reviewer signature. W8-D still requires a named independent
reviewer to approve that exact inventory.

## Production W8-C gate

The engineering rehearsal does not satisfy W8-C. Before production is reopened,
the cutover operator must record all of the following for the production
snapshot and deployment:

1. maintenance-window approval and the identities of the coordinator, migration
   operator, restore operator, and independent reviewer;
2. stopped/drained write confirmation for central and durable edge queues;
3. external PostgreSQL and local-ledger backup locations, byte sizes, checksums,
   successful restore results, and exact matching pre-cutover application build;
4. exact source and target counts, normalized totals/hashes, lineage, final
   artifacts, topology/location history, assets, and every exception decision;
5. the deployed target release inventory hash and minimum-client rejection;
6. target-only backend, portal, desktop/ML, Admin Map, Staff review, Enterprise
   report, final artifact, notification, realtime, and recovery smoke results;
7. PostgreSQL and SQLite catalog absence proof plus source, OpenAPI, route,
   generated contract, package, and production-build absence proof; and
8. coordinator acceptance followed by independent W8-D signature.

Any unexplained exception or delta, failed invariant, remaining superseded
object, or failed target-only smoke test stops acceptance. Before acceptance,
rollback restores the complete external pre-cutover database/files and matching
application generation. It never selectively reads an old table.
