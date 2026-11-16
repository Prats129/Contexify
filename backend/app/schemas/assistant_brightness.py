"""Android app-window brightness contracts, independent of simulation authority."""

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.assistant import (
    ActionRevisionRequest,
    BrightnessAction,
    SimulationProofRequest,
)
from app.schemas.assistant_security import SecurityModel


class BrightnessSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:brightness"] = "assistant:brightness"


class BrightnessTaskRequest(SecurityModel):
    idempotency_key: str = Field(
        min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    action: BrightnessAction


class BrightnessEvidence(SecurityModel):
    outcome: Literal["verified", "failed", "outcome_unknown"]
    observed_index: int | None = Field(default=None, ge=0, le=10000)
    max_index: int | None = Field(default=None, ge=10000, le=10000)

    @model_validator(mode="after")
    def validate_observation(self):
        if (self.observed_index is None) != (self.max_index is None):
            raise ValueError("Observation requires both window indices.")
        if self.observed_index is not None and (
            self.max_index is None or self.observed_index > self.max_index
        ):
            raise ValueError("Invalid window observation.")
        if self.outcome == "verified" and self.observed_index is None:
            raise ValueError("Verification requires a window observation.")
        return self


class BrightnessResultRequest(ActionRevisionRequest, BrightnessEvidence):
    claim_id: str = Field(min_length=36, max_length=36)


class BrightnessReceiptRequest(BrightnessResultRequest, SimulationProofRequest):
    pass


class BrightnessTaskView(SecurityModel):
    task_id: str
    mode: Literal["brightness"] = "brightness"
    action: BrightnessAction
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
    result: BrightnessEvidence | None = None


class BrightnessClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["android_app_brightness"] = "android_app_brightness"
    expires_at: float
