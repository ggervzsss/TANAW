"""Add immutable scoped final reports and migrate only exact legacy lineage.

Revision ID: 20260713_0024
Revises: 20260713_0023

``report_finalizations`` is the permanent target logical parent.  The legacy
``final_reports`` and ``final_report_sources`` tables remain temporarily only
because their API consumers have not yet cut over; they are migration inputs,
not fallback or backup stores.  Rows whose exact source revision, period,
classification, or totals cannot be proven are recorded as blocking reporting
migration exceptions and are never guessed into the target graph.
"""

import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid5

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260713_0024"
down_revision: str | Sequence[str] | None = "20260713_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FINAL_NAMESPACE = UUID("5e87e6cc-d6b5-4e59-a5cc-c18207663df4")


def upgrade() -> None:
    _create_final_report_schema()
    _backfill_exact_legacy_finalizations(op.get_bind())
    _create_final_report_guards()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0024 is intentionally irreversible because immutable final "
        "versions, source claims, and migration exceptions are durable evidence. Restore "
        "the verified pre-cutover backup and matching application build instead."
    )


def _create_final_report_schema() -> None:
    statements = (
        "CREATE SEQUENCE report_finalization_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE",
        """
        CREATE TABLE report_finalizations (
            id UUID PRIMARY KEY,
            reporting_period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE RESTRICT,
            classification VARCHAR(20) NOT NULL,
            report_code VARCHAR(80) NOT NULL,
            current_version_id UUID NOT NULL,
            logical_version INTEGER NOT NULL DEFAULT 1,
            created_by_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_report_finalizations_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_finalizations_logical_version CHECK (logical_version >= 1),
            CONSTRAINT uq_report_finalizations_report_code UNIQUE (report_code),
            CONSTRAINT uq_report_finalizations_id_classification UNIQUE (id, classification)
        )
        """,
        """
        CREATE TABLE final_report_versions (
            id UUID PRIMARY KEY,
            report_finalization_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            version_number INTEGER NOT NULL,
            disposition VARCHAR(20) NOT NULL DEFAULT 'current',
            scope_type VARCHAR(30) NOT NULL,
            scope_barangay VARCHAR(120),
            scope_label VARCHAR(200) NOT NULL,
            source_count INTEGER NOT NULL,
            scope_member_count INTEGER NOT NULL,
            content_hash VARCHAR(71) NOT NULL,
            prepared_by_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            prepared_by_name VARCHAR(120) NOT NULL,
            prepared_by_role VARCHAR(120) NOT NULL,
            finalized_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_versions_finalization_classification
                FOREIGN KEY (report_finalization_id, classification)
                REFERENCES report_finalizations(id, classification)
                ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
            CONSTRAINT ck_final_report_versions_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_versions_number CHECK (version_number >= 1),
            CONSTRAINT ck_final_report_versions_scope_type CHECK (
                scope_type IN ('citywide', 'barangay', 'enterprise_selection')
            ),
            CONSTRAINT ck_final_report_versions_barangay_scope CHECK (
                (scope_type = 'barangay' AND scope_barangay IS NOT NULL AND
                 length(trim(scope_barangay)) > 0) OR
                (scope_type != 'barangay' AND scope_barangay IS NULL)
            ),
            CONSTRAINT ck_final_report_versions_label CHECK (length(trim(scope_label)) > 0),
            CONSTRAINT ck_final_report_versions_content_hash CHECK (
                length(content_hash) = 71 AND content_hash LIKE 'sha256:%'
            ),
            CONSTRAINT ck_final_report_versions_disposition CHECK (
                disposition IN ('current', 'superseded')
            ),
            CONSTRAINT ck_final_report_versions_counts CHECK (
                source_count > 0 AND scope_member_count > 0 AND
                source_count = scope_member_count
            ),
            CONSTRAINT uq_final_report_versions_finalization_number UNIQUE (
                report_finalization_id, version_number
            ),
            CONSTRAINT uq_final_report_versions_identity_scope UNIQUE (
                id, report_finalization_id, classification
            ),
            CONSTRAINT uq_final_report_versions_id_classification UNIQUE (id, classification)
        )
        """,
        """
        ALTER TABLE report_finalizations
        ADD CONSTRAINT fk_report_finalizations_current_version_scope
        FOREIGN KEY (current_version_id, id, classification)
        REFERENCES final_report_versions(id, report_finalization_id, classification)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        """,
        """
        CREATE TABLE final_report_source_claims (
            id UUID PRIMARY KEY,
            report_finalization_id UUID NOT NULL,
            report_revision_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            claimed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_source_claims_finalization_classification
                FOREIGN KEY (report_finalization_id, classification)
                REFERENCES report_finalizations(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_source_claims_revision_classification
                FOREIGN KEY (report_revision_id, classification)
                REFERENCES report_revisions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_source_claims_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT uq_final_report_source_claims_revision UNIQUE (report_revision_id),
            CONSTRAINT uq_final_report_source_claims_revision_owner UNIQUE (
                report_revision_id, report_finalization_id, classification
            )
        )
        """,
        """
        CREATE TABLE final_report_scope_members (
            id UUID PRIMARY KEY,
            final_report_version_id UUID NOT NULL,
            report_finalization_id UUID NOT NULL,
            reporting_obligation_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            frozen_barangay VARCHAR(120),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_scope_members_version_scope
                FOREIGN KEY (
                    final_report_version_id, report_finalization_id, classification
                ) REFERENCES final_report_versions(
                    id, report_finalization_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_scope_members_obligation_scope
                FOREIGN KEY (
                    reporting_obligation_id, enterprise_id, site_id, classification
                ) REFERENCES reporting_obligations(
                    id, enterprise_id, site_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_scope_members_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT uq_final_report_scope_members_obligation UNIQUE (
                final_report_version_id, reporting_obligation_id
            ),
            CONSTRAINT uq_final_report_scope_members_item_scope UNIQUE (
                final_report_version_id, reporting_obligation_id, classification
            )
        )
        """,
        """
        CREATE TABLE final_report_items (
            id UUID PRIMARY KEY,
            final_report_version_id UUID NOT NULL,
            report_finalization_id UUID NOT NULL,
            reporting_obligation_id UUID NOT NULL,
            report_revision_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            source_payload_hash VARCHAR(71) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_items_version_scope
                FOREIGN KEY (
                    final_report_version_id, report_finalization_id, classification
                ) REFERENCES final_report_versions(
                    id, report_finalization_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_items_scope_member
                FOREIGN KEY (
                    final_report_version_id, reporting_obligation_id, classification
                ) REFERENCES final_report_scope_members(
                    final_report_version_id, reporting_obligation_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_items_source_claim
                FOREIGN KEY (
                    report_revision_id, report_finalization_id, classification
                ) REFERENCES final_report_source_claims(
                    report_revision_id, report_finalization_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_items_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_items_payload_hash CHECK (
                length(source_payload_hash) = 71 AND source_payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT uq_final_report_items_revision UNIQUE (
                final_report_version_id, report_revision_id
            ),
            CONSTRAINT uq_final_report_items_obligation UNIQUE (
                final_report_version_id, reporting_obligation_id
            )
        )
        """,
        """
        CREATE TABLE final_report_metric_facts (
            id UUID PRIMARY KEY,
            final_report_version_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            definition VARCHAR(120) NOT NULL,
            definition_version INTEGER NOT NULL,
            value NUMERIC(20, 6),
            unit VARCHAR(60) NOT NULL,
            aggregation_method VARCHAR(40) NOT NULL,
            quality VARCHAR(20) NOT NULL,
            source_fact_count INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_metric_facts_version_classification
                FOREIGN KEY (final_report_version_id, classification)
                REFERENCES final_report_versions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_metric_facts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_metric_facts_version CHECK (definition_version >= 1),
            CONSTRAINT ck_final_report_metric_facts_aggregation CHECK (
                aggregation_method IN ('sum', 'maximum', 'summed_site_estimate')
            ),
            CONSTRAINT ck_final_report_metric_facts_quality CHECK (
                quality IN ('confirmed', 'degraded', 'estimated', 'unknown')
            ),
            CONSTRAINT ck_final_report_metric_facts_quality_value CHECK (
                (quality = 'unknown' AND value IS NULL) OR
                (quality != 'unknown' AND value IS NOT NULL)
            ),
            CONSTRAINT ck_final_report_metric_facts_value CHECK (
                value IS NULL OR value >= 0
            ),
            CONSTRAINT ck_final_report_metric_facts_source_count CHECK (
                source_fact_count > 0
            ),
            CONSTRAINT uq_final_report_metric_facts_definition UNIQUE (
                final_report_version_id, definition, definition_version, unit
            )
        )
        """,
        """
        CREATE TABLE final_report_demographic_facts (
            id UUID PRIMARY KEY,
            final_report_version_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            dimension VARCHAR(80) NOT NULL,
            value VARCHAR(120) NOT NULL,
            count INTEGER NOT NULL,
            percentage NUMERIC(7, 4),
            quality VARCHAR(20) NOT NULL,
            source_fact_count INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_demographic_facts_version_classification
                FOREIGN KEY (final_report_version_id, classification)
                REFERENCES final_report_versions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_demographic_facts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_demographic_facts_count CHECK (count >= 0),
            CONSTRAINT ck_final_report_demographic_facts_percentage CHECK (
                percentage IS NULL OR (percentage >= 0 AND percentage <= 100)
            ),
            CONSTRAINT ck_final_report_demographic_facts_quality CHECK (
                quality IN ('confirmed', 'degraded', 'estimated')
            ),
            CONSTRAINT ck_final_report_demographic_facts_source_count CHECK (
                source_fact_count > 0
            ),
            CONSTRAINT uq_final_report_demographic_facts_dimension_value UNIQUE (
                final_report_version_id, dimension, value
            )
        )
        """,
        """
        CREATE TABLE final_report_events (
            id UUID PRIMARY KEY,
            report_finalization_id UUID NOT NULL,
            final_report_version_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            event_type VARCHAR(40) NOT NULL,
            actor_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            actor_role VARCHAR(40),
            command_id UUID,
            expected_version INTEGER NOT NULL,
            resulting_version INTEGER NOT NULL,
            reason TEXT,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_events_finalization_classification
                FOREIGN KEY (report_finalization_id, classification)
                REFERENCES report_finalizations(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_events_version_scope
                FOREIGN KEY (
                    final_report_version_id, report_finalization_id, classification
                ) REFERENCES final_report_versions(
                    id, report_finalization_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_events_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_events_type CHECK (
                event_type IN ('version_finalized', 'legacy_final_imported')
            ),
            CONSTRAINT ck_final_report_events_versions CHECK (
                expected_version >= 0 AND resulting_version > expected_version
            ),
            CONSTRAINT uq_final_report_events_command_id UNIQUE (command_id)
        )
        """,
        """
        CREATE TABLE final_report_artifacts (
            id UUID PRIMARY KEY,
            final_report_version_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            template_version VARCHAR(80) NOT NULL,
            mime_type VARCHAR(120) NOT NULL,
            storage_key VARCHAR(500),
            content_hash VARCHAR(71),
            generation_attempts INTEGER NOT NULL DEFAULT 0,
            last_error_code VARCHAR(120),
            generated_at TIMESTAMP WITH TIME ZONE,
            generated_by_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_artifacts_version_classification
                FOREIGN KEY (final_report_version_id, classification)
                REFERENCES final_report_versions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_artifacts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_artifacts_status CHECK (
                status IN ('pending', 'ready', 'failed')
            ),
            CONSTRAINT ck_final_report_artifacts_attempts CHECK (generation_attempts >= 0),
            CONSTRAINT ck_final_report_artifacts_ready_metadata CHECK (
                (status = 'ready' AND storage_key IS NOT NULL AND content_hash IS NOT NULL AND
                 generated_at IS NOT NULL AND generated_by_account_id IS NOT NULL) OR
                (status != 'ready' AND generated_at IS NULL)
            ),
            CONSTRAINT ck_final_report_artifacts_content_hash CHECK (
                content_hash IS NULL OR
                (length(content_hash) = 71 AND content_hash LIKE 'sha256:%')
            ),
            CONSTRAINT uq_final_report_artifacts_rendering UNIQUE (
                final_report_version_id, template_version, mime_type
            )
        )
        """,
        """
        CREATE TABLE final_report_command_receipts (
            id UUID PRIMARY KEY,
            report_finalization_id UUID NOT NULL,
            final_report_version_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            contract_version INTEGER NOT NULL DEFAULT 2,
            command_id UUID NOT NULL,
            idempotency_key VARCHAR(240) NOT NULL,
            payload_hash VARCHAR(71) NOT NULL,
            expected_version INTEGER NOT NULL,
            resulting_version INTEGER NOT NULL,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_final_report_command_receipts_finalization_classification
                FOREIGN KEY (report_finalization_id, classification)
                REFERENCES report_finalizations(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_final_report_command_receipts_version_scope
                FOREIGN KEY (
                    final_report_version_id, report_finalization_id, classification
                ) REFERENCES final_report_versions(
                    id, report_finalization_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_final_report_command_receipts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_final_report_command_receipts_contract CHECK (contract_version = 2),
            CONSTRAINT ck_final_report_command_receipts_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT ck_final_report_command_receipts_versions CHECK (
                expected_version >= 0 AND resulting_version > expected_version
            ),
            CONSTRAINT uq_final_report_command_receipts_command_id UNIQUE (command_id),
            CONSTRAINT uq_final_report_command_receipts_idempotency UNIQUE (idempotency_key)
        )
        """,
    )
    for statement in statements:
        op.execute(statement)

    indexes = (
        "CREATE INDEX ix_report_finalizations_period_classification ON report_finalizations (reporting_period_id, classification)",
        "CREATE INDEX ix_final_report_versions_finalized ON final_report_versions (classification, finalized_at)",
        "CREATE UNIQUE INDEX uq_final_report_versions_current ON final_report_versions (report_finalization_id) WHERE disposition = 'current'",
        "CREATE INDEX ix_final_report_source_claims_finalization ON final_report_source_claims (report_finalization_id, claimed_at)",
        "CREATE INDEX ix_final_report_scope_members_enterprise ON final_report_scope_members (enterprise_id, site_id)",
        "CREATE INDEX ix_final_report_items_revision ON final_report_items (report_revision_id)",
        "CREATE INDEX ix_final_report_events_finalization_occurred ON final_report_events (report_finalization_id, occurred_at)",
        "CREATE INDEX ix_final_report_artifacts_status ON final_report_artifacts (status, updated_at)",
    )
    for statement in indexes:
        op.execute(statement)


