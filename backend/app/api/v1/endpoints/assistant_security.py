"""Opt-in security enrollment and session management; no assistant actions."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.core.config import settings
from app.core.security import Principal, require_user
from app.db.database import get_db_connection
from app.schemas.assistant_security import (
    ChallengeResponse, DeviceResponse, DeviceSessionResponse, EmptySecurityRequest, EnrollmentRequest,
    ProofRequest, SecuritySessionResponse, SessionChallengeRequest, WebSessionResponse,
)
from app.services import assistant_security as security

router = APIRouter(dependencies=[Depends(security.require_enabled)])


@router.post("/enrollment/challenge", response_model=ChallengeResponse)
def enrollment_challenge(payload: EnrollmentRequest, principal: Principal = Depends(require_user)):
    return security.begin_enrollment(principal, payload)


@router.post("/enrollment", response_model=DeviceResponse)
def enrollment(payload: ProofRequest, principal: Principal = Depends(require_user)):
    return security.finish_enrollment(principal, payload)


@router.post("/device-session/challenge", response_model=ChallengeResponse)
def session_challenge(payload: SessionChallengeRequest, principal: Principal = Depends(require_user)):
    return security.begin_device_session(principal, payload.device_id)


@router.post("/device-session", response_model=DeviceSessionResponse)
def device_session(payload: ProofRequest, principal: Principal = Depends(require_user)):
    return security.finish_device_session(principal, payload)


@router.post("/web-session", response_model=WebSessionResponse)
def web_session(payload: EmptySecurityRequest, request: Request, response: Response, principal: Principal = Depends(require_user)):
    security.require_web_origin(request)
    token, csrf, expiry = security.create_web_session(principal, request.headers["origin"])
    response.set_cookie(security.COOKIE_NAME, token, max_age=settings.ASSISTANT_SESSION_TTL_SECONDS,
                        secure=True, httponly=True, samesite="strict", path="/")
    return {"csrf_token": csrf, "expires_at": expiry, "scope": security.SCOPE}


@router.get("/session", response_model=SecuritySessionResponse)
def session_status(session: security.SecuritySession = Depends(security.require_security_session)):
    with get_db_connection() as conn:
        row = conn.execute("SELECT expires_at FROM assistant_security_sessions WHERE token_hash=?", (session.token_hash,)).fetchone()
    if row is None:
        raise HTTPException(401, "Assistant session was revoked.")
    return {"expires_at": row["expires_at"], "scope": security.SCOPE}


@router.get("/devices", response_model=list[DeviceResponse])
def devices(session: security.SecuritySession = Depends(security.require_security_session)):
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT id,platform,revoked_at FROM assistant_devices WHERE user_id=? "
            "ORDER BY (revoked_at IS NOT NULL),created_at DESC LIMIT 100",
            (session.user_id,),
        ).fetchall()
    return [{"device_id": row["id"], "platform": row["platform"], "revoked": row["revoked_at"] is not None} for row in rows]


@router.delete("/devices/{device_id}", status_code=204)
def revoke_device(device_id: str, session: security.SecuritySession = Depends(security.require_security_session)):
    security.revoke_device(session, device_id)


@router.delete("/session", status_code=204)
def end_session(response: Response, session: security.SecuritySession = Depends(security.require_security_session)):
    with get_db_connection(write=True) as conn:
        conn.execute("DELETE FROM assistant_security_sessions WHERE token_hash=?", (session.token_hash,))
    response.delete_cookie(security.COOKIE_NAME, secure=True, httponly=True, samesite="strict", path="/")
