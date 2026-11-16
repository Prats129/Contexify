"""Separately scoped brightness execution using the shared percent protocol."""
from app.assistant.percent_control import ControlAuthority, PercentControl
from app.schemas.assistant import BrightnessAction
from app.schemas.assistant_brightness import BrightnessTaskView

POLICY_VERSION = 1
BrightnessAuthority = ControlAuthority
_service = PercentControl("brightness", BrightnessAction, BrightnessTaskView, lambda: POLICY_VERSION)
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
