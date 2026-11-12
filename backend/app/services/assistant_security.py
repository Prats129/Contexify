"""Security bootstrap only. Never imports chat, model, media or execution services."""

import base64
import binascii
import json
import secrets
import time
import uuid
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Request

from app.core.config import settings
from app.core.rate_limits import Budget, consume_budgets
from app.core.security import Principal, digest
from app.db.database import get_db_connection
from app.schemas.assistant_security import EnrollmentRequest, ProofRequest

COOKIE_NAME = "__Host-contexify_assistant"
SCOPE = "security:manage"


def require_enabled(request: Request) -> None:
    if not getattr(settings, "ASSISTANT_SECURITY_ENABLED", False):
        raise HTTPException(404, "Not found.")
    # Respect only the ASGI server's trusted scheme, never arbitrary forwarded headers.
    if (request.url.scheme != "https"
            or str(request.base_url).rstrip("/") != settings.ASSISTANT_API_ORIGIN):
        raise HTTPException(403, "Assistant security requires its configured HTTPS origin.")


def require_web_origin(request: Request) -> str:
    origin = request.headers.get("origin", "")
    # Browsers may omit Origin on same-origin GET/HEAD. Fetch Metadata supplies
    # provenance for that exact case; never infer it for a write or cross-site read.
    if (not origin and request.method in ("GET", "HEAD")
            and request.headers.get("sec-fetch-site") == "same-origin"):
        origin = settings.ASSISTANT_API_ORIGIN
    if origin not in settings.ASSISTANT_WEB_ORIGINS:
        raise HTTPException(403, "Untrusted assistant origin.")
    if request.headers.get("x-contexify-assistant") != "1":
        raise HTTPException(403, "Explicit assistant request required.")
    return origin


def _parent(conn, principal: Principal, *, fresh: bool = False):
    row = conn.execute(
        "SELECT a.authenticated_at,a.expires_at,a.credential_hash,u.password_hash "
        "FROM auth_sessions a JOIN users u ON u.id=a.user_id "
        "WHERE a.token_hash=? AND a.user_id=?",
        (principal.token_hash, principal.user_id),
    ).fetchone()
    now = time.time()
    if (principal.is_guest or not row or row["expires_at"] <= now
            or not secrets.compare_digest(row["credential_hash"], digest(row["password_hash"]))):
        raise HTTPException(401, "Please sign in again.")
    if fresh and (row["authenticated_at"] <= 0 or not 0 <= now - row["authenticated_at"] <= settings.ASSISTANT_FRESH_AUTH_SECONDS):
        raise HTTPException(401, "A fresh sign-in is required to enable the assistant.")
    return row


def _budget(principal: Principal) -> None:
    consume_budgets([Budget("assistant-security", principal.user_id, 20, 60)])


def _prune(conn) -> None:
    now = time.time()
    conn.execute(
        "DELETE FROM assistant_challenges WHERE id IN "
        "(SELECT id FROM assistant_challenges WHERE expires_at<=? LIMIT 100)", (now,),
    )
    conn.execute(
        "DELETE FROM assistant_security_sessions WHERE token_hash IN "
        "(SELECT token_hash FROM assistant_security_sessions WHERE expires_at<=? LIMIT 100)", (now,),
    )


def _public_key(encoded: str):
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) != 65 or raw[0] != 4 or base64.b64encode(raw).decode("ascii") != encoded:
            raise ValueError()
        return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except (ValueError, binascii.Error):
        raise HTTPException(400, "Invalid device public key.") from None


def _challenge(
    conn, principal: Principal, purpose: str, public_key: str,
    installation_id: str, platform: str, device_id: str | None = None,
):
    now = time.time()
    _prune(conn)
    count = conn.execute(
        "SELECT COUNT(*) AS count FROM assistant_challenges "
        "WHERE user_id=? AND consumed_at IS NULL AND expires_at>?",
        (principal.user_id, now),
    ).fetchone()["count"]
    if count >= 8:
        raise HTTPException(429, "Too many pending enrollment requests.")
    challenge_id = str(uuid.uuid4())
    expires_at = now + 60
    # The client signs these exact UTF-8 bytes. JSON reserialization is forbidden.
    payload = json.dumps({
        "protocol_version": 1, "purpose": purpose, "challenge_id": challenge_id,
        "nonce": secrets.token_urlsafe(32), "user_id": principal.user_id,
        "session_hash": principal.token_hash, "origin": settings.ASSISTANT_API_ORIGIN,
        "installation_id": installation_id, "public_key": public_key,
        "platform": platform, "device_id": device_id, "expires_at": expires_at,
    }, sort_keys=True, separators=(",", ":"))
    conn.execute(
        "INSERT INTO assistant_challenges "
        "(id,user_id,token_hash,purpose,device_id,payload,public_key,installation_id,platform,expires_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (challenge_id, principal.user_id, principal.token_hash, purpose, device_id,
         payload, public_key, installation_id, platform, expires_at),
    )
    return {"challenge_id": challenge_id, "payload": payload, "expires_at": expires_at}


