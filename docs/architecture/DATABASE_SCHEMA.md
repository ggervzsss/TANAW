# TANAW database schema

## Required identity

- Central Alembic revision: `20260715_0001`
- Central schema files: one initial Alembic revision plus its database DDL
  companion
- Local SQLite schema: version `8`
- API/client contract: version `2`
- Package generation: `2.0.0`
- Release ID: `tanaw-release-2`

## Design boundaries

- topology owns enterprise, site, effective location, device, camera, and
  membership identity;
- telemetry owns immutable observations/facts and bounded current live-state
  projections;
- reporting owns canonical periods, revisions, source batches, review workflow,
  obligations, and intake receipts;
- final reporting owns explicit scope, immutable versions/items, and artifacts;
- events/outboxes own delivery state separately from business records;
- official and simulation records are structurally isolated;
- local raw evidence remains in the schema-8 edge ledger and never becomes an
  image or identity store in PostgreSQL.

## Release inventory

Run `python3 scripts/verify_release.py` to check required architecture paths,
the initial schema revision, operational contract, package versions, release
identity, and local schema version. Use `--require-builds` only for a final built
release.
