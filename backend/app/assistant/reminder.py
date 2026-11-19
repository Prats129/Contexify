"""Device-bound reminder control and separately opted-in encrypted account storage."""

import base64
import binascii
import time

from fastapi import HTTPException

from app.assistant.percent_control import ControlAuthority, PercentControl
from app.assistant.private_data import PrivateDataKeys, PrivateStorageUnavailable
from app.core.config import settings
from app.core.security import digest
from app.schemas.assistant_reminder import (
    ReminderAction,
    ReminderDetails,
    ReminderTaskView,
)

POLICY_VERSION = 1
ReminderAuthority = ControlAuthority


def _keys() -> PrivateDataKeys:
    secret = getattr(settings, "ASSISTANT_PRIVATE_DATA_KEYRING", None)
    return PrivateDataKeys.parse(
        secret.get_secret_value() if secret is not None else None
    )


def _binding(user: str, device: str, reminder: str) -> str:
    return f"reminder-copy-v1\n{user}\n{device}\n{reminder}"


class ReminderControl(PercentControl):
    @staticmethod
    def _preference(conn, authority):
        row = conn.execute(
            "SELECT mode,revision FROM assistant_reminder_preferences WHERE user_id=? AND device_id=?",
            (authority.user_id, authority.device_id),
        ).fetchone()
        return dict(row) if row else {"mode": "device_only", "revision": 0}

    def _check_new_request(self, conn, authority, action):
        if action.capability_id == "reminder.storage":
            if (
                self._preference(conn, authority)["revision"]
                != action.settings_revision
            ):
                raise HTTPException(
                    409, "Reminder settings changed. Review the current setting."
                )
            if action.storage_mode == "account":
                try:
                    _keys()
                except PrivateStorageUnavailable:
                    raise HTTPException(
                        503,
                        "Encrypted account storage is not configured. Device-only reminders remain available.",
                    ) from None
        if (
            action.capability_id == "reminder.delete_saved"
            and not conn.execute(
                "SELECT 1 FROM assistant_reminder_copies WHERE id=? AND user_id=?",
                (action.reminder_id, authority.user_id),
            ).fetchone()
        ):
            raise HTTPException(404, "Saved reminder not found.")

    def _result(self, row, result):
        allowed = {
            "reminder.create": "schedule_requested",
            "reminder.cancel": "reminder_cancelled",
            "reminder.storage": "storage_updated",
            "reminder.delete_saved": "saved_copy_deleted",
        }
        if result.claim_id != row["claim_id"] or result.outcome not in {
            allowed[row["capability_id"]],
            "failed",
            "outcome_unknown",
        }:
            raise HTTPException(409, "Receipt does not match the reminder operation.")
        return {"claim_id": result.claim_id, "outcome": result.outcome}

    def _after_receipt(self, conn, authority, row, result):
        if result.outcome == "storage_updated":
            conn.execute(
                "INSERT INTO assistant_reminder_preferences(user_id,device_id,mode,revision,updated_at) VALUES(?,?,'device_only',0,?) ON CONFLICT(user_id,device_id) DO NOTHING",
                (authority.user_id, authority.device_id, time.time()),
            )
            changed = conn.execute(
                "UPDATE assistant_reminder_preferences SET mode=?,revision=revision+1,updated_at=? WHERE user_id=? AND device_id=? AND revision=?",
                (
                    row["storage_mode"],
                    time.time(),
                    authority.user_id,
                    authority.device_id,
                    row["settings_revision"],
                ),
            )
            if changed.rowcount != 1:
                raise HTTPException(
                    409, "Reminder settings changed. No setting was overwritten."
                )
            if row["storage_mode"] == "device_only":
                conn.execute(
                    "DELETE FROM assistant_reminder_copies WHERE user_id=? AND device_id=?",
                    (authority.user_id, authority.device_id),
                )
        elif result.outcome == "reminder_cancelled":
            conn.execute(
                "DELETE FROM assistant_reminder_copies WHERE id=? AND user_id=? AND device_id=?",
                (row["reminder_id"], authority.user_id, authority.device_id),
            )
        elif result.outcome == "saved_copy_deleted":
            conn.execute(
                "DELETE FROM assistant_reminder_copies WHERE id=? AND user_id=?",
                (row["reminder_id"], authority.user_id),
            )

    def storage(self, authority):
        with self._transaction(authority) as conn:
            preference = self._preference(conn, authority)
        try:
            _keys()
            available = True
        except PrivateStorageUnavailable:
            available = False
        return {
            **preference,
            "account_storage_available": available,
            "consent_policy_version": 1,
        }

    def save_copy(self, authority, payload):
        details = ReminderDetails.model_validate_json(payload.payload_json)
        expected = digest("reminder-v1\n" + payload.salt + "\n" + payload.payload_json)
        with self._transaction(authority) as conn:
            if self._preference(conn, authority)["mode"] != "account":
                raise HTTPException(
                    403, "Account storage requires explicit device consent."
                )
            task = conn.execute(
                "SELECT * FROM assistant_reminder_tasks WHERE id=? AND user_id=? AND device_id=? AND state='schedule_requested' AND capability_id='reminder.create'",
                (payload.task_id, authority.user_id, authority.device_id),
            ).fetchone()
            if (
                not task
                or task["commitment"] != expected
                or task["reminder_id"] != details.reminder_id
            ):
                raise HTTPException(
                    409, "Private copy does not match a confirmed schedule."
                )
            if conn.execute(
                "SELECT 1 FROM assistant_reminder_tasks WHERE user_id=? AND device_id=? AND reminder_id=? AND capability_id='reminder.cancel' AND state='reminder_cancelled'",
                (authority.user_id, authority.device_id, details.reminder_id),
            ).fetchone():
                raise HTTPException(
                    409, "Cancelled reminders cannot be uploaded again."
                )
            now = time.time()
            if not now < details.occurrences[-1] / 1000 <= now + 90 * 86400:
                raise HTTPException(
                    409, "Reminder schedule expired or exceeds its lease."
                )
            existing = conn.execute(
                "SELECT user_id,device_id,commitment FROM assistant_reminder_copies WHERE id=?",
                (details.reminder_id,),
            ).fetchone()
            if existing:
                if (
                    existing["user_id"],
                    existing["device_id"],
                    existing["commitment"],
                ) != (authority.user_id, authority.device_id, expected):
                    raise HTTPException(409, "Saved reminder identity changed.")
                return {"reminder_id": details.reminder_id, "stored": True}
            conn.execute(
                "DELETE FROM assistant_reminder_copies WHERE id IN (SELECT id FROM assistant_reminder_copies WHERE expires_at<=? LIMIT 100)",
                (now,),
            )
            count = conn.execute(
                "SELECT COUNT(*) AS count FROM assistant_reminder_copies WHERE user_id=?",
                (authority.user_id,),
            ).fetchone()["count"]
            if count >= 512:
                raise HTTPException(
                    429, "Saved reminder limit reached. Delete older copies first."
                )
            try:
                key_id, ciphertext = _keys().seal(
                    payload.payload_json,
                    _binding(
                        authority.user_id, authority.device_id, details.reminder_id
                    ),
                )
            except PrivateStorageUnavailable:
                raise HTTPException(
                    503, "Encrypted account storage is unavailable."
                ) from None
            conn.execute(
                "INSERT INTO assistant_reminder_copies(id,user_id,device_id,commitment,key_id,ciphertext,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
                (
                    details.reminder_id,
                    authority.user_id,
                    authority.device_id,
                    expected,
                    key_id,
                    base64.b64encode(ciphertext).decode(),
                    now,
                    min(now + 90 * 86400, details.occurrences[-1] / 1000 + 7 * 86400),
                ),
            )
        return {"reminder_id": details.reminder_id, "stored": True}

    def list_copies(self, authority, payload):
        with self._transaction(authority) as conn:
            rows = conn.execute(
                "SELECT * FROM assistant_reminder_copies WHERE user_id=? AND id>? AND expires_at>? ORDER BY id LIMIT 7",
                (authority.user_id, payload.after or "", time.time()),
            ).fetchall()
            items = [self._copy_view(authority, row) for row in rows[:6]]
            return {
                "items": items,
                "next_after": rows[5]["id"] if len(rows) == 7 else None,
            }

    @staticmethod
    def _copy_view(authority, row):
        try:
            encoded = base64.b64decode(row["ciphertext"], validate=True)
            plain = _keys().open(
                row["key_id"],
                encoded,
                _binding(authority.user_id, row["device_id"], row["id"]),
            )
            details = ReminderDetails.model_validate_json(plain)
            if details.reminder_id != row["id"]:
                raise PrivateStorageUnavailable()
            return {
                "details": details,
                "source_device_id": row["device_id"],
                "created_at": row["created_at"],
            }
        except (PrivateStorageUnavailable, ValueError, binascii.Error):
            raise HTTPException(
                503,
                "Encrypted reminder recovery is unavailable. No schedule was created or retried.",
            ) from None

    def read_copy(self, authority, payload):
        with self._transaction(authority) as conn:
            row = conn.execute(
                "SELECT * FROM assistant_reminder_copies WHERE user_id=? AND id=? AND expires_at>?",
                (authority.user_id, payload.reminder_id, time.time()),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Saved reminder not found.")
            return self._copy_view(authority, row)


_service = ReminderControl(
    "reminder", ReminderAction, ReminderTaskView, lambda: POLICY_VERSION
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
storage = _service.storage
save_copy = _service.save_copy
list_copies = _service.list_copies
read_copy = _service.read_copy
