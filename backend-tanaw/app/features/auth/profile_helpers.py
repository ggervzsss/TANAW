from fastapi import HTTPException, status

from app.features.accounts.models import Account, AccountRole, EnterpriseProfile
from app.features.accounts.service import get_account_preferences, set_account_preferences


def require_enterprise_account(account: Account) -> EnterpriseProfile:
    if account.role != AccountRole.ENTERPRISE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise account access required.",
        )
    if account.enterprise_profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")
    return account.enterprise_profile


def enterprise_label(account: Account) -> str:
    return require_enterprise_account(account).enterprise_name


def set_pending_account_change(account: Account, key: str, value: dict[str, str]) -> None:
    preferences = get_account_preferences(account)
    preferences[key] = value
    set_account_preferences(account, preferences)
