"""Shared page metadata for bounded keyset list APIs."""

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CursorPageInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(ge=1, le=100)
    returnedCount: int = Field(ge=0)
    hasMore: bool
    nextCursor: str | None = Field(min_length=1, max_length=1024)

    @model_validator(mode="after")
    def validate_consistent_page(self) -> Self:
        if self.returnedCount > self.limit:
            raise ValueError("returnedCount cannot exceed the requested page limit.")
        if self.hasMore != (self.nextCursor is not None):
            raise ValueError("hasMore and nextCursor must describe the same continuation state.")
        if self.returnedCount == 0 and self.hasMore:
            raise ValueError("An empty page cannot advertise another page.")
        return self
