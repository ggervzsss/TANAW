# Desktop camera modes and open-space dwell time

Implementation plan for TANAW Desktop. This document proposes the implementation; it does not claim that the feature exists or that its accuracy has been validated.

The subsequent implementation and its verified/remaining acceptance checks are
recorded in [implementation status](desktop-camera-modes-implementation-status.md).

Inspected baseline: branch `work`, commit `95ea664cb300fe072132817aa1df9a0e1d27981f`. Recheck the branch, repository instructions, and changed files before implementing against a newer checkout. Use the existing isolated cloud checkout; do not create a Git worktree unless explicitly requested.

## 1. Intended outcome and release boundary

An operator can assign each camera one of two analysis modes:

| Mode | Operator purpose | Primary measurements |
| --- | --- | --- |
| Entrance / Exit (`entrance_exit`) | Monitor access to an establishment | Existing entries, exits, occupancy, and unique-entry estimates |
| Open Space (`open_space`) | Observe activity within a visible public-area zone | Current observed presence, observed visits, completed visit durations, and incomplete-observation counts |

Dwell time is enabled only for Open Space. One camera runs one mode at a time. Cameras in different modes can run concurrently within the existing resource limits.

The initial release is a complete local desktop feature: configuration, processing, persistence, live feedback, historical analytics, recovery, and verification. It should work after authentication without a continuous Internet connection. Existing authentication/session requirements still apply.

Initial scope:

- One named polygon zone per open-space camera.
- A fixed camera viewpoint and ordinary person detection/tracking.
- Camera-local visits and dwell estimates; no cross-camera person matching.
- Local history with clear sample size, observation coverage, and incomplete-visit information.
- Entrance/exit functionality and existing establishment reporting remain available.
- A typed data foundation that can support later backend analytics and AI insights.

Deferred work:

- LGU web dashboards, cloud storage of open-space analytics, and chatbot answers.
- A public-space account/ownership model beyond the current enterprise binding.
- Multiple simultaneous zones in one camera, overlapping-camera deduplication, and site-wide unique visitors.
- Automatic camera steering, tracking people across days, new CCTV brand support, demographic inference, and predictions.
- A new detector or ReID model unless the pilot establishes a specific need.

Do not make these deferred capabilities implicit prerequisites for delivering the local feature.

## 2. Findings from the current code

These are implementation constraints discovered in the inspected checkout.

| Current component | Relevant behavior | Required treatment |
| --- | --- | --- |
| `src/types/enterprise.ts` | `Camera.config` assumes tripwires, a rectangular ROI, and reverse direction | Introduce a mode-discriminated camera configuration |
| `ml-service/app/config/camera_config.py` | Start/update requests and runtime responses assume counting | Add mode-aware validation and runtime payloads |
| `ml-service/app/camera/camera_manager.py` | Owns capture/processing coordination and always constructs a `TripwireCounter` | Select an analysis engine by mode while sharing capture and detection |
| Same manager | Separates appearance identity from physical counting identity | Preserve that separation for visit continuity |
| `ml-service/app/camera/frame_geometry.py` | ROI inclusion accepts foot point, centroid, or sufficient box overlap | Add strict polygon membership for dwell; do not reuse this loose ROI rule |
| `ml-service/app/camera/pipeline_manager.py` | Copies shared enterprise occupancy into each camera's count response | Stop applying that value to open-space cameras |
| `ml-service/app/storage/` | Enterprise-scoped SQLite, WAL, repository classes, and session persistence | Add dedicated open-space repositories and records |
| `ml-service/app/storage/migrations/` | One checksum-protected canonical `001` baseline | Follow the preproduction baseline policy in root `AGENTS.md` |
| `src/features/dashboard/` | Dashboard assumes establishment count/report metrics | Add a separate open-space analytics view within the dashboard |
| `src/features/sync/` | Cloud telemetry and report submission serialize establishment counts | Explicitly prevent open-space observations from entering those fields |
| `electron/ml-service-contract.ts` | Desktop checks exact ML contract version `1` | Coordinate a contract-version change across service, Electron, tests, and bundle checks |
| `ml-service/evaluation/` | Existing replay uses recorded-video timestamps and detection caches | Extend this infrastructure for dwell evaluation |

There are currently up to six configured cameras, with a separate runtime concurrency limit. Preserve those limits until measured resource evidence supports changing them.

The existing camera `zone` string is a location label. It is not a geometric polygon and must not become a substitute for the new geometry.

## 3. Measurement definitions

### 3.1 What dwell time means

**Estimated dwell time is the elapsed time of a tracked visit inside the configured camera zone.** It is not automatically the length of the person's entire park visit.

Use the label "Estimated time in monitored area" in explanatory UI. The selected camera and zone must remain visible alongside its values.

Example: a camera sees a seating zone within a larger plaza. The resulting duration describes the seating zone, even when the person spends additional time elsewhere in the plaza.

### 3.2 Distinguish the measurements

| Measurement | Definition |
| --- | --- |
| Current observed presence | Confirmed tracks currently observed inside the zone on fresh, qualifying frames |
| Temporarily unobserved tracks | Previously present tracks within the short tracking-gap grace period; reported separately |
| Observed visits | Qualified visit records, including visits whose actual arrival or departure was not observed |
| Observed arrivals | Visits with a tracked outside-to-inside transition |
| Observed departures | Visits with a tracked inside-to-outside transition |
| Completed visits | Qualified visits with observed arrival and departure and no continuity-breaking interruption |
| Incomplete visits | Qualified observations with an unknown arrival, unknown departure, or interruption |
| Average / median dwell | Calculated from eligible completed visits only, with the denominator shown |
| Peak observed presence | Highest fresh presence count measured during covered intervals in the selected period |
| Observation coverage | Time with usable, fresh analytics divided by the elapsed selected period |

Visits are not unique people. A person leaving and returning produces another visit. Different cameras can observe the same person independently.

There is no open-space equivalent of establishment occupancy computed as cumulative entries minus cumulative exits. Presence comes from current tracks. A lost track cannot establish a physical departure.

### 3.3 Unknown values and incomplete samples

- No eligible completed visits: dwell statistics are `null`, displayed as "No completed visits yet".
- Unavailable camera or stale processing: current presence is unavailable, not zero.
- A healthy camera seeing an empty zone: presence is zero.
- Someone first detected inside the zone: record an unknown arrival, even if the service has already been running for hours.
- A person disappearing without a visible boundary exit: record an unknown departure.
- People present when monitoring begins count toward observed presence after confirmation, but their visits cannot supply full dwell durations.
- Do not combine active elapsed durations into completed-visit averages.

