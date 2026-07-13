from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.final_reports.service import _final_content_hash, _Source
from app.features.reporting.models import (
    EnterpriseReport,
    ReportingObligation,
    ReportRevision,
)
from app.features.topology.models import Enterprise, EnterpriseSite


def test_final_content_hash_binds_frozen_scope_identity_and_source_order_is_stable() -> None:
    staff = Account(
        id="00000000-0000-0000-0000-000000000099",
        email="content-hash-staff@example.test",
        password_hash="not-used",
        role=AccountRole.STAFF,
        display_name="Content Hash Staff",
        title="Tourism Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    sources = [_source("1", enterprise_name="Enterprise One"), _source("2")]

    baseline = _hash(staff, sources)
    reordered = _hash(staff, list(reversed(sources)))
    renamed = _hash(
        staff,
        [_source("1", enterprise_name="Renamed Enterprise One"), _source("2")],
    )

    assert baseline == "sha256:40c8842def346b96c12e3f0bc6a1943a24eab8c589bd480b7c5fd5a6b8eb555c"
    assert reordered == baseline
    assert renamed != baseline


def _hash(staff: Account, sources: list[_Source]) -> str:
    return _final_content_hash(
        period_id="00000000-0000-0000-0000-000000000001",
        classification="official",
        version_number=1,
        scope_type="enterprise_selection",
        scope_barangay=None,
        scope_label="Selected enterprises (2)",
        sources=sources,
        metrics=[],
        demographics=[],
        prepared_by=staff,
        finalized_at=datetime(2026, 7, 13, tzinfo=UTC),
    )


def _source(suffix: str, *, enterprise_name: str | None = None) -> _Source:
    return _Source(
        revision=cast(
            ReportRevision,
            SimpleNamespace(
                id=f"00000000-0000-0000-0000-0000000001{suffix:0>2}",
                payload_hash=f"sha256:{int(suffix):064x}",
            ),
        ),
        report=cast(EnterpriseReport, SimpleNamespace()),
        obligation=cast(
            ReportingObligation,
            SimpleNamespace(
                id=f"00000000-0000-0000-0000-0000000002{suffix:0>2}",
                frozen_barangay="Poblacion",
            ),
        ),
        enterprise=cast(
            Enterprise,
            SimpleNamespace(
                id=f"00000000-0000-0000-0000-0000000003{suffix:0>2}",
                official_code=f"ENT-{suffix}",
                name=enterprise_name or f"Enterprise {suffix}",
                category="Accommodation",
            ),
        ),
        site=cast(
            EnterpriseSite,
            SimpleNamespace(
                id=f"00000000-0000-0000-0000-0000000004{suffix:0>2}",
                site_code=f"SITE-{suffix}",
                name=f"Site {suffix}",
            ),
        ),
    )
