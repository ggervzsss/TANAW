import builtins
import re
from datetime import date, datetime
from datetime import date as datetime_date
from ipaddress import IPv4Address
from typing import Any, Literal
from urllib.parse import parse_qsl, urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TELEMETRY_CAMERA_ITEMS = 32
MAX_TELEMETRY_SERIALIZED_BYTES = 256 * 1024


class DesktopMetricsSummary(BaseModel):
    entries: int | None = Field(default=None, ge=0)
    exits: int | None = Field(default=None, ge=0)
    peakOccupancy: int | None = Field(default=None, ge=0)
    currentOccupancy: int | None = Field(default=None, ge=0)
    uniqueCount: int | None = Field(default=None, ge=0)
    confirmedUniqueCount: int = Field(default=0, ge=0)
    degradedUniqueCount: int = Field(default=0, ge=0)
    totalEvents: int = Field(default=0, ge=0)
    unsubmittedEvents: int = Field(default=0, ge=0)
    unsyncedEvents: int = Field(default=0, ge=0)
    firstEventAt: datetime | None = None
    lastEventAt: datetime | None = None


class DesktopSessionSummary(BaseModel):
    running: bool = False
    status: str = Field(default="unknown", max_length=40)
    error: str | None = Field(default=None, max_length=1000)
    cameraId: int | str | None = None
    cameraName: str | None = Field(default=None, max_length=120)
    updatedAt: datetime | None = None


class DesktopHealthSummary(BaseModel):
    analyticsFps: float | None = Field(default=None, ge=0)
    processingProfile: str | None = Field(default=None, max_length=40)
    detectorP50Ms: float | None = Field(default=None, ge=0)
    detectorP95Ms: float | None = Field(default=None, ge=0)
    processingFrameAgeMs: float | None = Field(default=None, ge=0)
    processingFramesSkipped: int = Field(default=0, ge=0)
    modelReady: bool = False
    reidReady: bool = False
    qualityReidReady: bool = False
    reidQueueDepth: int = Field(default=0, ge=0)
    qualityReidQueueDepth: int = Field(default=0, ge=0)


CameraMonitoringState = Literal["not_configured", "stopped", "partial", "running", "error"]
CameraRuntimeState = Literal["stopped", "starting", "running", "error"]
CameraAnalysisMode = Literal["entrance_exit", "open_space"]


class DesktopCameraMonitoringItem(BaseModel):
    cameraId: int
    cameraName: str = Field(max_length=120)
    status: CameraRuntimeState
    running: bool = False
    error: str | None = Field(default=None, max_length=1000)
    mode: CameraAnalysisMode | None = None
    brand: str | None = Field(default=None, max_length=40)


class DesktopCameraMonitoringSummary(BaseModel):
    status: CameraMonitoringState = "not_configured"
    configuredCameraCount: int = Field(default=0, ge=0)
    activeCameraCount: int = Field(default=0, ge=0)
    healthyCameraCount: int = Field(default=0, ge=0)
    startingCameraCount: int = Field(default=0, ge=0)
    stoppedCameraCount: int = Field(default=0, ge=0)
    errorCameraCount: int = Field(default=0, ge=0)
    cameras: list[DesktopCameraMonitoringItem] = Field(
        default_factory=list, max_length=MAX_TELEMETRY_CAMERA_ITEMS
    )


class DesktopAppSummary(BaseModel):
    """Which desktop app build sent the check-in, and on which computer."""

    version: str = Field(min_length=1, max_length=40)
    computerName: str | None = Field(default=None, max_length=120)


class DesktopTelemetryIngest(BaseModel):
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime | None = None
    app: DesktopAppSummary | None = None
    metrics: DesktopMetricsSummary
    session: DesktopSessionSummary = Field(default_factory=DesktopSessionSummary)
    health: DesktopHealthSummary = Field(default_factory=DesktopHealthSummary)
    monitoring: DesktopCameraMonitoringSummary = Field(
        default_factory=DesktopCameraMonitoringSummary
    )
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_serialized_size(self) -> DesktopTelemetryIngest:
        serialized_size = len(self.model_dump_json().encode("utf-8"))
        if serialized_size > MAX_TELEMETRY_SERIALIZED_BYTES:
            raise ValueError(
                "Telemetry payload exceeds the maximum serialized size of "
                f"{MAX_TELEMETRY_SERIALIZED_BYTES} bytes."
            )
        return self


