from app.features.accounts.models import Account, AccountRole


def is_login_scope_allowed(account: Account, login_scope: str) -> bool:
    if login_scope == "enterprise":
        return account.role == AccountRole.ENTERPRISE

    return account.role != AccountRole.ENTERPRISE


def get_auth_log_category(account: Account) -> str:
    if account.role == AccountRole.ADMIN:
        return "Admin Operation"
    if account.role == AccountRole.IT:
        return "IT Activity"
    if account.role == AccountRole.STAFF:
        return "Staff Operation"
    return "Enterprise Activity"
