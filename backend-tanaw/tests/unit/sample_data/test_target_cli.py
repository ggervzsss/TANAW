from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.sample_data import cli, lifecycle
from app.features.sample_data.accounts import (
    creatable_target_seed,
    resolve_target_enterprise,
    target_display_name,
)
from app.features.sample_data.definitions import TEST_ACCOUNT_PASSWORD
from app.features.sample_data.helpers import month_starts, reporting_range


@pytest.fixture(autouse=True)
def clear_sample_data_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TANAW_MOCK_TARGET_ENTERPRISE", raising=False)
    monkeypatch.delenv("TANAW_MOCK_ACCOUNT_PASSWORD", raising=False)
    monkeypatch.delenv("TANAW_MOCK_TARGET_PASSWORD", raising=False)
    monkeypatch.delenv("TANAW_MOCK_TARGET_NAME", raising=False)


@pytest.mark.parametrize("command", ["on", "reset"])
@pytest.mark.parametrize(
    "selector", ["lolouweng", "lolouweng_001", "lolouweng_001@tanaw.sanpedro", "another_seed"]
)
def test_positional_target(command: str, selector: str) -> None:
    args = cli.parse_args([command, selector, "--range", "12m", "--seed", "random-values"])

    assert args.target_enterprise == selector
    assert args.range == "12m"
    assert args.seed == "random-values"


@pytest.mark.parametrize("command", ["on", "reset"])
@pytest.mark.parametrize("options", [[], ["--seed", "lolouweng"], [""], ["   "]])
def test_no_implicit_target(command: str, options: list[str]) -> None:
    with pytest.raises(SystemExit) as error:
        cli.parse_args([command, *options])

    assert error.value.code == 2


@pytest.mark.parametrize("command", ["on", "reset"])
@pytest.mark.parametrize("options", [[], ["another_seed"], ["--target-enterprise", "another_seed"]])
def test_environment_target_is_only_a_fallback(
    monkeypatch: pytest.MonkeyPatch, command: str, options: list[str]
) -> None:
    monkeypatch.setenv("TANAW_MOCK_TARGET_ENTERPRISE", "lolouweng")

    args = cli.parse_args([command, *options])

    assert args.target_enterprise == ("another_seed" if options else "lolouweng")


def test_blank_explicit_target_does_not_fall_back_to_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TANAW_MOCK_TARGET_ENTERPRISE", "lolouweng")

    with pytest.raises(SystemExit) as error:
        cli.parse_args(["on", ""])

    assert error.value.code == 2


def test_conflicting_explicit_targets_are_rejected() -> None:
    with pytest.raises(SystemExit) as error:
        cli.parse_args(["on", "lolouweng", "--target-enterprise", "another_seed"])

    assert error.value.code == 2


@pytest.mark.parametrize("command", ["off", "status"])
def test_read_and_cleanup_commands_do_not_require_a_target(command: str) -> None:
    assert cli.parse_args([command]).command == command


def test_local_sample_accounts_keep_their_documented_password() -> None:
    assert cli.sample_account_password() == TEST_ACCOUNT_PASSWORD


@pytest.mark.parametrize("password", ["", "short", TEST_ACCOUNT_PASSWORD])
def test_custom_sample_password_rejects_invalid_or_documented_passwords(
    monkeypatch: pytest.MonkeyPatch, password: str
) -> None:
    monkeypatch.setenv("TANAW_MOCK_ACCOUNT_PASSWORD", password)

    with pytest.raises(SystemExit, match="TANAW_MOCK_ACCOUNT_PASSWORD"):
        cli.sample_account_password()


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", [None, "", "   "])
async def test_resolver_has_no_generated_account_fallback(identifier: str | None) -> None:
    db = MagicMock()

    with pytest.raises(SystemExit, match="Choose a target"):
        await resolve_target_enterprise(db, identifier)

    assert not db.mock_calls


@pytest.mark.asyncio
async def test_reset_rejects_invalid_target_before_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    monkeypatch.setattr(cli, "AsyncSessionLocal", MagicMock(return_value=session))
    monkeypatch.setattr(cli, "validate_schema", AsyncMock())
    monkeypatch.setattr(cli, "require_development_environment", lambda: None)
    monkeypatch.setattr(
        cli, "prepare_target_enterprise", AsyncMock(side_effect=SystemExit("ambiguous target"))
    )
    cleanup = AsyncMock()
    generate = AsyncMock()
    monkeypatch.setattr(cli, "remove_sample_data", cleanup)
    monkeypatch.setattr(cli, "generate_sample_data", generate)

    with pytest.raises(SystemExit, match="ambiguous target"):
        await cli.run(cli.parse_args(["reset", "lolouweng"]))

    cleanup.assert_not_awaited()
    generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_generation_validates_target_before_creating_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        lifecycle, "find_target_enterprise", AsyncMock(side_effect=SystemExit("invalid target"))
    )
    create_accounts = AsyncMock()
    monkeypatch.setattr(lifecycle, "create_accounts", create_accounts)

    with pytest.raises(SystemExit, match="invalid target"):
        await lifecycle.generate_sample_data(MagicMock(), "6m", "full-workflow", "random", "typo")

    create_accounts.assert_not_awaited()


