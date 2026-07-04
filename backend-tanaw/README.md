# TANAW Backend

FastAPI backend for TANAW authentication, account management, enterprise
operational sync, report review, final-report consolidation, activity logging,
and controlled test-data tooling.

For installation, Docker Compose startup, local testing, and shutdown commands,
use the root [TL;DR test guide](../TLDR.md). The desktop application has its
own local setup guide in [desktop-tanaw/README.md](../desktop-tanaw/README.md).

## Purpose

The backend is the central API used by both TANAW clients:

- the LGU web portal uses it for authentication, account administration,
  dashboards, maps, Staff review, Admin monitoring, activity logs, and final
  reports;
- the enterprise desktop app uses it for authenticated telemetry, report
  synchronization, prepared test-count delivery, notifications, and account
  profile data.

Camera frames are not uploaded to the backend. Camera processing, tripwire
counting, local visitor estimation, and raw local event persistence stay inside
the enterprise desktop and ML service. The backend receives operational records
and workflow events after they have been produced locally.

## Main Responsibilities

- **Authentication and security**: login, logout, password changes, recovery
  flows, JWT issuance, protected bootstrap accounts, and role-aware access
  control.
- **Account management**: LGU and enterprise account creation, activation,
  profile metadata, enterprise identifiers, and role-specific account policies.
- **Operational sync**: enterprise telemetry, desktop app status, desktop report
  synchronization, prepared count packages, and sync audit trails.
- **Reporting workflow**: enterprise intake reports, Staff review statuses,
  final report generation, source-row audit data, and reporting activity logs.
- **Activity logging**: account, operational, reporting, and system events used
  by LGU monitoring and audit screens.
- **Test-data tooling**: explicit mock-data generation and cleanup for local
  demonstrations, QA, analytics, and end-to-end reporting tests.

## Project Structure

```text
app/
  api/                 # Top-level API router composition
  core/                # Settings, security, and shared application policies
  db/                  # SQLAlchemy engine, sessions, base model, metadata imports
  features/
    accounts/          # LGU/enterprise accounts, dependencies, services, APIs
    activity_logs/     # Operational, account, and workflow audit records
    auth/              # Login, logout, password, and recovery flows
    mock_data/         # Explicit CLI-driven test-data tooling
    operational/       # Telemetry, sync, intake reports, and final reports
alembic/               # Database migration files
tests/                 # Backend unit and integration tests
main.py                # FastAPI application entry point
```

The backend follows a feature-oriented layout. Shared infrastructure lives in
`app/core`, `app/db`, and `app/api`; domain behavior lives under
`app/features`.

## Data Boundaries

PostgreSQL stores central TANAW records: accounts, roles, telemetry snapshots,
enterprise submissions, final reports, final-report source rows, notifications,
and audit logs.

The backend does not own the enterprise camera ledger. Count events, current
draft metrics, occupancy corrections, visitor identity metadata, camera
settings, and local ML state are stored on the desktop device and synchronized
only through the operational APIs when appropriate.

## Mock Data Tooling

The backend includes guarded mock-data tooling for development and demos. It is
designed around a simple rule:

```text
mock producer, real pipeline
```

Generated records use the same tables and workflow shapes as real operational
records, but they are tagged with run provenance so they can be audited and
removed safely. Mock execution is explicit and disabled by default.

The root [TL;DR test guide](../TLDR.md) contains the supported commands for
creating, refreshing, inspecting, and removing generated data.

## Operational Workflow

The typical end-to-end reporting path is:

1. An enterprise desktop records local visitor counts and report data.
2. The desktop submits telemetry and intake reports to the backend.
3. LGU Staff review enterprise submissions in the web portal.
4. The backend consolidates accepted reports into a final city report.
5. Final report source rows and activity logs remain available for audit.

This keeps the central system focused on reporting, monitoring, and governance
while the privacy-sensitive camera processing remains at the enterprise edge.

## Related Documentation

- [Root system overview](../README.md)
- [TL;DR setup and test guide](../TLDR.md)
- [Frontend portal overview](../frontend-tanaw/README.md)
- [Enterprise desktop guide](../desktop-tanaw/README.md)
