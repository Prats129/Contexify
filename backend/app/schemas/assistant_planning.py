"""Planning proposals and consent grants. None is an execution credential."""

from typing import Annotated, Literal

from pydantic import (
    BeforeValidator,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)

from app.schemas.assistant import (
    Platform,
    ProposalStep,
    VersionOne,
    validate_step_dependencies,
)
from app.schemas.assistant_security import SecurityModel

Identifier = Annotated[
    str,
    Field(
        pattern=r"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
    ),
]
PlanningCapabilityId = Literal[
    "media_volume.set", "brightness.set_app", "application.open"
]


def _explicit_consent(value):
    if value is not True:
        raise ValueError("Explicit planning consent is required.")
    return value


class PlanningGrantRequest(SecurityModel):
    consent: Annotated[Literal[True], BeforeValidator(_explicit_consent)]
    consent_policy_version: VersionOne
    data_scope: Literal["synthetic_evaluation"]


class PlanningGrant(SecurityModel):
    grant_id: Identifier
    scope: Literal["assistant:plan"] = "assistant:plan"
    consent_policy_version: VersionOne = 1
    data_scope: Literal["synthetic_evaluation"] = "synthetic_evaluation"
    expires_at: float


class PlanningRequest(SecurityModel):
    grant_id: Identifier
    source: Literal["user", "untrusted"]
    text: str = Field(min_length=1, max_length=1024)
    synthetic_case_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )

    @field_validator("text")
    @classmethod
    def bounded_text(cls, text: str) -> str:
        try:
            valid = (
                bool(text.strip())
                and len(text.encode("utf-16-le")) <= 2048
                and len(text.encode("utf-8")) <= 3072
            )
        except UnicodeError:
            valid = False
        if not valid:
            raise ValueError("Planning input exceeds its text limits.")
        return text


class PlanningActions(SecurityModel):
    protocol_version: VersionOne = 1
    mode: Literal["proposal"]
    status: Literal["proposed"]
    steps: list[ProposalStep] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def valid_dependencies(self):
        validate_step_dependencies(self.steps)
        return self


class PlanningFeedback(SecurityModel):
    protocol_version: VersionOne = 1
    mode: Literal["proposal"]
    status: Literal["needs_clarification", "unsupported", "refused", "non_action"]
    reason: Literal[
        "missing_target",
        "missing_value",
        "relative_value",
        "ambiguous_request",
        "unsupported_request",
        "policy_limit",
        "not_a_command",
        "model_refusal",
    ]


PlanningProposal = Annotated[
    PlanningActions | PlanningFeedback, Field(discriminator="status")
]
PROPOSAL_ADAPTER: TypeAdapter[PlanningActions | PlanningFeedback] = TypeAdapter(
    PlanningProposal
)


class PlanningResponseEnvelope(SecurityModel):
    plan_id: Identifier
    revision: VersionOne = 1
    owner_user_id: str
    owner_device_id: str | None
    expires_at: float
    execution: Literal["not_authorized"] = "not_authorized"


class PlanningResponse(PlanningResponseEnvelope):
    proposal: PlanningProposal


class PlanningCapability(SecurityModel):
    capability_id: PlanningCapabilityId
    schema_version: VersionOne = 1
    policy_version: VersionOne = 1
    native_source_platforms: list[Platform]
    native_availability: Literal["unverified"] = "unverified"
    presentation: Literal["native_source_available", "preview_only"]
    confirmation: Literal["exact_transaction"] = "exact_transaction"
    execution: Literal["not_authorized"] = "not_authorized"
