# TANAW Backend

This repository contains the central service for TANAW, a tourism monitoring
and reporting system for the City of San Pedro, Laguna.

## Purpose

The backend connects enterprise desktop applications and the LGU web portal.
It stores shared records, checks account permissions, and coordinates
monitoring, report review, notifications, and support.

## Main Features

| Feature                 | What it provides                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Accounts and access     | Sign-in, account activation, role permissions, password recovery, and account changes. |
| Enterprise monitoring   | Receives supported desktop updates for LGU monitoring views.                           |
| Reports                 | Receives submissions and supports review, consolidation, and final-report audits.      |
| Support requests        | Stores tickets and replies for follow-up.                                              |
| Email and notifications | Sends activation and recovery messages and records delivery status.                    |
| Activity history        | Records actions used for troubleshooting and audit.                                    |
| Live updates            | Notifies connected applications when relevant information changes.                     |
| Development sample data | Creates controlled local test records for demonstrations and workflow testing.         |

## How It Works

1. An enterprise desktop records visitor activity locally.
2. It sends supported monitoring updates and pending report submissions.
3. The backend stores the records and makes them available according to user roles.
4. LGU personnel review submissions and prepare final reports.
5. Report sources and activity records remain available for review.

PostgreSQL stores shared accounts, monitoring records, submissions, final reports,
support records, notifications, and activity history. Raw camera video, camera
passwords, and detailed camera-processing records stay on the enterprise device.
Open-space analytics are currently excluded from the central entrance/exit workflow.

### Account safeguards

New accounts receive an activation link and choose a password. Password recovery
uses an emailed verification code. Phone numbers are contact information and
are not used for SMS recovery.

Changing an activated account's email requires ownership verification and review
by another IT account. The initial IT account is protected against ordinary
editing, deactivation, and deletion. Startup account settings do not reset
existing credentials.

Email failures remain available for IT review and retry where appropriate.
An accepted delivery means the email provider accepted the request; it does not
confirm arrival in the recipient's inbox. Support conversations belong in
TANAW's ticket system, rather than replies to outgoing email.

## Tech Stack

| Technology                              | Purpose                                            |
| --------------------------------------- | -------------------------------------------------- |
| Python 3.14 and FastAPI                 | Run the service and expose its APIs.               |
| Pydantic                                | Validate incoming data and describe API responses. |
| PostgreSQL                              | Store central application records.                 |
| SQLAlchemy and asyncpg                  | Read and update the database.                      |
| Alembic                                 | Manage the PostgreSQL schema.                      |
| PyJWT and Argon2                        | Support signed sessions and password hashing.      |
| Brevo                                   | Send application email when enabled.               |
| WebSockets and PostgreSQL notifications | Deliver live change notifications.                 |
| pytest and Ruff                         | Check behavior and Python code quality.            |

## Code Organization

- **app/features:** accounts, authentication, monitoring, reporting, support,
  email, notifications, activity history, and related workflows.
- **app/api:** combines the service's routes.
- **app/core:** settings, security helpers, and shared policies.
- **app/db:** database sessions and schema validation.
- **alembic:** the PostgreSQL migration baseline.
- **tests:** unit, database integration, and architecture checks.

The service requires PostgreSQL and private environment settings. Its local
API provides interactive documentation at /docs when the service is running.
