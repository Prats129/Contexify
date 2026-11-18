"""V2 operation identity; neither identity nor status is execution authority."""

from typing import Literal

from pydantic import Field

from app.schemas.assistant import BrightnessAction, VolumeAction
from app.schemas.assistant_planning import Identifier
from app.schemas.assistant_security import SecurityModel


class OperationIdentity(SecurityModel):
    protocol_version: Literal[2]
    plan_id: Identifier
    plan_revision: int = Field(ge=1, le=1000)
    step_id: int = Field(ge=0, le=4)

    def idempotency_key(self) -> str:
        return f"v2_{self.plan_id}_{self.plan_revision}_{self.step_id}"


class PercentOperationRequest(OperationIdentity):
    action: VolumeAction | BrightnessAction


class OperationBinding(SecurityModel):
    protocol_version: Literal[2] = 2
    origin: str
    user_id: str
    device_id: str
    installation_id: str
    public_key: str
