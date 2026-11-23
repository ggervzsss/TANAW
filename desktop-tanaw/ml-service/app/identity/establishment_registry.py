"""One serialized daily identity gallery for both camera modes in an enterprise."""

import functools
import hashlib
import json
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from typing import Any, Concatenate, Literal

import numpy as np

from app.attributes import SexEvidence
from app.identity.models import VisitorDecision, normalize_embedding
from app.identity.unique_visitor_registry import UniqueVisitorRegistry
from app.storage.local_database import LocalDatabase
from app.storage.repositories.establishment_repository import (
    TIMEZONE,
    EstablishmentRepository,
    timestamp,
)
from app.storage.session_store import SessionStore

# An uncertain identity is settled when its observation ends, or after this many seconds.
PROVISIONAL_DECISION_SECONDS = 10.0
# Settling compares every view the uncertain identity collected, so it may accept a slightly
# lower score than a single direct match (0.80).
RECONCILIATION_MATCH_THRESHOLD = 0.76
CONSENSUS_RECONCILIATION_MATCH_THRESHOLD = 0.72
# Links between a lost physical track and the track that resumed it are kept this long.
TRACK_LINK_RETENTION_SECONDS = 3600.0
# Every camera asks for the pending-identity sweep; it runs at most this often in total.
MIN_SWEEP_INTERVAL_SECONDS = 1.0
IDENTITY_NAMESPACE = "establishment:v1:"
# A visitor whose latest doorway event is an entry this recent, with no exit since, is inside:
# a new entry that looks like them is someone else, such as a group in matching uniforms.
REENTRY_EXCLUSION_SECONDS = 30.0
# Closer than this, a second entry is the tracker replacing the same person's track; group
# members that close together are normally still in view and excluded as present.
REENTRY_EXCLUSION_MIN_SECONDS = 2.0
# People seen within this long of an observation, without a later end, may still be in view.
PRESENCE_WINDOW_SECONDS = 1.0


