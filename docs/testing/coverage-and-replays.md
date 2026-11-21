# Coverage baselines, the disposable stack, and camera replays

This guide covers the repeatable checks that sit beside the fast checks in
`AGENTS.md`: the branch-coverage baseline for critical workflows, the
disposable-stack report scenario, and labeled camera replays for accuracy
regressions. CI runs the first two (`.github/workflows/pr-checks.yml` and
`.github/workflows/integration.yml`). Camera replays depend on recordings that
are not in git, so they run locally.

## Branch-coverage baseline

Each project measures branch coverage only for the code behind its critical
workflows, and fails when a workflow drops below its recorded baseline. The
baselines were measured on 2026-11-21 against commit `72c06d3` plus the test
changes that introduced them, and were rounded down to the nearest half
percent.

| Project                 | Workflow                        | Measured | Baseline |
| ----------------------- | ------------------------------- | -------: | -------: |
| backend-tanaw           | Report intake and consolidation |    71.3% |    71.0% |
| backend-tanaw           | Sign-in and activation          |    59.0% |    59.0% |
| backend-tanaw           | Live updates                    |    36.8% |    36.5% |
| backend-tanaw           | Email delivery                  |    57.0% |    57.0% |
| backend-tanaw           | Desktop telemetry               |    60.6% |    60.5% |
| desktop-tanaw/ml-service | Entry and exit counting         |    67.6% |    67.5% |
| desktop-tanaw/ml-service | Visitor identity                |    74.7% |    74.5% |
| desktop-tanaw/ml-service | Saved reports and occupancy     |    83.6% |    83.5% |
| desktop-tanaw           | Cloud sync                      |    57.4% |    57.0% |
| desktop-tanaw           | Report logic                    |    57.4% |    57.0% |
| desktop-tanaw           | Live updates                    |    65.5% |    65.0% |
| frontend-tanaw          | Report logic                    |    54.6% |    54.5% |
| frontend-tanaw          | Live updates                    |    64.5% |    64.5% |
| frontend-tanaw          | Session store                   |    25.0% |    25.0% |

Two runs of each measurement gave identical results.

Where the measured areas are defined:

- Python projects: `[tool.coverage.run]` in `pyproject.toml` names the
  measured source, and `coverage-baseline.json` maps each workflow to its paths
  and minimum. `scripts/coverage/check_branch_baseline.py` compares a run with
  the baseline. It uses only the standard library.
- TypeScript apps: `coverage` in `vitest.config.ts` lists the measured files,
  and its `thresholds` hold the per-workflow branch minimums.

### Run it

```shell
# backend-tanaw: most critical paths need PostgreSQL, so point at a disposable,
# migrated database first (the integration job does this with a service container).
export TANAW_TEST_DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@127.0.0.1:5432/tanaw_test
uv run pytest --cov --cov-report=json:coverage.json
python3 ../scripts/coverage/check_branch_baseline.py coverage.json coverage-baseline.json

# desktop-tanaw/ml-service
uv run pytest --cov --cov-report=json:coverage.json
python3 ../../scripts/coverage/check_branch_baseline.py coverage.json coverage-baseline.json

# desktop-tanaw or frontend-tanaw (fails on a missed threshold; HTML report in coverage/)
npm run test:coverage
```

Without `TANAW_TEST_DATABASE_URL` the backend's PostgreSQL tests skip, and its
numbers fall below the baseline. Set `TANAW_REQUIRE_POSTGRES=true` to make a
missing database fail instead of skip, as CI does.

### Raise a baseline

When tests improve a workflow, run the check with `--update` to print the new
percentages. Then raise `min_branch_percent` in `coverage-baseline.json`, or the
matching `thresholds` entry in `vitest.config.ts`, and update the table above.
Lower a baseline only together with a recorded reason, such as removed code.

## Disposable-stack report scenario

`scripts/e2e-stack/run.mjs` carries one report through every real component:

1. A real ML service (`desktop-tanaw/ml-service`, temporary data folder)
   prepares counts and saves an establishment report for last month.
2. The desktop renderer, built against the stack backend, signs in as a
   synthetic Enterprise and uploads the report with its own cloud-sync code.
   Only the Electron IPC bridge is replaced: it forwards each request to the
   real ML service.
3. The backend stores it in a throwaway PostgreSQL database migrated to the
   current Alembic head.
4. A synthetic Staff account reviews, accepts, generates and finalizes the
   monthly report in the built web portal.

The spec is `desktop-tanaw/tests/e2e/stack/report-flow.spec.ts`. It reuses the
deployed verifier's ML endpoints (`/sample/prepare`, `/reports/local-submit`)
and adds the Staff portal step that the verifier leaves unchecked.

