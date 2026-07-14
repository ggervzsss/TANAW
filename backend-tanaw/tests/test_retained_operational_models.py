from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import (
    Account,
    AccountRole,
    AccountStatus,
    Base,
    EmailOutbox,
    OperationalAlert,
    SupportTicket,
    UserNotification,
)


@pytest.fixture
def account_id() -> Iterator[tuple[str, Engine]]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    identifier = str(uuid4())
    with Session(engine) as session:
        session.add(
            Account(
                id=identifier,
                email="retained-models@example.test",
                password_hash="not-used",
                role=AccountRole.IT,
                display_name="Retained Models Test",
                title="IT Personnel",
                status=AccountStatus.ACTIVE,
            )
        )
        session.commit()
    yield identifier, engine
    engine.dispose()


def test_operational_alert_rejects_unknown_lifecycle_values(
    account_id: tuple[str, Engine],
) -> None:
    _identifier, engine = account_id
    with Session(engine) as session:
        session.add(
            OperationalAlert(
                alert_code="ALT-CONSTRAINT-1",
                alert_type="Maintenance Request",
                severity="Unbounded",
                requester="Constraint Test",
                summary="Invalid severity must be rejected.",
                required_action="None",
                resolution_mode="Remote Review",
                status="New",
                owner="IT",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_notification_rejects_role_scope_and_severity_mismatches(
    account_id: tuple[str, Engine],
) -> None:
    identifier, engine = account_id
    with Session(engine) as session:
        session.add(
            UserNotification(
                recipient_account_id=identifier,
                recipient_role="it",
                recipient_enterprise_id=str(uuid4()),
                title="Invalid scope",
                message="Non-enterprise recipients cannot claim enterprise scope.",
                notification_type="Constraint Test",
                severity="Info",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_support_ticket_rejects_unknown_priority(account_id: tuple[str, Engine]) -> None:
    identifier, engine = account_id
    with Session(engine) as session:
        session.add(
            SupportTicket(
                ticket_code="TCK-CONSTRAINT-1",
                enterprise_account_id=identifier,
                enterprise_id="ENT-CONSTRAINT",
                enterprise_name="Constraint Enterprise",
                category="Other",
                priority="Immediate",
                subject="Invalid priority",
                description="Unknown priority values must be rejected.",
                status="Open",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_email_outbox_rejects_unknown_status(account_id: tuple[str, Engine]) -> None:
    identifier, engine = account_id
    with Session(engine) as session:
        session.add(
            EmailOutbox(
                account_id=identifier,
                purpose="constraint-test",
                source_id="constraint-source",
                recipient="recipient@example.test",
                sender="TANAW <sender@example.test>",
                template_name="support_reply",
                template_version="v1",
                secret_version="v1",
                template_payload_json="{}",
                idempotency_key=f"constraint:{uuid4()}",
                provider="local",
                status="unknown",
                attempt_count=0,
                max_attempts=5,
                next_attempt_at=datetime.now(UTC),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
