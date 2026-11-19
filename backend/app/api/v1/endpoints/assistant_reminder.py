"""Owned reminder control and private storage. Simulation credentials are never accepted."""

from fastapi import APIRouter, Depends

from app.assistant import reminder
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
)
from app.schemas.assistant_reminder import (
    ReminderClaim,
    ReminderCopyPage,
    ReminderCopyPageRequest,
    ReminderCopyRequest,
    ReminderCopySaved,
    ReminderIdentityRequest,
    ReminderOperationRequest,
    ReminderReceiptRequest,
    ReminderResultRequest,
    ReminderSessionResponse,
    ReminderStorageView,
    ReminderTaskView,
    SavedReminder,
)
from app.schemas.assistant_security import EmptySecurityRequest
from app.services.assistant_security import SecuritySession, require_security_session

router = APIRouter(dependencies=[Depends(require_enabled)])
Authority = reminder.ReminderAuthority


@router.post("/sessions", response_model=ReminderSessionResponse)
def session(
    payload: EmptySecurityRequest,
    management: SecuritySession = Depends(require_security_session),
):
    return reminder.create_session(management)


@router.get("/tasks/{task_id}", response_model=ReminderTaskView)
def read(task_id: str, authority: Authority = Depends(reminder.require_authority)):
    return reminder.read_task(authority, task_id)


@router.post("/tasks/{task_id}/cancel", response_model=ReminderTaskView)
def cancel(
    task_id: str,
    payload: EmptySecurityRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.cancel(authority, task_id)


@router.post(
    "/tasks/{task_id}/authorization-challenge", response_model=SimulationChallenge
)
def challenge(
    task_id: str,
    payload: ActionRevisionRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.authorization_challenge(
        authority, task_id, payload.expected_revision
    )


@router.post("/tasks/{task_id}/authorize", response_model=SimulationPermit)
def authorize(
    task_id: str,
    payload: SimulationProofRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.authorize(authority, task_id, payload)


@router.post("/tasks/{task_id}/claim", response_model=ReminderClaim)
def claim(
    task_id: str,
    payload: ClaimRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.claim(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt-challenge", response_model=SimulationChallenge)
def receipt_challenge(
    task_id: str,
    payload: ReminderResultRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.receipt_challenge(authority, task_id, payload)


@router.post("/tasks/{task_id}/receipt", response_model=ReminderTaskView)
def receipt(
    task_id: str,
    payload: ReminderReceiptRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.receipt(authority, task_id, payload)


@router.post("/operations", response_model=ReminderTaskView)
def create_operation(
    payload: ReminderOperationRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.create_operation(authority, payload)


@router.post("/operations/status", response_model=ReminderTaskView)
def operation_status(
    payload: OperationIdentity,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.operation_status(authority, payload)


@router.post("/operations/identity", response_model=OperationBinding)
def operation_binding(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.operation_binding(authority)


@router.post("/storage", response_model=ReminderStorageView)
def storage(
    payload: EmptySecurityRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.storage(authority)


@router.post("/stored/save", response_model=ReminderCopySaved)
def save_copy(
    payload: ReminderCopyRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.save_copy(authority, payload)


@router.post("/stored/list", response_model=ReminderCopyPage)
def list_copies(
    payload: ReminderCopyPageRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.list_copies(authority, payload)


@router.post("/stored/read", response_model=SavedReminder)
def read_copy(
    payload: ReminderIdentityRequest,
    authority: Authority = Depends(reminder.require_authority),
):
    return reminder.read_copy(authority, payload)
