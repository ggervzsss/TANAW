"""Exact decimal-domain guards shared by report intake and finalization."""

from decimal import Decimal, InvalidOperation

NUMERIC_20_6_QUANTUM = Decimal("0.000001")
NUMERIC_20_6_ABSOLUTE_LIMIT = Decimal("100000000000000")


def fits_numeric_20_6(value: Decimal) -> bool:
    """Return whether PostgreSQL NUMERIC(20,6) can store ``value`` exactly."""

    if not value.is_finite() or abs(value) >= NUMERIC_20_6_ABSOLUTE_LIMIT:
        return False
    try:
        return value.quantize(NUMERIC_20_6_QUANTUM) == value
    except InvalidOperation:
        return False
