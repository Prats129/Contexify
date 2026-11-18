"""Separately scoped volume execution using the shared percent protocol."""

from app.assistant.percent_control import ControlAuthority, PercentControl
from app.schemas.assistant import VolumeAction
from app.schemas.assistant_volume import VolumeTaskView

POLICY_VERSION = 1
VolumeAuthority = ControlAuthority
_service = PercentControl(
    "volume", VolumeAction, VolumeTaskView, lambda: POLICY_VERSION
)
create_session = _service.create_session
require_authority = _service.require_authority
create_task = _service.create_task
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
