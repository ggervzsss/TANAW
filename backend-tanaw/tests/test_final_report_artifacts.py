from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.final_reports import artifact_service
from app.features.final_reports.artifact_rendering import (
    TEMPLATE_VERSION,
    ArtifactRenderSnapshot,
    render_final_report_pdf,
)
from app.features.final_reports.artifact_service import (
    FinalReportArtifactNotFound,
    FinalReportArtifactNotReady,
    FinalReportArtifactProcessor,
    FinalReportArtifactUnavailable,
    _load_artifact_graph,
    _storage_key,
    _version_hash_payload,
    download_final_report_artifact,
    read_final_report_artifact_metadata,
)
from app.features.final_reports.artifact_storage import (
    PDF_MIME_TYPE,
    ArtifactStorageConflict,
    ArtifactStorageError,
    ArtifactStorageIntegrityError,
    LocalArtifactStorage,
    StoredArtifact,
)
from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportDemographicFact,
    FinalReportEvent,
    FinalReportItem,
    FinalReportMetricFact,
    FinalReportScopeMember,
    FinalReportVersion,
    ReportFinalization,
)
from app.features.reporting.envelopes import canonical_payload_hash
from app.features.reporting.models import ReportingPeriod

NOW = datetime(2026, 7, 14, 5, 0, tzinfo=UTC)
STAFF_ID = "00000000-0000-4000-8000-000000000099"


@pytest.mark.asyncio
async def test_local_storage_is_bounded_idempotent_and_detects_corruption(
    tmp_path: Path,
) -> None:
    storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)
    content = _pdf(b"stable")
    stored = await storage.put(key="official/report.pdf", mime_type=PDF_MIME_TYPE, content=content)
    replayed = await storage.put(
        key="official/report.pdf", mime_type=PDF_MIME_TYPE, content=content
    )

    assert replayed == stored
    assert stored.content == content
    assert stored.size_bytes == len(content)
    assert stored.content_hash.startswith("sha256:")

    with pytest.raises(ArtifactStorageConflict):
        await storage.put(
            key="official/report.pdf",
            mime_type=PDF_MIME_TYPE,
            content=_pdf(b"different"),
        )
    with pytest.raises(ArtifactStorageError):
        await storage.put(key="../escape.pdf", mime_type=PDF_MIME_TYPE, content=content)
    with pytest.raises(ArtifactStorageIntegrityError):
        await storage.put(key="official/text.pdf", mime_type="text/plain", content=content)
    with pytest.raises(ArtifactStorageIntegrityError):
        await storage.put(
            key="official/oversize.pdf",
            mime_type=PDF_MIME_TYPE,
            content=_pdf(b"x" * (64 * 1024)),
        )

    (tmp_path / "official" / "report.pdf").write_bytes(_pdf(b"corrupt"))
    with pytest.raises(ArtifactStorageIntegrityError):
        await storage.read(key="official/report.pdf")


def test_renderer_is_byte_stable_and_preserves_unicode_as_reversible_escapes() -> None:
    snapshot = ArtifactRenderSnapshot(
        artifact_id="00000000-0000-4000-8000-000000000001",
        template_version=TEMPLATE_VERSION,
        report_code="FR-202607-O-00000001",
        version_content_hash=f"sha256:{'a' * 64}",
        document={"enterpriseName": "José's Inn — 北", "value": "1.250000"},
    )

    first = render_final_report_pdf(snapshot)
    second = render_final_report_pdf(snapshot)

    assert first == second
    assert first.startswith(b"%PDF-1.4")
    assert first.rstrip().endswith(b"%%EOF")
    assert b"Jos" in first
    assert b"\\\\u00e9" in first
    assert b"\\\\u5317" in first


