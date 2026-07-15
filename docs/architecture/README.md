# TANAW Target Architecture Contracts

- Status: **Accepted for implementation**
- Contract generation: **2**
- Primary business timezone: **Asia/Manila**

These decisions freeze the Wave 0 contracts from
`TANAW_REPORT_WORKFLOW_IMPLEMENTATION_PLAN.md`. They are normative for the
backend, portal, desktop, and local ML service. Implementations may add fields
without weakening an invariant, but changing a decision requires an explicit
architecture decision that updates every affected contract and test fixture.

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Contract index

1. [ADR-001: Canonical reporting periods](ADR-001-canonical-reporting-periods.md)
2. [ADR-002: Metric catalog and evidence](ADR-002-metric-catalog.md)
3. [ADR-003: Report workflows and final scope](ADR-003-report-workflows-and-final-scope.md)
4. [ADR-004: Version 2 envelopes and acknowledgements](ADR-004-v2-envelopes-and-acknowledgements.md)
5. [ADR-005: Simulation isolation](ADR-005-simulation-isolation.md)
6. [ADR-006: Electron-to-ML capability](ADR-006-local-capability-contract.md)
7. [ADR-007: Client compatibility and hard cutover](ADR-007-client-cutover.md)
8. [Zero-legacy manifest](ZERO_LEGACY_MANIFEST.md)
9. [Target cutover rehearsal](CUTOVER_REHEARSAL.md)

## System-wide invariants

- Raw frames, facial imagery, ReID embeddings, appearance metadata, and camera
  credentials MUST remain on the enterprise device.
- Unknown facts MUST remain unknown. A missing value MUST NOT become zero,
  “Stable,” a demographic ratio, an actor, a timestamp, or a camera row.
- Identity, role, enterprise ownership, preparer, and data classification MUST be
  derived by the receiving server, not trusted from a client payload.
- Official report facts and accepted/finalized versions are immutable. A
  correction creates a new revision or version and an append-only audit event.
- Official and simulation records MUST NOT share a report, final report,
  notification aggregate, map aggregate, or export.
- Retried commands MUST converge to one durable business result.
- The upgraded production system has one target read/write path. Migration
  adapters and all superseded objects are removed before production reopens.
