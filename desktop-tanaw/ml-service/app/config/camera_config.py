from __future__ import annotations

from datetime import datetime
from math import hypot
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.storage.reporting_periods import (
    monthly_period_from_id,
    monthly_period_from_identity,
    parse_captured_at,
)

CameraType = Literal["IP_WEBCAM", "RTSP_CCTV", "USB_WEBCAM", "ONVIF_CCTV"]
ProcessingProfile = Literal[
    "auto",
    "compatibility",
    "balanced",
    "high_accuracy",
    "emergency",
]
RuntimeBackend = Literal["auto", "cuda", "openvino", "cpu"]
TrackerProfile = Literal["auto", "bytetrack", "botsort"]
ReIdMode = Literal["auto", "off", "fast", "quality"]
UniqueCountingMode = Literal["entry_only", "estimated_reid"]
SourceClassification = Literal["official", "simulation"]
SimulationMode = Literal["virtual", "hybrid"]
SimulationScenario = Literal[
    "normal",
    "morning-rush",
    "event-opening",
    "overcrowding",
    "evacuation",
    "custom",
]


class TripwirePoint(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


TripwireCurveMode = Literal["linear", "smooth"]


class TripwireLine(BaseModel):
    start: TripwirePoint
    end: TripwirePoint
    points: list[TripwirePoint] | None = Field(default=None, min_length=2, max_length=80)
    curve: TripwireCurveMode = "linear"
    sampled_points: list[TripwirePoint] | None = Field(default=None, min_length=2, max_length=320)


class RegionOfInterest(BaseModel):
    top: float = Field(default=0.10, ge=0.0, le=1.0)
    left: float = Field(default=0.10, ge=0.0, le=1.0)
    width: float = Field(default=0.80, ge=0.10, le=1.0)
    height: float = Field(default=0.80, ge=0.10, le=1.0)

    @model_validator(mode="after")
    def validate_bounds(self) -> RegionOfInterest:
        if self.left + self.width > 1.0:
            raise ValueError("ROI left + width must not exceed 1.0.")
        if self.top + self.height > 1.0:
            raise ValueError("ROI top + height must not exceed 1.0.")
        return self


class CameraStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stream_url: str = Field(..., min_length=3)
    tracking_confidence: float = Field(default=0.15, ge=0.01, le=0.95)
    counting_confidence: float = Field(default=0.35, ge=0.05, le=0.95)
    camera_id: int | None = None
    camera_name: str | None = Field(default=None, max_length=120)
    camera_type: CameraType = "IP_WEBCAM"
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=240)
    tripwire_position: float = Field(default=0.5, ge=0.1, le=0.9)
    entry_line: TripwireLine | None = None
    exit_line: TripwireLine | None = None
    roi: RegionOfInterest = Field(default_factory=RegionOfInterest)
    reverse_direction: bool = False
    processing_profile: ProcessingProfile = "auto"
    runtime_backend: RuntimeBackend = "auto"
    tracker_profile: TrackerProfile = "auto"
    reid_mode: ReIdMode = "auto"
    unique_counting_mode: UniqueCountingMode = "estimated_reid"
    processing_fps: float | None = Field(default=None, ge=1.0, le=30.0)
    stream_fps: float = Field(default=24.0, ge=1.0, le=30.0)
    max_frame_width: int | None = Field(default=None, ge=320, le=1280)
    event_cooldown_seconds: float = Field(default=3.6, ge=0.5, le=30.0)
    paired_line_max_gap_seconds: float = Field(default=18.0, ge=1.0, le=120.0)
    track_ttl_seconds: float = Field(default=9.0, ge=1.0, le=60.0)
    pending_reid_wait_seconds: float = Field(default=0.6, ge=0.1, le=2.0)

    @field_validator("stream_url")
    @classmethod
    def validate_stream_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Stream URL is required.")

        if normalized.isdigit():
            return normalized

        if normalized.startswith(("http://", "https://", "rtsp://")):
            return normalized

        raise ValueError(
            "Stream URL must start with http://, https://, rtsp://, or be a numeric webcam index."
        )

    @model_validator(mode="after")
    def validate_counting_geometry(self) -> CameraStartRequest:
        if self.tracking_confidence > self.counting_confidence:
            raise ValueError(
                "tracking_confidence must be less than or equal to counting_confidence."
            )
        if self.entry_line is None and self.exit_line is None:
            return self

        if self.entry_line is None or self.exit_line is None:
            raise ValueError(
                "Both entry_line and exit_line are required when using custom tripwire lines."
            )

        entry_length = _path_length(self.entry_line)
        exit_length = _path_length(self.exit_line)
        if entry_length < 0.10 or exit_length < 0.10:
            raise ValueError("Tripwire paths must be at least 0.10 normalized units long.")

        if _paths_overlap(self.entry_line, self.exit_line, tolerance=0.03):
            raise ValueError("Entry and exit tripwire paths must not overlap.")

        return self


