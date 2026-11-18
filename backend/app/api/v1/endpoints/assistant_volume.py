"""Separate, opt-in Android volume scope. Simulation credentials are never accepted."""

from fastapi import APIRouter, Depends

from app.assistant import volume
from app.assistant.execution import require_enabled
from app.schemas.assistant import (
    ActionRevisionRequest,
    ClaimRequest,
    SimulationChallenge,
    SimulationPermit,
    SimulationProofRequest,
)
from app.schemas.assistant_operations import (
    OperationBinding,
    OperationIdentity,
    PercentOperationRequest,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.schemas.assistant_volume import (
    VolumeClaim,
    VolumeReceiptRequest,
    VolumeResultRequest,
    VolumeSessionResponse,
    VolumeTaskRequest,
    VolumeTaskView,
)
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(require_enabled)])
Authority = volume.VolumeAuthority


@router.post("/sessions", response_model=VolumeSessionResponse)
def session(
    payload: EmptySecurityRequest,
    management: SecuritySession = Depends(require_security_session),
):
    return volume.create_session(management)


@router.post("/tasks", response_model=VolumeTaskView)
def create(
    payload: VolumeTaskRequest, authority: Authority = Depends(volume.require_authority)
):
    return volume.create_task(authority, payload)


@router.get("/tasks/{task_id}", response_model=VolumeTaskView)
def read(task_id: str, authority: Authority = Depends(volume.require_authority)):
    return volume.read_task(authority, task_id)


@router.post("/tasks/{task_id}/cancel", response_model=VolumeTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.cancel(authority, task_id)


@router.post(
    "/tasks/{task_id}/authorization-challenge", response_model=SimulationChallenge
)
def challenge(
    task_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.authorization_challenge(authority, task_id, payload.expected_revision)


@router.post("/tasks/{task_id}/authorize", response_model=SimulationPermit)
def authorize(
    task_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.authorize(authority, task_id, payload)


@router.post("/tasks/{task_id}/claim", response_model=VolumeClaim)
def claim(
    task_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.claim(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt-challenge", response_model=SimulationChallenge)
def receipt_challenge(
    task_id: str,
    payload: VolumeResultRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.receipt_challenge(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt", response_model=VolumeTaskView)
def receipt(
    task_id: str,
    payload: VolumeReceiptRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.receipt(authority, task_id, payload)


@router.post("/operations", response_model=VolumeTaskView)
def create_operation(
    payload: PercentOperationRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.create_operation(authority, payload)


@router.post("/operations/status", response_model=VolumeTaskView)
def operation_status(
    payload: OperationIdentity, authority: Authority = Depends(volume.require_authority)
):
    return volume.operation_status(authority, payload)


@router.post("/operations/identity", response_model=OperationBinding)
def operation_binding(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(volume.require_authority),
):
    return volume.operation_binding(authority)
