"""Contract snapshots for workflow tests; ML reconciliation has separate replay tests."""

import json
from calendar import monthrange
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.features.reporting.counting import snapshot_digest


def counting_snapshot(period: str, *, enterprise_id: str = "workflow-fixture", entries: int = 12,
                      exits: int = 7, peak: int = 5, unique: int = 6) -> dict:
    path = Path(__file__).resolve().parents[3] / "test-fixtures/open-space-establishment-report.json"
    snapshot = json.loads(path.read_text())["counting"]
    begin = datetime.strptime(period, "%B %Y").replace(tzinfo=ZoneInfo("Asia/Manila"))
    end = begin.replace(year=begin.year + (begin.month == 12), month=1 if begin.month == 12 else begin.month+1)
    snapshot.update(enterprise_id=enterprise_id, from_at=begin.isoformat(), to_at=end.isoformat(),
        days_requested=monthrange(begin.year, begin.month)[1], unique_count=unique,
        confirmed_unique_count=unique, entries=entries, exits=exits, peak_occupancy=peak, movement_state="partial")
    snapshot["snapshot_version"] = snapshot_digest(snapshot)
    return snapshot
