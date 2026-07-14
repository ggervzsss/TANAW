from app.main import app


def test_openapi_exposes_only_target_report_and_telemetry_contracts() -> None:
    paths = app.openapi()["paths"]

    for target_path in (
        "/operational/desktop/telemetry-epochs/v2",
        "/operational/desktop/telemetry/v2",
        "/operational/desktop/report-submissions/v2",
        "/operational/reports/v2",
        "/operational/reports/finalizations/v2",
        "/operational/sites/v2",
    ):
        assert target_path in paths

    for removed_path in (
        "/operational/desktop/telemetry",
        "/operational/desktop/report-submissions",
        "/operational/telemetry/latest",
        "/operational/telemetry/summary",
        "/operational/reports/intake",
        "/operational/reports/final",
        "/operational/reports/enterprises",
        "/operational/map-enterprises",
        "/operational/simulation/fleet/sites",
        "/operational/simulation/fleet/telemetry",
        "/operational/system-activities",
        "/operational/system-logs",
        "/operational/lgu-accounts",
        "/operational/enterprise-accounts",
    ):
        assert removed_path not in paths
