import json
from typing import Any
from uuid import uuid4

from app.storage.local_data_serialization import (
    _load_json_object,
    _safe_float,
    _utc_now,
)
from app.storage.local_database import LocalDatabase


class VisitorIdentityRepository:
    """Persists visitor identities, embeddings, prototypes, and sightings."""

    def __init__(self, database: LocalDatabase) -> None:
        self._database = database

    def upsert_identity(
        self,
        *,
        visitor_id: str,
        business_date: str,
        camera_id: int | None,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        model_name: str,
        expires_at: str,
        identity_status: str = "confirmed",
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            connection.execute(
                """
                insert into visitor_identities (
                    visitor_id,
                    business_date,
                    camera_id,
                    first_seen_at,
                    last_seen_at,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at,
                    identity_status,
                    canonical_visitor_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(visitor_id) do update set
                    last_seen_at = excluded.last_seen_at,
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    model_name = excluded.model_name,
                    expires_at = excluded.expires_at,
                    identity_status = excluded.identity_status,
                    canonical_visitor_id = excluded.canonical_visitor_id
                """,
                (
                    visitor_id,
                    business_date,
                    camera_id,
                    recorded_at,
                    recorded_at,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at,
                    identity_status,
                    canonical_visitor_id,
                ),
            )

    def upsert_prototype(
        self,
        *,
        visitor_id: str,
        model_name: str,
        prototype_index: int,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            connection.execute(
                """
                insert into visitor_identity_prototypes (
                    visitor_id,
                    model_name,
                    prototype_index,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(visitor_id, model_name, prototype_index) do update set
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    updated_at = excluded.updated_at
                """,
                (
                    visitor_id,
                    model_name,
                    prototype_index,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    recorded_at,
                ),
            )

    def resolve(
        self,
        visitor_id: str,
        *,
        identity_status: str,
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        if identity_status not in {"confirmed", "provisional", "merged"}:
            raise ValueError(f"Unsupported visitor identity status: {identity_status}")
        if identity_status == "merged" and not canonical_visitor_id:
            raise ValueError("Merged visitor identities require a canonical visitor ID.")

        with self._database.connection() as connection:
            connection.execute(
                """
                update visitor_identities
                set identity_status = ?,
                    canonical_visitor_id = ?,
                    last_seen_at = ?
                where visitor_id = ?
                """,
                (
                    identity_status,
                    canonical_visitor_id,
                    recorded_at or _utc_now(),
                    visitor_id,
                ),
            )

    def restore(self, visitor_id: str, *, recorded_at: str | None = None) -> bool:
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            restored = connection.execute(
                """
                update visitor_identities
                set identity_status = 'confirmed',
                    canonical_visitor_id = null,
                    last_seen_at = ?
                where visitor_id = ?
                    and identity_status = 'merged'
                """,
                (recorded_at, visitor_id),
            ).rowcount
            if not restored:
                return False

            event = connection.execute(
                """
                select id, payload_json
                from count_events
                where visitor_id = ?
                    and direction = 'entry'
                    and submitted_report_id is null
                order by recorded_at asc
                limit 1
                """,
                (visitor_id,),
            ).fetchone()
            if event is not None:
                payload = _load_json_object(event["payload_json"])
                payload.update(
                    {
                        "identity_confidence": "high",
                        "is_unique_entry": True,
                        "reid_decision": "merge_rolled_back",
                    }
                )
                connection.execute(
                    """
                    update count_events
                    set is_unique_entry = 1,
                        reid_decision = 'merge_rolled_back',
                        identity_confidence = 'high',
                        payload_json = ?,
                        synced_at = null
                    where id = ?
                    """,
                    (json.dumps(payload, sort_keys=True), event["id"]),
                )

            sighting = connection.execute(
                """
                select sighting_id
                from visitor_sightings
                where visitor_id = ?
                    and direction = 'entry'
                order by recorded_at asc
                limit 1
                """,
                (visitor_id,),
            ).fetchone()
            if sighting is not None:
                connection.execute(
                    """
                    update visitor_sightings
                    set reid_decision = 'merge_rolled_back',
                        identity_confidence = 'high'
                    where sighting_id = ?
                    """,
                    (sighting["sighting_id"],),
                )
        return True

    def append_sighting(self, payload: dict[str, Any], recorded_at: str | None = None) -> str:
        sighting_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            connection.execute(
                """
                insert into visitor_sightings (
                    sighting_id,
                    visitor_id,
                    recorded_at,
                    business_date,
                    camera_id,
                    track_id,
                    direction,
                    reid_score,
                    reid_decision,
                    identity_confidence,
                    detection_confidence,
                    bbox_json,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sighting_id,
                    payload["visitor_id"],
                    recorded_at,
                    payload["business_date"],
                    payload.get("camera_id"),
                    payload.get("track_id"),
                    payload.get("direction"),
                    _safe_float(payload.get("reid_score")),
                    payload["reid_decision"],
                    payload["identity_confidence"],
                    _safe_float(payload.get("detection_confidence")),
                    json.dumps(payload.get("bbox"), sort_keys=True)
                    if payload.get("bbox") is not None
                    else None,
                    json.dumps(payload, sort_keys=True),
                ),
            )
        return sighting_id

    def upsert_model_embedding(
        self,
        *,
        visitor_id: str,
        model_name: str,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            connection.execute(
                """
                insert into visitor_model_embeddings (
                    visitor_id,
                    model_name,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?)
                on conflict(visitor_id, model_name) do update set
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    updated_at = excluded.updated_at
                """,
                (
                    visitor_id,
                    model_name,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    recorded_at,
                ),
            )

    def load_active_identities(
        self, business_date: str, now: str | None = None
    ) -> list[dict[str, Any]]:
        now = now or _utc_now()
        with self._database.connection() as connection:
            rows = connection.execute(
                """
                select
                    visitor_id,
                    business_date,
                    camera_id,
                    first_seen_at,
                    last_seen_at,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at,
                    identity_status,
                    canonical_visitor_id
                from visitor_identities
                where business_date = ?
                    and expires_at > ?
                    and identity_status != 'merged'
                order by last_seen_at desc
                """,
                (business_date, now),
            ).fetchall()
        return [dict(row) for row in rows]

    def load_active_prototypes(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        now = now or _utc_now()
        with self._database.connection() as connection:
            rows = connection.execute(
                """
                select
                    prototypes.visitor_id,
                    identities.business_date,
                    identities.camera_id,
                    prototypes.model_name,
                    prototypes.prototype_index,
                    prototypes.representative_embedding,
                    prototypes.embedding_dim,
                    prototypes.embedding_count,
                    identities.expires_at
                from visitor_identity_prototypes as prototypes
                join visitor_identities as identities
                    on identities.visitor_id = prototypes.visitor_id
                where identities.business_date = ?
                    and identities.expires_at > ?
                    and identities.identity_status != 'merged'
                    and prototypes.model_name = ?
                order by prototypes.visitor_id, prototypes.prototype_index
                """,
                (business_date, now, model_name),
            ).fetchall()
        return [dict(row) for row in rows]

    def load_active_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        now = now or _utc_now()
        with self._database.connection() as connection:
            rows = connection.execute(
                """
                select
                    embeddings.visitor_id,
                    identities.business_date,
                    identities.camera_id,
                    embeddings.representative_embedding,
                    embeddings.embedding_dim,
                    embeddings.embedding_count,
                    embeddings.model_name,
                    identities.expires_at
                from visitor_model_embeddings as embeddings
                join visitor_identities as identities
                    on identities.visitor_id = embeddings.visitor_id
                where identities.business_date = ?
                    and identities.expires_at > ?
                    and identities.identity_status != 'merged'
                    and embeddings.model_name = ?
                order by embeddings.updated_at desc
                """,
                (business_date, now, model_name),
            ).fetchall()
        return [dict(row) for row in rows]

    def cleanup_expired(self, now: str | None = None) -> int:
        now = now or _utc_now()
        with self._database.connection() as connection:
            visitor_ids = [
                row["visitor_id"]
                for row in connection.execute(
                    """
                    select visitor_id
                    from visitor_identities
                    where expires_at <= ?
                    """,
                    (now,),
                ).fetchall()
            ]
            if not visitor_ids:
                return 0

            placeholders = ",".join("?" for _ in visitor_ids)
            connection.execute(
                f"delete from visitor_sightings where visitor_id in ({placeholders})",
                visitor_ids,
            )
            connection.execute(
                f"delete from visitor_identities where visitor_id in ({placeholders})",
                visitor_ids,
            )
        return len(visitor_ids)
