# ADR-007: Single client generation

Status: **Accepted**

TANAW supports one contract generation: API contract 2 and application package
generation 2.0.0. Desktop requests provide their authenticated device identity,
release ID, application version, and contract version. Unsupported clients are
rejected with HTTP 426 before a business write is parsed.

There is no v1 route, alias, DTO translator, fallback store, feature flag, or
mixed-generation deployment. A stale desktop preserves its immutable local
outbox and asks the operator to install the matching build; it does not
translate pending commands.

WebSocket and device connections follow the same compatibility policy. Portal
assets and the backend must come from the same release. Release evidence
records the backend, portal, desktop, ML service, OpenAPI, central baseline, and
local schema identities.

Recovery restores a backup created by the same release generation or recreates
an empty installation. It never reintroduces a previous application generation
or database structure.
