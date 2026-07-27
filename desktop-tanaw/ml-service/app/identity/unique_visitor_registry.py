from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import numpy as np

from app.storage.session_store import SessionStore


@dataclass(frozen=True)
class VisitorDecision:
    visitor_id: str | None
    is_unique_entry: bool
    reid_score: float | None
    reid_decision: str
    identity_confidence: str
    business_date: str

    def as_event_fields(self) -> dict[str, Any]:
        return {
            "visitor_id": self.visitor_id,
            "is_unique_entry": self.is_unique_entry,
            "reid_score": self.reid_score,
            "reid_decision": self.reid_decision,
            "identity_confidence": self.identity_confidence,
            "business_date": self.business_date,
        }


@dataclass
class VisitorPrototype:
    prototype_index: int
    embedding: np.ndarray
    embedding_count: int


@dataclass
class VisitorIdentity:
    visitor_id: str
    business_date: str
    camera_id: int | None
    embedding: np.ndarray
    embedding_count: int
    model_name: str
    expires_at: str
    identity_status: str = "confirmed"
    canonical_visitor_id: str | None = None
    prototypes: list[VisitorPrototype] = field(default_factory=list)


@dataclass
class VisitorModelEmbedding:
    visitor_id: str
    embedding: np.ndarray
    embedding_count: int
    model_name: str


