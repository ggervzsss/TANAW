"""Make canonical reporting periods discoverable and lifecycle managed.

Revision ID: 20260713_0027
Revises: 20260713_0026

Reporting periods remain a classification-neutral calendar dimension: one
portable natural key is shared by official and simulation consumers.  This
revision persists the submission lifecycle, validates exact Asia/Manila month
boundaries in PostgreSQL, prevents overlapping periods, and freezes topology
display identity on historical obligations.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260713_0027"
down_revision: str | Sequence[str] | None = "20260713_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    _extend_reporting_periods()
    _enforce_canonical_periods()
    _freeze_obligation_identity()
    _create_discovery_indexes()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0027 is intentionally irreversible because canonical period "
        "lifecycle and frozen obligation identity are durable reporting evidence. Restore "
        "the verified pre-cutover backup and matching application build instead."
    )


def _extend_reporting_periods() -> None:
    op.add_column(
        "reporting_periods",
        sa.Column("submission_closes_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "reporting_periods",
        sa.Column("status", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "reporting_periods",
        sa.Column("obligations_frozen_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Existing periods are protected by the 0021 immutable trigger. This is an
    # access-exclusive, transactional cutover; the replacement guard is installed
    # below before application writes can resume.
    op.execute("LOCK TABLE reporting_periods IN ACCESS EXCLUSIVE MODE")
    op.execute("ALTER TABLE reporting_periods DISABLE TRIGGER trg_reporting_periods_immutable")
    op.execute(
        """
        UPDATE reporting_periods
        SET submission_closes_at = submission_opens_at + INTERVAL '15 days',
            status = CASE
                WHEN CURRENT_TIMESTAMP < submission_opens_at THEN 'scheduled'
                WHEN CURRENT_TIMESTAMP < submission_opens_at + INTERVAL '15 days' THEN 'open'
                ELSE 'closed'
            END
        """
    )
    op.execute(
        """
        UPDATE reporting_periods AS period
        SET obligations_frozen_at = marker.occurred_at
        FROM domain_events AS marker
        WHERE marker.event_key = concat(
            'reporting-period', chr(58), period.id::text, chr(58),
            'official-obligations-frozen', chr(58), 'v1'
        )
          AND marker.event_type = 'reporting_period.obligations_frozen'
          AND marker.classification = 'official'
        """
    )
    op.execute("ALTER TABLE reporting_periods ENABLE TRIGGER trg_reporting_periods_immutable")

    op.alter_column(
        "reporting_periods",
        "submission_closes_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.alter_column(
        "reporting_periods",
        "status",
        existing_type=sa.String(length=20),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_reporting_periods_submission_close",
        "reporting_periods",
        "submission_closes_at > submission_opens_at",
    )
    op.create_check_constraint(
        "ck_reporting_periods_status",
        "reporting_periods",
        "status IN ('scheduled', 'open', 'closed')",
    )


def _enforce_canonical_periods() -> None:
    op.execute(
        """
        CREATE FUNCTION tanaw_validate_canonical_reporting_period()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            period_year INTEGER;
            period_month INTEGER;
            expected_local_start DATE;
            expected_local_end DATE;
            expected_start TIMESTAMP WITH TIME ZONE;
            expected_end TIMESTAMP WITH TIME ZONE;
        BEGIN
            IF NEW.natural_key !~ (
                '^month' || chr(58) || 'Asia/Manila' || chr(58)
                || '[0-9]{4}-(0[1-9]|1[0-2])$'
            ) THEN
                RAISE EXCEPTION
                    'Reporting-period key is not a canonical Asia/Manila month key';
            END IF;

            period_year := substring(NEW.natural_key FROM 19 FOR 4)::INTEGER;
            period_month := substring(NEW.natural_key FROM 24 FOR 2)::INTEGER;
            IF period_year = 9999 AND period_month = 12 THEN
                RAISE EXCEPTION
                    'Canonical period has no representable exclusive end boundary';
            END IF;
            expected_local_start := make_date(period_year, period_month, 1);
            expected_local_end :=
                (expected_local_start + INTERVAL '1 month')::DATE;
            expected_start :=
                expected_local_start::TIMESTAMP AT TIME ZONE 'Asia/Manila';
            expected_end :=
                expected_local_end::TIMESTAMP AT TIME ZONE 'Asia/Manila';

            IF NEW.cadence IS DISTINCT FROM 'month'
               OR NEW.timezone_name IS DISTINCT FROM 'Asia/Manila'
               OR NEW.local_start_date IS DISTINCT FROM expected_local_start
               OR NEW.local_end_date IS DISTINCT FROM expected_local_end
               OR NEW.starts_at IS DISTINCT FROM expected_start
               OR NEW.ends_at IS DISTINCT FROM expected_end
               OR NEW.submission_opens_at IS DISTINCT FROM expected_end
               OR NEW.submission_closes_at IS DISTINCT FROM
                    expected_end + INTERVAL '15 days' THEN
                RAISE EXCEPTION
                    'Reporting period must equal its canonical Asia/Manila month window';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_reporting_periods_canonical
        BEFORE INSERT OR UPDATE ON reporting_periods
        FOR EACH ROW EXECUTE FUNCTION tanaw_validate_canonical_reporting_period()
        """
    )

    op.execute("DROP TRIGGER trg_reporting_periods_immutable ON reporting_periods")
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_reporting_period_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION
                    'reporting_periods is immutable; deletion is forbidden';
            END IF;
            IF (to_jsonb(OLD) - 'status' - 'obligations_frozen_at')
               IS DISTINCT FROM
               (to_jsonb(NEW) - 'status' - 'obligations_frozen_at') THEN
                RAISE EXCEPTION
                    'Canonical reporting-period identity and windows are immutable';
            END IF;
            IF NOT (
                NEW.status = OLD.status
                OR (OLD.status = 'scheduled' AND NEW.status IN ('open', 'closed'))
                OR (OLD.status = 'open' AND NEW.status = 'closed')
            ) THEN
                RAISE EXCEPTION 'Reporting-period status cannot move backwards';
            END IF;
            IF OLD.obligations_frozen_at IS NOT NULL
               AND NEW.obligations_frozen_at IS DISTINCT FROM
                    OLD.obligations_frozen_at THEN
                RAISE EXCEPTION
                    'Reporting-period obligation freeze time is immutable';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_reporting_periods_immutable
        BEFORE UPDATE OR DELETE ON reporting_periods
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_reporting_period_mutation()
        """
    )

    # Validate every migrated row through the same trigger used for all future
    # writes. The lifecycle guard permits this no-op status assignment.
    op.execute("UPDATE reporting_periods SET status = status")

    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute(
        """
        ALTER TABLE reporting_periods
        ADD CONSTRAINT ex_reporting_periods_no_overlap
        EXCLUDE USING gist (
            cadence WITH =,
            timezone_name WITH =,
            tstzrange(starts_at, ends_at, '[)') WITH &&
        )
        """
    )


