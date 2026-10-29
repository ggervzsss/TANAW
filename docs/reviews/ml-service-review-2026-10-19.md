# ML service code review — 2026-10-19

Reviewed commit: `7072e1b` on `gerv`.

Implementation update: the ten findings below have now been addressed in the
working tree. See [the fix notes](ml-service-fixes-2026-10-19.md) and
[regression tests](../../desktop-tanaw/ml-service/tests/test_review_regressions.py).
The original findings below describe the reviewed commit, not the fixed code.

## Result and scope

The review found ten actionable issues: four high-priority correctness defects
and six medium-priority correctness, recovery, and performance defects. Eight
have executable reproductions. The remaining two are supported by the OpenCV
API contract and a measured database workload respectively.

Reviewed camera startup/shutdown, multi-camera scheduling, RTSP capture and
authentication, detection/tracking, paired-line counting, deferred ReID results,
Open Space visit tracking and persistence, SQLite transactions, reporting,
service authentication, HTTP/WebSocket handling, and existing tests. The
desktop overlay update path was also checked because it affects the reported
lag, although it is outside the ML service.

This is a source review and isolated simulation, not a live three-camera
accuracy benchmark. It does not establish which defect caused a particular
missed crossing on the user's laptop. In particular, findings 1 and 2 require
deferred ReID entries; Auto on the Compatibility profile disables ReID by
default, so those findings do not explain misses in every configuration.

At review time application source and real development databases were not
changed. The reproduction harness has since been converted into a runner for
the corrected regression scenarios.

## High-priority findings

### 1. [P1] Deferred entries can share an event ID and silently lose counts

