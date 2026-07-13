"""Add canonical periods and immutable enterprise-report foundations.

Revision ID: 20260713_0021
Revises: 20260713_0020

This additive development migration transforms only unambiguous legacy intake
rows. Legacy rows without a canonical period, one authoritative topology path,
or one logical enterprise/period identity are represented by blocking migration
exceptions instead of guessed target records. Migrated revisions remain blocked
because the legacy payload has no authoritative obligation eligibility, camera
source batches, or coverage evidence.

The current final_reports/final_report_sources names collide with the target
logical-final design. Their replacement is intentionally deferred to the next
coordinated final-report migration; this revision does not create permanent
"v2"-suffixed tables or weaken exact-revision requirements.
"""

import hashlib
import json
import re
from calendar import month_name, monthrange
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260713_0021"
down_revision: str | Sequence[str] | None = "20260713_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REPORTING_NAMESPACE = UUID("46c8b760-748f-4a97-bb40-390697a98be2")
_REPORTING_TIMEZONE_NAME = "Asia/Manila"
_REPORTING_TIMEZONE = ZoneInfo(_REPORTING_TIMEZONE_NAME)
_LEGACY_PERIOD_RANGE = re.compile(
    r"^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*"
    r"(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(\d{4})$"
)
_LEGACY_PERIOD_MONTH = re.compile(r"^([A-Za-z]+)\s+(\d{4})$")
_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}
_WORKFLOW_STATE_MAP = {
    "Pending Review": "submitted",
    "Returned": "returned",
    "Ready to Consolidate": "accepted",
    "Consolidated": "consolidated",
}
_DEMOGRAPHIC_VALUES = {
    "thisProvMale": "this_province:male",
    "thisProvFemale": "this_province:female",
    "otherProvMale": "other_province:male",
    "otherProvFemale": "other_province:female",
    "foreignMale": "foreign:male",
    "foreignFemale": "foreign:female",
}


@dataclass(frozen=True)
class _CanonicalPeriod:
    id: str
    natural_key: str
    local_start_date: date
    local_end_date: date
    starts_at: datetime
    ends_at: datetime
    label: str


@dataclass(frozen=True)
class _Topology:
    enterprise_id: str
    site_id: str
    classification: str
    official_code: str
    barangay: str | None
    timezone_name: str
    registration_effective_at: datetime


@dataclass(frozen=True)
class _PendingException:
    code: str
    details: Mapping[str, object]


@dataclass(frozen=True)
class _Candidate:
    row: Mapping[str, Any]
    period: _CanonicalPeriod
    topology: _Topology
    workflow_state: str
    pending_exceptions: tuple[_PendingException, ...]


def upgrade() -> None:
    _create_reporting_schema()
    _backfill_legacy_reports(op.get_bind())
    _create_reporting_guards()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0021 is intentionally irreversible because target report "
        "revisions, receipts, review events, and migration-resolution evidence are durable. "
        "Restore a verified backup or deploy a forward fix instead."
    )