def begin_enrollment(principal: Principal, request: EnrollmentRequest):
    _budget(principal)
    _public_key(request.public_key)
    with get_db_connection(write=True) as conn:
        _parent(conn, principal, fresh=True)
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM assistant_devices WHERE user_id=? AND revoked_at IS NULL",
            (principal.user_id,),
        ).fetchone()["count"]
        if count >= 8:
            raise HTTPException(409, "Revoke an existing device before adding another.")
        if conn.execute(
            "SELECT 1 FROM assistant_devices WHERE public_key=? OR (user_id=? AND installation_id=?)",
            (request.public_key, principal.user_id, request.installation_id),
        ).fetchone():
            raise HTTPException(409, "This installation has already been enrolled. Create a new key to enroll again.")
        return _challenge(conn, principal, "enroll", request.public_key,
                          request.installation_id, request.platform)


def begin_device_session(principal: Principal, device_id: str):
    _budget(principal)
    with get_db_connection(write=True) as conn:
        _parent(conn, principal)
        device = conn.execute(
            "SELECT * FROM assistant_devices WHERE id=? AND user_id=? AND revoked_at IS NULL AND origin=?",
            (device_id, principal.user_id, settings.ASSISTANT_API_ORIGIN),
        ).fetchone()
        if not device:
            raise HTTPException(404, "Device not found.")
        return _challenge(conn, principal, "session", device["public_key"],
                          device["installation_id"], device["platform"], device_id)


def _consume_proof(conn, principal: Principal, proof: ProofRequest, purpose: str):
    _parent(conn, principal, fresh=purpose == "enroll")
    row = conn.execute(
        "SELECT * FROM assistant_challenges WHERE id=? AND token_hash=? AND user_id=? "
        "AND purpose=? AND consumed_at IS NULL AND expires_at>?",
        (proof.challenge_id, principal.token_hash, principal.user_id, purpose, time.time()),
    ).fetchone()
    if not row or json.loads(row["payload"])["origin"] != settings.ASSISTANT_API_ORIGIN:
        raise HTTPException(401, "Invalid or expired device challenge.")
    try:
        signature = base64.b64decode(proof.signature, validate=True)
        _public_key(row["public_key"]).verify(signature, row["payload"].encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError, binascii.Error):
        raise HTTPException(401, "Invalid device proof.") from None
    updated = conn.execute(
        "UPDATE assistant_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
        (time.time(), row["id"], time.time()),
    )
    if updated.rowcount != 1:
        raise HTTPException(409, "Device challenge was already used.")
    return row


def finish_enrollment(principal: Principal, proof: ProofRequest):
    _budget(principal)
    with get_db_connection(write=True) as conn:
        row = _consume_proof(conn, principal, proof, "enroll")
        # Serialize both the quota check and unique-key check with enrollment.
        count = conn.execute("SELECT COUNT(*) AS count FROM assistant_devices WHERE user_id=? AND revoked_at IS NULL", (principal.user_id,)).fetchone()["count"]
        if count >= 8 or conn.execute(
            "SELECT 1 FROM assistant_devices WHERE public_key=? OR (user_id=? AND installation_id=?)",
            (row["public_key"], principal.user_id, row["installation_id"]),
        ).fetchone():
            raise HTTPException(409, "Device enrollment changed. Start again.")
        device_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO assistant_devices(id,user_id,installation_id,public_key,platform,origin,created_at) VALUES(?,?,?,?,?,?,?)",
            (device_id, principal.user_id, row["installation_id"], row["public_key"],
             row["platform"], settings.ASSISTANT_API_ORIGIN, time.time()),
        )
    return {"device_id": device_id, "platform": row["platform"], "revoked": False}