Locations:
[event ID construction](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L1673),
[pending entry flush](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L1523),
[duplicate event handling](../../desktop-tanaw/ml-service/app/storage/repositories/occupancy_event_repository.py#L34).

When ReID needs more samples, the counter increments immediately but event
persistence is deferred. `_persist_count_event()` later constructs the event ID
from the **current** direction total, rather than a sequence number captured
when that crossing occurred. Two queued entries flushed together therefore get
the same ID. `insert or ignore` drops the second event without reporting an
error. This also occurs when a newer immediate entry advances the counter
before an older queued entry is saved.

Reproduced with two independently tracked people crossing in the same frame:

```text
physical_entries: 2
pending_before_flush: 2
ledger_entries: 1
ledger_occupancy: 1
```

Impact: the live camera count, dashboard/report total, unique total, and
enterprise occupancy can disagree. A faster machine does not fix the ID logic.

Fix: assign an immutable event ID, direction sequence, observation timestamp,
and count snapshot at crossing time. Preserve those fields through deferred
work and retry the same ID only for that same crossing. Add tests for multiple
queued entries and queued/immediate entry interleaving.

### 2. [P1] Waiting for ReID changes event order and can leave occupancy wrong

Locations:
[entry persistence deferred](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L1176),
[occupancy update](../../desktop-tanaw/ml-service/app/storage/repositories/occupancy_event_repository.py#L73).

Entry events can wait for ReID while exits are saved immediately. The database
updates occupancy in persistence order and clamps negative occupancy to zero.
If occupancy starts at zero and an entry is queued, an exit saved before it
leaves occupancy at zero. Saving the delayed entry then increases it to one.
The final entry and exit totals can match while occupancy remains incorrect.
Different cameras sharing the enterprise ledger can produce the same ordering
problem.

Reproduced with one tracked person entering and leaving before the pending
entry expires:

```text
entries: 1
exits: 1
physical_occupancy: 0
ledger_occupancy: 1
```

Fix: commit physical crossings and occupancy without waiting for appearance
identification. Attach or reconcile unique-visitor metadata afterward using the
immutable event ID. Test entry/exit interleaving across both one and multiple
cameras. This requires a separate fix from merely making event IDs unique.

### 3. [P1] Report submission can consume events absent from its totals

Location:
[report snapshot and submission](../../desktop-tanaw/ml-service/app/storage/local_data_store.py#L429),
especially the final update of every event whose `submitted_report_id is null`.

`record_report_submission()` computes the summary, checks existing submissions,
and computes camera breakdowns through separate database connections before
opening the write transaction. A processing worker can append an event between
those operations. The final update assigns that event to the report even when
it was absent from the report summary. Camera breakdowns can also disagree with
the overall total.

Reproduced by inserting one event immediately after the summary query:

```text
report_entries: 1
events_consumed: 2
events_left_for_next_report: 0
```

Impact: the extra crossing is absent from the submitted total and unavailable
to the next report; later raw-event purging can remove the remaining evidence.

Fix: select the report event set, compute totals/breakdowns, verify submission
uniqueness, and mark precisely that set within one transaction. Alternatively
capture an immutable event cutoff and consistently use it for all operations,
including the final update. Test an event arriving during submission and
concurrent submission requests.

### 4. [P1] A start request during enterprise switching can run in the wrong scope

Locations:
[enterprise switch](../../desktop-tanaw/ml-service/app/camera/pipeline_manager.py#L86),
[start request](../../desktop-tanaw/ml-service/app/camera/pipeline_manager.py#L155),
[startup execution](../../desktop-tanaw/ml-service/app/camera/pipeline_manager.py#L194).

An enterprise switch holds `_lifecycle_lock`, clears pending starts, and closes
old pipelines before assigning the new enterprise. `request_start()` only
holds `_lock`, so it can enqueue another start during that cleanup window.
The startup thread waits for the lifecycle lock and then uses the registry's
new enterprise. Neither its fingerprint nor pending record captures the
enterprise generation under which it was accepted.

Reproduced using a barrier inside an old pipeline's `close()`:

```text
accepted_during_enterprise_A: true
camera_started_under: enterprise-B
```

Impact: a camera and observations requested in one enterprise context can be
bound to another enterprise's local storage.

Fix: capture the enterprise ID and lifecycle generation with each pending
request and verify both before creating or starting a pipeline. Invalidate
requests throughout the switch, not only at the start of cleanup. Add a
deterministic concurrency test for the reproduced ordering.

## Medium-priority findings

### 5. [P2] Startup overwrites the saved count snapshot before restoring it

Location:
[startup persistence before load](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L223).

A fresh pipeline starts with an empty counter. `start()` assigns the camera
configuration and persists its Starting state before calling
`load_session()`. That write replaces the camera's saved counts with zero, so
the later restore reads the newly overwritten state. The registry constructs
fresh managers with `restore_session=False`, making this relevant after an app
restart.

Reproduced by seeding a stopped camera with five entries and two exits, then
starting a fresh manager with stream/model work stubbed:

```text
saved_entries_before_start: 5
restored_entries: 0
saved_entries_after_start: 0
```

The doorway event ledger remains intact; this defect resets the per-camera
monitoring snapshot and can cause disagreement with ledger-based totals.

Fix: load the previous snapshot before any startup write and restore the
appropriate entrance/exit counts before publishing Starting. Keep lifecycle
state separate from count restoration. Test a fresh manager, rather than only
restarting the same in-memory instance.

### 6. [P2] The intended OpenCV capture timeouts are configured ineffectively

Location:
[capture configuration](../../desktop-tanaw/ml-service/app/camera/stream_reader.py#L18).

The service sets `CAP_PROP_OPEN_TIMEOUT_MSEC` and
`CAP_PROP_READ_TIMEOUT_MSEC` with `capture.set()` on an unopened capture, and
again after `open()`. OpenCV defines both as **open-only** properties supplied
through the constructor/open parameter list. On the local unopened capture,
both `set()` calls return `False`, which the service ignores. The fallback
capture is opened without parameters too.

The FFmpeg `stimeout` environment option is a separate mechanism and does not
establish that both intended OpenCV timeouts are in effect. This review did not
measure a live network timeout.

Impact: a stalled camera can take longer than the intended five seconds to
fail or stop. Startup also holds the registry lifecycle lock during probing,
so this can delay other cameras' lifecycle operations.

Fix: pass the timeout properties in `VideoCapture.open(..., params)` on every
supported path and handle unsupported configuration explicitly. Verify opening,
reading, and cancellation against a controlled nonresponsive RTSP server.
Also reconsider waiting for 90 failed reads before reconnecting: a failed-read
count does not bound elapsed outage time.

External API reference:
[OpenCV capture property documentation](https://docs.opencv.org/doc/doxygen/html/d4/d15/group__videoio__flags__base.html).

### 7. [P2] A capture-open exception bypasses the reconnect loop

Location:
[capture worker](../../desktop-tanaw/ml-service/app/camera/capture_worker.py#L31).

`open_capture()` runs before the worker's `try/except/finally`. An exception
from capture construction or opening therefore escapes `run()`, terminates the
reader thread, and never invokes `mark_reconnecting()`. The processing loop can
continue waiting for frames, leaving the camera apparently active without a
working reader or scheduled reconnect.

Reproduction injects an exception from `open_capture()` and observes an escaped
exception with zero reconnect notifications.

Fix: include capture construction/opening in the protected retry block, release
only an initialized capture, and ensure each failed attempt publishes a safe
error and follows the bounded reconnect policy. Test both exceptions and a
normal `isOpened() == False` result.

### 8. [P2] One cleanup exception abandons the remaining camera workers

Locations:
[registry disposal](../../desktop-tanaw/ml-service/app/camera/pipeline_manager.py#L308),
[manager close](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L498).

Registry disposal clears the pipeline dictionary before sequentially calling
`close()`. If the first pipeline raises, later pipelines are never closed and
are no longer registered. Reporting cleanup is skipped too. A manager also
marks itself closed before `stop()`; if that fails, a subsequent `close()`
returns early without disposing its ReID workers.

Reproduced with the first pipeline's close raising:

```text
second_camera_still_running: true
second_camera_close_calls: 0
second_camera_still_registered: false
```

Impact: shutdown, profile deletion, or context switching can leave workers and
streams alive after a storage/lifecycle failure. The earlier baseline-mismatch
shutdown trace is a concrete example of a cleanup exception; changing the
baseline during pre-production is itself expected policy, not a review defect.

Fix: attempt cleanup for every pipeline and reporting resource using
`try/finally` or accumulated errors, guarantee worker disposal even when session
finalization fails, and retain enough state to retry incomplete cleanup.

### 9. [P2] Live state generation repeatedly scans the complete event history

Locations:
[runtime state construction](../../desktop-tanaw/ml-service/app/camera/pipeline_manager.py#L424),
[per-camera health](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L651),
[summary queries](../../desktop-tanaw/ml-service/app/storage/local_data_store.py#L214),
[WebSocket refresh interval](../../desktop-tanaw/ml-service/app/main.py#L269).

Each runtime snapshot computes an enterprise summary over all submitted and
unsubmitted events, then computes summaries again for each camera's health.
The summary fetches all matching occupancy rows into Python and walks them to
reconstruct peak occupancy. This repeats while the live WebSocket requests
snapshots, with a 200 ms wait between active-camera snapshots; desktop polling
adds further requests. Hardware/model availability is also recomputed per
camera health payload.

An isolated synthetic ledger with 30,000 events measured median enterprise
summary time of about 241 ms versus about 6 ms for an empty ledger across five
calls each. These timings were collected on this machine while other review
checks were running; they demonstrate scaling cost, not a stable hardware
benchmark. Full multi-camera snapshot time was not measured.

Impact: diagnostic updates increasingly compete with inference and counting
as history grows. UI lag can worsen even when the camera workload is unchanged.

Fix: keep cheap runtime snapshots separate from report aggregation, reuse
enterprise occupancy already maintained transactionally, cache or incrementally
maintain summary totals, and invalidate caches on events, corrections,
submissions, and reconciliation. Cache static hardware/model capability data.
Benchmark complete snapshots across growing histories and multiple subscribers.

### 10. [P2] WebSocket database errors are swallowed as ordinary disconnects

Location:
[WebSocket exception handling](../../desktop-tanaw/ml-service/app/main.py#L277).

`LocalDatabaseResetRequiredError` inherits `RuntimeError`, so the broad catch
returns without transmitting the reset instruction, choosing an explicit close
reason, or logging the failure. The HTTP exception handler does not apply to
this WebSocket path. A client that automatically reconnects repeats the same
failure, producing the connection-open/closed loop seen in the earlier logs.

Reproduction injects the database exception into state-envelope construction:
the socket is accepted, receives zero error messages, and gets no explicit
server close call.

Fix: distinguish configuration/database failures from client disconnects,
publish a sanitized typed failure or explicit close reason, and teach the
desktop bridge to suspend retries for a reset-required condition until the
condition changes. Add WebSocket tests for database mismatch and other internal
runtime failures.

## Performance improvements requiring workload validation

1. **Review CPU scheduling rather than simply removing the global lock.**
   [The inference guard](../../desktop-tanaw/ml-service/app/detection/yolo_detector.py#L256)
   serializes all runtimes, although its comment describes GPU protection.
   Frames are selected before waiting for that lock, so a waiting camera may
   process an older frame even after capture has advanced. This is a confirmed
   scheduling constraint, but parallel CPU inference is not automatically
   faster because OpenVINO/PyTorch may already use several CPU threads. Compare
   the current behavior with a fair scheduler, explicit per-runtime concurrency
   limits, and a shared CPU thread budget before changing it.

2. **Distinguish capture time, queue wait, inference time, and display delay.**
   `processing_frame_age_ms` is measured at processing start, before waiting
   for detector execution, while `detector_p50_ms/p95_ms` include waiting for
   the global inference lock. Those measurements cannot separately identify
   queue contention and actual model cost. Entrance/exit tracking also uses a
   monotonic time sampled before inference, whereas Open Space consumes the
   supplied capture timestamp. Add explicit stage timings and test temporal
   counting behavior under variable inference delays and dropped frames.

3. **Avoid making status reads wait for area inference.**
   [The area state reader](../../desktop-tanaw/ml-service/app/camera/camera_manager.py#L1271)
   acquires `_counting_lock`, which is also held throughout area detection and
   database checkpointing. A slow Open Space inference can therefore delay a
   complete multi-camera runtime snapshot. Consider publishing an immutable
   area snapshot after each update and reading it without holding the counting
   lock across inference. Measure the complete snapshot latency first.

## Related desktop issue explaining the reported box lag

[The desktop runtime hook](../../desktop-tanaw/src/features/camera/hooks/useCameraRuntimeUpdates.ts#L19)
skips the direct WebSocket when `window.tanawMlService` exists. It then uses a
2.5-second fallback poll. The bounding boxes and center points are drawn from
that state while the video arrives on a separate stream. This is a concrete
source of visible overlay delay, even when backend counting continues correctly.

The Electron main process already has an authenticated live-event bridge.
Consume those events for camera state, with polling retained as a fallback.
Test update delivery, disconnection recovery, scope changes, and cleanup. This
is outside the ML-service findings and is not evidence of a missed crossing.

## Verification and reproduction

Checks completed against the existing application:

- `.venv/bin/python -m pytest -q`: **238 passed, 37 subtests passed**.
- `.venv/bin/python -m ruff check app scripts tests`: passed.
- `.venv/bin/python -m mypy app`: passed, 71 source files.
- Eight isolated defect reproductions: confirmed, using temporary directories
  and fake detections/pipelines; no live cameras, camera passwords, real model
  inference, or user databases are required.

Run the reproduction harness from `desktop-tanaw/ml-service`:

```bash
.venv/bin/python ../../docs/reviews/reproduce_ml_service_review.py
```

The original review harness asserted the incorrect behavior. It has now been
replaced by a runner for `tests/test_review_regressions.py`, which checks the
corrected behavior, transaction rollback, cache invalidation, and a local RTSP
timeout. Success now means those regression checks passed.

Remaining validation gaps: live RTSP timeout/decoder tests, real three-camera
load and thermal behavior, ground-truth crossing accuracy, and Windows runtime
behavior were not exercised. No statement here attributes all lag or missed
counts to either hardware or software alone.

Recommended order: fix physical event durability/order and report snapshots
first; then enterprise/startup/cleanup correctness; then capture recovery,
runtime snapshot cost, and desktop live updates; finally benchmark scheduling
and model settings against the same labeled footage.