def _serialized[**P, R](
    method: Callable[Concatenate["EstablishmentRegistry", P], R],
) -> Callable[Concatenate["EstablishmentRegistry", P], R]:
    """Run the whole method under the registry lock, including any steps it runs first."""

    @functools.wraps(method)
    def locked(self: "EstablishmentRegistry", *args: P.args, **kwargs: P.kwargs) -> R:
        with self._lock:
            return method(self, *args, **kwargs)

    return locked


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
        # Successor physical track key -> (predecessor key, linked at).
        self._track_links: dict[str, tuple[str, datetime]] = {}
        self._last_sweep_at: datetime | None = None
        # Registries recreated after a restart without knowing their quality space.
        self._placeholder_keys: set[tuple[str, int, str | None]] = set()

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
        sex_evidence: SexEvidence | None = None,
        view_embedding: np.ndarray | None = None,
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
                qualified=True,
                first_at=datetime.fromisoformat(source["first_at"]),
                observed_at=observed_at,
                embedding=embedding,
                model_name=model_name,
                quality_embedding=quality_embedding,
                quality_model_name=quality_model_name,
                sex_evidence=sex_evidence,
                payload=json.loads(source["payload_json"]),
                view_embedding=view_embedding,
            )

    @contextmanager
    def atomic(self) -> Iterator[None]:
        """Commit a camera's ledger write and its observations together, or neither.

        The registry lock is taken before the database write lock, the same order every
        observation uses, so two cameras writing at once never wait on each other in a cycle.
        """
        with self._lock, self.database.transaction():
            yield

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

    @_serialized
    def observe(
        self,
        *,
        observation_id: str,
        camera_id: int,
        track_key: str,
        analysis_mode: Literal["entrance_exit", "open_space"],
        kind: Literal["entry", "exit", "area_visit"],
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
        sex_evidence: SexEvidence | None = None,
        view_embedding: np.ndarray | None = None,
    ) -> VisitorDecision:
        """Save one physical observation and resolve which visitor it shows.

        Exits may match an existing visitor but never add one: each exit is usually a new
        physical track, so letting it create visitors would count a missed match twice.
        """
        at = timestamp(observed_at)
        first = timestamp(first_at)
        if camera_id <= 0 or not observation_id or not track_key or first > at:
            raise ValueError(
                "A valid camera, observation, physical track, and time range are required."
            )
        if ended_at is not None and not first <= timestamp(ended_at) <= at:
            raise ValueError("A visit endpoint must fall within its observation range.")
        crossing = (
            self._unidentified_crossing_day(observation_id, observed_at)
            if analysis_mode == "entrance_exit" and kind == "entry" and embedding is not None
            else None
        )
        if crossing is not None:
            # Identification that finishes after midnight still identifies the entry on the
            # day it crossed; the continuing observation then counts on the new day as well.
            self.observe(
                observation_id=observation_id,
                camera_id=camera_id,
                track_key=track_key,
                analysis_mode=analysis_mode,
                kind=kind,
                qualified=qualified,
                first_at=crossing[0],
                observed_at=crossing[1],
                embedding=embedding,
                model_name=model_name,
                quality_embedding=quality_embedding,
                quality_model_name=quality_model_name,
                revision_id=revision_id,
                arrival_observed=arrival_observed,
                detection_confidence=detection_confidence,
                bbox=bbox,
                payload=payload,
                sex_evidence=sex_evidence,
                view_embedding=view_embedding,
            )
        track_key = f"{camera_id}:{track_key}"
        business_date = observed_at.astimezone(TIMEZONE).date().isoformat()
        normalized = normalize_embedding(embedding) if embedding is not None else None
        with self._lock, self.database.transaction() as db:
            source = db.execute(
                "select first_at,camera_id,track_key,kind from establishment_observations "
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
            finalized = False
            if qualified and normalized is not None:
                registry = self._registry(model_name, normalized.size, quality_model_name)
                self._refresh_registry(registry, business_date, observed_at)
                excluded = self._excluded_visitors(
                    track_key, at, business_date, entering=kind == "entry"
                )
                # Each uncertain identity excludes the people seen beside it, whoever this
                # observation's track is.
                finalized = registry.finalize_due_provisionals(observed_at)
                physical_track = _track_id(track_key)
                if registry.visitor_id_for_track(physical_track) is None:
                    # A track that resumed a lost one is the same person, whatever its score.
                    linked = self._linked_visitor(db, track_key, business_date)
                    if linked is not None and linked not in excluded:
                        registry.bind_track(physical_track, linked)
                decision = registry.resolve_entry(
                    track_id=physical_track,
                    camera_id=None,
                    embedding=normalized,
                    quality_embedding=quality_embedding,
                    detection_confidence=detection_confidence,
                    bbox=bbox,
                    now=observed_at,
                    excluded_visitor_ids=frozenset(excluded),
                    view_embedding=view_embedding,
                    finalize=ended_at is not None,
                    allow_new_identity=kind != "exit",
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
                "payload_json": json.dumps(payload or {}, sort_keys=True),
                # The track's latest male/female evidence replaces earlier, weaker evidence.
                "sex_logit_sum": sex_evidence.logit_sum if sex_evidence else None,
                "sex_weight": sex_evidence.weight if sex_evidence else 0.0,
                "sex_model": sex_evidence.model if sex_evidence else None,
            }
            changed = self.repository.save_observation(record) or finalized
            if decision.visitor_id is not None and decision.identity_confidence == "high":
                changed |= self._bind_unidentified(
                    db, self._link_group(track_key), decision.visitor_id, business_date
                )
            if changed:
                self.repository.reconcile_identities(business_date)
                self.repository.mark_day_changed(business_date, observed_at)
            return decision

    def _unidentified_crossing_day(
        self, observation_id: str, observed_at: datetime
    ) -> tuple[datetime, datetime] | None:
        """The span of an entry still unidentified on an earlier day than ``observed_at``."""
        with self.database.connection() as db:
            row = db.execute(
                "select business_date,first_at,last_at,visitor_id from establishment_observations "
                "where observation_id=? order by business_date limit 1",
                (observation_id,),
            ).fetchone()
        if (
            row is None
            or row["visitor_id"] is not None
            or row["business_date"] == observed_at.astimezone(TIMEZONE).date().isoformat()
        ):
            return None
        return datetime.fromisoformat(row["first_at"]), datetime.fromisoformat(row["last_at"])

    def link_track(
        self,
        *,
        camera_id: int,
        track_key: str,
        predecessor_track_key: str,
        observed_at: datetime,
    ) -> str | None:
        """Record that a new physical track resumed a lost one on the same camera.

        The camera decides the link from timing, position, and appearance; both tracks then
        share one visitor. When the new track already has a visitor of its own, the two are
        merged only if that visitor came from the new track alone and the two were never seen
        at the same time: a link is weaker evidence than a daily match, so it never joins two
        established visitors. Returns the shared visitor, or None when the link is refused.
        """
        successor = f"{camera_id}:{track_key}"
        predecessor = f"{camera_id}:{predecessor_track_key}"
        if successor == predecessor:
            return None
        at = timestamp(observed_at)
        business_date = observed_at.astimezone(TIMEZONE).date().isoformat()
        with self._lock, self.database.transaction() as db:
            self._track_links[successor] = (predecessor, observed_at)
            self._track_links = {
                key: link
                for key, link in self._track_links.items()
                if (observed_at - link[1]).total_seconds() < TRACK_LINK_RETENTION_SECONDS
            }
            for registry in self._registries.values():
                self._refresh_registry(registry, business_date, observed_at)
            visitor = self._linked_visitor(db, successor, business_date)
            if visitor is None:
                return None
            changed = False
            excluded = self._excluded_visitors(successor, at, business_date)
            if visitor in excluded:
                return None
            own = self._track_visitor(db, successor, business_date)
            if own is not None and own != visitor:
                if own in excluded or not self._visitor_only_on(
                    db, own, self._link_group(successor), business_date
                ):
                    return None
                merged = self._merge_visitors(own, visitor, observed_at)
                if merged is None:
                    return None
                visitor, changed = merged, True
            for registry in self._registries.values():
                if registry.visitor_id_for_track(_track_id(successor)) is None:
                    registry.bind_track(_track_id(successor), visitor)
            changed |= self._bind_unidentified(
                db, self._link_group(successor), visitor, business_date
            )
            if changed:
                self.repository.reconcile_identities(business_date)
                self.repository.mark_day_changed(business_date, observed_at)
            return visitor

    def finalize_pending(self, now: datetime | None = None) -> bool:
        """Settle uncertain identities whose wait elapsed, even while no camera sees anyone.

        Registries for today's uncertain identities are created on demand, so identities left
        waiting when the service stopped are settled after a restart too.
        """
        now = now or datetime.now(UTC)
        business_date = now.astimezone(TIMEZONE).date().isoformat()
        with self._lock, self.database.transaction() as db:
            if (
                self._last_sweep_at is not None
                and 0 <= (now - self._last_sweep_at).total_seconds() < MIN_SWEEP_INTERVAL_SECONDS
            ):
                return False
            self._last_sweep_at = now
            settled_yesterday = self._settle_previous_day(db, now)
            spaces = {
                str(row["model_name"])
                for row in db.execute(
                    "select distinct model_name from visitor_identities "
                    "where business_date=? and identity_status='provisional'",
                    (business_date,),
                )
            }
            if not spaces:
                return settled_yesterday
            for space in spaces:
                self._registry_for_space(db, space, business_date)
            changed = False
            for registry in list(self._registries.values()):
                if registry.model_name not in spaces:
                    continue
                self._refresh_registry(registry, business_date, now)
                if registry.finalize_due_provisionals(now):
                    changed = True
                    self._gallery_versions[registry] = self._gallery_signature(
                        registry, business_date
                    )
            if changed:
                self.repository.reconcile_identities(business_date)
                self.repository.mark_day_changed(business_date, now)
        return changed or settled_yesterday

    def _settle_previous_day(self, db: Any, now: datetime) -> bool:
        """Settle uncertain identities left from the business day that just ended.

        An identity created seconds before midnight would otherwise wait for a sweep of a day
        no sweep looks at, and that day would be finalized with the visitor unresolved.
        """
        today = now.astimezone(TIMEZONE).date()
        previous = (today - timedelta(days=1)).isoformat()
        spaces = {
            str(row["model_name"])
            for row in db.execute(
                "select distinct model_name from visitor_identities "
                "where business_date=? and identity_status='provisional'",
                (previous,),
            )
        }
        if not spaces:
            return False
        day_end = datetime.combine(today, time.min, TIMEZONE) - timedelta(microseconds=1)
        for space in spaces:
            self._registry_for_space(db, space, previous)
        changed = False
        for registry in list(self._registries.values()):
            if registry.model_name not in spaces:
                continue
            self._refresh_registry(registry, previous, day_end)
            changed |= registry.finalize_due_provisionals(day_end, force=True)
            self._gallery_versions.pop(registry, None)
        if changed:
            self.repository.reconcile_identities(previous)
            self.repository.mark_day_changed(previous, now)
        return changed

    def _refresh_registry(
        self, registry: UniqueVisitorRegistry, business_date: str, now: datetime
    ) -> None:
        """Reload a registry's gallery when the database changed, keeping its wait clocks."""
        if self._gallery_versions.get(registry) == self._gallery_signature(registry, business_date):
            return
        registry.refresh_gallery(None, now)
        with self.database.connection() as db:
            for row in db.execute(
                "select visitor_id,first_seen_at from visitor_identities where business_date=? "
                "and model_name=? and identity_status='provisional'",
                (business_date, registry.model_name),
            ):
                registry.note_provisional_since(
                    str(row["visitor_id"]), datetime.fromisoformat(row["first_seen_at"])
                )
        self._gallery_versions[registry] = self._gallery_signature(registry, business_date)

    def _registry_for_space(self, db: Any, space: str, business_date: str) -> None:
        """The registry for a stored identity space, e.g. after a restart."""
        model_name, separator, dimension = space.rpartition(f"@{IDENTITY_NAMESPACE}")
        if not separator or not dimension.isdigit():
            return
        if any(registry.model_name == space for registry in self._registries.values()):
            return
        row = db.execute(
            "select m.model_name from visitor_model_embeddings m join visitor_identities v "
            "on v.visitor_id=m.visitor_id where v.business_date=? and v.model_name=? limit 1",
            (business_date, space),
        ).fetchone()
        quality = str(row["model_name"]).rpartition("@")[0] if row is not None else None
        key = (model_name, int(dimension), quality)
        if quality is None and key not in self._registries:
            self._placeholder_keys.add(key)
        self._registry(model_name, int(dimension), quality)

    def _track_visitor(self, db: Any, track_key: str, business_date: str) -> str | None:
        """The visitor a physical track is already counted as, if any."""
        for registry in self._registries.values():
            visitor = registry.visitor_id_for_track(_track_id(track_key))
            if visitor is not None:
                return visitor
        row = db.execute(
            "select visitor_id from establishment_observations where business_date=? "
            "and track_key=? and visitor_id is not null order by last_at desc limit 1",
            (business_date, track_key),
        ).fetchone()
        return str(row["visitor_id"]) if row is not None else None

    @staticmethod
    def _visitor_only_on(
        db: Any, visitor_id: str, track_keys: set[str], business_date: str
    ) -> bool:
        """Whether every observation of this visitor today belongs to these tracks."""
        keys = sorted(track_keys)
        placeholders = ",".join("?" for _ in keys)
        row = db.execute(
            "select count(*) from establishment_observations where business_date=? "
            f"and visitor_id=? and track_key not in ({placeholders})",
            (business_date, visitor_id, *keys),
        ).fetchone()
        return int(row[0]) == 0

    def _merge_visitors(self, alias: str, canonical: str, now: datetime) -> str | None:
        """Merge two visitors shown by linked tracks; returns the surviving visitor."""
        if canonical in self._co_visible_visitors(alias):
            return None
        for registry in self._registries.values():
            merged = registry.merge_visitors(alias, canonical, now)
            if merged is not None:
                return merged
        return None

    def _co_visible_visitors(self, visitor_id: str) -> frozenset[str]:
        """Visitors observed while this visitor was in view, on any camera: other people.

        Saved rows lag the cameras by a couple of seconds, so a track still in view counts
        as seen until its camera's latest frame, not only until its last saved row.
        """
        seen_until: dict[str, datetime] = {}
        for at, keys in self._present_tracks.values():
            for key in keys:
                seen_until[key] = max(at, seen_until.get(key, at))

        def span(row: Any) -> tuple[datetime, datetime]:
            first = datetime.fromisoformat(row["first_at"])
            last = datetime.fromisoformat(row["last_at"])
            live = seen_until.get(row["track_key"])
            if row["ended_at"] is None and live is not None and live > last:
                last = live
            return first, last

        with self.database.connection() as db:
            own = db.execute(
                "select business_date,track_key,first_at,last_at,ended_at "
                "from establishment_observations where visitor_id=?",
                (visitor_id,),
            ).fetchall()
            if not own:
                return frozenset()
            spans = [span(row) for row in own]
            dates = sorted({str(row["business_date"]) for row in own})
            live_keys = sorted(seen_until)
            # Only rows whose span can overlap this visitor's: saved, or still in view.
            live_clause = (
                f" or (ended_at is null and track_key in ({','.join('?' for _ in live_keys)}))"
                if live_keys
                else ""
            )
            others = db.execute(
                "select visitor_id,track_key,first_at,last_at,ended_at "
                f"from establishment_observations where business_date in "
                f"({','.join('?' for _ in dates)}) and visitor_id is not null and visitor_id!=? "
                f"and first_at<=? and (last_at>=?{live_clause})",
                (
                    *dates,
                    visitor_id,
                    timestamp(max(last for _, last in spans)),
                    timestamp(min(first for first, _ in spans)),
                    *live_keys,
                ),
            ).fetchall()

        own_keys = {row["track_key"] for row in own}
        co_visible: set[str] = set()
        for row in others:
            if row["track_key"] in own_keys or row["visitor_id"] in co_visible:
                continue
            first, last = span(row)
            if any(first <= own_last and own_first <= last for own_first, own_last in spans):
                co_visible.add(str(row["visitor_id"]))
        return frozenset(co_visible)

    def _link_group(self, track_key: str) -> set[str]:
        """The track and every track linked to it, in either direction."""
        group = {track_key}
        while True:
            grown = group | {
                key
                for key, (predecessor, _) in self._track_links.items()
                if key in group or predecessor in group
            }
            grown |= {
                predecessor for key, (predecessor, _) in self._track_links.items() if key in group
            }
            if grown == group:
                return group
            group = grown

    def _linked_visitor(self, db: Any, track_key: str, business_date: str) -> str | None:
        """The visitor already identified on a track linked to this one, if any."""
        others = sorted(self._link_group(track_key) - {track_key})
        if not others:
            return None
        placeholders = ",".join("?" for _ in others)
        row = db.execute(
            "select visitor_id from establishment_observations where business_date=? "
            f"and track_key in ({placeholders}) and visitor_id is not null "
            "order by identity_confidence='high' desc,last_at desc limit 1",
            (business_date, *others),
        ).fetchone()
        return str(row["visitor_id"]) if row is not None else None

    @staticmethod
    def _bind_unidentified(
        db: Any, track_keys: set[str], visitor_id: str, business_date: str
    ) -> bool:
        """Give linked tracks' unidentified observations this visitor.

        They count only once the visitor is confirmed; an uncertain one stays low confidence.
        """
        status = db.execute(
            "select identity_status from visitor_identities where visitor_id=?", (visitor_id,)
        ).fetchone()
        confidence = "high" if status is not None and status[0] == "confirmed" else "low"
        keys = sorted(track_keys)
        placeholders = ",".join("?" for _ in keys)
        bound = db.execute(
            "update establishment_observations set visitor_id=?,identity_confidence=?,"
            f"reid_decision='physical_track' where track_key in ({placeholders}) "
            "and business_date=? and visitor_id is null and qualified=1",
            (visitor_id, confidence, *keys, business_date),
        )
        return bool(bound.rowcount > 0)

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
            # A registry recreated after a restart may not know the quality space; a camera's
            # request supersedes it. It holds no track bindings, so nothing is lost.
            placeholder = (model_name, dimension, None)
            if quality_model_name is not None and placeholder in self._placeholder_keys:
                self._placeholder_keys.discard(placeholder)
                self._gallery_versions.pop(self._registries.pop(placeholder), None)
            registry = UniqueVisitorRegistry(
                self._store,
                model_name=model_name,
                quality_model_name=quality_model_name,
                identity_namespace=f"{IDENTITY_NAMESPACE}{dimension}",
                record_sightings=False,
                reconciliation_match_threshold=RECONCILIATION_MATCH_THRESHOLD,
                consensus_reconciliation_match_threshold=CONSENSUS_RECONCILIATION_MATCH_THRESHOLD,
                provisional_decision_seconds=PROVISIONAL_DECISION_SECONDS,
            )
            registry.co_visible_visitors = self._co_visible_visitors
            self._registries[key] = registry
        return self._registries[key]

    def _excluded_visitors(
        self, track_key: str, at: str, business_date: str, *, entering: bool = False
    ) -> set[str]:
        """Visitors physically present on any camera right now are other people.

        Cameras watch different places, so a person still in view elsewhere at this
        instant cannot be the one being observed here. Anyone seen earlier today, on
        any camera, may be matched. A doorway entry also excludes visitors who entered
        moments ago and have not left (see ``REENTRY_EXCLUSION_SECONDS``).
        """
        excluded: set[str] = set()
        instant = datetime.fromisoformat(at)
        present_keys = sorted(
            {key for _, keys in self._present_tracks.values() for key in keys} - {track_key}
        )
        present_clause = (
            f" or track_key in ({','.join('?' for _ in present_keys)})" if present_keys else ""
        )
        with self.database.connection() as db:
            # Only rows that can still be in view: seen within the window, or tracked now.
            rows = db.execute(
                "select camera_id,track_key,visitor_id,last_at,ended_at "
                "from establishment_observations where business_date=? and visitor_id is not null "
                f"and track_key!=? and (last_at>=?{present_clause})",
                (
                    business_date,
                    track_key,
                    timestamp(instant - timedelta(seconds=PRESENCE_WINDOW_SECONDS)),
                    *present_keys,
                ),
            ).fetchall()
            if entering:
                excluded |= self._just_entered_visitors(db, track_key, instant, business_date)
        for row in rows:
            elapsed = max(0.0, (instant - datetime.fromisoformat(row["last_at"])).total_seconds())
            current = self._present_tracks.get(row["camera_id"])
            present = (
                row["track_key"] in current[1]
                if current is not None
                and abs((instant - current[0]).total_seconds()) <= PRESENCE_WINDOW_SECONDS
                else row["ended_at"] is None and elapsed <= PRESENCE_WINDOW_SECONDS
            )
            if present:
                excluded.add(row["visitor_id"])
        return excluded

    @staticmethod
    def _just_entered_visitors(
        db: Any, track_key: str, instant: datetime, business_date: str
    ) -> set[str]:
        rows = db.execute(
            "select visitor_id,kind,first_at,last_at from establishment_observations "
            "where business_date=? and analysis_mode='entrance_exit' and visitor_id is not null "
            "and track_key!=? and last_at>=?",
            (
                business_date,
                track_key,
                timestamp(instant - timedelta(seconds=REENTRY_EXCLUSION_SECONDS)),
            ),
        ).fetchall()
        latest: dict[str, tuple[str, str]] = {}
        for row in rows:
            event_at = row["last_at"] if row["kind"] == "exit" else row["first_at"]
            if row["visitor_id"] not in latest or event_at > latest[row["visitor_id"]][0]:
                latest[row["visitor_id"]] = (event_at, row["kind"])
        oldest = timestamp(instant - timedelta(seconds=REENTRY_EXCLUSION_SECONDS))
        newest = timestamp(instant - timedelta(seconds=REENTRY_EXCLUSION_MIN_SECONDS))
        return {
            visitor
            for visitor, (event_at, kind) in latest.items()
            if kind == "entry" and oldest <= event_at <= newest
        }

    def cleanup(self, now: datetime | None = None) -> None:
        now = now or datetime.now(UTC)
        with self._lock, self.database.transaction():
            self.repository.cleanup(now)
            self._store.cleanup_expired_visitor_metadata(timestamp(now))


def _track_id(track_key: str) -> int:
    return int.from_bytes(hashlib.sha256(track_key.encode()).digest()[:8], "big")