@pytest.mark.parametrize("command", ["on", "reset"])
def test_default_range_is_a_year_and_a_half(command: str) -> None:
    assert cli.parse_args([command, "lolouweng"]).range == "18m"


@pytest.mark.parametrize(("range_value", "months"), [("6m", 6), ("12m", 12), ("18m", 18)])
def test_month_ranges_cover_that_many_reporting_months(range_value: str, months: int) -> None:
    start, end = reporting_range(range_value)

    assert len(month_starts(start, end)) == months


@pytest.mark.parametrize("command", ["on", "reset"])
def test_missing_plain_targets_are_created_unless_turned_off(command: str) -> None:
    assert cli.parse_args([command, "lolouweng"]).create_target is True
    assert cli.parse_args([command, "lolouweng", "--no-create-target"]).create_target is False


def test_new_target_name_comes_from_the_option_or_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert cli.parse_args(["on", "lolouweng"]).target_name is None
    monkeypatch.setenv("TANAW_MOCK_TARGET_NAME", "Lolo Uweng Shrine")
    assert cli.parse_args(["on", "lolouweng"]).target_name == "Lolo Uweng Shrine"
    assert cli.parse_args(["on", "lolouweng", "--target-name", "Other"]).target_name == "Other"


def test_target_password_defaults_to_the_sample_password(monkeypatch: pytest.MonkeyPatch) -> None:
    assert cli.target_account_password() is None
    monkeypatch.setenv("TANAW_MOCK_TARGET_PASSWORD", "")
    assert cli.target_account_password() is None
    monkeypatch.setenv("TANAW_MOCK_TARGET_PASSWORD", "Lolo Uweng desktop phrase 2026")
    assert cli.target_account_password() == "Lolo Uweng desktop phrase 2026"
    monkeypatch.setenv("TANAW_MOCK_TARGET_PASSWORD", "short")
    with pytest.raises(SystemExit, match="TANAW_MOCK_TARGET_PASSWORD"):
        cli.target_account_password()


@pytest.mark.parametrize(
    ("identifier", "seed"),
    [
        ("lolouweng", "lolouweng"),
        ("  Lolo Uweng's Shrine ", "lolo_uwengs_shrine"),
        ("lolouweng_001", None),
        ("lolouweng_001@tanaw.sanpedro", None),
        ("owner@example.com", None),
        ("0b9f3f2e-4a7c-4d6e-9a51-2f1c3b4d5e6f", None),
        ("   ", None),
    ],
)
def test_only_plain_names_can_create_a_target(identifier: str, seed: str | None) -> None:
    assert creatable_target_seed(identifier) == seed


def test_new_target_display_name_reads_like_a_name() -> None:
    assert target_display_name("lolouweng") == "Lolouweng"
    assert target_display_name("lolo_uweng_shrine") == "Lolo Uweng Shrine"


@pytest.mark.asyncio
async def test_missing_target_is_created_only_when_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lifecycle, "find_target_enterprise", AsyncMock(return_value=None))
    created = MagicMock()
    create = AsyncMock(return_value=created)
    monkeypatch.setattr(lifecycle, "create_target_enterprise", create)

    with pytest.raises(SystemExit, match="was not found"):
        await lifecycle.prepare_target_enterprise(
            MagicMock(), "lolouweng", create_missing=False, password="unused"
        )
    with pytest.raises(SystemExit, match="was not found"):
        await lifecycle.prepare_target_enterprise(
            MagicMock(), "lolouweng_001@tanaw.sanpedro", create_missing=True, password="unused"
        )
    create.assert_not_awaited()

    db = MagicMock()
    target, was_created = await lifecycle.prepare_target_enterprise(
        db, "lolouweng", create_missing=True, password="Desktop phrase 2026", name="Shrine"
    )

    assert (target, was_created) == (created, True)
    create.assert_awaited_once_with(
        db, "lolouweng", "Desktop phrase 2026", name="Shrine", registered_before=None
    )


@pytest.mark.asyncio
async def test_existing_target_is_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = MagicMock()
    monkeypatch.setattr(lifecycle, "find_target_enterprise", AsyncMock(return_value=existing))
    create = AsyncMock()
    monkeypatch.setattr(lifecycle, "create_target_enterprise", create)

    assert await lifecycle.prepare_target_enterprise(
        MagicMock(), "lolouweng", create_missing=True, password="unused"
    ) == (existing, False)
    create.assert_not_awaited()
