# ADR-004: Version 2 Envelopes and Acknowledgements

Status: **Accepted**

## Common command rules

Every retryable write uses contract generation 2 and a stable client-generated
idempotency key:

```json
{
  "contractVersion": 2,
  "commandId": "018fb735-2fc8-7f5f-a117-001122334455",
  "idempotencyKey": "report:install-42:local-revision-0190",
  "occurredAt": "2026-07-01T00:02:10.123Z",
  "expectedVersion": 3,
  "payload": {}
}
```

- `commandId` identifies one command attempt lineage and is a UUID.
- `idempotencyKey` identifies the intended durable business effect and is stable
  across transport retries.
- `occurredAt` is an RFC 3339 UTC instant, not server receipt time.
- `expectedVersion` is required for mutations of an existing logical resource
  and omitted only when the command creates a resource without a prior version.
- The receiver validates a bounded schema, canonicalizes the accepted payload,
  and stores a SHA-256 payload hash with the idempotency record.
- Same key and hash returns the original acknowledgement. Same key and a
  different hash returns `409 IDEMPOTENCY_PAYLOAD_CONFLICT`.
- An acknowledgement is returned only after the business transaction and its
  domain event are durable. Notification, audit projection, and WebSocket
  delivery happen asynchronously from the transactional event.
- Client-supplied account, role, enterprise, preparer, actor, and official versus
  simulation classification fields are rejected or ignored; they never override
  authenticated server context.

Canonical hashing uses UTF-8 JSON with object keys sorted lexicographically,
no insignificant whitespace, normalized RFC 3339 UTC timestamps, exact decimal
representations defined by the schema, and arrays kept in contract-defined
order. The server returns the stored hash so the sender can detect corruption.

## Telemetry v2

The idempotency key is
`telemetry:{deviceId}:{counterEpoch}:{sequence}`. `counterEpoch` is a UUID
rotated only when the device sequence is intentionally reset; `sequence` is a
strictly increasing unsigned integer within an epoch.

Before sending an epoch's telemetry, the device performs an idempotent
authenticated epoch-start command containing the new UUID and its expected
previous epoch. The server assigns a strictly increasing integer
`epochGeneration`. A device restored behind the server state cannot silently
replace the active epoch; it must recover through an explicit reset operation.
Current-state ordering is lexicographic
`(epochGeneration, sequence)`. UUID text and receipt time are never ordering
keys. Observations may queue locally before epoch registration, but cannot update
central live state until the server has acknowledged their generation.

```json
{
  "contractVersion": 2,
  "commandId": "018fb735-2fc8-7f5f-a117-001122334455",
  "idempotencyKey": "telemetry:device-7:759f9ef7-79dd-4b42-b05d-77acc10d4298:1842",
  "occurredAt": "2026-07-13T08:15:03.420Z",
  "payload": {
    "deviceId": "device-7",
    "counterEpoch": "759f9ef7-79dd-4b42-b05d-77acc10d4298",
    "epochGeneration": 12,
    "sequence": 1842,
    "observedAt": "2026-07-13T08:15:03.420Z",
    "metrics": [
      {
        "definition": "occupancy_current",
        "definitionVersion": 1,
        "value": 17,
        "unit": "people",
        "grain": "site",
        "windowStart": "2026-07-13T08:14:33.420Z",
        "windowEnd": "2026-07-13T08:15:03.420Z",
        "timezone": "Asia/Manila",
        "provenance": "camera_derived",
        "quality": "confirmed",
        "coverage": {
          "monitoredSeconds": 30,
          "expectedSeconds": 30,
          "gapCount": 0
        }
      }
    ],
    "deviceHealth": {
      "service": "healthy",
      "cameraStates": [{ "cameraId": "camera-1", "state": "streaming" }]
    },
    "syncHealth": {
      "pendingCount": 0,
      "oldestPendingAt": null,
      "lastAcknowledgedAt": "2026-07-13T08:14:33.310Z",
      "lastFailureAt": null,
      "lastFailureClass": null
    }
  }
}
```

Site ownership and source classification are derived from the authenticated
device. The current-state projection advances only when the epoch/sequence
ordering rule says the envelope is newer. A valid but older envelope may be
retained as history, but MUST NOT roll current state backward.

