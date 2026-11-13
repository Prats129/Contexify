"""Durable simulation protocol. There is deliberately no OS/provider executor here."""

import base64
import binascii
import json
import secrets
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Request

from app.assistant.capabilities import POLICY_VERSION, validate_proposal
from app.core.config import settings
from app.core.rate_limits import Budget, consume_budgets
from app.core.security import Principal, digest
from app.db.database import get_db_connection
from app.schemas.assistant import (
    AssistantProposal,
    ClaimRequest,
    CreateTaskRequest,
    SimulationProofRequest,
    SimulationReceiptRequest,
    SimulationResultRequest,
    SimulationTaskView,
)
from app.services import assistant_security as security

TERMINAL = frozenset({"simulated", "failed", "outcome_unknown", "cancelled", "expired"})


def canonical(value) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )


def require_simulation(request: Request) -> None:
    security.require_enabled(request)
    if not getattr(settings, "ASSISTANT_SIMULATION_ENABLED", False):
        raise HTTPException(404, "Not found.")


@dataclass(frozen=True)
class SimulationAuthority:
    token_hash: str
    user_id: str
    device_id: str
    installation_id: str
    public_key: str
    platform: str


def _management(conn, session: security.SecuritySession):
    row = conn.execute(
        "SELECT s.*,d.installation_id,d.public_key,d.platform,d.revoked_at,d.origin AS device_origin "
        "FROM assistant_security_sessions s JOIN assistant_devices d "
        "ON d.id=s.device_id AND d.user_id=s.user_id "
        "WHERE s.token_hash=? AND s.user_id=? AND s.kind='device'",
        (session.token_hash, session.user_id),
    ).fetchone()
    if (
        not row
        or row["expires_at"] <= time.time()
        or row["revoked_at"] is not None
        or row["api_origin"] != settings.ASSISTANT_API_ORIGIN
        or row["device_origin"] != settings.ASSISTANT_API_ORIGIN
    ):
        raise HTTPException(403, "An enrolled device management session is required.")
    security._parent(conn, Principal(row["user_id"], row["parent_token_hash"]))
    return row


def create_session(session: security.SecuritySession):
    consume_budgets([Budget("assistant-simulation-session", session.user_id, 10, 60)])
    with get_db_connection(write=True) as conn:
        parent = _management(conn, session)
        now = time.time()
        conn.execute(
            "DELETE FROM assistant_simulation_sessions WHERE token_hash IN "
            "(SELECT token_hash FROM assistant_simulation_sessions WHERE expires_at<=? LIMIT 100)",
            (now,),
        )
        (count_row,) = conn.execute(
            "SELECT COUNT(*) AS count FROM assistant_simulation_sessions WHERE user_id=? AND expires_at>?",
            (session.user_id, now),
        ).fetchall()
        count = count_row["count"]
        if count >= 8:
            raise HTTPException(429, "Too many simulation sessions.")
        token = secrets.token_urlsafe(32)
        expiry = min(parent["expires_at"], now + 900)
        conn.execute(
            "INSERT INTO assistant_simulation_sessions(token_hash,parent_security_hash,user_id,device_id,expires_at) "
            "VALUES(?,?,?,?,?)",
            (
                digest(token),
                session.token_hash,
                session.user_id,
                parent["device_id"],
                expiry,
            ),
        )
    return {"access_token": token, "expires_at": expiry, "scope": "assistant:simulate"}


