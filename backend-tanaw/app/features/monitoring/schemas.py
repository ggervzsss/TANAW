from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DesktopMetricsSummary(BaseModel):
    entries: int = Field(default=0, ge=0)
    exits: int = Field(default=0, ge=0)
    peakOccupancy: int = Field(default=0, ge=0)
    currentOccupancy: int = Field(default=0, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
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
    cameras: list[DesktopCameraMonitoringItem] = Field(default_factory=list)


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
    entries: int
    exits: int
    currentOccupancy: int
    peakOccupancy: int
    uniqueCount: int
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
    totalEntries: int
    totalExits: int
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
    averageVisitors: int = Field(ge=0)
    peakVisitors: int = Field(ge=0)


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
    currentVisitors: int = Field(ge=0)
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