class TelemetrySnapshotSummary(BaseModel):
    id: str
    enterpriseId: str
    enterpriseName: str
    category: str | None = None
    barangay: str | None = None
    cameraId: str | None = None
    cameraName: str | None = None
    capturedAt: datetime
    receivedAt: datetime
    entries: int | None
    exits: int | None
    currentOccupancy: int | None
    peakOccupancy: int | None
    uniqueCount: int | None
    confirmedUniqueCount: int
    degradedUniqueCount: int
    totalEvents: int
    unsubmittedEvents: int
    unsyncedEvents: int
    running: bool
    status: str
    error: str | None = None
    analyticsFps: float | None = None
    gatewayStatus: str
    monitoring: DesktopCameraMonitoringSummary = Field(
        default_factory=DesktopCameraMonitoringSummary
    )


class OperationalSummary(BaseModel):
    enterpriseCount: int
    onlineGateways: int
    delayedGateways: int
    offlineGateways: int
    totalCurrentOccupancy: int
    totalEntries: int | None
    totalExits: int | None
    totalUniqueCount: int
    activeReports: int
    pendingReports: int
    lastSyncAt: datetime | None = None


VisitorInsightRange = Literal["today", "7d", "30d"]
VisitorInsightScope = Literal["city", "barangay", "enterprise"]
VisitorActivityLevel = Literal["Usual", "Busier Than Usual", "No Recent Baseline"]


class VisitorInsightPoint(BaseModel):
    startAt: datetime
    label: str
    averageVisitors: int | None = Field(ge=0)
    peakVisitors: int | None = Field(ge=0)
    estimatedUniqueCount: int | None = Field(default=None, ge=0)


class VisitorInsightEnterprise(BaseModel):
    enterpriseId: str
    enterpriseName: str
    barangay: str
    currentVisitors: int = Field(ge=0)
    typicalVisitors: int | None = Field(default=None, ge=0)
    differencePercent: int | None = None
    activityLevel: VisitorActivityLevel


class VisitorRankingEnterprise(BaseModel):
    enterpriseId: str
    enterpriseName: str
    barangay: str
    category: str
    visitors: int = Field(ge=0)


class VisitorRankingSummary(BaseModel):
    """Visitors per enterprise for a date range, for ranking enterprises, barangays or categories."""

    start: date
    end: date
    reportMonths: list[str] = Field(
        description="Whole past months, as YYYY-MM, counted from monthly reports."
    )
    cameraDays: int = Field(ge=0, description="Days counted from camera counts, today included.")
    includesToday: bool
    uncoveredDays: int = Field(
        ge=0, description="Days older than the camera history without a monthly report."
    )
    enterprises: list[VisitorRankingEnterprise]


class VisitorInsightsSummary(BaseModel):
    range: VisitorInsightRange | None = Field(
        description="The preset range, or null when start and end chose the days."
    )
    start: date | None = Field(
        default=None, description="First day asked for, in Philippine time, when chosen by date."
    )
    end: date | None = Field(
        default=None, description="Last day asked for, in Philippine time, when chosen by date."
    )
    scopeType: VisitorInsightScope
    scopeId: str | None = None
    scopeName: str
    currentVisitors: int | None = Field(ge=0)
    typicalVisitors: int | None = Field(default=None, ge=0)
    differencePercent: int | None = None
    comparisonMessage: str
    busiestEnterprise: VisitorInsightEnterprise | None = None
    busiestPeriodLabel: str | None = None
    series: list[VisitorInsightPoint] = Field(default_factory=list)
    unusuallyBusy: list[VisitorInsightEnterprise] = Field(default_factory=list)
    lastUpdatedAt: datetime | None = None


class OperationalAlertSummary(BaseModel):
    """A live alert, as the topbar alert icon, the map and the Alerts section show it."""

    id: str
    type: Literal["Busier Than Usual", "Camera Not Counting"]
    severity: Literal["Warning", "Critical"]
    status: Literal["Pending", "Active", "Ended"]
    enterpriseId: str | None = None
    enterpriseName: str | None = None
    camera: str | None = None
    summary: str
    """The plain sentence everyone sees."""
    detail: str | None = None
    """Technical details for IT, such as the error and the last count. Left out for the Admin."""
    startedAt: datetime
    endedAt: datetime | None = None


