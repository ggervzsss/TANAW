import importlib.util
import inspect
from pathlib import Path

from app.features.activity_logs.service import create_activity_log
from app.features.alerts.service import create_operational_alert
from app.features.notifications.service import (
    create_role_notifications,
    create_user_notification,
    set_user_notification_read,
)


def test_cross_domain_mutation_services_do_not_commit_caller_transactions() -> None:
    for mutation in (
        create_activity_log,
        create_operational_alert,
        create_role_notifications,
        create_user_notification,
        set_user_notification_read,
    ):
        assert ".commit(" not in inspect.getsource(mutation)


def test_mixed_operational_feature_package_is_physically_absent() -> None:
    backend_root = Path(__file__).resolve().parents[1]

    assert not (backend_root / "app" / "features" / "operational").exists()
    assert importlib.util.find_spec("app.features.operational") is None
