"""Planning-only consent grants. Persist metadata, never commands or proposals."""

import time
import uuid
from dataclasses import dataclass
from typing import cast

from fastapi import HTTPException, Request

from app.core.config import settings
from app.core.rate_limits import Budget, consume_budgets
from app.core.security import Principal
from app.db.database import get_db_connection
from app.schemas.assistant import Platform
from app.schemas.assistant_planning import PlanningGrant
from app.services import assistant_security as security

POLICY_VERSION = 1


def require_enabled(request: Request) -> None:
    security.require_enabled(request)
    if not getattr(settings, "ASSISTANT_PLANNING_ENABLED", False):
        raise HTTPException(404, "Not found.")


@dataclass(frozen=True)
class PlanningAuthority:
    grant_id: str
    user_id: str
    token_hash: str
    device_id: str | None
    platform: Platform
    expires_at: float


def _parent(conn, session: security.SecuritySession):
    row = conn.execute(
        "SELECT s.*,d.platform,d.revoked_at,d.origin AS device_origin "
        "FROM assistant_security_sessions s LEFT JOIN assistant_devices d "
        "ON d.id=s.device_id AND d.user_id=s.user_id WHERE s.token_hash=? AND s.user_id=?",
        (session.token_hash, session.user_id),
    ).fetchone()
    if (
        not row
        or row["expires_at"] <= time.time()
        or row["api_origin"] != settings.ASSISTANT_API_ORIGIN
        or row["device_id"] != session.device_id
        or row["kind"] not in ("web", "device")
        or (
            row["kind"] == "device"
            and (
                row["revoked_at"] is not None
                or row["device_origin"] != settings.ASSISTANT_API_ORIGIN
            )
        )
    ):
        raise HTTPException(401, "Planning sign-in expired or was revoked.")
    security._parent(conn, Principal(session.user_id, row["parent_token_hash"]))
    return row


def create_grant(request: Request) -> PlanningGrant:
    require_enabled(request)
    session = security.require_security_session(request)
    consume_budgets([Budget("assistant-planning-consent", session.user_id, 10, 60)])
    with get_db_connection(write=True) as conn:
        parent = _parent(conn, session)
        now = time.time()
        conn.execute(
            "DELETE FROM assistant_planning_grants WHERE id IN "
            "(SELECT id FROM assistant_planning_grants WHERE expires_at<=? LIMIT 100)",
            (now,),
        )
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM assistant_planning_grants "
            "WHERE user_id=? AND expires_at>?",
            (session.user_id, now),
        ).fetchone()["count"]
        if count >= 4:
            raise HTTPException(429, "Too many active planning grants.")
        grant_id, expiry = str(uuid.uuid4()), min(parent["expires_at"], now + 300)
        conn.execute(
            "INSERT INTO assistant_planning_grants "
            "(id,user_id,session_hash,device_id,policy_version,created_at,expires_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (
                grant_id,
                session.user_id,
                session.token_hash,
                session.device_id,
                POLICY_VERSION,
                now,
                expiry,
            ),
        )
    return PlanningGrant(grant_id=grant_id, expires_at=expiry)


def authorize(request: Request, grant_id: str) -> PlanningAuthority:
    require_enabled(request)
    session = security.require_security_session(request)
    with get_db_connection() as conn:
        parent = _parent(conn, session)
        row = conn.execute(
            "SELECT * FROM assistant_planning_grants WHERE id=? AND user_id=? AND session_hash=?",
            (grant_id, session.user_id, session.token_hash),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Planning grant not found.")
        if (
            row["policy_version"] != POLICY_VERSION
            or row["expires_at"] <= time.time()
            or row["device_id"] != session.device_id
        ):
            raise HTTPException(403, "Planning consent expired or changed.")
        platform = "web" if parent["kind"] == "web" else parent["platform"]
        if platform not in ("web", "android", "ios"):
            raise HTTPException(403, "Unsupported planning platform.")
        return PlanningAuthority(
            grant_id,
            session.user_id,
            session.token_hash,
            session.device_id,
            cast(Platform, platform),
            min(row["expires_at"], parent["expires_at"]),
        )


def revoke_grant(request: Request, grant_id: str) -> None:
    authority = authorize(request, grant_id)
    with get_db_connection(write=True) as conn:
        conn.execute(
            "DELETE FROM assistant_planning_grants WHERE id=? AND user_id=? AND session_hash=?",
            (authority.grant_id, authority.user_id, authority.token_hash),
        )


def admit_attempt(request: Request, authority: PlanningAuthority) -> None:
    if authorize(request, authority.grant_id) != authority:
        raise HTTPException(409, "Planning context changed.")
    # Shared SQL-backed token buckets: no transcripts or provider credentials in keys.
    consume_budgets(
        [
            Budget("assistant-planning-user-minute", authority.user_id, 10, 60),
            Budget("assistant-planning-user-day", authority.user_id, 20, 86400),
            Budget("assistant-planning-global-minute", "all-users", 30, 60),
            Budget("assistant-planning-global-day", "all-users", 100, 86400),
        ]
    )
