import json
import tempfile
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

from support.cameras import FakePipeline

from app.analytics.restored_day import RESTORED_BASELINE_KEY
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_sample_repository import prepare_sample_period
from app.storage.repositories.local_backup_repository import (
    backup_window_start,
    export_local_backup,
    local_data_is_empty,
    restore_local_backup,
)
from app.storage.repositories.report_draft_repository import ReportDraftRepository

# Noon on 16 November 2026 in Manila.
NOW = datetime(2026, 11, 16, 4, tzinfo=UTC)
TODAY = "2026-11-16"
COUNTS = {"entries": 120, "exits": 108, "unique_count": 90}


def prepare(service: EstablishmentRegistry, period: str, now: datetime = NOW) -> None:
    prepare_sample_period(
        service.repository, report_id=f"SAMPLE-{period}", period=period, now=now, **COUNTS
    )


def daily_summaries(service: EstablishmentRegistry) -> dict[str, tuple[dict[str, Any], int]]:
    with service.database.connection() as db:
        return {
            str(row["business_date"]): (json.loads(row["metrics_json"]), int(row["finalized"]))
            for row in db.execute(
                "select business_date, metrics_json, finalized from establishment_daily_summaries"
            )
        }


def test_backup_window_starts_at_the_previous_month() -> None:
    assert backup_window_start(date(2026, 11, 16)) == date(2026, 10, 1)
    assert backup_window_start(date(2026, 1, 3)) == date(2025, 12, 1)


def test_export_covers_unsubmitted_months_and_their_drafts(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    for period in ("September 2026", "October 2026", "November 2026"):
        prepare(service, period)
    drafts = ReportDraftRepository(service.database)
    drafts.save("period:November 2026", "November 2026", {"origins": {"2026-11-02": {}}})
    drafts.save("period:October 2026", "October 2026", {"origins": {}})
    drafts.save("report:REP-9", "August 2026", {"origins": {}}, report_id="REP-9")
    drafts.save("scratch:unrelated", "November 2026", {})

    backup = export_local_backup(service.database, NOW)

    dates = [day["business_date"] for day in backup["days"]]
    assert dates[0] == "2026-10-01"
    assert dates[-1] == TODAY
    assert len(dates) == 31 + 16
    assert {draft["draft_key"] for draft in backup["drafts"]} == {
        "period:November 2026",
        "period:October 2026",
        "report:REP-9",
    }

    with service.database.connection() as db:
        db.execute(
            "insert into report_submissions "
            "(report_id, submission_id, period, submitted_at, payload_json) values (?,?,?,?,?)",
            ("REP-OCT", "SUB-OCT", "October 2026", NOW.isoformat(), "{}"),
        )
    backup = export_local_backup(service.database, NOW)

    assert {day["business_date"][:7] for day in backup["days"]} == {"2026-11"}
    assert {draft["draft_key"] for draft in backup["drafts"]} == {
        "period:November 2026",
        "report:REP-9",
    }


def test_restore_closes_earlier_days_and_keeps_counting_today(tmp_path: Path) -> None:
    original = EstablishmentRegistry(str(tmp_path / "original"), "park")
    prepare(original, "November 2026")
    ReportDraftRepository(original.database).save(
        "period:November 2026", "November 2026", {"origins": {"2026-11-02": {"foreign": 3}}}
    )
    backup = export_local_backup(original.database, NOW)
    backed_up = daily_summaries(original)

    restored = EstablishmentRegistry(str(tmp_path / "restored"), "park")
    assert local_data_is_empty(restored.database)
    later = NOW + timedelta(hours=1)
    result = restore_local_backup(
        restored.database, days=backup["days"], drafts=backup["drafts"], now=later
    )

    assert result == {"days": 16, "drafts": 1}
    assert not local_data_is_empty(restored.database)
    summaries = daily_summaries(restored)
    yesterday, closed = summaries["2026-11-15"]
    assert closed == 1
    assert yesterday["entries"] == backed_up["2026-11-15"][0]["entries"]
    today, closed = summaries[TODAY]
    assert closed == 0
    assert today[RESTORED_BASELINE_KEY]["entries"] == backed_up[TODAY][0]["entries"]
    draft = ReportDraftRepository(restored.database).get("period:November 2026")
    assert draft is not None
    assert draft["payload"] == {"origins": {"2026-11-02": {"foreign": 3}}}

    # Counting after the restore adds to today's restored totals instead of replacing them.
    prepare(restored, "November 2026", now=later)
    reference = EstablishmentRegistry(str(tmp_path / "reference"), "park")
    prepare(reference, "November 2026", now=later)
    counted_since = daily_summaries(reference)[TODAY][0]
    today = daily_summaries(restored)[TODAY][0]
    assert today["entries"] == backed_up[TODAY][0]["entries"] + counted_since["entries"]
    assert today["unique_count"] == (
        backed_up[TODAY][0]["unique_count"] + counted_since["unique_count"]
    )
    assert today[RESTORED_BASELINE_KEY]["entries"] == backed_up[TODAY][0]["entries"]


def test_restore_skips_days_after_today(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    result = restore_local_backup(
        service.database,
        days=[{"business_date": "2026-11-17", "finalized": False, "metrics": {"entries": 4}}],
        drafts=[],
        now=NOW,
    )

    assert result == {"days": 0, "drafts": 0}
    assert local_data_is_empty(service.database)


class RegistryRestoreTest(unittest.TestCase):
    def setUp(self) -> None:
        summary_worker = patch.object(CameraPipelineRegistry, "_start_summary_worker")
        summary_worker.start()
        self.addCleanup(summary_worker.stop)

    def test_restores_cameras_once_and_only_for_the_bound_enterprise(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)
            registry.bind_enterprise("park@example.test")

            with self.assertRaisesRegex(ValueError, "bound to park@example.test"):
                registry.restore_local_backup(
                    enterprise_id="other@example.test", days=[], drafts=[], cameras=[]
                )

            self.assertTrue(registry.export_local_backup()["empty"])
            result = registry.restore_local_backup(
                enterprise_id="park@example.test", days=[], drafts=[], cameras=[_profile(1)]
            )
            self.assertEqual(result, {"restored": True, "days": 0, "drafts": 0, "cameras": 1})
            cameras = registry.list_camera_profiles()
            self.assertEqual([camera["status"] for camera in cameras], ["untested"])

            backup = registry.export_local_backup()
            self.assertFalse(backup["empty"])
            self.assertEqual([camera["id"] for camera in backup["cameras"]], [1])

            again = registry.restore_local_backup(
                enterprise_id="park@example.test", days=[], drafts=[], cameras=[_profile(2)]
            )
            self.assertEqual(again, {"restored": False, "days": 0, "drafts": 0, "cameras": 0})
            self.assertEqual([camera["id"] for camera in registry.list_camera_profiles()], [1])


def _profile(camera_id: int) -> dict[str, Any]:
    host = f"192.168.1.{20 + camera_id}"
    return {
        "cameraHost": host,
        "confidence": 0.35,
        "config": {
            "reverse": False,
            "roi": {"height": 100, "left": 0, "top": 0, "width": 100},
            "tripwire": 50,
        },
        "id": camera_id,
        "name": f"Camera {camera_id}",
        "processingProfile": "auto",
        "reidMode": "auto",
        "rtsp": f"rtsp://{host}/stream2",
        "rtspStream": "stream2",
        "status": "running",
        "trackingConfidence": 0.15,
        "uniqueCountingMode": "estimated_reid",
        "zone": "Lobby",
    }