MapPinState = Literal["normal", "busy", "camera", "offline", "closed"]


class MapEnterpriseAlert(BaseModel):
    type: Literal["Busier Than Usual", "Camera Not Counting"]
    camera: str | None = None
    summary: str
    startedAt: datetime


class MapEnterpriseSummary(BaseModel):
    id: str
    name: str
    barangay: str
    category: str
    fullAddress: str
    lat: float | None = None
    lng: float | None = None
    totalLiveOccupancy: int | None = None
    estimatedUniqueCount: int | None = None
    monitoringStatus: str
    occupancyStatus: str
    cameraMonitoring: dict[str, object] | None = None
    contact: str
    lastSync: str | None = None
    gatewayStatus: str
    pinState: MapPinState
    """normal, busy (yellow), camera (red), offline (gray) or closed (faded)."""
    openNow: bool
    offlineSince: datetime | None = None
    closedReason: str | None = None
    alerts: list[MapEnterpriseAlert] = Field(default_factory=list)


EnterpriseAccountState = Literal["active", "invited", "expired", "deactivated"]
DesktopAppStatus = Literal["online", "delayed", "offline", "not_set_up"]
CameraHealthStatus = Literal["counting", "not_counting", "starting", "stopped"]
CameraHourState = Literal["counting", "gaps", "down", "closed", "future"]


class EnterpriseAppHealth(BaseModel):
    status: DesktopAppStatus
    """online under 2 minutes, delayed up to 10, offline after that or on a desktop error.

    A place that is closed, or whose account is not active, is never delayed or offline.
    """
    lastDataAt: datetime | None = None
    version: str | None = None
    latestVersion: str | None = None
    computerName: str | None = None


class CameraHealth(BaseModel):
    id: str
    name: str
    mode: CameraAnalysisMode | None = None
    brand: str | None = None
    status: CameraHealthStatus
    since: datetime | None = None
    note: str | None = None


class EnterpriseCameraHealth(BaseModel):
    total: int = Field(ge=0)
    counting: int = Field(ge=0)
    list: builtins.list[CameraHealth] = Field(default_factory=builtins.list)


class EnterpriseHealthSummary(BaseModel):
    """How one enterprise's desktop app and cameras are doing, for IT."""

    accountId: str
    enterpriseId: str
    name: str
    barangay: str | None = None
    category: str
    accountState: EnterpriseAccountState
    app: EnterpriseAppHealth
    openNow: bool | None = None
    closedReason: str | None = None
    cameras: EnterpriseCameraHealth


class CameraHourSlot(BaseModel):
    hour: int = Field(ge=0, le=23)
    state: CameraHourState


class CameraDayStrip(BaseModel):
    id: str
    name: str
    mode: CameraAnalysisMode | None = None
    brand: str | None = None
    slots: builtins.list[CameraHourSlot]
    dropCount: int = Field(ge=0)
    note: str


class EnterpriseHealthToday(BaseModel):
    """Each camera's day so far, one slot per hour of the opening window (Philippine time)."""

    date: datetime_date
    openFrom: str | None = Field(default=None, description="HH:MM, or null when closed all day.")
    openTo: str | None = Field(default=None, description="HH:MM, or null when closed all day.")
    hours: builtins.list[int]
    cameras: builtins.list[CameraDayStrip]


class DesktopConnectionGap(BaseModel):
    """A period the desktop app could not reach TANAW, reported once it reconnects."""

    startedAt: datetime
    endedAt: datetime
    appRunning: bool

    @model_validator(mode="after")
    def ends_after_start(self) -> DesktopConnectionGap:
        if self.endedAt <= self.startedAt:
            raise ValueError("The connection gap must end after it starts.")
        return self


DesktopEventType = Literal[
    "camera_added", "camera_removed", "camera_changed", "counting_area_changed", "local_data_reset"
]


class DesktopEvent(BaseModel):
    """Something the enterprise changed in the desktop app, recorded in Activity."""

    type: DesktopEventType
    cameraName: str | None = Field(default=None, max_length=120)
    detail: str | None = Field(default=None, max_length=500)


