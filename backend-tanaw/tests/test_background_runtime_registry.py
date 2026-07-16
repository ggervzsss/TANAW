from app.main import BACKGROUND_RUNTIMES


def test_background_runtimes_are_registered() -> None:
    assert {runtime.name for runtime in BACKGROUND_RUNTIMES} == {
        "domain_event_delivery_and_realtime_subscription",
        "email_outbox",
        "final_report_artifacts",
        "reporting_period_lifecycle",
        "retention_cleanup",
    }
    assert [runtime.start.__name__ for runtime in BACKGROUND_RUNTIMES] == [
        "start_email_outbox_worker",
        "start_final_report_artifact_worker",
        "start_retention_cleanup_worker",
        "start_reporting_period_lifecycle_worker",
        "start_domain_event_delivery_worker",
    ]