def _new_session(
    conn, principal: Principal, kind: str,
    device_id: str | None = None, origin: str | None = None,
):
    parent = _parent(conn, principal, fresh=kind == "web")
    _prune(conn)
    count = conn.execute(
        "SELECT COUNT(*) AS count FROM assistant_security_sessions WHERE user_id=? AND expires_at>?",
        (principal.user_id, time.time()),
    ).fetchone()["count"]
    if count >= 20:
        raise HTTPException(429, "Too many active assistant sessions.")
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    expires_at = min(time.time() + settings.ASSISTANT_SESSION_TTL_SECONDS, parent["expires_at"])
    conn.execute(
        "INSERT INTO assistant_security_sessions(token_hash,parent_token_hash,user_id,device_id,kind,csrf_hash,origin,api_origin,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (digest(token), principal.token_hash, principal.user_id, device_id, kind,
         digest(csrf) if kind == "web" else None, origin or settings.ASSISTANT_API_ORIGIN,
         settings.ASSISTANT_API_ORIGIN, expires_at),
    )
    return token, csrf, expires_at


def create_web_session(principal: Principal, origin: str):
    _budget(principal)
    with get_db_connection(write=True) as conn:
        return _new_session(conn, principal, "web", origin=origin)


def finish_device_session(principal: Principal, proof: ProofRequest):
    _budget(principal)
    with get_db_connection(write=True) as conn:
        row = _consume_proof(conn, principal, proof, "session")
        if not conn.execute(
            "SELECT 1 FROM assistant_devices WHERE id=? AND user_id=? AND revoked_at IS NULL AND origin=?",
            (row["device_id"], principal.user_id, settings.ASSISTANT_API_ORIGIN),
        ).fetchone():
            raise HTTPException(401, "Device authorization has been revoked.")
        token, _, expiry = _new_session(conn, principal, "device", row["device_id"])
    return {"access_token": token, "expires_at": expiry, "device_id": row["device_id"], "scope": SCOPE}


@dataclass(frozen=True)
class SecuritySession:
    user_id: str
    token_hash: str
    device_id: str | None


def require_security_session(request: Request) -> SecuritySession:
    require_enabled(request)
    authorization = request.headers.get("authorization", "")
    cookie = request.cookies.get(COOKIE_NAME)
    if authorization:
        if cookie or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Use one assistant session credential.")
        token, kind = authorization[7:], "device"
    else:
        token, kind = cookie or "", "web"
        web_origin = require_web_origin(request)
    if not 32 <= len(token) <= 128:
        raise HTTPException(401, "Assistant sign-in required.")
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT s.*,a.credential_hash,a.authenticated_at,a.expires_at AS parent_expiry,u.password_hash,d.revoked_at,d.origin AS device_origin "
            "FROM assistant_security_sessions s JOIN auth_sessions a ON a.token_hash=s.parent_token_hash "
            "JOIN users u ON u.id=s.user_id LEFT JOIN assistant_devices d ON d.id=s.device_id AND d.user_id=s.user_id "
            "WHERE s.token_hash=? AND s.kind=? AND a.user_id=s.user_id",
            (digest(token), kind),
        ).fetchone()
    if (not row or row["expires_at"] <= time.time() or row["parent_expiry"] <= time.time()
            or row["api_origin"] != settings.ASSISTANT_API_ORIGIN
            or not secrets.compare_digest(row["credential_hash"], digest(row["password_hash"]))
            or (kind == "device" and (row["revoked_at"] is not None or row["device_origin"] != settings.ASSISTANT_API_ORIGIN))):
        raise HTTPException(401, "Assistant session expired or revoked.")
    if kind == "web" and not secrets.compare_digest(
        row["csrf_hash"] or "", digest(request.headers.get("x-csrf-token", ""))
    ):
        raise HTTPException(403, "Invalid assistant CSRF token.")
    if kind == "web" and row["origin"] != web_origin:
        raise HTTPException(403, "Assistant session belongs to a different origin.")
    return SecuritySession(row["user_id"], digest(token), row["device_id"])


def revoke_device(session: SecuritySession, device_id: str):
    with get_db_connection(write=True) as conn:
        if not conn.execute("SELECT 1 FROM assistant_devices WHERE id=? AND user_id=?", (device_id, session.user_id)).fetchone():
            raise HTTPException(404, "Device not found.")
        conn.execute("UPDATE assistant_devices SET revoked_at=COALESCE(revoked_at,?) WHERE id=?", (time.time(), device_id))
        conn.execute("DELETE FROM assistant_security_sessions WHERE device_id=?", (device_id,))
        conn.execute("DELETE FROM assistant_challenges WHERE device_id=?", (device_id,))