@pytest.mark.asyncio
async def test_processor_retry_reuses_identical_bytes_and_reaches_ready(tmp_path: Path) -> None:
    graph_session, artifact = _graph_session()
    db = cast(AsyncSession, graph_session)
    settings = Settings(
        final_report_artifact_storage_root=tmp_path,
        final_report_artifact_max_bytes=64 * 1024,
        final_report_artifact_max_attempts=4,
    )
    durable_storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)
    uncertain_storage = _WriteThenFailStorage(durable_storage)
    sessions = cast(async_sessionmaker[AsyncSession], None)

    first_processor = FinalReportArtifactProcessor(
        sessions=sessions,
        storage=uncertain_storage,
        settings=settings,
    )
    first_graph = await _load_artifact_graph(db, artifact)
    key = _storage_key(first_graph)
    expected_bytes = render_final_report_pdf(first_graph.render_snapshot)
    await first_processor._generate_locked(db, artifact)

    assert artifact.status == "failed"
    assert artifact.generation_attempts == 1
    assert artifact.last_error_code == "ARTIFACT_STORAGE_UNAVAILABLE"
    assert (await durable_storage.read(key=key)).content == expected_bytes

    artifact.status = "pending"
    artifact.last_error_code = None
    second_processor = FinalReportArtifactProcessor(
        sessions=sessions,
        storage=durable_storage,
        settings=settings,
    )
    await second_processor._generate_locked(db, artifact)

    assert artifact.status == "ready"
    assert artifact.generation_attempts == 2
    assert artifact.content_hash == (await durable_storage.read(key=key)).content_hash
    assert artifact.generated_by_account_id == first_graph.version.prepared_by_account_id
    assert (await durable_storage.read(key=key)).content == expected_bytes
    regenerated_graph = await _load_artifact_graph(db, artifact)
    assert render_final_report_pdf(regenerated_graph.render_snapshot) == expected_bytes
    lifecycle_types = [
        value.event_type for value in graph_session.added if isinstance(value, FinalReportEvent)
    ]
    assert lifecycle_types == ["artifact_failed", "artifact_ready"]


@pytest.mark.asyncio
async def test_processor_terminally_rejects_a_version_hash_mismatch(tmp_path: Path) -> None:
    graph_session, artifact = _graph_session()
    graph_session.version.content_hash = f"sha256:{'f' * 64}"
    settings = Settings(
        final_report_artifact_storage_root=tmp_path,
        final_report_artifact_max_bytes=64 * 1024,
        final_report_artifact_max_attempts=4,
    )
    processor = FinalReportArtifactProcessor(
        sessions=cast(async_sessionmaker[AsyncSession], None),
        storage=LocalArtifactStorage(tmp_path, max_bytes=64 * 1024),
        settings=settings,
    )

    await processor._generate_locked(cast(AsyncSession, graph_session), artifact)

    assert artifact.status == "failed"
    assert artifact.last_error_code == "ARTIFACT_VERSION_HASH_MISMATCH"
    assert artifact.generation_attempts == settings.final_report_artifact_max_attempts
    assert not list(tmp_path.rglob("*.pdf"))


@pytest.mark.asyncio
async def test_pending_artifact_is_not_downloadable(tmp_path: Path) -> None:
    graph_session, artifact = _graph_session()
    storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)

    with pytest.raises(FinalReportArtifactNotReady):
        await download_final_report_artifact(
            cast(AsyncSession, graph_session),
            storage=storage,
            account=_account(AccountRole.STAFF),
            report_finalization_id=graph_session.finalization.id,
            artifact_id=artifact.id,
            evaluated_at=NOW,
        )


@pytest.mark.asyncio
async def test_download_rehashes_bytes_and_never_exposes_storage_key(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    graph_session, artifact = _graph_session()
    db = cast(AsyncSession, graph_session)
    settings = Settings(
        final_report_artifact_storage_root=tmp_path,
        final_report_artifact_max_bytes=64 * 1024,
    )
    storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)
    processor = FinalReportArtifactProcessor(
        sessions=cast(async_sessionmaker[AsyncSession], None),
        storage=storage,
        settings=settings,
    )
    await processor._generate_locked(db, artifact)
    artifact.created_at = NOW
    artifact.updated_at = NOW
    staff = _account(AccountRole.STAFF)

    metadata = await read_final_report_artifact_metadata(
        db,
        storage=storage,
        account=staff,
        report_finalization_id=graph_session.finalization.id,
        artifact_id=artifact.id,
        evaluated_at=NOW,
    )
    download = await download_final_report_artifact(
        db,
        storage=storage,
        account=staff,
        report_finalization_id=graph_session.finalization.id,
        artifact_id=artifact.id,
        evaluated_at=NOW,
    )

    assert metadata.downloadAvailable is True
    assert metadata.sizeBytes == len(download.content)
    assert "storage" not in str(metadata.model_dump()).lower()
    assert download.content_hash == artifact.content_hash

    assert artifact.storage_key is not None
    (tmp_path / artifact.storage_key).write_bytes(_pdf(b"tampered"))
    with caplog.at_level(logging.ERROR, logger="uvicorn.error"):
        with pytest.raises(
            FinalReportArtifactUnavailable,
            match="failed integrity verification",
        ):
            await download_final_report_artifact(
                db,
                storage=storage,
                account=staff,
                report_finalization_id=graph_session.finalization.id,
                artifact_id=artifact.id,
                evaluated_at=NOW,
            )
    assert artifact.id in caplog.text
    assert artifact.status == "repairing"
    assert artifact.storage_key is None
    assert artifact.content_hash is None
    assert artifact.last_error_code == "ARTIFACT_INTEGRITY_REPAIR_QUEUED"
    assert graph_session.commits == 1
    assert any(
        isinstance(value, FinalReportEvent)
        and value.event_type == "artifact_repair_requested"
        and value.final_report_artifact_id == artifact.id
        for value in graph_session.added
    )


