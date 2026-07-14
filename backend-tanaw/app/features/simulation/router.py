import json
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.reporting.models import EnterpriseReport, ReportingObligation, ReportingPeriod
from app.features.simulation.models import MockDataRun
from app.features.simulation.schemas import MockPreparationCounts, MockPreparationSummary
from app.features.topology.account_scope import require_account_topology

router = APIRouter(prefix="/operational", tags=["simulation"])
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]


@router.get("/desktop/simulation-preparation/v2", response_model=MockPreparationSummary | None)
async def get_desktop_mock_preparation(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MockPreparationSummary | None:
    topology = await require_account_topology(db, account)
    run = await db.scalar(
        select(MockDataRun)
        .where(MockDataRun.target_account_id == account.id)
        .order_by(MockDataRun.created_at.desc())
    )
    if run is None:
        return None

    pending_counts: list[MockPreparationCounts] = []
    if run.status == "active" and run.generated_counts_json:
        generated_counts = json.loads(run.generated_counts_json)
        raw_candidates = generated_counts.get("targetPreparedReportCounts")
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        candidate_period_keys = [
            candidate["periodKey"]
            for candidate in candidates
            if isinstance(candidate, dict) and isinstance(candidate.get("periodKey"), str)
        ]
        submitted_period_keys = set(
            (
                await db.scalars(
                    select(ReportingPeriod.natural_key)
                    .join(
                        ReportingObligation,
                        ReportingObligation.reporting_period_id == ReportingPeriod.id,
                    )
                    .join(
                        EnterpriseReport,
                        EnterpriseReport.reporting_obligation_id == ReportingObligation.id,
                    )
                    .where(
                        EnterpriseReport.enterprise_id == topology.enterprise.id,
                        EnterpriseReport.classification == "simulation",
                        ReportingPeriod.natural_key.in_(candidate_period_keys),
                    )
                )
            ).all()
            if candidate_period_keys
            else []
        )
        pending_counts = [
            MockPreparationCounts.model_validate(candidate)
            for candidate in candidates
            if isinstance(candidate, dict)
            and candidate.get("periodKey") not in submitted_period_keys
        ]

    return MockPreparationSummary(
        runId=run.id,
        status=run.status,  # type: ignore[arg-type]
        enterpriseId=run.target_enterprise_id or topology.official_code,
        enterpriseName=run.target_enterprise_name or topology.enterprise.name,
        counts=pending_counts[0] if pending_counts else None,
        pendingCounts=pending_counts,
    )