Completed-only statistics have selection bias: long ongoing visits and interrupted visits are absent. Display the completed sample count and incomplete count; do not imply that the value describes every visitor.

## 4. Camera configuration and zone editor

### 4.1 Type and validation design

Use a discriminated union in TypeScript rather than a camera with every possible field optional:

```ts
type Camera = CommonCamera & (
  | { analysisMode: "entrance_exit"; config: EntranceExitConfig }
  | { analysisMode: "open_space"; config: OpenSpaceConfig }
);
```

`CommonCamera` retains ID, name, location label, stream configuration, credentials metadata, detector settings, and processing profile. Credentials remain in Electron secure storage.

Entrance configuration retains the current tripwires, ROI, and reverse-direction behavior. Open-space configuration contains:

- Stable `zoneId`, human-readable zone name, and polygon vertices.
- A common processing ROI, defaulting to full frame for open-space mode.
- Versioned dwell policy values, including confirmation and gap durations.
- A server-assigned immutable configuration revision associated with the geometry and measurement policy.

Use snake_case for the Python wire contract and camelCase for renderer models, with conversions in the existing service adapter. Avoid duplicating mode in several editable locations.

Validate at both the renderer and service boundary. The Python service is authoritative. Profile replacement, camera start, saved-session restoration, and configuration edits must all validate against the same mode-specific rules.

New cameras default to Entrance / Exit. An omitted mode may resolve to that default at a documented API construction boundary. Existing SQLite data is handled through the repository's baseline/reset policy, not a silent data migration.

### 4.2 Polygon rules

- Store vertices normalized to the full processed image, with coordinates between `0` and `1`.
- Support 3–12 vertices initially, with no holes.
- Reject NaN/infinite coordinates, duplicate consecutive vertices, zero-length edges, self-intersections, and negligible-area polygons.
- Canonicalize orientation and do not persist a duplicated closing vertex.
- Validate the zone against its processing ROI and require an observable margin around its boundary where practical.
- Keep the existing entrance ROI/tripwire semantics unchanged.

The current renderer uses percentage geometry in several places. Add explicit percentage-to-normalized conversions, with round-trip tests. Do not pass `0..100` coordinates into Python's `0..1` models.

Use the person's bottom-center/foot counting point for polygon membership. Do not classify someone as inside merely because part of their bounding box overlaps the polygon. Use a small boundary tolerance band and stable temporal confirmation to limit jitter.

The processing area must include space outside the monitored polygon. Observing a track outside before arrival and after departure is necessary for a completed visit. A zone touching every image edge can still report presence, but will naturally produce many incomplete visits. Explain this during configuration.

At low processing rates, someone may traverse a small zone entirely between sampled frames. Do not fabricate a timed visit from an unobserved trajectory. Record the processing rate and evaluate this failure case when choosing the zone and hardware profile.

### 4.3 Operator workflow

1. Add or edit the camera and select its analysis mode.
2. Test the RTSP connection using the existing credential flow.
3. For Entrance / Exit, configure the existing lines and direction.
4. For Open Space, name and draw the monitored zone on an actual frame.
5. Show the zone and counting anchor preview; allow vertex movement, undo, reset, and keyboard editing.
6. Explain the visible boundary/margin requirement and fixed-viewpoint requirement.
7. Save a validated configuration and start monitoring.

Do not activate a sample/default polygon as if the operator confirmed it. A newly selected Open Space mode remains "Zone setup required" until valid geometry is saved.

Use a fixed camera view. Disable automatic pan/tilt tracking at the device when possible. A manually moved camera, changed zoom, or changed viewpoint requires recalibration and a new revision. Automatic viewpoint-change detection is deferred.

### 4.4 Switching modes and geometry

For the first release, changing mode, polygon, dwell policy, or processing ROI creates a new analysis revision and restarts that camera's analysis run. Do not hot-edit an active dwell zone while carrying visits into its replacement.

- Explain that existing observations will end as incomplete.
- Persist the new configuration successfully before starting the replacement run.
- Finalize the old run with an explicit reason such as `mode_changed` or `zone_changed`.
- Clear mode-specific tracking state and pending work.
- Retain historical data with its original mode and revision.
- On a failed restart, show the saved configuration and stopped/error state accurately.
- A failed save leaves the active revision unchanged.
- Repeating an identical save must not create another revision or restart.

Keep the current entrance-only tripwire hot-update path available. An entrance hot update and an open-space revision restart are different operations.

## 5. Visit state machine and identity continuity

### 5.1 Core states

Implement a pure, deterministic `AreaVisitTracker`, independent of OpenCV, FastAPI, SQLite, and Electron. Its inputs are timestamped track observations and explicit lifecycle/health events. Its outputs are visit transitions, presence changes, and diagnostics.

| State | Input | Result |
| --- | --- | --- |
| Outside | First valid inside observation | Start an entry candidate |
| New track inside | Valid inside observation | Start an unknown-arrival candidate |
| Entry candidate | Stable inside evidence meets confirmation | Promote to an active visit, retaining the candidate's first-inside timestamp |
| Entry candidate | Clear outside evidence before confirmation | Discard transient candidate |
| Active | Fresh inside observation | Update last-inside time and live elapsed duration |
| Active | Stable outside evidence begins | Start exit confirmation |
| Exit pending | Inside evidence returns before confirmation | Resume the same visit and record the uncertain excursion |
| Exit pending | Outside evidence meets confirmation | Finalize at the last valid inside observation; classify completed or incomplete from boundary knowledge |
| Active / exit pending | Track missing briefly | Enter a short gap state; stop presenting it as freshly observed presence |
| Gap pending | Unambiguous motion-continuous recovery within grace | Resume the same visit and record bridged uncertainty |
| Gap pending | Grace expires or recovery is ambiguous | Finalize incomplete at the last valid inside observation |
| Any active state | Run stop, stale stream, logout, enterprise switch, or configuration replacement | Finalize incomplete with the corresponding reason |

People below the minimum qualified duration remain visible as detection candidates but are excluded from visit totals and dwell statistics. Persisted short observations can end as `excluded` for reproducible diagnostics.

### 5.2 Initial policy values for calibration

These are proposed starting values, not proven accuracy claims:

