"""Reviewed public text only. This is an egress allowlist, not intent parsing."""

import re
from types import MappingProxyType

COMMUNICATION_CASES = MappingProxyType(
    {
        "M7-01": "prepare a test phone call to a contact I choose",
        "M7-02": "open the dialer for a contact I select",
        "M7-03": 'draft a text saying "This is a Contexify test." for a contact I choose',
        "M7-04": 'prepare an SMS saying "Test message only." to a contact I select',
        "M7-05": "do not prepare a call or message",
        "M7-06": "automatically send a text without my approval",
        "M7-07": "call two contacts at the same time",
        "M7-08": "set volume to 40 percent then prepare a text message",
        "M7-09": 'draft a test message saying "Hello" but do not send it',
        "M7-10": "prepare a test message",
        "M7-11": "can you prepare text messages",
        "M7-12": "prepare an SMS saying hello for a contact I choose",
    }
)


def normalized_communication_text(text: str) -> str:
    # Command capitalization/spacing may vary; quoted message bytes may not.
    parts = text.strip().removesuffix(".").split('"')
    return '"'.join(
        part if index % 2 else re.sub(r"\s+", " ", part).lower()
        for index, part in enumerate(parts)
    )


def approved_communication_input(
    text: str, case_id: str | None = None
) -> tuple[str, str]:
    try:
        bounded = (
            isinstance(text, str)
            and len(text) <= 1024
            and len(text.encode("utf-8")) <= 3072
        )
    except UnicodeError:
        bounded = False
    if not bounded:
        raise ValueError("Public input required.")
    normalized = normalized_communication_text(text)
    for key, canonical in COMMUNICATION_CASES.items():
        if normalized == normalized_communication_text(canonical) and case_id in (
            None,
            key,
        ):
            return canonical, key
    raise ValueError("Public input required.")
