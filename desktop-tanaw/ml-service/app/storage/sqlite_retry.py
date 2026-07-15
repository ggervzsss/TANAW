from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SQLiteRetryPolicy:
    maximum_attempts: int = 4
    initial_delay_seconds: float = 0.025
    maximum_delay_seconds: float = 0.25

    def delay_for_attempt(self, attempt: int) -> float:
        return float(
            min(
                self.maximum_delay_seconds,
                self.initial_delay_seconds * (2 ** max(0, attempt - 1)),
            )
        )


class SQLiteWriteExhausted(RuntimeError):
    def __init__(self, operation: str, attempts: int, error: BaseException) -> None:
        super().__init__(
            f"Local persistence operation '{operation}' failed after {attempts} attempts: {error}"
        )
        self.operation = operation
        self.attempts = attempts
        self.original_error = error


def run_sqlite_write(
    operation_name: str,
    operation: Callable[[], Any],
    *,
    policy: SQLiteRetryPolicy,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    for attempt in range(1, policy.maximum_attempts + 1):
        try:
            return operation()
        except sqlite3.OperationalError as exc:
            if not _is_transient_sqlite_error(exc) or attempt == policy.maximum_attempts:
                raise SQLiteWriteExhausted(operation_name, attempt, exc) from exc
            sleep(policy.delay_for_attempt(attempt))
    raise AssertionError("SQLite retry loop exited without returning or raising.")


def _is_transient_sqlite_error(error: sqlite3.OperationalError) -> bool:
    normalized = str(error).lower()
    return "locked" in normalized or "busy" in normalized