| Policy | Starting point | Purpose |
| --- | --- | --- |
| Entry confirmation | 1 second and at least 2 qualifying observations | Reduce one-frame false visits |
| Exit confirmation | 1 second and at least 2 qualifying observations | Reduce boundary jitter |
| Qualified visit duration | 2 seconds | Separate meaningful observations from brief noise; short physical crossings may intentionally be excluded |
| Track-loss grace | 2 seconds | Allow a bounded short occlusion |
| Boundary tolerance | Approximately 1% of the shorter image dimension | Limit edge oscillation; calibrate for the scene |
| Stale analytics threshold | Start by evaluating the existing 5-second freshness convention | Define unavailable observations and terminate continuity |
| Active persistence checkpoint | Up to every 2 seconds, plus significant transitions | Bound crash-recovery uncertainty |

Require time and evidence; two frames several seconds apart are not automatically continuous confirmation. A configured maximum inter-observation gap must also pass. Tune this against the effective processing FPS and minimum supported profile.

Treat these parameters as an internal named policy/preset initially. A simple user-facing sensitivity preset is preferable to exposing many technical sliders. Every policy change is revisioned.

### 5.3 Tracking identities

The current processing manager has a resolver for appearance identity and a separate resolver for physical counting continuity. Dwell must follow the latter principle.

- Use an enterprise + camera + run + physical-track-generation key.
- Tracker integer IDs are not globally unique and can be reused.
- Scope every visit to a UUID run and immutable geometry revision.
- Accept short, one-to-one motion-continuous stitching only within the configured grace period.
- If recovery could match multiple people, close the old observation as incomplete and start a new observation with unknown arrival.
- Appearance-only remaps, gallery merges, and active identity swaps must not move or merge dwell timers.
- A person returning after a completed visit starts a new visit even if appearance identity matches.
- Never stitch across cameras, enterprise contexts, stream epochs, service restarts, or long gaps.

For initial open-space mode, reuse the existing detector/tracker and motion continuity without making the daily visitor gallery or ReID model readiness a prerequisite. Do not write open-space events into `visitor_sightings`, whose current schema explicitly represents entry/exit events.

The existing appearance buffers use the tripwire counter's frame index. Introduce a shared processing observation/frame sequence for common scheduling and diagnostics so open-space mode does not need a fake tripwire counter.

### 5.4 Duration arithmetic

For an eligible completed visit:

```text
estimated_dwell_ms = last_valid_inside_time - first_valid_inside_time
```

Use monotonic observation time within a run. Short, explicitly bridged tracking gaps and canceled boundary excursions can be included in this elapsed estimate, but their accumulated uncertain duration and count must be recorded. These estimates are not frame-by-frame proof of presence during an occlusion.

Exit debounce and post-loss waiting time do not extend the visit's end. Preserve `last_observed_at`, `ended_at`, and `finalized_at` separately.

Use UTC timestamps for persistence and Asia/Manila for local reporting periods and display. Map observation times using a run's wall-clock/monotonic anchors. Detect wall-clock discontinuities; do not produce negative durations or derive duration from the operating system's wall-clock subtraction.

Inject an ID factory as well as a clock into pure-engine tests so deterministic transition snapshots do not depend on random UUID values. Production IDs remain unguessable UUIDs; they identify observations, not people.

## 6. Frame timing, stale video, and lifecycle

### 6.1 Observation time reaches the analysis engine

The current processing path records raw capture timestamps but calls counting using processing-time `time.monotonic()`. Threading capture time and frame identity through the new analysis path is necessary: inference latency must not inflate a person's stay.

Introduce a typed observation context containing:

- Run ID and stream epoch.
- Raw/processed frame sequence and dimensions.
- Capture-receipt monotonic timestamp.
- Processing timestamp and measured frame age.
- A deterministic observation timestamp supplied by replay.

Real RTSP frames currently have local receipt time, not a guaranteed camera exposure timestamp. Document this limit. Reject excessive frame age and repeated/out-of-order frame IDs. Avoid retaining an inference backlog; preserve the existing latest-frame approach.

For offline video evaluation use source video timestamps/PTS or the existing frame-index/source-FPS timeline. Never use replay execution speed to calculate dwell.

The current `_wait_for_latest_frame` path can return the latest frame after a wait timeout even without a new ID. Audit and correct that behavior for observation accounting: the same frame cannot refresh presence, confirm entry/exit, or extend dwell multiple times. This is a high-priority correctness check with an entrance regression test.

### 6.2 A no-frame watchdog is mandatory

Track-loss and stale-stream timers must advance when there are no new frames. A tracker invoked only on detections cannot reliably end an interrupted observation.

- Tick timeouts from a bounded processing wait/watchdog path.
- Track raw-frame freshness and processed-frame freshness separately.
- Slow or stalled inference can invalidate analytics even while raw capture continues.
- A successful socket connection or a `running` flag does not establish usable observations.
- Once analytics becomes unavailable, close the covered interval and finalize active visits as incomplete.
- Resume with a new continuity epoch; people first seen inside have unknown arrivals.
- Brief, bounded misses during otherwise fresh analytics follow the track-loss grace policy instead.

Audit stale frame reuse on reconnect: a cached old frame must not become a fresh observation just because a network connection reopened.

### 6.3 Stop/restart/recovery matrix

| Event | Visits | Live UI | Persistence |
| --- | --- | --- | --- |
| Normal observed zone exit | Complete only if arrival and continuity were known | Remove after exit confirmation | Commit once with final observed end |
| Camera stopped | Incomplete `camera_stopped` | Stopped/unavailable | Flush transitions and close coverage |
| Stream or processing stale | Incomplete `stream_interrupted` / `processing_stalled` | Unavailable, last updated shown | End at last valid observation |
| Service crashes | Previous active rows become incomplete `process_interrupted` on recovery | Restarting, then fresh state | Use last committed checkpoint; do not infer presence during downtime |
| Enterprise changes/logout | Incomplete `context_changed` | Clear old account's live view | Complete old scoped writes before rebinding |
| Mode/zone/policy changes | Incomplete with revision-change reason | Reconfiguring | New revision and run |
| Application closes cleanly | Incomplete `application_closed` | Closing | Idempotent finalization and checkpoint |
| Machine sleep/resume or long scheduler gap | Incomplete interruption | Unavailable/restarting | No duration continuity through the unobserved gap |
| Camera deleted | Incomplete `camera_deleted` | Removed from current list | Preserve historical snapshots and visits |

Serialize analysis mutation and lifecycle events under a documented ownership/lock order. Prefer processing-thread ownership of tracker state and explicitly queued lifecycle commands. Stop/join and finalization must not deadlock with `_counting_lock`, the manager lock, or registry locks. Reject late results from old runs.

Service restart never resumes a persisted person timer as though it were still the same visible person.

## 7. Local storage and transaction design

### 7.1 Follow the repository schema policy

Root `AGENTS.md` explicitly treats development databases as disposable and requires editing the canonical SQLite `001` baseline. Do not add `002` solely to preserve development data.

