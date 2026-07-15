from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import (
    Base,
    DeviceTelemetryEpoch,
    DomainEvent,
    DomainEventConsumerReceipt,
    DomainEventDelivery,
    DomainEventDeliveryAttempt,
    EdgeDevice,
    Enterprise,
    EnterpriseSite,
    SiteLiveState,
    SiteTelemetryHourlyRollup,
    TelemetryMetricFact,
    TelemetryObservation,
)

_HASH = f"sha256:{'a' * 64}"


@pytest.fixture
def sqlite_engine() -> Engine:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return engine


def test_telemetry_and_event_schema_uses_native_uuid_and_creates_on_sqlite(
    sqlite_engine: Engine,
) -> None:
    dialect = postgresql.dialect()
    assert DeviceTelemetryEpoch.__table__.c.id.type.compile(dialect=dialect) == "UUID"
    assert TelemetryObservation.__table__.c.enterprise_id.type.compile(dialect=dialect) == "UUID"
    assert DomainEvent.__table__.c.aggregate_id.type.compile(dialect=dialect) == "UUID"
    assert {
        "device_telemetry_epochs",
        "telemetry_observations",
        "telemetry_metric_facts",
        "device_health_samples",
        "site_live_state",
        "site_telemetry_hourly_rollups",
        "site_telemetry_rollup_partitions",
        "domain_events",
        "domain_event_deliveries",
        "domain_event_delivery_attempts",
        "domain_event_consumer_receipts",
    }.issubset(Base.metadata.tables)
    assert "telemetry_migration_exceptions" not in Base.metadata.tables
    assert SiteTelemetryHourlyRollup.__table__.c.bucket_start.primary_key is True


def test_sequenced_observation_can_project_valid_live_state(sqlite_engine: Engine) -> None:
    graph = _sequenced_graph(sqlite_engine)

    with Session(sqlite_engine) as session:
        state = session.get(SiteLiveState, graph["site_id"])
        assert state is not None
        assert (state.epoch_generation, state.sequence) == (1, 10)
        assert state.telemetry_observation_id == graph["observation_id"]
        assert state.metric_provenance == "camera_derived"


