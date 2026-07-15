# TANAW report-workflow implementation completion evidence

- Target central head: **`20260715_0041`**
- Target local ledger: **schema 8**
- Target API/client generation: **2.0.0 / contract 2**
- Local engineering status: **implemented and verified**
- Production W8-C: **external, not executed**
- Independent W8-D sign-off: **external, not signed**

This is the requirement-to-evidence index for
`TANAW_REPORT_WORKFLOW_IMPLEMENTATION_PLAN.md`. The evidence below proves the
target implementation and offline engineering release. It does not authorize
or imply a production cutover. W8-C requires the production maintenance,
backup, migration, reconciliation, deployment, and smoke record. W8-D requires
a named independent reviewer to approve the exact post-cutover inventory.

## Outcome evidence map

| Required outcome | Authoritative implementation/evidence | Local result |
| --- | --- | --- |
| Capture-time canonical period and exact revision membership | Edge schema/report contract, period-ledger and local-report/outbox suites | Verified |
| Idempotent report/telemetry commands and logical side effects | Intake receipts/hashes, durable domain delivery, replay/conflict tests | Verified |
| Immutable Staff review and exact accepted revision | Workflow guards/events, accepted pointer, exact final item/version FKs | Verified |
| No fabricated official facts | Strict read envelopes, missing-evidence UI/artifact coverage | Verified |
| Explicit final scope | Scope members/type/title guards and finalization coverage | Verified |
| Fresh, monotonic Admin Map state | Sequenced intake, guarded projection, freshness runtime, refetch E2E | Verified |
| Durable outbox health and operator recovery | Exact acknowledgement and payload-free recovery/retry/restart E2E | Verified |
| Resilient capture and bounded identity retention | Serialized writer, reconnect/session/gaps, rollups and retention suites | Verified |
| Electron-only local trust boundary | Per-launch capability, private bootstrap, strict IPC/protocol, no-secret E2E | Verified |
| Normalized central ERD | Alembic 0020–0041, SQLAlchemy model, migrated/restored exact catalog | Verified |
| Frozen historical obligations | Effective-date location/obligation snapshots and acceptance blockers | Verified |
| Official/simulation isolation | Server classification, separate lineage/storage/tooling and mixed-source guards | Verified |

## Delegation-card audit

| Cards | Completion evidence | Local status |
| --- | --- | --- |
| W0-A–W0-C | ADR-001–007, generated contract, characterization, missing-data/provenance coverage | Verified |
| W1-A–W1-C | Normalized topology/location, reporting, live-state, telemetry and health ERD; exact catalog | Verified at 0041 |
| W1-D | Target-only schema 8 and external v5/v6/v7 cutover/rollback coverage | Verified |
| W2-A–W2-D | Period assignment, atomic membership, serialized retention, reconnect and coverage gaps | Verified |
| W3-A–W3-D | Idempotent intake, exact outbox recovery, durable sync health and domain delivery | Verified |
| W4-A–W4-D | Immutable review/finalization, authoritative Staff UI, obligations and notifications | Verified |
| W5-A–W5-D | Sequenced telemetry, freshness/retention, Admin Map and realtime reconciliation | Verified |
| W6-A–W6-B | All-surface local authorization, process trust, credential ownership and no-secret logs | Verified |
| W7-A–W7-C | Domain modularization, normalized assets, durable audit and bounded retention | Verified |
| W8-A | 0019→0041 replay, exact exceptions/reconciliation, dump/restore/catalog and full local application/E2E gates | Engineering rehearsal passed |
| W8-B | One 2.0.0 generation, mandatory upgrade, target contract and source/build inventory | Engineering release passed |
| W8-C | Production backup/drain/migration/deployment/reconciliation/reopen | External; not executed |
| W8-D | Post-production inventory signed by coordinator and independent reviewer | External; not signed |

## Final local verification record

All commands ran against the target-only worktree and, for PostgreSQL coverage,
a clean database migrated through revision `20260715_0041`.

| Gate | Exact local result |
| --- | --- |
| Backend PostgreSQL/unit suite | 512 passed |
| Backend Ruff | Passed |
| Backend format check | Passed |
| Backend mypy | Passed |
| Backend Pyright | Passed |
| ML-service suite | 200 passed |
| ML-service Ruff | Passed |
| ML-service format check | Passed |
| ML-service mypy | Passed |
| ML-service Pyright | Passed |
| Portal unit suite | 82 passed |
| Portal lint/type/build | Passed |
| Portal Playwright | 13 passed; 1 credential-gated real-backend scenario skipped |
| Desktop unit suite | 98 passed |
| Desktop lint/type/build | Passed |
| Desktop renderer Playwright | 7 passed |
| Electron Playwright | 1 passed, including capability/credential no-secret capture, outbox recovery, and ML-service restart persistence |
| Central migration/catalog | Fresh 0001→0041, expanded 0019→0041 replay, no-drift check, exact exception control, target dump/restore and restored catalog passed |
| Target source/build verifier | Passed with `--require-builds`; 583 files inspected |

The Playwright skip is explicit rather than hidden: that scenario requires
external credentials for its real-backend environment. Target report, Staff,
Admin Map, auth/realtime, desktop sync, recovery, restart, and no-secret behavior
are covered by the completed local suites above. The credential-gated scenario
must be exercised with production deployment credentials during W8-C smoke
verification.

The verifier deliberately does not embed its inventory hash in this scanned
document: editing that value would change the inventory itself. Capture the
printed `inventorySha256` from the immutable candidate build as an external
W8-C/W8-D release artifact.

## Reproduction commands

Backend:

```shell
cd backend-tanaw
TANAW_TEST_DATABASE_URL=<fresh-postgresql-asyncpg-url> UV_CACHE_DIR=/tmp/uv-cache uv run pytest -q
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
UV_CACHE_DIR=/tmp/uv-cache uv run alembic check
```

ML service:

```shell
cd desktop-tanaw/ml-service
UV_CACHE_DIR=/tmp/uv-cache uv run python -m unittest discover -s tests
UV_CACHE_DIR=/tmp/uv-cache uv run ruff check .
UV_CACHE_DIR=/tmp/uv-cache uv run ruff format --check .
UV_CACHE_DIR=/tmp/uv-cache uv run mypy .
UV_CACHE_DIR=/tmp/uv-cache uv run pyright
```

Portal and desktop:

```shell
cd frontend-tanaw
npm run test && npm run lint && npm run type && npm run build && npm run test:e2e

cd ../desktop-tanaw
npm run test && npm run lint && npm run type && npm run build
npm run test:e2e
```

Release inventory:

```shell
cd /path/to/TANAW
python3 scripts/verify_target_release.py --require-builds
```

## External acceptance record

| Gate | Status | Required authority/evidence |
| --- | --- | --- |
| Production W8-C | Not executed | Named cutover/restore operators; production backup, migration, deployment, reconciliation and smoke record |
| Independent W8-D | Not signed | Exact immutable W8-C inventory and named independent reviewer approval |

Local engineering completion is not production completion. W8-C and W8-D
cannot be self-attested by the implementation agent or inferred solely from
green local tests.
