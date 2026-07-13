# ADR-002: Metric Catalog and Evidence

Status: **Accepted**

## Metric evidence contract

Every metric that leaves the edge MUST include:

- `definition` and integer `definitionVersion`;
- numeric `value` or explicit `null`, plus `unit`;
- `grain`: `camera`, `site`, or `enterprise`;
- half-open `windowStart` and `windowEnd` UTC instants;
- timezone, business date or reporting-period key as applicable;
- source batch and permitted camera/device/site lineage;
- `provenance`: `camera_derived`, `operator_entered`, or `system_derived`;
- `quality`: `confirmed`, `degraded`, `estimated`, or `unknown`;
- monitored duration, expected duration, coverage ratio, and gap summary;
- server-derived classification: `official` or `simulation`.

Metrics with different definition versions, grains, windows, or classifications
MUST NOT be combined unless a catalog rule explicitly permits it. `null` means
unknown or unavailable. Zero is valid only when the relevant source was
monitored and observed zero.

## Catalog

| Definition                            | Meaning                                                                       | Unit                 | Valid grain               | Aggregation rule                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `visitor_entries` v1                  | Valid inward directional line crossings during the window                     | `crossings`          | camera, site, enterprise  | Sum only deduplicated, non-overlapping child sources with the same definition and window            |
| `visitor_exits` v1                    | Valid outward directional line crossings during the window                    | `crossings`          | camera, site, enterprise  | Same rule as entries                                                                                |
| `occupancy_current` v1                | Best known people-present snapshot at `observedAt`                            | `people`             | camera or site            | Never sum across time; site aggregation requires a declared non-overlapping camera topology         |
| `occupancy_peak` v1                   | Maximum valid site occupancy sample within the window                         | `people`             | site                      | Maximum, never sum; publish with coverage and sampling method                                       |
| `venue_local_unique_estimate` v1      | Estimate deduplicated only within one declared venue/tracker scope and window | `estimated_visitors` | camera or site            | Never interpreted as globally distinct people; cross-site totals use the separately named sum below |
| `sum_venue_local_unique_estimates` v1 | Arithmetic sum of eligible venue-local estimates                              | `estimated_visitors` | enterprise or final scope | Label exactly; cannot be called citywide unique visitors or distinct persons                        |
| `monitored_duration` v1               | Duration with valid monitoring evidence                                       | `seconds`            | camera or site            | Sum non-overlapping intervals; retain gap reasons                                                   |
| `coverage_ratio` v1                   | `monitored_duration / expected_duration` for the same window                  | `ratio`              | camera, site, enterprise  | Recompute from durations; do not average child percentages                                          |

`occupancy_current` is a live-state fact and MUST become `null` when its freshness
expires. A prior snapshot MUST NOT remain displayed as current. `occupancy_peak`
and unique estimates are report facts only when their source window and coverage
are explicit.

## Unique-count limitation

TANAW does not have a privacy-safe, authoritative identity spanning independent
enterprise venues. A person visiting two venues may appear in both local
estimates, and tracker loss may create duplicates inside a venue. Therefore:

- a venue-local estimate MUST be labeled “Estimated unique visitors at this
  venue” with its window and method;
- summing venue estimates MUST be labeled “Sum of venue-local unique visitor
  estimates”;
- the sum MUST NOT be labeled “unique people,” “distinct citywide visitors,” or
  an equivalent claim;
- no raw identity material may be uploaded to improve cross-venue deduplication.

## Provenance and demographics

`camera_derived` means generated from the camera pipeline. `operator_entered`
means supplied by an authenticated human and MUST include that method in official
views. `system_derived` means calculated from documented source facts.

Demographic facts are not camera-derived unless an approved, tested model and
legal/privacy policy explicitly makes them so. In the current target contract,
manual demographics are `operator_entered`. Missing demographics stay absent;
no fixed residence, age, gender, or source ratio may be generated.

## Quality and coverage

| Quality     | Meaning                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `confirmed` | All required evidence and validation passed for the declared method and coverage threshold |
| `degraded`  | Real evidence exists, but a known gap or detector/device problem reduces confidence        |
| `estimated` | The method is explicitly statistical or extrapolated and is disclosed                      |
| `unknown`   | No defensible value is available; `value` MUST be `null`                                   |

Quality MUST NOT be improved during aggregation. Unless a metric-specific method
says otherwise, required child quality has this conservative precedence:
`unknown`, then `degraded`, then `estimated`, then `confirmed`. The first status
present becomes the aggregate status. Reports MUST expose monitored/expected
duration and coverage gaps. Finalization policy may reject insufficient
coverage, but it MUST never hide it.

## Required tests

- Missing data renders as unavailable, not zero or a fabricated ratio.
- Occupancy expires and cannot be summed across time.
- Peak uses `max`, while coverage uses durations rather than averaged ratios.
- Mixed grains, windows, definitions, and classifications are rejected.
- The citywide UI/PDF never calls a venue-estimate sum distinct people.
- Operator-entered demographics are labeled accurately.
