from app.features.accounts.models import Account, AccountRole, EnterpriseProfile


def require_enterprise_profile(account: Account) -> EnterpriseProfile:
    profile = account.enterprise_profile
    if account.role != AccountRole.ENTERPRISE or profile is None:
        raise RuntimeError("Enterprise account is missing its profile.")
    return profile


def enterprise_identifier(account: Account) -> str:
    return require_enterprise_profile(account).enterprise_id


def enterprise_name(account: Account) -> str:
    return require_enterprise_profile(account).enterprise_name