def _backfill_exact_legacy_finalizations(connection: Connection) -> None:
    final_rows = list(
        connection.execute(
            sa.text(
                """
                SELECT id, report_code, title, period, generated_on, prepared_by,
                       prepared_role, status, archived_from_status, total_entry,
                       total_exit, total_unique, enterprise_count, source_kind,
                       mock_run_id, updated_at
                FROM final_reports
                ORDER BY generated_on, id
                """
            )
        ).mappings()
    )
    sources_by_final: dict[str, list[Mapping[str, Any]]] = {}
    source_usage: Counter[str] = Counter()
    for raw_final in final_rows:
        final_id = str(raw_final["id"])
        sources = [
            cast("Mapping[str, Any]", row)
            for row in connection.execute(
                sa.text(
                    """
                    SELECT id, final_report_id, intake_report_id, enterprise_id,
                           enterprise, code, unique_count, entries, exits
                    FROM final_report_sources
                    WHERE final_report_id = :final_report_id
                    ORDER BY intake_report_id, id
                    """
                ),
                {"final_report_id": final_id},
            ).mappings()
        ]
        sources_by_final[final_id] = sources
        source_usage.update(str(source["intake_report_id"]) for source in sources)

    for raw_final in final_rows:
        final = cast("Mapping[str, Any]", raw_final)
        final_id = str(final["id"])
        sources = sources_by_final[final_id]
        reused = sorted(
            str(source["intake_report_id"])
            for source in sources
            if source_usage[str(source["intake_report_id"])] > 1
        )
        if reused:
            _record_final_exception(
                connection,
                final_id=final_id,
                code="legacy_final_source_reused",
                details={"legacyIntakeReportIds": reused},
            )
            continue
        candidate, error = _resolve_legacy_final_candidate(connection, final, sources)
        if error is not None:
            _record_final_exception(
                connection,
                final_id=final_id,
                code=str(error["code"]),
                details=cast("Mapping[str, object]", error["details"]),
                reporting_period_id=cast("str | None", error.get("reporting_period_id")),
                classification=cast("str | None", error.get("classification")),
            )
            continue
        assert candidate is not None
        _insert_legacy_final_candidate(connection, final, sources, candidate)


