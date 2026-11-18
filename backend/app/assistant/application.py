"""Online, device-bound reviewed application handoffs."""

from fastapi import HTTPException

from app.assistant.percent_control import ControlAuthority, PercentControl
from app.schemas.assistant_application import ApplicationAction, ApplicationTaskView

POLICY_VERSION = 1
ApplicationAuthority = ControlAuthority


class ApplicationControl(PercentControl):
    def _result(self, row, result):
        if result.claim_id != row["claim_id"]:
            raise HTTPException(409, "Result belongs to another control claim.")
        return {"claim_id": result.claim_id, "outcome": result.outcome}


_service = ApplicationControl(
    "application", ApplicationAction, ApplicationTaskView, lambda: POLICY_VERSION
)
create_session = _service.create_session
require_authority = _service.require_authority
read_task = _service.read_task
cancel = _service.cancel
authorization_challenge = _service.authorization_challenge
authorize = _service.authorize
claim = _service.claim
receipt_challenge = _service.receipt_challenge
receipt = _service.receipt
create_operation = _service.create_operation
operation_status = _service.operation_status
operation_binding = _service.operation_binding
