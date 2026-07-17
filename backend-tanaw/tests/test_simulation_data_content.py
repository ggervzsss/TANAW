import random
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.password_policy import validate_password_policy
from app.features.simulation.models import SimulationRun
from app.features.simulation.schemas import SimulationPreparationCounts
from app.features.simulation.seed_cli import (
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    create_prepared_report_counts,
    ensure_active_target_matches,
    resolve_target_enterprise,
    simulation_preparation_counts,
)


def test_generated_enterprises_match_configured_locations_and_contacts() -> None:
    expected_enterprises = (
        (
            "Balon ni Lolo Uweng",
            "tourism",
            "Ma Regine Javier",
            "Landayan",
            "Barangay Landayan, San Pedro, Laguna 4023",
            14.352361,
            121.067985,
            "balon.lolo.uweng@tanaw.test",
            "+639171110001",
        ),
        (
            "San Pedro Apostol Parish",
            "tourism",
            "Irish May Arabaca",
            "Nueva",
            "Barangay Nueva, San Pedro, Laguna 4023",
            14.363881,
            121.056564,
            "sanpedro.apostol@tanaw.test",
            "+639171110002",
        ),
        (
            "Lolo Uweng Pilgrim Church",
            "tourism",
            "David Kristian Vallejera",
            "Landayan",
            "Barangay Landayan, San Pedro, Laguna 4023",
            14.350951,
            121.066450,
            "lolo.uweng.church@tanaw.test",
            "+639171110003",
        ),
        (
            "Tricia's Bar & Lounge",
            "business",
            "Kenneth Delicano",
            "Nueva",
            "Barangay Nueva, San Pedro, Laguna 4023",
            14.348207,
            121.064359,
            "tricias.bar@tanaw.test",
            "+639171110004",
        ),
        (
            "Hallow Ridge Filipinas Golf Inc.",
            "tourism",
            "Sebastien Bercasio",
            "San Antonio",
            "Barangay San Antonio, San Pedro, Laguna 4023",
            14.357021,
            121.028243,
            "hallowridge.golf@tanaw.test",
            "+639171110005",
        ),
    )

    assert (
        tuple(
            (
                enterprise.name,
                enterprise.category,
                enterprise.manager,
                enterprise.barangay,
                enterprise.address,
                enterprise.latitude,
                enterprise.longitude,
                enterprise.email,
                enterprise.phone,
            )
            for enterprise in ENTERPRISES
        )
        == expected_enterprises
    )
    assert len({enterprise.email for enterprise in ENTERPRISES}) == len(ENTERPRISES)
    assert len({enterprise.phone for enterprise in ENTERPRISES}) == len(ENTERPRISES)


def test_generated_account_content_uses_simulation_vocabulary() -> None:
    values = [TEST_ACCOUNT_PASSWORD, REPORTING_STAFF_NAME]
    for enterprise in ENTERPRISES:
        values.extend(
            [
                enterprise.name,
                enterprise.category,
                enterprise.manager,
                enterprise.barangay,
                enterprise.address,
                enterprise.email,
            ]
        )
    for email, _role, display_name, title, first_name, last_name in LGU_ACCOUNTS:
        values.extend([email, display_name, title, first_name, last_name])

    assert all("mock" not in value.lower() for value in values)
    assert validate_password_policy(TEST_ACCOUNT_PASSWORD) == TEST_ACCOUNT_PASSWORD


@pytest.mark.asyncio
async def test_mock_target_resolves_only_by_official_enterprise_id() -> None:
    account = object()
    topology = object()
    db = AsyncMock(spec=AsyncSession)
    db.scalars.return_value = [account]

    with patch(
        "app.features.simulation.seed_cli.require_account_topology",
        new=AsyncMock(return_value=topology),
    ):
        result = await resolve_target_enterprise(db, "  ARCHIES_001@TANAW.SANPEDRO  ")

    statement = db.scalars.await_args.args[0]
    sql = " ".join(str(statement.compile(compile_kwargs={"literal_binds": True})).lower().split())
    where_sql = sql.split(" where ", maxsplit=1)[1]
    assert result is topology
    assert "lower(enterprises.official_code) = 'archies_001@tanaw.sanpedro'" in where_sql
    assert "enterprises.classification = 'official'" in where_sql
    assert "accounts.email" not in where_sql
    assert "enterprises.name" not in where_sql


def test_active_mock_run_matches_enterprise_id_without_email_lookup() -> None:
    run = SimulationRun(
        scenario="full-workflow",
        seed="test",
        range_start=datetime(2026, 1, 1, tzinfo=UTC),
        range_end=datetime(2026, 7, 1, tzinfo=UTC),
        target_enterprise_id="archies_001@tanaw.sanpedro",
        target_enterprise_name="Archie's Event Place",
        status="active",
    )

    ensure_active_target_matches(run, "ARCHIES_001@TANAW.SANPEDRO")

    with pytest.raises(SystemExit, match="select a different target"):
        ensure_active_target_matches(run, "another_001@tanaw.sanpedro")


def test_prepared_counts_are_bounded_to_two_canonical_periods() -> None:
    prepared = create_prepared_report_counts(
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 6, 30, tzinfo=UTC),
        "full-workflow",
        random.Random("tanaw-simulation"),
    )

    assert [item["periodKey"] for item in prepared] == [
        "month:Asia/Manila:2026-05",
        "month:Asia/Manila:2026-06",
    ]


def test_simulation_preparation_persists_canonical_period_identity_and_manila_bounds() -> None:
    counts = simulation_preparation_counts(
        month_start=datetime(2026, 6, 1, tzinfo=UTC),
        entries=100,
        exits=40,
        unique_count=75,
        peak_occupancy=61,
        period_label_value="Jun 1 - Jun 30, 2026",
    )

    parsed = SimulationPreparationCounts.model_validate(counts)

    assert parsed.period == "Jun 1 - Jun 30, 2026"
    assert parsed.periodKey == "month:Asia/Manila:2026-06"
    assert counts["sourceWindow"] == {
        "start": "2026-05-31T16:00:00.000Z",
        "end": "2026-06-30T16:00:00.000Z",
    }


def test_simulation_preparation_rejects_label_only_or_mismatched_period_identity() -> None:
    counts = simulation_preparation_counts(
        month_start=datetime(2026, 12, 1, tzinfo=UTC),
        entries=10,
        exits=4,
        unique_count=7,
        peak_occupancy=6,
        period_label_value="Dec 1 - Dec 31, 2026",
    )

    invalid_key = {**counts, "periodKey": "Dec 1 - Dec 31, 2026"}
    invalid_window = {
        **counts,
        "sourceWindow": {
            "start": "2026-11-30T16:00:00.000Z",
            "end": "2027-01-31T16:00:00.000Z",
        },
    }

    for candidate in (invalid_key, invalid_window):
        try:
            SimulationPreparationCounts.model_validate(candidate)
        except ValueError:
            pass
        else:  # pragma: no cover - assertion branch
            raise AssertionError("Invalid simulation period identity was accepted.")
