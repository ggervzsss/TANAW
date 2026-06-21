import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate TANAW tracking predictions against labeled JSONL frames."
    )
    parser.add_argument("--ground-truth", required=True, type=Path)
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    parser.add_argument("--event-frame-tolerance", type=int, default=2)
    args = parser.parse_args()

    ground_truth = _load_frames(args.ground_truth)
    predictions = _load_frames(args.predictions)
    metrics = evaluate(
        ground_truth,
        predictions,
        iou_threshold=args.iou_threshold,
        event_frame_tolerance=args.event_frame_tolerance,
    )
    print(json.dumps(metrics, indent=2, sort_keys=True))


def evaluate(
    ground_truth: dict[int, dict[str, Any]],
    predictions: dict[int, dict[str, Any]],
    *,
    iou_threshold: float = 0.5,
    event_frame_tolerance: int = 2,
) -> dict[str, int | float | None]:
    match_counts: dict[str, Counter[int]] = defaultdict(Counter)
    matched_history: dict[str, list[tuple[int, int]]] = defaultdict(list)
    total_ground_detections = 0
    total_predicted_detections = 0
    total_matches = 0

    all_frames = sorted(set(ground_truth) | set(predictions))
    for frame_index in all_frames:
        truth_people = ground_truth.get(frame_index, {}).get("people", [])
        predicted_tracks = predictions.get(frame_index, {}).get("tracks", [])
        total_ground_detections += len(truth_people)
        total_predicted_detections += len(predicted_tracks)
        for truth, predicted in _match_frame(truth_people, predicted_tracks, iou_threshold):
            truth_id = str(truth["id"])
            predicted_id = int(predicted["track_id"])
            match_counts[truth_id][predicted_id] += 1
            matched_history[truth_id].append((frame_index, predicted_id))
            total_matches += 1

    dominant_track_by_person = {
        truth_id: counts.most_common(1)[0][0] for truth_id, counts in match_counts.items() if counts
    }
    identity_true_positives = sum(
        counts[dominant_track_by_person[truth_id]]
        for truth_id, counts in match_counts.items()
        if truth_id in dominant_track_by_person
    )
    identity_false_positives = max(0, total_predicted_detections - identity_true_positives)
    identity_false_negatives = max(0, total_ground_detections - identity_true_positives)
    idf1_denominator = (
        2 * identity_true_positives + identity_false_positives + identity_false_negatives
    )
    idf1 = 2 * identity_true_positives / idf1_denominator if idf1_denominator else 1.0

    id_switches = 0
    fragmentations = 0
    for history in matched_history.values():
        previous_frame: int | None = None
        previous_track: int | None = None
        for frame_index, track_id in sorted(history):
            if previous_track is not None and track_id != previous_track:
                id_switches += 1
            if previous_frame is not None and frame_index > previous_frame + 1:
                fragmentations += 1
            previous_frame = frame_index
            previous_track = track_id

    ground_events = _ground_events(ground_truth)
    predicted_events = _predicted_events(predictions, dominant_track_by_person)
    matched_events = _match_events(ground_events, predicted_events, event_frame_tolerance)
    crossing_precision = (
        matched_events / len(predicted_events)
        if predicted_events
        else (1.0 if not ground_events else 0.0)
    )
    crossing_recall = matched_events / len(ground_events) if ground_events else 1.0

    ground_unique = len({event[1] for event in ground_events if event[2] == "entry"})
    predicted_unique = len(
        {
            int(event["track_id"])
            for frame in predictions.values()
            for event in frame.get("events", [])
            if event.get("direction") == "entry" and event.get("track_id") is not None
        }
    )
    unique_count_error = (
        abs(predicted_unique - ground_unique) / ground_unique
        if ground_unique
        else float(predicted_unique > 0)
    )

    processing_times = _numeric_values(predictions, "processing_ms")
    frame_ages = _numeric_values(predictions, "frame_age_ms")
    cpu_values = _numeric_values(predictions, "cpu_percent")

    return {
        "idf1": round(idf1, 6),
        "id_switches": id_switches,
        "fragmentations": fragmentations,
        "crossing_precision": round(crossing_precision, 6),
        "crossing_recall": round(crossing_recall, 6),
        "ground_unique_count": ground_unique,
        "predicted_unique_count": predicted_unique,
        "unique_count_error": round(unique_count_error, 6),
        "detector_match_recall": round(total_matches / total_ground_detections, 6)
        if total_ground_detections
        else 1.0,
        "analytics_fps": round(1000.0 / mean(processing_times), 3)
        if processing_times and mean(processing_times) > 0
        else None,
        "processing_p95_ms": _percentile(processing_times, 0.95),
        "frame_age_p95_ms": _percentile(frame_ages, 0.95),
        "average_cpu_percent": round(mean(cpu_values), 3) if cpu_values else None,
    }


