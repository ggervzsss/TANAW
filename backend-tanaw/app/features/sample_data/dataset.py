from datetime import UTC, datetime
from hashlib import sha256

SAMPLE_ACCOUNT_EMAILS = (
    "it.operations@tanaw.test",
    "system.admin@tanaw.test",
    "reports.staff@tanaw.test",
    "balon.lolo.uweng@tanaw.test",
    "sanpedro.apostol@tanaw.test",
    "lolo.uweng.church@tanaw.test",
    "tricias.bar@tanaw.test",
    "hallowridge.golf@tanaw.test",
)
SAMPLE_REPORT_PREFIX = "SAMPLE-REP-"
SAMPLE_FINAL_REPORT_PREFIX = "SAMPLE-FINAL-"
SAMPLE_CAMERA_PREFIX = "sample-camera-"
SAMPLE_SOURCE_PREFIX = "sample:"
SAMPLE_DATASET_VERSION = "tanaw-sample-v3"


def sample_dataset_marker_email() -> str:
    return SAMPLE_ACCOUNT_EMAILS[0]


def prepared_counts(enterprise_id: str) -> list[dict[str, int | str]]:
    current = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous = _add_months(current, -1)
    return [_counts_for_period(enterprise_id, month) for month in (previous, current)]


def prepared_report_id(enterprise_id: str, period: str) -> str:
    digest = sha256(f"{SAMPLE_DATASET_VERSION}:{enterprise_id}:{period}".encode()).hexdigest()[:10]
    return f"{SAMPLE_REPORT_PREFIX}{digest.upper()}"


def _counts_for_period(enterprise_id: str, month: datetime) -> dict[str, int | str]:
    period = month.strftime("%B %Y")
    seed = int(
        sha256(f"{SAMPLE_DATASET_VERSION}:{enterprise_id}:{period}".encode()).hexdigest()[:8],
        16,
    )
    entries = 620 + seed % 280
    exits = max(0, entries - (12 + seed % 44))
    unique_count = max(1, int(entries * (0.68 + (seed % 12) / 100)))
    peak = 32 + seed % 70
    return {
        "entries": entries,
        "exits": exits,
        "uniqueCount": unique_count,
        "peakOccupancy": peak,
        "period": period,
        "reportId": prepared_report_id(enterprise_id, period),
    }


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.year * 12 + value.month - 1 + months
    return value.replace(year=month_index // 12, month=month_index % 12 + 1)
