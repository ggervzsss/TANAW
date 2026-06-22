import re

PASSWORD_MIN_LENGTH = 6
PASSWORD_POLICY_MESSAGE = (
    f"Password must be at least {PASSWORD_MIN_LENGTH} characters and include uppercase, lowercase, "
    "number, and special character."
)


def validate_password_policy(value: str) -> str:
    if (
        len(value) < PASSWORD_MIN_LENGTH
        or re.search(r"[A-Z]", value) is None
        or re.search(r"[a-z]", value) is None
        or re.search(r"[0-9]", value) is None
        or re.search(r"[^A-Za-z0-9\s]", value) is None
    ):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return value