def _freeze_obligation_identity() -> None:
    op.add_column(
        "reporting_obligations",
        sa.Column("enterprise_official_code", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "reporting_obligations",
        sa.Column("enterprise_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "reporting_obligations",
        sa.Column("site_code", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "reporting_obligations",
        sa.Column("site_name", sa.String(length=160), nullable=True),
    )
    op.execute("LOCK TABLE reporting_obligations IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """
        UPDATE reporting_obligations AS obligation
        SET enterprise_official_code = enterprise.official_code,
            enterprise_name = enterprise.name,
            site_code = site.site_code,
            site_name = site.name
        FROM enterprises AS enterprise, enterprise_sites AS site
        WHERE enterprise.id = obligation.enterprise_id
          AND enterprise.classification = obligation.classification
          AND site.id = obligation.site_id
          AND site.enterprise_id = obligation.enterprise_id
          AND site.classification = obligation.classification
        """
    )
    for column_name in (
        "enterprise_official_code",
        "enterprise_name",
        "site_code",
        "site_name",
    ):
        op.alter_column(
            "reporting_obligations",
            column_name,
            existing_type=sa.String(),
            nullable=False,
        )
    op.create_check_constraint(
        "ck_reporting_obligations_identity_snapshots",
        "reporting_obligations",
        "length(trim(enterprise_official_code)) > 0 "
        "AND length(trim(enterprise_name)) > 0 "
        "AND length(trim(site_code)) > 0 "
        "AND length(trim(site_name)) > 0",
    )
    op.execute(
        """
        CREATE FUNCTION tanaw_guard_reporting_obligation_identity()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.enterprise_official_code IS DISTINCT FROM OLD.enterprise_official_code
               OR NEW.enterprise_name IS DISTINCT FROM OLD.enterprise_name
               OR NEW.site_code IS DISTINCT FROM OLD.site_code
               OR NEW.site_name IS DISTINCT FROM OLD.site_name THEN
                RAISE EXCEPTION
                    'Frozen reporting-obligation identity cannot be changed';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_reporting_obligations_identity_immutable
        BEFORE UPDATE ON reporting_obligations
        FOR EACH ROW EXECUTE FUNCTION tanaw_guard_reporting_obligation_identity()
        """
    )


def _create_discovery_indexes() -> None:
    op.create_index(
        "ix_reporting_periods_status_keyset",
        "reporting_periods",
        ["status", "starts_at", "id"],
    )
