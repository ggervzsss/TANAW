# ADR-003: Report Workflows and Final Scope

Status: **Accepted**

## Enterprise-report model

An obligation identifies what an enterprise owes for one canonical period. An
`enterprise_report` is the logical workflow record for that obligation. Each
submission creates an immutable `report_revision`; it never overwrites a prior
revision. Review actions are append-only `report_review_events` and update the
logical report under optimistic concurrency.

The logical states are:

```text
                 Staff return
                +------------+
                v            |
not_submitted -> submitted -> returned
                    |            |
                    |            +-- new immutable revision --> submitted
                    v
                 accepted -- atomic finalization --> consolidated
                    |
                    +-- explicit pre-final correction --> returned
```

`not_submitted` belongs to the obligation projection; no empty report row is
required.

| Command                      | From                    | To             | Required actor                         | Rules                                                                                                                 |
| ---------------------------- | ----------------------- | -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `submit_revision`            | no report or `returned` | `submitted`    | Enterprise member for the obligation   | Creates a new immutable revision and source batches; exact idempotent replay returns the existing revision            |
| `return_for_correction`      | `submitted`             | `returned`     | Staff                                  | Reason required; records current revision and expected logical version                                                |
| `accept_revision`            | `submitted`             | `accepted`     | Staff                                  | Sets the exact accepted revision pointer; reason/note is durable when supplied                                        |
| `reopen_before_finalization` | `accepted`              | `returned`     | Staff                                  | Exceptional explicit correction; reason required; forbidden after consolidation; an enterprise retry cannot invoke it |
| `finalize_source`            | `accepted`              | `consolidated` | Staff through finalization transaction | Locks and consumes the exact accepted revision atomically with the final version                                      |

`consolidated` is terminal for that logical report. Corrections to an already
consolidated official output create a new final-report version; they do not
rewrite or unconsolidate the source report.

Every command MUST include the expected logical version. A mismatch returns the
current state/version without applying a partial transition. Accepted and
consolidated revision facts remain immutable even if a later event changes the
logical workflow. Only `accepted` and `consolidated` reports are eligible for
official tourism totals; `submitted` and `returned` are compliance/work-queue
states, not accepted facts.

## Final-report lifecycle

Finalization is one transaction. It validates and locks every source revision,
creates the logical final report and immutable version/items/events, advances
the source logical reports to `consolidated`, and records a domain event. A
failure leaves none of those effects committed.

There is no official partially finalized state. A successful final-report
version has disposition `current`. A correction creates the next immutable
version in one transaction, advances the logical current-version pointer, and
marks the prior version `superseded`; the prior facts and artifacts remain
auditable. A version is never edited in place.

Artifact generation has a separate durable state machine:

```text
pending -> ready
   |
   +----> failed -> pending (retry)
```

An artifact stores its final-version ID, content hash, template version, MIME
type, storage identity, generation time, and server actor. Retrying generation
MUST NOT change the final facts. Only a `ready` artifact may be presented as the
official downloadable rendering.

## Authorization matrix

Authorization is endpoint-specific and server-derived. Role names below are
capabilities, not claims accepted from a payload.

| Action                                                    | Enterprise member               | Staff                          | Admin                                            | Device/system principal                                                         |
| --------------------------------------------------------- | ------------------------------- | ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Read own obligation/report/revisions                      | Allow                           | Allow                          | Read-only if policy grants                       | Device may read only its command acknowledgements                               |
| Submit/resubmit own revision                              | Allow                           | Deny                           | Deny                                             | Only through an authenticated enterprise session plus registered device context |
| Read official work queue and source evidence              | Deny                            | Allow                          | Read-only if policy grants                       | Deny                                                                            |
| Return, accept, or reopen                                 | Deny                            | Allow                          | Deny unless separately assigned Staff capability | Deny                                                                            |
| Create/correct a final version                            | Deny                            | Allow                          | Deny unless separately assigned Staff capability | Worker may render artifacts but cannot select sources                           |
| Manage account/topology/configuration                     | Deny except own allowed profile | Deny unless separately granted | Allow                                            | Deny                                                                            |
| Publish events, expire live state, render queued artifact | Deny                            | Deny                           | Deny                                             | Allow only the narrow assigned worker operation                                 |

REST and WebSocket access MUST use the same policy definitions. `preparedBy`,
review actor, timestamps, enterprise, site, role, and source classification are
filled by the server from the authenticated context.

## Explicit final scope

Every immutable final version stores one scope type and a canonical scope
definition:

| Scope                  | Required membership                                                                                                              | Required label                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `citywide`             | Exactly one accepted official revision for every non-exempt reporting obligation in the period                                   | `Citywide`                                                  |
| `barangay`             | Exactly one accepted official revision for every non-exempt obligation whose frozen period site belongs to the selected barangay | The persisted barangay name, never `Citywide`               |
| `enterprise_selection` | The explicit, non-empty set of selected enterprise obligations                                                                   | `Selected enterprises` plus the persisted member list/count |

All source revisions MUST be official, accepted, unconsolidated, from the same
canonical period, and eligible for the selected scope. Missing, duplicate,
unknown, mixed-period, mixed-classification, or already-consumed source IDs are
errors. The server MUST reject a `citywide` request unless its exact frozen
obligation set is complete. A subset is never silently widened or relabeled.

The final version persists scope members, source revision IDs, normalized facts,
coverage/quality, authenticated preparer, finalization time, and a canonical
content hash. Rendering MUST use that immutable version only; it MUST NOT reread
mutable intake rows, the current enterprise registry, or frontend fallback data.

## Required tests

- A duplicate submission returns one revision and one logical event set.
- An enterprise retry cannot reopen `accepted` or `consolidated` work.
- Two stale reviewers cannot both transition the same logical version.
- Reopen requires Staff authorization, a reason, and an unconsolidated report.
- Two concurrent finalizations cannot consume the same revision.
- Missing or mixed source IDs reject the whole transaction.
- A barangay or selected subset cannot render a citywide title.
- A later submission or final correction cannot alter a prior final version.
