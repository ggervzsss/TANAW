# Operational Observability

Status: **Implemented contract**

TANAW exposes operational evidence without report payloads, camera credentials,
capabilities, access tokens, email content, or personal visitor data. These
signals describe delivery and projection state; they are not a second business
data store.

## Central API

An authenticated IT account reads `GET /maintenance/operations`. The response
combines process counters with durable database gauges and labels the process
counters as `processInstanceOnly: true`.

Fixed counter dimensions are:

- period-classification failures;
- report command replay, hash conflict, revision conflict, and state-transition
  conflict;
- finalization replay/conflict, scope type, and artifact integrity failure;
- telemetry replay and out-of-order projection;
- domain-event consumer deduplication, retry, and dead letter;
- supported-client requests and incompatible-client rejections.

Lag observations contain only counts and latest/maximum seconds for telemetry
observed-to-received time and domain-event available-to-published time. Durable
gauges include the delivery queue lifecycle, oldest pending time/age, and fresh,
stale, offline, and never-observed official site counts. A site continues to age
from stored deadlines when no new telemetry arrives.

The IT dashboard polls this endpoint every 30 seconds and surfaces delivery
backlog/dead letters and degraded live-site counts. Process counters are also
emitted as structured, payload-free application log lines for aggregation by
the deployment logging platform.

## Local service API

Only the authenticated Electron process can read
`GET /diagnostics/operations` through the named
`diagnostics.operations` IPC operation. It reports:

- exact official outbox pending, retry, dead-letter, attempt, oldest-pending,
  last-acknowledgement, and last-failure state;
- serialized SQLite writer lock wait and transaction duration observations,
  commits, rollbacks, and concurrency;
- durable persistence error and unresolved-error counts;
- camera reconnect attempts, active sessions, monitored/expected seconds,
  coverage ratio, and gap count for the current canonical period.

Outbox recovery list/detail operations expose only payload-free operational
summaries. A manual retry records its operator reason as a durable attempt with
the `manual_retry` error class; it does not expose or mutate the command payload,
hash, idempotency key, endpoint, or revision identity. Recovery counters continue
to derive from the durable outbox after process restart.

Reconnect logs contain a monitoring-session identifier, bounded delay, and a
safe reason code. They never contain a stream URL or credential. The first
restored frame produces a corresponding restoration log; durable coverage gaps
remain the source of report downtime evidence.

Release log capture must inject canary capability and camera-credential values,
exercise launch, health, stream/control denial, report failure/retry, and
service restart, and prove that neither canary appears in Electron, renderer,
ML-service, request, URL, or error output. Source scans alone are not sufficient
no-secret evidence.

## Release gates

Keep TANAW closed when any of the following is true:

- a canonical period is misclassified or a reconciliation delta is unexplained;
- a replay creates another logical revision, transition, notification, or final;
- a required official outbox item is dead-lettered without explicit resolution;
- an immutable final cannot be reconstructed and hash-verified;
- stale/offline evidence is presented as current;
- local capability, central RBAC, or release-generation enforcement can be bypassed;
- the runtime catalog, API, source, build, or local ledger differs from the release inventory.

Operator alert thresholds are deployment policy, but must use the durable
counts/ages above. They must not substitute raw event counts for acknowledged
outbox state.

The authoritative gate/result ledger is
[`ARCHITECTURE_VERIFICATION.md`](ARCHITECTURE_VERIFICATION.md).
Production dashboard thresholds, alert routes, and named on-call owners are
deployment inputs and are not self-certified by this repository.