Keep the migration runner and checksum rejection behavior. Test fresh schema creation and a meaningful reset-required message for an older baseline. Never silently delete an existing database at application startup.

Use isolated temporary application-data directories during implementation tests. If a developer needs to reset a real local development ledger, explain the affected data and use the existing supported CLI deliberately. A reset is not part of this planning task. If the user later declares a data-preservation stage, revise the migration approach before implementing schema changes.

### 7.2 Proposed schema additions

The names below are proposed new tables, not current repository tables. Final SQL belongs in the canonical baseline.

| Table | Main contents | Important invariants |
| --- | --- | --- |
| `camera_analysis_revisions` | Revision UUID, camera ID/name snapshot, zone ID/name, mode, canonical geometry/policy JSON, revision sequence, created time | Immutable configuration; same saved content is a no-op |
| `analysis_runs` | Run UUID, revision ID, start/end timestamps, clock anchor, stream epoch/continuity metadata, last checkpoint, termination reason | No visit continuity across runs |
| `area_visits` | Visit UUID, run/revision/zone, physical-track generation, timestamps, status, known-boundary flags, qualified time, duration, uncertainty diagnostics, terminal reason | Terminal transition commits once; nonnegative durations; complete implies both boundaries known |
| `area_presence_intervals` | Camera/run/revision, start/end, fresh count, temporarily missing count, availability/quality | Non-overlapping intervals per camera; gaps are not zero presence |
| `area_hourly_rollups` | Camera/revision, UTC bucket boundary, completed/incomplete/arrival/departure counts, duration sum/count, duration buckets, covered milliseconds, peak presence | Idempotent aggregation; preserve population definitions and algorithm version |

Add `analysis_mode` and current analysis revision linkage to camera profile persistence. Keep canonical configuration and its serialized payload consistent rather than allowing SQL columns and JSON to disagree.

Each enterprise already has a scoped database. Retain that isolation and verify sanitized scope collisions cannot expose another account's records. Historical records reference immutable snapshots; deleting a camera profile must not cascade away its measurements.

Suggested `area_visits` fields:

```text
visit_id, run_id, revision_id, camera_id, zone_id,
physical_track_generation,
first_inside_at, last_inside_at, last_observed_at,
qualified_at, ended_at, finalized_at,
status: active | completed | incomplete | excluded,
arrival_observed, departure_observed,
estimated_dwell_ms, uncertain_gap_ms, uncertain_gap_count,
observation_count, termination_reason, quality_flags,
algorithm_version, created_at, updated_at
```

Candidate tracks can remain in memory until entry confirmation. Promotion durably creates an active row. Qualification is a separate milestone so visits shorter than the minimum do not enter business totals.

Index visits by camera/revision/end time and by status/run. Index intervals and rollups by camera/revision/time. Validate query plans with representative data before retaining many weeks of records.

### 7.3 Write behavior

- Use dedicated repository classes that depend on storage/domain types, not API or camera-manager modules.
- Persist promotion, qualification, exit, interruption, revision changes, and periodic active checkpoints.
- Never write a row per video frame or store video/bounding-box histories for this feature.
- Generate stable UUIDs and transition versions before attempting a write.
- Use compare-and-set terminal transitions so duplicate finalization cannot count a visit twice.
- Rollup changes happen atomically with terminal transitions, or through a replayable transactional work record with equivalent guarantees. Choose the simple atomic transaction first.
- In-memory live rendering can be provisional; historical summaries come from committed records.
- Do not perform database work while holding registry/global frame locks.
- Start with synchronous, event-driven repository writes outside those locks and measure the overhead. Introduce a bounded serialized writer only if profiling establishes a need.
- Handle SQLite busy/full/I/O errors visibly. Retry with stable IDs and bounded work; never silently mark a visit successfully stored when its write failed.
- A persistence failure degrades analytics readiness. Stop accepting authoritative completions if writes cannot be made safely; recover active records as incomplete.

### 7.4 Presence intervals and coverage

Open or split an interval when observed presence, temporary-missing count, availability, or revision changes. Checkpoint the current interval so a crash has a bounded loss window.

Represent healthy empty intervals explicitly. Unknown periods remain unavailable. Coverage can be less than the requested period because monitoring started late or the device was offline; it is an observation ratio, not a contractual uptime percentage.

For a multi-camera selection, show coverage per camera. Do not add overlapping camera coverage or presence and label it site-wide occupancy.

### 7.5 Retention and statistics

Proposed pilot defaults: 30 days of individual visit/interval records and 180 days of hourly aggregate summaries. Make retention bounded, documented, and revisable after measuring actual volume. Cleanup is batched and never removes active records.

Rollups must exist and be verified before their source rows are removed. Completed and incomplete counts, duration sum/count, duration groups, and coverage survive raw-record cleanup.

An average combines as `sum(duration_ms) / sum(completed_count)`. Never average camera/hour averages without their sample counts. Medians cannot be combined by averaging medians.

For the initial implementation, calculate exact median and P90 only while the underlying eligible visits remain available. If only coarse historical rollups remain, return those quantiles as unavailable with an explanation; still provide valid means, counts, and duration groups. A mergeable quantile sketch can be a later, explicitly tested enhancement.

Do not let existing report-finalization raw-event cleanup purge open-space records. Extend the local-data inspect/clear tooling deliberately to understand the new tables and continue respecting enterprise/full-device boundaries.

## 8. Shared processing architecture

Preserve a single capture and detector/tracker pipeline per camera:

```text
RTSP capture -> timestamped latest frame -> detector/tracker
                                      -> motion continuity
                                      -> analysis mode
                                         entrance_exit: existing tripwire/count ledger
                                         open_space: polygon/visit state machine
                                      -> mode-aware overlays/live state
                                      -> dedicated repositories
```

Extract only the common scheduling/observation responsibilities needed for this separation. Avoid a broad rewrite of the existing manager.

Proposed new modules:

```text
ml-service/app/analytics/models.py              mode-neutral observation/results
ml-service/app/analytics/open_space.py          pure visit state machine
ml-service/app/analytics/polygon.py             normalized polygon membership/validation
ml-service/app/analytics/clock.py               production/replay clock adaptation
ml-service/app/config/open_space_config.py      settings and response schemas
ml-service/app/api/open_space.py                query endpoints
ml-service/app/storage/repositories/area_visit_repository.py
ml-service/app/storage/repositories/area_metrics_repository.py
```

These paths are proposed, not an instruction to create empty modules. Keep small cohesive units; use existing equivalent modules if implementation proves a better fit.

