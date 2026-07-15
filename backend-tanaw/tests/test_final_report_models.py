from typing import Any, cast

from sqlalchemy import UniqueConstraint

from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportItem,
    FinalReportSourceClaim,
    FinalReportVersion,
    ReportFinalization,
)


def test_final_report_uses_logical_parent_and_exact_revision_claims() -> None:
    assert ReportFinalization.__tablename__ == "report_finalizations"
    assert FinalReportVersion.__tablename__ == "final_report_versions"
    assert FinalReportItem.__table__.c.report_revision_id.type.python_type is str
    table = cast(Any, FinalReportSourceClaim.__table__)
    claim_uniques = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert ("report_revision_id",) in claim_uniques


def test_artifact_lifecycle_is_separate_from_immutable_version_facts() -> None:
    assert "status" not in FinalReportVersion.__table__.c
    assert {
        "status",
        "storage_key",
        "content_hash",
        "template_version",
        "generation_attempts",
    }.issubset(FinalReportArtifact.__table__.c.keys())
