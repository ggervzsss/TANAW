# ADR-005: Simulation Isolation

Status: **Accepted**

## Decision

Every enterprise, site, device, camera, observation, report obligation, report
revision, domain event, alert, notification, and final report is classified as
`official` or `simulation`. Classification is assigned from authenticated,
server-owned topology and MUST NOT be selected or promoted by a client payload.
There is no `hybrid` official state.

Simulation is test/training data. It may exercise the same target contracts, but
it is never evidence for government reporting or operational health.

## Isolation rules

- Simulation enterprises/sites/devices are created only through explicitly
  authorized simulation administration operations.
- A real principal/device cannot submit data for simulation topology, and a
  simulation principal/device cannot submit for official topology.
- Every query, cache key, aggregate, background job, WebSocket topic, export,
  alert rule, and notification projection MUST include classification.
- Official endpoints default to and enforce `official`; they do not accept a
  client filter that widens the query to simulation.
- Simulation views MUST carry a persistent, visible “Simulation” banner and
  watermark. Data cannot appear identical to an official report or PDF.
- Official and simulation rows MUST NOT share one final report, source batch,
  aggregate, artifact, compliance result, or alert.
- A simulation record cannot be reclassified in place. Promotion requires a new
  official record generated from independently valid official evidence; test
  facts are never copied into it.
- Seed/reset/purge jobs MUST target simulation classification explicitly and
  MUST be incapable of deleting official records.

Database checks/FKs or transaction-level constraints MUST ensure that child
classification matches its parent topology. Application filters alone are not
sufficient. Event consumers revalidate classification before producing an
official projection.

## UI and observability

Simulation counts, latency, failures, and dead letters use separate telemetry
dimensions and dashboards. They do not page official operators unless a
simulation-specific alert is intentionally configured. Screens and exports show
classification from the server; client-side `sourceKind` or mock toggles are not
authoritative.

## Required tests

- Client claims cannot promote simulation data to official.
- Mixed-classification source selection rejects the whole finalization.
- Official queries/caches/WebSocket subscriptions contain no simulation rows.
- Simulation reset cannot modify official rows.
- Simulation screenshots and PDFs remain visibly watermarked.
