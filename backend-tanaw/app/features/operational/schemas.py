import re
from calendar import month_abbr, month_name, monthrange
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.reporting.contracts import reporting_period_from_key

SourceKind = Literal["real", "mock", "hybrid"]
REPORTING_TIME_ZONE = ZoneInfo("Asia/Manila")
REPORTING_PERIOD_RANGE_RE = re.compile(
    r"^([A-Za-z]+)\s+\d{1,2}\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(\d{4})$"
)
REPORTING_PERIOD_MONTH_RE = re.compile(r"^([A-Za-z]+)\s+(\d{4})$")
MONTH_INDEX_BY_LABEL = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


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


class DesktopTelemetryIngest(BaseModel):
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime | None = None
    metrics: DesktopMetricsSummary
    session: DesktopSessionSummary = Field(default_factory=DesktopSessionSummary)
    health: DesktopHealthSummary = Field(default_factory=DesktopHealthSummary)
    sourceKind: SourceKind = "real"
    mockRunId: str | None = Field(default=None, max_length=36)
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
    sourceKind: SourceKind = "real"
    mockRunId: str | None = None


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


def _report_metrics_from_payload(
    payload: dict | None,
) -> tuple[int, int, int, int] | None:
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    if not isinstance(metrics, dict):
        return None

    entries = _non_negative_int(metrics.get("entries"))
    exits = _non_negative_int(metrics.get("exits"))
    peak_occupancy = _non_negative_int(
        _first_present(metrics, "peak", "peakOccupancy", "peak_occupancy")
    )
    unique_count = _non_negative_int(
        _first_present(metrics, "unique", "uniqueCount", "unique_count")
    )
    if entries is None or exits is None or peak_occupancy is None or unique_count is None:
        return None
    return entries, min(exits, entries), peak_occupancy, unique_count


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _first_present(values: dict, *keys: str) -> object:
    for key in keys:
        if key in values:
            return values[key]
    return None


def reporting_period_submission_error(period: str, submitted_at: datetime) -> str | None:
    period_end = _reporting_period_end_date(period)
    if period_end is None:
        return "Reporting period must include a recognizable month and year before submission."

    submitted_date = _reporting_date(submitted_at)
    opens_on = period_end + timedelta(days=1)
    if submitted_date >= opens_on:
        return None

    return (
        f"Submission opens on {_format_period_date(opens_on)} after the "
        f"{month_name[period_end.month]} {period_end.year} reporting period closes."
    )


def _reporting_period_end_date(period: str) -> date | None:
    normalized_period = period.strip()
    range_match = REPORTING_PERIOD_RANGE_RE.match(normalized_period)
    if range_match:
        start_month, end_month, end_day, year = range_match.groups()
        month = _month_number(end_month or start_month)
        if month is None:
            return None
        try:
            return date(int(year), month, int(end_day))
        except ValueError:
            return None

    month_year_match = REPORTING_PERIOD_MONTH_RE.match(normalized_period)
    if month_year_match:
        month_label, year_label = month_year_match.groups()
        month = _month_number(month_label)
        if month is None:
            return None
        year = int(year_label)
        return date(year, month, monthrange(year, month)[1])

    return None


def _month_number(month_label: str) -> int | None:
    return MONTH_INDEX_BY_LABEL.get(month_label.lower())


def _reporting_date(value: datetime) -> date:
    aware_value = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware_value.astimezone(REPORTING_TIME_ZONE).date()


def _format_period_date(value: date) -> str:
    return f"{month_abbr[value.month]} {value.day}, {value.year}"


class DesktopReportSubmissionIngest(BaseModel):
    reportId: str = Field(min_length=3, max_length=80)
    period: str = Field(default="Current Period", min_length=1, max_length=120)
    submittedAt: datetime
    entries: int = Field(default=0, ge=0)
    exits: int = Field(default=0, ge=0)
    peakOccupancy: int = Field(default=0, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=5000)
    syncStatus: str | None = Field(default=None, max_length=60)
    sourceKind: SourceKind = "real"
    mockRunId: str | None = Field(default=None, max_length=36)
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_report_metrics(self) -> DesktopReportSubmissionIngest:
        payload_metrics = _report_metrics_from_payload(self.payload)
        if payload_metrics is not None:
            self.entries, self.exits, self.peakOccupancy, self.uniqueCount = payload_metrics
        if self.exits > self.entries:
            raise ValueError("Total exits cannot exceed total entries.")
        period_submission_error = reporting_period_submission_error(self.period, self.submittedAt)
        if period_submission_error:
            raise ValueError(period_submission_error)
        demo = (self.payload or {}).get("demo")
        required_demo_fields = {
            "thisProvMale",
            "thisProvFemale",
            "otherProvMale",
            "otherProvFemale",
            "foreignMale",
            "foreignFemale",
        }
        if not isinstance(demo, dict):
            raise ValueError("Demographics are required.")
        demographic_total = 0
        for field in required_demo_fields:
            raw_value = str(demo.get(field, "")).strip()
            if raw_value == "":
                continue
            if not raw_value.isdigit():
                raise ValueError("Demographics values must be non-negative whole numbers.")
            demographic_total += int(raw_value)
        if demographic_total > self.uniqueCount:
            raise ValueError("Demographic totals cannot exceed the unique visitor count.")
        if demographic_total < self.uniqueCount:
            raise ValueError(
                "Demographic totals must match the unique visitor count before submission."
            )
        return self


