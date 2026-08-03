# Backend architecture

TANAW is a modular FastAPI monolith. Business capabilities own their routes,
contracts, persistence models, commands, queries, and policies. The application
is intentionally not divided into global `routers/`, `schemas/`, and
`services/` directories because those layouts scatter one capability across
the entire repository.

## Capability boundaries

- `accounts` and `auth` together form the identity context.
- `reporting` owns report intake, reporting periods, review rules, and final
  report consolidation.
- `monitoring` owns telemetry, visitor insights, and operational alerts.
- `support` owns tickets and their conversation lifecycle.
- `notifications` owns in-application user notifications.
- `dashboard` is a read-only application query that combines reporting and
  monitoring projections.
- `mail`, `realtime`, `maintenance`, and `activity_logs` are supporting
  capabilities and infrastructure-facing adapters.

HTTP routers validate transport input, resolve authentication, call application
operations, and translate errors. Domain-policy modules do not import FastAPI or
SQLAlchemy. SQLAlchemy models retain the existing table names so architectural
changes do not alter the database contract.

## Transactions

The FastAPI database dependency provides one unit of work per HTTP request. A
successful request commits once and an unsuccessful request rolls back.
Lower-level application operations flush so multi-step changes remain atomic.
Background workers own their explicit transactions because they do not run
inside a request dependency. Security workflows that must persist rejected
attempt counters before returning an error also retain explicit transaction
ownership.

## Dependency direction

Domain policies are dependency-free. Routers depend on application operations;
application operations use persistence models and supporting adapters. Shared
code belongs in `core` only when it is genuinely domain-neutral. New code must
not recreate a generic catch-all feature such as the former `operational`
package.

The application factory in `app.main.create_app` is the composition root and
accepts settings, an engine, and a session factory for isolated integration
tests.