class CameraTestRequest(BaseModel):
    stream_url: str = Field(..., min_length=3)
    camera_type: CameraType = "IP_WEBCAM"
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=240)

    @field_validator("stream_url")
    @classmethod
    def validate_stream_url(cls, value: str) -> str:
        return CameraStartRequest(stream_url=value).stream_url


class CameraTestResponse(BaseModel):
    ok: bool
    message: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    running: bool
    error: str | None = None
    model_loaded: bool = False
    model_ready: bool = False
    model_loading: bool = False
    device: str | None = None
    model_path: str | None = None
    reid_model_loaded: bool = False
    reid_model_ready: bool = False
    reid_model_loading: bool = False
    reid_status: str | None = None
    reid_model_path: str | None = None
    reid_error: str | None = None
    reid_average_inference_ms: float | None = None
    reid_providers: list[str] = Field(default_factory=list)
    reid_gallery_size: int = 0
    reid_quality_gallery_size: int = 0
    reid_business_date: str | None = None
    reid_last_cleanup_at: str | None = None
    quality_reid_model_loaded: bool = False
    quality_reid_model_ready: bool = False
    quality_reid_model_loading: bool = False
    quality_reid_status: str | None = None
    quality_reid_model_path: str | None = None
    quality_reid_error: str | None = None
    quality_reid_average_inference_ms: float | None = None
    quality_reid_providers: list[str] = Field(default_factory=list)
    quality_reid_queue_depth: int = 0
    quality_reid_tasks_pending: int = 0
    quality_reid_tasks_dropped: int = 0
    quality_reid_tasks_completed: int = 0
    quality_reid_worker_p50_ms: float | None = None
    quality_reid_worker_p95_ms: float | None = None
    processing_profile: str | None = None
    requested_processing_profile: str | None = None
    normalized_processing_profile: str | None = None
    effective_processing_profile: str | None = None
    model_profile: str | None = None
    model_name: str | None = None
    selected_model: str | None = None
    selected_runtime: str | None = None
    runtime_backend: str | None = None
    runtime_device: str | None = None
    requested_runtime: str | None = None
    selection_reason: str | None = None
    fallback_reason: str | None = None
    fallback_chain: list[str] = Field(default_factory=list)
    detector_image_size: int | None = None
    detector_max_detections: int | None = None
    target_processing_fps: float | None = None
    detector_p50_ms: float | None = None
    detector_p95_ms: float | None = None
    analytics_fps: float | None = None
    processing_frame_age_ms: float | None = None
    processing_frames_skipped: int = 0
    reid_queue_depth: int = 0
    reid_tasks_pending: int = 0
    reid_tasks_dropped: int = 0
    reid_tasks_completed: int = 0
    reid_worker_p50_ms: float | None = None
    reid_worker_p95_ms: float | None = None
    identity_active_tracks: int = 0
    identity_stitches: int = 0
    identity_splits: int = 0
    confirmed_unique_count: int = 0
    estimated_unique_count: int = 0
    degraded_unique_count: int = 0
    pending_unique_entries: int = 0
    repeat_entry_count: int = 0
    tracking_confidence: float | None = None
    counting_confidence: float | None = None
    reid_mode: str | None = None
    effective_reid_mode: str | None = None
    unique_counting_mode: str | None = None
    requested_tracker: str | None = None
    effective_tracker: str | None = None
    tracker_profile: str | None = None
    tracker_config_path: str | None = None
    detector_nms_iou: float | None = None
    detector_person_class_ids: list[int] = Field(default_factory=list)
    detector_model_availability: dict[str, Any] = Field(default_factory=dict)
    reid_model_availability: dict[str, Any] = Field(default_factory=dict)
    runtime_capabilities: dict[str, Any] = Field(default_factory=dict)
    reid_tasks_cleared: int = 0
    reid_worker_alive: bool = False
    quality_reid_tasks_cleared: int = 0
    quality_reid_worker_alive: bool = False


class CountResponse(BaseModel):
    entry: int
    exit: int
    occupancy: int
    running: bool
    status: str
    started_at: str | None = None
    error: str | None = None


