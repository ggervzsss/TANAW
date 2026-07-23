# TANAW Backend

The API exposes the canonical authenticated application gateway at `/realtime/ws` and readiness at `/ready/realtime`. See [the realtime architecture](../docs/REALTIME_ARCHITECTURE.md).

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
- **Test-data tooling**: explicit sample-data generation and cleanup for local
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
    sample_data/       # Development-only sample-data tooling
    operational/       # Telemetry, sync, intake reports, and final reports
alembic/               # Database migration files
tests/                 # Backend unit and integration tests
main.py                # FastAPI application entry point
```

The backend follows a feature-oriented layout. Shared infrastructure lives in
`app/core`, `app/db`, and `app/api`; domain behavior lives under
`app/features`.

## Database Migrations

Alembic is the only schema authority. Apply migrations before starting any API
or sample-data process:

```shell
uv run alembic upgrade head
uv run uvicorn main:app
```

Application startup validates the `alembic_version` revision and fails with an
actionable error when the database is missing or outdated. It never creates,
alters, or drops schema objects. Revision `20260720_0001` is the canonical TANAW
baseline and replaces the pre-release migration history. Existing development
databases from the old chain must be recreated before starting this version;
the baseline intentionally contains no compatibility or reconciliation logic.
Back up any data that must be retained before resetting PostgreSQL.

### Canonical account and enterprise ownership

The `accounts` table stores shared identity, authentication, role, status,
preferences, security state, and audit timestamps.
Enterprise-only business, location, capacity, and gateway fields live in
`enterprise_profiles`, whose `account_id` is both its primary key and a
one-to-one foreign key to `accounts.id`.

Operational records use that enterprise-profile key as their single owner
reference. API serializers derive the public enterprise ID through the
relationship, so child tables do not keep account-ID and enterprise-ID copies
that can disagree. Reports, telemetry, tickets, and final-report sources retain
only descriptive or metric snapshots needed to preserve what the
record represented when it was created. Admin, IT, and Staff accounts do not
have separate profile tables because they have no role-specific persisted
fields.

## Email Integration

TANAW supports two email modes. `EMAIL_DELIVERY_MODE=log` records development
messages locally without contacting an external provider. `EMAIL_DELIVERY_MODE=resend`
sends outbound transactional messages through Resend. New users receive a
single-use activation link and choose their own password; TANAW never sends a
password by email. Password recovery continues to use an emailed OTP. Account
phone numbers remain contact/profile information and are never used for SMS
delivery or phone-based OTPs.

Changing an activated account's registered email never updates the account
directly. TANAW sends a single-use, expiring ownership link to the proposed
address and a warning to the current address. Only after verification can a
different IT Personnel account approve the request. Approval atomically changes
the sign-in/recovery address, invalidates active sessions and password-recovery
challenges, and queues notices to both the old and new addresses. Replacing,
rejecting, cancelling, expiring, or deactivating the account invalidates the
pending request. An unactivated account's typo can still be corrected directly;
TANAW invalidates its old activation link and queues a new one to the corrected
address.

Activation links open the public web portal, expire after the configured number
of hours, and are invalidated when a replacement link is issued. Set
`FRONTEND_PUBLIC_URL` to the URL users can actually open—not the backend API URL.
Production configuration requires this value to be a public HTTPS URL.

## Startup Account Safety

`BOOTSTRAP_IT_USERNAME` and `BOOTSTRAP_IT_PASSWORD` are used only when TANAW
initializes a database that has no existing IT account. TANAW records
that initialization, persists the bootstrap account's protected identity in the
database, and never synchronizes the account from environment values again.
Removing the bootstrap variables after initialization does not remove that
protection. Password changes, activation state, lockouts, and session revocation
survive every backend restart, while account-management operations cannot edit,
reassign, deactivate, or delete the protected bootstrap identity.

Optional Admin, Staff, and secondary IT development accounts are created only
when `TANAW_SEED_DEVELOPMENT_ACCOUNTS=true`. Production rejects that switch,
placeholder bootstrap credentials, and short or default JWT secrets. Only
`BOOTSTRAP_IT_*` and `DEVELOPMENT_*` startup account environment names are
supported.

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

Secrets belong only in a private `.env` or deployment secret store. The root
`.env.example` contains the few values used for local Resend testing, while this
project's `.env.example` contains only the values required for production.

When a verified LGU domain becomes available, change `EMAIL_FROM_ADDRESS` and
remove `EMAIL_TEST_RECIPIENT`; no application code change is required.

Production starts only with `EMAIL_DELIVERY_MODE=resend`, a non-placeholder
Resend key, a verified custom sender domain, and no test-recipient restriction.
The official Resend endpoint and bounded provider timeout are code defaults.
Create a Resend key with **Sending access** and scope it to the verified TANAW
domain; TANAW does not need Full access. The process keeps one pooled HTTP client
for its lifetime and closes it during shutdown. `/health` reports API process
health, while `/ready/email` separately reports whether outbound email
infrastructure is initialized; deployment readiness checks should use both
endpoints.

Production also requires `EMAIL_SECRET_DERIVATION_KEY`, a random secret of at
least 32 characters that is different from `JWT_SECRET_KEY`. TANAW uses it to
derive activation links and recovery codes in worker memory after the source
transaction commits, so raw authentication secrets never enter the outbox.
Keep this key stable and backed up. Rotating it invalidates outstanding
activation links, password-recovery challenges, and outstanding email-change
verification links; drain or expire the outbox first, then issue replacements
after rotation.

## Transactional Email Delivery

Account activation, password recovery, business-email requests, and support
reply notifications write an `email_outbox` row in the same transaction as the
record that caused the message. The background worker sends only committed rows,
claims work with PostgreSQL row locks and fencing leases, and records every
attempt separately. A provider failure never rolls back an account or support
reply. Transient failures use bounded exponential retries with the same stable
Resend idempotency key; permanent failures remain visible to authorized IT
Personnel on the **Email Delivery** page.

Authentication outbox payloads contain source IDs and immutable, non-secret
template inputs—never raw activation links, OTPs, or rendered production bodies.
The worker derives those values in memory and checks the source is still valid
immediately before delivery. It also hashes the exact provider payload so a
retry cannot accidentally reuse an idempotency key with changed content.

An `accepted` status means Resend accepted the API request; it does not promise
that the recipient mailbox delivered it. Use the stored provider ID in the
Resend dashboard to inspect delivered, delayed, bounced, or suppressed events.
TANAW remains outbound-only and does not require an inbound-email webhook. Resend
retains idempotency keys for 24 hours, so TANAW stops automatic retries before
that boundary and marks an ambiguous older result for provider reconciliation
instead of risking a duplicate.

Password recovery applies database-backed limits per client IP, per normalized
email identifier, and globally within a bounded window.
Identifiers and IP addresses are HMAC-fingerprinted before being stored in rate
buckets or security telemetry. Public request responses remain generic for
active, pending, inactive, and unknown accounts, use a minimum response-time
floor, and state explicitly when an existing challenge is being reused during
the resend cooldown. These operational limits are maintained as validated code
defaults and intentionally omitted from deployment templates.

## Authentication and Email Data Retention

The backend runs one bounded retention batch immediately after startup and then
on the interval maintained in the backend configuration. Each record family is
claimed with `FOR UPDATE SKIP LOCKED`, limited by the configured code default,
and committed separately so cleanup does not hold a long transaction or block
another backend instance. Queued, leased, and retry-scheduled email is never
age-deleted.

The default policy retains consumed, invalidated, or expired activation tokens
and password-reset challenges for 30 days; password-reset rate buckets for 2
days; completed email-change requests and normal terminal outbox records for
180 days; and terminal failures or reconciliation records for 365 days. Active
expired email-change requests are first invalidated and their unsent
verification messages are cancelled. Production outbox rows never contain raw
OTPs or activation/email-change links. Development delivery previews live only
in a bounded in-memory feed and disappear when the backend process restarts;
the feed endpoint returns 404 in production.

`GET /maintenance/retention` exposes safe per-process counts and the most recent
run to IT Personnel. `POST /maintenance/retention/run` starts the same serialized
bounded cleanup manually and writes an activity log. `/ready/maintenance`
reports whether the scheduler is running. Change the code defaults only after
the LGU confirms its records policy; increasing a period preserves more audit
metadata, while decreasing it is irreversible after the next batch.

## Password Policy

TANAW uses a length-first password policy aligned with NIST SP 800-63B-4 for
its single-factor accounts. New and changed passwords must contain 15 to
128 Unicode code points. Spaces, password-manager output, and Unicode are
accepted; mandatory uppercase, lowercase, number, and symbol mixtures are not
used. TANAW normalizes new passwords to Unicode NFC before hashing and accepts
the canonically equivalent form during sign-in.

The backend is authoritative and rejects exact matches from TANAW's bundled
common, compromised, and context-specific blocklist. The web and desktop
clients use the same versioned blocklist data and messages for immediate
feedback. Existing passwords remain usable until their owner activates,
recovers, or changes the account password; this avoids silently locking out
seeded development users during rollout. One-time bootstrap and explicitly
enabled local development credentials remain operational configuration secrets,
not user-selected passwords, but normal password changes on those accounts use
the same policy.

## Data Boundaries

PostgreSQL stores central TANAW records: accounts, roles, telemetry snapshots,
enterprise submissions, final reports, final-report source rows, notifications,
and audit logs.

The backend does not own the enterprise camera ledger. Count events, current
draft metrics, occupancy corrections, visitor identity metadata, camera
settings, and local ML state are stored on the desktop device and synchronized
only through the operational APIs when appropriate.

## Sample Data Tooling

The backend includes development-only sample-data tooling for demos and QA. It
is designed around a simple rule:

```text
sample producer, real pipeline
```

Sample records use the same tables and workflow shapes as real operational
records. No mock-data table or provenance columns exist. Cleanup uses reserved
deterministic identifiers and relationships, so those identifiers must not be
reused for production records. The commands refuse to run in production.

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