def _load_frames(path: Path) -> dict[int, dict[str, Any]]:
    frames: dict[int, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            if not line.strip():
                continue
            payload = json.loads(line)
            if "frame_index" not in payload:
                raise ValueError(f"{path}:{line_number} is missing frame_index.")
            frames[int(payload["frame_index"])] = payload
    return frames


def _match_frame(
    truth_people: list[dict[str, Any]],
    predicted_tracks: list[dict[str, Any]],
    iou_threshold: float,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    candidates: list[tuple[float, int, int]] = []
    for truth_index, truth in enumerate(truth_people):
        for prediction_index, prediction in enumerate(predicted_tracks):
            score = _bbox_iou(truth["bbox"], prediction["bbox"])
            if score >= iou_threshold:
                candidates.append((score, truth_index, prediction_index))

    matches: list[tuple[dict[str, Any], dict[str, Any]]] = []
    used_truth: set[int] = set()
    used_predictions: set[int] = set()
    for _, truth_index, prediction_index in sorted(candidates, reverse=True):
        if truth_index in used_truth or prediction_index in used_predictions:
            continue
        used_truth.add(truth_index)
        used_predictions.add(prediction_index)
        matches.append((truth_people[truth_index], predicted_tracks[prediction_index]))
    return matches


def _ground_events(frames: dict[int, dict[str, Any]]) -> list[tuple[int, str, str]]:
    return [
        (frame_index, str(event["person_id"]), str(event["direction"]))
        for frame_index, frame in frames.items()
        for event in frame.get("events", [])
    ]


def _predicted_events(
    frames: dict[int, dict[str, Any]],
    dominant_track_by_person: dict[str, int],
) -> list[tuple[int, str | None, str]]:
    person_by_track = {
        track_id: person_id for person_id, track_id in dominant_track_by_person.items()
    }
    return [
        (frame_index, person_by_track.get(int(event["track_id"])), str(event["direction"]))
        for frame_index, frame in frames.items()
        for event in frame.get("events", [])
        if event.get("track_id") is not None
    ]


def _match_events(
    ground_events: list[tuple[int, str, str]],
    predicted_events: list[tuple[int, str | None, str]],
    tolerance: int,
) -> int:
    used_predictions: set[int] = set()
    matched = 0
    for ground_frame, person_id, direction in ground_events:
        candidates = [
            (abs(predicted_frame - ground_frame), index)
            for index, (predicted_frame, predicted_person, predicted_direction) in enumerate(
                predicted_events
            )
            if index not in used_predictions
            and predicted_person == person_id
            and predicted_direction == direction
            and abs(predicted_frame - ground_frame) <= tolerance
        ]
        if not candidates:
            continue
        _, prediction_index = min(candidates)
        used_predictions.add(prediction_index)
        matched += 1
    return matched


def _numeric_values(frames: dict[int, dict[str, Any]], key: str) -> list[float]:
    return [
        float(frame[key]) for frame in frames.values() if isinstance(frame.get(key), int | float)
    ]


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * quantile))))
    return round(ordered[index], 3)


def _bbox_iou(first: list[float], second: list[float]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    if intersection <= 0:
        return 0.0
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


if __name__ == "__main__":
    main()