class MockPreparationSourceWindow(BaseModel):
    start: datetime
    end: datetime


class MockPreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str
    periodKey: str
    sourceWindow: MockPreparationSourceWindow

    @model_validator(mode="after")
    def validate_canonical_period(self) -> MockPreparationCounts:
        reporting_period = reporting_period_from_key(self.periodKey)
        if (
            self.sourceWindow.start.tzinfo is None
            or self.sourceWindow.start.utcoffset() is None
            or self.sourceWindow.end.tzinfo is None
            or self.sourceWindow.end.utcoffset() is None
        ):
            raise ValueError("Mock preparation source-window bounds must include a UTC offset.")
        if (
            self.sourceWindow.start.astimezone(UTC) != reporting_period.starts_at
            or self.sourceWindow.end.astimezone(UTC) != reporting_period.ends_at
        ):
            raise ValueError(
                "Mock preparation source window must match the canonical reporting period."
            )
        return self


class MockPreparationSummary(BaseModel):
    runId: str
    status: Literal["active", "removed"]
    enterpriseId: str
    enterpriseName: str
    counts: MockPreparationCounts | None = None
    pendingCounts: list[MockPreparationCounts] = Field(default_factory=list)


ReportReviewStatus = Literal["Pending Review", "Ready to Consolidate", "Returned", "Consolidated"]


class ReportStatusUpdate(BaseModel):
    status: ReportReviewStatus
    remarks: str | None = Field(default=None, max_length=2000)


class ReportDemographicsSummary(BaseModel):
    thisProvMale: int = Field(ge=0)
    thisProvFemale: int = Field(ge=0)
    otherProvMale: int = Field(ge=0)
    otherProvFemale: int = Field(ge=0)
    foreignMale: int = Field(ge=0)
    foreignFemale: int = Field(ge=0)


class IntakeReportSummary(BaseModel):
    id: str
    enterpriseId: str
    enterprise: str
    category: str
    barangay: str
    month: str
    period: str
    submitted: str
    submittedAt: datetime
    status: ReportReviewStatus
    code: str
    remarks: str | None = None
    notes: str | None = None
    metrics: dict[str, int | str]
    payload: dict | None = None
    demographics: ReportDemographicsSummary | None = None


FinalReportArchivedFromStatus = Literal["Draft", "Finalized", "Returned for Revision"]
FinalReportStatus = Literal["Draft", "Finalized", "Archived", "Returned for Revision"]


class FinalReportSourceSummary(BaseModel):
    id: str
    enterprise: str
    code: str
    unique: int
    entry: int
    exit: int
    demographics: ReportDemographicsSummary | None = None


class FinalReportSummary(BaseModel):
    id: str
    title: str
    period: str
    generatedOn: str
    preparedBy: str
    preparedRole: str
    status: FinalReportStatus
    archivedFromStatus: FinalReportArchivedFromStatus | None = None
    totalEntry: int
    totalExit: int
    totalUnique: int
    enterpriseCount: int
    sources: list[FinalReportSourceSummary]


class OperationalAlertSummary(BaseModel):
    id: str
    type: Literal[
        "Maintenance Request",
        "Password Reset Request",
        "Submission Delay",
        "Threshold Breach",
        "Foot Traffic Alert",
        "Occupancy Spike",
        "Failed Login Threshold",
        "Sync Delay",
    ]
    severity: Literal["Info", "Warning", "Critical"]
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
        "Automatic Health Recovery",
    ]
    status: Literal["New", "In Review", "Resolved"]
    owner: Literal["IT", "Admin", "System"]
    time: str


