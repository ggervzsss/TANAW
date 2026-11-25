import argparse
import asyncio
import json
import os

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.sample_data.definitions import (
    DEFAULT_SCENARIO,
    DEFAULT_SEED,
    TEST_ACCOUNT_PASSWORD,
)
from app.features.sample_data.lifecycle import (
    generate_sample_data,
    prepare_target_enterprise,
    remove_sample_data,
    sample_dataset_present,
    sample_dataset_status,
)


def main() -> None:
    asyncio.run(run(parse_args()))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage deterministic TANAW sample data.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    on_parser = subparsers.add_parser("on", help="Generate sample data.")
    on_parser.add_argument("--range", default="18m", choices=["30d", "6m", "12m", "18m"])
    on_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    add_target_arguments(on_parser)

    subparsers.add_parser("off", help="Remove the deterministic sample dataset.")

    subparsers.add_parser("status", help="Show sample-data status.")

    reset_parser = subparsers.add_parser(
        "reset", help="Remove and regenerate the deterministic sample dataset."
    )
    reset_parser.add_argument("--range", default="18m", choices=["30d", "6m", "12m", "18m"])
    reset_parser.add_argument(
        "--scenario",
        default=DEFAULT_SCENARIO,
        choices=["full-workflow", "peak-traffic", "camera-health"],
    )
    add_target_arguments(reset_parser)

    args = parser.parse_args(argv)
    if args.command in {"on", "reset"}:
        if args.target is not None:
            args.target_enterprise = args.target
        if not args.target_enterprise or not args.target_enterprise.strip():
            parser.error("Choose a target enterprise using its account seed or enterprise ID.")
    return args


def add_target_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--seed",
        default=DEFAULT_SEED,
        help="Random seed for repeatable sample values; does not select the target account.",
    )
    default_target = os.environ.get("TANAW_MOCK_TARGET_ENTERPRISE", "").strip() or None
    targets = parser.add_mutually_exclusive_group(required=default_target is None)
    target_help = (
        "Existing account seed, numbered/full enterprise ID, email, account ID, "
        "or exact enterprise name. No default account."
    )
    targets.add_argument("target", nargs="?", help=target_help)
    targets.add_argument("--target-enterprise", default=default_target, help=target_help)
    parser.add_argument(
        "--no-create-target",
        dest="create_target",
        action="store_false",
        help="Fail instead of creating the target when a plain name such as lolouweng has no account.",
    )
    parser.add_argument(
        "--target-name",
        default=os.environ.get("TANAW_MOCK_TARGET_NAME", "").strip() or None,
        help="Enterprise name for a newly created target (default: from the target name).",
    )


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

    account_password = sample_account_password()
    target_password = target_account_password()
    target_options = {
        "account_password": account_password,
        "create_missing_target": args.create_target,
        "target_password": target_password,
        "target_name": args.target_name,
    }
    if args.command == "reset":
        async with AsyncSessionLocal() as db:
            # Cleanup commits independently, so reject invalid targets before deleting anything.
            await prepare_target_enterprise(
                db,
                args.target_enterprise,
                create_missing=args.create_target,
                password=target_password or account_password,
                name=args.target_name,
            )
            await db.rollback()
            removed = await remove_sample_data(db)
            created = await generate_sample_data(
                db,
                args.range,
                args.scenario,
                args.seed,
                args.target_enterprise,
                **target_options,
            )
        print(json.dumps({"removed": removed, "created": created}, indent=2, sort_keys=True))
        return

    async with AsyncSessionLocal() as db:
        if await sample_dataset_present(db):
            raise SystemExit(
                "Sample data already exists. Run mockdata-off or mockdata-reset first."
            )
        result = await generate_sample_data(
            db,
            args.range,
            args.scenario,
            args.seed,
            args.target_enterprise,
            **target_options,
        )
    print(json.dumps(result, indent=2, sort_keys=True))


def sample_account_password() -> str:
    value = os.environ.get("TANAW_MOCK_ACCOUNT_PASSWORD")
    if value is None:
        return TEST_ACCOUNT_PASSWORD
    try:
        password = validate_password_policy(value)
    except ValueError as error:
        raise SystemExit(f"Invalid TANAW_MOCK_ACCOUNT_PASSWORD. {error}") from None
    if password == TEST_ACCOUNT_PASSWORD:
        raise SystemExit("Set TANAW_MOCK_ACCOUNT_PASSWORD to a password unique to this demo.")
    return password


def target_account_password() -> str | None:
    """The password for a newly created target, or None to use the sample account password."""
    value = os.environ.get("TANAW_MOCK_TARGET_PASSWORD", "")
    if not value:
        return None
    try:
        return validate_password_policy(value)
    except ValueError as error:
        raise SystemExit(f"Invalid TANAW_MOCK_TARGET_PASSWORD. {error}") from None


async def validate_schema() -> None:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)


def require_development_environment() -> None:
    if get_settings().is_production:
        raise SystemExit("Refusing to manage sample data in production.")
