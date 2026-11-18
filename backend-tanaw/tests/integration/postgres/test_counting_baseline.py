"""Verify the canonical counting schema on a fresh PostgreSQL database."""

from io import StringIO
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from alembic.config import Config

from alembic import command
from app.db.base import Base
from app.db.migrations import CANONICAL_DATABASE_REVISION, canonical_schema_fingerprint
from tests.support.postgres import postgres_test_database_url


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
    schema = f"counting_baseline_{uuid4().hex}"
    await connection.execute(f'CREATE SCHEMA "{schema}"')
    await connection.execute(f'SET search_path TO "{schema}"')
    try:
        await connection.execute(migration_sql("head"))
        yield connection
    finally:
        await connection.execute("ROLLBACK")
        await connection.execute("SET search_path TO public")
        await connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await connection.close()


@pytest.mark.asyncio
async def test_fresh_baseline_matches_current_counting_models(migration_connection):
    connection = migration_connection
    assert (
        await connection.fetchval("SELECT version_num FROM alembic_version")
        == CANONICAL_DATABASE_REVISION
        == "0001"
    )
    assert (
        await connection.fetchval("SELECT schema_fingerprint FROM tanaw_schema_identity")
        == canonical_schema_fingerprint()
    )
    for table_name in (
        "enterprise_telemetry_snapshots",
        "enterprise_report_submissions",
        "final_reports",
        "final_report_sources",
    ):
        columns = await connection.fetch(
            """SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name=$1""",
            table_name,
        )
        assert {row["column_name"]: row["is_nullable"] == "YES" for row in columns} == {
            column.name: column.nullable for column in Base.metadata.tables[table_name].columns
        }
    assert (
        await connection.fetchval(
            """SELECT data_type FROM information_schema.columns
            WHERE table_schema=current_schema() AND table_name='final_report_sources'
            AND column_name='counting_json'"""
        )
        == "jsonb"
    )


@pytest.mark.asyncio
async def test_fresh_baseline_accepts_unavailable_report_measurements(migration_connection):
    connection = migration_connection
    await connection.execute(
        """INSERT INTO final_reports
        (id,report_code,title,period,prepared_by,prepared_role,status,
         total_entry,total_exit,total_unique,enterprise_count)
        VALUES ('unavailable','UNAVAILABLE','Report','October 2026',
                'Staff','Staff','Draft',NULL,NULL,6,1)"""
    )
    row = await connection.fetchrow("SELECT * FROM final_reports WHERE id='unavailable'")
    assert row["total_entry"] is None
    assert row["total_exit"] is None
    assert row["total_unique"] == 6