@pytest.mark.asyncio
async def test_enterprise_access_is_bound_to_effective_frozen_version_scope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph_session, artifact = _graph_session()
    db = cast(AsyncSession, graph_session)
    settings = Settings(
        final_report_artifact_storage_root=tmp_path,
        final_report_artifact_max_bytes=64 * 1024,
    )
    storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)
    processor = FinalReportArtifactProcessor(
        sessions=cast(async_sessionmaker[AsyncSession], None),
        storage=storage,
        settings=settings,
    )
    await processor._generate_locked(db, artifact)
    artifact.created_at = NOW
    artifact.updated_at = NOW
    enterprise = _account(AccountRole.ENTERPRISE)

    async def effective_scope(*args: object, **kwargs: object) -> SimpleNamespace:
        del args, kwargs
        return SimpleNamespace(classification="official", enterprise_id="enterprise-1")

    monkeypatch.setattr(artifact_service, "require_effective_enterprise_access", effective_scope)
    detail = await read_final_report_artifact_metadata(
        db,
        storage=storage,
        account=enterprise,
        report_finalization_id=graph_session.finalization.id,
        artifact_id=artifact.id,
        evaluated_at=NOW,
    )
    assert detail.downloadAvailable is True

    graph_session.enterprise_member_visible = False
    with pytest.raises(FinalReportArtifactNotFound):
        await read_final_report_artifact_metadata(
            db,
            storage=storage,
            account=enterprise,
            report_finalization_id=graph_session.finalization.id,
            artifact_id=artifact.id,
            evaluated_at=NOW,
        )


class _WriteThenFailStorage:
    def __init__(self, storage: LocalArtifactStorage) -> None:
        self._storage = storage
        self._failed = False

    async def put(self, *, key: str, mime_type: str, content: bytes) -> StoredArtifact:
        stored = await self._storage.put(key=key, mime_type=mime_type, content=content)
        if not self._failed:
            self._failed = True
            raise ArtifactStorageError("simulated uncertain write")
        return stored

    async def read(self, *, key: str) -> StoredArtifact:
        return await self._storage.read(key=key)


class _GraphSession:
    def __init__(
        self,
        *,
        artifact: FinalReportArtifact,
        version: FinalReportVersion,
        finalization: ReportFinalization,
        period: ReportingPeriod,
        members: list[FinalReportScopeMember],
        items: list[FinalReportItem],
        metrics: list[FinalReportMetricFact],
        demographics: list[FinalReportDemographicFact],
        events: list[FinalReportEvent],
    ) -> None:
        self.artifact = artifact
        self.version = version
        self.finalization = finalization
        self.enterprise_member_visible = True
        self._objects: dict[tuple[type[object], str], object] = {
            (FinalReportVersion, version.id): version,
            (ReportFinalization, finalization.id): finalization,
            (ReportingPeriod, period.id): period,
        }
        self._collections: dict[type[object], list[object]] = {
            FinalReportScopeMember: cast(list[object], members),
            FinalReportItem: cast(list[object], items),
            FinalReportMetricFact: cast(list[object], metrics),
            FinalReportDemographicFact: cast(list[object], demographics),
            FinalReportEvent: cast(list[object], events),
        }
        self.added: list[object] = []
        self.commits = 0

    def add(self, value: object) -> None:
        self.added.append(value)

    async def flush(self, _values: object | None = None) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def get(self, entity: type[object], identity: str) -> object | None:
        return self._objects.get((entity, identity))

    async def scalars(self, statement: Any) -> list[object]:
        entity = statement.column_descriptions[0].get("entity")
        return self._collections.get(entity, [])

    async def scalar(self, statement: Any) -> object | None:
        entity = statement.column_descriptions[0].get("entity")
        if entity is FinalReportArtifact:
            return self.artifact
        if entity is FinalReportScopeMember and self.enterprise_member_visible:
            return "scope-member-1"
        return None