class DetectionTrackResponse(BaseModel):
    track_id: int
    source_track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: tuple[int, int]
    trigger_point: tuple[int, int]
    direction: str | None = None
    visitor_id: str | None = None
    is_unique_entry: bool | None = None
    reid_score: float | None = None
    reid_decision: str | None = None
    identity_confidence: str | None = None
    inside_roi: bool | None = None
    counting_eligible: bool | None = None
    identity_state: str | None = None
    identity_score: float | None = None
    identity_source: str | None = None
    counting_debug: dict[str, Any] | None = None


class DetectionResponse(BaseModel):
    running: bool
    status: str
    error: str | None = None
    frame_width: int | None = None
    frame_height: int | None = None
    tracks: list[DetectionTrackResponse]


class SessionResponse(BaseModel):
    running: bool
    status: str
    error: str | None = None
    camera_id: int | None = None
    camera_name: str | None = None
    camera_config: dict | None = None
    counts: CountResponse
    updated_at: str | None = None


class EnterpriseContextRequest(BaseModel):
    enterprise_id: str = Field(..., min_length=1, max_length=160)
    enterprise_name: str | None = Field(default=None, max_length=160)


class EnterpriseContextResponse(BaseModel):
    enterprise_id: str
    enterprise_name: str | None = None
    changed: bool
    session_restored: bool


class MetricsSummaryResponse(BaseModel):
    entries: int
    exits: int
    peak_occupancy: int
    current_occupancy: int
    unique_count: int
    estimated_unique_count: int = 0
    confirmed_unique_count: int = 0
    degraded_unique_count: int = 0
    pending_unique_entries: int = 0
    repeat_entry_count: int = 0
    occupancy_correction_delta: int = 0
    total_events: int
    unsubmitted_events: int
    unsynced_events: int
    unclassified_events: int = 0
    first_event_at: str | None = None
    last_event_at: str | None = None
    classification: SourceClassification = "official"
    simulation_run_id: str | None = None
    period_id: str | None = None
    period: str | None = None
    starts_at_utc: str | None = None
    ends_at_utc: str | None = None
    business_start_date: str | None = None
    business_end_date_exclusive: str | None = None


class OccupancyCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_occupancy: int = Field(ge=0, le=100_000)
    reason: str = Field(min_length=3, max_length=500)
    camera_id: int | None = None


class OccupancyCorrectionResponse(BaseModel):
    correction_id: str
    enterprise_id: str | None = None
    camera_id: int | None = None
    old_occupancy: int
    new_occupancy: int
    delta: int
    reason: str
    actor_id: str | None = None
    actor_name: str | None = None
    classification: SourceClassification = "official"
    simulation_run_id: str | None = None
    recorded_at: str


class HourlyMetricsPoint(BaseModel):
    time: str
    occupancy: int
    entry: int
    exit: int
    unique: int


class HistoricalMetricsPoint(BaseModel):
    label: str
    visitors: int
    entries: int
    exits: int
    peak_occupancy: int
    current_occupancy: int


class MetricsHistoryResponse(BaseModel):
    hourly_density: list[HourlyMetricsPoint]
    historical: dict[str, list[HistoricalMetricsPoint]]


def reporting_period_submission_error(period_id: str, now: datetime | None = None) -> str | None:
    period = monthly_period_from_id(period_id)
    if period is None:
        return "Reporting period ID must use month:Asia/Manila:YYYY-MM."
    try:
        reference_time = parse_captured_at(now or datetime.now().astimezone())
    except ValueError:
        return "The submission time must include a UTC offset."
    if reference_time >= period.ends_at_utc:
        return None
    return f"Submission opens at {period.ends_at_utc.isoformat()} after {period.label} closes."


class ReportSubmissionMetrics(BaseModel):
    entries: int = Field(ge=0, le=100_000)
    exits: int = Field(ge=0, le=100_000)
    peak_occupancy: int = Field(ge=0, le=100_000)
    unique_count: int = Field(ge=0, le=100_000)

    @model_validator(mode="after")
    def validate_counts(self) -> ReportSubmissionMetrics:
        if self.exits > self.entries:
            raise ValueError("Total exits cannot exceed total entries.")
        return self


class ReportSourceWindow(BaseModel):
    start: datetime
    end: datetime