The analysis engine should accept observations, advance time without frames, finalize a run, and expose an immutable result snapshot. It emits domain transitions; it does not directly open a database connection.

Entrance mode still owns unique-entry and report behavior. Open-space mode must not schedule daily gallery work merely because code is shared. Optional disabled ReID in an open-space pipeline must not appear as an analytics failure.

Update frame snapshots and `CameraFrameRenderer` to render either lines or polygon/elapsed-time labels. The current display tuple assumes tripwires and entrance counters; replace it with a typed mode-aware snapshot rather than extending a long positional tuple indefinitely.

## 9. Local API, Electron, and live-state contracts

### 9.1 Coordinate contract version 2

The new mode union changes assumptions across the app. Bump the local ML contract from `1` to `2` in a coordinated release; do not pretend old sidecars can interpret new requests.

Update:

- `ml-service/app/main.py` and the health response model.
- `electron/ml-service-contract.ts` and its tests.
- `scripts/verify-ml-runtime.mjs`, which currently hardcodes version `1`.
- Browser/Electron fake sidecars and fixtures.
- Renderer service models and request/response adapters.
- Any supervisor checks, session serialization, and startup compatibility errors.

Expose capabilities for supported analysis modes and open-space analytics. Keep the existing tripwire hot-update capability meaningful for entrance mode. A version mismatch should produce an actionable "desktop/runtime versions do not match" failure before camera start.

### 9.2 Mode-aware runtime state

Put lifecycle fields in a common runtime object (`running`, `status`, `error`, freshness, run/revision IDs). Put analysis values in a discriminated union:

```text
entrance_exit -> doorway counts and existing unique-entry diagnostics
open_space   -> fresh presence, temporary missing tracks, active visits,
                current observation durations, coverage/readiness metadata
```

Open-space cameras must not receive an establishment occupancy value in an `occupancy` field. Avoid synthetic zero entry/exit fields that conceal the selected mode.

Audit every `counts.running`, `counts.status`, count-derived signature, and fallback to `/session` in the renderer, supervisor, monitoring summary, and sync hook. Common lifecycle information must work for both modes.

`active_camera_count` and resource accounting include both modes. `enterprise_occupancy` and existing `/metrics/summary` represent the entrance/exit ledger only. Historical doorway events retain their meaning even after their camera changes mode; do not filter historical events using only a camera's current mode.

### 9.3 Proposed local query endpoints

Use `/metrics/` and `/camera/` prefixes already allowed by the Electron request policy:

| Endpoint | Purpose |
| --- | --- |
| Existing camera start/profile routes | Accept validated mode-specific configuration |
| Existing camera runtime REST/WebSocket routes | Include mode-aware live state |
| `GET /metrics/open-space/summary` | Selected camera/zone/revision, half-open time range, counts, durations, coverage |
| `GET /metrics/open-space/history` | Bounded time buckets with gaps and cohort metadata |
| `GET /metrics/open-space/visits` | Paginated completed/incomplete visit diagnostics without person identity or credentials |

Implement configuration changes through the existing serialized camera save path. Add a dedicated mode-aware update route only if it is needed to keep persistence/restart atomic; do not overload the tripwire hot-update handler with polygon semantics.

Query contracts include timezone, range, camera/zone/revision, algorithm version, sample counts, last update, and data-availability limits. Enforce maximum time spans, pagination, valid enterprise context, and deterministic ordering.

Time ranges are half-open `[from, to)`. Completion-based dwell summaries assign the whole completed visit to its end-time cohort. Arrival charts use first-entry time. Presence/coverage intervals are clipped and split across time buckets. Name these populations so a midnight-spanning visit is not counted twice or mistaken for two visits.

Preserve the existing token-protected loopback HTTP/WS and IPC origin/path restrictions. No new external service or secret is required.

### 9.4 Live updates and query cost

Continue using the current camera WebSocket rather than adding a connection per visit. Do not scan all visit history on every 200 ms live-state publication.

- Live payloads use in-memory snapshots and cheap/cached counters.
- Historical queries run separately with indexes and bounded ranges.
- Push immediate state changes and rate-limit elapsed-time updates to a sensible UI cadence, such as once per second.
- Scope subscriptions to enterprise and camera; cancel them on logout/switch/unmount.
- Preserve raw/overlay preview behavior and stale-frame recovery.

## 10. Desktop UI and analytics

### 10.1 Camera management

- Add the mode selector with plain descriptions and mode badges in the list.
- Show only the relevant geometry editor and analytics controls.
- Keep connection settings and secure credential handling shared.
- Add mode-aware read-only details and validation messages.
- Preserve drafts when connection tests or saves fail.
- Explain what a mode/zone change will do to active visits before the operator saves it.

### 10.2 Live monitoring

Open-space live cards show:

- "People observed now" and a separate temporary tracking-gap count when relevant.
- Active observations and estimated time in zone, with limited on-screen labels to prevent crowd clutter.
- Completed visits and median completed dwell for the selected period, with sample count.
- Last valid observation and camera/analytics/storage readiness.
- A clear unavailable state during stale video, inference stalls, or persistence failures.

The preview shows the polygon and mode. A display label uses an ephemeral track/observation label, not a persistent personal identity. Diagnostic IDs need not appear in the ordinary operator view.

### 10.3 Dashboard structure

Add two clear views/tabs within the existing desktop dashboard: "Entrance / Exit" and "Open Space". Show only configured modes as available views, and remember the user's selection within the existing user-scoped UI-state approach.

Open-space view starts with camera/zone selection and Today / 7 days / 30 days filters. It shows:

1. Current observed presence and peak observed presence.
2. Qualified observed visits, completed samples, and incomplete observations.
3. Median and average completed dwell, with P90 available in expanded analytics.
4. Duration groups: `<1 min`, `1–<5 min`, `5–<15 min`, `15–<30 min`, and `>=30 min`.
5. Presence over time and observed arrivals by hour.
6. Observation coverage and gaps, plus a concise sample-quality explanation.

Duration group boundaries are explicit and tested. All durations stay numeric in milliseconds in storage/API and are formatted only in the UI.

Mixed mode configurations never produce a single blended "visitors" or "occupancy" metric. Initial open-space selection is per camera/zone. A list can compare cameras, but a site-wide deduplicated total is deferred.

Default historical comparison stays within the selected revision. If a range includes geometry/policy changes, mark the boundaries and offer separate series; do not imply an unchanged area was observed throughout.

### 10.4 Reports and local-only behavior

Existing establishment reports keep their count and demographic baselines. Open-space-only configurations display a purposeful explanation in Reports rather than suggesting an empty doorway report is an open-space report.

