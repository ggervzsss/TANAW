# TANAW architecture verification

## Architecture inventory

- Central schema authority is revision `20260715_0001` plus static database DDL.
- The baseline creates the normalized topology, reporting, final-report,
  telemetry/live-state, events, delivery, security, support, and simulation
  boundaries directly in an empty PostgreSQL database.
- Local schema 8 is created directly and verified against its declared catalog.
- Runtime, API, portal, desktop, and release configuration use one release ID
  and contract generation.

## Required verification record

Before staging a release, record the results of:

- backend Ruff, Ruff format, mypy, and Pyright;
- ML-service Ruff, Ruff format, mypy, and Pyright;
- portal lint and type checks;
- desktop lint and type checks;
- Alembic upgrade and no-drift check on an empty PostgreSQL database;
- schema and catalog tests;
- `python3 scripts/verify_release.py`.

Interactive web and desktop acceptance remains a manual operator activity. Use
the checklist in [DEPLOYMENT.md](DEPLOYMENT.md).
