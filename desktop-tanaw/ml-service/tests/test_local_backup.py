import json
import sqlite3
import tempfile
import unittest
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from support.cameras import FakePipeline

from app.analytics.restored_day import RESTORED_BASELINE_KEY
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.backup_camera_policy import backup_camera_profile
from app.storage.local_data_store import LocalDataStore
from app.storage.repositories import local_backup_repository
from app.storage.repositories.camera_repository import CameraRepository
from app.storage.repositories.establishment_sample_repository import prepare_sample_period
from app.storage.repositories.local_backup_repository import (
    BackupStateChangedError,
    backup_state,
    backup_window_start,
    export_local_backup,
    local_data_is_empty,
    record_server_revision,
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


def test_export_covers_undelivered_months_and_their_drafts(tmp_path: Path) -> None:
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
    assert backup["state"] == {"reconciled": False, "server_revision": None}

    # A report submitted offline is still waiting to upload: it and its month stay backed up.
    _insert_submission(service, "REP-OCT", "SUB-OCT", "October 2026")
    backup = export_local_backup(service.database, NOW)

    assert {day["business_date"][:7] for day in backup["days"]} == {"2026-10", "2026-11"}
    assert "period:October 2026" in {draft["draft_key"] for draft in backup["drafts"]}
    [pending] = backup["submissions"]
    assert (pending["report_id"], pending["submission_id"]) == ("REP-OCT", "SUB-OCT")
    assert pending["payload"] == {"status": "Submitted", "metrics": {"unique": 90}}
    assert pending["camera_breakdown"][0]["entries"] == 120

    # Once the server confirmed it, the month is no longer needed.
    LocalDataStore(enterprise_id="park", database=service.database).mark_report_synced(
        "REP-OCT", "SUB-OCT"
    )
    backup = export_local_backup(service.database, NOW)

    assert {day["business_date"][:7] for day in backup["days"]} == {"2026-11"}
    assert {draft["draft_key"] for draft in backup["drafts"]} == {
        "period:November 2026",
        "report:REP-9",
    }
    assert backup["submissions"] == []


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
    result = _restore(restored, backup, now=later)

    assert result == {
        "restored": True,
        "days": 16,
        "drafts": 1,
        "submissions": 0,
        "cameras": 0,
        "custom_cameras": 0,
    }
    assert backup_state(restored.database) == {"reconciled": True, "server_revision": 1}
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
    future = [{"business_date": "2026-11-17", "finalized": False, "metrics": {"entries": 4}}]

    result = _restore(service, {"days": future, "drafts": []})

    assert (result["restored"], result["days"]) == (True, 0)
    assert local_data_is_empty(service.database)


def test_a_failed_restore_leaves_nothing_behind_and_can_be_retried(tmp_path: Path) -> None:
    original = EstablishmentRegistry(str(tmp_path / "original"), "park")
    prepare(original, "November 2026")
    CameraRepository(original.database).replace_profiles([_profile(1)])
    _insert_submission(original, "REP-OCT", "SUB-OCT", "October 2026")
    backup = export_local_backup(original.database, NOW)

    restored = EstablishmentRegistry(str(tmp_path / "restored"), "park")
    write_state = local_backup_repository._write_state
    calls: list[int] = []

    def fail_after_the_camera_write(*args: Any, **kwargs: Any) -> None:
        calls.append(1)
        # The cameras were written in this transaction before the failure.
        assert CameraRepository(restored.database).list_profiles()
        raise sqlite3.OperationalError("disk I/O error")

    with (
        patch.object(local_backup_repository, "_write_state", fail_after_the_camera_write),
        pytest.raises(sqlite3.OperationalError),
    ):
        _restore(restored, backup)

    assert calls == [1]
    assert local_data_is_empty(restored.database)
    assert backup_state(restored.database) == {"reconciled": False, "server_revision": None}

    assert local_backup_repository._write_state is write_state
    result = _restore(restored, backup)

    assert result["restored"] is True
    assert (result["days"], result["submissions"], result["cameras"]) == (16, 1, 1)
    assert [camera["id"] for camera in CameraRepository(restored.database).list_profiles()] == [1]


def test_a_restore_after_local_edits_merges_and_keeps_what_was_set_up_here(
    tmp_path: Path,
) -> None:
    """Recovery failed or was slow, and the user set up a camera and counted meanwhile."""
    original = EstablishmentRegistry(str(tmp_path / "original"), "park")
    prepare(original, "November 2026")
    CameraRepository(original.database).replace_profiles([_profile(1), _profile(2)])
    ReportDraftRepository(original.database).save(
        "period:November 2026", "November 2026", {"origins": {"2026-11-02": {"foreign": 3}}}
    )
    backup = export_local_backup(original.database, NOW)
    backed_up = daily_summaries(original)

    fresh = EstablishmentRegistry(str(tmp_path / "fresh"), "park")
    later = NOW + timedelta(hours=1)
    # A different camera saved here with the ID the backup also uses, and today's counts.
    local_camera = {**_profile(7), "id": 1, "name": "Set up while offline"}
    CameraRepository(fresh.database).replace_profiles([local_camera])
    prepare(fresh, "November 2026", now=later)
    counted_here = daily_summaries(fresh)[TODAY][0]
    assert backup_state(fresh.database)["reconciled"] is False

    result = _restore(fresh, backup, now=later)

    assert result["restored"] is True
    cameras = {
        camera["name"]: camera for camera in CameraRepository(fresh.database).list_profiles()
    }
    assert cameras["Set up while offline"]["id"] == 1
    assert cameras["Set up while offline"]["status"] == local_camera["status"]
    assert {cameras["Camera 1"]["id"], cameras["Camera 2"]["id"]} == {2, 3}
    assert cameras["Camera 1"]["status"] == "untested"
    today = daily_summaries(fresh)[TODAY][0]
    assert today["entries"] == counted_here["entries"] + backed_up[TODAY][0]["entries"]
    assert (
        daily_summaries(fresh)["2026-11-15"][0]["entries"]
        == (backed_up["2026-11-15"][0]["entries"])
    )
    assert ReportDraftRepository(fresh.database).get("period:November 2026") is not None

    # The same server revision is never merged twice.
    again = _restore(fresh, backup, expected=1, revision=1, now=later)
    assert again["restored"] is False
    assert daily_summaries(fresh)[TODAY][0]["entries"] == today["entries"]


def test_restore_refuses_a_stale_recovery_state(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    record_server_revision(service.database, expected_revision=None, server_revision=3, now=NOW)

    with pytest.raises(BackupStateChangedError):
        _restore(service, {"days": [], "drafts": []}, expected=None, revision=4)
    with pytest.raises(BackupStateChangedError):
        record_server_revision(service.database, expected_revision=None, server_revision=5, now=NOW)

    assert backup_state(service.database) == {"reconciled": True, "server_revision": 3}


def test_a_report_submitted_offline_is_restored_ready_to_upload(tmp_path: Path) -> None:
    original = EstablishmentRegistry(str(tmp_path / "original"), "park")
    prepare(original, "October 2026")
    _insert_submission(original, "REP-OCT", "SUB-OCT", "October 2026")
    backup = export_local_backup(original.database, NOW)

    restored = EstablishmentRegistry(str(tmp_path / "restored"), "park")
    result = _restore(restored, backup)

    assert result["submissions"] == 1
    store = LocalDataStore(enterprise_id="park", database=restored.database)
    [submission] = store.list_report_submissions()
    assert submission["report_id"] == "REP-OCT"
    # The original submission ID keeps the retried upload idempotent on the server.
    assert submission["submission_id"] == "SUB-OCT"
    assert submission["sync_status"] == "pending_cloud_sync"
    assert submission["payload"] == {"status": "Submitted", "metrics": {"unique": 90}}
    assert submission["camera_breakdown"][0]["entries"] == 120
    assert {day[:7] for day in daily_summaries(restored)} == {"2026-10"}
    assert store.mark_report_synced("REP-OCT", "SUB-OCT")


@pytest.mark.parametrize(
    ("brand", "stream_url", "backed_up"),
    [
        ("tapo", "rtsp://192.168.1.21/stream1", "rtsp://192.168.1.21/stream1"),
        (
            "dahua",
            "rtsp://192.168.1.21:554/cam/realmonitor?channel=1&subtype=0",
            "rtsp://192.168.1.21:554/cam/realmonitor?channel=1&subtype=0",
        ),
        (
            "tenda",
            "rtsp://192.168.1.21:554/H264?ch=1&subtype=1",
            "rtsp://192.168.1.21:554/H264?ch=1&subtype=1",
        ),
        # Not one of the brand's presets: the first preset replaces it.
        (
            "dahua",
            "rtsp://192.168.1.21:554/cam/realmonitor?channel=1&subtype=1&token=abc",
            "rtsp://192.168.1.21:554/cam/realmonitor?channel=1&subtype=1",
        ),
        ("custom", "rtsp://192.168.1.21:8554/live?access_token=abc123", "rtsp://192.168.1.21:8554"),
        ("custom", "rtsp://192.168.1.21/k3y-in-path/main", "rtsp://192.168.1.21"),
    ],
)
def test_camera_backups_keep_only_allowlisted_settings(
    brand: str, stream_url: str, backed_up: str
) -> None:
    profile = {
        **_profile(1),
        "cameraBrand": brand,
        "rtsp": stream_url,
        "rtspStream": "stream1" if brand == "tapo" else None,
        "username": "admin",
        "password": "secret",
        "sessionToken": "abc",
        "tracks": [{"track_id": 3}],
        "config": {**_profile(1)["config"], "source": {"stream_url": stream_url}},
    }

    camera = backup_camera_profile(profile)

    assert camera is not None
    assert camera["rtsp"] == backed_up
    assert camera["config"] == _profile(1)["config"]
    assert set(camera) <= {
        "id",
        "name",
        "zone",
        "cameraHost",
        "cameraBrand",
        "connectionProfile",
        "rtspStream",
        "rtsp",
        "processingProfile",
        "confidence",
        "trackingConfidence",
        "reidMode",
        "uniqueCountingMode",
        "analysisMode",
        "openSpace",
        "config",
    }


def test_export_sends_allowlisted_cameras(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    custom = {
        **_profile(1),
        "cameraBrand": "custom",
        "rtsp": "rtsp://192.168.1.21:8554/live?token=abc",
        "rtspStream": None,
    }
    CameraRepository(service.database).replace_profiles([custom])

    [camera] = export_local_backup(service.database, NOW)["cameras"]

    assert camera["rtsp"] == "rtsp://192.168.1.21:8554"
    assert "status" not in camera
    assert "token" not in json.dumps(camera)


class RegistryRestoreTest(unittest.TestCase):
    def setUp(self) -> None:
        summary_worker = patch.object(CameraPipelineRegistry, "_start_summary_worker")
        summary_worker.start()
        self.addCleanup(summary_worker.stop)

    def test_restores_cameras_once_and_only_for_the_bound_enterprise(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)
            registry.bind_enterprise("park@example.test")
            request: dict[str, Any] = {
                "expected_revision": None,
                "server_revision": 1,
                "days": [],
                "drafts": [],
                "submissions": [],
            }

            with self.assertRaisesRegex(ValueError, "bound to park@example.test"):
                registry.restore_local_backup(
                    enterprise_id="other@example.test", cameras=[], **request
                )
            with self.assertRaisesRegex(ValueError, "bound to park@example.test"):
                registry.record_backup_revision(
                    enterprise_id="other@example.test", expected_revision=None, server_revision=1
                )

            exported = registry.export_local_backup()
            self.assertEqual(exported["enterprise_id"], "park@example.test")
            self.assertEqual(exported["state"], {"reconciled": False, "server_revision": None})
            result = registry.restore_local_backup(
                enterprise_id="park@example.test", cameras=[_profile(1)], **request
            )
            self.assertEqual((result["restored"], result["cameras"]), (True, 1))
            cameras = registry.list_camera_profiles()
            self.assertEqual([camera["status"] for camera in cameras], ["untested"])

            backup = registry.export_local_backup()
            self.assertEqual(backup["state"], {"reconciled": True, "server_revision": 1})
            self.assertEqual([camera["id"] for camera in backup["cameras"]], [1])

            again = registry.restore_local_backup(
                enterprise_id="park@example.test",
                cameras=[_profile(2)],
                **{**request, "expected_revision": 1},
            )
            self.assertFalse(again["restored"])
            self.assertEqual([camera["id"] for camera in registry.list_camera_profiles()], [1])

            saved = registry.record_backup_revision(
                enterprise_id="park@example.test", expected_revision=1, server_revision=2
            )
            self.assertEqual(saved, {"reconciled": True, "server_revision": 2})


def _restore(
    service: EstablishmentRegistry,
    backup: dict[str, Any],
    *,
    expected: int | None = None,
    revision: int = 1,
    now: datetime = NOW,
) -> dict[str, Any]:
    return restore_local_backup(
        service.database,
        expected_revision=expected,
        server_revision=revision,
        days=backup["days"],
        drafts=backup["drafts"],
        submissions=backup.get("submissions", []),
        cameras=backup.get("cameras", []),
        now=now,
    )


def _insert_submission(
    service: EstablishmentRegistry, report_id: str, submission_id: str, period: str
) -> None:
    with service.database.connection() as db:
        db.execute(
            "insert into report_submissions (report_id, submission_id, period, submitted_at, "
            "entries, exits, peak_occupancy, unique_count, payload_json) "
            "values (?,?,?,?,?,?,?,?,?)",
            (
                report_id,
                submission_id,
                period,
                NOW.isoformat(),
                120,
                108,
                30,
                90,
                json.dumps({"status": "Submitted", "metrics": {"unique": 90}}),
            ),
        )
        db.execute(
            "insert into report_camera_totals values (?,?,?,?,?,?,?)",
            (report_id, 1, "Camera 1", 120, 108, 30, 90),
        )


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
