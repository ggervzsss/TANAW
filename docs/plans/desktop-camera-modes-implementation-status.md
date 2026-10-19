# Desktop camera modes: implementation and verification

Implemented in the `work` checkout based on `95ea664`, October 18, 2026.
This is the local desktop implementation. Physical-camera acceptance and release
qualification remain outstanding.

## Delivered behavior

- Per-camera Entrance / Exit and Open Space modes; mixed installations retain
  the existing camera/concurrency limits.
- One named polygon per Open Space camera, edited against decoded video using
  normalized coordinates. Unconfigured cameras can run a preview without
  starting detector inference or collecting dwell observations.
- Separate presence and visit engine using physical tracks and monotonic
  timestamps. Observed arrivals/departures, qualification, boundary confirmation,
  short gaps, lost tracks, interruptions, and clock discontinuities are handled
  explicitly. Reappearance after a finalized observation starts a new visit.
- Live zone presence, temporary missing tracks, elapsed visit labels, and
  unavailable states. Open Space does not return establishment occupancy.
- Enterprise-scoped SQLite configuration revisions, analysis runs, visit
  checkpoints, presence intervals, hourly aggregates, crash recovery, atomic
  writes, idempotent finalization, and bounded retention cleanup.
- Protected local summary/history/visit endpoints and a dashboard with camera,
  revision, and time-range selection; completed dwell mean/median/P90,
  distribution, coverage, hourly activity, and paginated observations.
- Entrance counts, official reports, sample preparation, and legacy cloud
  telemetry remain separate from area observations. Mixed-mode telemetry uses
  only Entrance / Exit cameras; Open Space-only installations skip the legacy
  telemetry payload.
- Coordinated local API contract version 2 across Python, Electron, runtime
  verification, and test fixtures.
- Recorded-detection replay/evaluation tooling, with cache fingerprint checks
  and conservative temporal matching for controlled annotated clips.

## Measurement and operational boundaries

Dwell describes estimated time in the visible polygon. It does not establish
total time in a park or unique people. Missing arrivals, disappearance, stream
loss, and interrupted runs do not produce completed dwell samples. Completed
dwell statistics use observed-end cohorts; visit counts use first-observation
cohorts. Short gaps retain uncertainty metadata. Presence coverage unions
overlapping wall-clock spans after a backward clock correction.

Raw ended visits and presence intervals have 30-day retention; hourly aggregate
records have 180-day retention. Detailed queries cover at most 30 days. The
current dashboard does not offer longer-range aggregate history or reconstruct
quantiles from hourly averages. Cleanup deletes bounded raw batches, so an old
backlog can take multiple runtime cleanup passes to remove.

Cloud Open Space storage, LGU analytics, chatbot answers, multi-zone cameras,
cross-camera identity, and additional CCTV integrations remain outside this
implementation. An Open Space-only gateway may appear delayed/offline in the
existing LGU portal because it does not send legacy doorway telemetry.

The canonical SQLite `001` schema was updated according to repository policy.
Older development ledgers trigger the existing reset-required flow. No existing
database was reset or automatically erased during implementation. See the
[desktop operator instructions](../../desktop-tanaw/README.md#camera-analysis-modes-and-open-space-dwell)
before resetting a development ledger.

## Verification

Commands were run in the desktop project or its `ml-service` directory using
the installed, locked dependencies.

| Check | Result |
| --- | --- |
| Python formatting and Ruff | Passed |
| Python mypy and Pyright | Passed; 101 source files |
| Python pytest | 233 passed, 15 subtests passed; one existing ReID test skipped because its bundled model is absent |
| TypeScript type check and ESLint/Tailwind | Passed |
| Vitest desktop suite | 227 passed across 63 test files |
| Browser suite | 31 of 32 passed, including both new Open Space scenarios |
| New Open Space browser scenarios after final UI corrections | Both passed |
| Electron authenticated IPC and lifecycle test | Passed under Xvfb |
| Deployment-configured renderer verification | Production build and packaged-origin/CSP configuration checks passed |

The browser failure is the existing navigation glass/drag animation test in
`e2e/enterprise-interactions.spec.ts`. Its isolated run failed at the 900 ms
animation assertion on line 587. A separate untouched archive of baseline
`95ea664` reproduced the same isolated assertion failure with the same Chromium
executable. The navigation implementation and assertion were left unchanged.

Automated coverage includes polygon validation, duplicated/stale timestamps,
independent visitors/reentry, unknown arrivals, short gaps, interruptions,
revision separation, cross-midnight cohorts, exact quantiles, pagination,
rollback/retry, retention, unavailable coverage, backward-clock overlap,
enterprise/API isolation, the camera-manager persistence path, preview-only
startup, cloud exclusion, mixed-mode telemetry, and cached replay evaluation.

## Required field and release acceptance

These checks require equipment, representative footage, or a target release
environment unavailable in this cloud checkout:

1. Validate real RTSP capture, enablement of the camera's local stream, and
   reconnection against the intended Tapo/additional camera models.
2. Annotate representative public-space clips, including crowded overlap,
   occlusion, lighting changes, and reentry. Measure visit precision/recall,
   duration error, completeness, and identity fragmentation. Controlled replay
   fixtures do not establish real-world tracking accuracy.
3. Run the planned sustained mixed-camera workload and interruption/low-disk
   exercises on the intended desktop hardware. No eight-hour soak or measured
   six-camera throughput acceptance is claimed.
4. Build and exercise the Windows installer and packaged Python runtime with
   verified detector/model assets and the normal release/signing workflow.

Do not treat the software checks above as evidence that these field gates have
passed.
