"""Add sequenced telemetry, current live state, and durable domain events.

Revision ID: 20260713_0022
Revises: 20260713_0021

Legacy snapshots are retained as unsequenced historical observations only when
their normalized enterprise/site topology resolves. They never create a current
site state or counter epoch because legacy storage has no authoritative epoch,
generation, sequence, camera registration, coverage, or durable-outbox health.
Those gaps become explicit migration exceptions rather than fabricated facts.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import UUID, uuid5

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260713_0022"
down_revision: str | Sequence[str] | None = "20260713_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TELEMETRY_NAMESPACE = UUID("a09bc021-3717-42c2-b375-6625413650f5")
_LEGACY_METRIC_CATALOG = (
    ("entries", "visitor_entries", "crossings"),
    ("exits", "visitor_exits", "crossings"),
    ("current_occupancy", "occupancy_current", "people"),
    ("peak_occupancy", "occupancy_peak", "people"),
    ("unique_count", "venue_local_unique_estimate", "estimated_visitors"),
)


@dataclass(frozen=True)
class _Topology:
    enterprise_id: str
    site_id: str
    classification: str
    official_code: str
    device_ids: tuple[str, ...]


@dataclass(frozen=True)
class _PendingException:
    code: str
    details: Mapping[str, object]


def upgrade() -> None:
    _create_telemetry_schema()
    _create_domain_event_schema()
    _backfill_legacy_snapshots(op.get_bind())
    _create_persistence_guards()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0022 is intentionally irreversible because telemetry evidence, "
        "device epoch ordering, current-state versions, domain events, delivery attempts, "
        "and consumer receipts are durable. Restore a verified backup or deploy a forward fix."
    )


def _create_telemetry_schema() -> None:
    statements = (
        """
        CREATE TABLE device_telemetry_epochs (
            id UUID PRIMARY KEY,
            edge_device_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            counter_epoch UUID NOT NULL,
            generation BIGINT NOT NULL,
            previous_epoch_id UUID,
            command_id UUID NOT NULL,
            idempotency_key VARCHAR(240) NOT NULL,
            payload_hash VARCHAR(71) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            registered_at TIMESTAMP WITH TIME ZONE NOT NULL,
            retired_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_device_telemetry_epochs_device_scope
                FOREIGN KEY (edge_device_id, site_id, classification)
                REFERENCES edge_devices(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_device_telemetry_epochs_previous_scope
                FOREIGN KEY (previous_epoch_id, edge_device_id, site_id, classification)
                REFERENCES device_telemetry_epochs(
                    id, edge_device_id, site_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_device_telemetry_epochs_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_device_telemetry_epochs_generation CHECK (generation >= 1),
            CONSTRAINT ck_device_telemetry_epochs_status CHECK (
                status IN ('active', 'retired')
            ),
            CONSTRAINT ck_device_telemetry_epochs_retirement CHECK (
                (status = 'active' AND retired_at IS NULL) OR
                (status = 'retired' AND retired_at IS NOT NULL AND
                 retired_at >= registered_at)
            ),
            CONSTRAINT ck_device_telemetry_epochs_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT uq_device_telemetry_epochs_counter_epoch UNIQUE (
                edge_device_id, counter_epoch
            ),
            CONSTRAINT uq_device_telemetry_epochs_generation UNIQUE (
                edge_device_id, generation
            ),
            CONSTRAINT uq_device_telemetry_epochs_command_id UNIQUE (command_id),
            CONSTRAINT uq_device_telemetry_epochs_idempotency UNIQUE (
                edge_device_id, idempotency_key
            ),
            CONSTRAINT uq_device_telemetry_epochs_identity_scope UNIQUE (
                id, edge_device_id, site_id, classification
            ),
            CONSTRAINT uq_device_telemetry_epochs_generation_scope UNIQUE (
                id, edge_device_id, site_id, classification, generation
            )
        )
        """,
        """
        CREATE TABLE telemetry_observations (
            id UUID PRIMARY KEY,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            edge_device_id UUID,
            classification VARCHAR(20) NOT NULL,
            ingest_kind VARCHAR(20) NOT NULL,
            ordering_status VARCHAR(30) NOT NULL,
            telemetry_epoch_id UUID,
            epoch_generation BIGINT,
            sequence BIGINT,
            command_id UUID,
            idempotency_key VARCHAR(240),
            payload_hash VARCHAR(71) NOT NULL,
            observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            payload_json TEXT,
            became_current BOOLEAN NOT NULL DEFAULT false,
            retention_expires_at TIMESTAMP WITH TIME ZONE,
            recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_telemetry_observations_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT fk_telemetry_observations_device_scope
                FOREIGN KEY (edge_device_id, site_id, classification)
                REFERENCES edge_devices(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_telemetry_observations_epoch_scope
                FOREIGN KEY (
                    telemetry_epoch_id, edge_device_id, site_id, classification,
                    epoch_generation
                ) REFERENCES device_telemetry_epochs(
                    id, edge_device_id, site_id, classification, generation
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_telemetry_observations_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_telemetry_observations_ingest_kind CHECK (
                ingest_kind IN ('command', 'migration')
            ),
            CONSTRAINT ck_telemetry_observations_ordering_status CHECK (
                ordering_status IN ('sequenced', 'unsequenced_legacy')
            ),
            CONSTRAINT ck_telemetry_observations_ordering_evidence CHECK (
                (ingest_kind = 'command' AND ordering_status = 'sequenced' AND
                 edge_device_id IS NOT NULL AND telemetry_epoch_id IS NOT NULL AND
                 epoch_generation >= 1 AND sequence >= 0 AND command_id IS NOT NULL AND
                 idempotency_key IS NOT NULL) OR
                (ingest_kind = 'migration' AND ordering_status = 'unsequenced_legacy' AND
                 telemetry_epoch_id IS NULL AND epoch_generation IS NULL AND
                 sequence IS NULL AND command_id IS NULL AND idempotency_key IS NULL AND
                 became_current = false)
            ),
            CONSTRAINT ck_telemetry_observations_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT ck_telemetry_observations_payload_size CHECK (
                payload_json IS NULL OR length(payload_json) <= 65536
            ),
            CONSTRAINT ck_telemetry_observations_retention CHECK (
                retention_expires_at IS NULL OR retention_expires_at > received_at
            ),
            CONSTRAINT uq_telemetry_observations_command_id UNIQUE (command_id),
            CONSTRAINT uq_telemetry_observations_device_idempotency UNIQUE (
                edge_device_id, idempotency_key
            ),
            CONSTRAINT uq_telemetry_observations_enterprise_site_scope UNIQUE (
                id, enterprise_id, site_id, classification
            ),
            CONSTRAINT uq_telemetry_observations_identity_scope UNIQUE (
                id, edge_device_id, site_id, classification
            ),
            CONSTRAINT uq_telemetry_observations_ordering_scope UNIQUE (
                id, edge_device_id, site_id, classification, epoch_generation, sequence
            )
        )
        """,
        """
        CREATE TABLE telemetry_metric_facts (
            id UUID PRIMARY KEY,
            telemetry_observation_id UUID NOT NULL,
            enterprise_id UUID NOT NULL,
            site_id UUID NOT NULL,
            camera_id UUID,
            classification VARCHAR(20) NOT NULL,
            fact_status VARCHAR(30) NOT NULL,
            definition VARCHAR(120) NOT NULL,
            definition_version INTEGER NOT NULL,
            value NUMERIC(20, 6),
            unit VARCHAR(60) NOT NULL,
            grain VARCHAR(20) NOT NULL,
            metric_window_start TIMESTAMP WITH TIME ZONE,
            metric_window_end TIMESTAMP WITH TIME ZONE,
            timezone_name VARCHAR(64) NOT NULL,
            provenance VARCHAR(30) NOT NULL,
            quality VARCHAR(20) NOT NULL,
            coverage_evidence_status VARCHAR(20) NOT NULL,
            monitored_seconds BIGINT,
            expected_seconds BIGINT,
            coverage_gap_count INTEGER,
            recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_telemetry_metric_facts_observation_scope
                FOREIGN KEY (
                    telemetry_observation_id, enterprise_id, site_id, classification
                ) REFERENCES telemetry_observations(
                    id, enterprise_id, site_id, classification
                ) ON DELETE CASCADE,
            CONSTRAINT fk_telemetry_metric_facts_camera_scope
                FOREIGN KEY (camera_id, site_id, classification)
                REFERENCES cameras(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT ck_telemetry_metric_facts_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_telemetry_metric_facts_status CHECK (
                fact_status IN ('qualified', 'unqualified_legacy')
            ),
            CONSTRAINT ck_telemetry_metric_facts_grain CHECK (
                grain IN ('camera', 'site', 'legacy_unspecified')
            ),
            CONSTRAINT ck_telemetry_metric_facts_camera_grain CHECK (
                (grain = 'camera' AND camera_id IS NOT NULL) OR
                (grain IN ('site', 'legacy_unspecified') AND camera_id IS NULL)
            ),
            CONSTRAINT ck_telemetry_metric_facts_identity CHECK (
                definition_version >= 1 AND length(trim(definition)) > 0 AND
                length(trim(unit)) > 0
            ),
            CONSTRAINT ck_telemetry_metric_facts_timezone CHECK (
                timezone_name = 'Asia/Manila'
            ),
            CONSTRAINT ck_telemetry_metric_facts_window_evidence CHECK (
                (fact_status = 'qualified' AND grain IN ('camera', 'site') AND
                 metric_window_start IS NOT NULL AND
                 metric_window_end IS NOT NULL AND metric_window_end > metric_window_start) OR
                (fact_status = 'unqualified_legacy' AND grain = 'legacy_unspecified' AND
                 metric_window_start IS NULL AND
                 metric_window_end IS NULL AND coverage_evidence_status = 'not_recorded')
            ),
            CONSTRAINT ck_telemetry_metric_facts_provenance CHECK (
                provenance IN ('camera_derived', 'operator_entered', 'system_derived')
            ),
            CONSTRAINT ck_telemetry_metric_facts_quality CHECK (
                quality IN ('confirmed', 'degraded', 'estimated', 'unknown')
            ),
            CONSTRAINT ck_telemetry_metric_facts_value_quality CHECK (
                (quality = 'unknown' AND value IS NULL) OR
                (quality != 'unknown' AND value IS NOT NULL AND value >= 0)
            ),
            CONSTRAINT ck_telemetry_metric_facts_coverage_status CHECK (
                coverage_evidence_status IN ('recorded', 'not_recorded')
            ),
            CONSTRAINT ck_telemetry_metric_facts_coverage CHECK (
                (coverage_evidence_status = 'not_recorded' AND monitored_seconds IS NULL AND
                 expected_seconds IS NULL AND coverage_gap_count IS NULL) OR
                (coverage_evidence_status = 'recorded' AND monitored_seconds >= 0 AND
                 expected_seconds > 0 AND monitored_seconds <= expected_seconds AND
                 coverage_gap_count >= 0)
            )
        )
        """,
        """
        CREATE TABLE device_health_samples (
            id UUID PRIMARY KEY,
            telemetry_observation_id UUID NOT NULL,
            edge_device_id UUID NOT NULL,
            site_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            service_state VARCHAR(20) NOT NULL,
            camera_count INTEGER NOT NULL,
            streaming_camera_count INTEGER NOT NULL,
            error_camera_count INTEGER NOT NULL,
            analytics_fps DOUBLE PRECISION,
            sync_evidence_status VARCHAR(20) NOT NULL,
            pending_count INTEGER,
            oldest_pending_at TIMESTAMP WITH TIME ZONE,
            last_acknowledged_at TIMESTAMP WITH TIME ZONE,
            last_failure_at TIMESTAMP WITH TIME ZONE,
            last_failure_class VARCHAR(120),
            health_json TEXT,
            retention_expires_at TIMESTAMP WITH TIME ZONE,
            recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_device_health_samples_observation_scope
                FOREIGN KEY (
                    telemetry_observation_id, edge_device_id, site_id, classification
                ) REFERENCES telemetry_observations(
                    id, edge_device_id, site_id, classification
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_device_health_samples_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_device_health_samples_service_state CHECK (
                service_state IN ('healthy', 'degraded', 'unavailable', 'unknown')
            ),
            CONSTRAINT ck_device_health_samples_camera_counts CHECK (
                camera_count >= 0 AND streaming_camera_count >= 0 AND
                error_camera_count >= 0 AND streaming_camera_count <= camera_count AND
                error_camera_count <= camera_count
            ),
            CONSTRAINT ck_device_health_samples_analytics_fps CHECK (
                analytics_fps IS NULL OR analytics_fps >= 0
            ),
            CONSTRAINT ck_device_health_samples_sync_status CHECK (
                sync_evidence_status IN ('recorded', 'not_recorded')
            ),
            CONSTRAINT ck_device_health_samples_sync_evidence CHECK (
                (sync_evidence_status = 'not_recorded' AND pending_count IS NULL AND
                 oldest_pending_at IS NULL AND last_acknowledged_at IS NULL AND
                 last_failure_at IS NULL AND last_failure_class IS NULL) OR
                (sync_evidence_status = 'recorded' AND pending_count >= 0 AND
                 ((pending_count = 0 AND oldest_pending_at IS NULL) OR
                  (pending_count > 0 AND oldest_pending_at IS NOT NULL)) AND
                 ((last_failure_at IS NULL AND last_failure_class IS NULL) OR
                  (last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)))
            ),
            CONSTRAINT ck_device_health_samples_payload_size CHECK (
                health_json IS NULL OR length(health_json) <= 32768
            ),
            CONSTRAINT ck_device_health_samples_retention CHECK (
                retention_expires_at IS NULL OR retention_expires_at > received_at
            ),
            CONSTRAINT uq_device_health_samples_observation UNIQUE (telemetry_observation_id)
        )
        """,
        """
        CREATE TABLE site_live_state (
            site_id UUID PRIMARY KEY,
            enterprise_id UUID NOT NULL,
            edge_device_id UUID NOT NULL,
            classification VARCHAR(20) NOT NULL,
            telemetry_epoch_id UUID NOT NULL,
            telemetry_observation_id UUID NOT NULL,
            epoch_generation BIGINT NOT NULL,
            sequence BIGINT NOT NULL,
            live_state_version BIGINT NOT NULL,
            observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            received_at TIMESTAMP WITH TIME ZONE NOT NULL,
            freshness_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            offline_after_at TIMESTAMP WITH TIME ZONE NOT NULL,
            last_freshness_evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            freshness_state VARCHAR(20) NOT NULL,
            current_occupancy BIGINT,
            entries_window BIGINT,
            exits_window BIGINT,
            peak_occupancy_window BIGINT,
            unique_visitor_estimate_window BIGINT,
            metric_window_start TIMESTAMP WITH TIME ZONE,
            metric_window_end TIMESTAMP WITH TIME ZONE,
            metric_quality VARCHAR(20) NOT NULL,
            metric_provenance VARCHAR(30) NOT NULL,
            coverage_evidence_status VARCHAR(20) NOT NULL,
            monitored_seconds BIGINT,
            expected_seconds BIGINT,
            coverage_gap_count INTEGER,
            service_state VARCHAR(20) NOT NULL,
            pending_count INTEGER,
            oldest_pending_at TIMESTAMP WITH TIME ZONE,
            last_acknowledged_at TIMESTAMP WITH TIME ZONE,
            last_failure_at TIMESTAMP WITH TIME ZONE,
            last_failure_class VARCHAR(120),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_site_live_state_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT fk_site_live_state_device_scope
                FOREIGN KEY (edge_device_id, site_id, classification)
                REFERENCES edge_devices(id, site_id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_site_live_state_epoch_scope
                FOREIGN KEY (
                    telemetry_epoch_id, edge_device_id, site_id, classification,
                    epoch_generation
                ) REFERENCES device_telemetry_epochs(
                    id, edge_device_id, site_id, classification, generation
                ) ON DELETE RESTRICT,
            CONSTRAINT fk_site_live_state_observation_ordering_scope
                FOREIGN KEY (
                    telemetry_observation_id, edge_device_id, site_id, classification,
                    epoch_generation, sequence
                ) REFERENCES telemetry_observations(
                    id, edge_device_id, site_id, classification, epoch_generation, sequence
                ) ON DELETE RESTRICT,
            CONSTRAINT ck_site_live_state_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_site_live_state_ordering CHECK (
                epoch_generation >= 1 AND sequence >= 0 AND live_state_version >= 1
            ),
            CONSTRAINT ck_site_live_state_freshness CHECK (
                freshness_state IN ('fresh', 'stale', 'offline')
            ),
            CONSTRAINT ck_site_live_state_freshness_deadlines CHECK (
                freshness_expires_at > received_at AND
                offline_after_at > freshness_expires_at
            ),
            CONSTRAINT ck_site_live_state_freshness_evaluation CHECK (
                last_freshness_evaluated_at >= received_at
            ),
            CONSTRAINT ck_site_live_state_current_occupancy CHECK (
                current_occupancy IS NULL OR current_occupancy >= 0
            ),
            CONSTRAINT ck_site_live_state_entries CHECK (
                entries_window IS NULL OR entries_window >= 0
            ),
            CONSTRAINT ck_site_live_state_exits CHECK (
                exits_window IS NULL OR exits_window >= 0
            ),
            CONSTRAINT ck_site_live_state_peak CHECK (
                peak_occupancy_window IS NULL OR peak_occupancy_window >= 0
            ),
            CONSTRAINT ck_site_live_state_unique_estimate CHECK (
                unique_visitor_estimate_window IS NULL OR
                unique_visitor_estimate_window >= 0
            ),
            CONSTRAINT ck_site_live_state_stale_metrics CHECK (
                freshness_state = 'fresh' OR
                (current_occupancy IS NULL AND entries_window IS NULL AND
                 exits_window IS NULL AND peak_occupancy_window IS NULL AND
                 unique_visitor_estimate_window IS NULL)
            ),
            CONSTRAINT ck_site_live_state_metric_quality CHECK (
                metric_quality IN ('confirmed', 'degraded', 'estimated', 'unknown')
            ),
            CONSTRAINT ck_site_live_state_metric_provenance CHECK (
                metric_provenance IN ('camera_derived', 'operator_entered', 'system_derived')
            ),
            CONSTRAINT ck_site_live_state_stale_quality CHECK (
                freshness_state = 'fresh' OR metric_quality = 'unknown'
            ),
            CONSTRAINT ck_site_live_state_unknown_metrics CHECK (
                metric_quality != 'unknown' OR
                (current_occupancy IS NULL AND entries_window IS NULL AND
                 exits_window IS NULL AND peak_occupancy_window IS NULL AND
                 unique_visitor_estimate_window IS NULL)
            ),
            CONSTRAINT ck_site_live_state_metric_window CHECK (
                (metric_window_start IS NULL AND metric_window_end IS NULL) OR
                (metric_window_start IS NOT NULL AND metric_window_end IS NOT NULL AND
                 metric_window_end > metric_window_start)
            ),
            CONSTRAINT ck_site_live_state_coverage_status CHECK (
                coverage_evidence_status IN ('recorded', 'not_recorded')
            ),
            CONSTRAINT ck_site_live_state_coverage CHECK (
                (coverage_evidence_status = 'not_recorded' AND monitored_seconds IS NULL AND
                 expected_seconds IS NULL AND coverage_gap_count IS NULL) OR
                (coverage_evidence_status = 'recorded' AND monitored_seconds >= 0 AND
                 expected_seconds > 0 AND monitored_seconds <= expected_seconds AND
                 coverage_gap_count >= 0)
            ),
            CONSTRAINT ck_site_live_state_sync_backlog CHECK (
                pending_count IS NULL OR
                (pending_count >= 0 AND
                 ((pending_count = 0 AND oldest_pending_at IS NULL) OR
                  (pending_count > 0 AND oldest_pending_at IS NOT NULL)))
            ),
            CONSTRAINT ck_site_live_state_sync_failure CHECK (
                (last_failure_at IS NULL AND last_failure_class IS NULL) OR
                (last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)
            ),
            CONSTRAINT ck_site_live_state_service_state CHECK (
                service_state IN ('healthy', 'degraded', 'unavailable', 'unknown')
            )
        )
        """,
        """
        CREATE TABLE telemetry_migration_exceptions (
            id UUID PRIMARY KEY,
            source_table VARCHAR(120) NOT NULL,
            source_row_id VARCHAR(120) NOT NULL,
            exception_code VARCHAR(80) NOT NULL,
            enterprise_id UUID,
            site_id UUID,
            classification VARCHAR(20),
            telemetry_observation_id UUID REFERENCES telemetry_observations(id) ON DELETE RESTRICT,
            details_json TEXT,
            blocks_current_projection BOOLEAN NOT NULL DEFAULT true,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolved_by_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            resolution_notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_telemetry_migration_exceptions_enterprise_scope
                FOREIGN KEY (enterprise_id, classification)
                REFERENCES enterprises(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_telemetry_migration_exceptions_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_telemetry_migration_exceptions_classification CHECK (
                classification IS NULL OR classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_telemetry_migration_exceptions_scope_pair CHECK (
                (enterprise_id IS NULL AND site_id IS NULL AND classification IS NULL) OR
                (enterprise_id IS NOT NULL AND classification IS NOT NULL)
            ),
            CONSTRAINT ck_telemetry_migration_exceptions_status CHECK (
                status IN ('open', 'resolved', 'waived')
            ),
            CONSTRAINT ck_telemetry_migration_exceptions_details_size CHECK (
                details_json IS NULL OR length(details_json) <= 20000
            ),
            CONSTRAINT ck_telemetry_migration_exceptions_resolution CHECK (
                (status = 'open' AND resolved_at IS NULL AND
                 resolved_by_account_id IS NULL) OR
                (status IN ('resolved', 'waived') AND resolved_at IS NOT NULL AND
                 resolved_by_account_id IS NOT NULL)
            ),
            CONSTRAINT uq_telemetry_migration_exceptions_source_code UNIQUE (
                source_table, source_row_id, exception_code
            )
        )
        """,
    )
    for statement in statements:
        op.execute(statement)

    indexes = (
        "CREATE UNIQUE INDEX uq_device_telemetry_epochs_active_device ON device_telemetry_epochs (edge_device_id) WHERE status = 'active'",
        "CREATE INDEX ix_device_telemetry_epochs_device_registered ON device_telemetry_epochs (edge_device_id, registered_at)",
        "CREATE UNIQUE INDEX uq_telemetry_observations_device_epoch_sequence ON telemetry_observations (edge_device_id, telemetry_epoch_id, sequence) WHERE ordering_status = 'sequenced'",
        "CREATE INDEX ix_telemetry_observations_site_observed ON telemetry_observations (site_id, observed_at DESC)",
        "CREATE INDEX ix_telemetry_observations_device_received ON telemetry_observations (edge_device_id, received_at DESC)",
        "CREATE INDEX ix_telemetry_observations_retention ON telemetry_observations (retention_expires_at)",
        "CREATE UNIQUE INDEX uq_telemetry_metric_facts_site_definition ON telemetry_metric_facts (telemetry_observation_id, definition, definition_version) WHERE grain = 'site'",
        "CREATE UNIQUE INDEX uq_telemetry_metric_facts_camera_definition ON telemetry_metric_facts (telemetry_observation_id, camera_id, definition, definition_version) WHERE grain = 'camera'",
        "CREATE UNIQUE INDEX uq_telemetry_metric_facts_legacy_definition ON telemetry_metric_facts (telemetry_observation_id, definition, definition_version) WHERE grain = 'legacy_unspecified'",
        "CREATE INDEX ix_telemetry_metric_facts_site_window ON telemetry_metric_facts (site_id, metric_window_end DESC)",
        "CREATE INDEX ix_telemetry_metric_facts_definition_window ON telemetry_metric_facts (definition, metric_window_end DESC)",
        "CREATE INDEX ix_device_health_samples_device_observed ON device_health_samples (edge_device_id, observed_at DESC)",
        "CREATE INDEX ix_device_health_samples_retention ON device_health_samples (retention_expires_at)",
        "CREATE INDEX ix_site_live_state_enterprise ON site_live_state (enterprise_id)",
        "CREATE INDEX ix_site_live_state_freshness ON site_live_state (classification, freshness_state)",
        "CREATE INDEX ix_site_live_state_offline_after ON site_live_state (offline_after_at)",
        "CREATE INDEX ix_telemetry_migration_exceptions_open_projection ON telemetry_migration_exceptions (status, blocks_current_projection) WHERE status = 'open' AND blocks_current_projection = true",
        "CREATE INDEX ix_telemetry_migration_exceptions_observation ON telemetry_migration_exceptions (telemetry_observation_id)",
    )
    for statement in indexes:
        op.execute(statement)


def _create_domain_event_schema() -> None:
    statements = (
        """
        CREATE TABLE domain_events (
            id UUID PRIMARY KEY,
            event_key VARCHAR(240) NOT NULL,
            event_type VARCHAR(120) NOT NULL,
            contract_version INTEGER NOT NULL DEFAULT 2,
            schema_version INTEGER NOT NULL DEFAULT 1,
            aggregate_type VARCHAR(80) NOT NULL,
            aggregate_id UUID NOT NULL,
            aggregate_version INTEGER NOT NULL,
            enterprise_id UUID,
            site_id UUID,
            classification VARCHAR(20) NOT NULL,
            actor_account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE RESTRICT,
            correlation_id UUID,
            causation_id UUID,
            payload_json TEXT NOT NULL,
            payload_hash VARCHAR(71) NOT NULL,
            occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
            recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            available_at TIMESTAMP WITH TIME ZONE NOT NULL,
            retention_expires_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT fk_domain_events_enterprise_scope
                FOREIGN KEY (enterprise_id, classification)
                REFERENCES enterprises(id, classification) ON DELETE RESTRICT,
            CONSTRAINT fk_domain_events_site_scope
                FOREIGN KEY (site_id, enterprise_id, classification)
                REFERENCES enterprise_sites(id, enterprise_id, classification)
                ON DELETE RESTRICT,
            CONSTRAINT ck_domain_events_classification CHECK (
                classification IN ('official', 'simulation')
            ),
            CONSTRAINT ck_domain_events_site_enterprise CHECK (
                site_id IS NULL OR enterprise_id IS NOT NULL
            ),
            CONSTRAINT ck_domain_events_contract_version CHECK (contract_version = 2),
            CONSTRAINT ck_domain_events_schema_version CHECK (schema_version >= 1),
            CONSTRAINT ck_domain_events_aggregate_version CHECK (aggregate_version >= 1),
            CONSTRAINT ck_domain_events_payload_hash CHECK (
                length(payload_hash) = 71 AND payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT ck_domain_events_payload_size CHECK (length(payload_json) <= 65536),
            CONSTRAINT ck_domain_events_retention CHECK (
                retention_expires_at IS NULL OR retention_expires_at > recorded_at
            ),
            CONSTRAINT uq_domain_events_event_key UNIQUE (event_key)
        )
        """,
        """
        CREATE TABLE domain_event_deliveries (
            id UUID PRIMARY KEY,
            domain_event_id UUID NOT NULL REFERENCES domain_events(id) ON DELETE RESTRICT,
            destination VARCHAR(120) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
            lock_token UUID,
            locked_at TIMESTAMP WITH TIME ZONE,
            lock_expires_at TIMESTAMP WITH TIME ZONE,
            delivered_at TIMESTAMP WITH TIME ZONE,
            dead_lettered_at TIMESTAMP WITH TIME ZONE,
            last_error_code VARCHAR(120),
            last_error_message VARCHAR(2000),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_domain_event_deliveries_status CHECK (
                status IN ('pending', 'leased', 'retry_scheduled', 'delivered', 'dead_letter')
            ),
            CONSTRAINT ck_domain_event_deliveries_attempt_count CHECK (attempt_count >= 0),
            CONSTRAINT ck_domain_event_deliveries_lease CHECK (
                (status = 'leased' AND lock_token IS NOT NULL AND locked_at IS NOT NULL AND
                 lock_expires_at IS NOT NULL AND lock_expires_at > locked_at) OR
                (status != 'leased' AND lock_token IS NULL AND locked_at IS NULL AND
                 lock_expires_at IS NULL)
            ),
            CONSTRAINT ck_domain_event_deliveries_delivered CHECK (
                (status = 'delivered' AND delivered_at IS NOT NULL) OR
                (status != 'delivered' AND delivered_at IS NULL)
            ),
            CONSTRAINT ck_domain_event_deliveries_dead_letter CHECK (
                (status = 'dead_letter' AND dead_lettered_at IS NOT NULL) OR
                (status != 'dead_letter' AND dead_lettered_at IS NULL)
            ),
            CONSTRAINT uq_domain_event_deliveries_destination UNIQUE (
                domain_event_id, destination
            ),
            CONSTRAINT uq_domain_event_deliveries_identity_event UNIQUE (
                id, domain_event_id
            )
        )
        """,
        """
        CREATE TABLE domain_event_delivery_attempts (
            id UUID PRIMARY KEY,
            domain_event_id UUID NOT NULL,
            domain_event_delivery_id UUID NOT NULL,
            attempt_number INTEGER NOT NULL,
            worker_id VARCHAR(120) NOT NULL,
            outcome VARCHAR(30) NOT NULL,
            error_code VARCHAR(120),
            error_message VARCHAR(2000),
            started_at TIMESTAMP WITH TIME ZONE NOT NULL,
            completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT fk_domain_event_delivery_attempts_delivery_event
                FOREIGN KEY (domain_event_delivery_id, domain_event_id)
                REFERENCES domain_event_deliveries(id, domain_event_id) ON DELETE RESTRICT,
            CONSTRAINT ck_domain_event_delivery_attempts_number CHECK (attempt_number >= 1),
            CONSTRAINT ck_domain_event_delivery_attempts_outcome CHECK (
                outcome IN ('succeeded', 'retryable_failure', 'terminal_failure')
            ),
            CONSTRAINT ck_domain_event_delivery_attempts_duration CHECK (
                completed_at >= started_at
            ),
            CONSTRAINT ck_domain_event_delivery_attempts_error CHECK (
                (outcome = 'succeeded' AND error_code IS NULL AND error_message IS NULL) OR
                (outcome != 'succeeded' AND error_code IS NOT NULL)
            ),
            CONSTRAINT uq_domain_event_delivery_attempts_number UNIQUE (
                domain_event_delivery_id, attempt_number
            )
        )
        """,
        """
        CREATE TABLE domain_event_consumer_receipts (
            id UUID PRIMARY KEY,
            domain_event_id UUID NOT NULL REFERENCES domain_events(id) ON DELETE RESTRICT,
            consumer_name VARCHAR(120) NOT NULL,
            disposition VARCHAR(30) NOT NULL,
            event_payload_hash VARCHAR(71) NOT NULL,
            consumed_at TIMESTAMP WITH TIME ZONE NOT NULL,
            result_reference VARCHAR(240),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_domain_event_consumer_receipts_disposition CHECK (
                disposition IN ('applied', 'already_applied', 'ignored')
            ),
            CONSTRAINT ck_domain_event_consumer_receipts_hash CHECK (
                length(event_payload_hash) = 71 AND event_payload_hash LIKE 'sha256:%'
            ),
            CONSTRAINT uq_domain_event_consumer_receipts_consumer UNIQUE (
                domain_event_id, consumer_name
            )
        )
        """,
    )
    for statement in statements:
        op.execute(statement)

    indexes = (
        "CREATE INDEX ix_domain_events_aggregate_version ON domain_events (aggregate_type, aggregate_id, aggregate_version)",
        "CREATE INDEX ix_domain_events_available ON domain_events (available_at, recorded_at)",
        "CREATE INDEX ix_domain_events_retention ON domain_events (retention_expires_at)",
        "CREATE INDEX ix_domain_event_deliveries_ready ON domain_event_deliveries (next_attempt_at, created_at) WHERE status IN ('pending', 'retry_scheduled')",
        "CREATE INDEX ix_domain_event_deliveries_lease_expiry ON domain_event_deliveries (lock_expires_at)",
        "CREATE INDEX ix_domain_event_delivery_attempts_event ON domain_event_delivery_attempts (domain_event_id, started_at)",
        "CREATE INDEX ix_domain_event_consumer_receipts_consumed ON domain_event_consumer_receipts (consumer_name, consumed_at)",
    )
    for statement in indexes:
        op.execute(statement)


def _backfill_legacy_snapshots(connection: Connection) -> None:
    rows = connection.execute(
        sa.text(
            """
            SELECT id, enterprise_account_id, enterprise_id, enterprise_name,
                   camera_id, camera_name, captured_at, received_at, entries, exits,
                   current_occupancy, peak_occupancy, unique_count,
                   confirmed_unique_count, degraded_unique_count, total_events,
                   unsubmitted_events, unsynced_events, running, status, error,
                   analytics_fps, payload_json, source_kind, mock_run_id
            FROM enterprise_telemetry_snapshots
            ORDER BY received_at, id
            """
        )
    ).mappings()

    for raw_row in rows:
        row = cast("Mapping[str, Any]", raw_row)
        source_row_id = _required_text(row.get("id"), "legacy telemetry row id")
        topology_rows = _topology_for_account(connection, row.get("enterprise_account_id"))
        if len(topology_rows) != 1:
            _insert_exception(
                connection,
                source_row_id=source_row_id,
                code="ambiguous_enterprise_site_topology",
                details={
                    "enterpriseAccountId": row.get("enterprise_account_id"),
                    "resolvedSiteCount": len(topology_rows),
                },
            )
            continue

        _backfill_snapshot(connection, row, topology_rows[0])


def _backfill_snapshot(
    connection: Connection,
    row: Mapping[str, Any],
    topology: _Topology,
) -> None:
    source_row_id = _required_text(row.get("id"), "legacy telemetry row id")
    observation_id = _deterministic_uuid("telemetry-observation", source_row_id)
    pending = _snapshot_exceptions(row, topology)
    metric_values, metric_error = _legacy_metric_values(row)
    if metric_error is not None:
        pending.append(_PendingException("invalid_legacy_metrics", metric_error))
    payload_json, payload_error = _bounded_legacy_payload(row.get("payload_json"))
    if payload_error is not None:
        pending.append(_PendingException("invalid_legacy_payload", payload_error))

    observed_at = _required_datetime(row.get("captured_at"), "legacy captured_at")
    received_at = _required_datetime(row.get("received_at"), "legacy received_at")
    connection.execute(
        _OBSERVATION_INSERT,
        {
            "id": observation_id,
            "enterprise_id": topology.enterprise_id,
            "site_id": topology.site_id,
            "edge_device_id": topology.device_ids[0] if len(topology.device_ids) == 1 else None,
            "classification": topology.classification,
            "payload_hash": _legacy_payload_hash(row),
            "observed_at": observed_at,
            "received_at": received_at,
            "payload_json": payload_json,
        },
    )
    for source_field, definition, unit in _LEGACY_METRIC_CATALOG:
        value = metric_values.get(source_field)
        if value is None:
            continue
        connection.execute(
            _METRIC_FACT_INSERT,
            {
                "id": _deterministic_uuid(
                    "telemetry-metric-fact",
                    f"{source_row_id}:{definition}:1:legacy_unspecified",
                ),
                "telemetry_observation_id": observation_id,
                "enterprise_id": topology.enterprise_id,
                "site_id": topology.site_id,
                "classification": topology.classification,
                "definition": definition,
                "value": value,
                "unit": unit,
            },
        )

    if len(topology.device_ids) == 1:
        health_json = json.dumps(
            {
                "legacyError": _optional_text(row.get("error")),
                "legacyStatus": _optional_text(row.get("status")),
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        camera_count = 1 if row.get("camera_id") or row.get("camera_name") else 0
        service_state = _legacy_service_state(row)
        analytics_fps = _non_negative_float(row.get("analytics_fps"))
        if row.get("analytics_fps") is not None and analytics_fps is None:
            pending.append(
                _PendingException(
                    "invalid_legacy_health_metric",
                    {"analyticsFps": row.get("analytics_fps")},
                )
            )
        connection.execute(
            _HEALTH_INSERT,
            {
                "id": _deterministic_uuid("device-health-sample", source_row_id),
                "telemetry_observation_id": observation_id,
                "edge_device_id": topology.device_ids[0],
                "site_id": topology.site_id,
                "classification": topology.classification,
                "observed_at": observed_at,
                "received_at": received_at,
                "service_state": service_state,
                "camera_count": camera_count,
                "streaming_camera_count": 1 if camera_count and bool(row.get("running")) else 0,
                "error_camera_count": 1
                if camera_count and (_optional_text(row.get("error")) is not None)
                else 0,
                "analytics_fps": analytics_fps,
                "health_json": health_json,
            },
        )

    for exception in pending:
        _insert_exception(
            connection,
            source_row_id=source_row_id,
            code=exception.code,
            details=exception.details,
            topology=topology,
            observation_id=observation_id,
        )


def _topology_for_account(connection: Connection, account_id: object) -> list[_Topology]:
    normalized_account_id = _optional_text(account_id)
    if normalized_account_id is None:
        return []
    rows = list(
        connection.execute(
            sa.text(
                """
                SELECT enterprise.id AS enterprise_id,
                       site.id AS site_id,
                       enterprise.classification,
                       enterprise.official_code
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
    )
    topologies: list[_Topology] = []
    for row in rows:
        device_ids = tuple(
            str(value)
            for value in connection.scalars(
                sa.text(
                    """
                    SELECT id
                    FROM edge_devices
                    WHERE site_id = CAST(:site_id AS UUID)
                      AND classification = :classification
                      AND lifecycle_state = 'active'
                    ORDER BY id
                    """
                ),
                {
                    "site_id": str(row["site_id"]),
                    "classification": str(row["classification"]),
                },
            )
        )
        topologies.append(
            _Topology(
                enterprise_id=str(row["enterprise_id"]),
                site_id=str(row["site_id"]),
                classification=str(row["classification"]),
                official_code=str(row["official_code"]),
                device_ids=device_ids,
            )
        )
    return topologies


def _snapshot_exceptions(row: Mapping[str, Any], topology: _Topology) -> list[_PendingException]:
    exceptions = [
        _PendingException(
            "missing_epoch_sequence_evidence",
            {
                "reason": (
                    "Legacy telemetry has no registered counter epoch, server generation, "
                    "or monotonic device sequence and cannot become current."
                )
            },
        ),
        _PendingException(
            "missing_metric_coverage",
            {"reason": ("Legacy telemetry has no monitored/expected duration or coverage gaps.")},
        ),
        _PendingException(
            "missing_camera_lineage",
            {
                "legacyCameraId": row.get("camera_id"),
                "legacyCameraName": row.get("camera_name"),
                "reason": "No authoritative central camera identity is referenced.",
            },
        ),
    ]
    if len(topology.device_ids) != 1:
        exceptions.append(
            _PendingException(
                "ambiguous_edge_device_identity",
                {"resolvedActiveDeviceCount": len(topology.device_ids)},
            )
        )
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
    if _non_negative_int(row.get("unsynced_events")) not in {None, 0}:
        exceptions.append(
            _PendingException(
                "untrusted_legacy_sync_backlog",
                {
                    "legacyUnsyncedEvents": row.get("unsynced_events"),
                    "reason": "Pre-ack event counts are not durable outbox backlog evidence.",
                },
            )
        )
    return exceptions


def _legacy_metric_values(
    row: Mapping[str, Any],
) -> tuple[dict[str, int | None], Mapping[str, object] | None]:
    fields = ("entries", "exits", "current_occupancy", "peak_occupancy", "unique_count")
    values: dict[str, int | None] = {}
    invalid: dict[str, object] = {}
    for field in fields:
        value = _non_negative_int(row.get(field))
        values[field] = value
        if value is None:
            invalid[field] = row.get(field)
    return values, {"invalidValues": invalid} if invalid else None


def _legacy_service_state(row: Mapping[str, Any]) -> str:
    status = (_optional_text(row.get("status")) or "").lower()
    if _optional_text(row.get("error")) is not None or status == "error":
        return "unavailable"
    if bool(row.get("running")) and status in {"running", "healthy", "ok"}:
        return "healthy"
    return "unknown"


def _bounded_legacy_payload(
    value: object,
) -> tuple[str | None, Mapping[str, object] | None]:
    if value is None or str(value).strip() == "":
        return None, None
    raw = str(value)
    if len(raw) > 65_536:
        return None, {"reason": "Legacy payload exceeds 65536 characters.", "size": len(raw)}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, {"reason": "Legacy payload is invalid JSON.", "offset": exc.pos}
    if not isinstance(parsed, dict):
        return None, {"reason": "Legacy payload root is not an object."}
    return raw, None


def _legacy_payload_hash(row: Mapping[str, Any]) -> str:
    payload = {
        key: row.get(key)
        for key in (
            "id",
            "enterprise_account_id",
            "enterprise_id",
            "camera_id",
            "camera_name",
            "captured_at",
            "received_at",
            "entries",
            "exits",
            "current_occupancy",
            "peak_occupancy",
            "unique_count",
            "confirmed_unique_count",
            "degraded_unique_count",
            "total_events",
            "unsubmitted_events",
            "unsynced_events",
            "running",
            "status",
            "error",
            "analytics_fps",
            "payload_json",
            "source_kind",
            "mock_run_id",
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
    observation_id: str | None = None,
) -> None:
    connection.execute(
        _EXCEPTION_INSERT,
        {
            "id": _deterministic_uuid("telemetry-migration-exception", f"{source_row_id}:{code}"),
            "source_row_id": source_row_id,
            "exception_code": code,
            "enterprise_id": topology.enterprise_id if topology else None,
            "site_id": topology.site_id if topology else None,
            "classification": topology.classification if topology else None,
            "telemetry_observation_id": observation_id,
            "details_json": json.dumps(
                _canonical_json_value(details),
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
        },
    )


def _non_negative_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _non_negative_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    normalized = float(value)
    return normalized if normalized >= 0 else None


def _required_text(value: object, label: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise ValueError(f"Missing {label} during telemetry migration.")
    return normalized


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _required_datetime(value: object, label: str) -> datetime:
    if not isinstance(value, datetime):
        raise ValueError(f"Missing or invalid {label} during telemetry migration.")
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _deterministic_uuid(entity_kind: str, source_identity: str) -> str:
    return str(uuid5(_TELEMETRY_NAMESPACE, f"tanaw:{entity_kind}:{source_identity}"))


def _create_persistence_guards() -> None:
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_device_telemetry_epoch()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            latest device_telemetry_epochs%ROWTYPE;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Device telemetry epochs cannot be deleted';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF OLD.status != 'active' OR NEW.status != 'retired'
                   OR NEW.retired_at IS NULL
                   OR NEW.id IS DISTINCT FROM OLD.id
                   OR NEW.edge_device_id IS DISTINCT FROM OLD.edge_device_id
                   OR NEW.site_id IS DISTINCT FROM OLD.site_id
                   OR NEW.classification IS DISTINCT FROM OLD.classification
                   OR NEW.counter_epoch IS DISTINCT FROM OLD.counter_epoch
                   OR NEW.generation IS DISTINCT FROM OLD.generation
                   OR NEW.previous_epoch_id IS DISTINCT FROM OLD.previous_epoch_id
                   OR NEW.command_id IS DISTINCT FROM OLD.command_id
                   OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
                   OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
                   OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'Epoch updates may only retire the active epoch';
                END IF;
                RETURN NEW;
            END IF;

            SELECT * INTO latest
            FROM device_telemetry_epochs
            WHERE edge_device_id = NEW.edge_device_id
            ORDER BY generation DESC
            LIMIT 1;
            IF NOT FOUND THEN
                IF NEW.generation != 1 OR NEW.previous_epoch_id IS NOT NULL THEN
                    RAISE EXCEPTION 'First telemetry epoch must use generation 1';
                END IF;
            ELSIF NEW.generation != latest.generation + 1
               OR NEW.previous_epoch_id IS DISTINCT FROM latest.id
               OR latest.status != 'retired' THEN
                RAISE EXCEPTION 'Telemetry epoch generation must follow the retired latest epoch';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_device_telemetry_epochs_guard
        BEFORE INSERT OR UPDATE OR DELETE ON device_telemetry_epochs
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_device_telemetry_epoch()
        """
    )

    op.execute(
        """
        CREATE FUNCTION tanaw_guard_site_live_state_monotonic()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            old_freshness_rank INTEGER;
            new_freshness_rank INTEGER;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Site live state cannot be deleted';
            END IF;
            IF TG_OP = 'INSERT' THEN
                IF NEW.live_state_version != 1 OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Initial site live state must be fresh version 1';
                END IF;
                RETURN NEW;
            END IF;
            IF NEW.live_state_version != OLD.live_state_version + 1 THEN
                RAISE EXCEPTION 'Live-state version must increment exactly once';
            END IF;
            IF NEW.site_id IS DISTINCT FROM OLD.site_id
               OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
               OR NEW.classification IS DISTINCT FROM OLD.classification THEN
                RAISE EXCEPTION 'Live-state topology identity cannot change';
            END IF;
            IF (NEW.epoch_generation, NEW.sequence) <
               (OLD.epoch_generation, OLD.sequence) THEN
                RAISE EXCEPTION 'Older telemetry cannot replace current site state';
            END IF;
            IF (NEW.epoch_generation, NEW.sequence) >
               (OLD.epoch_generation, OLD.sequence) THEN
                IF NEW.received_at < OLD.received_at OR NEW.freshness_state != 'fresh' THEN
                    RAISE EXCEPTION 'Newer telemetry must be received later and become fresh';
                END IF;
                RETURN NEW;
            END IF;

            IF NEW.edge_device_id IS DISTINCT FROM OLD.edge_device_id
               OR NEW.telemetry_epoch_id IS DISTINCT FROM OLD.telemetry_epoch_id
               OR NEW.telemetry_observation_id IS DISTINCT FROM OLD.telemetry_observation_id
               OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
               OR NEW.received_at IS DISTINCT FROM OLD.received_at
               OR NEW.freshness_expires_at IS DISTINCT FROM OLD.freshness_expires_at
               OR NEW.offline_after_at IS DISTINCT FROM OLD.offline_after_at
               OR NEW.metric_window_start IS DISTINCT FROM OLD.metric_window_start
               OR NEW.metric_window_end IS DISTINCT FROM OLD.metric_window_end
               OR NEW.metric_provenance IS DISTINCT FROM OLD.metric_provenance
               OR NEW.coverage_evidence_status IS DISTINCT FROM OLD.coverage_evidence_status
               OR NEW.monitored_seconds IS DISTINCT FROM OLD.monitored_seconds
               OR NEW.expected_seconds IS DISTINCT FROM OLD.expected_seconds
               OR NEW.coverage_gap_count IS DISTINCT FROM OLD.coverage_gap_count
               OR NEW.service_state IS DISTINCT FROM OLD.service_state
               OR NEW.pending_count IS DISTINCT FROM OLD.pending_count
               OR NEW.oldest_pending_at IS DISTINCT FROM OLD.oldest_pending_at
               OR NEW.last_acknowledged_at IS DISTINCT FROM OLD.last_acknowledged_at
               OR NEW.last_failure_at IS DISTINCT FROM OLD.last_failure_at
               OR NEW.last_failure_class IS DISTINCT FROM OLD.last_failure_class THEN
                RAISE EXCEPTION 'Equal telemetry ordering may only advance freshness';
            END IF;

            old_freshness_rank := CASE OLD.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            new_freshness_rank := CASE NEW.freshness_state
                WHEN 'fresh' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END;
            IF NEW.last_freshness_evaluated_at < OLD.last_freshness_evaluated_at THEN
                RAISE EXCEPTION 'Freshness evaluation time cannot move backward';
            END IF;
            IF new_freshness_rank < old_freshness_rank THEN
                RAISE EXCEPTION 'Freshness cannot recover without newer telemetry';
            END IF;
            IF (NEW.current_occupancy IS DISTINCT FROM OLD.current_occupancy
                AND NEW.current_occupancy IS NOT NULL)
               OR (NEW.entries_window IS DISTINCT FROM OLD.entries_window
                   AND NEW.entries_window IS NOT NULL)
               OR (NEW.exits_window IS DISTINCT FROM OLD.exits_window
                   AND NEW.exits_window IS NOT NULL)
               OR (NEW.peak_occupancy_window IS DISTINCT FROM OLD.peak_occupancy_window
                   AND NEW.peak_occupancy_window IS NOT NULL)
               OR (NEW.unique_visitor_estimate_window IS DISTINCT FROM
                   OLD.unique_visitor_estimate_window
                   AND NEW.unique_visitor_estimate_window IS NOT NULL)
               OR (NEW.metric_quality IS DISTINCT FROM OLD.metric_quality
                   AND NEW.metric_quality != 'unknown') THEN
                RAISE EXCEPTION 'Equal telemetry ordering cannot introduce metric values';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_site_live_state_monotonic
        BEFORE INSERT OR UPDATE OR DELETE ON site_live_state
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_site_live_state_monotonic()
        """
    )

    op.execute(
        """
        CREATE FUNCTION tanaw_reject_append_only_update()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only; updates are forbidden', TG_TABLE_NAME;
        END;
        $$
        """
    )
    for table_name in (
        "telemetry_observations",
        "telemetry_metric_facts",
        "device_health_samples",
        "domain_events",
        "domain_event_delivery_attempts",
        "domain_event_consumer_receipts",
    ):
        op.execute(
            f"""
            CREATE TRIGGER trg_{table_name}_append_only
            BEFORE UPDATE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION tanaw_reject_append_only_update()
            """
        )

    op.execute(
        """
        CREATE FUNCTION tanaw_guard_domain_event_delivery()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.domain_event_id IS DISTINCT FROM OLD.domain_event_id
               OR NEW.destination IS DISTINCT FROM OLD.destination
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Domain-event delivery identity cannot change';
            END IF;
            IF NEW.attempt_count < OLD.attempt_count THEN
                RAISE EXCEPTION 'Domain-event delivery attempts cannot decrease';
            END IF;
            IF OLD.status IN ('delivered', 'dead_letter') AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION 'Terminal domain-event delivery cannot change';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_domain_event_deliveries_guard
        BEFORE UPDATE ON domain_event_deliveries
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_domain_event_delivery()
        """
    )

    op.execute(
        """
        CREATE FUNCTION tanaw_validate_domain_event_consumer_receipt()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM domain_events event
                WHERE event.id = NEW.domain_event_id
                  AND event.payload_hash = NEW.event_payload_hash
            ) THEN
                RAISE EXCEPTION 'Consumer receipt payload hash does not match its domain event';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_domain_event_consumer_receipts_hash
        BEFORE INSERT ON domain_event_consumer_receipts
        FOR EACH ROW EXECUTE FUNCTION tanaw_validate_domain_event_consumer_receipt()
        """
    )


_OBSERVATION_INSERT = sa.text(
    """
    INSERT INTO telemetry_observations (
        id, enterprise_id, site_id, edge_device_id, classification,
        ingest_kind, ordering_status, payload_hash, observed_at, received_at,
        payload_json, became_current
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID),
        CAST(:edge_device_id AS UUID), :classification, 'migration',
        'unsequenced_legacy', :payload_hash, :observed_at, :received_at,
        :payload_json, false
    ) ON CONFLICT (id) DO NOTHING
    """
)

_METRIC_FACT_INSERT = sa.text(
    """
    INSERT INTO telemetry_metric_facts (
        id, telemetry_observation_id, enterprise_id, site_id, classification,
        fact_status, definition, definition_version, value, unit, grain,
        timezone_name, provenance, quality, coverage_evidence_status
    ) VALUES (
        CAST(:id AS UUID), CAST(:telemetry_observation_id AS UUID),
        CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID), :classification,
        'unqualified_legacy', :definition, 1, :value, :unit, 'legacy_unspecified',
        'Asia/Manila', 'camera_derived', 'degraded', 'not_recorded'
    ) ON CONFLICT (id) DO NOTHING
    """
)

_HEALTH_INSERT = sa.text(
    """
    INSERT INTO device_health_samples (
        id, telemetry_observation_id, edge_device_id, site_id, classification,
        observed_at, received_at, service_state, camera_count,
        streaming_camera_count, error_camera_count, analytics_fps,
        sync_evidence_status, health_json
    ) VALUES (
        CAST(:id AS UUID), CAST(:telemetry_observation_id AS UUID),
        CAST(:edge_device_id AS UUID), CAST(:site_id AS UUID), :classification,
        :observed_at, :received_at, :service_state, :camera_count,
        :streaming_camera_count, :error_camera_count, :analytics_fps,
        'not_recorded', :health_json
    ) ON CONFLICT (id) DO NOTHING
    """
)

_EXCEPTION_INSERT = sa.text(
    """
    INSERT INTO telemetry_migration_exceptions (
        id, source_table, source_row_id, exception_code, enterprise_id, site_id,
        classification, telemetry_observation_id, details_json,
        blocks_current_projection, status
    ) VALUES (
        CAST(:id AS UUID), 'enterprise_telemetry_snapshots', :source_row_id,
        :exception_code, CAST(:enterprise_id AS UUID), CAST(:site_id AS UUID),
        :classification, CAST(:telemetry_observation_id AS UUID), :details_json,
        true, 'open'
    ) ON CONFLICT (id) DO NOTHING
    """
)
