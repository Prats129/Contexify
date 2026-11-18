"""Separate, opt-in Android brightness scope. Simulation credentials are never accepted."""

from fastapi import APIRouter, Depends

from app.assistant import brightness
from app.assistant.execution import require_enabled
from app.schemas.assistant import (
    ActionRevisionRequest,
    ClaimRequest,
    SimulationChallenge,
    SimulationPermit,
    SimulationProofRequest,
)
from app.schemas.assistant_brightness import (
    BrightnessClaim,
    BrightnessReceiptRequest,
    BrightnessResultRequest,
    BrightnessSessionResponse,
    BrightnessTaskRequest,
    BrightnessTaskView,
)
from app.schemas.assistant_operations import (
    OperationBinding,
    OperationIdentity,
    PercentOperationRequest,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(require_enabled)])
Authority = brightness.BrightnessAuthority


@router.post("/sessions", response_model=BrightnessSessionResponse)
def session(
    payload: EmptySecurityRequest,
    management: SecuritySession = Depends(require_security_session),
):
    return brightness.create_session(management)


@router.post("/tasks", response_model=BrightnessTaskView)
def create(
    payload: BrightnessTaskRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.create_task(authority, payload)


@router.get("/tasks/{task_id}", response_model=BrightnessTaskView)
def read(task_id: str, authority: Authority = Depends(brightness.require_authority)):
    return brightness.read_task(authority, task_id)


@router.post("/tasks/{task_id}/cancel", response_model=BrightnessTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.cancel(authority, task_id)


@router.post(
    "/tasks/{task_id}/authorization-challenge", response_model=SimulationChallenge
)
def challenge(
    task_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.authorization_challenge(
        authority, task_id, payload.expected_revision
    )


@router.post("/tasks/{task_id}/authorize", response_model=SimulationPermit)
def authorize(
    task_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.authorize(authority, task_id, payload)


@router.post("/tasks/{task_id}/claim", response_model=BrightnessClaim)
def claim(
    task_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.claim(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt-challenge", response_model=SimulationChallenge)
def receipt_challenge(
    task_id: str,
    payload: BrightnessResultRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.receipt_challenge(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt", response_model=BrightnessTaskView)
def receipt(
    task_id: str,
    payload: BrightnessReceiptRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.receipt(authority, task_id, payload)


@router.post("/operations", response_model=BrightnessTaskView)
def create_operation(
    payload: PercentOperationRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.create_operation(authority, payload)


@router.post("/operations/status", response_model=BrightnessTaskView)
def operation_status(
    payload: OperationIdentity,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.operation_status(authority, payload)


@router.post("/operations/identity", response_model=OperationBinding)
def operation_binding(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(brightness.require_authority),
):
    return brightness.operation_binding(authority)
