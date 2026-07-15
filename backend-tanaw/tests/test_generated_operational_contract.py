import json
from pathlib import Path

from app.core.contract_export import build_operational_contract
from app.main import app

SHARED_CONTRACT = (
    Path(__file__).resolve().parents[2] / "shared-contracts" / "operational-v2.openapi.json"
)


def test_shared_operational_contract_is_current() -> None:
    generated = build_operational_contract(app)

    assert json.loads(SHARED_CONTRACT.read_text(encoding="utf-8")) == generated
    assert generated["info"]["version"] == "2.0.0"
    assert "/operational/desktop/report-submissions/v2" in generated["paths"]
    assert "/operational/desktop/telemetry/v2" in generated["paths"]
    assert "/operational/reports/finalizations/v2" in generated["paths"]
    assert "/maintenance/operations" in generated["paths"]
    assert all("/v1" not in path for path in generated["paths"])
