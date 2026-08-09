import argparse
import asyncio
import json

from app.core.config import get_settings
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.sample_data.definitions import DEFAULT_SCENARIO, DEFAULT_SEED
from app.features.sample_data.lifecycle import (
    generate_sample_data,
    remove_sample_data,
    sample_dataset_present,
    sample_dataset_status,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage deterministic TANAW sample data.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    on_parser = subparsers.add_parser("on", help="Generate sample data.")
    on_parser.add_argument("--range", default="6m", choices=["30d", "6m", "12m"])
    on_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    on_parser.add_argument("--seed", default=DEFAULT_SEED)
    on_parser.add_argument(
        "--target-enterprise", help="Enterprise ID, email, account ID, or exact enterprise name."
    )

    subparsers.add_parser("off", help="Remove the deterministic sample dataset.")

    subparsers.add_parser("status", help="Show sample-data status.")

    reset_parser = subparsers.add_parser(
        "reset", help="Remove and regenerate the deterministic sample dataset."
    )
    reset_parser.add_argument("--range", default="6m", choices=["30d", "6m", "12m"])
    reset_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    reset_parser.add_argument("--seed", default=DEFAULT_SEED)
    reset_parser.add_argument(
        "--target-enterprise", help="Enterprise ID, email, account ID, or exact enterprise name."
    )

    args = parser.parse_args()
    asyncio.run(run(args))


async def run(args: argparse.Namespace) -> None:
    await validate_schema()

    if args.command == "status":
        async with AsyncSessionLocal() as db:
            result = await sample_dataset_status(db)
        print(json.dumps(result, indent=2, sort_keys=True))
        return

    require_development_environment()

    if args.command == "off":
        async with AsyncSessionLocal() as db:
            removed = await remove_sample_data(db)
        print(json.dumps({"removed": removed}, indent=2, sort_keys=True))
        return

    if args.command == "reset":
        async with AsyncSessionLocal() as db:
            removed = await remove_sample_data(db)
            created = await generate_sample_data(
                db, args.range, args.scenario, args.seed, args.target_enterprise
            )
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        if await sample_dataset_present(db):
            raise SystemExit(
                "Sample data already exists. Run mockdata-off or mockdata-reset first."
            )
        result = await generate_sample_data(
            db, args.range, args.scenario, args.seed, args.target_enterprise
        )
    print(json.dumps(result, indent=2, sort_keys=True))


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)


def require_development_environment() -> None:
    if get_settings().is_production:
        raise SystemExit("Refusing to manage sample data in production.")