def _authority(conn, token_hash: str) -> SimulationAuthority:
    row = conn.execute(
        "SELECT c.*,p.parent_token_hash,p.expires_at AS management_expiry,p.api_origin,p.kind,"
        "d.installation_id,d.public_key,d.platform,d.revoked_at,d.origin AS device_origin "
        "FROM assistant_simulation_sessions c JOIN assistant_security_sessions p "
        "ON p.token_hash=c.parent_security_hash AND p.user_id=c.user_id AND p.device_id=c.device_id "
        "JOIN assistant_devices d ON d.id=c.device_id AND d.user_id=c.user_id WHERE c.token_hash=?",
        (token_hash,),
    ).fetchone()
    if (
        not row
        or row["kind"] != "device"
        or row["expires_at"] <= time.time()
        or row["management_expiry"] <= time.time()
        or row["revoked_at"] is not None
        or row["api_origin"] != settings.ASSISTANT_API_ORIGIN
        or row["device_origin"] != settings.ASSISTANT_API_ORIGIN
    ):
        raise HTTPException(401, "Simulation session expired or revoked.")
    security._parent(conn, Principal(row["user_id"], row["parent_token_hash"]))
    return SimulationAuthority(
        token_hash,
        row["user_id"],
        row["device_id"],
        row["installation_id"],
        row["public_key"],
        row["platform"],
    )


def require_simulation_authority(request: Request) -> SimulationAuthority:
    require_simulation(request)
    authorization = request.headers.get("authorization", "")
    if request.cookies.get(security.COOKIE_NAME) or not authorization.startswith(
        "Bearer "
    ):
        raise HTTPException(401, "A simulation-scoped bearer is required.")
    token = authorization[7:]
    if len(token) != 43:
        raise HTTPException(401, "Invalid simulation credential.")
    with get_db_connection() as conn:
        return _authority(conn, digest(token))


@contextmanager
def _transaction(authority: SimulationAuthority):
    consume_budgets([Budget("assistant-simulation", authority.user_id, 60, 60)])
    with get_db_connection(write=True) as conn:
        current = _authority(conn, authority.token_hash)
        if current != authority:
            raise HTTPException(401, "Simulation identity changed.")
        yield conn


def _event(conn, task_id: str, action_id: str | None, state: str) -> None:
    conn.execute(
        "INSERT INTO assistant_events(task_id,action_id,state,created_at) VALUES(?,?,?,?)",
        (task_id, action_id, state, time.time()),
    )


def _transition(conn, action, state: str) -> dict:
    changed = conn.execute(
        "UPDATE assistant_actions SET state=?,revision=revision+1 WHERE id=? AND revision=?",
        (state, action["id"], action["revision"]),
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "Action revision changed. Read its status again.")
    _event(conn, action["task_id"], action["id"], state)
    return {**dict(action), "state": state, "revision": action["revision"] + 1}


def _actions(conn, task_id: str):
    return conn.execute(
        "SELECT * FROM assistant_actions WHERE task_id=? ORDER BY step_index",
        (task_id,),
    ).fetchall()


