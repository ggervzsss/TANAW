# Camera Stress-Test Workspace

Keep local clips and generated results in this directory. They are ignored by
Git because recordings may contain sensitive video and generated caches can be
large.

For the simplest Linux and Windows instructions, start with
[CAMERA_STRESS_TEST_GUIDE.md](CAMERA_STRESS_TEST_GUIDE.md).

## Directory layout

```text
evaluation/
  clips/          raw MP4/MKV camera recordings
  cache/          reusable YOLO + tracker JSONL records
  ground-truth/   hand-labeled JSONL
  results/        predictions, summaries, reports, and annotated videos
```

Create those four directories if they do not exist.

## Clip requirements

Use raw camera recordings whenever possible. A screen recording is acceptable
for early debugging only when `--crop-normalized LEFT TOP WIDTH HEIGHT` isolates
the camera pixels. Do not record a screen that already contains TANAW bounding
boxes; those overlays contaminate detector input and make latency impossible to
measure accurately.

Three people are sufficient when each clip targets a specific failure:

- `single-walk`: one clean crossing in each direction
- `fast-crossing`: run or move quickly across each tripwire
- `short-occlusion`: disappear behind an object and return
- `mutual-occlusion`: two people cross and overlap
- `re-entry`: the same person exits the view and returns
- `tripwire-leap`: sampled positions land on opposite sides of the line
- `edge-and-poor-light`: partial boxes, clipping, blur, or low light

Repeat each action several times and keep clips short. Public multi-person
tracking datasets can supplement these controlled CCTV clips later, but they
do not replace footage from the intended camera angle.

## Ground truth

Label only sampled frames used by replay. Every person keeps one `id` for the
whole clip, including before and after a short occlusion:

```json
{"frame_index":12,"people":[{"id":"person-1","bbox":[10,20,80,180]}],"events":[]}
{"frame_index":15,"people":[{"id":"person-1","bbox":[20,20,90,180]}],"events":[{"person_id":"person-1","direction":"entry"}]}
```

Record the event on the first sampled frame where the person crosses the
configured tripwire. The evaluator tolerates a small frame difference through
`--event-frame-tolerance`.

## Reproducible comparison

First verify that assets exist and ONNX Runtime can initialize them:

```bash
npm run models:verify -- --profile balanced --reid quality
```

From `desktop-tanaw`, create one detector cache with `--rebuild-cache` and
`--reid off`. Then reuse that exact cache for `--reid fast` and
`--reid quality`. Compare:

- IDF1 (higher is better)
- ID switches and fragmentations (lower is better)
- crossing precision and recall (higher is better)
- unique-count error (lower is better)
- detector, association, and total processing time

The deterministic replay applies embeddings one frame after sampling, matching
the ordering of the live asynchronous pipeline. It intentionally removes
thread-scheduling noise so model/association changes can be compared fairly.
The quality variant measures quality-embedding extraction, but cross-session
visitor-gallery decisions still need a live integration test. Use live health
telemetry afterward to inspect gallery decisions, queue drops, frame age,
skipped frames, and end-to-end resource use.