class UniqueVisitorRegistry:
    def __init__(
        self,
        session_store: SessionStore,
        model_name: str = "person_reid_onnx",
        timezone_name: str = "Asia/Manila",
        retention_grace_hours: int = 2,
        strong_match_threshold: float = 0.72,
        new_visitor_threshold: float = 0.60,
        top_match_margin: float = 0.05,
        quality_model_name: str | None = None,
        quality_strong_match_threshold: float = 0.74,
        quality_top_match_margin: float = 0.05,
        max_prototypes_per_identity: int = 3,
        prototype_update_threshold: float = 0.82,
    ) -> None:
        self._session_store = session_store
        self.model_name = model_name
        self.timezone = ZoneInfo(timezone_name)
        self.retention_grace_hours = retention_grace_hours
        self.strong_match_threshold = strong_match_threshold
        self.new_visitor_threshold = new_visitor_threshold
        self.top_match_margin = top_match_margin
        self.quality_model_name = quality_model_name
        self.quality_strong_match_threshold = quality_strong_match_threshold
        self.quality_top_match_margin = quality_top_match_margin
        self.max_prototypes_per_identity = max(1, max_prototypes_per_identity)
        self.prototype_update_threshold = prototype_update_threshold
        self._business_date: str | None = None
        self._camera_id: int | None = None
        self._gallery: list[VisitorIdentity] = []
        self._quality_gallery: dict[str, VisitorModelEmbedding] = {}
        self._track_visitors: dict[int, str] = {}
        self._last_cleanup_at: str | None = None

    def prepare(self, camera_id: int | None, now: datetime | None = None) -> None:
        now = now or datetime.now(UTC)
        self.cleanup_expired(now)
        business_date = self.business_date_for(now)
        if business_date == self._business_date and camera_id == self._camera_id:
            return

        self._business_date = business_date
        self._camera_id = camera_id
        self._track_visitors.clear()
        self._gallery = self._load_gallery(business_date, camera_id, now)
        self._quality_gallery = self._load_quality_gallery(business_date, camera_id, now)

    def reset_session_tracks(self) -> None:
        self._track_visitors.clear()

    def remap_session_track(self, previous_track_id: int, target_track_id: int) -> None:
        visitor_id = self._track_visitors.pop(previous_track_id, None)
        if visitor_id is not None and target_track_id not in self._track_visitors:
            self._track_visitors[target_track_id] = visitor_id

    def visitor_id_for_track(self, track_id: int) -> str | None:
        return self._track_visitors.get(track_id)

    def cleanup_expired(self, now: datetime | None = None) -> int:
        now = now or datetime.now(UTC)
        deleted_count = self._session_store.cleanup_expired_visitor_metadata(now.isoformat())
        self._last_cleanup_at = now.isoformat()
        if deleted_count and self._business_date is not None:
            self._gallery = self._load_gallery(self._business_date, self._camera_id, now)
            self._quality_gallery = self._load_quality_gallery(
                self._business_date, self._camera_id, now
            )
        return deleted_count

    def status(self) -> dict[str, int | str | None]:
        return {
            "reid_gallery_size": len(self._gallery),
            "reid_provisional_gallery_size": sum(
                identity.identity_status == "provisional" for identity in self._gallery
            ),
            "reid_quality_gallery_size": len(self._quality_gallery),
            "reid_business_date": self._business_date,
            "reid_last_cleanup_at": self._last_cleanup_at,
        }

    def resolve_entry(
        self,
        *,
        track_id: int,
        camera_id: int | None,
        embedding: np.ndarray | None,
        detection_confidence: float | None,
        bbox: tuple[int, int, int, int] | None,
        quality_embedding: np.ndarray | None = None,
        now: datetime | None = None,
    ) -> VisitorDecision:
        now = now or datetime.now(UTC)
        self.prepare(camera_id, now)
        business_date = self.business_date_for(now)

        if track_id in self._track_visitors:
            visitor_id = self._track_visitors[track_id]
            decision = VisitorDecision(
                visitor_id=visitor_id,
                is_unique_entry=False,
                reid_score=1.0,
                reid_decision="track_existing",
                identity_confidence="high",
                business_date=business_date,
            )
            self._persist_sighting(decision, track_id, camera_id, detection_confidence, bbox, now)
            return decision

        if embedding is None:
            return VisitorDecision(
                visitor_id=None,
                is_unique_entry=True,
                reid_score=None,
                reid_decision="degraded_no_embedding",
                identity_confidence="degraded",
                business_date=business_date,
            )

        normalized = _normalize_embedding(embedding)
        if normalized is None:
            return VisitorDecision(
                visitor_id=None,
                is_unique_entry=True,
                reid_score=None,
                reid_decision="degraded_invalid_embedding",
                identity_confidence="degraded",
                business_date=business_date,
            )

        quality_normalized = (
            _normalize_embedding(quality_embedding) if quality_embedding is not None else None
        )
        quality_match, quality_score, quality_margin = self._best_quality_match(quality_normalized)
        fast_match, fast_score, fast_margin = self._best_match(normalized)

        match = None
        score = fast_score
        decision_name = "matched_existing"
        if (
            quality_match is not None
            and quality_score is not None
            and quality_score >= self.quality_strong_match_threshold
            and quality_margin >= self.quality_top_match_margin
        ):
            match = quality_match
            score = quality_score
            decision_name = "matched_existing_quality"
        elif (
            fast_match is not None
            and fast_score is not None
            and fast_score >= self.strong_match_threshold
            and fast_margin >= self.top_match_margin
        ):
            match = fast_match

        if match is not None:
            selected_fast_score = float(match.embedding @ normalized)
            if (
                decision_name != "matched_existing_quality"
                or selected_fast_score >= self.new_visitor_threshold
            ):
                self._update_identity(match, normalized, now)
            if quality_normalized is not None:
                self._update_quality_embedding(match.visitor_id, quality_normalized, now)

            if match.identity_status == "provisional":
                canonical, reconciliation_score = self._best_reconciliation_match(match)
                if canonical is not None:
                    self._merge_identity(match, canonical, now)
                    self._track_visitors[track_id] = canonical.visitor_id
                    decision = VisitorDecision(
                        visitor_id=canonical.visitor_id,
                        is_unique_entry=False,
                        reid_score=reconciliation_score,
                        reid_decision="reconciled_existing",
                        identity_confidence="high",
                        business_date=business_date,
                    )
                    self._persist_sighting(
                        decision, track_id, camera_id, detection_confidence, bbox, now
                    )
                    return decision

                match.identity_status = "confirmed"
                self._session_store.resolve_visitor_identity(
                    match.visitor_id,
                    identity_status="confirmed",
                    recorded_at=now.isoformat(),
                )
                self._track_visitors[track_id] = match.visitor_id
                decision = VisitorDecision(
                    visitor_id=match.visitor_id,
                    is_unique_entry=True,
                    reid_score=score,
                    reid_decision="provisional_confirmed",
                    identity_confidence="high",
                    business_date=business_date,
                )
                self._persist_sighting(
                    decision, track_id, camera_id, detection_confidence, bbox, now
                )
                return decision

            self._track_visitors[track_id] = match.visitor_id
            decision = VisitorDecision(
                visitor_id=match.visitor_id,
                is_unique_entry=False,
                reid_score=score,
                reid_decision=decision_name,
                identity_confidence="high",
                business_date=business_date,
            )
            self._persist_sighting(decision, track_id, camera_id, detection_confidence, bbox, now)
            return decision

        visitor_id = str(uuid4())
        decision_name = "new"
        confidence = "high"
        if fast_score is not None and fast_score >= self.new_visitor_threshold:
            decision_name = "ambiguous_new"
            confidence = "low"

        identity = VisitorIdentity(
            visitor_id=visitor_id,
            business_date=business_date,
            camera_id=camera_id,
            embedding=normalized,
            embedding_count=1,
            model_name=self.model_name,
            expires_at=self.expires_at_for(now).isoformat(),
            identity_status="provisional" if confidence == "low" else "confirmed",
            prototypes=[
                VisitorPrototype(
                    prototype_index=0,
                    embedding=normalized,
                    embedding_count=1,
                )
            ],
        )
        self._gallery.append(identity)
        self._track_visitors[track_id] = visitor_id
        self._persist_identity(identity, now)
        if quality_normalized is not None:
            self._update_quality_embedding(visitor_id, quality_normalized, now)
        decision = VisitorDecision(
            visitor_id=visitor_id,
            is_unique_entry=confidence == "high",
            reid_score=fast_score,
            reid_decision=decision_name,
            identity_confidence=confidence,
            business_date=business_date,
        )
        self._persist_sighting(decision, track_id, camera_id, detection_confidence, bbox, now)
        return decision

    def record_quality_embedding_for_track(
        self,
        track_id: int,
        embedding: np.ndarray,
        now: datetime | None = None,
    ) -> bool:
        visitor_id = self._track_visitors.get(track_id)
        normalized = _normalize_embedding(embedding)
        if visitor_id is None or normalized is None:
            return False
        self._update_quality_embedding(visitor_id, normalized, now or datetime.now(UTC))
        return True

    def business_date_for(self, now: datetime) -> str:
        return now.astimezone(self.timezone).date().isoformat()

    def expires_at_for(self, now: datetime) -> datetime:
        local_now = now.astimezone(self.timezone)
        end_of_day = datetime.combine(local_now.date(), time.max, tzinfo=self.timezone)
        return (end_of_day + timedelta(hours=self.retention_grace_hours)).astimezone(UTC)

    def _load_gallery(
        self, business_date: str, camera_id: int | None, now: datetime
    ) -> list[VisitorIdentity]:
        rows = self._session_store.load_active_visitor_identities(business_date, now.isoformat())
        gallery: list[VisitorIdentity] = []
        prototypes_by_visitor: dict[str, list[VisitorPrototype]] = {}
        prototype_rows = self._session_store.load_active_visitor_identity_prototypes(
            business_date, self.model_name, now.isoformat()
        )
        for prototype_row in prototype_rows:
            prototype_embedding = np.frombuffer(
                prototype_row["representative_embedding"], dtype=np.float32
            )
            if prototype_embedding.size != int(prototype_row["embedding_dim"]):
                continue
            normalized_prototype = _normalize_embedding(prototype_embedding)
            if normalized_prototype is None:
                continue
            prototypes_by_visitor.setdefault(prototype_row["visitor_id"], []).append(
                VisitorPrototype(
                    prototype_index=int(prototype_row["prototype_index"]),
                    embedding=normalized_prototype,
                    embedding_count=int(prototype_row["embedding_count"]),
                )
            )

        for row in rows:
            if row.get("model_name") != self.model_name:
                continue
            row_camera_id = row.get("camera_id")
            if camera_id is not None and row_camera_id != camera_id:
                continue
            if camera_id is None and row_camera_id is not None:
                continue

            embedding = np.frombuffer(row["representative_embedding"], dtype=np.float32)
            expected_dim = int(row["embedding_dim"])
            if embedding.size != expected_dim:
                continue
            normalized = _normalize_embedding(embedding)
            if normalized is None:
                continue
            prototypes = prototypes_by_visitor.get(row["visitor_id"]) or [
                VisitorPrototype(
                    prototype_index=0,
                    embedding=normalized,
                    embedding_count=int(row["embedding_count"]),
                )
            ]
            gallery.append(
                VisitorIdentity(
                    visitor_id=row["visitor_id"],
                    business_date=row["business_date"],
                    camera_id=row_camera_id,
                    embedding=normalized,
                    embedding_count=int(row["embedding_count"]),
                    model_name=row["model_name"],
                    expires_at=row["expires_at"],
                    identity_status=row.get("identity_status") or "confirmed",
                    canonical_visitor_id=row.get("canonical_visitor_id"),
                    prototypes=prototypes,
                )
            )
        return gallery

    def _load_quality_gallery(
        self,
        business_date: str,
        camera_id: int | None,
        now: datetime,
    ) -> dict[str, VisitorModelEmbedding]:
        if self.quality_model_name is None:
            return {}

        valid_visitor_ids = {identity.visitor_id for identity in self._gallery}
        gallery: dict[str, VisitorModelEmbedding] = {}
        rows = self._session_store.load_active_visitor_model_embeddings(
            business_date,
            self.quality_model_name,
            now.isoformat(),
        )
        for row in rows:
            visitor_id = row["visitor_id"]
            if visitor_id not in valid_visitor_ids:
                continue
            row_camera_id = row.get("camera_id")
            if camera_id is not None and row_camera_id != camera_id:
                continue
            if camera_id is None and row_camera_id is not None:
                continue
            embedding = np.frombuffer(row["representative_embedding"], dtype=np.float32)
            if embedding.size != int(row["embedding_dim"]):
                continue
            normalized = _normalize_embedding(embedding)
            if normalized is None:
                continue
            gallery[visitor_id] = VisitorModelEmbedding(
                visitor_id=visitor_id,
                embedding=normalized,
                embedding_count=int(row["embedding_count"]),
                model_name=row["model_name"],
            )
        return gallery

    def _best_match(
        self, embedding: np.ndarray
    ) -> tuple[VisitorIdentity | None, float | None, float]:
        if not self._gallery:
            return None, None, 1.0

        scores = np.asarray(
            [self._identity_score(identity, embedding) for identity in self._gallery],
            dtype=np.float32,
        )
        order = np.argsort(scores)[::-1]
        best_index = int(order[0])
        best_score = float(scores[best_index])
        second_score = float(scores[int(order[1])]) if len(order) > 1 else -1.0
        return self._gallery[best_index], best_score, best_score - second_score

    def _best_quality_match(
        self,
        embedding: np.ndarray | None,
    ) -> tuple[VisitorIdentity | None, float | None, float]:
        if embedding is None or not self._quality_gallery:
            return None, None, 1.0

        quality_entries = list(self._quality_gallery.values())
        gallery_embeddings = np.stack([entry.embedding for entry in quality_entries]).astype(
            np.float32
        )
        scores = gallery_embeddings @ embedding.astype(np.float32)
        order = np.argsort(scores)[::-1]
        best_index = int(order[0])
        best_score = float(scores[best_index])
        second_score = float(scores[int(order[1])]) if len(order) > 1 else -1.0
        visitor_id = quality_entries[best_index].visitor_id
        identity = next((item for item in self._gallery if item.visitor_id == visitor_id), None)
        return identity, best_score, best_score - second_score

    def _update_identity(
        self, identity: VisitorIdentity, embedding: np.ndarray, now: datetime
    ) -> None:
        updated_count = identity.embedding_count + 1
        updated_embedding = _normalize_embedding(
            (identity.embedding * identity.embedding_count + embedding) / updated_count
        )
        if updated_embedding is None:
            return

        identity.embedding = updated_embedding
        identity.embedding_count = updated_count
        identity.expires_at = self.expires_at_for(now).isoformat()
        self._update_prototype(identity, embedding, now)
        self._persist_identity(identity, now)

    def _identity_score(self, identity: VisitorIdentity, embedding: np.ndarray) -> float:
        scores = [float(identity.embedding @ embedding)]
        scores.extend(float(prototype.embedding @ embedding) for prototype in identity.prototypes)
        return max(scores)

    def _update_prototype(
        self,
        identity: VisitorIdentity,
        embedding: np.ndarray,
        now: datetime,
        sample_count: int = 1,
    ) -> None:
        if not identity.prototypes:
            prototype = VisitorPrototype(0, embedding, sample_count)
            identity.prototypes.append(prototype)
            self._persist_prototype(identity, prototype, now)
            return

        scores = [float(prototype.embedding @ embedding) for prototype in identity.prototypes]
        best_index = int(np.argmax(scores))
        if (
            scores[best_index] < self.prototype_update_threshold
            and len(identity.prototypes) < self.max_prototypes_per_identity
        ):
            prototype = VisitorPrototype(
                prototype_index=max(item.prototype_index for item in identity.prototypes) + 1,
                embedding=embedding,
                embedding_count=sample_count,
            )
            identity.prototypes.append(prototype)
            self._persist_prototype(identity, prototype, now)
            return

        prototype = identity.prototypes[best_index]
        updated_count = prototype.embedding_count + sample_count
        updated_embedding = _normalize_embedding(
            (prototype.embedding * prototype.embedding_count + embedding * sample_count)
            / updated_count
        )
        if updated_embedding is None:
            return
        prototype.embedding = updated_embedding
        prototype.embedding_count = updated_count
        self._persist_prototype(identity, prototype, now)

    def _best_reconciliation_match(
        self, provisional: VisitorIdentity
    ) -> tuple[VisitorIdentity | None, float | None]:
        confirmed = [
            identity
            for identity in self._gallery
            if identity.visitor_id != provisional.visitor_id
            and identity.identity_status == "confirmed"
        ]
        if not confirmed:
            return None, None

        provisional_embeddings = [provisional.embedding]
        provisional_embeddings.extend(item.embedding for item in provisional.prototypes)
        scores = [
            max(self._identity_score(identity, embedding) for embedding in provisional_embeddings)
            for identity in confirmed
        ]
        order = np.argsort(np.asarray(scores, dtype=np.float32))[::-1]
        best_index = int(order[0])
        best_score = float(scores[best_index])
        second_score = float(scores[int(order[1])]) if len(order) > 1 else -1.0
        if (
            best_score >= self.strong_match_threshold
            and best_score - second_score >= self.top_match_margin
        ):
            return confirmed[best_index], best_score
        return None, best_score

    def _merge_identity(
        self, provisional: VisitorIdentity, canonical: VisitorIdentity, now: datetime
    ) -> None:
        for prototype in provisional.prototypes:
            self._update_prototype(
                canonical,
                prototype.embedding,
                now,
                sample_count=prototype.embedding_count,
            )
        canonical.expires_at = self.expires_at_for(now).isoformat()
        self._persist_identity(canonical, now)

        quality_embedding = self._quality_gallery.get(provisional.visitor_id)
        if quality_embedding is not None:
            self._update_quality_embedding(canonical.visitor_id, quality_embedding.embedding, now)

        provisional.identity_status = "merged"
        provisional.canonical_visitor_id = canonical.visitor_id
        self._session_store.resolve_visitor_identity(
            provisional.visitor_id,
            identity_status="merged",
            canonical_visitor_id=canonical.visitor_id,
            recorded_at=now.isoformat(),
        )
        self._gallery = [
            identity for identity in self._gallery if identity.visitor_id != provisional.visitor_id
        ]
        self._quality_gallery.pop(provisional.visitor_id, None)
        for track_id, visitor_id in list(self._track_visitors.items()):
            if visitor_id == provisional.visitor_id:
                self._track_visitors[track_id] = canonical.visitor_id

    def _update_quality_embedding(
        self, visitor_id: str, embedding: np.ndarray, now: datetime
    ) -> None:
        if self.quality_model_name is None:
            return

        existing = self._quality_gallery.get(visitor_id)
        if existing is None:
            updated_embedding = embedding
            updated_count = 1
        else:
            updated_count = existing.embedding_count + 1
            normalized_embedding = _normalize_embedding(
                (existing.embedding * existing.embedding_count + embedding) / updated_count
            )
            if normalized_embedding is None:
                return
            updated_embedding = normalized_embedding

        entry = VisitorModelEmbedding(
            visitor_id=visitor_id,
            embedding=updated_embedding,
            embedding_count=updated_count,
            model_name=self.quality_model_name,
        )
        self._quality_gallery[visitor_id] = entry
        self._session_store.upsert_visitor_model_embedding(
            visitor_id=visitor_id,
            model_name=self.quality_model_name,
            embedding=updated_embedding.astype(np.float32).tobytes(),
            embedding_dim=int(updated_embedding.size),
            embedding_count=updated_count,
            recorded_at=now.isoformat(),
        )

    def _persist_identity(self, identity: VisitorIdentity, now: datetime) -> None:
        self._session_store.upsert_visitor_identity(
            visitor_id=identity.visitor_id,
            business_date=identity.business_date,
            camera_id=identity.camera_id,
            embedding=identity.embedding.astype(np.float32).tobytes(),
            embedding_dim=int(identity.embedding.size),
            embedding_count=identity.embedding_count,
            model_name=identity.model_name,
            expires_at=identity.expires_at,
            identity_status=identity.identity_status,
            canonical_visitor_id=identity.canonical_visitor_id,
            recorded_at=now.isoformat(),
        )
        for prototype in identity.prototypes:
            self._persist_prototype(identity, prototype, now)

    def _persist_prototype(
        self, identity: VisitorIdentity, prototype: VisitorPrototype, now: datetime
    ) -> None:
        self._session_store.upsert_visitor_identity_prototype(
            visitor_id=identity.visitor_id,
            model_name=identity.model_name,
            prototype_index=prototype.prototype_index,
            embedding=prototype.embedding.astype(np.float32).tobytes(),
            embedding_dim=int(prototype.embedding.size),
            embedding_count=prototype.embedding_count,
            recorded_at=now.isoformat(),
        )

    def _persist_sighting(
        self,
        decision: VisitorDecision,
        track_id: int,
        camera_id: int | None,
        detection_confidence: float | None,
        bbox: tuple[int, int, int, int] | None,
        now: datetime,
    ) -> None:
        if decision.visitor_id is None:
            return

        self._session_store.append_visitor_sighting(
            {
                "visitor_id": decision.visitor_id,
                "business_date": decision.business_date,
                "camera_id": camera_id,
                "track_id": track_id,
                "direction": "entry",
                "reid_score": decision.reid_score,
                "reid_decision": decision.reid_decision,
                "identity_confidence": decision.identity_confidence,
                "detection_confidence": detection_confidence,
                "bbox": bbox,
            },
            now.isoformat(),
        )


def _normalize_embedding(embedding: np.ndarray) -> np.ndarray | None:
    normalized = np.asarray(embedding, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(normalized))
    if norm <= 1e-9:
        return None
    return (normalized / norm).astype(np.float32)