Do not add dwell to the existing DOT/official report PDF or submission payload. Local analytics can be inspected in the dashboard; CSV export is an optional follow-up, not a prerequisite for measurement correctness.

Include clear desktop wording that open-space history currently lives on this device and is not yet visible to LGU web users. Device reset/removal affects that local history.

## 11. Cloud-sync boundary during the desktop release

The current backend telemetry requires `DesktopMetricsSummary`, which has establishment counts but no typed open-space source/coverage model. This is an integration boundary, not permission to store arbitrary dwell records in its generic `payload`.

For this release:

- Do not put open-space arrivals/departures into `entries`/`exits`.
- Do not put camera-zone presence into `currentOccupancy` or `peakOccupancy`.
- Do not label visits `uniqueCount`.
- Do not synchronize per-track IDs, visit records, or dwell statistics in generic telemetry JSON.
- Keep previously valid doorway report synchronization independent of the camera's current mode.
- In mixed setups, build legacy count telemetry and its monitoring/session inputs from the entrance/exit scope; open-space activity must not make a doorway pipeline appear healthy.
- In open-space-only setups, suppress the legacy live count-telemetry path instead of sending running open-space cameras with fabricated doorway metrics. Show that legacy cloud monitoring is unavailable for this configuration until the backend gains typed open-space support. Other authorized account/report operations can continue.
- Skip automatic doorway sample-count preparation for an open-space-only setup; never seed synthetic establishment data to fill its dashboard.

This means a public-only pilot is local for monitoring and analytics. It does not deliver LGU-side visibility or a new heartbeat API. A later backend task must add explicit measurement scope, availability, aggregation, retention, and replay/idempotency contracts before removing this restriction.

Suppressing this telemetry can cause the existing LGU portal to classify an open-space-only gateway as delayed/offline. Show this consequence in pilot documentation. If preserving its online status is required for deployment, a typed backend heartbeat/scope extension becomes an additional release prerequisite; do not work around it by sending misleading zero counts. The desktop pilot itself can still be developed and validated independently.

Add tests around `useDesktopCloudSync` and `cloud-sync.ts`; their current count-based live signature must not break or create a high-frequency sync loop when dwell timers update.

## 12. Phased implementation sequence

Implement in small reviewable commits or PRs. No phase is considered validated merely because the UI renders mocked values.

### Phase 0 — Reconfirm baseline and establish regression evidence

Tasks:

- Read root/nested agent instructions and inspect the current branch/status.
- Record existing desktop TypeScript/Vitest and local-service test outcomes before changes.
- Verify model/tool availability separately from pure-domain tests; use frozen dependency installation if needed.
- Establish isolated data directories and small synthetic observation fixtures.
- Record representative entrance-mode metrics and lifecycle/preview behavior.
- Check CPU/RAM/model/profile and choose realistic configured/concurrent camera counts for later measurements.

Exit: known baseline failures are distinguished from feature regressions; no real development database was reset just to start tests.

### Phase 1 — Specify domain, contracts, and configuration

Tasks:

- Implement mode types, polygon/policy validation, immutable revision semantics, and timestamp context.
- Define the mode-aware runtime/summary payloads and contract version `2`.
- Update health/compatibility checks and fixtures together.
- Define exact visit qualification, completion, and missing-observation rules as tests and examples.

Exit: invalid mode/config combinations fail at the API boundary; an entrance configuration round-trips unchanged; a mismatched sidecar fails clearly.

### Phase 2 — Build the pure geometry and dwell engine

Tasks:

- Implement polygon membership, boundary tolerance, and the visit state machine.
- Use injected observation time and explicit timeout/lifecycle inputs.
- Implement physical-track generation, bounded one-to-one continuity, and uncertainty accounting.
- Produce deterministic visit/presence transitions with stable IDs.
- Keep person-gallery identity changes outside the engine.

Exit: hand-authored observation timelines pass exact expected-duration and transition tests without a camera or ML model.

### Phase 3 — Add durable local records and queryable summaries

Tasks:

- Edit the canonical SQLite `001` baseline with new tables/constraints/indexes.
- Implement repositories, checkpointing, idempotent finalization, crash recovery, and coverage intervals.
- Implement summary/history query semantics, revision filtering, and rollups.
- Add bounded retention and local-data CLI integration.

Exit: database reopen reproduces the same summaries; duplicate writes do not double-count; interrupted active rows become incomplete; reset-required behavior remains explicit.

### Phase 4 — Integrate the live camera pipeline

Tasks:

- Select the mode engine in camera processing and remove tripwire-only assumptions from common scheduling.
- Propagate frame IDs, capture-receipt times, epochs, and freshness.
- Prevent duplicate frame processing from advancing measurements.
- Add no-frame/stalled-processing timeout handling.
- Handle stop, restart, reconnect, revision changes, deletion, and enterprise rebinding.
- Separate open-space presence from shared establishment occupancy.
- Render mode-aware overlays and publish snapshots without database scans.

Exit: a fake capture/tracker integration produces persisted visits and live output; an actual supported RTSP camera produces usable live observations; entrance behavior still passes regressions.

### Phase 5 — Implement configuration and live UI

Tasks:

- Add mode selection, polygon editing, setup-required state, and mode-specific details.
- Extend camera save/restart decisions and transactional revision handling.
- Show live presence, duration, sample status, and unavailable states.
- Update state stores, subscriptions, preview recovery, and account-scoped UI cleanup.

Exit: an operator can configure each mode, recover from validation/save/start failure, and switch modes without carrying visits across revisions.

### Phase 6 — Deliver desktop historical analytics

Tasks:

- Add dashboard mode selection, camera/revision filters, cards, duration groups, time series, and coverage information.
- Implement no-sample, all-incomplete, empty-but-healthy, and unavailable states.
- Mark revision changes and enforce retention/quantile availability rules.
- Update Reports behavior for open-space-only configurations.

Exit: displayed values agree with the persisted fixtures, including cross-midnight visits and partial coverage. The feature remains usable offline within the established authentication lifecycle.

### Phase 7 — Protect sync/report boundaries and package compatibility

Tasks:

- Update count-based live signatures and legacy monitoring/session adapters.
- Test mixed mode telemetry and suppress unsupported open-space-only count telemetry/sample preparation.
- Verify official report counts/payloads/PDFs remain doorway-only.
- Update documentation, troubleshooting, fake sidecars, bundle health checks, and packaged startup.

Exit: no dwell/presence values leak into existing report or cloud count fields; mismatched runtime packages are rejected.

### Phase 8 — Evaluate accuracy, resources, and real recovery

Tasks:

