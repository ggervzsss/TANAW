from dataclasses import dataclass, field
from typing import Any

import numpy as np


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


def normalize_embedding(embedding: np.ndarray) -> np.ndarray | None:
    normalized = np.asarray(embedding, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(normalized))
    if norm <= 1e-9:
        return None
    return (normalized / norm).astype(np.float32)
