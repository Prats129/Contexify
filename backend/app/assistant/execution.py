"""Shared opt-in gate for real actions; capabilities still authorize each request."""

from fastapi import HTTPException, Request

from app.core.config import settings
from app.services import assistant_security as security


def require_enabled(request: Request) -> None:
    security.require_enabled(request)
    if not getattr(settings, "ASSISTANT_EXECUTION_ENABLED", False):
        raise HTTPException(404, "Not found.")
