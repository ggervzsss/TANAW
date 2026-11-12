"""Exercise the production upgrade without touching other application schemas."""

from io import StringIO
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from alembic.config import Config

from alembic import command
from app.db.migrations import canonical_schema_fingerprint
from tests.support.postgres import postgres_test_database_url

EDITED_FINGERPRINT = "522e8d6d652fc891ba5a75a2c78ec3965bd7c6b96cc53c386fd920fdb402d37b"


def migration_sql(revision: str) -> str:
    root = Path(__file__).resolve().parents[3]
    output = StringIO()
    config = Config(str(root / "alembic.ini"), output_buffer=output)
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, revision, sql=True)
    return output.getvalue()


@pytest_asyncio.fixture
async def migration_connection():
    url = postgres_test_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    connection = await asyncpg.connect(url)
    schema = f"counting_migration_{uuid4().hex}"
    await connection.execute(f'CREATE SCHEMA "{schema}"')
    await connection.execute(f'SET search_path TO "{schema}"')
    try:
        await connection.execute(migration_sql("base:0001"))
        yield connection
    finally:
        await connection.execute("ROLLBACK")
        await connection.execute("SET search_path TO public")
        await connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await connection.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("edited_baseline", [False, True])
async def test_upgrade_preserves_reports_from_both_known_baselines(
    migration_connection, edited_baseline
):
    connection = migration_connection
    await connection.execute(
        """INSERT INTO final_reports
        (id,report_code,title,period,prepared_by,prepared_role,status,
         total_entry,total_exit,total_unique,enterprise_count)
        VALUES ('preserved','PRESERVED','Existing report','October 2026',
                'Staff','Staff','Draft',12,7,6,1)"""
    )
    if edited_baseline:
        await connection.execute(
            "ALTER TABLE final_reports ALTER COLUMN total_entry DROP NOT NULL;"
            "ALTER TABLE final_report_sources ADD COLUMN counting_json JSONB;"
            "UPDATE final_reports SET total_entry = NULL;"
        )
        await connection.execute(
            "UPDATE tanaw_schema_identity SET schema_fingerprint=$1", EDITED_FINGERPRINT
        )

    await connection.execute(migration_sql("0001:head"))
    assert await connection.fetchval("SELECT version_num FROM alembic_version") == "0002"
    assert (
        await connection.fetchval("SELECT schema_fingerprint FROM tanaw_schema_identity")
        == canonical_schema_fingerprint()
    )
    row = await connection.fetchrow("SELECT * FROM final_reports WHERE id='preserved'")
    assert row["total_unique"] == 6
    assert row["total_entry"] == (None if edited_baseline else 12)
    assert (
        await connection.fetchval(
            """SELECT is_nullable FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='enterprise_telemetry_snapshots'
        AND column_name='current_occupancy'"""
        )
        == "YES"
    )
    assert (
        await connection.fetchval(
            """SELECT data_type FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name='final_report_sources'
        AND column_name='counting_json'"""
        )
        == "jsonb"
    )
    # Repeated startup is safe: the recorded head no longer needs upgrading.
    await connection.execute("UPDATE final_reports SET total_entry=NULL, total_exit=NULL")


@pytest.mark.asyncio
async def test_unknown_baseline_is_rejected_without_advancing_revision(migration_connection):
    connection = migration_connection
    await connection.execute("UPDATE tanaw_schema_identity SET schema_fingerprint='unknown'")
    with pytest.raises(asyncpg.RaiseError, match="Unrecognized TANAW baseline"):
        await connection.execute(migration_sql("0001:head"))
    await connection.execute("ROLLBACK")
    assert await connection.fetchval("SELECT version_num FROM alembic_version") == "0001"