```shell
node scripts/e2e-stack/run.mjs               # build, start, run, tear down
node scripts/e2e-stack/run.mjs --skip-build  # reuse the last renderer and portal builds
```

Prerequisites: Node 24, `uv`, `npm ci` in `desktop-tanaw` and `frontend-tanaw`,
Playwright Chromium, and Docker unless `TANAW_STACK_DATABASE_URL` points at an
empty disposable database. The script checks all of these, and that ports
8021, 8775, 5185 and 5186 are free (override them with
`TANAW_STACK_{API,ML,DESKTOP,PORTAL}_PORT`), and stops with a clear message
when one is missing.

Every password and token is random per run, and every account is synthetic.
Service logs are written to `desktop-tanaw/test-results/stack/logs`, traces to
`desktop-tanaw/test-results/stack`, and the HTML report to
`desktop-tanaw/playwright-report/stack`.

## Labeled camera replays

Unit tests cover counting, tracking evaluation and dwell matching with
synthetic data, so they stay deterministic in CI
(`tests/test_tracking_evaluator.py` and `tests/test_open_space_replay.py`).
Accuracy regressions need real recordings with labels, which run locally
through the replay tools in `desktop-tanaw/ml-service/scripts`.

### Assets and where they live

| Asset                 | Location (under `desktop-tanaw/ml-service/evaluation/`) | In git |
| --------------------- | ------------------------------------------------------- | ------ |
| Recordings            | `clips/*.mp4`                                           | No     |
| Detection caches      | `cache/*.jsonl`                                         | No     |
| Labels (ground truth) | `ground-truth/*.jsonl` or `*.json`                      | No     |
| Results               | `results/`                                              | No     |

These folders are ignored by git because recordings are large and their
licensing does not allow redistribution. A detection cache records the
recording's SHA-256 and a fingerprint of the detector settings, and a replay
refuses a cache that no longer matches. That way a regression run compares
counting, tracking and ReID changes against identical detections.

### Label formats

Entry/Exit tracking labels for `scripts.evaluate_tracking` are JSON Lines, one
labeled frame per line:

```json
{"frame_index": 12, "people": [{"id": "person-1", "bbox": [10, 10, 50, 100]}], "events": [{"person_id": "person-1", "direction": "entry"}]}
```

`bbox` is `[x1, y1, x2, y2]` in source pixels. `events` lists crossings, with
`direction` set to `entry` or `exit`.

Open Space labels for `scripts.replay_open_space` are a JSON file of visits in
seconds from the start of the recording. Set `"complete": false` for a visit
that the recording cuts off:

```json
{"visits": [{"entered_at_seconds": 1.0, "exited_at_seconds": 5.0}]}
```

### Run a regression check

From `desktop-tanaw/ml-service`, with models from `npm run models:setup` (YOLO
weights are not in git):

```shell
# 1. Replay a recording. The first run fills the detection cache; later runs reuse it.
uv run python -m scripts.replay_tracking \
  --video evaluation/clips/<clip>.mp4 \
  --detections-cache evaluation/cache/<clip>-balanced-5fps.jsonl \
  --profile balanced --sample-fps 5 \
  --output evaluation/results/<clip>-<change>.jsonl \
  --summary-output evaluation/results/<clip>-<change>-summary.json

# 2. Score it against the labels and keep the report.
uv run python -m scripts.evaluate_tracking \
  --ground-truth evaluation/ground-truth/<clip>.jsonl \
  --predictions evaluation/results/<clip>-<change>.jsonl \
  --report-output evaluation/results/<clip>-<change>-report.json

# Open Space: replay the cached detections against an area and its visit labels.
uv run python -m scripts.replay_open_space \
  --detections-cache evaluation/cache/<clip>-balanced-5fps.jsonl \
  --config <area-config>.json \
  --ground-truth evaluation/ground-truth/<clip>-visits.json \
  --output evaluation/results/<clip>-<change>-open-space.json
```

Run the same commands on `main` and on the change, then compare the reports:
identity switches, missed and extra crossings, unique-count error and dwell
recall. A change that alters detections (detector model, image size,
confidence, crop) needs `--rebuild-cache`, and its results are not comparable
with runs on the old cache.

### External prerequisites

- **Recordings.** The two local clips used so far (`cctv-controlled-occlusion-40s`,
  `cctv-dense-doorway-60s`) and their caches exist only on the developer's machine.
  Others need their own copies under a licence that allows the use.
- **Labels.** No ground-truth labels exist in the project yet, so accuracy
  regressions cannot be scored until someone labels at least one Entry/Exit and
  one Open Space recording in the formats above.
- **Models.** YOLO weights come from `npm run models:setup`. The ReID ONNX files
  and sex heads are in git.
- **Performance figures.** Replays from a cache measure counting and identity
  logic only. Live RTSP timing and camera placement still need a mounted camera.