_REPORT_DEMOGRAPHIC_FIELDS = {
    "thisProvMale",
    "thisProvFemale",
    "otherProvMale",
    "otherProvFemale",
    "foreignMale",
    "foreignFemale",
}
_REPORT_DEMOGRAPHIC_VALUES = {
    "this_province_male",
    "this_province_female",
    "other_province_male",
    "other_province_female",
    "foreign_male",
    "foreign_female",
}
_REPORT_DEMOGRAPHIC_QUALITIES = {"confirmed", "degraded", "estimated"}
_MAX_REPORT_DEMOGRAPHIC_COUNT = 2_147_483_647


class LocalReportRevisionRequest(BaseModel):
    report_id: str = Field(..., min_length=3, max_length=80)
    period_id: str = Field(..., min_length=1, max_length=80)
    source_window: ReportSourceWindow
    notes: str | None = Field(default=None, max_length=5000)
    metrics: ReportSubmissionMetrics | None = None
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_demographics(self) -> LocalReportRevisionRequest:
        monthly_period_from_identity(
            self.period_id,
            self.source_window.start,
            self.source_window.end,
        )
        period_submission_error = reporting_period_submission_error(self.period_id)
        if period_submission_error:
            raise ValueError(period_submission_error)
        _validate_report_demographics(self.payload or {})
        return self


def _validate_report_demographics(payload: dict[Any, Any]) -> None:
    demo = payload.get("demo")
    if demo is not None and not isinstance(demo, dict):
        raise ValueError("Report demographics must be an object when provided.")
    if isinstance(demo, dict):
        for field in _REPORT_DEMOGRAPHIC_FIELDS:
            if field not in demo or demo[field] is None or str(demo[field]).strip() == "":
                continue
            value = demo[field]
            if isinstance(value, bool):
                raise ValueError("Demographics values must be non-negative safe whole numbers.")
            if isinstance(value, int):
                valid_value = 0 <= value <= _MAX_REPORT_DEMOGRAPHIC_COUNT
            elif isinstance(value, str) and value.strip().isdigit():
                valid_value = int(value.strip()) <= _MAX_REPORT_DEMOGRAPHIC_COUNT
            else:
                valid_value = False
            if not valid_value:
                raise ValueError("Demographics values must be non-negative safe whole numbers.")

    facts = payload.get("demographicFacts")
    if facts is None:
        return
    if not isinstance(facts, list):
        raise ValueError("Demographic facts must be a list when provided.")

    seen: set[tuple[str, str]] = set()
    for fact in facts:
        if not isinstance(fact, dict):
            raise ValueError("Each demographic fact must be an object.")
        dimension = fact.get("dimension")
        value = fact.get("value")
        count = fact.get("count")
        provenance = fact.get("provenance")
        quality = fact.get("quality")
        if (
            dimension != "residence_sex"
            or not isinstance(value, str)
            or value not in _REPORT_DEMOGRAPHIC_VALUES
        ):
            raise ValueError("Demographic facts must use a supported dimension and value.")
        if (
            isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            or count > _MAX_REPORT_DEMOGRAPHIC_COUNT
        ):
            raise ValueError("Demographic fact counts must be non-negative safe whole numbers.")
        if provenance != "operator_entered":
            raise ValueError("Demographic fact provenance must be explicitly operator_entered.")
        if not isinstance(quality, str) or quality not in _REPORT_DEMOGRAPHIC_QUALITIES:
            raise ValueError("Demographic fact quality must be confirmed, degraded, or estimated.")
        key = ("residence_sex", value)
        if key in seen:
            raise ValueError("Demographic dimension/value facts must be unique.")
        seen.add(key)


class LocalReportRevisionResponse(MetricsSummaryResponse):
    report_id: str
    revision_id: str
    outbox_item_id: str
    payload_hash: str
    submitted_at: str
    sync_status: str


