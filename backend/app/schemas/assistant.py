"""Versioned simulation contracts. No private text, URLs, code or OS commands."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, model_validator

from app.schemas.assistant_security import SecurityModel

Platform = Literal["web", "android", "ios"]


def _version(value):
    if type(value) is not int or value != 1:
        raise ValueError("Unsupported integer protocol version.")
    return value


VersionOne = Annotated[Literal[1], BeforeValidator(_version)]
ActionState = Literal[
    "awaiting_confirmation",
    "authorized",
    "executing",
    "simulated",
    "failed",
    "outcome_unknown",
    "cancelled",
    "expired",
]


class VolumeAction(SecurityModel):
    capability_id: Literal["media_volume.set"]
    schema_version: VersionOne = 1
    percent: int = Field(ge=0, le=70)


class BrightnessAction(SecurityModel):
    capability_id: Literal["brightness.set_app"]
    schema_version: VersionOne = 1
    percent: int = Field(ge=10, le=100)


class OpenApplicationAction(SecurityModel):
    capability_id: Literal["application.open"]
    schema_version: VersionOne = 1
    application_id: Literal["spotify", "clock"]


ActionInput = Annotated[
    VolumeAction | BrightnessAction | OpenApplicationAction,
    Field(discriminator="capability_id"),
]


class ProposalStep(SecurityModel):
    action: ActionInput
    depends_on: list[int] = Field(default_factory=list, max_length=4)


class AssistantProposal(SecurityModel):
    protocol_version: VersionOne = 1
    mode: Literal["simulation"] = "simulation"
    steps: list[ProposalStep] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def validate_dependencies(self):
        for index, step in enumerate(self.steps):
            if len(step.depends_on) != len(set(step.depends_on)) or any(
                dependency < 0 or dependency >= index for dependency in step.depends_on
            ):
                raise ValueError("Dependencies must refer to distinct earlier steps.")
        return self


class CapabilityDescriptor(SecurityModel):
    capability_id: Literal["media_volume.set", "brightness.set_app", "application.open"]
    schema_version: Literal[1] = 1
    policy_version: Literal[1] = 1
    risk: Literal["R1"] = "R1"
    confirmation: Literal["exact_transaction"] = "exact_transaction"
    platforms: list[Platform]
    permissions: list[str]
    retry_policy: Literal["never_after_claim"] = "never_after_claim"
    timeout_seconds: int
    execution: Literal["simulation_only"] = "simulation_only"


class CreateTaskRequest(SecurityModel):
    idempotency_key: str = Field(
        min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    proposal: AssistantProposal


class SimulationSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:simulate"] = "assistant:simulate"


class SimulationActionView(SecurityModel):
    action_id: str
    action: ActionInput
    depends_on: list[int]
    revision: int
    state: ActionState


class SimulationTaskView(SecurityModel):
    task_id: str
    protocol_version: Literal[1] = 1
    mode: Literal["simulation"] = "simulation"
    policy_version: Literal[1] = 1
    state: ActionState
    actions: list[SimulationActionView]


class ActionRevisionRequest(SecurityModel):
    expected_revision: int = Field(ge=1, le=2147483647)


class SimulationProofRequest(ActionRevisionRequest):
    challenge_id: str = Field(min_length=36, max_length=36)
    signature: str = Field(min_length=88, max_length=104)


class SimulationChallenge(SecurityModel):
    challenge_id: str
    payload: str
    expires_at: float


class SimulationPermit(SecurityModel):
    permit: str
    claim_challenge: SimulationChallenge
    action_revision: int
    expires_at: float


class ClaimRequest(SimulationProofRequest):
    permit: str = Field(min_length=43, max_length=43)


class SimulationClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["simulation_only"] = "simulation_only"
    expires_at: float


class SimulationResultRequest(ActionRevisionRequest):
    claim_id: str = Field(min_length=36, max_length=36)
    outcome: Literal["simulated", "failed", "outcome_unknown"]


class SimulationReceiptRequest(SimulationResultRequest):
    challenge_id: str = Field(min_length=36, max_length=36)
    signature: str = Field(min_length=88, max_length=104)


class SimulationEvent(SecurityModel):
    event_id: int
    action_id: str | None
    state: ActionState
    created_at: float