def _task(conn, authority: SimulationAuthority, task_id: str):
    row = conn.execute(
        "SELECT * FROM assistant_tasks WHERE id=? AND user_id=? AND device_id=?",
        (task_id, authority.user_id, authority.device_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Simulation task not found.")
    if row["policy_version"] != POLICY_VERSION:
        raise HTTPException(409, "Policy changed. Create a new proposal.")
    now = time.time()
    actions = _actions(conn, task_id)
    for index, action in enumerate(actions):
        if action["state"] in TERMINAL:
            continue
        if action["state"] == "executing" and action["claim_expires_at"] <= now:
            actions[index] = _transition(conn, action, "outcome_unknown")
        elif row["expires_at"] <= now:
            actions[index] = _transition(
                conn,
                action,
                "outcome_unknown" if action["state"] == "executing" else "expired",
            )
        elif action["state"] == "authorized":
            alive = conn.execute(
                "SELECT 1 FROM assistant_permits WHERE action_id=? AND consumed_at IS NULL AND expires_at>?",
                (action["id"], now),
            ).fetchone()
            if not alive:
                actions[index] = _transition(conn, action, "expired")
    states = [action["state"] for action in actions]
    stopped = next(
        (
            state
            for state in ("outcome_unknown", "failed", "expired", "cancelled")
            if state in states
        ),
        None,
    )
    if stopped:
        for action in actions:
            if action["state"] in ("awaiting_confirmation", "authorized"):
                _transition(conn, action, "cancelled")
        state = stopped
    elif all(state == "simulated" for state in states):
        state = "simulated"
    else:
        state = next(
            (state for state in ("executing", "authorized") if state in states),
            "awaiting_confirmation",
        )
    if state != row["state"]:
        conn.execute("UPDATE assistant_tasks SET state=? WHERE id=?", (state, task_id))
        _event(conn, task_id, None, state)
    return {**dict(row), "state": state}


def _view(conn, authority: SimulationAuthority, task_id: str):
    task = _task(conn, authority, task_id)
    return SimulationTaskView.model_validate(
        {
            "task_id": task_id,
            "state": task["state"],
            "policy_version": task["policy_version"],
            "actions": [
                {
                    "action_id": row["id"],
                    "action": json.loads(row["action_json"]),
                    "depends_on": json.loads(row["dependencies_json"]),
                    "revision": row["revision"],
                    "state": row["state"],
                }
                for row in _actions(conn, task_id)
            ],
        }
    )


def create_task(authority: SimulationAuthority, payload: CreateTaskRequest):
    validate_proposal(payload.proposal, authority.platform)
    encoded = canonical(payload.proposal.model_dump())
    if len(encoded.encode()) > 8192:
        raise HTTPException(413, "Simulation proposal is too large.")
    fingerprint = digest(encoded)
    with _transaction(authority) as conn:
        existing = conn.execute(
            "SELECT id,proposal_digest FROM assistant_tasks WHERE user_id=? AND device_id=? AND idempotency_key=?",
            (authority.user_id, authority.device_id, payload.idempotency_key),
        ).fetchone()
        if existing:
            if existing["proposal_digest"] != fingerprint:
                raise HTTPException(
                    409, "Idempotency key was used for a different proposal."
                )
            return _view(conn, authority, existing["id"])
        # Bound durable allocations, including callers that rotate client IDs.
        (recent_row,) = conn.execute(
            "SELECT COUNT(*) AS count FROM assistant_tasks WHERE user_id=? AND created_at>?",
            (authority.user_id, time.time() - 86400),
        ).fetchall()
        recent = recent_row["count"]
        if recent >= 100:
            raise HTTPException(429, "Daily simulation task limit reached.")
        # Synthetic simulation history only; bound cleanup work per request.
        conn.execute(
            "DELETE FROM assistant_tasks WHERE id IN "
            "(SELECT id FROM assistant_tasks WHERE created_at<? LIMIT 100)",
            (time.time() - 7 * 86400,),
        )
        task_id, now = str(uuid.uuid4()), time.time()
        conn.execute(
            "INSERT INTO assistant_tasks(id,user_id,device_id,idempotency_key,proposal_digest,policy_version,state,created_at,expires_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (
                task_id,
                authority.user_id,
                authority.device_id,
                payload.idempotency_key,
                fingerprint,
                POLICY_VERSION,
                "awaiting_confirmation",
                now,
                now + 900,
            ),
        )
        _event(conn, task_id, None, "awaiting_confirmation")
        for index, step in enumerate(payload.proposal.steps):
            action_json = canonical(step.action.model_dump())
            conn.execute(
                "INSERT INTO assistant_actions(id,task_id,step_index,action_json,arguments_digest,dependencies_json,state) VALUES(?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    task_id,
                    index,
                    action_json,
                    digest(action_json),
                    canonical(step.depends_on),
                    "awaiting_confirmation",
                ),
            )
        return _view(conn, authority, task_id)


def get_task(authority: SimulationAuthority, task_id: str):
    with _transaction(authority) as conn:
        return _view(conn, authority, task_id)


