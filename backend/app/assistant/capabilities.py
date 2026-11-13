"""Compiled allowlist and independent server policy; never a plugin loader."""

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException

from app.schemas.assistant import AssistantProposal, CapabilityDescriptor, Platform

POLICY_VERSION = 1


@dataclass(frozen=True)
class Capability:
    capability_id: Literal["media_volume.set", "brightness.set_app", "application.open"]
    platforms: tuple[Platform, ...]
    permissions: tuple[str, ...]
    timeout_seconds: int = 15

    def descriptor(self) -> CapabilityDescriptor:
        return CapabilityDescriptor(
            capability_id=self.capability_id,
            platforms=list(self.platforms),
            permissions=list(self.permissions),
            timeout_seconds=self.timeout_seconds,
        )


REGISTRY = (
    Capability("media_volume.set", ("android",), ("MODIFY_AUDIO_SETTINGS",)),
    Capability("brightness.set_app", ("android", "ios"), ()),
    Capability("application.open", ("web", "android", "ios"), ()),
)


def validate_proposal(proposal: AssistantProposal, platform: str) -> None:
    for step in proposal.steps:
        capability = next(
            item for item in REGISTRY if item.capability_id == step.action.capability_id
        )
        if platform not in capability.platforms:
            raise HTTPException(403, "Capability is unavailable on this platform.")
    # Schemas own exact ranges/enums. No model may override risk/confirmation.