def _create_reporting_schema() -> None:
    op.execute(
        "ALTER TABLE enterprise_sites ADD CONSTRAINT "
        "uq_enterprise_sites_identity_scope UNIQUE (id, enterprise_id, classification)"
    )
    op.execute(
        "ALTER TABLE cameras ADD CONSTRAINT uq_cameras_id_site_classification "
        "UNIQUE (id, site_id, classification)"
    )

    statements = (
        """
        CREATE TABLE reporting_periods (
            id UUID PRIMARY KEY,
            natural_key VARCHAR(64) NOT NULL,
            cadence VARCHAR(20) NOT NULL DEFAULT 'month',
            timezone_name VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
            local_start_date DATE NOT NULL,
            local_end_date DATE NOT NULL,
            starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
            ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
            submission_opens_at TIMESTAMP WITH TIME ZONE NOT NULL,
            label VARCHAR(80) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_reporting_periods_cadence CHECK (cadence = 'month'),
            CONSTRAINT ck_reporting_periods_timezone CHECK (timezone_name = 'Asia/Manila'),
            CONSTRAINT ck_reporting_periods_utc_bounds CHECK (ends_at > starts_at),
            CONSTRAINT ck_reporting_periods_local_bounds CHECK (
                local_end_date > local_start_date
            ),
            CONSTRAINT ck_reporting_periods_submission_window CHECK (
                submission_opens_at >= ends_at
            ),
            CONSTRAINT ck_reporting_periods_identity CHECK (
                length(trim(natural_key)) > 0 AND length(trim(label)) > 0
            ),
            CONSTRAINT uq_reporting_periods_natural_key UNIQUE (natural_key),
            CONSTRAINT uq_reporting_periods_canonical_bounds UNIQUE (
                cadence, timezone_name, starts_at, ends_at
            )
        )
        """,
        """
        CREATE TABLE reporting_obligations (
            id UUID PRIMARY KEY,
            reporting_period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE RESTRICT,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            eligibility_status VARCHAR(20) NOT NULL,
            eligibility_basis VARCHAR(40) NOT NULL,
            exemption_reason VARCHAR(500),
            frozen_barangay VARCHAR(120),
            timezone_name VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
            registration_effective_at TIMESTAMP WITH TIME ZONE,
            acceptance_blocked BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_reporting_obligations_site_enterprise_classification
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_reporting_obligations_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_reporting_obligations_eligibility_status CHECK (
                eligibility_status IN ('eligible', 'exempt', 'ineligible', 'unknown')
            ),
            CONSTRAINT ck_reporting_obligations_eligibility_basis CHECK (
                eligibility_basis IN (
                    'registry_snapshot', 'legacy_submission', 'manual_resolution'
                )
            ),
            CONSTRAINT ck_reporting_obligations_timezone CHECK (
                timezone_name = 'Asia/Manila'
            ),
            CONSTRAINT ck_reporting_obligations_exemption_reason CHECK (
                eligibility_status != 'exempt' OR
                (exemption_reason IS NOT NULL AND length(trim(exemption_reason)) > 0)
            ),
            CONSTRAINT uq_reporting_obligations_site_period UNIQUE (
                enterprise_id, site_id, reporting_period_id
            ),
            CONSTRAINT uq_reporting_obligations_identity_scope UNIQUE (
                id, enterprise_id, site_id, classification
            ),
            CONSTRAINT uq_reporting_obligations_id_classification UNIQUE (
                id, classification
            )
        )
        """,
        """
        CREATE TABLE enterprise_reports (
            id UUID PRIMARY KEY,
            reporting_obligation_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            workflow_state VARCHAR(20) NOT NULL,
            current_revision_id UUID NOT NULL,
            accepted_revision_id UUID,
            logical_version INTEGER NOT NULL DEFAULT 1,
            acceptance_blocked BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_enterprise_reports_obligation_scope
                FOREIGN KEY (
                    reporting_obligation_id, enterprise_id, site_id, classification
                ) REFERENCES reporting_obligations(
                    id, enterprise_id, site_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_enterprise_reports_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_enterprise_reports_workflow_state CHECK (
                workflow_state IN ('submitted', 'returned', 'accepted', 'consolidated')
            ),
            CONSTRAINT ck_enterprise_reports_logical_version CHECK (logical_version >= 1),
            CONSTRAINT ck_enterprise_reports_accepted_pointer CHECK (
                workflow_state NOT IN ('accepted', 'consolidated') OR
                (accepted_revision_id IS NOT NULL AND
                 accepted_revision_id = current_revision_id)
            ),
            CONSTRAINT uq_enterprise_reports_obligation UNIQUE (reporting_obligation_id),
            CONSTRAINT uq_enterprise_reports_identity_scope UNIQUE (
                id, enterprise_id, site_id, classification
            ),
            CONSTRAINT uq_enterprise_reports_enterprise_scope UNIQUE (
                id, enterprise_id, classification
            )
        )
        """,
        """
        CREATE TABLE report_revisions (
            id UUID PRIMARY KEY,
            enterprise_report_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            revision_number INTEGER NOT NULL,
            local_revision_id VARCHAR(120) NOT NULL,
            idempotency_key VARCHAR(240) NOT NULL,
            source_window_start TIMESTAMP WITH TIME ZONE NOT NULL,
            source_window_end TIMESTAMP WITH TIME ZONE NOT NULL,
            submitted_by_account_id VARCHAR(36) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
            submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            payload_hash VARCHAR(71) NOT NULL,
            evidence_status VARCHAR(20) NOT NULL,
            acceptance_blocked BOOLEAN NOT NULL DEFAULT false,
            monitored_seconds INTEGER,
            expected_seconds INTEGER,
            coverage_gap_count INTEGER,
            coverage_details_json TEXT,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_revisions_report_scope
                FOREIGN KEY (enterprise_report_id, enterprise_id, site_id, classification)
                REFERENCES enterprise_reports(id, enterprise_id, site_id, classification)
                ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
            CONSTRAINT ck_report_revisions_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_revisions_revision_number CHECK (revision_number >= 1),
            CONSTRAINT ck_report_revisions_window CHECK (
                source_window_end > source_window_start
            ),
            CONSTRAINT ck_report_revisions_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT ck_report_revisions_evidence_status CHECK (
                evidence_status IN ('complete', 'incomplete')
            ),
            CONSTRAINT ck_report_revisions_coverage CHECK (
                (monitored_seconds IS NULL AND expected_seconds IS NULL) OR
                (monitored_seconds >= 0 AND expected_seconds > 0 AND
                 monitored_seconds <= expected_seconds)
            ),
            CONSTRAINT ck_report_revisions_gap_count CHECK (
                coverage_gap_count IS NULL OR coverage_gap_count >= 0
            ),
            CONSTRAINT ck_report_revisions_coverage_details_size CHECK (
                coverage_details_json IS NULL OR length(coverage_details_json) <= 20000
            ),
            CONSTRAINT uq_report_revisions_report_number UNIQUE (
                enterprise_report_id, revision_number
            ),
            CONSTRAINT uq_report_revisions_local_revision UNIQUE (
                enterprise_report_id, local_revision_id
            ),
            CONSTRAINT uq_report_revisions_idempotency UNIQUE (
                enterprise_report_id, idempotency_key
            ),
            CONSTRAINT uq_report_revisions_identity_scope UNIQUE (
                id, enterprise_report_id, enterprise_id, site_id, classification
            ),
            CONSTRAINT uq_report_revisions_site_scope UNIQUE (
                id, site_id, classification
            ),
            CONSTRAINT uq_report_revisions_enterprise_scope UNIQUE (
                id, enterprise_id, classification
            ),
            CONSTRAINT uq_report_revisions_id_classification UNIQUE (id, classification)
        )
        """,
        """
        ALTER TABLE enterprise_reports
        ADD CONSTRAINT fk_enterprise_reports_current_revision_scope
        FOREIGN KEY (current_revision_id, id, enterprise_id, site_id, classification)
        REFERENCES report_revisions(
            id, enterprise_report_id, enterprise_id, site_id, classification
        ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        """,
        """
        ALTER TABLE enterprise_reports
        ADD CONSTRAINT fk_enterprise_reports_accepted_revision_scope
        FOREIGN KEY (accepted_revision_id, id, enterprise_id, site_id, classification)
        REFERENCES report_revisions(
            id, enterprise_report_id, enterprise_id, site_id, classification
        ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        """,
        """
        CREATE TABLE report_metric_facts (
            id UUID PRIMARY KEY,
            report_revision_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            definition VARCHAR(120) NOT NULL,
            definition_version INTEGER NOT NULL,
            value NUMERIC(20, 6),
            unit VARCHAR(60) NOT NULL,
            grain VARCHAR(20) NOT NULL,
            window_start TIMESTAMP WITH TIME ZONE NOT NULL,
            window_end TIMESTAMP WITH TIME ZONE NOT NULL,
            timezone_name VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
            provenance VARCHAR(30) NOT NULL,
            quality VARCHAR(20) NOT NULL,
            monitored_seconds INTEGER,
            expected_seconds INTEGER,
            coverage_gap_count INTEGER,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_metric_facts_revision_classification
                FOREIGN KEY (report_revision_id, classification)
                REFERENCES report_revisions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_report_metric_facts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_metric_facts_definition_version CHECK (
                definition_version >= 1
            ),
            CONSTRAINT ck_report_metric_facts_grain CHECK (
                grain IN ('camera', 'site', 'enterprise')
            ),
            CONSTRAINT ck_report_metric_facts_provenance CHECK (
                provenance IN ('camera_derived', 'operator_entered', 'system_derived')
            ),
            CONSTRAINT ck_report_metric_facts_quality CHECK (
                quality IN ('confirmed', 'degraded', 'estimated', 'unknown')
            ),
            CONSTRAINT ck_report_metric_facts_quality_value CHECK (
                (quality = 'unknown' AND value IS NULL) OR
                (quality != 'unknown' AND value IS NOT NULL)
            ),
            CONSTRAINT ck_report_metric_facts_value CHECK (value IS NULL OR value >= 0),
            CONSTRAINT ck_report_metric_facts_window CHECK (window_end > window_start),
            CONSTRAINT ck_report_metric_facts_timezone CHECK (
                timezone_name = 'Asia/Manila'
            ),
            CONSTRAINT ck_report_metric_facts_coverage CHECK (
                (monitored_seconds IS NULL AND expected_seconds IS NULL AND
                 coverage_gap_count IS NULL) OR
                (monitored_seconds >= 0 AND expected_seconds > 0 AND
                 monitored_seconds <= expected_seconds AND coverage_gap_count >= 0)
            ),
            CONSTRAINT uq_report_metric_facts_definition UNIQUE (
                report_revision_id, definition, definition_version, grain
            )
        )
        """,
        """
        CREATE TABLE report_demographic_facts (
            id UUID PRIMARY KEY,
            report_revision_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            dimension VARCHAR(80) NOT NULL,
            value VARCHAR(120) NOT NULL,
            count INTEGER NOT NULL,
            percentage NUMERIC(7, 4),
            provenance VARCHAR(30) NOT NULL,
            quality VARCHAR(20) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_demographic_facts_revision_classification
                FOREIGN KEY (report_revision_id, classification)
                REFERENCES report_revisions(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_report_demographic_facts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_demographic_facts_count CHECK (count >= 0),
            CONSTRAINT ck_report_demographic_facts_percentage CHECK (
                percentage IS NULL OR (percentage >= 0 AND percentage <= 100)
            ),
            CONSTRAINT ck_report_demographic_facts_provenance CHECK (
                provenance IN ('operator_entered', 'system_derived')
            ),
            CONSTRAINT ck_report_demographic_facts_quality CHECK (
                quality IN ('confirmed', 'degraded', 'estimated')
            ),
            CONSTRAINT uq_report_demographic_facts_dimension_value UNIQUE (
                report_revision_id, dimension, value
            )
        )
        """,
        """
        CREATE TABLE report_source_batches (
            id UUID PRIMARY KEY,
            report_revision_id UUID NOT NULL,
            site_id UUID NOT NULL,
            camera_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            batch_key VARCHAR(120) NOT NULL,
            event_count INTEGER NOT NULL,
            event_sequence_start INTEGER NOT NULL,
            event_sequence_end_exclusive INTEGER NOT NULL,
            aggregate_hash VARCHAR(71) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_source_batches_revision_site_classification
                FOREIGN KEY (report_revision_id, site_id, classification)
                REFERENCES report_revisions(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_report_source_batches_camera_site_classification
                FOREIGN KEY (camera_id, site_id, classification)
                REFERENCES cameras(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_report_source_batches_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_source_batches_event_count CHECK (event_count >= 0),
            CONSTRAINT ck_report_source_batches_sequence CHECK (
                event_sequence_start >= 0 AND
                event_sequence_end_exclusive >= event_sequence_start
            ),
            CONSTRAINT ck_report_source_batches_sequence_count CHECK (
                event_sequence_end_exclusive - event_sequence_start = event_count
            ),
            CONSTRAINT ck_report_source_batches_aggregate_hash CHECK (
                length(aggregate_hash) = 71 AND aggregate_hash LIKE 'sha256:%'
            ),
            CONSTRAINT uq_report_source_batches_revision_key UNIQUE (
                report_revision_id, batch_key
            )
        )
        """,
        """
        CREATE TABLE report_review_events (
            id UUID PRIMARY KEY,
            enterprise_report_id UUID NOT NULL,
            report_revision_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            event_type VARCHAR(40) NOT NULL,
            from_state VARCHAR(20),
            to_state VARCHAR(20) NOT NULL,
            actor_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            actor_role VARCHAR(40),
            reason TEXT,
            command_id UUID NOT NULL,
            expected_version INTEGER NOT NULL,
            resulting_version INTEGER NOT NULL,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_review_events_report_enterprise_classification
                FOREIGN KEY (enterprise_report_id, enterprise_id, classification)
                REFERENCES enterprise_reports(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT fk_report_review_events_revision_enterprise_classification
                FOREIGN KEY (report_revision_id, enterprise_id, classification)
                REFERENCES report_revisions(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_report_review_events_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_review_events_type CHECK (
                event_type IN (
                    'revision_submitted', 'returned', 'accepted', 'reopened',
                    'consolidated', 'legacy_state_imported'
                )
            ),
            CONSTRAINT ck_report_review_events_from_state CHECK (
                from_state IS NULL OR from_state IN (
                    'submitted', 'returned', 'accepted', 'consolidated'
                )
            ),
            CONSTRAINT ck_report_review_events_to_state CHECK (
                to_state IN ('submitted', 'returned', 'accepted', 'consolidated')
            ),
            CONSTRAINT ck_report_review_events_versions CHECK (
                expected_version >= 0 AND resulting_version >= 1 AND
                resulting_version > expected_version
            ),
            CONSTRAINT uq_report_review_events_command_id UNIQUE (command_id)
        )
        """,
        """
        CREATE TABLE report_intake_receipts (
            id UUID PRIMARY KEY,
            enterprise_report_id UUID NOT NULL,
            report_revision_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            receipt_kind VARCHAR(20) NOT NULL,
            contract_version INTEGER,
            command_id UUID,
            idempotency_key VARCHAR(240) NOT NULL,
            payload_hash VARCHAR(71) NOT NULL,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_intake_receipts_report_enterprise_classification
                FOREIGN KEY (enterprise_report_id, enterprise_id, classification)
                REFERENCES enterprise_reports(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT fk_report_intake_receipts_revision_enterprise_classification
                FOREIGN KEY (report_revision_id, enterprise_id, classification)
                REFERENCES report_revisions(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_report_intake_receipts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_intake_receipts_kind CHECK (
                receipt_kind IN ('command', 'migration')
            ),
            CONSTRAINT ck_report_intake_receipts_contract CHECK (
                (receipt_kind = 'command' AND contract_version = 2 AND command_id IS NOT NULL) OR
                (receipt_kind = 'migration' AND contract_version IS NULL AND command_id IS NULL)
            ),
            CONSTRAINT ck_report_intake_receipts_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT uq_report_intake_receipts_command_id UNIQUE (command_id),
            CONSTRAINT uq_report_intake_receipts_enterprise_idempotency UNIQUE (
                enterprise_id, idempotency_key
            )
        )
        """,
        """
        CREATE TABLE report_migration_exceptions (
            id UUID PRIMARY KEY,
            source_table VARCHAR(120) NOT NULL,
            source_row_id VARCHAR(120) NOT NULL,
            exception_code VARCHAR(80) NOT NULL,
            enterprise_id UUID,
            reporting_period_id UUID REFERENCES reporting_periods(id) ON DELETE RESTRICT,
            report_revision_id UUID REFERENCES report_revisions(id) ON DELETE RESTRICT,
            classification VARCHAR(20),
            details_json TEXT,
            blocks_acceptance BOOLEAN NOT NULL DEFAULT true,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolved_by_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            resolution_notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_report_migration_exceptions_enterprise_classification
                FOREIGN KEY (enterprise_id, classification)
                REFERENCES enterprises(id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_report_migration_exceptions_classification CHECK (
                classification IS NULL OR classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_report_migration_exceptions_enterprise_classification_pair CHECK (
                (enterprise_id IS NULL AND classification IS NULL) OR
                (enterprise_id IS NOT NULL AND classification IS NOT NULL)
            ),
            CONSTRAINT ck_report_migration_exceptions_status CHECK (
                status IN ('open', 'resolved', 'waived')
            ),
            CONSTRAINT ck_report_migration_exceptions_details_size CHECK (
                details_json IS NULL OR length(details_json) <= 20000
            ),
            CONSTRAINT ck_report_migration_exceptions_resolution CHECK (
                (status = 'open' AND resolved_at IS NULL AND
                 resolved_by_account_id IS NULL) OR
                (status IN ('resolved', 'waived') AND resolved_at IS NOT NULL AND
                 resolved_by_account_id IS NOT NULL)
            ),
            CONSTRAINT uq_report_migration_exceptions_source_code UNIQUE (
                source_table, source_row_id, exception_code
            )
        )
        """,
    )
    for statement in statements:
        op.execute(statement)

    indexes = (
        "CREATE INDEX ix_reporting_obligations_period_eligibility ON reporting_obligations (reporting_period_id, eligibility_status)",
        "CREATE INDEX ix_reporting_obligations_enterprise_period ON reporting_obligations (enterprise_id, reporting_period_id)",
        "CREATE INDEX ix_reporting_obligations_acceptance_blocked ON reporting_obligations (acceptance_blocked) WHERE acceptance_blocked = true",
        "CREATE INDEX ix_enterprise_reports_enterprise_state ON enterprise_reports (enterprise_id, workflow_state)",
        "CREATE INDEX ix_enterprise_reports_state_blocked ON enterprise_reports (workflow_state, acceptance_blocked)",
        "CREATE INDEX ix_report_revisions_submitted_at ON report_revisions (submitted_at)",
        "CREATE INDEX ix_report_revisions_report_received ON report_revisions (enterprise_report_id, received_at)",
        "CREATE INDEX ix_report_revisions_acceptance_blocked ON report_revisions (acceptance_blocked) WHERE acceptance_blocked = true",
        "CREATE INDEX ix_report_metric_facts_revision ON report_metric_facts (report_revision_id)",
        "CREATE INDEX ix_report_demographic_facts_revision ON report_demographic_facts (report_revision_id)",
        "CREATE INDEX ix_report_source_batches_camera ON report_source_batches (camera_id)",
        "CREATE INDEX ix_report_review_events_report_occurred ON report_review_events (enterprise_report_id, occurred_at)",
        "CREATE INDEX ix_report_intake_receipts_revision ON report_intake_receipts (report_revision_id)",
        "CREATE INDEX ix_report_migration_exceptions_open_blocking ON report_migration_exceptions (status, blocks_acceptance) WHERE status = 'open' AND blocks_acceptance = true",
        "CREATE INDEX ix_report_migration_exceptions_revision ON report_migration_exceptions (report_revision_id)",
    )
    for statement in indexes:
        op.execute(statement)