def _action(conn, authority, task_id, action_id, expected_revision, expected_state):
    _task(conn, authority, task_id)
    row = conn.execute(
        "SELECT * FROM assistant_actions WHERE id=? AND task_id=?", (action_id, task_id)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Simulation action not found.")
    if row["revision"] != expected_revision or row["state"] != expected_state:
        raise HTTPException(
            409, "Action state or revision changed. Read its status again."
        )
    if digest(row["action_json"]) != row["arguments_digest"]:
        raise HTTPException(409, "Action snapshot changed. Create a new proposal.")
    validate_proposal(
        AssistantProposal.model_validate(
            {"steps": [{"action": json.loads(row["action_json"])}]}
        ),
        authority.platform,
    )
    if any(
        previous["state"] != "simulated"
        for previous in _actions(conn, task_id)
        if previous["step_index"] < row["step_index"]
    ):
        raise HTTPException(409, "Complete earlier simulation steps first.")
    return row


def _challenge(conn, authority, action, purpose, extra=None):
    conn.execute(
        "DELETE FROM assistant_action_challenges WHERE action_id=? AND purpose=? AND consumed_at IS NULL",
        (action["id"], purpose),
    )
    challenge_id = str(uuid.uuid4())
    expiry = time.time() + 60
    fields = {
        "protocol_version": 1,
        "mode": "simulation",
        "purpose": purpose,
        "policy_version": POLICY_VERSION,
        "origin": settings.ASSISTANT_API_ORIGIN,
        "user_id": authority.user_id,
        "device_id": authority.device_id,
        "installation_id": authority.installation_id,
        "public_key": authority.public_key,
        "session_hash": authority.token_hash,
        "task_id": action["task_id"],
        "action_id": action["id"],
        "action_revision": action["revision"],
        "arguments_json": action["action_json"],
        "arguments_digest": action["arguments_digest"],
        "nonce": secrets.token_urlsafe(32),
        "challenge_id": challenge_id,
        "expires_at": expiry,
    }
    if extra:
        fields.update(extra)
    payload = canonical(fields)
    conn.execute(
        "INSERT INTO assistant_action_challenges(id,action_id,session_hash,purpose,payload,expires_at) VALUES(?,?,?,?,?,?)",
        (challenge_id, action["id"], authority.token_hash, purpose, payload, expiry),
    )
    return {"challenge_id": challenge_id, "payload": payload, "expires_at": expiry}


def _proof(conn, authority, action, proof, purpose):
    challenge = conn.execute(
        "SELECT * FROM assistant_action_challenges WHERE id=? AND action_id=? AND session_hash=? "
        "AND purpose=? AND consumed_at IS NULL AND expires_at>?",
        (proof.challenge_id, action["id"], authority.token_hash, purpose, time.time()),
    ).fetchone()
    if not challenge:
        raise HTTPException(401, "Invalid, expired or replayed simulation proof.")
    fields = json.loads(challenge["payload"])
    if (
        fields["action_revision"] != action["revision"]
        or fields["arguments_digest"] != action["arguments_digest"]
        or fields["policy_version"] != POLICY_VERSION
        or fields["origin"] != settings.ASSISTANT_API_ORIGIN
    ):
        raise HTTPException(409, "Simulation authorization snapshot changed.")
    try:
        security._public_key(authority.public_key).verify(
            base64.b64decode(proof.signature, validate=True),
            challenge["payload"].encode(),
            ec.ECDSA(hashes.SHA256()),
        )
    except (InvalidSignature, ValueError, binascii.Error):
        raise HTTPException(401, "Invalid simulation signature.") from None
    changed = conn.execute(
        "UPDATE assistant_action_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
        (time.time(), proof.challenge_id, time.time()),
    )
    if changed.rowcount != 1:
        raise HTTPException(409, "Simulation proof was already consumed.")
    return fields


def authorization_challenge(authority, task_id, action_id, revision):
    with _transaction(authority) as conn:
        action = _action(
            conn, authority, task_id, action_id, revision, "awaiting_confirmation"
        )
        return _challenge(conn, authority, action, "assistant_simulation_authorize")


def authorize(authority, task_id, action_id, proof: SimulationProofRequest):
    with _transaction(authority) as conn:
        action = _action(
            conn,
            authority,
            task_id,
            action_id,
            proof.expected_revision,
            "awaiting_confirmation",
        )
        _proof(conn, authority, action, proof, "assistant_simulation_authorize")
        permit, expiry = secrets.token_urlsafe(32), time.time() + 60
        action = _transition(conn, action, "authorized")
        conn.execute(
            "INSERT INTO assistant_permits(token_hash,action_id,session_hash,action_revision,expires_at) VALUES(?,?,?,?,?)",
            (
                digest(permit),
                action_id,
                authority.token_hash,
                action["revision"],
                expiry,
            ),
        )
        challenge = _challenge(
            conn,
            authority,
            action,
            "assistant_simulation_claim",
            {"permit_hash": digest(permit)},
        )
        _task(conn, authority, task_id)
        return {
            "permit": permit,
            "claim_challenge": challenge,
            "action_revision": action["revision"],
            "expires_at": expiry,
        }


def claim(authority, task_id, action_id, payload: ClaimRequest):
    with _transaction(authority) as conn:
        action = _action(
            conn, authority, task_id, action_id, payload.expected_revision, "authorized"
        )
        fields = _proof(conn, authority, action, payload, "assistant_simulation_claim")
        if fields["permit_hash"] != digest(payload.permit):
            raise HTTPException(401, "Permit does not match this exact action.")
        changed = conn.execute(
            "UPDATE assistant_permits SET consumed_at=? WHERE token_hash=? AND action_id=? AND session_hash=? "
            "AND action_revision=? AND consumed_at IS NULL AND expires_at>?",
            (
                time.time(),
                digest(payload.permit),
                action_id,
                authority.token_hash,
                action["revision"],
                time.time(),
            ),
        )
        if changed.rowcount != 1:
            raise HTTPException(409, "Permit expired or was already claimed.")
        claim_id, expiry = str(uuid.uuid4()), time.time() + 15
        action = _transition(conn, action, "executing")
        conn.execute(
            "UPDATE assistant_actions SET claim_id=?,claim_expires_at=? WHERE id=?",
            (claim_id, expiry, action_id),
        )
        _task(conn, authority, task_id)
        return {
            "claim_id": claim_id,
            "action_revision": action["revision"],
            "execution": "simulation_only",
            "expires_at": expiry,
        }


def receipt_challenge(authority, task_id, action_id, payload: SimulationResultRequest):
    with _transaction(authority) as conn:
        action = _action(
            conn, authority, task_id, action_id, payload.expected_revision, "executing"
        )
        if payload.claim_id != action["claim_id"]:
            raise HTTPException(409, "Receipt belongs to another claim.")
        return _challenge(
            conn,
            authority,
            action,
            "assistant_simulation_receipt",
            {"claim_id": payload.claim_id, "outcome": payload.outcome},
        )


def record_receipt(authority, task_id, action_id, payload: SimulationReceiptRequest):
    with _transaction(authority) as conn:
        action = _action(
            conn, authority, task_id, action_id, payload.expected_revision, "executing"
        )
        fields = _proof(
            conn, authority, action, payload, "assistant_simulation_receipt"
        )
        if (fields["claim_id"], fields["outcome"]) != (
            payload.claim_id,
            payload.outcome,
        ) or payload.claim_id != action["claim_id"]:
            raise HTTPException(409, "Receipt snapshot changed.")
        _transition(conn, action, payload.outcome)
        return _view(conn, authority, task_id)


def cancel_task(authority, task_id):
    with _transaction(authority) as conn:
        _task(conn, authority, task_id)
        for action in _actions(conn, task_id):
            if action["state"] not in TERMINAL:
                _transition(
                    conn,
                    action,
                    "outcome_unknown"
                    if action["state"] == "executing"
                    else "cancelled",
                )
        return _view(conn, authority, task_id)


def events(authority, task_id):
    with _transaction(authority) as conn:
        _task(conn, authority, task_id)
        rows = conn.execute(
            "SELECT * FROM assistant_events WHERE task_id=? ORDER BY id LIMIT 100",
            (task_id,),
        ).fetchall()
    return [
        {
            "event_id": row["id"],
            "action_id": row["action_id"],
            "state": row["state"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
