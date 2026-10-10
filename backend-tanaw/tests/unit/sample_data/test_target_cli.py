from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.sample_data import cli, lifecycle
from app.features.sample_data.accounts import resolve_target_enterprise


@pytest.fixture(autouse=True)
def clear_target_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TANAW_MOCK_TARGET_ENTERPRISE", raising=False)


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
        cli, "resolve_target_enterprise", AsyncMock(side_effect=SystemExit("ambiguous target"))
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
        lifecycle, "resolve_target_enterprise", AsyncMock(side_effect=SystemExit("invalid target"))
    )
    create_accounts = AsyncMock()
    monkeypatch.setattr(lifecycle, "create_accounts", create_accounts)

    with pytest.raises(SystemExit, match="invalid target"):
        await lifecycle.generate_sample_data(MagicMock(), "6m", "full-workflow", "random", "typo")

    create_accounts.assert_not_awaited()
