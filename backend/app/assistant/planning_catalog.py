"""Truthful planning metadata; simulation platform hints are not native support."""

from app.schemas.assistant import Platform
from app.schemas.assistant_planning import PlanningCapability, PlanningCapabilityId

NATIVE_SUPPORT: tuple[tuple[PlanningCapabilityId, tuple[Platform, ...]], ...] = (
    ("media_volume.set", ("android",)),
    ("brightness.set_app", ("android",)),
    ("application.open", ("android",)),
)


def planning_catalog(platform: Platform) -> list[PlanningCapability]:
    return [
        PlanningCapability(
            capability_id=capability,
            native_source_platforms=list(native_platforms),
            presentation="native_source_available"
            if platform in native_platforms
            else "preview_only",
        )
        for capability, native_platforms in NATIVE_SUPPORT
    ]
