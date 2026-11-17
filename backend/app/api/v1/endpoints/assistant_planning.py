"""Authenticated, non-executing planning. No live provider is wired in M1."""

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.assistant import planning
from app.assistant.planning_catalog import planning_catalog
from app.assistant.planning_engine import PlanningEngine, get_planning_engine
from app.assistant.planning_provider import PlanningInput
from app.schemas.assistant_planning import (
    Identifier,
    PlanningCapability,
    PlanningGrant,
    PlanningGrantRequest,
    PlanningRequest,
    PlanningResponse,
)
from app.schemas.assistant_security import EmptySecurityRequest

router = APIRouter(dependencies=[Depends(planning.require_enabled)])


@router.post("/grants", response_model=PlanningGrant)
def grant(payload: PlanningGrantRequest, request: Request):
    return planning.create_grant(request)


@router.post("/grants/{grant_id}/revoke", response_model=EmptySecurityRequest)
def revoke(grant_id: Identifier, payload: EmptySecurityRequest, request: Request):
    planning.revoke_grant(request, grant_id)
    return {}


@router.get("/grants/{grant_id}/capabilities", response_model=list[PlanningCapability])
def capabilities(grant_id: Identifier, request: Request):
    authority = planning.authorize(request, grant_id)
    return planning_catalog(authority.platform)


@router.post("/proposals", response_model=PlanningResponse)
async def propose(
    payload: PlanningRequest,
    request: Request,
    engine: PlanningEngine = Depends(get_planning_engine),
):
    authority = await run_in_threadpool(planning.authorize, request, payload.grant_id)
    if payload.source != "user":
        raise HTTPException(403, "Untrusted content cannot initiate planning.")

    async def admit():
        await run_in_threadpool(planning.admit_attempt, request, authority)

    proposal = await engine.generate(
        PlanningInput(payload.text, payload.synthetic_case_id, authority.platform),
        authorize_attempt=admit,
        disconnected=request.is_disconnected,
    )
    # Logout, expiry, revocation, host/policy changes or a disabled gate invalidate late results.
    if (
        await run_in_threadpool(planning.authorize, request, payload.grant_id)
        != authority
    ):
        raise HTTPException(409, "Planning context changed. Discard this proposal.")
    return PlanningResponse(
        plan_id=str(uuid.uuid4()),
        owner_user_id=authority.user_id,
        owner_device_id=authority.device_id,
        expires_at=min(authority.expires_at, time.time() + 180),
        proposal=proposal,
    )
