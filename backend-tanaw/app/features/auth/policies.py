from app.features.accounts.models import Account, AccountRole


def is_login_scope_allowed(account: Account, login_scope: str) -> bool:
    if login_scope == "enterprise":
        return account.role == AccountRole.ENTERPRISE

    return account.role != AccountRole.ENTERPRISE
