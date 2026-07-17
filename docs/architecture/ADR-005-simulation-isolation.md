# ADR-005: Simulation Isolation

Status: **Accepted**

## Decision

Every enterprise, site, device, camera, observation, report obligation, report
revision, domain event, alert, notification, and final report is classified as
`official` or `simulation`. Classification is assigned from authenticated,
server-owned topology and MUST NOT be selected or promoted by a client payload.
There is no `hybrid` official state.

Simulation is test/training data. It may exercise the same application contracts, but
it is never evidence for government reporting or operational health.

The repository `mockdata-*` commands are a separate non-production fixture
loader, not a simulation-data ingestion path. When explicitly enabled, they
create official-shaped records so developers can exercise the normal Staff and
enterprise UX. The loader records every owned resource ID, uses a
transaction-local cleanup guard, and is forbidden in production.

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
- Simulation seed/reset/purge jobs MUST target simulation classification
  explicitly. The separate mock fixture loader may delete only official-shaped
  records whose exact IDs are present in its active run manifest; it must never
  select real records by date, name, email, or broad classification.

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
- Simulation reset cannot modify official rows; mock fixture cleanup cannot
  modify official rows outside its exact run manifest.
- Simulation screenshots and PDFs remain visibly watermarked.