- Extend the existing replay/evaluation tools for zone observations and visit matching.
- Label controlled recordings and evaluate dwell duration, fragmentation, completed-visit precision/recall, and presence error.
- Run mixed workloads at supported concurrency and compare entrance throughput before/after.
- Test real RTSP disconnection, sleep/resume, application restart, and packaged Windows startup.
- Calibrate thresholds on one set of recordings and validate on separate recordings.

Exit: publish measured results, supported operating conditions, and unresolved failure cases. Release readiness requires the gates below; software test success alone is insufficient evidence of camera accuracy.

## 13. Test matrix

### 13.1 Pure engine tests

Cover at least:

1. Outside -> inside -> outside with known timestamps and exact expected duration.
2. First detection inside, followed by observed exit: incomplete arrival, excluded from full dwell summary.
3. Observed entry followed by disappearance: incomplete departure.
4. A short false detection below confirmation and a short visit below qualification.
5. Boundary jitter and a canceled exit candidate without duplicate visits.
6. A second genuine re-entry after a finalized visit.
7. Gap below grace with unique motion continuity; gap above grace; ambiguous recovery.
8. Two people crossing/overlapping without transferring timers between them.
9. Tracker ID recycling and stale/out-of-order observations.
10. Appearance remaps, active swaps, and delayed ReID results without dwell merging.
11. One person remaining in-zone for a long time without an artificial timeout.
12. No frames while timers advance; raw frames fresh but inference stalled.
13. Duplicate frame delivery and a reconnect yielding a cached old frame.
14. FPS reduction and skipped frames with unchanged observation-time arithmetic.
15. Monotonic/wall-clock changes and sleep/resume.
16. Midnight/month boundaries without splitting one visit into two.
17. Polygon edge/vertex inclusion, self-intersection, concavity, invalid coordinates, and percent conversion.
18. Minimum observation-count and maximum inter-observation-gap requirements.

Tests use deterministic clocks and observations, with no real sleeps.

### 13.2 Storage/API tests

- Fresh baseline schema, constraints, foreign keys, checksums, and old-baseline reset-required message.
- Promotion/checkpoint/finalization and retry idempotency.
- Atomic completed visit and rollup update under injected failures.
- Crash recovery using last checkpoint and no resumed active identity.
- Enterprise isolation and history preserved after profile deletion/mode change.
- Healthy zero presence versus unavailable coverage gaps.
- Half-open ranges, cross-midnight cohorts, sample denominators, and weighted means.
- Rollup and presence-interval splitting across hour/day boundaries, including idempotent retry after a partial transaction.
- Exact quantile availability within retention and no invalid median-of-medians fallback.
- Retention only after verified aggregation, with active records protected.
- Bounded pagination/ranges, deterministic order, invalid context, unauthorized HTTP/WS, and secret redaction.
- Disk-full/busy/write failures surfaced in analytics readiness.

### 13.3 Renderer and Electron tests

- Default entrance mode and mode-dependent controls.
- Polygon editing, resizing, letterboxed video alignment, keyboard editing, and touch/pointer behavior.
- Letterboxing transforms are computed against the actual displayed video rectangle, not the entire preview container; the polygon overlay agrees with Python processing at multiple aspect ratios.
- Invalid save preserves the draft and active configuration.
- Mode changes restart only the selected camera and show accurate failed-start state.
- Live presence/elapsed labels, no-data states, stale transitions, coverage, and sample counts.
- No old account's metrics/drafts survive logout or enterprise switching.
- Contract version/capabilities and fake-sidecar parity.
- Existing secure credentials, loopback origin restriction, and request limits remain effective.
- Open-space-only report/telemetry/sample-preparation behavior and mixed mode boundary tests.
- Elapsed timer ticks do not cause telemetry floods or expensive history refetches.

### 13.4 Scenario-level walkthroughs

| Scenario | Expected result |
| --- | --- |
| Entrance camera only | Existing counting/report workflow remains usable |
| Open-space camera only | Local zone analytics work; no fabricated doorway reports/telemetry |
| One camera in each mode | Independent values and appropriate shared resource accounting |
| Empty zone with healthy feed | Presence zero, valid coverage, no completed dwell samples |
| Seated person then observed departure | One long visit, stable timer, correct end |
| Person already seated at startup | Presence observed; arrival unknown; full dwell excluded |
| Two crossing people behind an obstruction | No confident false timer merge; ambiguity marked incomplete |
| Camera unplugged during a visit | Unavailable state; no duration accumulated through outage |
| Mode or polygon changed mid-visit | Old visit incomplete; new revision starts independently |
| Kill process, restart | Committed history intact, active rows recovered incomplete |
| Long-running mixed cameras | Bounded memory, indexed queries, no progressive lag |

## 14. Accuracy and performance evaluation

### 14.1 Evaluation recordings

Use the existing ignored `ml-service/evaluation/` workspace. Add observation/visit ground-truth fields without breaking entrance evaluation.

Include fixed-view recordings with short stays, sitting/standing long stays, brief occlusion, mutual occlusion, re-entry, boundary walking, partial people, daytime/nighttime, different clothing, and crowd density representative of the intended public site.

Use a polygon and policy manifest with every recording. Labels need a person ID within that recording, arrival/departure observation times, truncated endpoints, and camera coverage interruptions. Keep a development/calibration set separate from a held-out validation set.

Reuse cached detections only when detector/tracker settings, input video, dimensions, sampling, and timestamps match. State explicitly what the cache validates; live scheduling, RTSP freshness, and restart behavior still require separate tests.

### 14.2 Metrics to report

- Arrival/departure and completed-visit precision/recall.
- Per-visit dwell absolute error, median absolute error, P90 error, and relative error by true-duration group.
- Fragmented visits, identity switches, and falsely merged visits.
- Presence mean absolute error over annotated samples.
- Fraction of observations classified incomplete and reasons.
- Fraction of labeled visits actually matched; error on matched visits alone is insufficient.
- Coverage accuracy under known injected outages.
- Detection/tracking timing, effective analytics FPS, frame age, skipped frames, memory, CPU/GPU use, write latency, query latency, and database growth.

### 14.3 Proposed pilot acceptance targets

These are evaluation targets to calibrate against hardware and recordings, not current capabilities:

