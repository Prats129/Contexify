"""Simulation-only protocol; no endpoint invokes a real device operation."""

from fastapi import APIRouter, Depends

from app.assistant import service
from app.assistant.capabilities import REGISTRY
from app.schemas.assistant import (
    ActionRevisionRequest,
    CapabilityDescriptor,
    ClaimRequest,
    CreateTaskRequest,
    SimulationChallenge,
    SimulationClaim,
    SimulationEvent,
    SimulationPermit,
    SimulationProofRequest,
    SimulationReceiptRequest,
    SimulationResultRequest,
    SimulationSessionResponse,
    SimulationTaskView,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(service.require_simulation)])
Authority = service.SimulationAuthority


@router.get("/capabilities", response_model=list[CapabilityDescriptor])
def capabilities(session: SecuritySession = Depends(require_security_session)):
    return [item.descriptor() for item in REGISTRY]


@router.post("/simulation/sessions", response_model=SimulationSessionResponse)
def simulation_session(
    payload: EmptySecurityRequest,
    session: SecuritySession = Depends(require_security_session),
):
    return service.create_session(session)


@router.post("/simulation/tasks", response_model=SimulationTaskView)
def create_task(
    payload: CreateTaskRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.create_task(authority, payload)


@router.get("/simulation/tasks/{task_id}", response_model=SimulationTaskView)
def get_task(
    task_id: str, authority: Authority = Depends(service.require_simulation_authority)
):
    return service.get_task(authority, task_id)


@router.post("/simulation/tasks/{task_id}/cancel", response_model=SimulationTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.cancel_task(authority, task_id)


@router.get("/simulation/tasks/{task_id}/events", response_model=list[SimulationEvent])
def task_events(
    task_id: str, authority: Authority = Depends(service.require_simulation_authority)
):
    return service.events(authority, task_id)


@router.post(
    "/simulation/tasks/{task_id}/actions/{action_id}/authorization-challenge",
    response_model=SimulationChallenge,
)
def authorization_challenge(
    task_id: str,
    action_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.authorization_challenge(
        authority, task_id, action_id, payload.expected_revision
    )


@router.post(
    "/simulation/tasks/{task_id}/actions/{action_id}/authorize",
    response_model=SimulationPermit,
)
def authorize(
    task_id: str,
    action_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.authorize(authority, task_id, action_id, payload)


@router.post(
    "/simulation/tasks/{task_id}/actions/{action_id}/claim",
    response_model=SimulationClaim,
)
def claim(
    task_id: str,
    action_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.claim(authority, task_id, action_id, payload)


@router.post(
    "/simulation/tasks/{task_id}/actions/{action_id}/receipt-challenge",
    response_model=SimulationChallenge,
)
def receipt_challenge(
    task_id: str,
    action_id: str,
    payload: SimulationResultRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.receipt_challenge(authority, task_id, action_id, payload)


@router.post(
    "/simulation/tasks/{task_id}/actions/{action_id}/receipt",
    response_model=SimulationTaskView,
)
def receipt(
    task_id: str,
    action_id: str,
    payload: SimulationReceiptRequest,
    authority: Authority = Depends(service.require_simulation_authority),
):
    return service.record_receipt(authority, task_id, action_id, payload)
