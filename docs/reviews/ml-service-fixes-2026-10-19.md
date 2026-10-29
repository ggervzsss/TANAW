# ML service fixes — 2026-10-19

This change addresses all ten findings in the
[ML-service review](ml-service-review-2026-10-19.md), plus the related desktop
overlay delay. No database schema changes or development-data reset are needed.

## What improves for users

| Before | After |
| --- | --- |
| Two entries waiting for identification could become one saved event. | Each crossing has its own ID and is saved immediately. |
| Waiting for visitor identification could put an exit before its entry in storage. | Occupancy updates when the crossing is counted; identification finishes separately. |
| A report could consume a crossing missing from its total. | Report totals, camera breakdowns, and consumed events use the same atomic snapshot. |
| Camera counts could reset after restarting the application. | Saved camera totals are loaded before startup status is written. |
| A camera opening error could leave the reader stopped without recovery. | Opening and reading failures use the reconnect policy, with real capture timeout parameters. |
| One cleanup error could leave other cameras running invisibly. | Cleanup attempts every camera and keeps failed resources available for retry. |
| Pending starts could follow an enterprise switch into the wrong account. | Switching rejects new starts and invalidates older queued starts. |
| Boxes and center points waited for a 2.5-second poll. | The desktop receives camera state through the existing authenticated live-event bridge. |
| Live status repeatedly reconstructed report history. | Live status uses authoritative occupancy and cached, lightweight identity totals. |
| A reset-required database error caused repeated silent reconnects. | TANAW receives the reset instruction and pauses the failing live connection until an explicit restart/context recovery. |

## Implementation details

### Counting and reports

- Crossing IDs are generated at the physical event, independent of subsequent
  counter totals or ReID timing. Physical count persistence failures propagate
  to the camera's failure handling instead of being silently discarded.
- Pending ReID entries are already durable in the event ledger. Completing
  identification updates only identity metadata for the original ID, preserving
  its timestamp, count snapshot, and occupancy effect.
- Interrupted identification is finalized as an explicit degraded unique
  estimate during camera restart. Report submission also freezes unresolved
  estimates before taking its snapshot; later results cannot change those
  submitted event records.
- Report submission uses `begin immediate` and shares the same SQLite
  connection with nested store/repository calls through a context-local
  transaction. Failures roll back the complete submission, and concurrent
  events remain available for the next report.

### Camera lifecycle and recovery

- Pending starts carry a context generation. Context changes invalidate queued
  work and reject starts while the switch is in progress.
- Shutdown/stop/removal attempt cleanup for every camera. Failed disposals stay
  registered so they can be retried. ReID worker disposal runs even if session
  persistence fails during stop.
- Capture open/read timeouts are passed as OpenCV open parameters. A failed
  RTSP open is not repeated through a second implicit backend, avoiding a
  duplicate authentication attempt during a single probe.
- Capture opening is inside the retry handler. Failed reads are bounded by
  elapsed outage time rather than waiting for 90 failed reads.
- An old processing session cannot finalize the area tracker of a newer
  session during teardown.

### Live updates and runtime cost

- Camera overlays consume typed Electron live events, with polling retained
  for disconnected or older bridges. The service's active-camera WebSocket
  interval is 200 ms; actual update rate also depends on processing and load.
- The main-process parser validates detection coordinates consumed by the UI
  and accepts Open Space's null doorway totals only for that analysis mode.
- The camera controller ignores other enterprises' state and prevents old HTTP
  responses from overwriting newer pushed state or clearing a terminal error.
- Database reset failures use a typed error envelope and close code `4009`.
  The main bridge remembers the error for new subscribers, pauses retries, and
  reconnects on an explicit service restart or successful context selection.
- Runtime snapshots read the existing authoritative occupancy state rather
  than calling full report aggregation. Identity totals use a smaller query
  and a cache invalidated by committed writes across service stores for the
  same database. This cache assumes the service owns writes to its live
  database; database reset/maintenance still requires closing the application.
- Hardware capability probing is cached for the service lifetime. Open Space
  publishes copied status snapshots so status reads do not acquire the
  counting lock held during inference/checkpointing.

## Validation

Completed checks:

- Full Python suite: 258 tests and 37 subtests passed, including 20 review
  regression tests.
- Python Ruff and mypy checks passed (71 application source files checked by
  mypy).
- Full desktop unit suite: 264 tests passed across 64 files.
- Desktop production build, TypeScript, ESLint, and Tailwind checks passed.
- Browser integration: pushed overlay movement, polling fallback, and reset
  error persistence passed.
- Electron integration: authenticated live events through main/preload/renderer,
  paused retries after a terminal error, and explicit recovery passed.

The regression suite includes queued crossings, cross-camera occupancy,
concurrent report submission and rollback, startup restoration, enterprise
switching, failure-resistant cleanup, cache invalidation, area status reads,
and WebSocket reset handling. A local TCP server that never answers verifies
the actual OpenCV open timeout without accessing a real camera.

The original counting test fixture was also corrected: replacing its encoder
had left its worker pointing at the real bundled ReID model. The fixture now
uses its intended missing-model encoders, and four geometric crossing tests
use controlled observation timing.

Run the focused regressions from `desktop-tanaw/ml-service`:

```bash
.venv/bin/python ../../docs/reviews/reproduce_ml_service_review.py
```

The browser scenario checks pushed box movement, fallback polling after a
disconnect, and a persistent reset instruction. Electron integration exercises
the actual authenticated WebSocket → main process → preload → renderer path,
including paused retries and explicit recovery, using isolated test data.

## Practical limits

These fixes remove known software errors and avoidable UI/status overhead.
They do not guarantee a particular camera FPS or crossing accuracy on the
ThinkPad. Three real camera streams, H.265 decoding, inference, and scene
conditions still require an on-device load/accuracy test.

The global inference guard is retained. Unrestricted CPU concurrency could
make performance worse when inference runtimes already use multiple threads.
A fair scheduler, CPU thread budgeting, and finer queue/inference timing remain
benchmark-driven improvements rather than unvalidated changes in this patch.
