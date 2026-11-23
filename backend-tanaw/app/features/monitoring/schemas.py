from datetime import date, datetime
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator

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


class DesktopCameraMonitoringItem(BaseModel):
    cameraId: int
    cameraName: str = Field(max_length=120)
    status: CameraRuntimeState
    running: bool = False
    error: str | None = Field(default=None, max_length=1000)


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


class DesktopTelemetryIngest(BaseModel):
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime | None = None
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


class VisitorInsightsSummary(BaseModel):
    range: VisitorInsightRange
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


OperationalAlertUrgency = Literal["Normal", "Important", "Urgent"]


class OperationalAlertSummary(BaseModel):
    id: str
    type: Literal[
        "Maintenance Request",
        "Password Reset Request",
        "Submission Delay",
        "Foot Traffic Alert",
        "Occupancy Spike",
        "Failed Login Threshold",
    ]
    severity: Literal["Info", "Warning", "Critical"]
    urgency: OperationalAlertUrgency
    enterprise: str | None = None
    requester: str
    summary: str
    requiredAction: str
    resolutionMode: Literal[
        "On-site Visit Required",
        "In-system Action",
        "Staff Follow-up",
        "Remote Review",
        "Admin Monitoring",
    ]
    status: Literal["New", "In Review", "Resolved"]
    owner: Literal["IT", "Admin", "System"]
    time: str


class OperationalAlertStatusUpdate(BaseModel):
    status: Literal["New", "In Review", "Resolved"]


DESKTOP_BACKUP_SCHEMA_VERSION = 1
MAX_BACKUP_DAYS = 62
MAX_BACKUP_DRAFTS = 12
MAX_BACKUP_CAMERAS = 32
MAX_BACKUP_SERIALIZED_BYTES = 2 * 1024 * 1024
_CREDENTIAL_KEYS = frozenset({"password", "username"})


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


class DesktopBackupUpload(BaseModel):
    """Unsubmitted report data and camera settings, without passwords or raw tracking data."""

    schemaVersion: Literal[1]
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime
    days: list[DesktopBackupDay] = Field(default_factory=list, max_length=MAX_BACKUP_DAYS)
    drafts: list[DesktopBackupDraft] = Field(default_factory=list, max_length=MAX_BACKUP_DRAFTS)
    cameras: list[dict[str, Any]] = Field(default_factory=list, max_length=MAX_BACKUP_CAMERAS)

    @model_validator(mode="after")
    def validate_backup(self) -> DesktopBackupUpload:
        dates = [day.businessDate for day in self.days]
        if len(dates) != len(set(dates)):
            raise ValueError("Each backed-up day must appear once.")
        keys = [draft.draftKey for draft in self.drafts]
        if len(keys) != len(set(keys)):
            raise ValueError("Each backed-up report draft must appear once.")
        if any(_contains_credentials(camera) for camera in self.cameras):
            raise ValueError("Camera backups must not contain usernames or passwords.")
        serialized_size = len(self.model_dump_json().encode("utf-8"))
        if serialized_size > MAX_BACKUP_SERIALIZED_BYTES:
            raise ValueError(
                "Desktop backup exceeds the maximum serialized size of "
                f"{MAX_BACKUP_SERIALIZED_BYTES} bytes."
            )
        return self


class DesktopBackup(DesktopBackupUpload):
    receivedAt: datetime


class DesktopBackupSummary(BaseModel):
    deviceId: str | None = None
    capturedAt: datetime
    receivedAt: datetime
    days: int
    drafts: int
    cameras: int


def _contains_credentials(value: Any) -> bool:
    """Whether a camera profile carries a username, password, or credentials in a URL."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _CREDENTIAL_KEYS and item not in (None, ""):
                return True
            if _contains_credentials(item):
                return True
        return False
    if isinstance(value, list):
        return any(_contains_credentials(item) for item in value)
    if isinstance(value, str) and "://" in value:
        try:
            parsed = urlparse(value)
            return bool(parsed.username or parsed.password)
        except ValueError:
            return False
    return False
