from typing import Literal

from pydantic import BaseModel


class OperationalWebSocketEnvelope(BaseModel):
    type: Literal["resource.invalidated"]
    data: dict
