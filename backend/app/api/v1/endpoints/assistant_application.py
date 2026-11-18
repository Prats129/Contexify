"""Reviewed Android launcher handoffs. Simulation credentials are never accepted."""

from fastapi import APIRouter, Depends

from app.assistant import application
from app.assistant.execution import require_enabled
from app.schemas.assistant import (
    ActionRevisionRequest,
    ClaimRequest,
    SimulationChallenge,
    SimulationPermit,
    SimulationProofRequest,
)
from app.schemas.assistant_application import (
    ApplicationClaim,
    ApplicationOperationRequest,
    ApplicationReceiptRequest,
    ApplicationResultRequest,
    ApplicationSessionResponse,
    ApplicationTaskView,
)
from app.schemas.assistant_operations import (
    OperationBinding,
    OperationIdentity,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(require_enabled)])
Authority = application.ApplicationAuthority


@router.post("/sessions", response_model=ApplicationSessionResponse)
def session(
    payload: EmptySecurityRequest,
    management: SecuritySession = Depends(require_security_session),
):
    return application.create_session(management)


@router.get("/tasks/{task_id}", response_model=ApplicationTaskView)
def read(task_id: str, authority: Authority = Depends(application.require_authority)):
    return application.read_task(authority, task_id)


@router.post("/tasks/{task_id}/cancel", response_model=ApplicationTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.cancel(authority, task_id)


@router.post(
    "/tasks/{task_id}/authorization-challenge", response_model=SimulationChallenge
)
def challenge(
    task_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.authorization_challenge(
        authority, task_id, payload.expected_revision
    )


@router.post("/tasks/{task_id}/authorize", response_model=SimulationPermit)
def authorize(
    task_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.authorize(authority, task_id, payload)


@router.post("/tasks/{task_id}/claim", response_model=ApplicationClaim)
def claim(
    task_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.claim(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt-challenge", response_model=SimulationChallenge)
def receipt_challenge(
    task_id: str,
    payload: ApplicationResultRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.receipt_challenge(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt", response_model=ApplicationTaskView)
def receipt(
    task_id: str,
    payload: ApplicationReceiptRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.receipt(authority, task_id, payload)


@router.post("/operations", response_model=ApplicationTaskView)
def create_operation(
    payload: ApplicationOperationRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.create_operation(authority, payload)


@router.post("/operations/status", response_model=ApplicationTaskView)
def operation_status(
    payload: OperationIdentity,
    authority: Authority = Depends(application.require_authority),
):
    return application.operation_status(authority, payload)


@router.post("/operations/identity", response_model=OperationBinding)
def operation_binding(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(application.require_authority),
):
    return application.operation_binding(authority)
