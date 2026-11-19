"""Reviewed Android Clock handoffs. Simulation credentials are never accepted."""

from fastapi import APIRouter, Depends

from app.assistant import alarm
from app.assistant.execution import require_enabled
from app.schemas.assistant import (
    ActionRevisionRequest,
    ClaimRequest,
    SimulationChallenge,
    SimulationPermit,
    SimulationProofRequest,
)
from app.schemas.assistant_alarm import (
    AlarmClaim,
    AlarmOperationRequest,
    AlarmReceiptRequest,
    AlarmResultRequest,
    AlarmSessionResponse,
    AlarmTaskView,
)
from app.schemas.assistant_operations import (
    OperationBinding,
    OperationIdentity,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(require_enabled)])
Authority = alarm.AlarmAuthority


@router.post("/sessions", response_model=AlarmSessionResponse)
def session(
    payload: EmptySecurityRequest,
    management: SecuritySession = Depends(require_security_session),
):
    return alarm.create_session(management)


@router.get("/tasks/{task_id}", response_model=AlarmTaskView)
def read(task_id: str, authority: Authority = Depends(alarm.require_authority)):
    return alarm.read_task(authority, task_id)


@router.post("/tasks/{task_id}/cancel", response_model=AlarmTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.cancel(authority, task_id)


@router.post(
    "/tasks/{task_id}/authorization-challenge", response_model=SimulationChallenge
)
def challenge(
    task_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.authorization_challenge(authority, task_id, payload.expected_revision)


@router.post("/tasks/{task_id}/authorize", response_model=SimulationPermit)
def authorize(
    task_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.authorize(authority, task_id, payload)


@router.post("/tasks/{task_id}/claim", response_model=AlarmClaim)
def claim(
    task_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.claim(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt-challenge", response_model=SimulationChallenge)
def receipt_challenge(
    task_id: str,
    payload: AlarmResultRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.receipt_challenge(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt", response_model=AlarmTaskView)
def receipt(
    task_id: str,
    payload: AlarmReceiptRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.receipt(authority, task_id, payload)


@router.post("/operations", response_model=AlarmTaskView)
def create_operation(
    payload: AlarmOperationRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.create_operation(authority, payload)


@router.post("/operations/status", response_model=AlarmTaskView)
def operation_status(
    payload: OperationIdentity,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.operation_status(authority, payload)


@router.post("/operations/identity", response_model=OperationBinding)
def operation_binding(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(alarm.require_authority),
):
    return alarm.operation_binding(authority)
