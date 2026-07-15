from app.main import app


def test_openapi_exposes_report_and_telemetry_contracts() -> None:
    openapi = app.openapi()
    paths = openapi["paths"]

    for required_path in (
        "/operational/desktop/telemetry-epochs/v2",
        "/operational/desktop/telemetry/v2",
        "/operational/desktop/report-submissions/v2",
        "/operational/reports/v2",
        "/operational/reports/finalizations/v2",
        "/operational/sites/v2",
    ):
        assert required_path in paths

    assert all("/v1" not in path for path in paths)
