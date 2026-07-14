from typing import Literal

from pydantic import BaseModel


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
