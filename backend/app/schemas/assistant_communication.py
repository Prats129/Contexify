"""Non-executing communication proposals. Real recipients never reach this API."""

from typing import Annotated, Literal

from pydantic import Field, TypeAdapter, field_validator, model_validator

from app.schemas.assistant import VersionOne
from app.schemas.assistant_planning import PlanningFeedback, PlanningResponseEnvelope
from app.schemas.assistant_security import SecurityModel


class CommunicationProposal(SecurityModel):
    protocol_version: VersionOne = 1
    mode: Literal["proposal"] = "proposal"
    status: Literal["communication_proposed"]
    capability_id: Literal["communication.compose"] = "communication.compose"
    request_kind: Literal["dial", "sms"]
    recipient: Literal["local_picker"] = "local_picker"
    # null means clarify the missing message on the phone, without another cloud call.
    message: str | None = Field(default=None, max_length=1000)

    @field_validator("message")
    @classmethod
    def visible_message(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            bounded = len(value.encode("utf-16-le")) <= 2000
        except UnicodeError:
            bounded = False
        if not bounded or any(
            ord(char) <= 9
            or 11 <= ord(char) <= 31
            or 127 <= ord(char) <= 159
            or 0x202A <= ord(char) <= 0x202E
            or 0x2066 <= ord(char) <= 0x2069
            for char in value
        ):
            raise ValueError("Invalid communication text.")
        return value

    @model_validator(mode="after")
    def matching_body(self):
        if self.request_kind == "dial" and self.message != "":
            raise ValueError("A dialer proposal has no message.")
        if (
            self.request_kind == "sms"
            and self.message is not None
            and not self.message.strip()
        ):
            raise ValueError("Missing SMS content must be clarified locally.")
        return self


CommunicationPlanningProposal = Annotated[
    CommunicationProposal | PlanningFeedback, Field(discriminator="status")
]
COMMUNICATION_PROPOSAL_ADAPTER: TypeAdapter[
    CommunicationProposal | PlanningFeedback
] = TypeAdapter(CommunicationPlanningProposal)


class CommunicationPlanningResponse(PlanningResponseEnvelope):
    proposal: CommunicationPlanningProposal
