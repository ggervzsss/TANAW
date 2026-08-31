import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.enterprise import require_enterprise_profile
from app.features.accounts.models import Account
from app.features.reporting.errors import ReportSubmissionIdentityConflictError
from app.features.reporting.models import ReportSubmissionOperation
from app.features.reporting.schemas import DesktopReportSubmissionIngest, IntakeReportSummary


@dataclass(frozen=True, slots=True)
class ReportSubmissionClaim:
    operation_id: str | None
    replay: IntakeReportSummary | None


async def claim_report_submission(
    db: AsyncSession,
    account: Account,
    payload: DesktopReportSubmissionIngest,
) -> ReportSubmissionClaim:
    profile = require_enterprise_profile(account)
    operation_id = str(uuid4())
    fingerprint = report_submission_fingerprint(payload)
    statement = (
        insert(ReportSubmissionOperation)
        .values(
            id=operation_id,
            enterprise_profile_id=profile.account_id,
            submission_id=str(payload.submissionId),
            request_fingerprint=fingerprint,
            report_id=payload.reportId,
        )
        .on_conflict_do_nothing(constraint="uq_report_submission_operation_identity")
        .returning(ReportSubmissionOperation.id)
    )
    claimed_id = await db.scalar(statement)
    if claimed_id is not None:
        return ReportSubmissionClaim(operation_id=claimed_id, replay=None)

    existing = await db.scalar(
        select(ReportSubmissionOperation).where(
            ReportSubmissionOperation.enterprise_profile_id == profile.account_id,
            ReportSubmissionOperation.submission_id == str(payload.submissionId),
        )
    )
    if existing is None:
        raise RuntimeError("The completed report submission operation could not be loaded.")
    if existing.request_fingerprint != fingerprint:
        raise ReportSubmissionIdentityConflictError(
            "This report submission identity was already used for different request data."
        )
    if existing.response_json is None or existing.intake_report_id is None:
        raise RuntimeError("The report submission operation is not complete.")

    return ReportSubmissionClaim(
        operation_id=None,
        replay=IntakeReportSummary.model_validate(existing.response_json),
    )


async def complete_report_submission(
    db: AsyncSession,
    claim: ReportSubmissionClaim,
    report: IntakeReportSummary,
) -> None:
    if claim.operation_id is None:
        raise RuntimeError("A replayed report submission cannot be completed again.")
    await db.execute(
        update(ReportSubmissionOperation)
        .where(ReportSubmissionOperation.id == claim.operation_id)
        .values(
            intake_report_id=report.id,
            response_json=report.model_dump(mode="json"),
            completed_at=datetime.now(UTC),
        )
    )


def report_submission_fingerprint(payload: DesktopReportSubmissionIngest) -> str:
    request_data = payload.model_dump(mode="json", exclude={"submissionId"})
    canonical_request = json.dumps(request_data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
