"""Run complete synchronous operations outside the async request loop."""

import asyncio
from functools import partial
from threading import Lock
from typing import Callable, ParamSpec, TypeVar

from anyio import CancelScope, to_thread

P = ParamSpec("P")
T = TypeVar("T")


async def run_blocking(
    operation: Callable[P, T], *args: P.args, **kwargs: P.kwargs
) -> T:
    """Bound workers and finish started work before the caller releases resources.

    Open and close connections/transactions inside the operation. Python cannot
    stop a running thread safely, so underlying network calls still need timeouts.
    """
    invoke = partial(operation, *args, **kwargs)
    lock = Lock()
    started = False
    cancelled = False

    def execute() -> T:
        nonlocal started
        with lock:
            if cancelled:
                raise asyncio.CancelledError()
            started = True
        return invoke()

    # AnyIO supplies the shared worker capacity limit and propagates contextvars.
    task = asyncio.create_task(to_thread.run_sync(execute))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with lock:
            cancelled = True
            if not started:
                task.cancel()
        # Also handle direct Task.cancel(), which an AnyIO scope alone cannot
        # shield. Never delete a worker's input or release its lease prematurely.
        with CancelScope(shield=True):
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    continue
                except Exception:  # noqa: BLE001 - preserve cancellation after draining the worker
                    # Cancellation wins; retrieve the worker error below.
                    break
            if not task.cancelled():
                task.exception()
        raise