class OperationalAlertStatusUpdate(BaseModel):
    status: Literal["New", "In Review", "Resolved"]


NotificationSeverity = Literal["Info", "Warning", "Critical", "Success"]


class UserNotificationSummary(BaseModel):
    id: str
    recipientAccountId: str
    title: str
    message: str
    type: str
    severity: NotificationSeverity
    sourceType: str | None = None
    sourceId: str | None = None
    targetPath: str | None = None
    createdBy: str | None = None
    recipientRole: str
    recipientEnterpriseId: str | None = None
    createdAt: str
    readAt: str | None = None


class EnterpriseNotificationCreate(BaseModel):
    enterpriseId: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    type: str = Field(default="Staff Follow-up", min_length=1, max_length=60)
    severity: NotificationSeverity = "Warning"
    sourceType: str | None = Field(default=None, max_length=80)
    sourceId: str | None = Field(default=None, max_length=120)


class NotificationReadUpdate(BaseModel):
    read: bool = True


SupportTicketCategory = Literal[
    "Camera Issue",
    "Report Concern",
    "Maintenance",
    "Account & Security",
    "Other",
]
SupportTicketPriority = Literal["Low", "Normal", "High", "Urgent"]
SupportTicketStatus = Literal["Open", "In Review", "Resolved"]
SupportTicketAttachmentType = Literal["image/png", "image/jpeg", "image/webp"]


class SupportTicketAttachment(BaseModel):
    id: str
    fileName: str = Field(min_length=1, max_length=160)
    mediaType: SupportTicketAttachmentType
    sizeBytes: int = Field(ge=1, le=5 * 1024 * 1024)
    url: str

    @field_validator("fileName")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        file_name = value.strip().replace("\\", "/").split("/")[-1]
        if not file_name:
            raise ValueError("Photo file name is required.")
        lowered = file_name.lower()
        if not lowered.endswith((".png", ".jpg", ".jpeg", ".webp")):
            raise ValueError("Only image files are allowed.")
        return file_name


class SupportTicketCreate(BaseModel):
    category: SupportTicketCategory
    priority: SupportTicketPriority = "Normal"
    subject: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=4000)
    affectedArea: str | None = Field(default=None, max_length=120)
    cameraNode: str | None = Field(default=None, max_length=120)

    @field_validator("subject", "description", "affectedArea", "cameraNode", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.strip().split())
        return normalized or None


class SupportTicketSummary(BaseModel):
    id: str
    code: str
    enterpriseId: str
    enterpriseName: str
    submittedBy: str
    category: str
    priority: str
    subject: str
    description: str
    affectedArea: str | None = None
    cameraNode: str | None = None
    attachments: list[SupportTicketAttachment] = Field(default_factory=list)
    status: SupportTicketStatus
    createdAt: datetime
    updatedAt: datetime


class SupportTicketMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.strip().split())
        return normalized


class SupportTicketMessageSummary(BaseModel):
    id: str
    ticketId: str
    authorId: str
    authorName: str
    authorRole: str
    message: str
    createdAt: datetime


class SupportTicketStatusUpdate(BaseModel):
    status: SupportTicketStatus


class SupportTicketDetail(SupportTicketSummary):
    messages: list[SupportTicketMessageSummary] = Field(default_factory=list)


class FinalReportCreate(BaseModel):
    reportIds: list[str] = Field(min_length=1, max_length=500)
    preparedBy: str = Field(min_length=1, max_length=120)


class FinalReportStatusUpdate(BaseModel):
    status: FinalReportStatus


class FinalReportRevisionReturn(BaseModel):
    sourceReportIds: list[str] = Field(min_length=1, max_length=500)
    remarks: str = Field(min_length=5, max_length=2000)

    @field_validator("sourceReportIds")
    @classmethod
    def validate_unique_source_report_ids(cls, value: list[str]) -> list[str]:
        normalized_ids = [item.strip() for item in value if item.strip()]
        if len(normalized_ids) != len(value):
            raise ValueError("Source report IDs cannot be blank.")
        if len(normalized_ids) != len(set(normalized_ids)):
            raise ValueError("Source report IDs must be unique.")
        return normalized_ids


class OperationalWebSocketEnvelope(BaseModel):
    type: Literal[
        "telemetry.snapshot",
        "report.submitted",
        "report.updated",
        "summary.updated",
        "final_report.generated",
        "final_report.updated",
        "alert.created",
        "alert.updated",
        "alert.resolved",
        "notification.created",
        "notification.updated",
        "resource.invalidated",
    ]
    data: dict