def _graph_session() -> tuple[_GraphSession, FinalReportArtifact]:
    finalization_id = "00000000-0000-4000-8000-000000000010"
    version_id = "00000000-0000-4000-8000-000000000011"
    period_id = "00000000-0000-4000-8000-000000000012"
    artifact = FinalReportArtifact(
        id="00000000-0000-4000-8000-000000000013",
        final_report_version_id=version_id,
        classification="official",
        status="pending",
        template_version=TEMPLATE_VERSION,
        mime_type=PDF_MIME_TYPE,
        generation_attempts=0,
    )
    version = FinalReportVersion(
        id=version_id,
        report_finalization_id=finalization_id,
        classification="official",
        version_number=1,
        disposition="current",
        scope_type="enterprise_selection",
        scope_barangay=None,
        scope_label="Selected enterprises (1)",
        source_count=1,
        scope_member_count=1,
        content_hash=f"sha256:{'0' * 64}",
        prepared_by_account_id=STAFF_ID,
        prepared_by_name="María Santos",
        prepared_by_role="staff",
        finalized_at=NOW,
    )
    finalization = ReportFinalization(
        id=finalization_id,
        reporting_period_id=period_id,
        classification="official",
        report_code="FR-202607-O-00000001",
        current_version_id=version_id,
        logical_version=1,
        created_by_account_id=STAFF_ID,
    )
    period = ReportingPeriod(
        id=period_id,
        natural_key="2026-07",
        cadence="month",
        timezone_name="Asia/Manila",
        local_start_date=date(2026, 7, 1),
        local_end_date=date(2026, 8, 1),
        starts_at=NOW - timedelta(days=13),
        ends_at=NOW,
        submission_opens_at=NOW,
        submission_closes_at=NOW + timedelta(days=7),
        status="closed",
        label="July 2026",
    )
    member = FinalReportScopeMember(
        id="00000000-0000-4000-8000-000000000014",
        final_report_version_id=version_id,
        report_finalization_id=finalization_id,
        reporting_obligation_id="00000000-0000-4000-8000-000000000015",
        enterprise_id="enterprise-1",
        site_id="00000000-0000-4000-8000-000000000016",
        classification="official",
        enterprise_official_code="ENT-001",
        enterprise_name="José's Inn",
        enterprise_category="Accommodation",
        site_code="SITE-001",
        site_name="Main Site",
        frozen_barangay="Poblacion",
    )
    item = FinalReportItem(
        id="00000000-0000-4000-8000-000000000017",
        final_report_version_id=version_id,
        report_finalization_id=finalization_id,
        reporting_obligation_id=member.reporting_obligation_id,
        report_revision_id="00000000-0000-4000-8000-000000000018",
        classification="official",
        source_payload_hash=f"sha256:{'1' * 64}",
    )
    metric = FinalReportMetricFact(
        id="00000000-0000-4000-8000-000000000019",
        final_report_version_id=version_id,
        classification="official",
        definition="entries",
        definition_version=1,
        value=Decimal("12.500000"),
        unit="persons",
        aggregation_method="sum",
        quality="confirmed",
        source_fact_count=1,
    )
    demographic = FinalReportDemographicFact(
        id="00000000-0000-4000-8000-000000000020",
        final_report_version_id=version_id,
        classification="official",
        dimension="visitor_type",
        value="local",
        count=10,
        percentage=Decimal("100.0000"),
        quality="confirmed",
        source_fact_count=1,
    )
    event = FinalReportEvent(
        id="00000000-0000-4000-8000-000000000021",
        report_finalization_id=finalization_id,
        final_report_version_id=version_id,
        classification="official",
        event_type="version_finalized",
        actor_account_id=STAFF_ID,
        actor_display_name="María Santos",
        actor_role="staff",
        command_id="00000000-0000-4000-8000-000000000022",
        expected_version=0,
        resulting_version=1,
        reason=None,
        occurred_at=NOW,
    )
    version.content_hash = canonical_payload_hash(
        _version_hash_payload(
            period_id=period.id,
            version=version,
            members=[member],
            items=[item],
            metrics=[metric],
            demographics=[demographic],
        )
    )
    session = _GraphSession(
        artifact=artifact,
        version=version,
        finalization=finalization,
        period=period,
        members=[member],
        items=[item],
        metrics=[metric],
        demographics=[demographic],
        events=[event],
    )
    return session, artifact


def _account(role: AccountRole) -> Account:
    return Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.test",
        password_hash="unused",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
        activated_at=NOW,
    )


def _pdf(body: bytes) -> bytes:
    return b"%PDF-1.4\n" + body + b"\n%%EOF\n"
