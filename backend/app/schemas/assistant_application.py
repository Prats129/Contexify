"""Reviewed Android launcher handoffs, separate from planner/simulation authority."""

from typing import Literal

from pydantic import Field, model_validator

from app.schemas.assistant import (
    ActionRevisionRequest,
    OpenApplicationAction,
    SimulationProofRequest,
)
from app.schemas.assistant_operations import OperationIdentity
from app.schemas.assistant_security import SecurityModel


class ApplicationAction(OpenApplicationAction):
    # Native resolves this from the compiled catalog; the model cannot select it.
    package_id: Literal[
        "com.spotify.music",
        "com.google.android.deskclock",
        "com.android.deskclock",
        "com.sec.android.app.clockpackage",
    ]

    @model_validator(mode="after")
    def validate_handler(self):
        if (self.application_id == "spotify") != (
            self.package_id == "com.spotify.music"
        ):
            raise ValueError("Package does not belong to the reviewed application.")
        return self


class ApplicationOperationRequest(OperationIdentity):
    action: ApplicationAction


class ApplicationSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:application"] = "assistant:application"


class ApplicationEvidence(SecurityModel):
    # startActivity returning is evidence of a request, never delivery or playback.
    outcome: Literal["handoff_requested", "failed", "outcome_unknown"]


class ApplicationResultRequest(ActionRevisionRequest, ApplicationEvidence):
    claim_id: str = Field(min_length=36, max_length=36)


class ApplicationReceiptRequest(ApplicationResultRequest, SimulationProofRequest):
    pass


class ApplicationTaskView(SecurityModel):
    task_id: str
    mode: Literal["application"] = "application"
    action: ApplicationAction
    revision: int
    state: Literal[
        "awaiting_confirmation",
        "authorized",
        "executing",
        "handoff_requested",
        "failed",
        "outcome_unknown",
        "cancelled",
        "expired",
    ]
    result: ApplicationEvidence | None = None


class ApplicationClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["android_application_handoff"] = "android_application_handoff"
    expires_at: float