def _create_reporting_guards() -> None:
    op.execute(
        """
        CREATE FUNCTION tanaw_reject_immutable_reporting_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '% is immutable; create a new reporting record instead', TG_TABLE_NAME;
        END;
        $$
        """
    )
    for table_name in (
        "reporting_periods",
        "report_revisions",
        "report_metric_facts",
        "report_demographic_facts",
        "report_source_batches",
        "report_review_events",
        "report_intake_receipts",
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
        CREATE FUNCTION tanaw_enforce_report_acceptance_unblocked()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.workflow_state IN ('accepted', 'consolidated')
               AND NEW.acceptance_blocked = true THEN
                RAISE EXCEPTION 'Blocked report cannot enter accepted or consolidated state';
            END IF;
            IF NEW.acceptance_blocked = false
               OR NEW.workflow_state IN ('accepted', 'consolidated') THEN
                IF EXISTS (
                    SELECT 1 FROM reporting_obligations obligation
                    WHERE obligation.id = NEW.reporting_obligation_id
                      AND obligation.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.current_revision_id
                      AND revision.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.accepted_revision_id
                      AND revision.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1
                    FROM report_migration_exceptions exception
                    JOIN report_revisions revision
                      ON revision.id = exception.report_revision_id
                    WHERE revision.enterprise_report_id = NEW.id
                      AND exception.status = 'open'
                      AND exception.blocks_acceptance = true
                ) THEN
                    RAISE EXCEPTION 'Report acceptance remains blocked by incomplete evidence';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enterprise_reports_acceptance_guard
        BEFORE INSERT OR UPDATE OF acceptance_blocked, current_revision_id,
            workflow_state, accepted_revision_id
        ON enterprise_reports
        FOR EACH ROW EXECUTE FUNCTION tanaw_enforce_report_acceptance_unblocked()
        """
    )


def _backfill_legacy_reports(connection: Connection) -> None:
    legacy_rows = connection.execute(
        sa.text(
            """
            SELECT id, report_id, enterprise_account_id, enterprise_id,
                   enterprise_name, category, barangay, period, month,
                   submitted_at, received_at, entries, exits, peak_occupancy,
                   unique_count, status, review_status, notes, remarks,
                   sync_status, payload_json, source_kind, mock_run_id, updated_at
            FROM enterprise_report_submissions
            ORDER BY submitted_at, id
            """
        )
    ).mappings()

    candidates: list[_Candidate] = []
    for raw_row in legacy_rows:
        row = cast("Mapping[str, Any]", raw_row)
        source_row_id = _required_text(row.get("id"), "legacy report row id")
        topology_rows = _topology_for_account(connection, row.get("enterprise_account_id"))
        period: _CanonicalPeriod | None = None
        period_error: str | None = None
        try:
            period = _parse_legacy_period(row.get("period"), row.get("month"))
            connection.execute(_PERIOD_INSERT, _period_parameters(period))
        except (TypeError, ValueError) as exc:
            period_error = str(exc)

        topology: _Topology | None = None
        topology_error: str | None = None
        if len(topology_rows) == 1:
            topology = topology_rows[0]
        elif not topology_rows:
            topology_error = "No active normalized topology matches enterprise_account_id."
        else:
            topology_error = "More than one active normalized site matches enterprise_account_id."

        if period_error is not None:
            _insert_exception(
                connection,
                source_row_id=source_row_id,
                code="ambiguous_reporting_period",
                details={"legacyPeriod": row.get("period"), "reason": period_error},
                topology=topology,
            )
        if topology_error is not None:
            _insert_exception(
                connection,
                source_row_id=source_row_id,
                code="ambiguous_enterprise_topology",
                details={
                    "enterpriseAccountId": row.get("enterprise_account_id"),
                    "reason": topology_error,
                },
                period=period,
            )
        if period is None or topology is None:
            continue

        workflow_state = _WORKFLOW_STATE_MAP.get(str(row.get("review_status")))
        if workflow_state is None:
            _insert_exception(
                connection,
                source_row_id=source_row_id,
                code="unsupported_workflow_state",
                details={"legacyReviewStatus": row.get("review_status")},
                topology=topology,
                period=period,
            )
            continue

        pending_exceptions = _candidate_exceptions(row, period, topology, workflow_state)
        candidates.append(
            _Candidate(
                row=row,
                period=period,
                topology=topology,
                workflow_state=workflow_state,
                pending_exceptions=tuple(pending_exceptions),
            )
        )

    grouped: dict[tuple[str, str, str], list[_Candidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[
            (
                candidate.topology.enterprise_id,
                candidate.topology.site_id,
                candidate.period.natural_key,
            )
        ].append(candidate)

    for grouped_candidates in grouped.values():
        if len(grouped_candidates) > 1:
            source_ids = sorted(
                _required_text(candidate.row.get("id"), "legacy report row id")
                for candidate in grouped_candidates
            )
            for candidate in grouped_candidates:
                _insert_exception(
                    connection,
                    source_row_id=_required_text(candidate.row.get("id"), "legacy report row id"),
                    code="duplicate_legacy_enterprise_period",
                    details={"conflictingSourceRowIds": source_ids},
                    topology=candidate.topology,
                    period=candidate.period,
                )
            continue

        _backfill_candidate(connection, grouped_candidates[0])


def _topology_for_account(connection: Connection, account_id: object) -> list[_Topology]:
    normalized_account_id = _optional_text(account_id)
    if normalized_account_id is None:
        return []
    rows = connection.execute(
        sa.text(
            """
            SELECT enterprise.id AS enterprise_id,
                   site.id AS site_id,
                   enterprise.classification,
                   enterprise.official_code,
                   site.barangay,
                   site.timezone_name,
                   site.effective_from AS registration_effective_at
            FROM enterprise_memberships membership
            JOIN enterprises enterprise
              ON enterprise.id = membership.enterprise_id
             AND enterprise.classification = membership.classification
            JOIN enterprise_sites site
              ON site.enterprise_id = enterprise.id
             AND site.classification = enterprise.classification
             AND site.effective_to IS NULL
            WHERE membership.account_id = :account_id
              AND membership.ended_at IS NULL
            ORDER BY site.site_code, site.id
            """
        ),
        {"account_id": normalized_account_id},
    ).mappings()
    return [
        _Topology(
            enterprise_id=str(row["enterprise_id"]),
            site_id=str(row["site_id"]),
            classification=str(row["classification"]),
            official_code=str(row["official_code"]),
            barangay=_optional_text(row["barangay"]),
            timezone_name=str(row["timezone_name"]),
            registration_effective_at=_required_datetime(
                row["registration_effective_at"], "topology registration effective time"
            ),
        )
        for row in rows
    ]


def _candidate_exceptions(
    row: Mapping[str, Any],
    period: _CanonicalPeriod,
    topology: _Topology,
    workflow_state: str,
) -> list[_PendingException]:
    exceptions = [
        _PendingException(
            "unverified_historical_obligation",
            {
                "reason": (
                    "A legacy submission proves intake occurred but does not prove the frozen "
                    "eligibility/exemption set for this period."
                )
            },
        ),
        _PendingException(
            "missing_source_lineage",
            {
                "reason": (
                    "The legacy submission has no authoritative camera IDs, source batches, "
                    "event sequence watermarks, or aggregate hashes."
                )
            },
        ),
        _PendingException(
            "missing_coverage_evidence",
            {
                "reason": (
                    "The legacy submission has no monitored duration, expected duration, or "
                    "coverage-gap evidence."
                )
            },
        ),
    ]

    expected_classification = {"real": "official", "mock": "simulation"}.get(
        _optional_text(row.get("source_kind")) or ""
    )
    if expected_classification != topology.classification:
        exceptions.append(
            _PendingException(
                "legacy_classification_mismatch",
                {
                    "legacySourceKind": row.get("source_kind"),
                    "authoritativeClassification": topology.classification,
                },
            )
        )
    if _optional_text(row.get("enterprise_id")) != topology.official_code:
        exceptions.append(
            _PendingException(
                "legacy_enterprise_identity_mismatch",
                {
                    "legacyEnterpriseId": row.get("enterprise_id"),
                    "authoritativeOfficialCode": topology.official_code,
                },
            )
        )
    if topology.timezone_name != _REPORTING_TIMEZONE_NAME:
        exceptions.append(
            _PendingException(
                "unsupported_site_timezone",
                {"siteTimezone": topology.timezone_name},
            )
        )
    if topology.registration_effective_at >= period.ends_at:
        exceptions.append(
            _PendingException(
                "site_not_effective_during_period",
                {
                    "registrationEffectiveAt": topology.registration_effective_at,
                    "periodEndsAt": period.ends_at,
                },
            )
        )
    submitted_at = _required_datetime(row.get("submitted_at"), "legacy submitted_at")
    if submitted_at < period.ends_at:
        exceptions.append(
            _PendingException(
                "submission_before_period_close",
                {"submittedAt": submitted_at, "periodEndsAt": period.ends_at},
            )
        )
    if workflow_state != "submitted":
        exceptions.append(
            _PendingException(
                "incomplete_review_history",
                {
                    "legacyReviewStatus": row.get("review_status"),
                    "reason": "Legacy storage retained current state but not review actor/events.",
                },
            )
        )
    return exceptions


def _backfill_candidate(connection: Connection, candidate: _Candidate) -> None:
    row = candidate.row
    source_row_id = _required_text(row.get("id"), "legacy report row id")
    enterprise_id = candidate.topology.enterprise_id
    site_id = candidate.topology.site_id
    classification = candidate.topology.classification
    obligation_id = _deterministic_uuid(
        "obligation", f"{enterprise_id}:{site_id}:{candidate.period.natural_key}"
    )
    enterprise_report_id = _deterministic_uuid("enterprise-report", obligation_id)
    revision_id = _deterministic_uuid("report-revision", source_row_id)
    event_id = _deterministic_uuid("review-event", source_row_id)
    receipt_id = _deterministic_uuid("intake-receipt", source_row_id)
    payload_hash = _legacy_payload_hash(row)
    submitted_at = _required_datetime(row.get("submitted_at"), "legacy submitted_at")
    received_at = _required_datetime(row.get("received_at"), "legacy received_at")
    accepted_revision_id = (
        revision_id if candidate.workflow_state in {"accepted", "consolidated"} else None
    )

    connection.execute(
        _OBLIGATION_INSERT,
        {
            "id": obligation_id,
            "reporting_period_id": candidate.period.id,
            "enterprise_id": enterprise_id,
            "site_id": site_id,
            "classification": classification,
            "frozen_barangay": candidate.topology.barangay,
            "registration_effective_at": candidate.topology.registration_effective_at,
        },
    )
    connection.execute(
        _ENTERPRISE_REPORT_INSERT,
        {
            "id": enterprise_report_id,
            "reporting_obligation_id": obligation_id,
            "enterprise_id": enterprise_id,
            "site_id": site_id,
            "classification": classification,
            "workflow_state": candidate.workflow_state,
            "current_revision_id": revision_id,
            "accepted_revision_id": accepted_revision_id,
            "created_at": received_at,
            "updated_at": _required_datetime(row.get("updated_at"), "legacy updated_at"),
        },
    )
    connection.execute(
        _REVISION_INSERT,
        {
            "id": revision_id,
            "enterprise_report_id": enterprise_report_id,
            "enterprise_id": enterprise_id,
            "site_id": site_id,
            "classification": classification,
            "local_revision_id": f"legacy:{source_row_id}",
            "idempotency_key": f"migration:enterprise-report:{source_row_id}",
            "source_window_start": candidate.period.starts_at,
            "source_window_end": candidate.period.ends_at,
            "submitted_by_account_id": _required_text(
                row.get("enterprise_account_id"), "enterprise_account_id"
            ),
            "submitted_at": submitted_at,
            "received_at": received_at,
            "payload_hash": payload_hash,
            "notes": _optional_text(row.get("notes")),
        },
    )

    metric_values, metric_error = _legacy_metric_values(row)
    if metric_values is not None:
        for definition, metric_value, unit, grain in metric_values:
            connection.execute(
                _METRIC_INSERT,
                {
                    "id": _deterministic_uuid("metric-fact", f"{revision_id}:{definition}"),
                    "report_revision_id": revision_id,
                    "classification": classification,
                    "definition": definition,
                    "value": metric_value,
                    "unit": unit,
                    "grain": grain,
                    "window_start": candidate.period.starts_at,
                    "window_end": candidate.period.ends_at,
                },
            )

    payload, payload_error = _legacy_payload(row.get("payload_json"))
    demographics, demographic_error = _legacy_demographics(payload, row.get("unique_count"))
    if demographics is not None:
        provenance = "system_derived" if classification == "simulation" else "operator_entered"
        quality = "estimated" if classification == "simulation" else "confirmed"
        for demographic_value, demographic_count in demographics.items():
            connection.execute(
                _DEMOGRAPHIC_INSERT,
                {
                    "id": _deterministic_uuid(
                        "demographic-fact", f"{revision_id}:{demographic_value}"
                    ),
                    "report_revision_id": revision_id,
                    "classification": classification,
                    "value": demographic_value,
                    "count": demographic_count,
                    "provenance": provenance,
                    "quality": quality,
                },
            )

    connection.execute(
        _REVIEW_EVENT_INSERT,
        {
            "id": event_id,
            "enterprise_report_id": enterprise_report_id,
            "report_revision_id": revision_id,
            "enterprise_id": enterprise_id,
            "classification": classification,
            "to_state": candidate.workflow_state,
            "command_id": _deterministic_uuid("review-import-command", source_row_id),
            "occurred_at": received_at,
        },
    )
    connection.execute(
        _RECEIPT_INSERT,
        {
            "id": receipt_id,
            "enterprise_report_id": enterprise_report_id,
            "report_revision_id": revision_id,
            "enterprise_id": enterprise_id,
            "classification": classification,
            "idempotency_key": f"migration:enterprise-report:{source_row_id}",
            "payload_hash": payload_hash,
            "occurred_at": submitted_at,
            "acknowledged_at": received_at,
        },
    )

    pending_exceptions = list(candidate.pending_exceptions)
    if metric_error is not None:
        pending_exceptions.append(_PendingException("invalid_legacy_metrics", metric_error))
    if payload_error is not None:
        pending_exceptions.append(_PendingException("invalid_legacy_payload", payload_error))
    if demographic_error is not None:
        pending_exceptions.append(
            _PendingException("missing_or_invalid_demographics", demographic_error)
        )
    for pending in pending_exceptions:
        _insert_exception(
            connection,
            source_row_id=source_row_id,
            code=pending.code,
            details=pending.details,
            topology=candidate.topology,
            period=candidate.period,
            report_revision_id=revision_id,
        )


def _parse_legacy_period(period_value: object, month_value: object) -> _CanonicalPeriod:
    period_label = _required_text(period_value, "legacy report period")
    month_hint = _optional_text(month_value)
    range_match = _LEGACY_PERIOD_RANGE.fullmatch(period_label)
    month_match = _LEGACY_PERIOD_MONTH.fullmatch(period_label)
    if range_match is not None:
        start_month_label, start_day_label, end_month_label, end_day_label, year_label = (
            range_match.groups()
        )
        start_month = _month_number(start_month_label)
        end_month = _month_number(end_month_label or start_month_label)
        year = int(year_label)
        if start_month is None or end_month is None or start_month != end_month:
            raise ValueError("Legacy range does not identify one calendar month.")
        if int(start_day_label) != 1 or int(end_day_label) != monthrange(year, start_month)[1]:
            raise ValueError("Legacy range does not cover the complete calendar month.")
        month = start_month
    elif month_match is not None:
        parsed_month, year_label = month_match.groups()
        parsed_month_number = _month_number(parsed_month)
        if parsed_month_number is None:
            raise ValueError("Legacy month name is not recognized.")
        month = parsed_month_number
        year = int(year_label)
    else:
        raise ValueError("Legacy period is not a recognized month or complete month range.")

    if month_hint is not None and _month_number(month_hint) != month:
        raise ValueError("Legacy period and month columns disagree.")
    return _monthly_period(year, month)


def _monthly_period(year: int, month: int) -> _CanonicalPeriod:
    if year < 1 or year > 9999 or month < 1 or month > 12:
        raise ValueError("Reporting period year or month is outside the supported range.")
    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    local_start = datetime(year, month, 1, tzinfo=_REPORTING_TIMEZONE)
    local_end = datetime(next_year, next_month, 1, tzinfo=_REPORTING_TIMEZONE)
    natural_key = f"month:{_REPORTING_TIMEZONE_NAME}:{year:04d}-{month:02d}"
    return _CanonicalPeriod(
        id=_deterministic_uuid("reporting-period", natural_key),
        natural_key=natural_key,
        local_start_date=local_start.date(),
        local_end_date=local_end.date(),
        starts_at=local_start.astimezone(UTC),
        ends_at=local_end.astimezone(UTC),
        label=f"{month_name[month]} {year:04d}",
    )


def _month_number(label: str) -> int | None:
    return _MONTHS.get(label.strip().lower())


def _period_parameters(period: _CanonicalPeriod) -> Mapping[str, object]:
    return {
        "id": period.id,
        "natural_key": period.natural_key,
        "local_start_date": period.local_start_date,
        "local_end_date": period.local_end_date,
        "starts_at": period.starts_at,
        "ends_at": period.ends_at,
        "label": period.label,
    }


def _legacy_metric_values(
    row: Mapping[str, Any],
) -> tuple[list[tuple[str, int, str, str]] | None, Mapping[str, object] | None]:
    fields = {
        "entries": ("visitor_entries", "crossings", "enterprise"),
        "exits": ("visitor_exits", "crossings", "enterprise"),
        "peak_occupancy": ("occupancy_peak", "people", "site"),
        "unique_count": ("venue_local_unique_estimate", "estimated_visitors", "site"),
    }
    values: list[tuple[str, int, str, str]] = []
    invalid: dict[str, object] = {}
    for field, (definition, unit, grain) in fields.items():
        raw_value = row.get(field)
        if not isinstance(raw_value, int) or isinstance(raw_value, bool) or raw_value < 0:
            invalid[field] = raw_value
        else:
            values.append((definition, raw_value, unit, grain))
    entries = row.get("entries")
    exits = row.get("exits")
    if isinstance(entries, int) and isinstance(exits, int) and exits > entries:
        invalid["exitEntryRelationship"] = {"entries": entries, "exits": exits}
    if invalid:
        return None, {"invalidValues": invalid}
    return values, None


def _legacy_payload(
    value: object,
) -> tuple[Mapping[str, object] | None, Mapping[str, object] | None]:
    if value is None or str(value).strip() == "":
        return None, {"reason": "Legacy payload is absent."}
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError as exc:
        return None, {"reason": "Legacy payload is invalid JSON.", "offset": exc.pos}
    if not isinstance(parsed, dict):
        return None, {"reason": "Legacy payload root is not an object."}
    return cast("Mapping[str, object]", parsed), None


def _legacy_demographics(
    payload: Mapping[str, object] | None, unique_count_value: object
) -> tuple[dict[str, int] | None, Mapping[str, object] | None]:
    if payload is None:
        return None, {"reason": "No valid payload contains demographic facts."}
    demo = payload.get("demo")
    if not isinstance(demo, Mapping):
        return None, {"reason": "Legacy payload has no demographic object."}
    values: dict[str, int] = {}
    for field, target_value in _DEMOGRAPHIC_VALUES.items():
        count = _non_negative_int(demo.get(field))
        if count is None:
            return None, {"reason": "Demographic values are missing or invalid.", "field": field}
        values[target_value] = count
    if not isinstance(unique_count_value, int) or isinstance(unique_count_value, bool):
        return None, {"reason": "Unique estimate is invalid for demographic reconciliation."}
    if sum(values.values()) != unique_count_value:
        return None, {
            "reason": "Demographic counts do not equal the legacy unique estimate.",
            "demographicTotal": sum(values.values()),
            "legacyUniqueEstimate": unique_count_value,
        }
    return values, None


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _legacy_payload_hash(row: Mapping[str, Any]) -> str:
    payload = {
        key: row.get(key)
        for key in (
            "id",
            "report_id",
            "enterprise_account_id",
            "enterprise_id",
            "period",
            "month",
            "submitted_at",
            "received_at",
            "entries",
            "exits",
            "peak_occupancy",
            "unique_count",
            "status",
            "review_status",
            "notes",
            "remarks",
            "sync_status",
            "payload_json",
            "source_kind",
            "mock_run_id",
            "updated_at",
        )
    }
    canonical = json.dumps(
        _canonical_json_value(payload),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _canonical_json_value(value: object) -> object:
    if isinstance(value, datetime):
        normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        return normalized.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(key): _canonical_json_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_canonical_json_value(item) for item in value]
    return value


def _insert_exception(
    connection: Connection,
    *,
    source_row_id: str,
    code: str,
    details: Mapping[str, object],
    topology: _Topology | None = None,
    period: _CanonicalPeriod | None = None,
    report_revision_id: str | None = None,
) -> None:
    connection.execute(
        _EXCEPTION_INSERT,
        {
            "id": _deterministic_uuid("report-migration-exception", f"{source_row_id}:{code}"),
            "source_row_id": source_row_id,
            "exception_code": code,
            "enterprise_id": topology.enterprise_id if topology else None,
            "reporting_period_id": period.id if period else None,
            "report_revision_id": report_revision_id,
            "classification": topology.classification if topology else None,
            "details_json": json.dumps(
                _canonical_json_value(details),
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
        },
    )


def _deterministic_uuid(entity_kind: str, source_identity: str) -> str:
    return str(uuid5(_REPORTING_NAMESPACE, f"tanaw:{entity_kind}:{source_identity}"))


def _required_text(value: object, label: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise ValueError(f"Missing {label} during report migration.")
    return normalized


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _required_datetime(value: object, label: str) -> datetime:
    if not isinstance(value, datetime):
        raise ValueError(f"Missing or invalid {label} during report migration.")
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


_PERIOD_INSERT = sa.text(
    """
    INSERT INTO reporting_periods (
        id, natural_key, cadence, timezone_name, local_start_date, local_end_date,
        starts_at, ends_at, submission_opens_at, label
    ) VALUES (
        CAST(:id AS UUID), :natural_key, 'month', 'Asia/Manila',
        :local_start_date, :local_end_date, :starts_at, :ends_at, :ends_at, :label
    ) ON CONFLICT (id) DO NOTHING
    """
)

_OBLIGATION_INSERT = sa.text(
    """
    INSERT INTO reporting_obligations (
        id, reporting_period_id, enterprise_id, site_id, classification,
        eligibility_status, eligibility_basis, frozen_barangay, timezone_name,
        registration_effective_at, acceptance_blocked
    ) VALUES (
        CAST(:id AS UUID), CAST(:reporting_period_id AS UUID),
        CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID), :classification,
        'unknown', 'legacy_submission', :frozen_barangay, 'Asia/Manila',
        :registration_effective_at, true
    ) ON CONFLICT (id) DO NOTHING
    """
)

_ENTERPRISE_REPORT_INSERT = sa.text(
    """
    INSERT INTO enterprise_reports (
        id, reporting_obligation_id, enterprise_id, site_id, classification,
        workflow_state, current_revision_id, accepted_revision_id,
        logical_version, acceptance_blocked, created_at, updated_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:reporting_obligation_id AS UUID),
        CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID), :classification,
        :workflow_state, CAST(:current_revision_id AS UUID),
        CAST(:accepted_revision_id AS UUID), 1, true, :created_at, :updated_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_REVISION_INSERT = sa.text(
    """
    INSERT INTO report_revisions (
        id, enterprise_report_id, enterprise_id, site_id, classification,
        revision_number, local_revision_id, idempotency_key,
        source_window_start, source_window_end, submitted_by_account_id,
        submitted_at, received_at, payload_hash, evidence_status,
        acceptance_blocked, notes
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_report_id AS UUID),
        CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID), :classification,
        1, :local_revision_id, :idempotency_key, :source_window_start,
        :source_window_end, :submitted_by_account_id, :submitted_at,
        :received_at, :payload_hash, 'incomplete', true, :notes
    ) ON CONFLICT (id) DO NOTHING
    """
)

