"""Private, committed requests to reviewed Clock apps; never alarm-delivery evidence."""

from typing import Literal

from pydantic import Field

from app.schemas.assistant import (
    ActionRevisionRequest,
    SimulationProofRequest,
    VersionOne,
)
from app.schemas.assistant_application import ApplicationEvidence
from app.schemas.assistant_operations import OperationIdentity
from app.schemas.assistant_security import SecurityModel


class AlarmAction(SecurityModel):
    capability_id: Literal["alarm.handoff"] = "alarm.handoff"
    schema_version: VersionOne = 1
    request_kind: Literal["set_alarm", "show_alarms"]
    package_id: Literal[
        "com.google.android.deskclock",
        "com.android.deskclock",
        "com.sec.android.app.clockpackage",
    ]
    # Salted native commitment: no label, time or recurrence reaches the server.
    commitment: str = Field(pattern=r"^[a-f0-9]{64}$")


class AlarmOperationRequest(OperationIdentity):
    action: AlarmAction


class AlarmSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:alarm"] = "assistant:alarm"


class AlarmResultRequest(ActionRevisionRequest, ApplicationEvidence):
    claim_id: str = Field(min_length=36, max_length=36)


class AlarmReceiptRequest(AlarmResultRequest, SimulationProofRequest):
    pass


class AlarmTaskView(SecurityModel):
    task_id: str
    mode: Literal["alarm"] = "alarm"
    action: AlarmAction
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


class AlarmClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["android_alarm_handoff"] = "android_alarm_handoff"
    expires_at: float
