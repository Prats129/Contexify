"""Bounded proposal generation. No execution, persistence, chat or retrieval port."""

import asyncio
import json
import math
import time
from collections.abc import Awaitable, Callable
from threading import BoundedSemaphore

from fastapi import HTTPException
from pydantic import ValidationError

from app.assistant.planning_provider import (
    CommunicationPlanningInput,
    PlanningInput,
    PlanningProvider,
    ProviderDataScopeError,
    ProviderIncompleteOutput,
    ProviderQuotaExceeded,
    ProviderUnavailable,
)
from app.schemas.assistant_communication import (
    COMMUNICATION_PROPOSAL_ADAPTER,
    CommunicationProposal,
)
from app.schemas.assistant_planning import (
    PROPOSAL_ADAPTER,
    PlanningActions,
    PlanningFeedback,
)


class InvalidProposal(Exception):
    def __init__(self, repairable: bool):
        self.repairable = repairable


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError("Duplicate JSON field.")
        result[key] = value
    return result


def parse_proposal(
    text: str, *, communications: bool = False
) -> PlanningActions | PlanningFeedback | CommunicationProposal:
    try:
        if not isinstance(text, str) or len(text.encode("utf-8")) > 8192:
            raise InvalidProposal(False)

        def no_constant(_value):
            raise ValueError("Nonfinite JSON.")

        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=no_constant)
    except (ValueError, RecursionError, UnicodeError):
        raise InvalidProposal(True) from None
    try:
        adapter = COMMUNICATION_PROPOSAL_ADAPTER if communications else PROPOSAL_ADAPTER
        return adapter.validate_python(value)
    except ValidationError as error:
        # Never repair an authority injection, invalid capability, policy value or DAG.
        fatal = {"extra_forbidden", "union_tag_invalid", "literal_error", "value_error"}
        details = error.errors(
            include_input=False, include_context=False, include_url=False
        )
        repairable = not any(
            item["type"] in fatal
            or any(part in ("percent", "depends_on", "action") for part in item["loc"])
            for item in details
        )
        raise InvalidProposal(repairable) from None


class PlanningEngine:
    def __init__(
        self,
        provider: PlanningProvider | None = None,
        *,
        timeout: float = 30,
        concurrency: int = 2,
    ):
        if (
            isinstance(timeout, bool)
            or not math.isfinite(timeout)
            or not 0 < timeout <= 30
            or type(concurrency) is not int
            or not 1 <= concurrency <= 20
        ):
            raise ValueError("Invalid planning bounds.")
        self.provider = provider
        self.timeout = timeout
        self._slots = BoundedSemaphore(concurrency)
        self._quota_until = 0.0

    async def generate(
        self,
        value: PlanningInput,
        *,
        authorize_attempt: Callable[[], Awaitable[None]],
        disconnected: Callable[[], Awaitable[bool]],
    ) -> PlanningActions | PlanningFeedback | CommunicationProposal:
        provider = self.provider
        if provider is None:
            raise HTTPException(503, "No live planning provider is enabled.")
        if time.monotonic() < self._quota_until:
            raise HTTPException(
                429, "Planning is paused after a provider quota error. Try later."
            )
        try:
            provider.validate_input(value)
        except ProviderDataScopeError:
            raise HTTPException(
                403, "Only reviewed synthetic evaluation commands are permitted."
            ) from None
        except ProviderUnavailable:
            raise HTTPException(503, "The planning provider is unavailable.") from None
        if not self._slots.acquire(blocking=False):
            raise HTTPException(429, "Planning capacity is busy. Try again later.")
        deadline = time.monotonic() + self.timeout

        async def produce():
            for attempt in range(2):
                await authorize_attempt()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise HTTPException(504, "Planning deadline exceeded.")
                try:
                    output = await provider.propose(
                        value, repair=bool(attempt), timeout=remaining
                    )
                    return parse_proposal(
                        output,
                        communications=isinstance(value, CommunicationPlanningInput),
                    )
                except InvalidProposal as error:
                    if not error.repairable or attempt:
                        raise HTTPException(
                            502, "The planner did not return a valid proposal."
                        ) from None
                except ProviderDataScopeError:
                    raise HTTPException(
                        403, "The command is outside the approved processing scope."
                    ) from None
                except ProviderQuotaExceeded:
                    self._quota_until = time.monotonic() + 60
                    raise HTTPException(
                        429, "Provider quota exhausted. No fallback was attempted."
                    ) from None
                except ProviderIncompleteOutput:
                    raise HTTPException(
                        502,
                        "The planner did not finish a complete proposal. No device action was performed.",
                    ) from None
                except ProviderUnavailable:
                    raise HTTPException(
                        503, "The planning provider is unavailable."
                    ) from None
                except (OSError, RuntimeError):
                    raise HTTPException(
                        503, "Planning failed. No device action was performed."
                    ) from None
            raise HTTPException(502, "The planner did not return a valid proposal.")

        async def watch_disconnect():
            while not await disconnected():
                await asyncio.sleep(0.05)

        task = asyncio.create_task(produce())
        monitor = asyncio.create_task(watch_disconnect())

        def release(completed):
            # An uncooperative provider retains its slot until it actually settles.
            self._slots.release()
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(release)
        try:
            done, _ = await asyncio.wait(
                {task, monitor},
                timeout=max(0, deadline - time.monotonic()),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if monitor in done:
                raise HTTPException(499, "Planning request was interrupted.")
            if task not in done:
                raise HTTPException(504, "Planning deadline exceeded.")
            return task.result()
        finally:
            monitor.cancel()
            if monitor.done() and not monitor.cancelled():
                monitor.exception()
            if not task.done():
                task.cancel()


# No API key lookup, SDK client, fake runtime planner or automatic live binding.
engine = PlanningEngine()


def get_planning_engine() -> PlanningEngine:
    return engine
