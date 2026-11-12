"""Strict security-bootstrap contracts. No command, audio or task payloads."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class SecurityModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EmptySecurityRequest(SecurityModel):
    pass


class EnrollmentRequest(SecurityModel):
    installation_id: str = Field(pattern=r"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$")
    public_key: str = Field(min_length=88, max_length=88)
    platform: Literal["android", "ios"]


class ChallengeResponse(SecurityModel):
    challenge_id: str
    payload: str
    expires_at: float


class ProofRequest(SecurityModel):
    challenge_id: str = Field(min_length=36, max_length=36)
    signature: str = Field(min_length=88, max_length=104)


class DeviceResponse(SecurityModel):
    device_id: str
    platform: Literal["android", "ios"]
    revoked: bool


class SecuritySessionResponse(SecurityModel):
    expires_at: float
    scope: Literal["security:manage"] = "security:manage"


class WebSessionResponse(SecuritySessionResponse):
    csrf_token: str


class DeviceSessionResponse(SecuritySessionResponse):
    access_token: str
    device_id: str


class SessionChallengeRequest(SecurityModel):
    device_id: str = Field(min_length=36, max_length=36)