def test_unsequenced_or_unknown_metrics_cannot_become_current(sqlite_engine: Engine) -> None:
    graph = _sequenced_graph(sqlite_engine)
    now = datetime(2026, 7, 13, 4, tzinfo=UTC)

    with Session(sqlite_engine) as session:
        session.add(
            TelemetryObservation(
                enterprise_id=graph["enterprise_id"],
                site_id=graph["site_id"],
                edge_device_id=graph["device_id"],
                classification="official",
                ingest_kind="migration",
                ordering_status="unsequenced_import",
                payload_hash=_HASH,
                observed_at=now,
                received_at=now,
                became_current=True,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        observation = TelemetryObservation(
            id=str(uuid4()),
            enterprise_id=graph["enterprise_id"],
            site_id=graph["site_id"],
            edge_device_id=graph["device_id"],
            classification="official",
            ingest_kind="migration",
            ordering_status="unsequenced_import",
            payload_hash=_HASH,
            observed_at=now,
            received_at=now,
            became_current=False,
        )
        session.add(observation)
        session.flush()
        session.add(
            TelemetryMetricFact(
                telemetry_observation_id=observation.id,
                enterprise_id=graph["enterprise_id"],
                site_id=graph["site_id"],
                classification="official",
                fact_status="qualified",
                definition="occupancy_current",
                definition_version=1,
                value=Decimal(1),
                unit="people",
                grain="site",
                metric_window_start=now - timedelta(seconds=30),
                metric_window_end=now,
                timezone_name="Asia/Manila",
                provenance="camera_derived",
                quality="unknown",
                coverage_evidence_status="not_recorded",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_stale_live_state_cannot_retain_live_metrics(sqlite_engine: Engine) -> None:
    graph = _sequenced_graph(sqlite_engine)

    with Session(sqlite_engine) as session:
        state = session.get(SiteLiveState, graph["site_id"])
        assert state is not None
        state.freshness_state = "stale"
        with pytest.raises(IntegrityError):
            session.commit()


def test_domain_event_delivery_attempts_and_consumer_receipts_are_durable(
    sqlite_engine: Engine,
) -> None:
    enterprise_id, site_id, _device_id = _topology(sqlite_engine)
    now = datetime(2026, 7, 13, 4, tzinfo=UTC)

    with Session(sqlite_engine, expire_on_commit=False) as session:
        domain_event = DomainEvent(
            event_key="report:accepted:1",
            event_type="report.accepted",
            contract_version=2,
            schema_version=1,
            aggregate_type="enterprise_report",
            aggregate_id=str(uuid4()),
            aggregate_version=1,
            enterprise_id=enterprise_id,
            site_id=site_id,
            classification="official",
            payload_json='{"reportId":"1"}',
            payload_hash=_HASH,
            occurred_at=now,
            available_at=now,
        )
        session.add(domain_event)
        session.commit()
        delivery = DomainEventDelivery(
            domain_event_id=domain_event.id,
            destination="notification_projection",
            status="pending",
            attempt_count=0,
            next_attempt_at=now,
        )
        session.add(delivery)
        session.commit()
        session.add_all(
            [
                DomainEventDeliveryAttempt(
                    domain_event_id=domain_event.id,
                    domain_event_delivery_id=delivery.id,
                    attempt_number=1,
                    worker_id="projection-worker",
                    outcome="succeeded",
                    started_at=now,
                    completed_at=now,
                ),
                DomainEventConsumerReceipt(
                    domain_event_id=domain_event.id,
                    consumer_name="notification_projection",
                    disposition="applied",
                    event_payload_hash=_HASH,
                    consumed_at=now,
                ),
            ]
        )
        session.commit()

        session.add(
            DomainEventConsumerReceipt(
                domain_event_id=domain_event.id,
                consumer_name="notification_projection",
                disposition="already_applied",
                event_payload_hash=_HASH,
                consumed_at=now,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def _sequenced_graph(engine: Engine) -> dict[str, str]:
    enterprise_id, site_id, device_id = _topology(engine)
    now = datetime(2026, 7, 13, 4, tzinfo=UTC)
    with Session(engine, expire_on_commit=False) as session:
        epoch = DeviceTelemetryEpoch(
            edge_device_id=device_id,
            site_id=site_id,
            classification="official",
            counter_epoch=str(uuid4()),
            generation=1,
            command_id=str(uuid4()),
            idempotency_key=f"epoch:{device_id}:1",
            payload_hash=_HASH,
            status="active",
            registered_at=now,
        )
        session.add(epoch)
        session.commit()
        observation = TelemetryObservation(
            enterprise_id=enterprise_id,
            site_id=site_id,
            edge_device_id=device_id,
            classification="official",
            ingest_kind="command",
            ordering_status="sequenced",
            telemetry_epoch_id=epoch.id,
            epoch_generation=1,
            sequence=10,
            command_id=str(uuid4()),
            idempotency_key=f"telemetry:{device_id}:1:10",
            payload_hash=_HASH,
            observed_at=now,
            received_at=now,
            became_current=True,
        )
        session.add(observation)
        session.commit()
        session.add(
            TelemetryMetricFact(
                telemetry_observation_id=observation.id,
                enterprise_id=enterprise_id,
                site_id=site_id,
                classification="official",
                fact_status="qualified",
                definition="occupancy_current",
                definition_version=1,
                value=Decimal(5),
                unit="people",
                grain="site",
                metric_window_start=now - timedelta(seconds=60),
                metric_window_end=now,
                timezone_name="Asia/Manila",
                provenance="camera_derived",
                quality="confirmed",
                coverage_evidence_status="recorded",
                monitored_seconds=55,
                expected_seconds=60,
                coverage_gap_count=1,
            )
        )
        session.commit()
        session.add(
            SiteLiveState(
                site_id=site_id,
                enterprise_id=enterprise_id,
                edge_device_id=device_id,
                classification="official",
                telemetry_epoch_id=epoch.id,
                telemetry_observation_id=observation.id,
                epoch_generation=1,
                sequence=10,
                live_state_version=1,
                observed_at=now,
                received_at=now,
                freshness_expires_at=now + timedelta(minutes=1),
                offline_after_at=now + timedelta(minutes=5),
                last_freshness_evaluated_at=now,
                freshness_state="fresh",
                current_occupancy=5,
                entries_window=12,
                exits_window=7,
                peak_occupancy_window=8,
                unique_visitor_estimate_window=11,
                metric_quality="confirmed",
                metric_provenance="camera_derived",
                coverage_evidence_status="recorded",
                monitored_seconds=55,
                expected_seconds=60,
                coverage_gap_count=1,
                service_state="healthy",
                pending_count=0,
            )
        )
        session.commit()
        return {
            "enterprise_id": enterprise_id,
            "site_id": site_id,
            "device_id": device_id,
            "epoch_id": epoch.id,
            "observation_id": observation.id,
        }


def _topology(engine: Engine) -> tuple[str, str, str]:
    with Session(engine, expire_on_commit=False) as session:
        enterprise = Enterprise(
            official_code=f"ENT-{uuid4().hex[:12]}",
            name="Telemetry enterprise",
            classification="official",
            lifecycle_state="active",
        )
        session.add(enterprise)
        session.commit()
        site = EnterpriseSite(
            enterprise_id=enterprise.id,
            classification="official",
            site_code="primary",
            name="Primary site",
        )
        session.add(site)
        session.commit()
        device = EdgeDevice(
            site_id=site.id,
            classification="official",
            device_key=f"GW-{uuid4().hex[:12]}",
            display_name="Telemetry gateway",
        )
        session.add(device)
        session.commit()
        return enterprise.id, site.id, device.id