- Exact duration arithmetic and idempotency for all deterministic fixtures.
- No completed visit produced from an unknown endpoint, restart, or long observation gap.
- No open-space values entering doorway ledger/report/cloud fields.
- Controlled, well-lit, low-density footage: target arrival/departure precision and recall of at least 90%; report both separately.
- For matched eligible visits, target at least 90% within `max(2 seconds, 10% of labeled duration)` absolute error. Also report unmatched/fragmented visits and confidence intervals/sample counts.
- No unexplained regression in entrance counting accuracy on the existing replay set.
- After warmup, target less than 10% additional processing overhead for polygon/timer work on the same detector/tracker configuration; total frame age and real-time suitability still determine acceptance.
- Target first local analytics view within 2 seconds and ordinary indexed refreshes within 500 ms on a representative 30-day dataset and target device. Record workload and percentile, not just a single result.
- At least an 8-hour mixed-mode soak at supported concurrency with bounded state and no unexplained memory growth; longer field observation is desirable before broad deployment.

Failure to meet these targets should lead to a documented correction or a narrower supported scene/profile. Do not tune thresholds on the held-out set and then report it as independent validation.

## 15. Code-change map

Existing paths to inspect/change as needed:

| Area | Files/directories |
| --- | --- |
| Camera types and defaults | `src/types/enterprise.ts`, `src/features/camera/types/camera.ts`, `src/lib/operationalDefaults.ts` |
| Configuration UI | `src/features/camera/components/CameraAddModal.tsx`, `CameraEditControls.tsx`, `CameraReadOnlyDetails.tsx`, `CameraOverlayConfig.tsx`, preview components |
| Camera orchestration | `src/features/camera/hooks/useCameraManagement.ts`, `useCameraRuntimeController.ts`, `useCameraRuntimeUpdates.ts` |
| Save/geometry utilities | `src/features/camera/utils/camera-update.ts`, validation helpers, `model/camera-overlay.ts` |
| Local service adapter | `src/features/camera/services/ml-service.ts`, `ml-service.types.ts` |
| Local configuration/runtime | `ml-service/app/config/camera_config.py`, `camera/contracts.py`, `camera/models.py`, `camera/camera_manager.py`, `camera/pipeline_manager.py` |
| Capture/display integration | `ml-service/app/camera/capture_worker.py`, `frame_geometry.py`, `frame_renderer.py` |
| Local API | `ml-service/app/main.py`, `app/api/`, proposed open-space router |
| Persistence | `ml-service/app/storage/migrations/revisions/revision_001_initial_schema.py`, profile/session serialization, new repositories |
| Dashboard | `src/features/dashboard/`, proposed `src/features/open-space/` for cohesive analytics components/services |
| Legacy sync/report boundary | `src/features/sync/services/cloud-sync.ts`, `camera-monitoring.ts`, `hooks/useDesktopCloudSync.ts`, report views/workspace adapters |
| Electron compatibility/security | `electron/ml-service-contract.ts`, request policy tests, IPC/service supervisor tests |
| Evaluation/packaging | `ml-service/scripts/replay_tracking.py`, evaluation helpers, `scripts/verify-ml-runtime.mjs`, package tests |
| Documentation | `desktop-tanaw/README.md`, `ml-service/README.md`, evaluation guide |

Backend/frontend-web files are reference points for compatibility, not primary implementation targets. Local ML contracts are currently separate from the centrally generated backend transport contracts; do not assume running the backend contract generator updates the local sidecar contract.

## 16. Validation commands for the implementation run

These commands are planned checks, not commands executed for this planning document. Follow the checked-out manifests and repository documentation if they change.

From `desktop-tanaw`:

```bash
npm ci
uv sync --directory ml-service --frozen
npm run type
npm run lint
npm test
npm run build
npm run renderer:verify
npm run test:e2e
npm run test:electron
```

From `desktop-tanaw/ml-service`:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pyright
```

Use focused new tests during development, then run the affected existing suites and final relevant checks once the implementation stabilizes. Preserve underlying exit status and test counts. Do not count skipped browser/packaged/hardware checks as passed.

Desktop/Electron and native ML dependencies were not part of the earlier web-environment readiness claim. Confirm them before promising a full desktop test run. A cloud headless browser test is useful but does not replace Windows packaged-app verification, OS secure storage, and an actual camera test.

Model assets and Windows distribution builds can be expensive. First validate the pure engine and fake pipeline; then use existing verified assets for video/live evaluation. Verify required assets before a packaged build and avoid unrelated model downloads or rebuilding every distribution target.

Run existing contract freshness checks if shared backend transport tooling was touched. Do not regenerate unrelated committed clients merely because a local sidecar schema changed.

## 17. Implementation-run checklist and completion evidence

Suggested work packages, in dependency order:

1. Contracts, mode validation, revision semantics, and polygon utilities.
2. Pure visit tracker, clocks, and synthetic observation tests.
3. SQLite records, recovery, aggregation, and repository tests.
4. Live pipeline mode selection, freshness, lifecycle, and mixed-mode integration.
5. Mode selection, zone editor, and live UI.
6. Historical desktop analytics and data-quality presentation.
7. Sync/report isolation, documentation, compatibility, and package verification.
8. Video accuracy evaluation, real-camera pilot, and soak/performance results.

At each handoff record: files changed, behavior implemented, exact test outcomes, remaining assumptions, and the next unmet acceptance gate. Keep transitions/configuration rules in one source of truth rather than repeatedly implementing them in the UI and persistence adapters.

The critical dependency chain is domain semantics -> deterministic engine -> durable records -> live pipeline -> operator UI -> accuracy validation. UI layouts can be designed earlier, but measured values must come from the completed domain/storage path. Package compatibility and sync/report isolation must land before the feature is enabled for a pilot.

If implementation must stop between work packages, keep Open Space unavailable in ordinary camera creation until its required runtime and persistence paths are present. A partially built selector that starts the entrance engine is not an acceptable intermediate release. Feature exposure can be controlled with a local development capability flag; existing entrance mode must remain usable throughout.

Before calling the feature complete, provide evidence that:

- Both modes can be configured and run together within the supported camera limits.
- Entrance counting and report behavior remain correct.
- Open-space zone geometry and observed dwell work on real video and an actual supported RTSP stream.
- No-frame timeouts, stale repeated frames, occlusion ambiguity, restart, and mode changes produce the documented outcomes.
- History survives restart with explicit incomplete observations and no fabricated continuity.
- Aggregations reconcile with eligible committed visits, including cross-midnight ranges and retention limits.
- Presence and camera downtime are visibly distinguishable.
- Mode/zone revision changes do not rewrite historical results.
- No open-space observations pollute doorway reports, sample preparation, or cloud telemetry.
- Tests, package compatibility, measured accuracy, and resource limits are reported honestly.

The initial implementation should be usable from the desktop even before any chatbot or LGU web integration exists. Future AI work can build on the explicit mode, zone, revision, coverage, sample-count, and algorithm-version fields designed here.