def _resolve_legacy_final_candidate(
    connection: Connection,
    final: Mapping[str, Any],
    sources: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    if not sources:
        return None, _candidate_error(
            "legacy_final_missing_sources", "The legacy final has no source rows."
        )
    if len(sources) != final.get("enterprise_count"):
        return None, _candidate_error(
            "legacy_final_source_count_mismatch",
            "Legacy enterprise_count does not equal the exact source-row count.",
        )

    resolved: list[dict[str, object]] = []
    for source in sources:
        rows = list(
            connection.execute(
                sa.text(
                    """
                    SELECT revision.id AS report_revision_id,
                           revision.payload_hash,
                           revision.classification,
                           report.id AS enterprise_report_id,
                           report.workflow_state,
                           report.current_revision_id,
                           report.accepted_revision_id,
                           report.reporting_obligation_id,
                           obligation.reporting_period_id,
                           obligation.enterprise_id,
                           obligation.site_id,
                           obligation.frozen_barangay,
                           period.label AS period_label
                    FROM report_revisions revision
                    JOIN enterprise_reports report
                      ON report.id = revision.enterprise_report_id
                    JOIN reporting_obligations obligation
                      ON obligation.id = report.reporting_obligation_id
                    JOIN reporting_periods period
                      ON period.id = obligation.reporting_period_id
                    WHERE revision.local_revision_id = :local_revision_id
                    """
                ),
                {"local_revision_id": f"legacy:{source['intake_report_id']}"},
            ).mappings()
        )
        if len(rows) != 1:
            return None, _candidate_error(
                "legacy_final_source_lineage_ambiguous",
                "A legacy source does not resolve to exactly one immutable revision.",
            )
        row = cast("Mapping[str, Any]", rows[0])
        if (
            row["workflow_state"] != "consolidated"
            or str(row["current_revision_id"]) != str(row["report_revision_id"])
            or str(row["accepted_revision_id"]) != str(row["report_revision_id"])
        ):
            return None, _candidate_error(
                "legacy_final_source_not_consolidated",
                "A legacy final source is not the exact consolidated current revision.",
                reporting_period_id=str(row["reporting_period_id"]),
                classification=str(row["classification"]),
            )
        expected_metrics = {
            "visitor_entries": source.get("entries"),
            "visitor_exits": source.get("exits"),
            "venue_local_unique_estimate": source.get("unique_count"),
        }
        metric_rows = connection.execute(
            sa.text(
                """
                SELECT definition, value
                FROM report_metric_facts
                WHERE report_revision_id = CAST(:revision_id AS UUID)
                  AND definition IN (
                      'visitor_entries', 'visitor_exits', 'venue_local_unique_estimate'
                  )
                """
            ),
            {"revision_id": str(row["report_revision_id"])},
        ).mappings()
        actual_metrics = {str(item["definition"]): item["value"] for item in metric_rows}
        if any(
            definition not in actual_metrics
            or Decimal(str(actual_metrics[definition])) != Decimal(str(expected_value))
            for definition, expected_value in expected_metrics.items()
        ):
            return None, _candidate_error(
                "legacy_final_source_fact_mismatch",
                "Legacy copied source totals do not match the exact immutable revision facts.",
                reporting_period_id=str(row["reporting_period_id"]),
                classification=str(row["classification"]),
            )
        resolved.append({key: value for key, value in row.items()})

    period_ids = {str(item["reporting_period_id"]) for item in resolved}
    classifications = {str(item["classification"]) for item in resolved}
    if len(period_ids) != 1 or len(classifications) != 1:
        return None, _candidate_error(
            "legacy_final_mixed_scope",
            "Legacy final sources span multiple periods or classifications.",
        )
    period_id = period_ids.pop()
    classification = classifications.pop()
    if {str(item["period_label"]) for item in resolved} != {str(final["period"])}:
        return None, _candidate_error(
            "legacy_final_period_mismatch",
            "Legacy final label does not equal its sources' canonical period label.",
            reporting_period_id=period_id,
            classification=classification,
        )
    totals = {
        "total_entry": sum(int(source["entries"]) for source in sources),
        "total_exit": sum(int(source["exits"]) for source in sources),
        "total_unique": sum(int(source["unique_count"]) for source in sources),
    }
    if any(int(final[field]) != expected for field, expected in totals.items()):
        return None, _candidate_error(
            "legacy_final_total_mismatch",
            "Legacy final totals do not reconcile to its exact source rows.",
            reporting_period_id=period_id,
            classification=classification,
        )
    source_kind = str(final.get("source_kind"))
    expected_classification = "simulation" if source_kind == "mock" else "official"
    if classification != expected_classification:
        return None, _candidate_error(
            "legacy_final_classification_mismatch",
            "Legacy source kind disagrees with authoritative revision classification.",
            reporting_period_id=period_id,
            classification=classification,
        )
    return (
        {
            "reporting_period_id": period_id,
            "classification": classification,
            "resolved_sources": resolved,
        },
        None,
    )


def _candidate_error(
    code: str,
    reason: str,
    *,
    reporting_period_id: str | None = None,
    classification: str | None = None,
) -> dict[str, object]:
    return {
        "code": code,
        "details": {"reason": reason},
        "reporting_period_id": reporting_period_id,
        "classification": classification,
    }


def _insert_legacy_final_candidate(
    connection: Connection,
    final: Mapping[str, Any],
    sources: Sequence[Mapping[str, Any]],
    candidate: Mapping[str, object],
) -> None:
    final_id = str(final["id"])
    finalization_id = _stable_uuid("finalization", final_id)
    version_id = _stable_uuid("version", final_id)
    classification = str(candidate["classification"])
    period_id = str(candidate["reporting_period_id"])
    resolved_sources = cast("list[dict[str, object]]", candidate["resolved_sources"])
    finalized_at = _required_datetime(final["generated_on"])
    prepared_name = str(final.get("prepared_by") or "Legacy preparer unavailable")
    prepared_role = str(final.get("prepared_role") or "Legacy role unavailable")
    metrics = _legacy_metric_aggregates(connection, resolved_sources)
    demographics = _legacy_demographic_aggregates(connection, resolved_sources)
    content_hash = _legacy_content_hash(
        final=final,
        period_id=period_id,
        classification=classification,
        resolved_sources=resolved_sources,
        metrics=metrics,
        demographics=demographics,
    )
    common = {
        "finalization_id": finalization_id,
        "version_id": version_id,
        "classification": classification,
        "period_id": period_id,
        "finalized_at": finalized_at,
    }
    connection.execute(
        sa.text(
            """
            INSERT INTO report_finalizations (
                id, reporting_period_id, classification, report_code,
                current_version_id, logical_version, created_by_account_id,
                created_at, updated_at
            ) VALUES (
                CAST(:finalization_id AS UUID), CAST(:period_id AS UUID),
                :classification, :report_code, CAST(:version_id AS UUID),
                1, NULL, :finalized_at, :updated_at
            ) ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            **common,
            "report_code": str(final["report_code"]),
            "updated_at": _required_datetime(final["updated_at"]),
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO final_report_versions (
                id, report_finalization_id, classification, version_number,
                disposition, scope_type, scope_barangay, scope_label,
                source_count, scope_member_count, content_hash,
                prepared_by_account_id, prepared_by_name, prepared_by_role,
                finalized_at, created_at
            ) VALUES (
                CAST(:version_id AS UUID), CAST(:finalization_id AS UUID),
                :classification, 1, 'current', 'enterprise_selection', NULL,
                :scope_label, :source_count, :source_count, :content_hash,
                NULL, :prepared_name, :prepared_role, :finalized_at, :finalized_at
            ) ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            **common,
            "scope_label": f"Selected enterprises ({len(sources)})",
            "source_count": len(sources),
            "content_hash": content_hash,
            "prepared_name": prepared_name[:120],
            "prepared_role": prepared_role[:120],
        },
    )
    for _source, resolved in zip(sources, resolved_sources, strict=True):
        revision_id = str(resolved["report_revision_id"])
        obligation_id = str(resolved["reporting_obligation_id"])
        row_parameters = {
            **common,
            "claim_id": _stable_uuid("claim", f"{final_id}:{revision_id}"),
            "member_id": _stable_uuid("member", f"{final_id}:{obligation_id}"),
            "item_id": _stable_uuid("item", f"{final_id}:{revision_id}"),
            "revision_id": revision_id,
            "obligation_id": obligation_id,
            "enterprise_id": str(resolved["enterprise_id"]),
            "site_id": str(resolved["site_id"]),
            "frozen_barangay": resolved.get("frozen_barangay"),
            "payload_hash": str(resolved["payload_hash"]),
        }
        connection.execute(_LEGACY_CLAIM_INSERT, row_parameters)
        connection.execute(_LEGACY_MEMBER_INSERT, row_parameters)
        connection.execute(_LEGACY_ITEM_INSERT, row_parameters)
    for metric in metrics:
        connection.execute(
            _LEGACY_METRIC_INSERT,
            {
                **common,
                "id": _stable_uuid(
                    "metric",
                    f"{final_id}:{metric['definition']}:{metric['definition_version']}",
                ),
                **metric,
            },
        )
    for demographic in demographics:
        connection.execute(
            _LEGACY_DEMOGRAPHIC_INSERT,
            {
                **common,
                "id": _stable_uuid(
                    "demographic",
                    f"{final_id}:{demographic['dimension']}:{demographic['value']}",
                ),
                **demographic,
            },
        )
    connection.execute(
        _LEGACY_EVENT_INSERT,
        {
            **common,
            "id": _stable_uuid("event", final_id),
            "reason": (
                "Imported exact legacy source lineage. The legacy Citywide title was not "
                "treated as proof of completeness; scope is enterprise_selection. "
                f"Legacy status was {final.get('status')!s}; archived-from status was "
                f"{final.get('archived_from_status')!s}."
            ),
        },
    )
    connection.execute(
        _LEGACY_ARTIFACT_INSERT,
        {
            **common,
            "id": _stable_uuid("artifact", final_id),
            "template_version": (
                "simulation-final-report-v1"
                if classification == "simulation"
                else "official-final-report-v1"
            ),
        },
    )


def _legacy_metric_aggregates(
    connection: Connection, resolved_sources: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    revision_ids = [str(source["report_revision_id"]) for source in resolved_sources]
    rows = connection.execute(
        sa.text(
            """
            SELECT definition, definition_version, unit, quality, value
            FROM report_metric_facts
            WHERE report_revision_id = ANY(CAST(:revision_ids AS UUID[]))
            ORDER BY definition, definition_version, report_revision_id
            """
        ),
        {"revision_ids": revision_ids},
    ).mappings()
    groups: dict[tuple[str, int, str], list[Mapping[str, Any]]] = defaultdict(list)
    for raw_row in rows:
        row = cast("Mapping[str, Any]", raw_row)
        groups[(str(row["definition"]), int(row["definition_version"]), str(row["unit"]))].append(
            row
        )
    aliases = {
        "entries": "sum",
        "visitor_entries": "sum",
        "exits": "sum",
        "visitor_exits": "sum",
        "peak_occupancy": "maximum",
        "occupancy_peak": "maximum",
        "unique_visitor_estimate": "summed_site_estimate",
        "venue_local_unique_estimate": "summed_site_estimate",
    }
    aggregates: list[dict[str, object]] = []
    for (definition, definition_version, unit), group in sorted(groups.items()):
        method = aliases.get(definition)
        if method is None:
            continue
        values = [Decimal(str(row["value"])) if row["value"] is not None else None for row in group]
        quality = _worst_quality([str(row["quality"]) for row in group])
        if any(value is None for value in values):
            aggregate_value: Decimal | None = None
            quality = "unknown"
        else:
            known = cast("list[Decimal]", values)
            aggregate_value = max(known) if method == "maximum" else sum(known, Decimal(0))
        aggregates.append(
            {
                "definition": definition,
                "definition_version": definition_version,
                "unit": unit,
                "aggregation_method": method,
                "value": aggregate_value,
                "quality": quality,
                "source_fact_count": len(group),
            }
        )
    return aggregates


def _legacy_demographic_aggregates(
    connection: Connection, resolved_sources: Sequence[Mapping[str, object]]
) -> list[dict[str, object]]:
    revision_ids = [str(source["report_revision_id"]) for source in resolved_sources]
    rows = connection.execute(
        sa.text(
            """
            SELECT dimension, value, count, quality
            FROM report_demographic_facts
            WHERE report_revision_id = ANY(CAST(:revision_ids AS UUID[]))
            ORDER BY dimension, value, report_revision_id
            """
        ),
        {"revision_ids": revision_ids},
    ).mappings()
    groups: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for raw_row in rows:
        row = cast("Mapping[str, Any]", raw_row)
        groups[(str(row["dimension"]), str(row["value"]))].append(row)
    dimension_totals: dict[str, int] = defaultdict(int)
    counts: dict[tuple[str, str], int] = {}
    for key, group in groups.items():
        count = sum(int(row["count"]) for row in group)
        counts[key] = count
        dimension_totals[key[0]] += count
    return [
        {
            "dimension": dimension,
            "value": value,
            "count": counts[(dimension, value)],
            "percentage": (
                Decimal(counts[(dimension, value)])
                * Decimal(100)
                / Decimal(dimension_totals[dimension])
            ).quantize(Decimal("0.0001"))
            if dimension_totals[dimension]
            else None,
            "quality": _worst_quality([str(row["quality"]) for row in group], unknown=False),
            "source_fact_count": len(group),
        }
        for (dimension, value), group in sorted(groups.items())
    ]


def _legacy_content_hash(
    *,
    final: Mapping[str, Any],
    period_id: str,
    classification: str,
    resolved_sources: Sequence[Mapping[str, object]],
    metrics: Sequence[Mapping[str, object]],
    demographics: Sequence[Mapping[str, object]],
) -> str:
    content = {
        "reportingPeriodId": period_id,
        "classification": classification,
        "versionNumber": 1,
        "scope": {
            "type": "enterprise_selection",
            "label": f"Selected enterprises ({len(resolved_sources)})",
            "obligationIds": sorted(
                str(row["reporting_obligation_id"]) for row in resolved_sources
            ),
        },
        "sources": [
            {
                "reportRevisionId": str(row["report_revision_id"]),
                "reportingObligationId": str(row["reporting_obligation_id"]),
                "payloadHash": str(row["payload_hash"]),
            }
            for row in sorted(resolved_sources, key=lambda item: str(item["report_revision_id"]))
        ],
        "metrics": [_jsonable_mapping(row) for row in metrics],
        "demographics": [_jsonable_mapping(row) for row in demographics],
        "preparedBy": {
            "accountId": None,
            "name": str(final.get("prepared_by") or "Legacy preparer unavailable"),
            "role": str(final.get("prepared_role") or "Legacy role unavailable"),
        },
        "finalizedAt": _required_datetime(final["generated_on"]),
    }
    canonical = json.dumps(
        _canonical_json_value(content), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _jsonable_mapping(value: Mapping[str, object]) -> dict[str, object]:
    return {key: _canonical_json_value(item) for key, item in value.items()}


def _canonical_json_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Mapping):
        return {str(key): _canonical_json_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_canonical_json_value(item) for item in value]
    return value


def _worst_quality(values: Sequence[str], *, unknown: bool = True) -> str:
    order = {"confirmed": 0, "degraded": 1, "estimated": 2, "unknown": 3}
    if not unknown:
        order.pop("unknown")
    return max(values, key=lambda item: order[item]) if values else "unknown"


def _record_final_exception(
    connection: Connection,
    *,
    final_id: str,
    code: str,
    details: Mapping[str, object],
    reporting_period_id: str | None = None,
    classification: str | None = None,
) -> None:
    connection.execute(
        sa.text(
            """
            INSERT INTO report_migration_exceptions (
                id, source_table, source_row_id, exception_code, enterprise_id,
                reporting_period_id, report_revision_id, classification,
                details_json, blocks_acceptance, status
            ) VALUES (
                CAST(:id AS UUID), 'final_reports', :final_id, :code, NULL,
                CAST(:period_id AS UUID), NULL, :classification,
                :details_json, true, 'open'
            ) ON CONFLICT (source_table, source_row_id, exception_code) DO NOTHING
            """
        ),
        {
            "id": _stable_uuid("exception", f"{final_id}:{code}"),
            "final_id": final_id,
            "code": code,
            "period_id": reporting_period_id,
            # report_migration_exceptions requires enterprise and classification as a pair.
            "classification": None,
            "details_json": json.dumps(
                {**details, "authoritativeClassification": classification},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
        },
    )


def _stable_uuid(kind: str, identity: str) -> str:
    return str(uuid5(_FINAL_NAMESPACE, f"{kind}:{identity}"))


def _required_datetime(value: object) -> datetime:
    if not isinstance(value, datetime):
        raise TypeError("Legacy final timestamp is not a datetime.")
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _create_final_report_guards() -> None:
    for table_name in (
        "final_report_source_claims",
        "final_report_scope_members",
        "final_report_items",
        "final_report_metric_facts",
        "final_report_demographic_facts",
        "final_report_events",
        "final_report_command_receipts",
    ):
        op.execute(
            f"""
            CREATE TRIGGER trg_{table_name}_immutable
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION tanaw_reject_immutable_reporting_mutation()
            """
        )
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_report_finalization_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'report_finalizations cannot be deleted';
            END IF;
            IF NEW.id != OLD.id
               OR NEW.reporting_period_id != OLD.reporting_period_id
               OR NEW.classification != OLD.classification
               OR NEW.report_code != OLD.report_code
               OR NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id
               OR NEW.created_at != OLD.created_at
               OR NEW.logical_version != OLD.logical_version + 1
               OR NEW.current_version_id = OLD.current_version_id THEN
                RAISE EXCEPTION 'Logical finalization updates must advance exactly one version';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_report_finalizations_version_guard
        BEFORE UPDATE OR DELETE ON report_finalizations
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_report_finalization_mutation()
        """
    )
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_final_report_version_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'final_report_versions are immutable';
            END IF;
            IF OLD.disposition = 'current' AND NEW.disposition = 'superseded'
               AND (to_jsonb(NEW) - 'disposition') = (to_jsonb(OLD) - 'disposition') THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'Final report version facts are immutable; create a new version';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_final_report_artifact_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'final_report_artifacts cannot be deleted';
            END IF;
            IF NEW.id != OLD.id
               OR NEW.final_report_version_id != OLD.final_report_version_id
               OR NEW.classification != OLD.classification
               OR NEW.template_version != OLD.template_version
               OR NEW.mime_type != OLD.mime_type
               OR NEW.created_at != OLD.created_at THEN
                RAISE EXCEPTION 'Final report artifact identity is immutable';
            END IF;
            IF NOT (
                (OLD.status = 'pending' AND NEW.status IN ('ready', 'failed')) OR
                (OLD.status = 'failed' AND NEW.status = 'pending')
            ) THEN
                RAISE EXCEPTION 'Invalid final report artifact state transition';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_final_report_artifacts_lifecycle_guard
        BEFORE UPDATE OR DELETE ON final_report_artifacts
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_final_report_artifact_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_final_report_versions_immutable
        BEFORE UPDATE OR DELETE ON final_report_versions
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_final_report_version_mutation()
        """
    )


_LEGACY_CLAIM_INSERT = sa.text(
    """
    INSERT INTO final_report_source_claims (
        id, report_finalization_id, report_revision_id, classification,
        claimed_at, created_at
    ) VALUES (
        CAST(:claim_id AS UUID), CAST(:finalization_id AS UUID),
        CAST(:revision_id AS UUID), :classification, :finalized_at, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_MEMBER_INSERT = sa.text(
    """
    INSERT INTO final_report_scope_members (
        id, final_report_version_id, report_finalization_id,
        reporting_obligation_id, enterprise_id, site_id, classification,
        frozen_barangay, created_at
    ) VALUES (
        CAST(:member_id AS UUID), CAST(:version_id AS UUID),
        CAST(:finalization_id AS UUID), CAST(:obligation_id AS UUID),
        CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID), :classification,
        :frozen_barangay, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_ITEM_INSERT = sa.text(
    """
    INSERT INTO final_report_items (
        id, final_report_version_id, report_finalization_id,
        reporting_obligation_id, report_revision_id, classification,
        source_payload_hash, created_at
    ) VALUES (
        CAST(:item_id AS UUID), CAST(:version_id AS UUID),
        CAST(:finalization_id AS UUID), CAST(:obligation_id AS UUID),
        CAST(:revision_id AS UUID), :classification, :payload_hash, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_METRIC_INSERT = sa.text(
    """
    INSERT INTO final_report_metric_facts (
        id, final_report_version_id, classification, definition,
        definition_version, value, unit, aggregation_method, quality,
        source_fact_count, created_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:version_id AS UUID), :classification,
        :definition, :definition_version, :value, :unit, :aggregation_method,
        :quality, :source_fact_count, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_DEMOGRAPHIC_INSERT = sa.text(
    """
    INSERT INTO final_report_demographic_facts (
        id, final_report_version_id, classification, dimension, value,
        count, percentage, quality, source_fact_count, created_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:version_id AS UUID), :classification,
        :dimension, :value, :count, :percentage, :quality,
        :source_fact_count, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_EVENT_INSERT = sa.text(
    """
    INSERT INTO final_report_events (
        id, report_finalization_id, final_report_version_id, classification,
        event_type, actor_account_id, actor_role, command_id,
        expected_version, resulting_version, reason, occurred_at, created_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:finalization_id AS UUID), CAST(:version_id AS UUID),
        :classification, 'legacy_final_imported', NULL, NULL, NULL,
        0, 1, :reason, :finalized_at, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_LEGACY_ARTIFACT_INSERT = sa.text(
    """
    INSERT INTO final_report_artifacts (
        id, final_report_version_id, classification, status,
        template_version, mime_type, generation_attempts, created_at, updated_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:version_id AS UUID), :classification, 'pending',
        :template_version, 'application/pdf', 0, :finalized_at, :finalized_at
    ) ON CONFLICT (id) DO NOTHING
    """
)