DESKTOP_BACKUP_SCHEMA_VERSION = 1
MAX_BACKUP_DAYS = 62
MAX_BACKUP_DRAFTS = 12
MAX_BACKUP_SUBMISSIONS = 12
MAX_BACKUP_CAMERAS = 32
MAX_BACKUP_SERIALIZED_BYTES = 2 * 1024 * 1024

# Stream paths and query parameters TANAW's vendor presets use. Anything else in a
# stream address (a custom path, a token in the query) may carry a secret and stays
# on the desktop; a custom RTSP camera is backed up by its host and port only.
_VENDOR_STREAM_PATHS = re.compile(
    r"^/(?:stream[12]|cam/realmonitor|ch=\d{1,2}(?:&subtype=[01])?|profile[01]|H264)$"
)
_VENDOR_QUERY_KEYS = frozenset({"channel", "subtype", "ch"})


class _StrictBackupModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DesktopBackupDay(BaseModel):
    """One day's totals from the desktop's daily summary, as the desktop computed them."""

    businessDate: date
    finalized: bool
    metrics: dict[str, Any]


class DesktopBackupDraft(BaseModel):
    draftKey: str = Field(min_length=1, max_length=120)
    period: str = Field(min_length=1, max_length=40)
    reportId: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any]
    updatedAt: datetime


class DesktopBackupCameraTotal(_StrictBackupModel):
    cameraId: int | None = None
    cameraName: str | None = Field(default=None, max_length=120)
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)


class DesktopBackupSubmission(_StrictBackupModel):
    """A submitted report still waiting to reach the server, kept with its original IDs.

    Restoring it with the same ``submissionId`` keeps the eventual upload idempotent.
    """

    reportId: str = Field(min_length=1, max_length=120)
    submissionId: str = Field(min_length=1, max_length=120)
    period: str = Field(min_length=1, max_length=40)
    submittedAt: datetime
    entries: int | None = Field(default=None, ge=0)
    exits: int | None = Field(default=None, ge=0)
    peakOccupancy: int | None = Field(default=None, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=4000)
    payload: dict[str, Any]
    cameraBreakdown: list[DesktopBackupCameraTotal] = Field(
        default_factory=list, max_length=MAX_BACKUP_CAMERAS
    )


class DesktopBackupPoint(_StrictBackupModel):
    x: float
    y: float


class DesktopBackupTripwire(_StrictBackupModel):
    start: DesktopBackupPoint
    end: DesktopBackupPoint
    points: list[DesktopBackupPoint] | None = Field(default=None, max_length=80)
    curve: Literal["linear", "smooth"] | None = None
    sampledPoints: list[DesktopBackupPoint] | None = Field(default=None, max_length=320)


class DesktopBackupTripwires(_StrictBackupModel):
    entry: DesktopBackupTripwire
    exit: DesktopBackupTripwire


class DesktopBackupRegion(_StrictBackupModel):
    top: float
    left: float
    width: float
    height: float


class DesktopBackupCameraConfig(_StrictBackupModel):
    tripwire: float | None = None
    tripwires: DesktopBackupTripwires | None = None
    roi: DesktopBackupRegion | None = None
    reverse: bool | None = None


class DesktopBackupOpenSpace(_StrictBackupModel):
    zone_id: str = Field(min_length=1, max_length=80)
    zone_name: str = Field(min_length=1, max_length=120)
    polygon: list[DesktopBackupPoint] = Field(min_length=3, max_length=12)
    entry_confirmation_seconds: float | None = None
    exit_confirmation_seconds: float | None = None
    minimum_visit_seconds: float | None = None
    gap_grace_seconds: float | None = None
    boundary_tolerance: float | None = None


