"""One serialized daily identity gallery for both camera modes in an enterprise."""

import hashlib
import json
import threading
from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np

from app.config.camera_coverage import CameraCoverage, camera_relation_in_graph
from app.identity.models import VisitorDecision, normalize_embedding
from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.storage.local_database import LocalDatabase
from app.storage.repositories.establishment_repository import (
    TIMEZONE,
    EstablishmentRepository,
    timestamp,
)
from app.storage.session_store import SessionStore


class EstablishmentRegistry:
    def __init__(self, app_data_dir: str | None, enterprise_id: str) -> None:
        self.database = LocalDatabase(app_data_dir, enterprise_id)
        self.repository = EstablishmentRepository(self.database)
        self._store = SessionStore(app_data_dir, enterprise_id, database=self.database)
        self._lock = threading.RLock()
        self._registries: dict[tuple[str, int, str | None], UniqueVisitorRegistry] = {}
        self._gallery_versions: dict[UniqueVisitorRegistry, tuple[Any, ...]] = {}
        self._present_tracks: dict[int, tuple[datetime, set[str]]] = {}
        self._last_track_refresh: dict[tuple[int, str], datetime] = {}

    def refresh_track(
        self,
        *,
        camera_id: int,
        track_key: str,
        observed_at: datetime,
        embedding: np.ndarray,
        model_name: str,
        quality_embedding: np.ndarray | None = None,
        quality_model_name: str | None = None,
    ) -> None:
        """Enrich an existing doorway observation when usable appearance arrives late."""
        with self._lock:
            key = (camera_id, track_key)
            previous = self._last_track_refresh.get(key)
            if previous is not None and (observed_at - previous).total_seconds() < 1:
                return
            self._last_track_refresh[key] = observed_at
            self._last_track_refresh = {
                item: at
                for item, at in self._last_track_refresh.items()
                if (observed_at - at).total_seconds() < 60
            }
            with self.database.connection() as db:
                source = db.execute(
                    "select * from establishment_observations where track_key=? "
                    "and analysis_mode='entrance_exit' order by first_at desc,business_date desc limit 1",
                    (f"{camera_id}:{track_key}",),
                ).fetchone()
            if source is None or source["kind"] == "exit" or source["ended_at"] is not None:
                return
            self.observe(
                observation_id=source["observation_id"],
                camera_id=camera_id,
                track_key=track_key,
                analysis_mode="entrance_exit",
                kind="entry",
                coverage=CameraCoverage.model_validate_json(source["coverage_json"]),
                qualified=True,
                first_at=datetime.fromisoformat(source["first_at"]),
                observed_at=observed_at,
                embedding=embedding,
                model_name=model_name,
                quality_embedding=quality_embedding,
                quality_model_name=quality_model_name,
                payload=json.loads(source["payload_json"]),
            )

    def update_present_tracks(
        self, camera_id: int, track_keys: set[str], observed_at: datetime
    ) -> None:
        """Physical observations distinguish tracker replacement from two present people."""
        timestamp(observed_at)
        with self._lock:
            self._present_tracks[camera_id] = (
                observed_at,
                {f"{camera_id}:{key}" for key in track_keys},
            )

    def observe(
        self,
        *,
        observation_id: str,
        camera_id: int,
        track_key: str,
        analysis_mode: Literal["entrance_exit", "open_space"],
        kind: Literal["entry", "exit", "area_visit"],
        coverage: CameraCoverage,
        qualified: bool,
        first_at: datetime,
        observed_at: datetime,
        embedding: np.ndarray | None = None,
        model_name: str = "person_reid_onnx",
        quality_embedding: np.ndarray | None = None,
        quality_model_name: str | None = None,
        revision_id: str | None = None,
        ended_at: datetime | None = None,
        arrival_observed: bool = False,
        departure_observed: bool = False,
        detection_confidence: float | None = None,
        bbox: tuple[int, int, int, int] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> VisitorDecision:
        at = timestamp(observed_at)
        first = timestamp(first_at)
        if camera_id <= 0 or not observation_id or not track_key or first > at:
            raise ValueError(
                "A valid camera, observation, physical track, and time range are required."
            )
        if ended_at is not None and not first <= timestamp(ended_at) <= at:
            raise ValueError("A visit endpoint must fall within its observation range.")
        track_key = f"{camera_id}:{track_key}"
        business_date = observed_at.astimezone(TIMEZONE).date().isoformat()
        normalized = normalize_embedding(embedding) if embedding is not None else None
        with self._lock, self.database.transaction() as db:
            source = db.execute(
                "select first_at,camera_id,track_key,kind,population_key,population_context_json,visitor_id,identity_confidence,qualified from establishment_observations "
                "where observation_id=? order by business_date limit 1",
                (observation_id,),
            ).fetchone()
            if source is not None:
                if (source["camera_id"], source["track_key"], source["kind"]) != (
                    camera_id,
                    track_key,
                    kind,
                ):
                    raise ValueError("An observation ID cannot be reassigned to another source.")
                first = source["first_at"]
            population = (
                json.loads(source["population_context_json"])
                if source is not None
                else self.repository.population_context(camera_id, coverage)
            )
            previous = db.execute(
                "select * from establishment_observations where track_key=? and business_date=? "
                "order by last_at desc limit 1",
                (track_key, business_date),
            ).fetchone()
            # Bind a physical track to one compatible descriptor space at a time.
            decision = VisitorDecision(
                visitor_id=previous["visitor_id"] if previous else None,
                is_unique_entry=False,
                reid_score=None,
                reid_decision="awaiting_identification",
                identity_confidence=previous["identity_confidence"] if previous else "pending",
                business_date=business_date,
            )
            if qualified and normalized is not None:
                registry = self._registry(model_name, normalized.size, quality_model_name)
                signature = self._gallery_signature(registry, business_date)
                if self._gallery_versions.get(registry) != signature:
                    registry.refresh_gallery(None, observed_at)
                excluded = self._excluded_visitors(
                    camera_id, track_key, coverage, at, business_date
                )
                decision = registry.resolve_entry(
                    track_id=_track_id(track_key),
                    camera_id=None,
                    embedding=normalized,
                    quality_embedding=quality_embedding,
                    detection_confidence=detection_confidence,
                    bbox=bbox,
                    now=observed_at,
                    excluded_visitor_ids=frozenset(excluded),
                )
                if decision.reid_decision == "track_existing" and quality_embedding is not None:
                    registry.record_quality_embedding_for_track(
                        _track_id(track_key), quality_embedding, observed_at
                    )
                self._gallery_versions[registry] = self._gallery_signature(registry, business_date)
            record = {
                "observation_id": observation_id,
                "business_date": business_date,
                "camera_id": camera_id,
                "analysis_mode": analysis_mode,
                "kind": kind,
                "track_key": track_key,
                "revision_id": revision_id,
                "model_name": (
                    f"{model_name}:{normalized.size}"
                    if normalized is not None
                    else previous["model_name"]
                    if previous
                    else None
                ),
                "visitor_id": decision.visitor_id,
                "identity_confidence": decision.identity_confidence,
                "reid_decision": decision.reid_decision,
                "reid_score": decision.reid_score,
                "qualified": int(qualified),
                "first_at": first,
                "last_at": at,
                "ended_at": timestamp(ended_at) if ended_at is not None else None,
                "arrival_observed": int(arrival_observed),
                "departure_observed": int(departure_observed),
                "coverage_json": coverage.model_dump_json(),
                "population_key": population["population_key"],
                "population_context_json": json.dumps(population, sort_keys=True),
                "payload_json": json.dumps(payload or {}, sort_keys=True),
            }
            changed = self.repository.save_observation(record)
            reclassified = bool(
                source is not None
                and (
                    source["visitor_id"] != decision.visitor_id
                    or source["identity_confidence"] != decision.identity_confidence
                    or bool(source["qualified"]) != qualified
                )
            )
            if decision.visitor_id is not None and decision.identity_confidence == "high":
                bound = db.execute(
                    "update establishment_observations set visitor_id=?,identity_confidence='high',"
                    "reid_decision='physical_track' where track_key=? and business_date=? "
                    "and visitor_id is null and qualified=1",
                    (decision.visitor_id, track_key, business_date),
                )
                changed |= bound.rowcount > 0
                reclassified |= bound.rowcount > 0
            if changed:
                reclassified |= self.repository.reconcile_identities(business_date)
                if reclassified:
                    self.repository.reconcile_occupancy_day(business_date, observed_at)
                self.repository.rebuild_day(business_date, observed_at)
                if (
                    analysis_mode == "entrance_exit"
                    and coverage.role != "unconfigured"
                    and (kind in {"entry", "exit"} or arrival_observed or departure_observed)
                ):
                    self.repository.checkpoint_boundary_change(camera_id, observed_at)
            return decision

    def _gallery_signature(
        self, registry: UniqueVisitorRegistry, business_date: str
    ) -> tuple[Any, ...]:
        with self.database.connection() as db:
            row = db.execute(
                "select count(*),sum(embedding_count),sum(identity_status='merged'),"
                "sum(identity_status='provisional'),max(last_seen_at) from visitor_identities "
                "where model_name=? and business_date=?",
                (registry.model_name, business_date),
            ).fetchone()
            quality = db.execute(
                "select coalesce(sum(m.embedding_count),0),max(m.updated_at) "
                "from visitor_model_embeddings m join visitor_identities v on v.visitor_id=m.visitor_id "
                "where m.model_name=? and v.business_date=?",
                (registry.quality_model_name, business_date),
            ).fetchone()
        return (business_date, *tuple(row), *tuple(quality))

    def _registry(
        self,
        model_name: str,
        dimension: int,
        quality_model_name: str | None,
    ) -> UniqueVisitorRegistry:
        key = (model_name, dimension, quality_model_name)
        if key not in self._registries:
            self._registries[key] = UniqueVisitorRegistry(
                self._store,
                model_name=model_name,
                quality_model_name=quality_model_name,
                identity_namespace=f"establishment:v1:{dimension}",
                record_sightings=False,
            )
        return self._registries[key]

    def _excluded_visitors(
        self,
        camera_id: int,
        track_key: str,
        coverage: CameraCoverage,
        at: str,
        business_date: str,
    ) -> set[str]:
        excluded: set[str] = set()
        instant = datetime.fromisoformat(at)
        with self.database.connection() as db:
            rows = db.execute(
                "select camera_id,track_key,visitor_id,last_at,ended_at,coverage_json "
                "from establishment_observations where business_date=? and visitor_id is not null "
                "and track_key!=?",
                (business_date, track_key),
            ).fetchall()
        graph = self.repository.coverage_graph(camera_id, coverage)
        for row in rows:
            elapsed = (instant - datetime.fromisoformat(row["last_at"])).total_seconds()
            if elapsed < 0:
                elapsed = 0
            if row["camera_id"] == camera_id:
                # A short-lived unseen track may be the same returning person;
                # concurrent active tracks represent different physical people.
                current = self._present_tracks.get(camera_id)
                peer_present = (
                    row["track_key"] in current[1]
                    if current is not None and abs((instant - current[0]).total_seconds()) <= 1
                    else row["ended_at"] is None and elapsed <= 1
                )
                if peer_present:
                    excluded.add(row["visitor_id"])
                continue
            relation, minimum = camera_relation_in_graph(
                row["camera_id"],
                camera_id,
                {
                    **graph,
                    row["camera_id"]: CameraCoverage.model_validate_json(row["coverage_json"]),
                },
            )
            if relation == "unknown" or (
                relation == "separate"
                and (
                    (row["ended_at"] is None and elapsed <= 1)
                    or (minimum is not None and elapsed < minimum)
                )
            ):
                excluded.add(row["visitor_id"])
        return excluded

    def cleanup(self, now: datetime | None = None) -> None:
        now = now or datetime.now(UTC)
        with self._lock, self.database.transaction():
            self.repository.cleanup(now)
            self._store.cleanup_expired_visitor_metadata(timestamp(now))


def _track_id(track_key: str) -> int:
    return int.from_bytes(hashlib.sha256(track_key.encode()).digest()[:8], "big")