```json
{
  "contractVersion": 2,
  "commandId": "018fb735-2fc8-7f5f-a117-001122334455",
  "disposition": "created",
  "payloadHash": "sha256:7a8e...",
  "acknowledgedAt": "2026-07-13T08:15:03.510Z",
  "resource": {
    "observationId": "5a0db683-82a7-4b56-9f08-cde06f912edb",
    "siteId": "018fb8ff-8328-7f5f-89ee-aabbccddeeff",
    "counterEpoch": "759f9ef7-79dd-4b42-b05d-77acc10d4298",
    "epochGeneration": 12,
    "sequence": 1842,
    "liveStateVersion": 921,
    "becameCurrent": true
  }
}
```

`disposition` is `created` or `replayed`. `becameCurrent` communicates projection
ordering and is not an error. Sync health uses the durable outbox backlog only;
it MUST NOT use the number of events sent immediately before acknowledgement.

## Report submission v2

The idempotency key is stable for one immutable local revision, for example
`report:{installId}:{localRevisionId}`.

```json
{
  "contractVersion": 2,
  "commandId": "018fbf1a-9bf0-7f5f-a70e-001122334455",
  "idempotencyKey": "report:install-42:local-revision-0190",
  "occurredAt": "2026-07-01T00:02:10.123Z",
  "expectedVersion": 2,
  "payload": {
    "periodKey": "month:Asia/Manila:2026-06",
    "localRevisionId": "local-revision-0190",
    "sourceWindow": {
      "start": "2026-05-31T16:00:00Z",
      "end": "2026-06-30T16:00:00Z"
    },
    "sourceBatches": [
      {
        "batchId": "local-batch-22",
        "cameraId": "camera-1",
        "eventCount": 841,
        "eventSequenceStart": 1000,
        "eventSequenceEndExclusive": 1841,
        "aggregateHash": "sha256:c0ff..."
      }
    ],
    "metrics": [],
    "demographicFacts": [],
    "coverage": {
      "monitoredSeconds": 2419200,
      "expectedSeconds": 2592000,
      "gaps": [{ "reason": "stream_unavailable", "durationSeconds": 172800 }]
    },
    "notes": null
  }
}
```

The source window MUST equal the canonical period bounds, and every source batch
and metric MUST belong to that period. Watermarks are monotonic per-camera event
sequences, never lexical event-UUID ranges. Source membership and hashes are
immutable.

```json
{
  "contractVersion": 2,
  "commandId": "018fbf1a-9bf0-7f5f-a70e-001122334455",
  "disposition": "created",
  "payloadHash": "sha256:31aa...",
  "acknowledgedAt": "2026-07-01T00:02:10.301Z",
  "resource": {
    "periodKey": "month:Asia/Manila:2026-06",
    "reportingPeriodId": "c0a285bb-fc8f-4d50-a790-9f61ef90a6da",
    "enterpriseReportId": "bd6cf48b-2fc4-49a9-9b18-75a7c488d07c",
    "reportRevisionId": "acef4061-cb69-4cf1-88bb-dd2e310c95d9",
    "revisionNumber": 3,
    "workflowState": "submitted",
    "logicalVersion": 3
  }
}
```

The desktop marks only this acknowledged outbox item, local revision, and source
batch as acknowledged. A global “mark all synced” operation is forbidden.

## Error contract

Errors use a stable code and current resource version when relevant:

```json
{
  "contractVersion": 2,
  "error": {
    "code": "STALE_RESOURCE_VERSION",
    "message": "The report changed after this command was created.",
    "retryable": false,
    "currentVersion": 4,
    "currentState": "accepted"
  }
}
```

Validation, authorization, hash conflict, and stale-state responses are
deterministic and become visible dead-letter/action-required items. Timeouts,
connection failures, rate limits with retry metadata, and server-unavailable
responses are retried with bounded exponential backoff and jitter. One failed
item MUST NOT block unrelated ready items.

## Required tests

- Replaying either envelope 100 times produces one durable logical effect.
- Same key/different hash returns a conflict without mutation.
- Lost acknowledgement followed by retry returns the original resource IDs.
- A lower telemetry sequence cannot replace current state.
- Report acknowledgement maps period key to central UUID and exact revision.
- A committed business command survives a publisher crash and emits its domain
  event after restart without duplicate logical notifications.
