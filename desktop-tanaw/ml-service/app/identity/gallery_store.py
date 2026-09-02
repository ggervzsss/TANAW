from datetime import datetime

import numpy as np

from app.identity.models import (
    VisitorDecision,
    VisitorIdentity,
    VisitorModelEmbedding,
    VisitorPrototype,
    normalize_embedding,
)
from app.storage.session_store import SessionStore


class VisitorGalleryStore:
    """Translates persisted visitor rows to and from the in-memory gallery model."""

    def __init__(
        self,
        session_store: SessionStore,
        model_name: str,
        quality_model_name: str | None,
    ) -> None:
        self._session_store = session_store
        self._model_name = model_name
        self._quality_model_name = quality_model_name

    def cleanup_expired(self, now: datetime) -> int:
        return self._session_store.cleanup_expired_visitor_metadata(now.isoformat())

    def restore_identity(self, visitor_id: str, now: datetime) -> bool:
        return self._session_store.restore_visitor_identity(visitor_id, recorded_at=now.isoformat())

    def resolve_identity(
        self,
        visitor_id: str,
        identity_status: str,
        canonical_visitor_id: str | None,
        now: datetime,
    ) -> None:
        self._session_store.resolve_visitor_identity(
            visitor_id,
            identity_status=identity_status,
            canonical_visitor_id=canonical_visitor_id,
            recorded_at=now.isoformat(),
        )

    def load_gallery(
        self, business_date: str, camera_id: int | None, now: datetime
    ) -> list[VisitorIdentity]:
        rows = self._session_store.load_active_visitor_identities(business_date, now.isoformat())
        prototypes_by_visitor: dict[str, list[VisitorPrototype]] = {}
        prototype_rows = self._session_store.load_active_visitor_identity_prototypes(
            business_date, self._model_name, now.isoformat()
        )
        for row in prototype_rows:
            embedding = _row_embedding(row)
            if embedding is None:
                continue
            prototypes_by_visitor.setdefault(row["visitor_id"], []).append(
                VisitorPrototype(
                    prototype_index=int(row["prototype_index"]),
                    embedding=embedding,
                    embedding_count=int(row["embedding_count"]),
                )
            )

        gallery: list[VisitorIdentity] = []
        for row in rows:
            if row.get("model_name") != self._model_name or not _camera_matches(row, camera_id):
                continue
            embedding = _row_embedding(row)
            if embedding is None:
                continue
            prototypes = prototypes_by_visitor.get(row["visitor_id"]) or [
                VisitorPrototype(0, embedding, int(row["embedding_count"]))
            ]
            gallery.append(
                VisitorIdentity(
                    visitor_id=row["visitor_id"],
                    business_date=row["business_date"],
                    camera_id=row.get("camera_id"),
                    embedding=embedding,
                    embedding_count=int(row["embedding_count"]),
                    model_name=row["model_name"],
                    expires_at=row["expires_at"],
                    identity_status=row.get("identity_status") or "confirmed",
                    canonical_visitor_id=row.get("canonical_visitor_id"),
                    prototypes=prototypes,
                )
            )
        return gallery

    def load_quality_gallery(
        self,
        business_date: str,
        camera_id: int | None,
        now: datetime,
        valid_visitor_ids: set[str],
    ) -> dict[str, VisitorModelEmbedding]:
        if self._quality_model_name is None:
            return {}
        rows = self._session_store.load_active_visitor_model_embeddings(
            business_date, self._quality_model_name, now.isoformat()
        )
        gallery: dict[str, VisitorModelEmbedding] = {}
        for row in rows:
            visitor_id = row["visitor_id"]
            if visitor_id not in valid_visitor_ids or not _camera_matches(row, camera_id):
                continue
            embedding = _row_embedding(row)
            if embedding is None:
                continue
            gallery[visitor_id] = VisitorModelEmbedding(
                visitor_id=visitor_id,
                embedding=embedding,
                embedding_count=int(row["embedding_count"]),
                model_name=row["model_name"],
            )
        return gallery

    def persist_identity(self, identity: VisitorIdentity, now: datetime) -> None:
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
            self.persist_prototype(identity, prototype, now)

    def persist_prototype(
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

    def persist_model_embedding(
        self, visitor_id: str, embedding: np.ndarray, embedding_count: int, now: datetime
    ) -> None:
        if self._quality_model_name is None:
            return
        self._session_store.upsert_visitor_model_embedding(
            visitor_id=visitor_id,
            model_name=self._quality_model_name,
            embedding=embedding.astype(np.float32).tobytes(),
            embedding_dim=int(embedding.size),
            embedding_count=embedding_count,
            recorded_at=now.isoformat(),
        )

    def persist_sighting(
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


def _row_embedding(row: dict[str, object]) -> np.ndarray | None:
    raw_embedding = row["representative_embedding"]
    if not isinstance(raw_embedding, bytes):
        return None
    embedding_dim = row["embedding_dim"]
    if isinstance(embedding_dim, bool) or not isinstance(embedding_dim, int):
        return None
    embedding = np.frombuffer(raw_embedding, dtype=np.float32)
    if embedding.size != embedding_dim:
        return None
    return normalize_embedding(embedding)


def _camera_matches(row: dict[str, object], camera_id: int | None) -> bool:
    row_camera_id = row.get("camera_id")
    return row_camera_id == camera_id
