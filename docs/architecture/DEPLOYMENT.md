# TANAW deployment

TANAW services share one release identity, API contract, and database schema.
Install the schema before starting application processes.

## Central PostgreSQL

1. Stop TANAW services if they are running.
2. Point `DATABASE_URL` at a new, empty PostgreSQL database.
3. From `backend-tanaw`, run `uv run alembic upgrade head`.
4. Confirm `alembic_version.version_num` is `20260715_0001`.
5. Run `uv run alembic check`; it must report no new upgrade operations.
6. Start only applications from the same release.

The initial revision creates the complete ERD, constraints, indexes, sequences,
partitions, functions, and triggers in an empty database.

## Enterprise local SQLite

The ML service creates local ledger schema 8 during first use. If local storage
is invalid or disposable, run `./scripts/local-data-reset` (or the PowerShell
equivalent) before starting the desktop application again.

## Manual acceptance

After static and schema checks pass, an operator should verify these flows in a
non-production environment:

- enroll an enterprise/site/camera and confirm no image or credential reaches
  PostgreSQL;
- create CCTV count evidence, prepare a report, synchronize it, and confirm one
  immutable revision and exact source membership;
- review and accept the revision as Staff, then create and verify a scoped final
  report and artifact;
- confirm the Admin Map receives sequenced live state and changes to stale or
  offline after its freshness deadline;
- retry one failed outbox item and confirm the same command is acknowledged once;
- generate simulation data and confirm it never mixes with official reports,
  map aggregates, notifications, or final reports.

## Recovery

Before real data exists, recovery is to recreate the empty database and reset
the local ledger. After real data exists, recovery uses a verified backup made
from the same application release and schema revision.
