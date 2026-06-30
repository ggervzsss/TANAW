import logging
import queue
import threading
from collections import deque
from dataclasses import dataclass
from time import monotonic

import numpy as np

from app.reid.person_reid import PersonReIdentifier

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReIdTask:
    session_id: int
    track_id: int
    source_track_id: int
    crop: np.ndarray
    quality: float
    requested_at: float


@dataclass(frozen=True)
class ReIdResult:
    session_id: int
    track_id: int
    source_track_id: int
    embedding: np.ndarray | None
    quality: float
    requested_at: float
    completed_at: float


class AsyncReIdWorker:
    def __init__(self, reidentifier: PersonReIdentifier, max_queue_size: int = 2) -> None:
        self._reidentifier = reidentifier
        self._tasks: queue.Queue[ReIdTask | None] = queue.Queue(maxsize=max_queue_size)
        self._results: queue.SimpleQueue[ReIdResult] = queue.SimpleQueue()
        self._pending: set[tuple[int, int]] = set()
        self._lock = threading.Lock()
        self._dropped = 0
        self._cleared = 0
        self._completed = 0
        self._latencies_ms: deque[float] = deque(maxlen=128)
        self._stopping = threading.Event()
        self._active_session_id: int | None = None
        self._thread = threading.Thread(target=self._run, name="tanaw-reid-worker", daemon=True)
        self._thread.start()

    def submit(
        self,
        *,
        session_id: int,
        track_id: int,
        source_track_id: int,
        crop: np.ndarray,
        quality: float,
        requested_at: float,
    ) -> bool:
        key = (session_id, track_id)
        if self._stopping.is_set():
            return False
        with self._lock:
            if self._active_session_id is not None and session_id != self._active_session_id:
                return False
            if key in self._pending:
                return False
            self._pending.add(key)

        task = ReIdTask(
            session_id=session_id,
            track_id=track_id,
            source_track_id=source_track_id,
            crop=crop,
            quality=quality,
            requested_at=requested_at,
        )
        try:
            self._tasks.put_nowait(task)
            return True
        except queue.Full:
            with self._lock:
                self._pending.discard(key)
                self._dropped += 1
            return False

    def poll(self, session_id: int) -> list[ReIdResult]:
        results: list[ReIdResult] = []
        while True:
            try:
                result = self._results.get_nowait()
            except queue.Empty:
                break
            if result.session_id == session_id:
                results.append(result)
        return results

    def status(self) -> dict[str, int | float | bool | None]:
        with self._lock:
            latencies = sorted(self._latencies_ms)
            return {
                "reid_queue_depth": self._tasks.qsize(),
                "reid_tasks_pending": len(self._pending),
                "reid_tasks_dropped": self._dropped,
                "reid_tasks_cleared": self._cleared,
                "reid_tasks_completed": self._completed,
                "reid_worker_alive": self._thread.is_alive(),
                "reid_worker_p50_ms": _percentile(latencies, 0.50),
                "reid_worker_p95_ms": _percentile(latencies, 0.95),
            }

    def begin_session(self, session_id: int) -> None:
        cleared_tasks = self._clear_queue()
        self._clear_results()
        with self._lock:
            self._active_session_id = session_id
            self._dropped = 0
            self._cleared = cleared_tasks
            self._completed = 0
            self._latencies_ms.clear()
            self._pending.clear()

    def end_session(self, session_id: int) -> None:
        cleared_tasks = self._clear_queue(session_id)
        self._clear_results(session_id)
        with self._lock:
            if self._active_session_id == session_id:
                self._active_session_id = None
            self._pending = {key for key in self._pending if key[0] != session_id}
            self._cleared += cleared_tasks

    def close(self, timeout: float = 2.0) -> None:
        self._stopping.set()
        cleared_tasks = self._clear_queue()
        with self._lock:
            self._pending.clear()
            self._cleared += cleared_tasks

        while True:
            try:
                self._tasks.put_nowait(None)
                break
            except queue.Full:
                cleared_tasks = self._clear_queue()
                with self._lock:
                    self._cleared += cleared_tasks

        if self._thread is not threading.current_thread():
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                logger.warning("ReID worker thread did not stop cleanly.")

    def _run(self) -> None:
        while True:
            task = self._tasks.get()
            if task is None:
                return
            with self._lock:
                active_session_id = self._active_session_id
            if active_session_id is not None and task.session_id != active_session_id:
                with self._lock:
                    self._pending.discard((task.session_id, task.track_id))
                continue
            result = self._reidentifier.embed_crop(task.crop)
            completed_at = monotonic()
            with self._lock:
                self._pending.discard((task.session_id, task.track_id))
                self._completed += 1
                self._latencies_ms.append((completed_at - task.requested_at) * 1000.0)
            self._results.put(
                ReIdResult(
                    session_id=task.session_id,
                    track_id=task.track_id,
                    source_track_id=task.source_track_id,
                    embedding=result.embedding if result is not None else None,
                    quality=task.quality,
                    requested_at=task.requested_at,
                    completed_at=completed_at,
                )
            )
            if self._stopping.is_set():
                return

    def _clear_queue(self, session_id: int | None = None) -> int:
        cleared = 0
        kept: list[ReIdTask | None] = []
        while True:
            try:
                task = self._tasks.get_nowait()
            except queue.Empty:
                break
            if task is None:
                if session_id is None:
                    cleared += 1
                else:
                    kept.append(task)
                continue
            if session_id is None or task.session_id == session_id:
                cleared += 1
            else:
                kept.append(task)

        for task in kept:
            try:
                self._tasks.put_nowait(task)
            except queue.Full:
                cleared += 1
        return cleared

    def _clear_results(self, session_id: int | None = None) -> None:
        kept: list[ReIdResult] = []
        while True:
            try:
                result = self._results.get_nowait()
            except queue.Empty:
                break
            if session_id is not None and result.session_id != session_id:
                kept.append(result)
        for result in kept:
            self._results.put(result)


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * quantile))))
    return float(values[index])
