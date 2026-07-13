# ADR-001: Canonical Reporting Periods

Status: **Accepted**

## Decision

Monthly reporting uses the IANA timezone `Asia/Manila`. A period is identified
across devices and environments by this immutable natural key:

```text
month:Asia/Manila:YYYY-MM
```

For example, June 2026 is `month:Asia/Manila:2026-06`.

The central `reporting_periods` table MAY use a UUID primary key, but MUST have a
unique constraint on the natural key. The UUID is an internal relational
identifier; the natural key is the portable capture and synchronization
identity. Edge records and outbound commands MUST carry the natural key. A
successful central acknowledgement MUST return both the natural key and central
UUID.

A label such as “June 2026” is derived presentation text. It MUST NOT be used as
a key, foreign key, duplicate check, idempotency input, or query boundary.

## Boundaries and classification

Periods are calendar boundaries in `Asia/Manila`, converted once to UTC and
stored as inclusive start and exclusive end:

```text
[start_at_utc, end_at_utc)
```

June 2026 therefore has:

```text
natural_key: month:Asia/Manila:2026-06
local_start: 2026-06-01T00:00:00+08:00
local_end:   2026-07-01T00:00:00+08:00
start_utc:   2026-05-31T16:00:00Z
end_utc:     2026-06-30T16:00:00Z
```

An event at `end_utc` belongs to the next period. Comparisons MUST use instants,
not formatted dates and not database-session timezone conversion.

At capture, the edge MUST atomically store:

- captured UTC timestamp;
- `Asia/Manila` business date;
- canonical natural period key;
- camera and site identity;
- event UUID.

Period classification MUST use the capture instant, never processing time,
submission time, receipt time, or the user’s currently displayed month. Events
without an authoritative period are quarantined from official submission with
an actionable error; no “current month” fallback is permitted.

## Period creation and timezone changes

- Local calendar boundaries MUST be resolved with an IANA timezone database,
  then persisted as immutable UTC instants.
- If a future timezone has an ambiguous or nonexistent boundary, period
  creation MUST fail until an operator supplies and approves the exact UTC
  bounds. The system MUST NOT choose an offset silently.
- A timezone database update MUST NOT rewrite an existing period’s UTC bounds.
- A site timezone change is effective-dated. Existing events and obligations
  retain the timezone and period assigned when they were created.
- Periods of the same type and timezone MUST NOT overlap.

## Submission membership

A local report revision MUST select only events whose stored period key matches
the requested period and whose capture instant is inside its UTC bounds. The
revision commits its exact event IDs or a safe per-camera half-open watermark in
the same transaction as its source batches and outbox item. Only selected events
may be acknowledged. Events captured during or after draft creation cannot be
consumed accidentally.

Historical completeness is based on frozen `reporting_obligations` for the
period, including eligibility, exemption, effective registration, site, and
timezone facts. The current enterprise registry MUST NOT redefine a historical
period.

## Required tests

- `23:59:59.999` local and `00:00:00.000` local fall into adjacent months.
- UTC instants around the `+08:00` boundary classify correctly.
- Delayed processing and restart do not change an event’s period.
- An unknown natural key blocks official submission.
- A concurrent capture is not included in an already committed source batch.
- A central acknowledgement maps the natural key to one stable central UUID.