_METRIC_INSERT = sa.text(
    """
    INSERT INTO report_metric_facts (
        id, report_revision_id, classification, definition, definition_version,
        value, unit, grain, window_start, window_end, timezone_name,
        provenance, quality
    ) VALUES (
        CAST(:id AS UUID), CAST(:report_revision_id AS UUID), :classification,
        :definition, 1, :value, :unit, :grain, :window_start, :window_end,
        'Asia/Manila', 'camera_derived', 'degraded'
    ) ON CONFLICT (id) DO NOTHING
    """
)

_DEMOGRAPHIC_INSERT = sa.text(
    """
    INSERT INTO report_demographic_facts (
        id, report_revision_id, classification, dimension, value, count,
        provenance, quality
    ) VALUES (
        CAST(:id AS UUID), CAST(:report_revision_id AS UUID), :classification,
        'visitor_origin_gender', :value, :count, :provenance, :quality
    ) ON CONFLICT (id) DO NOTHING
    """
)

_REVIEW_EVENT_INSERT = sa.text(
    """
    INSERT INTO report_review_events (
        id, enterprise_report_id, report_revision_id, enterprise_id,
        classification, event_type, from_state, to_state, actor_account_id,
        actor_role, reason, command_id, expected_version, resulting_version,
        occurred_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_report_id AS UUID),
        CAST(:report_revision_id AS UUID), CAST(:enterprise_id AS UUID),
        :classification, 'legacy_state_imported', NULL, :to_state, NULL, NULL,
        'Imported current legacy state; intermediate review actors and events are unavailable.',
        CAST(:command_id AS UUID), 0, 1, :occurred_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_RECEIPT_INSERT = sa.text(
    """
    INSERT INTO report_intake_receipts (
        id, enterprise_report_id, report_revision_id, enterprise_id,
        classification, receipt_kind, contract_version, command_id,
        idempotency_key, payload_hash, occurred_at, acknowledged_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_report_id AS UUID),
        CAST(:report_revision_id AS UUID), CAST(:enterprise_id AS UUID),
        :classification, 'migration', NULL, NULL, :idempotency_key,
        :payload_hash, :occurred_at, :acknowledged_at
    ) ON CONFLICT (id) DO NOTHING
    """
)

_EXCEPTION_INSERT = sa.text(
    """
    INSERT INTO report_migration_exceptions (
        id, source_table, source_row_id, exception_code, enterprise_id,
        reporting_period_id, report_revision_id, classification, details_json,
        blocks_acceptance, status
    ) VALUES (
        CAST(:id AS UUID), 'enterprise_report_submissions', :source_row_id,
        :exception_code, CAST(:enterprise_id AS UUID),
        CAST(:reporting_period_id AS UUID), CAST(:report_revision_id AS UUID),
        :classification, :details_json, true, 'open'
    ) ON CONFLICT (id) DO NOTHING
    """
)
