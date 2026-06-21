# Tracking Evaluation Data

Record representative clips for walking, running, two-person crossings, short
occlusions, temporary obstructions, re-entry, groups, and poor lighting.

Store ground truth and predictions as one JSON object per frame:

```json
{ "frame_index": 12, "people": [{ "id": "person-1", "bbox": [10, 20, 80, 180] }], "events": [{ "person_id": "person-1", "direction": "entry" }] }
```

```json
{
  "frame_index": 12,
  "tracks": [{ "track_id": 4, "source_track_id": 19, "bbox": [11, 20, 81, 180] }],
  "events": [{ "track_id": 4, "direction": "entry" }],
  "processing_ms": 220.0,
  "frame_age_ms": 40.0,
  "cpu_percent": 78.0
}
```

Run:

```bash
python scripts/replay_tracking.py \
  --video evaluation/crossing-01.mp4 \
  --config evaluation/camera-config.json \
  --output evaluation/predictions.jsonl

python scripts/evaluate_tracking.py \
  --ground-truth evaluation/ground-truth.jsonl \
  --predictions evaluation/predictions.jsonl
```
