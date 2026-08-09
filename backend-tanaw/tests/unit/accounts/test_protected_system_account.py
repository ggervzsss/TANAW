from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import is_protected_startup_account


def test_persisted_flag_protects_bootstrap_without_environment_credentials() -> None:
    account = Account(
        id="bootstrap-account",
        email="bootstrap@tanaw.example",
        password_hash="hash",
        role=AccountRole.IT,
        display_name="Default IT Personnel",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        is_protected_system_account=True,
    )

    assert is_protected_startup_account(account) is True


def test_development_seed_account_is_not_a_protected_system_account() -> None:
    account = Account(
        id="development-it",
        email="it@email.com",
        password_hash="hash",
        role=AccountRole.IT,
        display_name="IT Personnel",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        is_protected_system_account=False,
    )

    assert is_protected_startup_account(account) is False
