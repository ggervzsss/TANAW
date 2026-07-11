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
    mail/              # Outbound Resend delivery and email templates
    mock_data/         # Explicit CLI-driven test-data tooling
    operational/       # Telemetry, sync, intake reports, and final reports
alembic/               # Database migration files
tests/                 # Backend unit and integration tests
main.py                # FastAPI application entry point
```

The backend follows a feature-oriented layout. Shared infrastructure lives in
`app/core`, `app/db`, and `app/api`; domain behavior lives under
`app/features`.

## Email Integration

TANAW supports two email modes. `EMAIL_DELIVERY_MODE=log` records development
messages locally without contacting an external provider. `EMAIL_DELIVERY_MODE=resend`
sends outbound transactional messages through Resend. New users receive a
single-use activation link and choose their own password; TANAW never sends a
password by email. Password recovery continues to use an emailed OTP. Account
phone numbers remain contact/profile information and are never used for SMS
delivery or phone-based OTPs.

Activation links open the public web portal, expire after the configured number
of hours, and are invalidated when a replacement link is issued. Set
`FRONTEND_PUBLIC_URL` to the URL users can actually open—not the backend API URL.
Production configuration requires this value to be a public HTTPS URL.

## Startup Account Safety

`BOOTSTRAP_IT_USERNAME` and `BOOTSTRAP_IT_PASSWORD` are used only when TANAW
initializes a database that has no existing or legacy IT account. TANAW records
that initialization, persists the bootstrap account's protected identity in the
database, and never synchronizes the account from environment values again.
Removing the bootstrap variables after initialization does not remove that
protection. Password changes, activation state, lockouts, and session revocation
survive every backend restart, while account-management operations cannot edit,
reassign, deactivate, or delete the protected bootstrap identity.

Optional Admin, Staff, and secondary IT development accounts are created only
when `TANAW_SEED_DEVELOPMENT_ACCOUNTS=true`. Production rejects that switch,
placeholder bootstrap credentials, and short or default JWT secrets. Existing
deployments may continue using the legacy `DEFAULT_IT_*` and `TEMPORARY_*`
environment names temporarily; the backend maps them to the new settings for
backward compatibility, but new configuration should use `BOOTSTRAP_IT_*` and
`DEVELOPMENT_*`.

Normal IT account recovery should use the emailed password-reset OTP. If an IT
account is inactive, another active IT account must review and reactivate it
through Accounts Management; this produces the normal TANAW activity records.
Keep at least two official IT accounts after deployment so recovery never
depends on database access. The one-time bootstrap variables are not an
emergency reset mechanism: adding or changing them after initialization has no
effect. If every IT account and mailbox is unavailable, a database administrator
must follow the LGU's controlled incident-recovery process, preserve an audit
record of the authorization, and restore access explicitly rather than deleting
the `startup-bootstrap-v1` marker or restarting TANAW with a known password.

The Resend-managed development sender can deliver only to the Resend account
email, so set `EMAIL_TEST_RECIPIENT` until a custom sending domain is verified.
Support requests and ticket replies are submitted directly to the TANAW API and
stored in the Support Tickets queue. TANAW does not receive or parse inbound
email.

Secrets belong only in a private `.env` or deployment secret store:

```dotenv
EMAIL_DELIVERY_MODE=resend
RESEND_API_KEY=replace_with_your_private_key
EMAIL_FROM_NAME=TANAW
EMAIL_FROM_ADDRESS=onboarding@resend.dev
EMAIL_TEST_RECIPIENT=the-email-used-to-register-with-resend@example.com
FRONTEND_PUBLIC_URL=http://localhost:5173
ACCOUNT_ACTIVATION_TTL_HOURS=24
```

When a verified LGU domain becomes available, change `EMAIL_FROM_ADDRESS` and
remove `EMAIL_TEST_RECIPIENT`; no application code change is required.

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
