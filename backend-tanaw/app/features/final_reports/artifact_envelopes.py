"""External contracts for official final-report artifact access."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.features.reporting.envelopes import ContractModel


class FinalReportArtifactDetail(ContractModel):
    contractVersion: Literal[2] = 2
    reportFinalizationId: UUID
    finalReportVersionId: UUID
    artifactId: UUID
    status: Literal["pending", "ready", "failed"]
    templateVersion: str
    mimeType: str
    contentHash: str | None
    sizeBytes: int | None = Field(default=None, gt=0)
    generationAttempts: int = Field(ge=0)
    lastErrorCode: str | None
    generatedAt: datetime | None
    generatedByAccountId: UUID | None
    downloadAvailable: bool
    createdAt: datetime
    updatedAt: datetime
