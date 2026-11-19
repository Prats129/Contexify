"""Shared control authorization protocol; SQL identifiers come only from compiled modes."""

import base64
import binascii
import json
import secrets
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from types import SimpleNamespace

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Request
from pydantic import BaseModel

from app.assistant.execution import require_enabled
from app.assistant.service import _management, canonical
from app.core.config import settings
from app.core.rate_limits import Budget, consume_budgets
from app.core.security import Principal, digest
from app.db.database import get_db_connection
from app.schemas.assistant_application import ApplicationOperationRequest
from app.schemas.assistant_operations import OperationIdentity, PercentOperationRequest
from app.schemas.assistant_reminder import ReminderOperationRequest
from app.services import assistant_security as security

TERMINAL = frozenset(
    {
        "verified",
        "failed",
        "outcome_unknown",
        "cancelled",
        "expired",
        "handoff_requested",
        "schedule_requested",
        "reminder_cancelled",
        "storage_updated",
        "saved_copy_deleted",
    }
)


@dataclass(frozen=True)
class ControlAuthority:
    token_hash: str
    user_id: str
    device_id: str
    installation_id: str
    public_key: str


class PercentControl:
    def __init__(
        self,
        mode: str,
        action_model: type[BaseModel],
        view_model: type[BaseModel],
        policy_version: Callable[[], int],
    ):
        if mode not in ("volume", "brightness", "application", "reminder"):
            raise ValueError("Unsupported compiled control.")
        self.mode = mode
        self.scope = "assistant:" + mode
        self.capability = {
            "volume": "media_volume.set",
            "brightness": "brightness.set_app",
            "application": "application.open",
            "reminder": "reminder",
        }[mode]
        self.execution = {
            "volume": "android_media_volume",
            "brightness": "android_app_brightness",
            "application": "android_application_handoff",
            "reminder": "android_owned_reminder",
        }[mode]
        self.action_model, self.view_model = (action_model, view_model)
        self.policy_version = policy_version
        self.allowed_capabilities = frozenset(
            {
                "reminder.create",
                "reminder.cancel",
                "reminder.storage",
                "reminder.delete_saved",
            }
            if mode == "reminder"
            else {self.capability}
        )
        self.argument_columns = (
            (
                "capability_id",
                "commitment",
                "reminder_id",
                "storage_mode",
                "settings_revision",
            )
            if mode == "reminder"
            else ("application_id", "package_id")
            if mode == "application"
            else ("percent",)
        )

    def create_session(self, session):
        consume_budgets(
            [Budget(f"assistant-{self.mode}-session", session.user_id, 10, 60)]
        )
        with get_db_connection(write=True) as conn:
            parent = _management(conn, session)
            if parent["platform"] != "android":
                raise HTTPException(
                    403, "Device control requires an enrolled Android device."
                )
            now = time.time()
            conn.execute(
                f"DELETE FROM assistant_{self.mode}_sessions WHERE token_hash IN (SELECT token_hash FROM assistant_{self.mode}_sessions WHERE expires_at<=? LIMIT 100)",
                (now,),
            )
            count = conn.execute(
                f"SELECT COUNT(*) AS count FROM assistant_{self.mode}_sessions WHERE user_id=? AND expires_at>?",
                (session.user_id, now),
            ).fetchone()["count"]
            if count >= 8:
                raise HTTPException(429, "Too many control sessions.")
            token, expiry = (
                secrets.token_urlsafe(32),
                min(parent["expires_at"], now + 300),
            )
            conn.execute(
                f"INSERT INTO assistant_{self.mode}_sessions(token_hash,parent_security_hash,user_id,device_id,expires_at) VALUES(?,?,?,?,?)",
                (
                    digest(token),
                    session.token_hash,
                    session.user_id,
                    parent["device_id"],
                    expiry,
                ),
            )
        return {"access_token": token, "expires_at": expiry, "scope": self.scope}

    def _authority(self, conn, token_hash):
        row = conn.execute(
            f"SELECT c.*,p.parent_token_hash,p.expires_at AS management_expiry,p.api_origin,p.kind,d.installation_id,d.public_key,d.platform,d.revoked_at,d.origin AS device_origin FROM assistant_{self.mode}_sessions c JOIN assistant_security_sessions p ON p.token_hash=c.parent_security_hash AND p.user_id=c.user_id AND p.device_id=c.device_id JOIN assistant_devices d ON d.id=c.device_id AND d.user_id=c.user_id WHERE c.token_hash=?",
            (token_hash,),
        ).fetchone()
        now = time.time()
        if (
            not row
            or row["kind"] != "device"
            or row["platform"] != "android"
            or (row["expires_at"] <= now)
            or (row["management_expiry"] <= now)
            or (row["revoked_at"] is not None)
            or (row["api_origin"] != settings.ASSISTANT_API_ORIGIN)
            or (row["device_origin"] != settings.ASSISTANT_API_ORIGIN)
        ):
            raise HTTPException(401, "Control authority expired or revoked.")
        security._parent(conn, Principal(row["user_id"], row["parent_token_hash"]))
        return ControlAuthority(
            token_hash,
            row["user_id"],
            row["device_id"],
            row["installation_id"],
            row["public_key"],
        )

    def require_authority(self, request: Request) -> ControlAuthority:
        require_enabled(request)
        authorization = request.headers.get("authorization", "")
        if (
            request.cookies.get(security.COOKIE_NAME)
            or not authorization.startswith("Bearer ")
            or len(authorization[7:]) != 43
        ):
            raise HTTPException(401, "A control-scoped bearer is required.")
        with get_db_connection() as conn:
            return self._authority(conn, digest(authorization[7:]))

    @contextmanager
    def _transaction(self, authority):
        consume_budgets([Budget(f"assistant-{self.mode}", authority.user_id, 90, 60)])
        with get_db_connection(write=True) as conn:
            if self._authority(conn, authority.token_hash) != authority:
                raise HTTPException(401, "Control identity changed.")
            yield conn

    def _task(self, conn, authority, task_id, revision=None, state=None):
        row = conn.execute(
            f"SELECT * FROM assistant_{self.mode}_tasks WHERE id=? AND user_id=? AND device_id=? AND session_hash=?",
            (task_id, authority.user_id, authority.device_id, authority.token_hash),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Control task not found.")
        if row["policy_version"] != self.policy_version():
            raise HTTPException(
                409, "Control policy changed. Create a new confirmed request."
            )
        self._arguments(row)
        now = time.time()
        expiry = (
            row["claim_expires_at"]
            if row["state"] == "executing"
            else row["expires_at"]
        )
        if row["state"] == "authorized":
            expiry = min(expiry, row["permit_expires_at"])
        if row["state"] not in TERMINAL and expiry <= now:
            new_state = "outcome_unknown" if row["state"] == "executing" else "expired"
            conn.execute(
                f"UPDATE assistant_{self.mode}_tasks SET state=?,revision=revision+1 WHERE id=? AND revision=?",
                (new_state, task_id, row["revision"]),
            )
            row = {**dict(row), "state": new_state, "revision": row["revision"] + 1}
        if (
            revision is not None
            and revision != row["revision"]
            or (state is not None and state != row["state"])
        ):
            raise HTTPException(
                409, "Control task state changed. Do not replay the action."
            )
        return row

    def _arguments(self, row):
        try:
            return self.action_model.model_validate(
                {
                    "capability_id": self.capability,
                    **{key: row[key] for key in self.argument_columns},
                }
            ).model_dump()
        except ValueError:
            raise HTTPException(
                409, "Control arguments no longer satisfy policy."
            ) from None

    def _view(self, row):
        return self.view_model.model_validate(
            {
                "task_id": row["id"],
                "revision": row["revision"],
                "state": row["state"],
                "action": self._arguments(row),
                "result": json.loads(row["result_json"])
                if row["result_json"]
                else None,
            }
        )

    def _check_new_request(self, conn, authority, action):
        pass

    def _after_receipt(self, conn, authority, row, result):
        pass

    def create_task(self, authority, payload):
        with self._transaction(authority) as conn:
            existing = conn.execute(
                f"SELECT * FROM assistant_{self.mode}_tasks WHERE user_id=? AND device_id=? AND idempotency_key=?",
                (authority.user_id, authority.device_id, payload.idempotency_key),
            ).fetchone()
            if existing:
                if (
                    self._arguments(existing) != payload.action.model_dump()
                    or existing["session_hash"] != authority.token_hash
                ):
                    raise HTTPException(
                        409, "Idempotency key belongs to another control request."
                    )
                return self._view(self._task(conn, authority, existing["id"]))
            self._check_new_request(conn, authority, payload.action)
            now = time.time()
            count = conn.execute(
                f"SELECT COUNT(*) AS count FROM assistant_{self.mode}_tasks WHERE user_id=? AND created_at>?",
                (authority.user_id, now - 86400),
            ).fetchone()["count"]
            if count >= 100:
                raise HTTPException(429, "Daily control request limit reached.")
            conn.execute(
                f"DELETE FROM assistant_{self.mode}_tasks WHERE id IN (SELECT id FROM assistant_{self.mode}_tasks WHERE created_at<? LIMIT 100)",
                (now - 7 * 86400,),
            )
            task_id = str(uuid.uuid4())
            columns = ",".join(self.argument_columns)
            placeholders = ",".join("?" for _ in self.argument_columns)
            conn.execute(
                f"INSERT INTO assistant_{self.mode}_tasks(id,session_hash,user_id,device_id,idempotency_key,{columns},policy_version,state,revision,created_at,expires_at) VALUES(?,?,?,?,?,{placeholders},?,'awaiting_confirmation',1,?,?)",
                (
                    task_id,
                    authority.token_hash,
                    authority.user_id,
                    authority.device_id,
                    payload.idempotency_key,
                    *(getattr(payload.action, key) for key in self.argument_columns),
                    self.policy_version(),
                    now,
                    now + 180,
                ),
            )
            return self._view(self._task(conn, authority, task_id))

    def read_task(self, authority, task_id):
        with self._transaction(authority) as conn:
            return self._view(self._task(conn, authority, task_id))

    def create_operation(
        self,
        authority,
        payload: PercentOperationRequest
        | ApplicationOperationRequest
        | ReminderOperationRequest,
    ):
        if payload.action.capability_id not in self.allowed_capabilities:
            raise HTTPException(422, "Operation capability does not match its scope.")
        # Reuse v1's immutable action, session isolation, atomic claim and receipts.
        # The trusted coordinator supplies a stable key instead of a fresh UUID.
        return self.create_task(
            authority,
            SimpleNamespace(
                idempotency_key=payload.idempotency_key(), action=payload.action
            ),
        )

    def operation_status(self, authority, identity: OperationIdentity):
        # A fresh device-scoped session may READ a previous v2 operation after
        # sign-in/restart. This cannot resume/authorize it or rebind its v1 session.
        consume_budgets([Budget(f"assistant-{self.mode}", authority.user_id, 90, 60)])
        with get_db_connection() as conn:
            if self._authority(conn, authority.token_hash) != authority:
                raise HTTPException(401, "Control identity changed.")
            row = conn.execute(
                f"SELECT * FROM assistant_{self.mode}_tasks WHERE user_id=? AND device_id=? AND idempotency_key=?",
                (authority.user_id, authority.device_id, identity.idempotency_key()),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Operation evidence is unavailable.")
            # No lazy UPDATE, permit, challenge or action dispatch on reconciliation.
            view = dict(row)
            if view["state"] == "executing":
                view["state"] = "outcome_unknown"
            elif view["state"] not in TERMINAL and view["expires_at"] <= time.time():
                view["state"] = "expired"
            return self._view(view)

    def operation_binding(self, authority):
        # Read-only identity check before native recovery decrypts local records.
        consume_budgets([Budget(f"assistant-{self.mode}", authority.user_id, 90, 60)])
        with get_db_connection() as conn:
            if self._authority(conn, authority.token_hash) != authority:
                raise HTTPException(401, "Control identity changed.")
            return {
                "protocol_version": 2,
                "origin": settings.ASSISTANT_API_ORIGIN,
                "user_id": authority.user_id,
                "device_id": authority.device_id,
                "installation_id": authority.installation_id,
                "public_key": authority.public_key,
            }

    def _challenge(self, conn, authority, row, purpose, extra=None):
        challenge_id, expiry = (
            str(uuid.uuid4()),
            min(time.time() + 60, row["expires_at"]),
        )
        arguments = canonical(self._arguments(row))
        fields = {
            "protocol_version": 1,
            "mode": self.mode,
            "policy_version": self.policy_version(),
            "purpose": purpose,
            "origin": settings.ASSISTANT_API_ORIGIN,
            "user_id": authority.user_id,
            "device_id": authority.device_id,
            "installation_id": authority.installation_id,
            "public_key": authority.public_key,
            "session_hash": authority.token_hash,
            "task_id": row["id"],
            "action_revision": row["revision"],
            "arguments_json": arguments,
            "arguments_digest": digest(arguments),
            "nonce": secrets.token_urlsafe(32),
            "challenge_id": challenge_id,
            "expires_at": expiry,
        }
        fields.update(extra or {})
        payload = canonical(fields)
        conn.execute(
            f"UPDATE assistant_{self.mode}_tasks SET challenge_id=?,challenge_purpose=?,challenge_payload=?,challenge_expires_at=? WHERE id=?",
            (challenge_id, purpose, payload, expiry, row["id"]),
        )
        return {"challenge_id": challenge_id, "payload": payload, "expires_at": expiry}

    def _proof(self, conn, authority, row, proof, purpose):
        if (
            row["challenge_id"] != proof.challenge_id
            or row["challenge_purpose"] != purpose
            or row["challenge_expires_at"] <= time.time()
        ):
            raise HTTPException(401, "Expired, replayed or mismatched control proof.")
        fields = json.loads(row["challenge_payload"])
        if (
            fields["action_revision"] != row["revision"]
            or fields["origin"] != settings.ASSISTANT_API_ORIGIN
            or fields["policy_version"] != self.policy_version()
            or (fields["arguments_digest"] != digest(canonical(self._arguments(row))))
        ):
            raise HTTPException(409, "Control confirmation changed.")
        try:
            security._public_key(authority.public_key).verify(
                base64.b64decode(proof.signature, validate=True),
                row["challenge_payload"].encode(),
                ec.ECDSA(hashes.SHA256()),
            )
        except (InvalidSignature, ValueError, binascii.Error):
            raise HTTPException(401, "Invalid control signature.") from None
        conn.execute(
            f"UPDATE assistant_{self.mode}_tasks SET challenge_id=NULL,challenge_purpose=NULL,challenge_payload=NULL,challenge_expires_at=NULL WHERE id=?",
            (row["id"],),
        )
        return fields

    def authorization_challenge(self, authority, task_id, revision):
        with self._transaction(authority) as conn:
            return self._challenge(
                conn,
                authority,
                self._task(conn, authority, task_id, revision, "awaiting_confirmation"),
                f"assistant_{self.mode}_authorize",
            )

    def authorize(self, authority, task_id, proof):
        with self._transaction(authority) as conn:
            row = self._task(
                conn,
                authority,
                task_id,
                proof.expected_revision,
                "awaiting_confirmation",
            )
            self._proof(conn, authority, row, proof, f"assistant_{self.mode}_authorize")
            permit, expiry = (secrets.token_urlsafe(32), time.time() + 60)
            conn.execute(
                f"UPDATE assistant_{self.mode}_tasks SET state='authorized',revision=2,permit_hash=?,permit_expires_at=? WHERE id=?",
                (digest(permit), expiry, task_id),
            )
            row = self._task(conn, authority, task_id)
            return {
                "permit": permit,
                "expires_at": expiry,
                "action_revision": 2,
                "claim_challenge": self._challenge(
                    conn,
                    authority,
                    row,
                    f"assistant_{self.mode}_claim",
                    {"permit_hash": digest(permit)},
                ),
            }

    def claim(self, authority, task_id, proof):
        with self._transaction(authority) as conn:
            row = self._task(
                conn, authority, task_id, proof.expected_revision, "authorized"
            )
            fields = self._proof(
                conn, authority, row, proof, f"assistant_{self.mode}_claim"
            )
            if fields["permit_hash"] != digest(proof.permit) or row[
                "permit_hash"
            ] != digest(proof.permit):
                raise HTTPException(401, "Permit does not match this control request.")
            claim_id, expiry = (str(uuid.uuid4()), time.time() + 15)
            changed = conn.execute(
                f"UPDATE assistant_{self.mode}_tasks SET state='executing',revision=3,permit_hash=NULL,claim_id=?,claim_expires_at=? WHERE id=? AND state='authorized' AND revision=2 AND permit_expires_at>?",
                (claim_id, expiry, task_id, time.time()),
            )
            if changed.rowcount != 1:
                raise HTTPException(409, "Control permit expired or was already used.")
            return {
                "claim_id": claim_id,
                "action_revision": 3,
                "execution": self.execution,
                "expires_at": expiry,
            }

    def _result(self, row, result):
        if result.claim_id != row["claim_id"]:
            raise HTTPException(409, "Result belongs to another control claim.")
        if result.outcome == "verified":
            if (
                result.max_index is None
                or result.observed_index != row["percent"] * result.max_index // 100
            ):
                raise HTTPException(
                    409, "Observed control does not match the requested control step."
                )
        return {
            "claim_id": result.claim_id,
            "outcome": result.outcome,
            "observed_index": result.observed_index,
            "max_index": result.max_index,
        }

    def receipt_challenge(self, authority, task_id, result):
        with self._transaction(authority) as conn:
            row = self._task(
                conn, authority, task_id, result.expected_revision, "executing"
            )
            return self._challenge(
                conn,
                authority,
                row,
                f"assistant_{self.mode}_receipt",
                self._result(row, result),
            )

    def receipt(self, authority, task_id, result):
        with self._transaction(authority) as conn:
            row = self._task(
                conn, authority, task_id, result.expected_revision, "executing"
            )
            expected = self._result(row, result)
            fields = self._proof(
                conn, authority, row, result, f"assistant_{self.mode}_receipt"
            )
            if any((fields[key] != value for key, value in expected.items())):
                raise HTTPException(409, "Control receipt changed.")
            conn.execute(
                f"UPDATE assistant_{self.mode}_tasks SET state=?,revision=4,result_json=? WHERE id=?",
                (
                    result.outcome,
                    canonical(
                        {
                            key: value
                            for key, value in expected.items()
                            if key != "claim_id"
                        }
                    ),
                    task_id,
                ),
            )
            self._after_receipt(conn, authority, row, result)
            return self._view(self._task(conn, authority, task_id))

    def cancel(self, authority, task_id):
        with self._transaction(authority) as conn:
            row = self._task(conn, authority, task_id)
            if row["state"] not in TERMINAL:
                state = (
                    "outcome_unknown" if row["state"] == "executing" else "cancelled"
                )
                conn.execute(
                    f"UPDATE assistant_{self.mode}_tasks SET state=?,revision=revision+1,permit_hash=NULL,challenge_id=NULL WHERE id=?",
                    (state, task_id),
                )
            return self._view(self._task(conn, authority, task_id))
