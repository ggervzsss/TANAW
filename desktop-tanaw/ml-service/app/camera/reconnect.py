from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from urllib.error import HTTPError


class CameraConnectionState(StrEnum):
    STOPPED = "stopped"
    CONNECTING = "connecting"
    RUNNING = "running"
    BACKOFF = "reconnecting"
    NONRECOVERABLE = "nonrecoverable_error"


class CameraFailureKind(StrEnum):
    RECOVERABLE = "recoverable"
    NONRECOVERABLE = "nonrecoverable"


class InvalidCameraStateTransition(RuntimeError):
    pass


@dataclass(frozen=True)
class CameraFailure:
    kind: CameraFailureKind
    reason: str
    message: str


class CameraStreamFailure(RuntimeError):
    def __init__(self, message: str, *, reason: str = "stream_interrupted") -> None:
        super().__init__(message)
        self.reason = reason


class CameraConnectionStateMachine:
    _ALLOWED_TRANSITIONS = {
        CameraConnectionState.STOPPED: {CameraConnectionState.CONNECTING},
        CameraConnectionState.CONNECTING: {
            CameraConnectionState.RUNNING,
            CameraConnectionState.BACKOFF,
            CameraConnectionState.NONRECOVERABLE,
            CameraConnectionState.STOPPED,
        },
        CameraConnectionState.RUNNING: {
            CameraConnectionState.BACKOFF,
            CameraConnectionState.NONRECOVERABLE,
            CameraConnectionState.STOPPED,
        },
        CameraConnectionState.BACKOFF: {
            CameraConnectionState.CONNECTING,
            CameraConnectionState.NONRECOVERABLE,
            CameraConnectionState.STOPPED,
        },
        CameraConnectionState.NONRECOVERABLE: {CameraConnectionState.STOPPED},
    }

    def __init__(self) -> None:
        self._state = CameraConnectionState.STOPPED

    @property
    def state(self) -> CameraConnectionState:
        return self._state

    def transition(self, state: CameraConnectionState) -> CameraConnectionState:
        if state == self._state:
            return state
        if state not in self._ALLOWED_TRANSITIONS[self._state]:
            raise InvalidCameraStateTransition(
                f"Camera connection cannot transition from {self._state} to {state}."
            )
        self._state = state
        return state

    def reset(self) -> None:
        self._state = CameraConnectionState.STOPPED


@dataclass(frozen=True)
class ReconnectPolicy:
    initial_delay_seconds: float = 0.5
    maximum_delay_seconds: float = 30.0
    jitter_ratio: float = 0.2
    random_value: Callable[[], float] = random.random

    def delay_for_attempt(self, attempt: int) -> float:
        normalized_attempt = max(1, attempt)
        exponential = self.initial_delay_seconds * (2 ** (normalized_attempt - 1))
        bounded = min(self.maximum_delay_seconds, exponential)
        jitter_sample = min(1.0, max(0.0, self.random_value()))
        jitter_multiplier = 1.0 + ((jitter_sample * 2.0) - 1.0) * self.jitter_ratio
        return float(max(0.0, min(self.maximum_delay_seconds, bounded * jitter_multiplier)))


_NONRECOVERABLE_MARKERS = (
    "401",
    "403",
    "authentication failed",
    "invalid credential",
    "invalid password",
    "permission denied",
    "unauthorized",
    "unsupported camera",
    "unsupported stream",
    "malformed",
)


def classify_camera_failure(error: BaseException) -> CameraFailure:
    message = str(error).strip() or error.__class__.__name__
    normalized = message.lower()
    if isinstance(error, HTTPError) and error.code in {401, 403}:
        return CameraFailure(CameraFailureKind.NONRECOVERABLE, "camera_authentication", message)
    if isinstance(error, (PermissionError, ValueError)) or any(
        marker in normalized for marker in _NONRECOVERABLE_MARKERS
    ):
        return CameraFailure(CameraFailureKind.NONRECOVERABLE, "camera_configuration", message)
    reason = error.reason if isinstance(error, CameraStreamFailure) else "stream_interrupted"
    return CameraFailure(CameraFailureKind.RECOVERABLE, reason, message)