class SimulationStartRequest(BaseModel):
    simulation_run_id: str = Field(..., min_length=1, max_length=80)
    mode: SimulationMode = "virtual"
    scenario: SimulationScenario = "normal"
    events_per_minute: int = Field(default=12, ge=1, le=120)
    capacity: int = Field(default=100, ge=1, le=100_000)
    starting_occupancy: int | None = Field(default=None, ge=0, le=5_000)
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    threshold_percent: int = Field(default=90, ge=1, le=100)
    entry_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    unique_entry_rate: float = Field(default=0.88, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_simulation_settings(self) -> SimulationStartRequest:
        if self.starting_occupancy is not None and self.starting_occupancy > self.capacity:
            raise ValueError("Starting occupancy cannot exceed venue capacity.")
        if self.scenario == "custom" and self.entry_probability is None:
            raise ValueError("Custom simulations require an entry probability.")
        return self


class SimulationManualEventRequest(BaseModel):
    direction: Literal["entry", "exit"]


class SimulationPrepareRequest(BaseModel):
    simulation_run_id: str = Field(..., min_length=1, max_length=80)
    enterprise_id: str = Field(..., min_length=1, max_length=160)
    enterprise_name: str | None = Field(default=None, max_length=160)
    entries: int = Field(ge=1, le=100_000)
    exits: int = Field(ge=0, le=100_000)
    unique_count: int = Field(ge=0, le=100_000)
    peak_occupancy: int = Field(ge=1, le=100_000)
    period_id: str = Field(min_length=1, max_length=80)
    source_window: ReportSourceWindow

    @model_validator(mode="after")
    def validate_reporting_period(self) -> SimulationPrepareRequest:
        monthly_period_from_identity(
            self.period_id,
            self.source_window.start,
            self.source_window.end,
        )
        return self


class SimulationPrepareResponse(MetricsSummaryResponse):
    enterprise_id: str
    enterprise_name: str | None = None
    period: str | None = None
    prepared: bool = True


class SimulationStatusResponse(BaseModel):
    running: bool
    paused: bool = False
    state: Literal["idle", "running", "paused", "stopped", "completed"] = "idle"
    mode: str | None = None
    scenario: str | None = None
    simulation_run_id: str | None = None
    events_generated: int = 0
    events_per_minute: int = 0
    requires_real_camera: bool = False
    enterprise_id: str | None = None
    enterprise_name: str | None = None
    capacity: int = 0
    threshold_percent: int = 90
    duration_minutes: int | None = None
    started_at: str | None = None
    completed_at: str | None = None
    entries: int = 0
    exits: int = 0
    current_occupancy: int = 0
    peak_occupancy: int = 0
    unique_count: int = 0
    unsubmitted_events: int = 0


class SimulationResetResponse(BaseModel):
    stopped: bool
    removed: dict[str, int]


class SimulationReportRequest(BaseModel):
    report_id: str | None = Field(default=None, max_length=80)
    period_id: str = Field(..., min_length=1, max_length=80)
    source_window: ReportSourceWindow
    notes: str | None = Field(default=None, max_length=5000)
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_reporting_period(self) -> SimulationReportRequest:
        monthly_period_from_identity(
            self.period_id,
            self.source_window.start,
            self.source_window.end,
        )
        period_submission_error = reporting_period_submission_error(self.period_id)
        if period_submission_error:
            raise ValueError(period_submission_error)
        return self


class LocalReportRecordResponse(BaseModel):
    report_id: str
    revision_id: str
    outbox_item_id: str
    payload_hash: str
    period: str
    period_id: str
    starts_at_utc: str
    ends_at_utc: str
    submitted_at: str
    entries: int
    exits: int
    peak_occupancy: int
    unique_count: int
    notes: str | None = None
    payload: dict = Field(default_factory=dict)
    sync_status: str
    classification: SourceClassification = "official"
    simulation_run_id: str | None = None
    acknowledged_at: str | None = None
    raw_purged_at: str | None = None


class ReportRawDataPurgeRequest(BaseModel):
    consolidated_revision_id: UUID


class ReportRawDataPurgeResponse(BaseModel):
    report_id: str
    revision_id: str
    purged_events: int
    purged_sightings: int
    purged_identities: int
    raw_purged_at: str | None = None


def _path_points(line: TripwireLine) -> list[TripwirePoint]:
    if line.sampled_points and len(line.sampled_points) >= 2:
        return line.sampled_points
    if line.points and len(line.points) >= 2:
        return line.points
    return [line.start, line.end]


def _path_length(line: TripwireLine) -> float:
    points = _path_points(line)
    return sum(
        _point_distance(points[index - 1], point) for index, point in enumerate(points) if index > 0
    )


def _paths_overlap(first: TripwireLine, second: TripwireLine, tolerance: float) -> bool:
    first_points = _path_points(first)
    second_points = _path_points(second)
    comparable_points = min(len(first_points), len(second_points), 24)
    if comparable_points < 2:
        return False

    total_distance = 0.0
    for index in range(comparable_points):
        first_index = round((index / max(1, comparable_points - 1)) * (len(first_points) - 1))
        second_index = round((index / max(1, comparable_points - 1)) * (len(second_points) - 1))
        total_distance += _point_distance(first_points[first_index], second_points[second_index])

    return total_distance / comparable_points < tolerance


def _point_distance(first: TripwirePoint, second: TripwirePoint) -> float:
    return hypot(second.x - first.x, second.y - first.y)
