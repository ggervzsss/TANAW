import re

PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 6 characters and include uppercase, lowercase, "
    "number, and special character."
)


def validate_password_policy(value: str) -> str:
    if (
        len(value) < 6
        or re.search(r"[A-Z]", value) is None
        or re.search(r"[a-z]", value) is None
        or re.search(r"\d", value) is None
        or re.search(r"[^A-Za-z0-9]", value) is None
    ):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return value