class DesktopBackupCamera(_StrictBackupModel):
    """The camera settings allowed to leave the desktop.

    Usernames, passwords, and stream-address parts that could hold a secret are
    not fields here, so a backup carrying them is refused rather than stored.
    """

    id: int = Field(ge=1, le=1_000_000)
    name: str = Field(min_length=1, max_length=120)
    zone: str = Field(default="", max_length=120)
    cameraHost: IPv4Address
    cameraBrand: Literal["tapo", "tenda", "dahua", "custom"] = "tapo"
    connectionProfile: (
        Literal["channel", "channel_ampersand", "profile", "h264", "manual"] | None
    ) = None
    rtspStream: Literal["stream1", "stream2"] | None = None
    rtsp: str = Field(min_length=1, max_length=200)
    processingProfile: Literal["auto", "compatibility", "balanced", "high_accuracy", "emergency"]
    confidence: float = Field(ge=0, le=1)
    trackingConfidence: float | None = Field(default=None, ge=0, le=1)
    reidMode: Literal["auto", "off", "fast", "quality"] | None = None
    uniqueCountingMode: Literal["entry_only", "estimated_reid"] | None = None
    analysisMode: Literal["entrance_exit", "open_space"] | None = None
    openSpace: DesktopBackupOpenSpace | None = None
    config: DesktopBackupCameraConfig

    @model_validator(mode="after")
    def validate_stream_address(self) -> DesktopBackupCamera:
        try:
            parsed = urlsplit(self.rtsp)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("Camera stream address is invalid.") from exc
        if parsed.scheme != "rtsp" or parsed.hostname != str(self.cameraHost):
            raise ValueError("Camera stream address must match the camera host.")
        if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc:
            raise ValueError("Camera backups must not contain usernames or passwords.")
        if parsed.fragment or "#" in self.rtsp:
            raise ValueError("Camera stream address must not contain a fragment.")
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("Camera stream port is invalid.")
        if self.cameraBrand == "custom":
            if parsed.path not in ("", "/") or parsed.query:
                raise ValueError(
                    "A custom camera is backed up by host and port only; its stream path "
                    "and query stay on the desktop."
                )
            return self
        if not _VENDOR_STREAM_PATHS.fullmatch(parsed.path):
            raise ValueError("Camera stream path is not a known vendor stream.")
        query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=bool(parsed.query))
        if any(key not in _VENDOR_QUERY_KEYS or not value.isdigit() for key, value in query):
            raise ValueError("Camera stream query is not a known vendor stream setting.")
        return self


class DesktopBackupUpload(BaseModel):
    """Unsubmitted report data and camera settings, without passwords or raw tracking data."""

    schemaVersion: Literal[1]
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime
    # The server revision this desktop last restored or saved, or None when it has
    # confirmed there was none. A different current revision means another copy
    # exists that this desktop has not merged, so the upload is refused.
    baseRevision: int | None = Field(ge=1)
    days: list[DesktopBackupDay] = Field(default_factory=list, max_length=MAX_BACKUP_DAYS)
    drafts: list[DesktopBackupDraft] = Field(default_factory=list, max_length=MAX_BACKUP_DRAFTS)
    submissions: list[DesktopBackupSubmission] = Field(
        default_factory=list, max_length=MAX_BACKUP_SUBMISSIONS
    )
    cameras: list[DesktopBackupCamera] = Field(default_factory=list, max_length=MAX_BACKUP_CAMERAS)

    @model_validator(mode="after")
    def validate_backup(self) -> DesktopBackupUpload:
        dates = [day.businessDate for day in self.days]
        if len(dates) != len(set(dates)):
            raise ValueError("Each backed-up day must appear once.")
        keys = [draft.draftKey for draft in self.drafts]
        if len(keys) != len(set(keys)):
            raise ValueError("Each backed-up report draft must appear once.")
        submission_ids = [submission.submissionId for submission in self.submissions]
        periods = [submission.period for submission in self.submissions]
        if len(submission_ids) != len(set(submission_ids)) or len(periods) != len(set(periods)):
            raise ValueError("Each backed-up report submission must appear once.")
        camera_ids = [camera.id for camera in self.cameras]
        if len(camera_ids) != len(set(camera_ids)):
            raise ValueError("Each backed-up camera must appear once.")
        serialized_size = len(self.model_dump_json().encode("utf-8"))
        if serialized_size > MAX_BACKUP_SERIALIZED_BYTES:
            raise ValueError(
                "Desktop backup exceeds the maximum serialized size of "
                f"{MAX_BACKUP_SERIALIZED_BYTES} bytes."
            )
        return self


class DesktopBackup(DesktopBackupUpload):
    # The establishment this copy belongs to, so the desktop can check it before restoring.
    enterpriseId: str
    revision: int = Field(ge=1)
    receivedAt: datetime
    baseRevision: int | None = Field(default=None, ge=1)


class DesktopBackupSummary(BaseModel):
    deviceId: str | None = None
    revision: int
    capturedAt: datetime
    receivedAt: datetime
    days: int
    drafts: int
    submissions: int
    cameras: int
