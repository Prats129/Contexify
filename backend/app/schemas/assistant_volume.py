"""Android media-volume contracts, independent of simulation authority."""

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.assistant import (
    ActionRevisionRequest,
    SimulationProofRequest,
    VolumeAction,
)
from app.schemas.assistant_security import SecurityModel


class VolumeSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:volume"] = "assistant:volume"


class VolumeTaskRequest(SecurityModel):
    idempotency_key: str = Field(
        min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    action: VolumeAction


class VolumeEvidence(SecurityModel):
    outcome: Literal["verified", "failed", "outcome_unknown"]
    observed_index: int | None = Field(default=None, ge=0, le=10000)
    max_index: int | None = Field(default=None, ge=1, le=10000)

    @model_validator(mode="after")
    def validate_observation(self):
        if (self.observed_index is None) != (self.max_index is None):
            raise ValueError("Observation requires both stream indices.")
        if self.observed_index is not None and (
            self.max_index is None or self.observed_index > self.max_index
        ):
            raise ValueError("Invalid stream observation.")
        if self.outcome == "verified" and self.observed_index is None:
            raise ValueError("Verification requires a stream observation.")
        return self


class VolumeResultRequest(ActionRevisionRequest, VolumeEvidence):
    claim_id: str = Field(min_length=36, max_length=36)


class VolumeReceiptRequest(VolumeResultRequest, SimulationProofRequest):
    pass


class VolumeTaskView(SecurityModel):
    task_id: str
    mode: Literal["volume"] = "volume"
    action: VolumeAction
    revision: int
    state: Literal[
        "awaiting_confirmation",
        "authorized",
        "executing",
        "verified",
        "failed",
        "outcome_unknown",
        "cancelled",
        "expired",
    ]
    result: VolumeEvidence | None = None


class VolumeClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["android_media_volume"] = "android_media_volume"
    expires_at: float
