"""Owned reminders: salted commitments for control, private details only for opted-in storage."""

import unicodedata
from datetime import date, time
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.assistant import (
    ActionRevisionRequest,
    SimulationProofRequest,
    VersionOne,
)
from app.schemas.assistant_operations import OperationIdentity
from app.schemas.assistant_planning import Identifier
from app.schemas.assistant_security import SecurityModel


class ReminderAction(SecurityModel):
    capability_id: Literal[
        "reminder.create",
        "reminder.cancel",
        "reminder.storage",
        "reminder.delete_saved",
    ]
    schema_version: VersionOne = 1
    commitment: str = Field(pattern=r"^[a-f0-9]{64}$")
    reminder_id: Identifier | None = None
    storage_mode: Literal["device_only", "account"] | None = None
    settings_revision: int | None = Field(default=None, ge=0, le=1000000)

    @model_validator(mode="after")
    def scoped_arguments(self):
        if self.capability_id == "reminder.storage":
            if (
                self.reminder_id is not None
                or self.storage_mode is None
                or self.settings_revision is None
            ):
                raise ValueError("A storage decision requires one explicit mode.")
        elif (
            self.reminder_id is None
            or self.storage_mode is not None
            or self.settings_revision is not None
        ):
            raise ValueError("An owned reminder operation requires its identifier.")
        return self


class ReminderOperationRequest(OperationIdentity):
    action: ReminderAction


class ReminderSessionResponse(SecurityModel):
    access_token: str
    expires_at: float
    scope: Literal["assistant:reminder"] = "assistant:reminder"


class ReminderEvidence(SecurityModel):
    outcome: Literal[
        "schedule_requested",
        "reminder_cancelled",
        "storage_updated",
        "saved_copy_deleted",
        "failed",
        "outcome_unknown",
    ]


class ReminderResultRequest(ActionRevisionRequest, ReminderEvidence):
    claim_id: Identifier


class ReminderReceiptRequest(ReminderResultRequest, SimulationProofRequest):
    pass


class ReminderTaskView(SecurityModel):
    task_id: str
    mode: Literal["reminder"] = "reminder"
    action: ReminderAction
    revision: int
    state: Literal[
        "awaiting_confirmation",
        "authorized",
        "executing",
        "schedule_requested",
        "reminder_cancelled",
        "storage_updated",
        "saved_copy_deleted",
        "failed",
        "outcome_unknown",
        "cancelled",
        "expired",
    ]
    result: ReminderEvidence | None = None


class ReminderClaim(SecurityModel):
    claim_id: str
    action_revision: int
    execution: Literal["android_owned_reminder"] = "android_owned_reminder"
    expires_at: float


class ReminderStorageView(SecurityModel):
    revision: int
    mode: Literal["device_only", "account"]
    account_storage_available: bool
    consent_policy_version: VersionOne = 1


class ReminderDetails(SecurityModel):
    reminder_id: Identifier
    title: str = Field(min_length=1, max_length=120)
    date: str = Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    time: str = Field(pattern=r"^[0-9]{2}:[0-9]{2}$")
    zone: str = Field(min_length=1, max_length=64)
    repeat: Literal["none", "daily", "weekly"]
    until: str | None
    overlap: Literal["ask", "earlier", "later"]
    occurrences: list[int] = Field(min_length=1, max_length=91)

    @field_validator("title")
    @classmethod
    def bounded_title(cls, value: str) -> str:
        if (
            value != unicodedata.normalize("NFC", value.strip())
            or len(value.encode("utf-8")) > 512
            or any(
                ord(char) < 32
                or 127 <= ord(char) <= 159
                or 0x202A <= ord(char) <= 0x202E
                or 0x2066 <= ord(char) <= 0x2069
                for char in value
            )
        ):
            raise ValueError("Invalid reminder title.")
        return value

    @model_validator(mode="after")
    def explicit_schedule(self):
        start = date.fromisoformat(self.date)
        time.fromisoformat(self.time)
        if self.repeat == "none":
            if self.until is not None or len(self.occurrences) != 1:
                raise ValueError("A one-off reminder has one occurrence.")
        elif (
            self.until is None
            or not 0 <= (date.fromisoformat(self.until) - start).days <= 90
        ):
            raise ValueError("Recurring reminders require a bounded end date.")
        if any(
            value <= 0 or value > 4102444800000 for value in self.occurrences
        ) or self.occurrences != sorted(set(self.occurrences)):
            raise ValueError("Occurrence instants must be bounded and ordered.")
        return self


class ReminderCopyRequest(SecurityModel):
    task_id: Identifier
    salt: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    payload_json: str = Field(min_length=1, max_length=4096)

    @field_validator("payload_json")
    @classmethod
    def bounded_private_payload(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 4096:
            raise ValueError("Private reminder payload is too large.")
        # Validate without changing the exact bytes of the signed commitment.
        ReminderDetails.model_validate_json(value)
        return value


class ReminderCopyPageRequest(SecurityModel):
    after: Identifier | None = None


class ReminderIdentityRequest(SecurityModel):
    reminder_id: Identifier


class SavedReminder(SecurityModel):
    details: ReminderDetails
    source_device_id: str
    created_at: float


class ReminderCopyPage(SecurityModel):
    items: list[SavedReminder] = Field(max_length=6)
    next_after: Identifier | None


class ReminderCopySaved(SecurityModel):
    reminder_id: Identifier
    stored: Literal[True] = True
